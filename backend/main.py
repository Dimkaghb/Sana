"""Run from the repository root with ML_MODE set and one ASGI worker."""

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from weakref import WeakValueDictionary

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from contracts.windows import sliding_windows
from scripts.validate_contracts import (
    reject_constant,
    unique_object,
    validate_payload,
    validators,
)

from . import accounts
from .calibration import save_recording
from .coercion_engine import analyze_coercion
from .config import Settings
from .coordination import IdentityAccess
from .ml_client import EnrollmentRefused, IdentityService
from .physics_engine import analyze_tap_recoil, flag
from .risk_fusion import decide, eligible_for_enrollment, local_hold
from .storage import Store

BODY_LIMIT = 1_048_576
LOCAL_HOLD_IDENTITY_BUDGET = 0.075
IDENTITY_BUDGET = 1.5
COLLECTION_LIMITS = {
    "contacts": 512,
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
        state.login_attempts = {}
        state.logins = asyncio.Semaphore(2)
        state.checks = validators()
        state.store = Store(config.database)
        # Held and waiting coroutines keep a strong reference to their session
        # lock. Completed IDs disappear from memory and are recovered via SQLite.
        accounts.initialize(state.store.db)
        state.sessions = WeakValueDictionary()
        state.identity_access = IdentityAccess()
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

    @app.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def identity(connection, role):
        return accounts.principal(
            app.state.store.db, connection.cookies.get("sana_" + role), role
        )

    def check_origin(request):
        origin = request.headers.get("origin")
        if origin and origin not in app.state.config.origins:
            raise HTTPException(403, "Unrecognized origin")

    @app.get("/api/v1/auth/{role}/me")
    async def whoami(role: str, request: Request):
        if role not in {"mobile", "analyst"}:
            raise HTTPException(404)
        alias = identity(request, role)
        return JSONResponse(
            {"alias": alias, "fixture_access": app.state.config.fixture_access},
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/v1/auth/{role}/login")
    async def login(role: str, request: Request):
        check_origin(request)
        body = await read_json(request, 2048)
        if (
            role not in {"mobile", "analyst"}
            or not isinstance(body, dict)
            or set(body) != {"alias", "password"}
            or not isinstance(body["alias"], str)
            or not accounts.ALIAS.fullmatch(body["alias"])
            or not isinstance(body["password"], str)
            or not 1 <= len(body["password"]) <= 128
            or any(0xD800 <= ord(c) <= 0xDFFF for c in body["password"])
        ):
            raise HTTPException(422, "Invalid sign-in")
        now = time.monotonic()
        attempts = app.state.login_attempts
        if len(attempts) >= 2048:
            app.state.login_attempts = attempts = {
                k: v for k, v in attempts.items() if v[-1] > now - 60
            }
        source = request.client.host if request.client else "local"
        if source not in attempts and len(attempts) >= 2048:
            raise HTTPException(429, "Sign-in busy. Try again.")
        history = attempts.setdefault(source, deque())
        while history and history[0] <= now - 60:
            history.popleft()
        if len(history) >= 20:
            raise HTTPException(429, "Try again in one minute")
        history.append(now)
        db = app.state.store.db
        row = db.execute(
            "SELECT * FROM login_accounts WHERE alias=? AND role=?",
            (body["alias"], role),
        ).fetchone()
        if app.state.logins.locked():
            raise HTTPException(429, "Sign-in busy. Try again.")
        async with app.state.logins:
            candidate = await asyncio.to_thread(
                accounts.verifier, body["password"], row["salt"] if row else bytes(16)
            )
        if not row or not hmac.compare_digest(candidate, row["verifier"]):
            raise HTTPException(401, "Invalid sign-in")
        response = JSONResponse(
            {"alias": row["alias"]}, headers={"Cache-Control": "no-store"}
        )
        # Plain HTTP cookies are allowed only for local browser development.
        local_http = (
            request.url.hostname in {"127.0.0.1", "localhost", "testserver"}
            and request.url.scheme == "http"
        )
        response.set_cookie(
            "sana_" + role,
            accounts.issue(db, row["alias"]),
            max_age=accounts.TTL,
            httponly=True,
            secure=not local_http,
            samesite="strict",
        )
        return response

    @app.post("/api/v1/auth/{role}/logout")
    async def logout(role: str, request: Request):
        check_origin(request)
        if role not in {"mobile", "analyst"}:
            raise HTTPException(404)
        cookie = "sana_" + role
        token = request.cookies.get(cookie, "")
        with app.state.store.db as db:
            db.execute(
                "DELETE FROM login_sessions WHERE digest=?", (accounts.digest(token),)
            )
        sockets = (
            app.state.dashboard if role == "analyst" else app.state.phones.values()
        )
        for ws in tuple(sockets):
            if token and ws.cookies.get(cookie) == token:
                await ws.close(code=1008)
        response = JSONResponse({"signed_out": True})
        response.delete_cookie(cookie)
        return response

    def admin(request):
        if identity(request, "analyst"):
            check_origin(request)
            return
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
        sockets = app.state.dashboard
        if not app.state.config.fixture_access:
            sockets = {ws for ws in sockets if identity(ws, "analyst")}
        await broadcast(sockets, message)

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
        check_origin(request)
        account = identity(request, "mobile")
        if not account and not app.state.config.fixture_access:
            raise HTTPException(401, "Mobile sign-in required")
        telemetry = await read_json(request)
        if not isinstance(telemetry, dict):
            raise HTTPException(422, "Expected a Contract A object")
        if account and telemetry.get("account_id") != account:
            raise HTTPException(403, "Account mismatch")
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
        async with state.sessions.setdefault(session, asyncio.Lock()):
            row = state.store.session(session)
            if row:
                if row["digest"] != digest:
                    raise HTTPException(
                        409, "Session ID reused with different telemetry"
                    )
                return json.loads(row["decision"])
            if not state.store.reserve(session, digest):
                raise HTTPException(
                    409, "Pending session ID reused with different telemetry"
                )
            policy = state.config.policy
            start = time.perf_counter()
            recoil = analyze_tap_recoil(telemetry, policy)
            coercion = analyze_coercion(telemetry)
            physics_ms = round((time.perf_counter() - start) * 1000, 3)
            budget = (
                LOCAL_HOLD_IDENTITY_BUDGET
                if local_hold(telemetry["transfer_context"], recoil, coercion, policy)
                else IDENTITY_BUDGET
            )
            clock = asyncio.get_running_loop().time
            deadline = clock() + budget
            missed_deadline = False
            try:
                # Includes both waiting for an identity mutation and the ML call.
                # No await occurs between releasing read access and committing C/D.
                async with asyncio.timeout_at(deadline), state.identity_access.score():
                    ml = await state.ml.score(telemetry)
                    # A synchronous decode or schema check can run across the timer.
                    if clock() >= deadline:
                        raise TimeoutError
            except TimeoutError:
                ml = None
                missed_deadline = True
            mode = state.config.mode
            operator = ml["operator_reconciliation"] if ml else {}
            op_id = operator.get("matched_operator_id")
            if mode == "mock" and state.store.ban_status(op_id, mode) == "confirmed":
                operator["is_banned_operator"] = True
            outcome, scores, overall, flags = decide(
                telemetry, recoil, coercion, ml, policy
            )
            if missed_deadline:
                flags.append(
                    flag(
                        "IDENTITY_DEADLINE",
                        "INFO",
                        "Identity deadline elapsed",
                        f"No identity result within the {round(budget * 1000)} ms budget.",
                    )
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
                "windows": sliding_windows(telemetry),
                "physics_ms": physics_ms,
                "recoil": recoil.measurements,
                "coercion": coercion.measurements,
                "match_confidence": operator.get("match_confidence"),
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
    async def dashboard_init(
        request: Request,
        include_map: bool = True,
        account: str | None = None,
        map_page: str | None = None,
    ):
        if not app.state.config.fixture_access:
            admin(request)
        state = app.state
        if map_page and len(map_page) > 36:
            raise HTTPException(422, "Invalid map cursor")
        population = await state.ml.population(map_page) if include_map else None
        events, kpis, identity = state.store.snapshot(account)
        return {
            "events": events,
            "session_identity": identity,
            "kpis": kpis,
            "ml_mode": state.config.mode,
            "active_sessions": list(state.phones),
            "population_map": population,
        }

    @app.get("/api/v1/mobile/history")
    async def history(request: Request):
        account = identity(request, "mobile")
        if not account:
            raise HTTPException(401, "Mobile sign-in required")
        rows = app.state.store.db.execute(
            """
            SELECT amount, json_extract(event,'$.timestamp') timestamp,
                   json_extract(decision,'$.reference_code') reference_code,
                   json_extract(decision,'$.display_title') display_title
            FROM sessions WHERE account=? ORDER BY rowid DESC LIMIT 50
        """,
            (account,),
        )
        return JSONResponse(
            [dict(row) for row in rows], headers={"Cache-Control": "no-store"}
        )

    @app.get("/api/v1/dashboard/accounts")
    async def directory(request: Request, prefix: str = "", after: str = ""):
        if not app.state.config.fixture_access:
            admin(request)
        if len(prefix) > 128 or len(after) > 128:
            raise HTTPException(422, "Alias filter too long")
        return app.state.store.directory(prefix, after)

    @app.get("/api/v1/sessions/{session}/windows")
    async def windows(session: str, request: Request):
        admin(request)
        row = app.state.store.session(session)
        if not row:
            raise HTTPException(404)
        return {
            "session_id": session,
            "windows": json.loads(row["dossier"]).get("windows"),
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

    @app.post("/api/v1/sessions/{session}/enroll")
    async def enroll(session: str, request: Request):
        admin(request)
        body = await read_json(request, 1024)
        if (
            not isinstance(body, dict)
            or set(body) != {"owner_verified"}
            or body["owner_verified"] is not True
        ):
            raise HTTPException(
                422, "Explicit verification of this session's owner is required"
            )
        state = app.state
        async with state.identity_access.change():
            row = state.store.session(session)
            if not row:
                raise HTTPException(404, "Session not found")
            dossier = json.loads(row["dossier"])
            event = dossier["event"]
            if state.config.mode != "live" or dossier["ml_mode"] != "live":
                raise HTTPException(
                    409, "Owner enrollment requires a live identity session"
                )
            if not eligible_for_enrollment(
                event, dossier["policy"]["step_up_threshold"]
            ):
                raise HTTPException(
                    409,
                    "Session has insufficient or conflicting evidence for enrollment",
                )
            operator = event["map_point"]["operator_id"]
            if state.store.ban_status(operator, "live") is not None:
                raise HTTPException(
                    409, "An operator ban was requested for this identity"
                )
            if "enrollment" in dossier:
                return dossier["enrollment"]["confirmation"]
            try:
                confirmation = await state.ml.enroll(session, row["account"])
            except EnrollmentRefused:
                raise HTTPException(
                    409, "Identity service declined this enrollment"
                ) from None
            if not confirmation:
                raise HTTPException(502, "Identity service did not confirm enrollment")
            state.store.record_enrollment(session, confirmation)
            return confirmation

    @app.post("/api/v1/operators/{operator}/ban")
    async def ban(operator: str, request: Request):
        admin(request)
        state = app.state
        async with state.identity_access.change():
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
        if not allowed(ws) or (
            not app.state.config.fixture_access and not identity(ws, "analyst")
        ):
            await ws.close(code=1008)
            return
        await ws.accept()
        app.state.dashboard.add(ws)
        try:
            if app.state.config.fixture_access:
                await listen(ws)
            else:
                while identity(ws, "analyst"):
                    try:
                        await asyncio.wait_for(listen(ws), 30)
                        break
                    except TimeoutError:
                        continue
                else:
                    await ws.close(code=1008)
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
        if (
            (not app.state.config.fixture_access and not identity(ws, "mobile"))
            or not allowed(ws)
            or session in phones
            or len(session) > 128
        ):
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
