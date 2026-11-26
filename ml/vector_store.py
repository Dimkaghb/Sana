"""Single-writer Qdrant collections. Each score or enrollment commits in one point write."""

import hashlib
import json
from threading import RLock
from time import perf_counter
from uuid import NAMESPACE_URL, uuid5

import numpy as np
from qdrant_client import QdrantClient, models

from .features import extract


def payload_digest(payload):
    return hashlib.sha256(
        json.dumps(
            payload, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()


def vector_digest(vector):
    return hashlib.sha256(np.asarray(vector, dtype="<f4").tobytes()).hexdigest()


def point_id(scope, key):
    return str(uuid5(NAMESPACE_URL, f"sana:{scope}:{key}"))


def where(**values):
    return models.Filter(
        must=[
            models.FieldCondition(key=k, match=models.MatchValue(value=v))
            for k, v in values.items()
        ]
    )


def normalize(vector):
    vector = np.asarray(vector, dtype=np.float32)
    return vector / max(np.linalg.norm(vector), 1e-12)


def similarity(left, right):
    return float(np.clip(np.dot(left, right), -1, 1))


class Conflict(ValueError):
    pass


class IdentityStore:
    def __init__(self, client, model, projector, prefix=""):
        self.client: QdrantClient = client
        self.prefix = prefix
        self.model, self.projector = model, projector
        self.lock = RLock()
        for name in ("global_sessions", "account_centroids", "banned_operators"):
            name = prefix + name
            if not client.collection_exists(name):
                client.create_collection(
                    name,
                    vectors_config=models.VectorParams(
                        size=128, distance=models.Distance.COSINE
                    ),
                    hnsw_config=models.HnswConfigDiff(m=16, ef_construct=100),
                )

    def get(self, collection, key, scope):
        result = self.client.retrieve(
            self.prefix + collection, [point_id(scope, key)], with_vectors=True
        )
        return result[0] if result else None

    def put(self, collection, key, scope, vector, payload):
        self.client.upsert(
            self.prefix + collection,
            [
                models.PointStruct(
                    id=point_id(scope, key),
                    vector=list(map(float, vector)),
                    payload={"scope": scope, **payload},
                )
            ],
            wait=True,
        )

    def scroll(self, collection, filter=None, vectors=False):
        offset = None
        while True:
            points, offset = self.client.scroll(
                self.prefix + collection,
                scroll_filter=filter,
                offset=offset,
                limit=128,
                with_vectors=vectors,
            )
            yield from points
            if offset is None:
                break

    def neighbors(self, collection, vector, scope, k):
        return self.client.query_points(
            self.prefix + collection,
            query=vector.tolist(),
            limit=k,
            score_threshold=0.80,
            query_filter=where(scope=scope),
        ).points

    def score(self, payload, scope="live"):
        with self.lock:
            started = perf_counter()
            sid, account = payload["session_id"], payload["account_id"]
            digest = payload_digest(payload)
            old = self.get("global_sessions", sid, scope)
            if old:
                if old.payload["digest"] != digest:
                    raise Conflict("Session identifier reused with different data")
                return old.payload["result"]
            feature = extract(payload)
            vector = self.model.embed([feature])[0]
            banned = self.neighbors("banned_operators", vector, scope, 1)
            nearby = self.neighbors("global_sessions", vector, scope, 10)
            match = banned[0] if banned else nearby[0] if nearby else None
            operator = (
                match.payload["operator_id"]
                if match
                else f"op_{point_id(scope, sid)[:18]}"
            )
            accounts = {account}
            if match:
                points = self.scroll(
                    "global_sessions", where(scope=scope, operator_id=operator)
                )
                accounts.update(p.payload["account_id"] for p in points)
            owner = self.get("account_centroids", account, scope)
            owner_score = similarity(vector, owner.vector) if owner else None
            count = len(owner.payload["enrolled"]) if owner else 0
            handoff = count >= 3 and owner_score < 0.68
            map_point = self.projector.point(vector)
            result = {
                "session_id": sid,
                "embedding_dim": 128,
                "embedding_preview": vector[:4].tolist(),
                "owner_verification": {
                    "cosine_similarity": owner_score,
                    "baseline_sessions_count": count,
                    "is_handoff_detected": handoff,
                },
                "operator_reconciliation": {
                    "matched_operator_id": operator,
                    "match_confidence": min(1.0, max(0.0, match.score))
                    if match
                    else None,
                    "is_banned_operator": bool(banned),
                    "linked_account_ids": sorted(accounts),
                    "ring_size": len(accounts),
                },
                "map_point": map_point,
                "inference_ms": round((perf_counter() - started) * 1000, 3),
            }
            status = (
                "CRITICAL"
                if banned or handoff or len(accounts) > 1
                else "NORMAL"
                if count >= 3
                else "UNVERIFIED"
            )
            self.put(
                "global_sessions",
                sid,
                scope,
                vector,
                {
                    "session_id": sid,
                    "account_id": account,
                    "operator_id": operator,
                    "digest": digest,
                    "status": status,
                    "result": result,
                },
            )
            return result

    def fingerprint(self, sid):
        with self.lock:
            point = self.get("global_sessions", sid, "live")
            if not point:
                raise KeyError("Unknown session")
            return {
                "session_id": sid,
                "operator_fingerprint": point.payload.get("original_fingerprint")
                or vector_digest(point.vector),
            }

    def enroll(self, sid, scope="live"):
        with self.lock:
            p = self.get("global_sessions", sid, scope)
            if not p:
                raise KeyError("Unknown session")
            account = p.payload["account_id"]
            owner = self.get("account_centroids", account, scope)
            enrolled = owner.payload["enrolled"] if owner else []
            if sid not in enrolled:
                vector = (
                    normalize(
                        0.8 * np.asarray(owner.vector) + 0.2 * np.asarray(p.vector)
                    )
                    if owner
                    else p.vector
                )
                enrolled = [*enrolled, sid]
                self.put(
                    "account_centroids", account, scope, vector, {"enrolled": enrolled}
                )
            return {
                "session_id": sid,
                "account_id": account,
                "baseline_sessions_count": len(enrolled),
            }

    def ban(self, operator, scope="live"):
        with self.lock:
            if not self.get("banned_operators", operator, scope):
                vectors = [
                    p.vector
                    for p in self.scroll(
                        "global_sessions",
                        where(scope=scope, operator_id=operator),
                        True,
                    )
                ]
                if not vectors:
                    raise KeyError("Unknown operator")
                self.put(
                    "banned_operators",
                    operator,
                    scope,
                    normalize(np.mean(vectors, axis=0)),
                    {"operator_id": operator},
                )
            return {"operator_id": operator, "status": "confirmed"}

    def ban_by_id(self, operator):
        with self.lock:
            for scope in ("live", "synthetic"):
                if next(
                    self.scroll(
                        "global_sessions", where(scope=scope, operator_id=operator)
                    ),
                    None,
                ):
                    return self.ban(operator, scope)
            raise KeyError("Unknown operator")

    def rebuild_from(self, previous, recordings):
        """Re-embed consented observations and preserve decisions, enrollments and bans."""
        for old in previous.scroll("global_sessions", vectors=True):
            row = old.payload
            scope, sid = row["scope"], row["session_id"]
            payload = recordings.get((scope, sid))
            if payload is None or payload_digest(payload) != row["digest"]:
                raise Conflict(
                    "Rebuilding this index requires the matching consented recording for every live session"
                )
            vector = self.model.embed([extract(payload)])[0]
            self.put(
                "global_sessions",
                sid,
                scope,
                vector,
                {
                    **row,
                    "projection": self.projector.point(vector),
                    "original_fingerprint": row.get("original_fingerprint")
                    or vector_digest(old.vector),
                },
            )
        for owner in previous.scroll("account_centroids"):
            for sid in owner.payload["enrolled"]:
                self.enroll(sid, owner.payload["scope"])
        for ban in previous.scroll("banned_operators"):
            self.ban(ban.payload["operator_id"], ban.payload["scope"])

    def population_map(self):
        with self.lock:
            points, groups = [], {}
            banned = {p.payload["operator_id"] for p in self.scroll("banned_operators")}
            for p in self.scroll("global_sessions"):
                row = p.payload
                pt = row.get("projection") or row["result"]["map_point"]
                points.append(
                    {
                        **pt,
                        **{
                            k: row[k]
                            for k in ("session_id", "account_id", "operator_id")
                        },
                        "synthetic": row["scope"] == "synthetic",
                        "status": "BANNED"
                        if row["operator_id"] in banned
                        else row["status"],
                    }
                )
                if pt["cluster_id"] >= 0:
                    groups.setdefault(pt["cluster_id"], []).append([pt["x"], pt["y"]])
            clusters = []
            for cid, coords in groups.items():
                x, y = np.mean(coords, axis=0)
                clusters.append(
                    dict(cluster_id=cid, x=float(x), y=float(y), size=len(coords))
                )
            return {"points": points, "clusters": clusters}
