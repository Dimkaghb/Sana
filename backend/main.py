"""Run from the repository root with ML_MODE set and one ASGI worker."""

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from scripts.validate_contracts import (
    reject_constant,
    unique_object,
    validate_payload,
    validators,
)

from .calibration import save_recording
from .coercion_engine import analyze_coercion
from .config import Settings
from .ml_client import IdentityService
from .physics_engine import analyze_tap_recoil, flag
from .risk_fusion import decide
from .storage import Store

BODY_LIMIT = 1_048_576
COLLECTION_LIMITS = {
    "imu_samples": 4096,
    "slider_trace": 2048,
    "taps": 512,
    "keystrokes": 512,
}
DISPLAY = {
    "SUCCESS": ("Перевод выполнен", "Демонстрационный перевод завершён."),
    "MIRAGE_HOLD": ("Межбанковская обработка", "Проверяем реквизиты получателя."),
    "STEP_UP_LIVENESS": ("Подтвердите перевод", "Требуется дополнительная проверка."),
}


async def read_json(request, limit=BODY_LIMIT):
    if (
        request.headers.get("content-type", "").split(";")[0].strip().lower()
        != "application/json"
    ):
        raise HTTPException(415, "Expected application/json")
    body = bytearray()
    async for chunk in request.stream():
        if len(chunk) + len(body) > limit:
            raise HTTPException(413, "Payload exceeds size limit")
        body.extend(chunk)
    try:
        return json.loads(
            body, object_pairs_hook=unique_object, parse_constant=reject_constant
        )
    except (ValueError, RecursionError):
        raise HTTPException(422, "Invalid JSON object") from None


def supported_values(value):
    # Bound arithmetic before converting user-supplied numbers to sensor floats.
    if isinstance(value, (int, float)):
        return abs(value) <= 1e18
    if isinstance(value, str):
        # Python's JSON decoder accepts lone UTF-16 surrogates which SQLite rejects.
        value.encode("utf-8")
    if isinstance(value, dict):
        return all(supported_values(v) for v in value.values())
    if isinstance(value, list):
        return all(supported_values(v) for v in value)
    return True


def bearer(request):
    value = request.headers.get("authorization", "")
    return (
        value.removeprefix("Bearer ").encode() if value.startswith("Bearer ") else b""
    )


