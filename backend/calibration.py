"""Optional local, per-session consented recording for a supervised calibration."""

import hashlib
import os
import tempfile
from pathlib import Path


def save_recording(directory: Path, session: str, encoded: bytes):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = hashlib.sha256(session.encode()).hexdigest() + ".json"
    target = directory / name
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as pending:
        try:
            pending.write(encoded)
            pending.flush()
            os.fsync(pending.fileno())
            # Publish a complete recording without replacing an existing session.
            try:
                os.link(pending.name, target)
            except FileExistsError:
                if target.read_bytes() != encoded:
                    raise ValueError("Conflicting recording") from None
        finally:
            os.unlink(pending.name)
    return name
