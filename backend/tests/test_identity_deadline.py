"""Decision deadlines and identity ordering on the real ASGI intake path."""

import asyncio
import json
import unittest
from collections import Counter
from contextlib import asynccontextmanager

import httpx

from backend.config import Settings
from backend.main import create_app
from scripts.validate_contracts import FIXTURES, load_json

INGEST = "/api/v1/sessions/ingest"


def payload(name, session=None):
    body = load_json(FIXTURES / name / "telemetry.json")
    if session:
        body["session_id"] = session
    return body


def match(session, banned=False):
    body = load_json(FIXTURES / "normal/ml-score.json")
    body["session_id"] = session
    body["operator_reconciliation"]["is_banned_operator"] = banned
    return httpx.Response(200, json=body)


@asynccontextmanager
async def connected(handler):
    settings = Settings("live", ":memory:", admin_token="test-analyst")
    app = create_app(settings, httpx.MockTransport(handler))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://local"
        ) as client,
    ):
        yield app, client


class DeadlineTests(unittest.IsolatedAsyncioTestCase):
    async def test_unrelated_slow_identity_does_not_delay_local_hold_or_duplicate_effects(
        self,
    ):
        started = asyncio.Event()
        release = asyncio.Event()
        cancelled = set()
        requests = Counter()

        async def handler(request):
            sid = json.loads(request.content)["session_id"]
            requests[sid] += 1
            if sid == "ordinary":
                started.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.add(sid)
                raise
            return match(sid)

        async with connected(handler) as (app, client):
            ordinary = asyncio.create_task(
                client.post(INGEST, json=payload("normal", "ordinary"))
            )
            await asyncio.wait_for(started.wait(), 1)
            synthetic = payload("synthetic_touch", "sim")
            results = await asyncio.wait_for(
                asyncio.gather(
                    client.post(INGEST, json=synthetic),
                    client.post(INGEST, json=synthetic),
                    client.post(INGEST, json=payload("dictation", "cadence")),
                ),
                1,
            )
            self.assertEqual(
                [r.json()["ui_mode"] for r in results], ["MIRAGE_HOLD"] * 3
            )
            self.assertEqual(results[0].json(), results[1].json())
            self.assertEqual(cancelled, {"sim", "cadence"})
            self.assertEqual(requests, {"sim": 1, "cadence": 1, "ordinary": 1})
            self.assertFalse(ordinary.done())
            release.set()
            self.assertEqual((await ordinary).json()["ui_mode"], "SUCCESS")
            for sid in cancelled:
                event = json.loads(app.state.store.session(sid)["event"])
                self.assertIsNone(event["map_point"])
                self.assertIsNone(event["scores"]["operator_mismatch_risk"])
                self.assertIn(
                    "IDENTITY_DEADLINE", {flag["code"] for flag in event["flags"]}
                )
            self.assertEqual(app.state.store.snapshot()[1]["sessions"], 3)

    async def test_admin_update_orders_concurrent_scoring_and_allows_preexisting_local_hold(
        self,
    ):
        reading, release_read = asyncio.Event(), asyncio.Event()
        changing, release_change = asyncio.Event(), asyncio.Event()
        calls = []
        banned = False

        async def handler(request):
            nonlocal banned
            if request.url.path.endswith("/ban"):
                changing.set()
                await release_change.wait()
                banned = True
                return httpx.Response(
                    200, json={"operator_id": "op_demo_owner", "status": "confirmed"}
                )
            sid = json.loads(request.content)["session_id"]
            calls.append(sid)
            if sid == "before":
                reading.set()
                await release_read.wait()
            return match(sid, banned)

        async with connected(handler) as (app, client):
            before = asyncio.create_task(
                client.post(INGEST, json=payload("normal", "before"))
            )
            await asyncio.wait_for(reading.wait(), 1)
            ban = asyncio.create_task(
                client.post(
                    "/api/v1/operators/op_demo_owner/ban",
                    headers={"Authorization": "Bearer test-analyst"},
                )
            )
            # Wait until the ban owns the writer entry and is draining the admitted read.
            async with asyncio.timeout(1):
                while not app.state.identity_access.entry.locked():
                    await asyncio.sleep(0)
            hold = await asyncio.wait_for(
                client.post(INGEST, json=payload("synthetic_touch", "physical")), 1
            )
            self.assertEqual(hold.json()["ui_mode"], "MIRAGE_HOLD")
            self.assertEqual(calls, ["before"])
            self.assertFalse(changing.is_set())
            release_read.set()
            self.assertEqual((await before).json()["ui_mode"], "SUCCESS")
            await asyncio.wait_for(changing.wait(), 1)
            after = asyncio.create_task(
                client.post(INGEST, json=payload("normal", "after"))
            )
            await asyncio.sleep(0)
            self.assertEqual(calls, ["before"])
            release_change.set()
            self.assertEqual((await ban).status_code, 200)
            self.assertEqual((await after).json()["ui_mode"], "MIRAGE_HOLD")
            self.assertEqual(calls, ["before", "after"])
