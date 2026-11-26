"""Validate PRD schemas, synthetic examples, and cross-contract invariants."""

from __future__ import annotations

import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "contracts" / "fixtures"
SCHEMA_FILES = {
    "A": "session-telemetry.schema.json",
    "B": "ml-score.schema.json",
    "C": "dashboard-event.schema.json",
    "D": "mobile-decision.schema.json",
}
FORMATS = FormatChecker()


@FORMATS.checks("date-time", raises=(ValueError, TypeError))
def valid_datetime(value):
    if not isinstance(value, str):
        return True  # The schema checks the type independently.
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value):
        return False
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return True


def reject_constant(value):
    raise ValueError(f"Non-finite JSON constant: {value}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON property: {key}")
        result[key] = value
    return result


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      parse_constant=reject_constant, object_pairs_hook=unique_object)


def finite_errors(value, path="$"):
    if isinstance(value, float) and not math.isfinite(value):
        yield f"{path}: numeric value must be finite"
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from finite_errors(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from finite_errors(item, f"{path}[{index}]")


def validators():
    result = {}
    for letter, filename in SCHEMA_FILES.items():
        schema = load_json(ROOT / "contracts" / "schemas" / filename)
        Draft202012Validator.check_schema(schema)
        result[letter] = Draft202012Validator(schema, format_checker=FORMATS)
    return result


def validate_payload(letter, payload, checks=None):
    checks = checks if checks is not None else validators()
    errors = list(finite_errors(payload))
    errors.extend(f"{error.json_path}: {error.message}" for error in checks[letter].iter_errors(payload))
    if errors:
        return errors
    if letter == "A":
        duration = payload["duration_ms"]
        for stream, key in (("keystrokes", "down_ms"), ("taps", "t_ms"),
                            ("slider_trace", "t_ms"), ("imu_samples", "t_ms")):
            times = [event[key] for event in payload[stream]]
            if times != sorted(times):
                errors.append(f"{stream}: timestamps must be nondecreasing")
            if any(t > duration for t in times):
                errors.append(f"{stream}: timestamp exceeds duration_ms")
        contacts = payload.get("contacts", [])
        if any(a["down_ms"] > b["down_ms"] for a, b in zip(contacts, contacts[1:])):
            errors.append("contacts: timestamps must be nondecreasing")
        for event in [*payload["keystrokes"], *contacts]:
            if not event["down_ms"] <= event["up_ms"] <= duration:
                errors.append("timing: require down_ms <= up_ms <= duration_ms")
        samples = payload["imu_samples"]
        if samples and samples[-1]["t_ms"] - samples[0]["t_ms"] > 20000:
            errors.append("imu_samples: retained window exceeds 20 seconds")
        if samples and samples[0]["t_ms"] < max(0, duration - 20000):
            errors.append("imu_samples: samples fall outside the last 20 seconds")
        rate = payload["device_meta"]["sample_rate_hz"]
        if bool(samples) != (rate > 0):
            errors.append("sample_rate_hz must be positive with samples and zero without samples")
    if letter == "B":
        reconciliation = payload["operator_reconciliation"]
        if reconciliation["ring_size"] != len(reconciliation["linked_account_ids"]):
            errors.append("ring_size must equal the number of distinct linked_account_ids")
    if letter == "C" and (explanation := payload.get("decision_explanation")):
        ids = [record["id"] for record in explanation.get("evidence", [])]
        if len(ids) != len(set(ids)):
            errors.append("decision_explanation.evidence: IDs must be unique")
        if any(set(rule.get("evidence_ids", [])) - set(ids) for rule in explanation["reasons"]):
            errors.append("decision_explanation.reasons: unknown evidence reference")
    return errors


def validate_bundle(bundle):
    errors = []
    ids = {payload["session_id"] for payload in bundle.values()}
    if len(ids) != 1:
        errors.append("session_id must agree across all contracts")
    if "A" in bundle and "C" in bundle and bundle["A"]["account_id"] != bundle["C"]["account_id"]:
        errors.append("account_id must agree across A and C")
    if "C" in bundle and "D" in bundle and bundle["C"]["decision"] != bundle["D"]["ui_mode"]:
        errors.append("C decision must equal D ui_mode")
    if "B" in bundle and "C" in bundle:
        b, c = bundle["B"], bundle["C"]
        if c["map_point"] is None:
            return errors + ["C must include the available B map point"]
        for key in ("x", "y", "cluster_id"):
            if b["map_point"][key] != c["map_point"][key]:
                errors.append(f"map_point.{key} must agree across B and C")
        if b["operator_reconciliation"]["matched_operator_id"] != c["map_point"]["operator_id"]:
            errors.append("operator_id must agree across B and C")
    return errors


def validate_repository():
    checks = validators()
    manifest = load_json(FIXTURES / "manifest.json")
    errors, seen_files, seen_scenarios = [], set(), set()
    for scenario in manifest["scenarios"]:
        name = scenario["name"]
        if name in seen_scenarios:
            errors.append(f"Duplicate scenario: {name}")
        seen_scenarios.add(name)
        if scenario.get("synthetic") is not True:
            errors.append(f"{name}: must be labeled synthetic")
        bundle, valid = {}, True
        for letter, relative in scenario["contracts"].items():
            path = (FIXTURES / relative).resolve()
            if not path.is_relative_to(FIXTURES.resolve()) or letter not in checks:
                errors.append(f"{name}: invalid fixture path or contract")
                valid = False
                continue
            if path in seen_files:
                errors.append(f"{name}: fixture registered more than once: {relative}")
            seen_files.add(path)
            payload = load_json(path)
            issues = validate_payload(letter, payload, checks)
            errors.extend(f"{name}/{letter}: {issue}" for issue in issues)
            valid = valid and not issues
            bundle[letter] = payload
        if valid:
            errors.extend(f"{name}: {issue}" for issue in validate_bundle(bundle))
    actual_files = {p.resolve() for p in FIXTURES.rglob("*.json") if p.name != "manifest.json"}
    for path in actual_files - seen_files:
        errors.append(f"Unregistered fixture: {path.relative_to(FIXTURES)}")
    return errors, len(seen_files), len(seen_scenarios)


def main():
    try:
        errors, fixtures, scenarios = validate_repository()
    except (ValueError, OSError, KeyError) as exc:
        print(f"Contract validation failed: {exc}", file=sys.stderr)
        return 1
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Validated 4 schemas and {fixtures} fixtures across {scenarios} synthetic scenarios.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
