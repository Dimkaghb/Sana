"""HTTP boundary to the identity service and an explicit fixture-backed demo mode."""

import asyncio
import json
import math
import re
from urllib.parse import quote

import httpx

from scripts.validate_contracts import (
    FIXTURES,
    load_json,
    reject_constant,
    unique_object,
    validate_payload,
)


def valid_population(result):
    if not isinstance(result, dict) or set(result) != {"points", "clusters"}:
        return False
    for group, rows in result.items():
        if not isinstance(rows, list):
            return False
        for row in rows:
            if not isinstance(row, dict) or type(row.get("cluster_id")) is not int:
                return False
            if any(
                type(row.get(k)) not in (int, float) or not math.isfinite(row[k])
                for k in ("x", "y")
            ):
                return False
            if group == "clusters":
                if (
                    set(row) != {"cluster_id", "x", "y", "size"}
                    or type(row["size"]) is not int
                    or row["size"] < 0
                ):
                    return False
            else:
                labels = ("session_id", "account_id", "operator_id", "status")
                if (
                    set(row) != {"x", "y", "cluster_id", "synthetic", *labels}
                    or type(row["synthetic"]) is not bool
                ):
                    return False
                if any(
                    not isinstance(row[k], str) or not row[k] or len(row[k]) > 128
                    for k in labels
                ):
                    return False
    return True


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
            async with self.client.stream(
                method, self.config.ml_url + path, **kwargs
            ) as response:
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(body) + len(chunk) > 4 * 1024 * 1024:
                        raise ValueError("Identity response exceeds size limit")
                    body.extend(chunk)
                return json.loads(
                    body,
                    parse_constant=reject_constant,
                    object_pairs_hook=unique_object,
                )

    async def score(self, telemetry):
        if self.config.mode == "mock":
            # Replay known scenarios; other demo sessions use the labeled normal mock.
            base = self.fixtures.get(
                telemetry["session_id"], self.fixtures["sess_fixture_normal"]
            )
            result = json.loads(json.dumps(base))
            result["session_id"] = telemetry["session_id"]
            if telemetry["session_id"] not in self.fixtures:
                result["operator_reconciliation"]["linked_account_ids"] = [
                    telemetry["account_id"]
                ]
            return result
        try:
            result = await self.request("POST", "/ml/embed-and-score", json=telemetry)
            if (
                validate_payload("B", result, self.checks)
                or result["session_id"] != telemetry["session_id"]
            ):
                return None
            return result
        except (httpx.HTTPError, ValueError, TimeoutError, RecursionError):
            return None

    async def population(self):
        if self.config.mode == "mock":
            return {"points": [], "clusters": []}
        try:
            result = await self.request("GET", "/ml/population-map")
            if valid_population(result):
                return result
        except (
            httpx.HTTPError,
            ValueError,
            TimeoutError,
            RecursionError,
            OverflowError,
        ):
            pass
        return None

    async def fingerprint(self, session):
        try:
            result = await self.request(
                "GET",
                f"/ml/sessions/{quote(session, safe='')}/fingerprint",
                headers={"Authorization": f"Bearer {self.config.ml_token}"},
            )
            if isinstance(result, dict) and result.get("session_id") == session:
                value = result.get("operator_fingerprint")
                if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value):
                    return value
        except (
            httpx.HTTPError,
            ValueError,
            TimeoutError,
            RecursionError,
            OverflowError,
        ):
            pass
        return None

    async def ban(self, operator):
        if self.config.mode == "mock":
            return True
        try:
            result = await self.request(
                "POST",
                f"/ml/operators/{quote(operator, safe='')}/ban",
                headers={"Authorization": f"Bearer {self.config.ml_token}"},
            )
            return (
                isinstance(result, dict)
                and result.get("operator_id") == operator
                and result.get("status") == "confirmed"
            )
        except (
            httpx.HTTPError,
            ValueError,
            TimeoutError,
            RecursionError,
            OverflowError,
        ):
            return False