def create_app(settings=None, transport=None):
    @asynccontextmanager
    async def lifespan(app):
        config = settings or Settings.from_env()
        state = app.state
        state.config = config
        state.checks = validators()
        state.store = Store(config.database)
        state.lock = asyncio.Lock()
        state.dashboard = set()
        state.phones = {}
        state.guardians = {}
        try:
            async with httpx.AsyncClient(
                transport=transport, trust_env=False, timeout=1.5
            ) as client:
                state.ml = IdentityService(config, client, state.checks)
                yield
        finally:
            state.store.db.close()

    app = FastAPI(title="SANA Shield demo", lifespan=lifespan)
    origins = (
        settings.origins
        if settings
        else tuple(
            s.strip()
            for s in os.getenv(
                "SANA_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
        )
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "X-Calibration-Consent"],
    )

    def admin(request):
        token = app.state.config.admin_token
        if not token or not hmac.compare_digest(bearer(request), token.encode()):
            raise HTTPException(403, "Analyst authorization required")

    def guardian_account(supplied):
        for account, token in app.state.config.guardian_tokens.items():
            if supplied and hmac.compare_digest(supplied, token.encode()):
                return account
        raise HTTPException(403, "Guardian authorization required")

    async def broadcast(sockets, message):
        # Broadcast after commit. Slow clients reconnect and recover via init.
        async def send(ws):
            try:
                await asyncio.wait_for(ws.send_json(message), timeout=0.25)
            except (TimeoutError, RuntimeError, OSError, WebSocketDisconnect):
                sockets.discard(ws)
                try:
                    await ws.close(code=1013)
                except (RuntimeError, OSError, WebSocketDisconnect):
                    pass

        await asyncio.gather(*(send(ws) for ws in tuple(sockets)))

    async def notify(message):
        await broadcast(app.state.dashboard, message)

    async def refresh_guardian(account):
        sockets = app.state.guardians.get(account)
        if sockets:
            await broadcast(
                sockets,
                {
                    "type": "GUARDIAN_HOLDS",
                    "holds": app.state.store.guardian_holds(account),
                },
            )

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/ready")
    async def ready():
        app.state.store.db.execute("SELECT 1")
        return {"status": "ready", "ml_mode": app.state.config.mode}

    async def read_telemetry(request):
        telemetry = await read_json(request)
        if not isinstance(telemetry, dict):
            raise HTTPException(422, "Expected a Contract A object")
        for key, limit in COLLECTION_LIMITS.items():
            if isinstance(telemetry.get(key), list) and len(telemetry[key]) > limit:
                raise HTTPException(413, "Telemetry collection exceeds limit")
        state = app.state
        try:
            invalid = not supported_values(telemetry) or validate_payload(
                "A", telemetry, state.checks
            )
        except (RecursionError, OverflowError, ValueError):
            invalid = True
        if invalid:
            raise HTTPException(422, "Invalid Contract A telemetry")
        encoded = json.dumps(telemetry, sort_keys=True, separators=(",", ":")).encode()
        return telemetry, encoded

    @app.post("/api/v1/calibration/sessions")
    async def calibrate(request: Request):
        directory = app.state.config.calibration_dir
        if (
            directory is None
            or request.headers.get("X-Calibration-Consent") != "granted"
        ):
            raise HTTPException(403, "Local capture and per-session consent required")
        telemetry, encoded = await read_telemetry(request)
        try:
            name = save_recording(directory, telemetry["session_id"], encoded)
        except ValueError:
            raise HTTPException(409, "Conflicting recording") from None
        return {"recording": name}

    @app.post("/api/v1/sessions/ingest")
    async def ingest(request: Request):
        telemetry, encoded = await read_telemetry(request)
        session = telemetry["session_id"]
        digest = hashlib.sha256(encoded).hexdigest()
        state = app.state
        async with state.lock:
            row = state.store.session(session)
            if row:
                if row["digest"] != digest:
                    raise HTTPException(
                        409, "Session ID reused with different telemetry"
                    )
                return json.loads(row["decision"])
            policy = state.config.policy
            start = time.perf_counter()
            recoil = analyze_tap_recoil(telemetry, policy)
            coercion = analyze_coercion(telemetry)
            physics_ms = round((time.perf_counter() - start) * 1000, 3)
            ml = await state.ml.score(telemetry)
            mode = state.config.mode
            operator = ml["operator_reconciliation"] if ml else {}
            op_id = operator.get("matched_operator_id")
            if mode == "mock" and state.store.ban_status(op_id, mode) == "confirmed":
                operator["is_banned_operator"] = True
            outcome, scores, overall, flags = decide(
                telemetry, recoil, coercion, ml, policy
            )
            if mode == "mock":
                flags.append(
                    flag(
                        "MOCK_IDENTITY",
                        "INFO",
                        "Demo identity fixture",
                        "Identity evidence in this session uses the configured mock service.",
                    )
                )
            timestamp = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            point = None
            if ml and ml.get("map_point") and op_id:
                point = dict(
                    **ml["map_point"],
                    operator_id=op_id,
                    status={
                        "SUCCESS": "NORMAL",
                        "MIRAGE_HOLD": "CRITICAL",
                        "STEP_UP_LIVENESS": "WARNING",
                    }[outcome],
                )
            event = {
                "type": "SESSION_SCORED",
                "timestamp": timestamp,
                "session_id": session,
                "account_id": telemetry["account_id"],
                "account_label": telemetry["account_id"],
                "decision": outcome,
                "overall_risk_score": overall,
                "scores": scores,
                "flags": flags,
                "recoil_waveform": recoil.waveform,
                "map_point": point,
            }
            title, subtitle = DISPLAY[outcome]
            decision = {
                "session_id": session,
                "ui_mode": outcome,
                "display_title": title,
                "display_subtitle": subtitle,
                "reference_code": "BCC-" + secrets.token_hex(5).upper(),
                "guardian_notified": False,
            }
            if validate_payload("C", event, state.checks) or validate_payload(
                "D", decision, state.checks
            ):
                raise RuntimeError("Internal decision violated an output contract")
            amount = telemetry["transfer_context"]["amount_kzt"]
            dossier = {
                "case_id": decision["reference_code"],
                "simulated": True,
                "timestamp": timestamp,
                "ml_mode": mode,
                "policy": asdict(policy),
                "event": event,
                "physics_ms": physics_ms,
                "recoil": recoil.measurements,
                "coercion": coercion.measurements,
                "linked_account_ids": operator.get("linked_account_ids", []),
                "amount_kzt": amount,
            }
            ring = (
                op_id if any(f["code"] == "DROPPER_RING_MATCH" for f in flags) else None
            )
            inference = ml["inference_ms"] if mode == "live" and ml else None
            state.store.save(digest, event, decision, dossier, amount, inference, ring)
            await notify(event)
            if outcome == "MIRAGE_HOLD":
                await refresh_guardian(event["account_id"])
            return decision

    @app.get("/api/v1/dashboard/init")
    async def dashboard_init():
        state = app.state
        population = await state.ml.population()
        events, kpis = state.store.snapshot()
        return {
            "events": events,
            "kpis": kpis,
            "ml_mode": state.config.mode,
            "active_sessions": list(state.phones),
            "population_map": population,
        }

    @app.get("/api/v1/cases/{session}/export-antifraud")
    async def export_case(session: str, request: Request):
        admin(request)
        row = app.state.store.session(session)
        if not row:
            raise HTTPException(404, "Case not found")
        dossier = json.loads(row["dossier"])
        if (
            dossier["ml_mode"] == "live"
            and dossier["event"].get("map_point")
            and app.state.config.mode == "live"
        ) and not dossier.get("operator_fingerprint"):
            fingerprint = await app.state.ml.fingerprint(session)
            if fingerprint:
                dossier["operator_fingerprint"] = fingerprint
                app.state.store.cache_fingerprint(session, fingerprint)
        dossier["guardian"] = {
            "acknowledged": bool(row["acknowledged"]),
            "frozen": bool(row["frozen"]),
        }
        return JSONResponse(
            dossier,
            headers={
                "Content-Disposition": f'attachment; filename="sana-{dossier["case_id"]}.json"'
            },
        )

    @app.post("/api/v1/operators/{operator}/ban")
    async def ban(operator: str, request: Request):
        admin(request)
        state = app.state
        async with state.lock:
            mode = state.config.mode
            if state.store.ban_status(operator, mode) != "confirmed":
                state.store.set_ban(operator, mode, "pending")
                if not await state.ml.ban(operator):
                    state.store.set_ban(operator, mode, "failed")
                    raise HTTPException(502, "Ban was not confirmed")
                state.store.set_ban(operator, mode, "confirmed")
                await notify({"type": "DASHBOARD_REFRESH"})
        return {"operator_id": operator, "status": "confirmed"}

    @app.get("/api/v1/guardian/holds")
    async def holds(request: Request):
        return {
            "holds": app.state.store.guardian_holds(guardian_account(bearer(request)))
        }

    @app.post("/api/v1/guardian/holds/{session}/{action}")
    async def guardian_action(session: str, action: str, request: Request):
        account = guardian_account(bearer(request))
        if action not in {"ack", "freeze"} or not app.state.store.guardian_action(
            account, session, action == "freeze"
        ):
            raise HTTPException(404, "Held transfer not found")
        if action == "freeze":
            await refresh_guardian(account)
        return {"status": "frozen" if action == "freeze" else "acknowledged"}

    @app.post("/api/v1/demo/inject-rat-click")
    async def demo(request: Request):
        admin(request)
        body = await read_json(request, 2048)
        if (
            not isinstance(body, dict)
            or set(body) != {"session_id"}
            or not isinstance(body["session_id"], str)
        ):
            raise HTTPException(422, "Expected a target session_id")
        ws = app.state.phones.get(body["session_id"])
        if ws is None:
            raise HTTPException(404, "Phone session is offline")
        try:
            await asyncio.wait_for(ws.send_json({"cmd": "INJECT_RAT_CLICK"}), timeout=1)
        except (TimeoutError, RuntimeError, OSError, WebSocketDisconnect):
            raise HTTPException(503, "Phone disconnected") from None
        return {"status": "sent", "session_id": body["session_id"]}

    async def listen(ws):
        try:
            while True:
                if (await ws.receive())["type"] == "websocket.disconnect":
                    break
        except WebSocketDisconnect:
            pass

    def allowed(ws):
        return ws.headers.get("origin") in app.state.config.origins

    @app.websocket("/ws/dashboard")
    async def dashboard_ws(ws: WebSocket):
        if not allowed(ws):
            await ws.close(code=1008)
            return
        await ws.accept()
        app.state.dashboard.add(ws)
        try:
            await listen(ws)
        finally:
            app.state.dashboard.discard(ws)

    @app.websocket("/ws/guardian")
    async def guardian_ws(ws: WebSocket):
        if not allowed(ws):
            await ws.close(code=1008)
            return
        await ws.accept()
        try:
            auth = await asyncio.wait_for(ws.receive_json(), timeout=5)
            if not isinstance(auth, dict) or not isinstance(auth.get("token"), str):
                raise TypeError
            account = guardian_account(auth["token"].encode())
        except (TypeError, ValueError, TimeoutError, HTTPException, RuntimeError):
            await ws.close(code=1008)
            return
        except WebSocketDisconnect:
            return
        sockets = app.state.guardians.setdefault(account, set())
        sockets.add(ws)
        try:
            await ws.send_json(
                {
                    "type": "GUARDIAN_HOLDS",
                    "holds": app.state.store.guardian_holds(account),
                }
            )
            await listen(ws)
        finally:
            sockets.discard(ws)

    @app.websocket("/ws/mobile/{session}")
    async def mobile_ws(ws: WebSocket, session: str):
        phones = app.state.phones
        if not allowed(ws) or session in phones or len(session) > 128:
            await ws.close(code=1008)
            return
        phones[session] = ws
        try:
            await ws.accept()
            await notify({"type": "DASHBOARD_REFRESH"})
            await listen(ws)
        finally:
            phones.pop(session, None)
            await notify({"type": "DASHBOARD_REFRESH"})

    return app


app = create_app()
