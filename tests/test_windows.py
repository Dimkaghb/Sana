import unittest

from contracts.windows import sliding_windows
from scripts.validate_contracts import FIXTURES, ROOT, load_json, validate_payload


class WindowTests(unittest.TestCase):
    def test_window_boundaries_and_missingness(self):
        payload = {
            "duration_ms": 3000,
            "keystrokes": [
                {"down_ms": 1000, "up_ms": 1500},
                {"down_ms": 2000, "up_ms": 2250},
            ],
        }
        rows = sliding_windows(payload)
        self.assertEqual([r["key_dwell"] for r in rows], [0.5, 0.375, 0.25, None])
        self.assertTrue(all(r["pressure"] is None for r in rows))
        self.assertEqual(len(sliding_windows({"duration_ms": 10**16})), 64)

    def test_contract_compatibility_and_fixture_parity(self):
        examples = load_json(ROOT / "frontend/src/window-fixtures.json")
        for path in FIXTURES.glob("*/telemetry.json"):
            payload = load_json(path)
            self.assertEqual(sliding_windows(payload), examples[payload["session_id"]])
        normal = load_json(FIXTURES / "normal/telemetry.json")
        contact = normal["contacts"][0]
        for invalid in (
            {**contact, "digit": "2"},
            {**contact, "up_ms": 0},
            {**contact, "field": "card_number"},
        ):
            self.assertTrue(validate_payload("A", {**normal, "contacts": [invalid]}))
