"""Run the backend against an isolated, real identity service using a prepared model."""
import argparse
import asyncio
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import tempfile

import httpx

from scripts.check_demo import server
from scripts.validate_contracts import FIXTURES, ROOT, load_json


async def exercise(directory, identity_url, token):
    payload = load_json(FIXTURES / "normal/telemetry.json")
    async with server(directory, mode="live", ml_url=identity_url, ml_token=token) as (bank, _, analyst):
        async def submit(session, account):
            data = dict(payload, session_id=session, account_id=account)
            response = await bank.post("/api/v1/sessions/ingest", json=data)
            response.raise_for_status()
            return response.json()

        # These repeated synthetic measurements exercise the integration deterministically.
        for index in range(3):
            session = f"check_enroll_{index}"
            decision = await submit(session, "acc_example_owner")
            assert decision["ui_mode"] == "STEP_UP_LIVENESS", decision
            enrollment = await bank.post(f"/api/v1/sessions/{session}/enroll",
                                         headers={"Authorization": f"Bearer {analyst}"},
                                         json={"owner_verified": True})
            enrollment.raise_for_status()
            assert enrollment.json()["baseline_sessions_count"] == index + 1

        assert (await submit("check_verified", "acc_example_owner"))["ui_mode"] == "SUCCESS"
        assert (await submit("check_ring", "acc_example_other"))["ui_mode"] == "MIRAGE_HOLD"
        dashboard = (await bank.get("/api/v1/dashboard/init")).json()
        ring = next(e for e in dashboard["events"] if e["session_id"] == "check_ring")
        assert any(f["code"] == "DROPPER_RING_MATCH" for f in ring["flags"])
        operator = ring["map_point"]["operator_id"]
        result = await bank.post(f"/api/v1/operators/{operator}/ban",
                                 headers={"Authorization": f"Bearer {analyst}"})
        result.raise_for_status()
        await submit("check_reentry", "acc_example_new")
        events = (await bank.get("/api/v1/dashboard/init")).json()["events"]
        reentry = next(e for e in events if e["session_id"] == "check_reentry")
        assert any(f["code"] == "BANNED_OPERATOR" for f in reentry["flags"])
        assert reentry["decision"] == "MIRAGE_HOLD"
        print("Verified live HTTP scoring, three supervised enrollments, owner success, ring, ban and re-entry.")


async def main(interpreter, model):
    if not (model / "manifest.json").is_file():
        raise SystemExit("Prepare the trained ML model before running this check.")
    with tempfile.TemporaryDirectory() as temp, socket.socket() as listener:
        directory = Path(temp)
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        url = f"http://127.0.0.1:{listener.getsockname()[1]}"
        token = secrets.token_urlsafe()
        env = dict(os.environ, ML_DATA_DIR=str(directory / "identity"), ML_MODEL_DIR=str(model.resolve()),
                   ML_SEED_POPULATION="0", ML_ADMIN_TOKEN=token)
        for key in ("ML_QDRANT_URL", "ML_QDRANT_API_KEY", "ML_CALIBRATION_MANIFEST"):
            env.pop(key, None)
        child = subprocess.Popen(
            [str(interpreter.absolute()), "-m", "uvicorn", "ml.app:app", "--fd", str(listener.fileno()),
             "--log-level", "warning", "--no-access-log"],
            cwd=ROOT, env=env, pass_fds=(listener.fileno(),),
        )
        try:
            async with httpx.AsyncClient(base_url=url, trust_env=False, timeout=5) as client:
                for _ in range(300):
                    if child.poll() is not None:
                        raise RuntimeError("Identity service exited during startup")
                    try:
                        response = await client.get("/health", timeout=.3)
                        if response.is_success:
                            break
                    except httpx.TransportError:
                        pass
                    await asyncio.sleep(.2)
                else:
                    raise TimeoutError("Identity service startup timed out")
                await exercise(directory, url, token)
        finally:
            child.send_signal(signal.SIGINT)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-python", type=Path, default=ROOT/"ml/.venv/bin/python")
    parser.add_argument("--model", type=Path, default=ROOT/"ml/artifacts/synthetic-v2")
    args = parser.parse_args()
    asyncio.run(main(args.ml_python, args.model))
