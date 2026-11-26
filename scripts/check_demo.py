"""Exercise the actual demo server over loopback with disposable SQLite state."""
import asyncio
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
from time import perf_counter
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from websockets.asyncio.client import connect

from scripts.validate_contracts import FIXTURES, ROOT, load_json, validate_payload, validators


def fixture_app():
    """Legacy fixture protocol, served only by this isolated loopback test."""
    from dataclasses import replace
    from backend.config import Settings
    from backend.main import create_app

    return create_app(replace(Settings.from_env(), fixture_access=True))


@asynccontextmanager
async def server(directory, *, mode="mock", ml_url="http://127.0.0.1:8001", ml_token=""):
    # Hand the bound socket directly to Uvicorn, keeping the port reserved.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        port = listener.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        token = secrets.token_urlsafe()
        env = dict(os.environ, ML_MODE=mode, ML_SERVICE_URL=ml_url, ML_ADMIN_TOKEN=ml_token,
                   SANA_DB=str(directory / "sessions.sqlite"),
                   SANA_ALLOWED_ORIGINS=origin, SANA_ADMIN_TOKEN=token, SANA_GUARDIAN_TOKENS="{}")
        # Verify the default policy independently of the operator’s active configuration.
        for key in ("SANA_RECOIL_FLOOR", "SANA_POLICY_VERSION", "SANA_STEP_UP_THRESHOLD",
                    "SANA_HOLD_THRESHOLD", "SANA_HANDOFF_AMOUNT", "SANA_RING_CONFIDENCE",
                    "SANA_CALIBRATION_DIR"):
            env.pop(key, None)
        child = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "scripts.check_demo:fixture_app", "--factory", "--fd", str(listener.fileno()),
             "--log-level", "warning", "--no-access-log"],
            pass_fds=(listener.fileno(),), env=env, cwd=ROOT,
        )
        try:
            async with httpx.AsyncClient(base_url=origin, trust_env=False, timeout=4) as client:
                for _ in range(100):
                    if child.poll() is not None:
                        raise RuntimeError("Demo process exited during startup")
                    try:
                        ready = await client.get("/ready")
                        if ready.is_success:
                            break
                    except (httpx.ConnectError, httpx.TimeoutException):
                        pass
                    await asyncio.sleep(.1)
                else:
                    raise TimeoutError("Timed out waiting for demo readiness")
                yield client, origin, token
        finally:
            child.send_signal(signal.SIGINT)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


async def verify(directory):
    checks = validators()
    expected = {}
    async with server(directory) as (client, origin, token):
        async with connect(origin.replace("http:", "ws:") + "/ws/dashboard", origin=origin) as dashboard:
            for scenario in load_json(FIXTURES / "manifest.json")["scenarios"]:
                files = scenario["contracts"]
                payload = load_json(FIXTURES / files["A"])
                expected_mode = load_json(FIXTURES / files["D"])["ui_mode"]
                route = "/api/v1/sessions/ingest"
                started = perf_counter()
                response = await client.post(route, json=payload)
                elapsed_ms = (perf_counter() - started) * 1000
                response.raise_for_status()
                decision = response.json()
                event = json.loads(await asyncio.wait_for(dashboard.recv(), 5))
                assert not validate_payload("C", event, checks)
                assert not validate_payload("D", decision, checks)
                session = payload["session_id"]
                assert session == event["session_id"] == decision["session_id"]
                assert event["decision"] == decision["ui_mode"] == expected_mode, scenario["name"]
                assert (await client.post(route, json=payload)).json() == decision
                expected[session] = decision
                if scenario["name"] == "normal":
                    payload["transfer_context"]["amount_kzt"] += 1
                    assert (await client.post(route, json=payload)).status_code == 409
                dossier = await client.get(f"/api/v1/cases/{session}/export-antifraud",
                                           headers={"Authorization": f"Bearer {token}"})
                dossier.raise_for_status()
                assert dossier.json()["case_id"] == decision["reference_code"]
                physics_ms = dossier.json()["physics_ms"]
                print(f'{scenario["name"]}: {expected_mode} (HTTP {elapsed_ms:.1f} ms, physics {physics_ms:.2f} ms)')
    async with server(directory) as (client, _, _):
        snapshot = (await client.get("/api/v1/dashboard/init")).json()
        ids = [event["session_id"] for event in snapshot["events"]]
        assert sorted(ids) == sorted(expected)
        first = load_json(FIXTURES / "normal/telemetry.json")
        assert (await client.post("/api/v1/sessions/ingest", json=first)).json() == expected[first["session_id"]]
    print("HTTP decisions, WebSocket events, retry, conflict, dossiers and restart verified.")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        asyncio.run(verify(Path(temp)))
