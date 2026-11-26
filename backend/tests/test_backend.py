import hashlib
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.coercion_engine import motion_indicators, repeated_bursts
from backend.config import Policy, Settings
from backend.main import create_app
from backend.physics_engine import Evidence, analyze_tap_recoil
from backend.risk_fusion import decide
from backend.storage import Store
from scripts.validate_contracts import FIXTURES, load_json, validate_payload, validators

INGEST = "/api/v1/sessions/ingest"
INIT = "/api/v1/dashboard/init"
ADMIN = {"Authorization": "Bearer test-analyst"}
GUARDIAN = {"Authorization": "Bearer test-guardian"}
ORIGIN = {"Origin": "http://localhost:5173"}


def fixture(name, file="telemetry"):
    return load_json(FIXTURES / name / (file + ".json"))


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = str(Path(self.temp.name) / "demo.sqlite")
        self.settings = Settings(
            "mock",
            self.db,
            fixture_access=True, admin_token="test-analyst",
            guardian_tokens={"acc_student_101": "test-guardian", "other": "second"},
            calibration_dir=Path(self.temp.name) / "records",
        )
        self.checks = validators()

    def client(self):
        return TestClient(create_app(self.settings))

    def test_confirmed_ring_freeze_persists_and_holds_new_transfers(self):
        recorded = fixture("ring")
        endpoint = f"/api/v1/rings/{recorded['session_id']}/freeze"
        with self.client() as c:
            original = c.post(INGEST, json=recorded).json()
            ring, = c.get(INIT).json()["rings"]
            amount = recorded["transfer_context"]["amount_kzt"]
            self.assertEqual((ring["cluster_id"], len(ring["accounts"])), (1, 3))
            self.assertEqual((ring["exposure_kzt"], ring["protected_kzt"]), (amount, 0))
            self.assertEqual(c.post(endpoint, json={"confirmed": True}).status_code, 403)
            self.assertEqual(c.post(endpoint, json={"confirmed": 1}, headers=ADMIN).status_code, 422)
            self.assertEqual(c.get("/api/v1/guardian/holds", headers=GUARDIAN).json()["holds"][0]["status"], "held")
            for _ in range(2):
                self.assertEqual(c.post(endpoint, json={"confirmed": True}, headers=ADMIN).status_code, 200)
            self.assertEqual(c.get("/api/v1/guardian/holds", headers=GUARDIAN).json()["holds"][0]["status"], "frozen")
            self.assertEqual(c.post(INGEST, json=recorded).json(), original)

        with self.client() as c:
            for entry in ring["accounts"]:
                alias = entry["account_id"]
                payload = fixture("normal")
                payload.update(session_id=f"review-{alias}", account_id=alias)
                receipt = c.post(INGEST, json=payload).json()
                self.assertEqual(receipt["ui_mode"], "MIRAGE_HOLD")
                event = c.get(INIT).json()["events"][0]
                self.assertEqual(event["decision_explanation"]["reasons"][0]["code"], "RING_ACCOUNT_REVIEW")
                self.assertEqual(c.post(INGEST, json=payload).json(), receipt)
            unrelated = fixture("normal")
            unrelated.update(session_id="unrelated", account_id="other")
            self.assertEqual(c.post(INGEST, json=unrelated).json()["ui_mode"], "SUCCESS")
            updated, = c.get(INIT).json()["rings"]
            expected = amount + 3 * unrelated["transfer_context"]["amount_kzt"]
            self.assertEqual((updated["exposure_kzt"], updated["protected_kzt"]), (expected, expected))
            self.assertTrue(all(account["in_review"] for account in updated["accounts"]))
        store = Store(self.db)
        self.addCleanup(store.db.close)
        self.assertEqual(store.ban_status(ring["operator_id"], "mock"), "confirmed")
        self.assertIsNone(store.account_review(recorded["account_id"], "live"))

    def test_stale_evidence_and_failed_identity_ban_do_not_activate_review(self):
        def ml(request):
            if request.url.path.endswith("/ban"):
                return httpx.Response(503)
            payload = json.loads(request.content)
            result = fixture("ring", "ml-score")
            result["session_id"] = payload["session_id"]
            return httpx.Response(200, json=result)

        settings = Settings("live", self.db, fixture_access=True, admin_token="test-analyst")
        with TestClient(create_app(settings, httpx.MockTransport(ml))) as c:
            payload = fixture("ring")
            for session in ("ring-old", "ring-new"):
                payload["session_id"] = session
                self.assertEqual(c.post(INGEST, json=payload).status_code, 200)
            for session, status in (("ring-old", 409), ("ring-new", 502)):
                self.assertEqual(c.post(
                    f"/api/v1/rings/{session}/freeze", headers=ADMIN, json={"confirmed": True}
                ).status_code, status)
            ring, = c.get(INIT, params={"include_map": False}).json()["rings"]
            self.assertFalse(any(account["in_review"] for account in ring["accounts"]))
            self.assertEqual(ring["protected_kzt"], 0)

    def test_fixture_flow_and_retry_after_restart(self):
        with (
            self.client() as c,
            c.websocket_connect("/ws/dashboard", headers=ORIGIN) as ws,
        ):
            for scenario, outcome in [
                ("normal", "SUCCESS"),
                ("synthetic_touch", "MIRAGE_HOLD"),
                ("dictation", "STEALTH_HOLD"),
                ("handoff", "MIRAGE_HOLD"),
                ("ring", "MIRAGE_HOLD"),
                ("banned_operator", "MIRAGE_HOLD"),
                ("missing_sensors", "STEP_UP_LIVENESS"),
            ]:
                payload = fixture(scenario)
                response = c.post(INGEST, json=payload).json()
                event = ws.receive_json()
                self.assertEqual(validate_payload("C", event, self.checks), [])
                self.assertEqual(validate_payload("D", response, self.checks), [])
                self.assertEqual(event["decision"], outcome)
                self.assertEqual(response["ui_mode"], outcome)
                self.assertEqual(event["session_id"], response["session_id"])
                self.assertEqual(c.get(INIT).json()["events"][0], event)
                basis = event["decision_explanation"]
                codes = [item["code"] for item in basis["reasons"]]
                self.assertEqual(basis["policy_version"], "demo-3")
                self.assertIn({
                    "normal": "BELOW_REVIEW_THRESHOLD", "synthetic_touch": "TOUCH_HOLD",
                    "dictation": "COERCION_NEW_RECIPIENT", "handoff": "HANDOFF_AMOUNT",
                    "ring": "CROSS_ACCOUNT_MATCH", "banned_operator": "BANNED_OPERATOR",
                    "missing_sensors": "RECOIL_EVIDENCE_MISSING",
                }[scenario], codes)
                self.assertNotIn("decision_explanation", response)
                exported = c.get(f"/api/v1/cases/{event['session_id']}/export-antifraud", headers=ADMIN).json()
                self.assertEqual(exported["event"]["decision_explanation"], basis)
                evidence = {group["id"]: group for group in basis["evidence"]}

                def facts(group):
                    return {entry["label"]: entry["value"] for entry in evidence[group]["facts"]}

                if scenario == "dictation":
                    self.assertIn("bursts", basis["reasons"][0]["detail"])
                    self.assertIn("cadence", basis["reasons"][0]["evidence_ids"])
                    self.assertEqual(facts("cadence")["Pauses between bursts"], "1100 ms and 1100 ms")
                    self.assertEqual(facts("cadence")["Digits per burst"], "3 / 3 / 3")
                if scenario == "synthetic_touch":
                    self.assertEqual(facts("touch")["Covered taps"], "7 of 7")
                    self.assertEqual(facts("touch")["Selected Z peak"], "0 m/s²")
                    self.assertEqual(facts("touch")["Low recoil cutoff"], "0.08 m/s²")
                if scenario in {"banned_operator", "ring"}:
                    self.assertEqual(facts("operator")["Cosine similarity"], "0.9300")
                    other_accounts = "0" if scenario == "banned_operator" else "2"
                    self.assertEqual(facts("operator")["Other linked accounts"], other_accounts)
                if scenario == "missing_sensors":
                    self.assertIsNone(event["scores"]["anti_rat_physics_risk"])
                    self.assertEqual(evidence["touch"]["status"], "unavailable")
                    self.assertNotIn("Selected Z peak", facts("touch"))
                if scenario == "normal":
                    original = response
        with self.client() as c:
            payload = fixture("normal")
            self.assertEqual(c.post(INGEST, json=payload).json(), original)
            payload["duration_ms"] += 1
            self.assertEqual(c.post(INGEST, json=payload).status_code, 409)
            self.assertEqual(c.get(INIT).json()["kpis"]["sessions"], 7)

    def test_silent_duress_freezes_before_delivery_and_survives_restart(self):
        payload = fixture("dictation")
        sid = payload["session_id"]
        other = {"Authorization": "Bearer second"}
        with self.client() as c, c.websocket_connect("/ws/guardian", headers=ORIGIN) as ws:
            ws.send_json({"token": "test-guardian"})
            self.assertEqual(ws.receive_json()["holds"], [])
            receipt = c.post(INGEST, json=payload).json()
            self.assertEqual(receipt["ui_mode"], "STEALTH_HOLD")
            self.assertEqual(receipt["display_title"], "Перевод в обработке")
            item, = ws.receive_json()["holds"]
            self.assertTrue(item["urgent"])
            self.assertFalse(item["acknowledged"])
            self.assertEqual((item["status"], item["reference_code"]), ("frozen", receipt["reference_code"]))
            self.assertEqual(c.get("/api/v1/guardian/holds", headers=other).json()["holds"], [])
            action = f"/api/v1/guardian/holds/{sid}/ack"
            self.assertEqual(c.post(action, headers=other).status_code, 404)
            self.assertEqual(c.post(action, headers=GUARDIAN).status_code, 200)
        with self.client() as c:
            self.assertEqual(c.post(INGEST, json=payload).json(), receipt)
            item, = c.get("/api/v1/guardian/holds", headers=GUARDIAN).json()["holds"]
            self.assertEqual((item["status"], item["acknowledged"]), ("frozen", True))
            data = c.get(INIT).json()
            self.assertEqual(data["kpis"]["held_amount_kzt"], payload["transfer_context"]["amount_kzt"])
            self.assertEqual(data["kpis"]["sessions"], 1)
            self.assertEqual(data["events"][0]["decision"], "STEALTH_HOLD")

    def test_restart_recovers_an_interrupted_reservation(self):
        payload = fixture("normal")
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        store = Store(self.db)
        try:
            self.assertTrue(store.reserve(payload["session_id"], digest))
        finally:
            store.db.close()
        with self.client() as c:
            changed = {**payload, "duration_ms": payload["duration_ms"] + 1}
            self.assertEqual(c.post(INGEST, json=changed).status_code, 409)
            self.assertEqual(c.get(INIT).json()["kpis"]["sessions"], 0)
            self.assertEqual(c.post(INGEST, json=payload).json()["ui_mode"], "SUCCESS")
            self.assertEqual(c.get(INIT).json()["kpis"]["sessions"], 1)

    def test_malformed_bounds_and_privacy(self):
        with self.client() as c:
            payload = fixture("normal")
            payload["unexpected"] = "sensitive"
            self.assertNotIn("sensitive", c.post(INGEST, json=payload).text)
            header = {"Content-Type": "application/json"}
            for body in (
                '{"session_id":"a","session_id":"a"}',
                "NaN",
                "1e999",
                "[]",
                "bad json",
            ):
                self.assertEqual(
                    c.post(INGEST, content=body, headers=header).status_code, 422
                )
            self.assertEqual(
                c.post(INGEST, content=b"x" * 1_048_577, headers=header).status_code,
                413,
            )
            self.assertEqual(c.post(INGEST, json={"taps": [{}] * 513}).status_code, 413)

    def test_scope_delivery_commands_ban_and_export(self):
        with self.client() as c:
            payload = fixture("synthetic_touch")
            sid = payload["session_id"]
            url = "/api/v1/demo/inject-rat-click"
            with (
                self.assertRaises(WebSocketDisconnect),
                c.websocket_connect(
                    "/ws/dashboard", headers={"Origin": "http://unexpected.test"}
                ),
            ):
                pass
            with c.websocket_connect("/ws/mobile/demo", headers=ORIGIN) as mobile:
                self.assertEqual(c.get(INIT).json()["active_sessions"], ["demo"])
                self.assertEqual(
                    c.post(url, json={"session_id": "demo"}).status_code, 403
                )
                self.assertEqual(
                    c.post(
                        url, json={"session_id": "unknown"}, headers=ADMIN
                    ).status_code,
                    404,
                )
                self.assertEqual(
                    c.post(url, json={"session_id": "demo"}, headers=ADMIN).status_code,
                    200,
                )
                self.assertEqual(mobile.receive_json(), {"cmd": "INJECT_RAT_CLICK"})
            with c.websocket_connect("/ws/guardian", headers=ORIGIN) as guardian:
                guardian.send_json({"token": "test-guardian"})
                self.assertEqual(guardian.receive_json()["holds"], [])
                c.post(INGEST, json=payload)
                self.assertEqual(guardian.receive_json()["holds"][0]["session_id"], sid)
                action = f"/api/v1/guardian/holds/{sid}/"
                self.assertEqual(
                    c.post(
                        action + "freeze", headers={"Authorization": "Bearer second"}
                    ).status_code,
                    404,
                )
                self.assertEqual(
                    c.post(action + "ack", headers=GUARDIAN).json()["status"],
                    "acknowledged",
                )
                for _ in range(2):
                    self.assertEqual(
                        c.post(action + "freeze", headers=GUARDIAN).json()["status"],
                        "frozen",
                    )
                    self.assertEqual(
                        guardian.receive_json()["holds"][0]["status"], "frozen"
                    )
            export = f"/api/v1/cases/{sid}/export-antifraud"
            self.assertEqual(c.get(export).status_code, 403)
            dossier = c.get(export, headers=ADMIN).json()
            self.assertEqual(
                dossier["guardian"], {"acknowledged": True, "frozen": True}
            )
            self.assertTrue(dossier["simulated"])
            ban = "/api/v1/operators/op_demo_owner/ban"
            self.assertEqual(c.post(ban).status_code, 403)
            self.assertEqual(c.post(ban, headers=ADMIN).json()["status"], "confirmed")
            self.assertEqual(
                c.post(INGEST, json=fixture("normal")).json()["ui_mode"], "MIRAGE_HOLD"
            )

    def test_live_concurrency_and_failure(self):
        count = 0

        def ml(request):
            nonlocal count
            if request.url.path == "/ml/population-map":
                return httpx.Response(200, json={"points": [], "clusters": []})
            count += 1
            body = json.loads(request.content)
            if body["session_id"] == "outage":
                raise httpx.ReadTimeout("timeout")
            if body["session_id"] == "malformed":
                return httpx.Response(200, json={})
            return httpx.Response(200, json=fixture("normal", "ml-score"))

        app = create_app(Settings("live", self.db, fixture_access=True), httpx.MockTransport(ml))
        with TestClient(app) as c, ThreadPoolExecutor(2) as pool:
            payload = fixture("normal")
            first, second = list(
                pool.map(lambda _: c.post(INGEST, json=payload).json(), range(2))
            )
            self.assertEqual(count, 1)
            self.assertEqual(first, second)
            self.assertEqual(first["ui_mode"], "SUCCESS")
            for scenario in ("outage", "malformed"):
                payload["session_id"] = scenario
                self.assertEqual(
                    c.post(INGEST, json=payload).json()["ui_mode"], "STEP_UP_LIVENESS"
                )
                event = c.get(INIT).json()["events"][0]
                self.assertIsNone(event["scores"]["operator_mismatch_risk"])
                self.assertIsNone(event["map_point"])

    def test_ban_confirmation_and_full_vector_fingerprint(self):
        sid = "sess_fixture_normal"
        fingerprint_requests = 0
        ban_attempts = 0

        def ml(request):
            nonlocal fingerprint_requests, ban_attempts
            if request.url.path.endswith("fingerprint"):
                fingerprint_requests += 1
                self.assertEqual(request.headers["Authorization"], "Bearer ml-test")
                return httpx.Response(
                    200, json={"session_id": sid, "operator_fingerprint": "a" * 64}
                )
            if request.url.path.endswith("ban"):
                ban_attempts += 1
                if ban_attempts == 1:
                    return httpx.Response(503)
                return httpx.Response(
                    200, json={"operator_id": "op_demo_owner", "status": "confirmed"}
                )
            if request.url.path.endswith("population-map"):
                return httpx.Response(200, json={"points": [{}], "clusters": []})
            return httpx.Response(200, json=fixture("normal", "ml-score"))

        config = Settings(
            "live", self.db, fixture_access=True, admin_token="test-analyst", ml_token="ml-test"
        )
        with TestClient(create_app(config, httpx.MockTransport(ml))) as c:
            self.assertEqual(c.post(INGEST, json=fixture("normal")).status_code, 200)
            self.assertIsNone(c.get(INIT).json()["population_map"])
            ban = "/api/v1/operators/op_demo_owner/ban"
            self.assertEqual(c.post(ban, headers=ADMIN).status_code, 502)
            for _ in range(2):
                self.assertEqual(
                    c.post(ban, headers=ADMIN).json()["status"], "confirmed"
                )
                response = c.get(f"/api/v1/cases/{sid}/export-antifraud", headers=ADMIN)
                self.assertEqual(response.json()["operator_fingerprint"], "a" * 64)
            self.assertEqual(fingerprint_requests, 1)
            self.assertEqual(ban_attempts, 2)

    def test_analyst_attested_owner_enrollment(self):
        confirmations = []
        eligible = "owner-bootstrap"

        def ml(request):
            if request.url.path.endswith("enroll"):
                self.assertEqual(
                    request.headers["Authorization"], "Bearer upstream-test"
                )
                sid = request.url.path.split("/")[-2]
                confirmations.append(sid)
                return httpx.Response(
                    200,
                    json={
                        "session_id": sid,
                        "account_id": "acc_student_101",
                        "baseline_sessions_count": 1,
                    },
                )
            if request.url.path.endswith("ban"):
                return httpx.Response(
                    200, json={"operator_id": "op_demo_owner", "status": "confirmed"}
                )
            payload = json.loads(request.content)
            result = fixture("normal", "ml-score")
            result["session_id"] = payload["session_id"]
            result["owner_verification"].update(
                cosine_similarity=None, baseline_sessions_count=0
            )
            if payload["session_id"] == "unavailable-identity":
                return httpx.Response(422)
            return httpx.Response(200, json=result)

        bridge = "/api/v1/sessions/{}/enroll"
        config = Settings(
            "live", self.db, fixture_access=True, admin_token="test-analyst", ml_token="upstream-test"
        )
        with TestClient(create_app(config, httpx.MockTransport(ml))) as c:
            for sid, scenario in [
                (eligible, "normal"),
                ("unsafe", "synthetic_touch"),
                ("no-motion", "missing_sensors"),
                ("unavailable-identity", "normal"),
            ]:
                payload = fixture(scenario)
                payload["session_id"] = sid
                self.assertEqual(c.post(INGEST, json=payload).status_code, 200)
            self.assertEqual(confirmations, [])
            url = bridge.format(eligible)
            attestation = {"owner_verified": True}
            self.assertEqual(c.post(url, json=attestation).status_code, 403)
            for body in (
                {},
                {"owner_verified": False},
                {"owner_verified": 1},
                {**attestation, "other": True},
            ):
                self.assertEqual(c.post(url, json=body, headers=ADMIN).status_code, 422)
            self.assertEqual(
                c.post(
                    bridge.format("unknown"), json=attestation, headers=ADMIN
                ).status_code,
                404,
            )
            for sid in ("unsafe", "no-motion", "unavailable-identity"):
                self.assertEqual(
                    c.post(
                        bridge.format(sid), json=attestation, headers=ADMIN
                    ).status_code,
                    409,
                )
            for _ in range(2):
                confirmation = c.post(url, json=attestation, headers=ADMIN).json()
                self.assertEqual(confirmation["baseline_sessions_count"], 1)
            self.assertEqual(confirmations, [eligible])
            dossier = c.get(
                "/api/v1/cases/" + eligible + "/export-antifraud", headers=ADMIN
            ).json()
            self.assertEqual(dossier["enrollment"]["confirmation"], confirmation)
            self.assertEqual(dossier["event"]["decision"], "STEP_UP_LIVENESS")
            c.post("/api/v1/operators/op_demo_owner/ban", headers=ADMIN)
            self.assertEqual(
                c.post(url, json=attestation, headers=ADMIN).status_code, 409
            )
        with self.client() as c:
            self.assertEqual(
                c.post(url, json=attestation, headers=ADMIN).status_code, 409
            )

    def test_per_session_calibration(self):
        with self.client() as c:
            url = "/api/v1/calibration/sessions"
            headers = {"X-Calibration-Consent": "granted"}
            payload = fixture("normal")
            c.post(INGEST, json=payload)
            self.assertFalse(self.settings.calibration_dir.exists())
            self.assertEqual(c.post(url, json=payload).status_code, 403)
            payload["session_id"] = "../escape"
            response = c.post(url, json=payload, headers=headers)
            self.assertEqual(response.status_code, 200)
            path = self.settings.calibration_dir / response.json()["recording"]
            self.assertEqual(json.loads(path.read_text()), payload)
            self.assertEqual(
                c.post(url, json=payload, headers=headers).status_code, 200
            )
            payload["duration_ms"] += 1
            self.assertEqual(
                c.post(url, json=payload, headers=headers).status_code, 409
            )


