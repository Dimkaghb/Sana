"""Local, single-worker demonstration settings."""

import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Policy:
    version: str = "demo-3"
    recoil_floor: float = 0.08
    hold_threshold: int = 75
    step_up_threshold: int = 50
    handoff_amount: int = 100_000
    ring_confidence: float = 0.80


@dataclass(frozen=True)
class Settings:
    mode: str
    database: str
    ml_url: str = "http://127.0.0.1:8001"
    origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    admin_token: str = ""
    ml_token: str = ""
    guardian_tokens: dict[str, str] = field(default_factory=dict)
    policy: Policy = field(default_factory=Policy)

    calibration_dir: Path | None = None

    fixture_access: bool = False

    @classmethod
    def from_env(cls):
        mode = os.getenv("ML_MODE")
        if mode not in {"mock", "live"}:
            raise ValueError("Select ML_MODE=mock or ML_MODE=live")
        defaults = cls(mode, str(Path(__file__).parent / "data/demo.sqlite3"))
        guardians = json.loads(os.getenv("SANA_GUARDIAN_TOKENS", "{}"))
        if not isinstance(guardians, dict) or not all(
            isinstance(v, str) and v for v in guardians.values()
        ):
            raise ValueError(
                "SANA_GUARDIAN_TOKENS requires a JSON account-to-token object"
            )
        admin = os.getenv("SANA_ADMIN_TOKEN", "")
        if (
            len(set(guardians.values())) != len(guardians)
            or admin in guardians.values()
        ):
            raise ValueError("Each role and Guardian account needs a distinct token")
        recoil = float(os.getenv("SANA_RECOIL_FLOOR", "0.08"))
        if not math.isfinite(recoil) or recoil <= 0:
            raise ValueError("SANA_RECOIL_FLOOR must be finite and positive")
        policy = Policy(
            version=os.getenv("SANA_POLICY_VERSION", Policy().version),
            recoil_floor=recoil,
            hold_threshold=int(os.getenv("SANA_HOLD_THRESHOLD", "75")),
            step_up_threshold=int(os.getenv("SANA_STEP_UP_THRESHOLD", "50")),
            handoff_amount=int(os.getenv("SANA_HANDOFF_AMOUNT", "100000")),
            ring_confidence=float(os.getenv("SANA_RING_CONFIDENCE", "0.80")),
        )
        if not (0 <= policy.step_up_threshold <= policy.hold_threshold <= 100
                and 0 <= policy.ring_confidence <= 1 and policy.handoff_amount >= 0
                and policy.version.strip()):
            raise ValueError("Invalid demo risk policy thresholds or version")
        origins = tuple(
            x.strip()
            for x in os.getenv(
                "SANA_ALLOWED_ORIGINS", ",".join(defaults.origins)
            ).split(",")
        )
        if "*" in origins or "" in origins:
            raise ValueError("Specify exact frontend origins")
        directory = os.getenv("SANA_CALIBRATION_DIR")
        recording_dir = Path(directory).resolve() if directory else None
        if recording_dir and not recording_dir.is_relative_to(
            (Path(__file__).parent / "data").resolve()
        ):
            raise ValueError("Calibration directory must be under backend/data")
        return cls(
            mode,
            os.getenv("SANA_DB", defaults.database),
            os.getenv("ML_SERVICE_URL", defaults.ml_url).rstrip("/"),
            origins,
            admin,
            os.getenv("ML_ADMIN_TOKEN", ""),
            guardians,
            policy,
            recording_dir,
        )
