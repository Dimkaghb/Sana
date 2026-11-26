"""Start a fresh, local rehearsal using the installed environments and built web app."""
import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import secrets
import socket
import signal
import subprocess
import sys
import tempfile
import time
from urllib.request import ProxyHandler, build_opener
from urllib.error import URLError

from scripts.stage import ROOT


def stop(process):
    if process.poll() is None:
        process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def ready(process, url, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    opener = build_opener(ProxyHandler({}))
    while process.poll() is None and time.monotonic() < deadline:
        try:
            with opener.open(url, timeout=1) as response:
                return json.load(response)
        except (TimeoutError, URLError):
            time.sleep(.25)
    raise SystemExit("Service failed to become ready. Check dependencies and available ports.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=("live", "mock"))
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--ml-port", type=int, default=8001)
    args = parser.parse_args()
    if not (ROOT / "frontend/dist/index.html").exists():
        parser.error("Run npm ci and npm run build in frontend first.")
    if args.mode == "live" and not (ROOT / "ml/.venv/bin/python").is_file():
        parser.error("Install the ML environment using ml/README.md.")
    # Reserve the intended ports before creating a rehearsal or probing readiness.
    ports = [args.port, args.ml_port] if args.mode == "live" else [args.port]
    with ExitStack() as checks:
        for port in ports:
            if not 1 <= port <= 65535:
                parser.error("Port must be in 1..65535.")
            probe = checks.enter_context(socket.socket())
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                parser.error(f"Loopback port {port} is unavailable.")

    staging = ROOT / "backend/data/rehearsals"
    staging.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="demo-", dir=staging))
    accounts = ("acc_student_101", "acc_victim_409", "acc_drop_772")
    guardians = {name: secrets.token_urlsafe(24) for name in accounts}
    analyst = secrets.token_urlsafe(24)
    credentials = run / "access.json"
    with os.fdopen(
        os.open(credentials, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w"
    ) as f:
        json.dump({"analyst": analyst, "guardians": guardians}, f, indent=2)

    origin = f"http://127.0.0.1:{args.port}"
    identity = f"http://127.0.0.1:{args.ml_port}"
    env = dict(os.environ, ML_MODE=args.mode, SANA_DB=str(run / "sessions.sqlite"),
               ML_DATA_DIR=str(run / "identity"), ML_ADMIN_TOKEN=secrets.token_urlsafe(32),
               ML_SERVICE_URL=identity, SANA_ALLOWED_ORIGINS=origin, SANA_ADMIN_TOKEN=analyst,
               SANA_GUARDIAN_TOKENS=json.dumps(guardians))
    # A fresh local rehearsal uses only its own identity store and synthetic model.
    for inherited in ("ML_QDRANT_URL", "ML_QDRANT_API_KEY", "ML_CALIBRATION_MANIFEST", "SANA_CALIBRATION_DIR"):
        env.pop(inherited, None)
    env["ML_MODEL_DIR"] = str(ROOT / "ml/artifacts/synthetic-v1")
    env["ML_SEED_POPULATION"] = "1"

    def terminate(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, terminate)
    with ExitStack() as processes:
        def start(python, app, port, *extra):
            child = subprocess.Popen([str(python), "-m", "uvicorn", app, "--host", "127.0.0.1",
                                      "--port", str(port), "--no-access-log", *extra], env=env, cwd=ROOT)
            processes.callback(stop, child)
            return child

        workers = []
        if args.mode == "live":
            print("Preparing the local identity model and population map…", flush=True)
            ml = start(ROOT / "ml/.venv/bin/python", "ml.app:app", args.ml_port)
            ready(ml, identity + "/health", timeout_seconds=600)
            workers.append(ml)
        backend = start(sys.executable, "scripts.stage:local_app", args.port, "--factory")
        ready(backend, origin + "/ready", timeout_seconds=30)
        workers.append(backend)
        print(f"Dashboard: {origin}/dashboard\nMobile: {origin}/mobile\nGuardian: {origin}/guardian"
              f"\nLocal demo credentials: {credentials}\nCtrl-C stops this rehearsal.", flush=True)
        while all(worker.poll() is None for worker in workers):
            time.sleep(.5)
        raise SystemExit("A rehearsal service exited.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