class SignalTests(unittest.TestCase):
    def test_sparse_windows_and_tremor(self):
        payload = fixture("normal")
        payload["imu_samples"] = payload["imu_samples"][::8]
        self.assertIsNone(analyze_tap_recoil(payload, Policy()).score)
        samples = [
            {
                "t_ms": i * 10,
                "ax": float(np.sin(2 * np.pi * 0.10 * i)),
                "ay": 0,
                "az": 0,
                "beta": 45,
            }
            for i in range(400)
        ]
        self.assertEqual(motion_indicators(samples), (True, 0))
        self.assertEqual(motion_indicators(samples[::10]), (None, None))

    def test_cadence_boundaries(self):
        pattern = fixture("dictation")["keystrokes"]
        self.assertTrue(repeated_bursts(pattern))
        self.assertFalse(repeated_bursts(pattern[:6]))
        self.assertFalse(
            repeated_bursts(
                pattern + [dict(pattern[-1], down_ms=t) for t in (3750, 3900)]
            )
        )

    def test_explanation_records_all_decisive_rules_and_active_policy(self):
        payload = fixture("dictation")
        ml = fixture("ring", "ml-score")
        ml["operator_reconciliation"]["is_banned_operator"] = True
        policy = Policy(version="custom", hold_threshold=79, ring_confidence=0.9)
        outcome, *_, basis = decide(payload, Evidence(None), Evidence(80), ml, policy)
        self.assertEqual(outcome, "STEALTH_HOLD")
        self.assertEqual(basis["policy_version"], "custom")
        self.assertEqual([r["code"] for r in basis["reasons"]],
                         ["BANNED_OPERATOR", "CROSS_ACCOUNT_MATCH", "COERCION_NEW_RECIPIENT"])
        self.assertIn("79", basis["reasons"][-1]["detail"])
        payload["transfer_context"]["is_new_recipient"] = False
        result = decide(payload, Evidence(None), Evidence(80), None, policy)
        self.assertEqual(result[0], "STEP_UP_LIVENESS")
        self.assertEqual([r["code"] for r in result[-1]["reasons"]],
                         ["OWNER_EVIDENCE_MISSING", "RECOIL_EVIDENCE_MISSING", "STEP_UP_SCORE"])

    def test_explicit_hold_precedence(self):
        payload = fixture("normal")
        ml = fixture("normal", "ml-score")

        def outcome(recoil=0, coercion=0):
            return decide(payload, Evidence(recoil), Evidence(coercion), ml, Policy())[
                0
            ]

        self.assertEqual(outcome(74), "STEP_UP_LIVENESS")
        self.assertEqual(outcome(75), "MIRAGE_HOLD")
        payload["transfer_context"]["is_new_recipient"] = True
        self.assertEqual(outcome(coercion=74), "STEP_UP_LIVENESS")
        self.assertEqual(outcome(coercion=75), "STEALTH_HOLD")
        payload["transfer_context"]["is_new_recipient"] = False
        self.assertEqual(outcome(coercion=75), "STEP_UP_LIVENESS")
        ml["owner_verification"]["is_handoff_detected"] = True
        for amount, expected in [
            (99_999, "STEP_UP_LIVENESS"),
            (100_000, "MIRAGE_HOLD"),
        ]:
            payload["transfer_context"]["amount_kzt"] = amount
            self.assertEqual(outcome(), expected)
        ml["owner_verification"]["is_handoff_detected"] = False
        for size, conf, expected in [
            (1, 0.8, "SUCCESS"),
            (2, 0.79, "SUCCESS"),
            (2, 0.8, "MIRAGE_HOLD"),
        ]:
            ml["operator_reconciliation"].update(ring_size=size, match_confidence=conf)
            self.assertEqual(outcome(), expected)
