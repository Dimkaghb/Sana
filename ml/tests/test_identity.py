import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from ml.app import create_app
from ml.features import InsufficientEvidence, extract
from ml.seed_population import session
from ml.train import fit
from scripts.validate_contracts import validate_payload, validators


class FeatureTests(unittest.TestCase):
    def test_no_identity_or_amount_inputs(self):
        payload = session(0, 0)
        first = extract(payload)
        payload.update(
            account_id="different",
            session_id="changed",
            transfer_context={"amount_kzt": 1, "is_new_recipient": False},
        )
        other = extract(payload)
        np.testing.assert_equal(first.stats, other.stats)
        np.testing.assert_equal(first.sequence, other.sequence)
        np.testing.assert_equal(first.windows, other.windows)
        self.assertEqual(first.windows.shape, (64, 6))
        self.assertEqual(first.stats.shape, (36,))
        self.assertEqual(first.sequence.shape, (64, 6))

    def test_missing_and_inadequate(self):
        payload = session(1, 1)
        payload["imu_samples"] = []
        payload["device_meta"]["sample_rate_hz"] = 0
        feat = extract(payload)
        self.assertTrue(np.all(np.isnan(feat.stats[22:])))
        self.assertTrue(np.all(np.isnan(feat.sequence[:, 2:])))
        for key in ("taps", "keystrokes", "slider_trace"):
            payload[key] = []
        with self.assertRaises(InsufficientEvidence):
            extract(payload)


class IdentityApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.model = Path(cls.temporary.name) / "model"
        records = [(p, session(p, s)) for p in range(4) for s in range(3)]
        fit(cls.model, records, "synthetic", epochs=4)
        cls.checks = validators()

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.headers = {"Authorization": "Bearer test-operator"}

    def open(self):
        return TestClient(
            create_app(self.model, self.temp.name, False, "test-operator")
        )

    def test_new_contact_windows_enter_the_embedding(self):
        sample = session(1, 9)
        old = extract(sample)
        sample["contacts"] = [
            dict(
                down_ms=300,
                up_ms=580,
                field="review",
                pointer_type="touch",
                is_trusted=True,
            )
        ]
        new = extract(sample)
        np.testing.assert_equal(old.stats, new.stats)
        np.testing.assert_equal(old.sequence, new.sequence)
        self.assertFalse(np.array_equal(old.windows, new.windows, equal_nan=True))
        with self.open() as http:
            vectors = http.app.state.store.model.embed([old, new])
            self.assertEqual(vectors.shape, (2, 128))
            self.assertGreater(np.linalg.norm(vectors[0] - vectors[1]), 1e-5)
            np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-5)

    def test_persisted_retry_enrollment_ring_and_ban(self):
        raw = session(0, 8)
        score_path = "/ml/embed-and-score"
        with self.open() as http:
            for i in range(3):
                payload = {**raw, "session_id": f"approved_{i}"}
                result = http.post(score_path, json=payload).json()
                self.assertEqual(validate_payload("B", result, self.checks), [])
                self.assertEqual(
                    result["owner_verification"]["baseline_sessions_count"], i
                )
                if i == 0:
                    self.assertIsNone(result["owner_verification"]["cosine_similarity"])
                    self.assertIsNone(
                        result["operator_reconciliation"]["match_confidence"]
                    )
                enroll = f"/ml/sessions/approved_{i}/enroll"
                self.assertEqual(http.post(enroll).status_code, 403)
                for _ in range(2):
                    self.assertEqual(
                        http.post(enroll, headers=self.headers).json()[
                            "baseline_sessions_count"
                        ],
                        i + 1,
                    )
            http.post(
                score_path, json={**raw, "session_id": "pending"}
            ).raise_for_status()
            crossing = {**raw, "session_id": "cross", "account_id": "another"}
            result = http.post(score_path, json=crossing).json()
            route = "/ml/sessions/cross/fingerprint"
            self.assertEqual(http.get(route).status_code, 403)
            fingerprint = http.get(route, headers=self.headers).json()[
                "operator_fingerprint"
            ]
            self.assertRegex(fingerprint, r"^[0-9a-f]{64}$")
            page = http.get("/ml/population-page").json()
            self.assertIsNone(page["next"])
            self.assertEqual(len(page["points"]), 5)
            store = http.app.state.store
            page1 = store.population_page(None, limit=2)
            page2 = store.population_page(page1["next"], limit=2)
            self.assertTrue(
                {p["session_id"] for p in page1["points"]}.isdisjoint(
                    {p["session_id"] for p in page2["points"]}
                )
            )
            self.assertEqual(
                http.post(
                    "/ml/sessions/cross/enroll", headers=self.headers
                ).status_code,
                409,
            )
            rec = result["operator_reconciliation"]
            self.assertEqual(rec["ring_size"], 2)
            self.assertGreater(rec["match_confidence"], 0.99)
            ban = "/ml/operators/" + rec["matched_operator_id"] + "/ban"
            self.assertEqual(http.post(ban).status_code, 403)
            for _ in range(2):
                self.assertEqual(
                    http.post(ban, headers=self.headers).json()["status"], "confirmed"
                )
        with self.open() as http:
            self.assertEqual(
                http.get(route, headers=self.headers).json()["operator_fingerprint"],
                fingerprint,
            )
            self.assertEqual(http.post(score_path, json=crossing).json(), result)
            self.assertEqual(
                http.post(
                    score_path, json={**crossing, "account_id": "other"}
                ).status_code,
                409,
            )
            arrival = http.post(
                score_path, json={**raw, "session_id": "entry", "account_id": "fresh"}
            ).json()
            self.assertTrue(arrival["operator_reconciliation"]["is_banned_operator"])
            self.assertEqual(
                arrival["owner_verification"]["baseline_sessions_count"], 0
            )
            self.assertEqual(
                http.post(
                    "/ml/sessions/pending/enroll", headers=self.headers
                ).status_code,
                409,
            )
            self.assertEqual(
                http.post(
                    "/ml/sessions/approved_0/enroll", headers=self.headers
                ).json()["baseline_sessions_count"],
                3,
            )
            self.assertEqual(len(http.get("/ml/population-map").json()["points"]), 6)

    def test_invalid_payloads_and_empty_evidence(self):
        raw = session(0, 8)
        with self.open() as http:
            for payload in (
                {"bad": 1},
                {**raw, "keystrokes": [{**raw["keystrokes"][0], "text": "unwanted"}]},
                {
                    **raw,
                    **{
                        k: []
                        for k in ["keystrokes", "imu_samples", "taps", "slider_trace"]
                    },
                    "device_meta": {**raw["device_meta"], "sample_rate_hz": 0},
                },
            ):
                self.assertEqual(
                    http.post("/ml/embed-and-score", json=payload).status_code, 422
                )
            self.assertEqual(
                http.post("/ml/embed-and-score", content=b"a" * 2097153).status_code,
                413,
            )
            self.assertEqual(
                http.post("/ml/embed-and-score", content=b'{"x":1,"x":2}').status_code,
                422,
            )
            self.assertEqual(http.get("/ml/population-map").json()["points"], [])

    def test_retraining_preserves_decisions_fingerprints_and_enrollment(self):
        dataset = Path(self.temp.name) / "consented"
        dataset.mkdir()
        rows = []
        for person in range(3):
            for take in range(3):
                payload = session(person, take)
                filename = f"{person}-{take}.json"
                (dataset / filename).write_text(json.dumps(payload))
                rows.append(
                    {
                        "file": filename,
                        "operator_id": f"participant_{person}",
                        "split": "train",
                    }
                )
        manifest = dataset / "manifest.json"
        manifest.write_text(json.dumps(rows))
        payload = session(0, 0)
        with (
            patch.dict(os.environ, {"ML_CALIBRATION_MANIFEST": str(manifest)}),
            self.open() as http,
        ):
            original = http.post("/ml/embed-and-score", json=payload).json()
            sid = payload["session_id"]
            fp = f"/ml/sessions/{sid}/fingerprint"
            digest = http.get(fp, headers=self.headers).json()
            http.post(
                f"/ml/sessions/{sid}/enroll", headers=self.headers
            ).raise_for_status()
            op = original["operator_reconciliation"]["matched_operator_id"]
            http.post(
                f"/ml/operators/{op}/ban", headers=self.headers
            ).raise_for_status()
            http.post("/ml/retrain", headers=self.headers).raise_for_status()
        with self.open() as http:
            self.assertEqual(
                http.post("/ml/embed-and-score", json=payload).json(), original
            )
            self.assertEqual(http.get(fp, headers=self.headers).json(), digest)
            future = http.post(
                "/ml/embed-and-score", json={**payload, "session_id": "after_retrain"}
            ).json()
            self.assertEqual(future["owner_verification"]["baseline_sessions_count"], 1)
            self.assertTrue(future["operator_reconciliation"]["is_banned_operator"])

    def test_embedding_and_handoff(self):
        raw = session(0, 6)
        with self.open() as http:
            for i in range(3):
                sample = {**raw, "session_id": f"owner{i}"}
                http.post("/ml/embed-and-score", json=sample).raise_for_status()
                http.post(
                    f"/ml/sessions/owner{i}/enroll", headers=self.headers
                ).raise_for_status()
            other = {**session(3, 7), "account_id": raw["account_id"]}
            result = http.post("/ml/embed-and-score", json=other).json()
            verified = result["owner_verification"]
            self.assertEqual(verified["baseline_sessions_count"], 3)
            self.assertTrue(verified["is_handoff_detected"], verified)
            sid = other["session_id"]
            self.assertEqual(
                http.post(
                    f"/ml/sessions/{sid}/enroll", headers=self.headers
                ).status_code,
                409,
            )


if __name__ == "__main__":
    unittest.main()
