"""Local participant manifests keep identities, raw files and split membership out of Git."""
import json
from pathlib import Path

from scripts.validate_contracts import load_json, validate_payload, validators


def read_manifest(filename, split):
    path = Path(filename).resolve()
    rows = json.loads(path.read_text())
    checks, result, seen = validators(), [], set()
    for row in rows:
        if row["split"] not in ("train","enroll","eval"):
            raise ValueError("Each row needs an explicit train, enroll, or eval split")
        file = (path.parent/row["file"]).resolve()
        if not file.is_relative_to(path.parent):
            raise ValueError("Session file must be inside the manifest directory")
        payload = load_json(file)
        if payload["session_id"] in seen:
            raise ValueError("Repeated session ID across dataset splits")
        seen.add(payload["session_id"])
        if row["split"] == split:
            if validate_payload("A",payload,checks):
                raise ValueError(f"Invalid Contract A file: {file.name}")
            result.append((row["operator_id"],payload))
    if not result:
        raise ValueError(f"No sessions in {split} split")
    return result
