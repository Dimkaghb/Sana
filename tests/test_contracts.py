"""Regression checks for shared boundaries, not detector accuracy tests."""

from copy import deepcopy
import tempfile
from pathlib import Path
import unittest

from scripts.validate_contracts import (
    FIXTURES, load_json, validate_bundle, validate_payload,
    validate_repository, validators,
)


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.checks = validators()
        cls.normal = {
            letter: load_json(FIXTURES / "normal" / filename)
            for letter, filename in {
                "A": "telemetry.json", "B": "ml-score.json",
                "C": "dashboard-event.json", "D": "mobile-decision.json",
            }.items()
        }

    def payload(self, letter):
        return deepcopy(self.normal[letter])

    def invalid(self, letter, payload):
        self.assertTrue(validate_payload(letter, payload, self.checks))

    def test_all_registered_fixtures_validate(self):
        errors, count, scenarios = validate_repository()
        self.assertEqual(errors, [])
        self.assertEqual((count, scenarios), (27, 7))

    def test_raw_sensitive_fields_are_rejected(self):
        for field in ("card_number", "phone_number", "recipient_name", "input_value"):
            with self.subTest(field=field):
                payload = self.payload("A")
                payload[field] = "forbidden fixture text"
                self.invalid("A", payload)
        payload = self.payload("A")
        payload["keystrokes"][0]["key"] = "7"
        self.invalid("A", payload)

    def test_actual_digit_is_not_a_key_group(self):
        payload = self.payload("A")
        payload["keystrokes"][0]["key_group"] = "7"
        self.invalid("A", payload)

    def test_missing_required_field_is_rejected(self):
        for letter in self.normal:
            with self.subTest(contract=letter):
                payload = self.payload(letter)
                del payload["session_id"]
                self.invalid(letter, payload)

    def test_coordinates_and_pressure_are_bounded(self):
        for stream, key, value in (("taps", "x_norm", 1.01),
                                   ("taps", "y_norm", -0.01),
                                   ("slider_trace", "pressure", 1.1)):
            with self.subTest(field=key):
                payload = self.payload("A")
                payload[stream][0][key] = value
                self.invalid("A", payload)

    def test_native_trust_requires_boolean(self):
        payload = self.payload("A")
        payload["taps"][0]["is_trusted"] = "true"
        self.invalid("A", payload)

    def test_negative_amount_and_impossible_key_duration(self):
        payload = self.payload("A")
        payload["transfer_context"]["amount_kzt"] = -1
        self.invalid("A", payload)
        payload = self.payload("A")
        payload["keystrokes"][0]["up_ms"] = 1
        self.invalid("A", payload)

    def test_timestamps_are_ordered_and_inside_session(self):
        payload = self.payload("A")
        payload["imu_samples"].reverse()
        self.invalid("A", payload)
        payload = self.payload("A")
        payload["taps"][-1]["t_ms"] = payload["duration_ms"] + 1
        self.invalid("A", payload)

    def test_imu_window_is_bounded(self):
        payload = self.payload("A")
        payload["duration_ms"] = 21000
        payload["imu_samples"][-1]["t_ms"] = 21000
        self.invalid("A", payload)
        payload = self.payload("A")
        payload["duration_ms"] = 25001
        self.invalid("A", payload)

    def test_fixture_waveforms_use_the_documented_baseline(self):
        manifest = load_json(FIXTURES / "manifest.json")
        for scenario in manifest["scenarios"]:
            if "C" not in scenario["contracts"]:
                continue
            with self.subTest(scenario=scenario["name"]):
                telemetry = load_json(FIXTURES / scenario["contracts"]["A"])
                dashboard = load_json(FIXTURES / scenario["contracts"]["C"])
                if not telemetry["imu_samples"]:
                    self.assertEqual(dashboard["recoil_waveform"], [])
                    continue
                tap = telemetry["taps"][0]["t_ms"]
                baseline_samples = [s["az"] for s in telemetry["imu_samples"]
                                    if tap - 40 <= s["t_ms"] <= tap - 15]
                self.assertTrue(baseline_samples)
                baseline = sum(baseline_samples) / len(baseline_samples)
                impact_samples = [s for s in telemetry["imu_samples"]
                                  if tap - 40 <= s["t_ms"] <= tap + 40]
                self.assertEqual(len(dashboard["recoil_waveform"]), len(impact_samples))
                for point, sample in zip(dashboard["recoil_waveform"], impact_samples):
                    self.assertAlmostEqual(point["t_ms"], sample["t_ms"] - tap, places=3)
                    self.assertAlmostEqual(point["az_delta"], sample["az"] - baseline,
                                           delta=0.5e-6 + 1e-15)

    def test_absent_sensors_are_empty_not_flat_samples(self):
        payload = load_json(FIXTURES / "missing_sensors" / "telemetry.json")
        self.assertEqual(payload["imu_samples"], [])
        self.assertEqual(validate_payload("A", payload, self.checks), [])
        payload["device_meta"]["sample_rate_hz"] = 60
        self.invalid("A", payload)
        manifest = load_json(FIXTURES / "manifest.json")
        scenario = next(s for s in manifest["scenarios"] if s["name"] == "missing_sensors")
        self.assertEqual(set(scenario["contracts"]), {"A", "C", "D"})
        event = load_json(FIXTURES / scenario["contracts"]["C"])
        self.assertIsNone(event["scores"]["anti_rat_physics_risk"])
        self.assertIsNone(event["map_point"])
        self.assertEqual(event["decision"], "STEP_UP_LIVENESS")

    def test_nonfinite_measurements_are_rejected(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                payload = self.payload("A")
                payload["imu_samples"][0]["az"] = value
                self.invalid("A", payload)

    def test_json_duplicate_properties_and_nan_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            for source in ('{"session_id":"one","session_id":"two"}', '{"az":NaN}'):
                path.write_text(source, encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_json(path)

    def test_ml_dimension_confidence_and_ring_consistency(self):
        payload = self.payload("B")
        payload["embedding_dim"] = 64
        self.invalid("B", payload)
        for key, value in (("match_confidence", 1.01), ("ring_size", 2)):
            payload = self.payload("B")
            payload["operator_reconciliation"][key] = value
            self.invalid("B", payload)
        payload = self.payload("B")
        payload["operator_reconciliation"]["linked_account_ids"] *= 2
        self.invalid("B", payload)

    def test_risk_and_timestamp_validation(self):
        payload = self.payload("C")
        payload["overall_risk_score"] = 101
        self.invalid("C", payload)
        for timestamp in ("not a date", "2026-13-26T14:22:01Z", "2026-11-26T14:22:01+05:00"):
            payload = self.payload("C")
            payload["timestamp"] = timestamp
            self.invalid("C", payload)

    def test_exact_mobile_modes_and_guardian_boolean(self):
        for mode in ("SUCCESS", "MIRAGE_HOLD", "STEALTH_HOLD", "STEP_UP_LIVENESS"):
            payload = self.payload("D")
            payload["ui_mode"] = mode
            self.assertEqual(validate_payload("D", payload, self.checks), [])
        payload["ui_mode"] = "BLOCKED"
        self.invalid("D", payload)
        payload = self.payload("D")
        payload["guardian_notified"] = "true"
        self.invalid("D", payload)

    def test_cross_contract_identity_and_decision_mismatches(self):
        for letter, key, value in (("B", "session_id", "wrong"),
                                   ("C", "account_id", "wrong"),
                                   ("D", "ui_mode", "MIRAGE_HOLD")):
            bundle = deepcopy(self.normal)
            bundle[letter][key] = value
            self.assertTrue(validate_bundle(bundle))

    def test_cross_contract_map_and_operator_mismatches(self):
        for key, value in (("x", 999), ("cluster_id", 999), ("operator_id", "wrong")):
            bundle = deepcopy(self.normal)
            bundle["C"]["map_point"][key] = value
            self.assertTrue(validate_bundle(bundle))

    def test_synthetic_fixture_provenance_is_explicit(self):
        payload = load_json(FIXTURES / "synthetic_touch" / "telemetry.json")
        self.assertTrue(payload["imu_samples"])
        self.assertTrue(all(not t["is_trusted"] for t in payload["taps"]))
        self.assertTrue(all(s["az"] == 0 for s in payload["imu_samples"]))
        for scenario in load_json(FIXTURES / "manifest.json")["scenarios"]:
            self.assertIs(scenario["synthetic"], True)


if __name__ == "__main__":
    unittest.main()
