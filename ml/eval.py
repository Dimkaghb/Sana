"""Session-disjoint evaluation against labeled enrollment examples."""

import argparse
import json
from time import perf_counter

import numpy as np
from sklearn.metrics import roc_auc_score, roc_curve

from .dataset import read_manifest
from .features import extract
from .seed_population import session
from .train import load


def evaluate(model, enrolled, queries):
    gallery = model.embed([extract(p) for _, p in enrolled])
    targets, scores, latency, hits = [], [], [], []
    for operator, payload in queries:
        start = perf_counter()
        vector = model.embed([extract(payload)])[0]
        latency.append((perf_counter() - start) * 1000)
        sim = gallery @ vector
        targets.extend([label == operator for label, _ in enrolled])
        scores.extend(sim.tolist())
        eligible = [
            i
            for i, (_, p) in enumerate(enrolled)
            if p["account_id"] != payload["account_id"]
        ]
        if any(enrolled[i][0] == operator for i in eligible):
            best = eligible[np.argmax(sim[eligible])]
            hits.append(enrolled[best][0] == operator)
    if len(set(targets)) < 2:
        raise ValueError("Evaluation needs genuine and impostor pairs")
    fpr, tpr, _ = roc_curve(targets, scores)
    fnr = 1 - tpr
    i = int(np.argmin(np.abs(fpr - fnr)))
    return dict(
        enrollment_sessions=len(enrolled),
        evaluation_sessions=len(queries),
        pairs=len(scores),
        roc_auc=float(roc_auc_score(targets, scores)),
        empirical_eer_percent=float(50 * (fpr[i] + fnr[i])),
        cross_account_queries=len(hits),
        cross_account_recall_at_1=float(np.mean(hits)) if hits else None,
        feature_and_encoder_p95_ms=float(np.percentile(latency, 95)),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="ml/artifacts/synthetic-v2")
    parser.add_argument("--manifest")
    args = parser.parse_args()
    model, _, manifest = load(args.model)
    if args.manifest:
        enrolled = read_manifest(args.manifest, "enroll")
        queries = read_manifest(args.manifest, "eval")
    else:
        enrolled = [(p, session(p, 31)) for p in range(18)]
        queries = [(p, session(p, 32)) for p in range(18)]
    ids = [p["session_id"] for _, p in enrolled + queries]
    if len(ids) != len(set(ids)) or set(ids).intersection(
        manifest["training_session_ids"]
    ):
        raise ValueError("Session overlap with training or enrollment")
    print(
        json.dumps(
            {
                "data": "participant" if args.manifest else "synthetic",
                **evaluate(model, enrolled, queries),
            },
            indent=2,
        )
    )
