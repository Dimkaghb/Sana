"""Build an immutable, local model generation including its fitted projection."""

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

import joblib
import numpy as np
import torch

from .encoder import Encoder, train
from .features import extract
from .map_projector import MapProjector
from .seed_population import session


def fit(directory, records, source, epochs=35, initial=None, attention=False):
    directory = Path(directory)
    directory.parent.mkdir(parents=True, exist_ok=True)
    if directory.exists():
        raise FileExistsError(f"Choose a new model directory: {directory}")
    labels, payloads = zip(*records)
    if len(payloads) < 5:
        raise ValueError("Projection needs at least five training sessions")
    features = [extract(p) for p in payloads]
    model = train(features, labels, epochs, initial, attention)
    vectors = model.embed(features)
    projector = MapProjector(vectors)
    with tempfile.TemporaryDirectory(dir=directory.parent) as staging:
        bundle = Path(staging) / "bundle"
        bundle.mkdir()
        torch.save(model.state_dict(), bundle / "encoder.pt")
        joblib.dump(projector, bundle / "projector.joblib", compress=3)
        digest = hashlib.sha256()
        for name in ("encoder.pt", "projector.joblib"):
            digest.update((bundle / name).read_bytes())
        (bundle / "manifest.json").write_text(
            json.dumps(
                {
                    "id": digest.hexdigest(),
                    "source": source,
                    "training_sessions": len(features),
                    "operators": len(set(labels)),
                    "epochs": epochs,
                    "attention": attention,
                    "window_version": 1,
                    "training_session_ids": [p["session_id"] for p in payloads],
                },
                indent=2,
            )
        )
        os.rename(bundle, directory)
    return model, projector


def load(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    digest = hashlib.sha256()
    for name in ("encoder.pt", "projector.joblib"):
        digest.update((directory / name).read_bytes())
    if manifest["id"] != digest.hexdigest():
        raise ValueError("Model artifact checksum mismatch")
    model = Encoder(
        manifest.get("attention", False), windowed=manifest.get("window_version") == 1
    )
    model.load_state_dict(
        torch.load(directory / "encoder.pt", weights_only=True, map_location="cpu")
    )
    projector = joblib.load(directory / "projector.joblib")
    # Trigger the compiled UMAP transform before readiness.
    vector = np.roll(projector.reference[0], 1)
    projector.point(vector)
    return model.eval(), projector, manifest


def synthetic_training():
    records = []
    for person in range(18):
        for i in range(20, 26):
            payload = session(person, i)
            # Simulate both SDK versions in the labeled synthetic training set.
            if i % 2 == 0:
                payload["contacts"] = [
                    dict(
                        down_ms=k["down_ms"],
                        up_ms=k["up_ms"],
                        field="recipient",
                        pointer_type="touch",
                        is_trusted=True,
                    )
                    for k in payload["keystrokes"]
                ]
            records.append((person, payload))
    return records


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="ml/artifacts/synthetic-v2")
    parser.add_argument("--epochs", type=int, default=35)
    parser.add_argument("--attention", action="store_true")
    args = parser.parse_args()
    fit(
        args.output,
        synthetic_training(),
        "synthetic",
        args.epochs,
        attention=args.attention,
    )
    print(f"Saved trained synthetic model to {args.output}")
