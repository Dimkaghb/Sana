"""Fine-tune a new generation from the training split of a consented local dataset."""

import argparse
from pathlib import Path

from .dataset import read_manifest
from .train import fit


def calibrate(manifest, output, initial, epochs=20, attention=False):
    return fit(
        output,
        read_manifest(manifest, "train"),
        "participant-training",
        epochs,
        Path(initial) / "encoder.pt",
        attention,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("--initial", default="ml/artifacts/synthetic-v2")
    parser.add_argument("--output", required=True)
    parser.add_argument("--attention", action="store_true")
    args = parser.parse_args()
    calibrate(args.manifest, args.output, args.initial, attention=args.attention)
