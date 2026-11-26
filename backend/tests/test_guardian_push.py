import asyncio
import tempfile
import unittest
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from py_vapid import Vapid

from backend.config import Settings
from backend.guardian_push import GuardianPush, valid_endpoint
from backend.main import create_app
from backend.storage import Store


class GuardianPushTests(unittest.TestCase):
    def test_registration_is_account_scoped(self):
        endpoint = "https://fcm.googleapis.com/fcm/send/example"
        settings = Settings("mock", ":memory:", guardian_tokens={"a": "first", "b": "second"})
        with TestClient(create_app(settings)) as client:
            def post(token, action):
                return client.post("/api/v1/guardian/device/" + action,
                                   headers={"Authorization": "Bearer " + token}, json={"endpoint": endpoint})
            self.assertEqual(post("wrong", "enable").status_code, 403)
            self.assertTrue(post("first", "enable").json()["enabled"])
            self.assertFalse(post("second", "status").json()["enabled"])
            self.assertEqual(post("second", "enable").status_code, 409)
            post("second", "disable")
            self.assertTrue(post("first", "status").json()["enabled"])
            self.assertFalse(post("first", "disable").json()["enabled"])
            self.assertFalse(valid_endpoint("http://localhost:8000/"))
            self.assertFalse(valid_endpoint("https://fcm.googleapis.com.example.invalid/send"))

    def test_pending_delivery_recovers_after_restart(self):
        async def verify(path):
            responses = iter([503, 201, 410])
            calls = []
            def provider(req):
                calls.append(req)
                self.assertTrue(Vapid.verify(req.headers["Authorization"]))
                self.assertEqual(req.content, b"")
                self.assertEqual(req.headers["Urgency"], "high")
                return httpx.Response(next(responses))
            async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
                store = Store(path)
                push = GuardianPush(store.db, client, "mailto:test@example.invalid")
                key = push.public_key()
                a = "https://fcm.googleapis.com/fcm/send/device-a"
                b = "https://fcm.googleapis.com/fcm/send/device-b"
                push.enable("a", a)
                push.enable("b", b)
                event = {"session_id": "original", "account_id": "a"}
                store.save("digest", event, {"ui_mode": "STEALTH_HOLD"}, {}, 5, None, None)
                await push.deliver()
                self.assertEqual(len(calls), 1)
                await push.deliver()
                self.assertEqual(len(calls), 1)
                store.db.close()
                store = Store(path)
                try:
                    push = GuardianPush(store.db, client, "mailto:test@example.invalid")
                    self.assertEqual(key, push.public_key())
                    with store.db:
                        store.db.execute("UPDATE guardian_push_devices SET next_attempt=0")
                    await push.deliver()
                    await push.deliver()
                    self.assertEqual(len(calls), 2)
                    store.save("next", {**event, "session_id": "next"}, {"ui_mode": "STEALTH_HOLD"}, {}, 10, None, None)
                    await push.deliver()
                    self.assertEqual([str(req.url) for req in calls], [a, a, a])
                    self.assertFalse(push.registered("a", a))
                    self.assertTrue(push.registered("b", b))
                finally:
                    store.db.close()
        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(verify(str(Path(directory) / "push.sqlite")))
