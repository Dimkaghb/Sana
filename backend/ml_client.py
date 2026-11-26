"""HTTP boundary to the identity service and an explicit fixture-backed demo mode."""
import asyncio
import json
from urllib.parse import quote

import httpx

from scripts.validate_contracts import FIXTURES, load_json, validate_payload


class IdentityService:
    def __init__(self, config, client, checks):
        self.config = config
        self.client = client
        self.checks = checks
        self.fixtures = {}
        if config.mode == "mock":
            for path in FIXTURES.glob("*/ml-score.json"):
                score = load_json(path)
                self.fixtures[score["session_id"]] = score

    async def request(self, method, path, **kwargs):
        async with asyncio.timeout(1.5):
            response = await self.client.request(method, self.config.ml_url + path, **kwargs)
            response.raise_for_status()
            return response.json()

    async def score(self, telemetry):
        if self.config.mode == "mock":
            # Replay known scenarios; other demo sessions use the labeled normal mock.
            base = self.fixtures.get(telemetry["session_id"], self.fixtures["sess_fixture_normal"])
            result = json.loads(json.dumps(base))
            result["session_id"] = telemetry["session_id"]
            if telemetry["session_id"] not in self.fixtures:
                result["operator_reconciliation"]["linked_account_ids"] = [telemetry["account_id"]]
            return result
        try:
            result = await self.request("POST", "/ml/embed-and-score", json=telemetry)
            if validate_payload("B", result, self.checks) or result["session_id"] != telemetry["session_id"]:
                return None
            return result
        except (httpx.HTTPError, ValueError, TimeoutError, RecursionError):
            return None

    async def population(self):
        if self.config.mode == "mock":
            return {"points": [], "clusters": []}
        try:
            result = await self.request("GET", "/ml/population-map")
            if isinstance(result, dict) and all(isinstance(result.get(k), list) for k in ("points", "clusters")):
                return result
        except (httpx.HTTPError, ValueError, TimeoutError):
            pass
        return None

    async def ban(self, operator):
        if self.config.mode == "mock":
            return True
        try:
            result = await self.request("POST", f"/ml/operators/{quote(operator, safe='')}/ban",
                                        headers={"Authorization": f"Bearer {self.config.ml_token}"})
            return isinstance(result, dict) and result.get("operator_id") == operator and result.get("status") == "confirmed"
        except (httpx.HTTPError, ValueError, TimeoutError):
            return False
