import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend import accounts
from backend.config import Settings
from backend.main import create_app
from backend.storage import Store
from contracts.windows import sliding_windows
from scripts.validate_contracts import FIXTURES, load_json


class WorkspaceTests(unittest.TestCase):
    def test_authenticated_account_to_analyst(self):
        with tempfile.TemporaryDirectory() as tmp:
            dbfile = str(Path(tmp) / "sandbox.sqlite")
            with sqlite3.connect(dbfile) as db:
                accounts.initialize(db)
                for alias, role in (
                    ("cash_001", "mobile"),
                    ("cash_002", "mobile"),
                    ("ops", "analyst"),
                ):
                    accounts.provision(db, alias, "test-password-12", role)
            with TestClient(create_app(Settings("mock", dbfile))) as client:
                origin = {"Origin": "http://localhost:5173"}
                payload = load_json(FIXTURES / "normal/telemetry.json")
                payload["account_id"] = "cash_001"
                ingest = "/api/v1/sessions/ingest"
                dashboard = "/api/v1/dashboard/init"
                self.assertEqual(client.post(ingest, json=payload).status_code, 401)
                with (
                    self.assertRaises(WebSocketDisconnect),
                    client.websocket_connect("/ws/dashboard", headers=origin),
                ):
                    pass

                def login(role, alias):
                    return client.post(
                        f"/api/v1/auth/{role}/login",
                        headers=origin,
                        json={"alias": alias, "password": "test-password-12"},
                    )

                self.assertEqual(login("analyst", "cash_001").status_code, 401)
                self.assertIn(
                    "HttpOnly", login("mobile", "cash_001").headers["set-cookie"]
                )
                self.assertEqual(client.get(dashboard).status_code, 403)
                self.assertEqual(
                    client.post(
                        ingest, json={**payload, "account_id": "cash_002"}
                    ).status_code,
                    403,
                )
                self.assertEqual(login("analyst", "ops").status_code, 200)
                with client.websocket_connect("/ws/dashboard", headers=origin) as ws:
                    receipt = client.post(ingest, json=payload).json()
                    event = ws.receive_json()
                    self.assertEqual(
                        (event["session_id"], event["account_id"]),
                        (receipt["session_id"], "cash_001"),
                    )
                    self.assertEqual(client.post(ingest, json=payload).json(), receipt)
                self.assertEqual(
                    client.get(dashboard + "?account=cash_002").json()["events"], []
                )
                directory = client.get("/api/v1/dashboard/accounts?prefix=cash").json()
                self.assertEqual(directory["accounts"][0]["transfers"], 1)
                self.assertEqual(
                    client.get("/api/v1/mobile/history").json()[0]["reference_code"],
                    receipt["reference_code"],
                )
                windows = client.get(
                    f"/api/v1/sessions/{event['session_id']}/windows"
                ).json()["windows"]
                self.assertEqual(windows, sliding_windows(payload))
                client.post(
                    "/api/v1/auth/mobile/logout", headers=origin
                ).raise_for_status()
                self.assertEqual(client.post(ingest, json=payload).status_code, 401)
                login("mobile", "cash_002").raise_for_status()
                self.assertEqual(client.get("/api/v1/mobile/history").json(), [])
                client.post(
                    "/api/v1/auth/analyst/logout", headers=origin
                ).raise_for_status()
                self.assertEqual(client.get(dashboard).status_code, 403)

    def test_backfilled_totals_and_subsequent_inserts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "old.sqlite")
            store = Store(path)
            # Represent the previous schema, before summary tables existed.
            store.db.executescript(
                "DROP TRIGGER session_updates_dashboard_v2; DROP TABLE dashboard_totals; DROP TABLE observed_rings;"
            )
            decision = {"ui_mode": "MIRAGE_HOLD"}
            event = {"session_id": "old", "account_id": "alias", "map_point": None}
            store.save("digest1", event, decision, {}, 12, None, "ring")
            store.db.close()
            store = Store(path)
            self.addCleanup(store.db.close)
            store.save(
                "digest2",
                {**event, "session_id": "new"},
                {"ui_mode": "STEALTH_HOLD"},
                {},
                30,
                17.5,
                "ring",
            )
            _, totals, _ = store.snapshot()
            self.assertEqual(
                totals,
                {
                    "sessions": 2,
                    "held_amount_kzt": 42,
                    "average_inference_ms": 17.5,
                    "ring_count": 1,
                },
            )

    def test_directory_keyset_and_filter(self):
        store = Store(":memory:")
        self.addCleanup(store.db.close)
        for i in range(75):
            alias = f"acc_{i:03}"
            event = {"session_id": alias, "account_id": alias, "map_point": None}
            store.save(alias, event, {}, {}, 10, None, None)
        first = store.directory("acc_", "")
        second = store.directory("acc_", first["next"])
        self.assertEqual([len(first["accounts"]), len(second["accounts"])], [50, 25])
        self.assertIsNone(second["next"])
        self.assertEqual(len(store.directory("acc_02", "")["accounts"]), 10)
