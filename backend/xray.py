"""Validation for ephemeral demonstration telemetry."""

import json

from scripts.validate_contracts import reject_constant, unique_object

MAX_FRAME_LENGTH = 16_384
MAX_TIME = 86_400_000


def bounded(value, minimum, maximum):
    return type(value) in (int, float) and minimum <= value <= maximum


def array(value, limit):
    return isinstance(value, list) and len(value) <= limit


def valid_tap(tap):
    return (
        isinstance(tap, dict)
        and set(tap) == {"at", "trusted", "trace"}
        and bounded(tap["at"], 0, MAX_TIME)
        and isinstance(tap["trusted"], bool)
        and array(tap["trace"], 24)
        and all(array(p, 2) and len(p) == 2 and bounded(p[0], -40, 40)
                and bounded(p[1], -400, 400) for p in tap["trace"])
        and all(a[0] < b[0] for a, b in zip(tap["trace"], tap["trace"][1:]))
    )


def valid_swipe(point):
    return (
        array(point, 4) and len(point) == 4
        and bounded(point[0], 0, MAX_TIME)
        and bounded(point[1], 0, 1)
        and bounded(point[2], 0, 1)
        and type(point[3]) is int and 0 <= point[3] <= 100_000
    )


def valid_key(key):
    return array(key, 2) and len(key) == 2 and bounded(key[0], 0, MAX_TIME) and bounded(key[1], key[0], MAX_TIME)


def parse_frame(raw):
    if not isinstance(raw, str) or len(raw) > MAX_FRAME_LENGTH:
        return None
    try:
        frame = json.loads(raw, parse_constant=reject_constant, object_pairs_hook=unique_object)
    except (ValueError, RecursionError):
        return None
    if (
        not isinstance(frame, dict)
        or set(frame) != {"type", "taps", "swipes", "keys"}
        or frame["type"] != "XRAY_FRAME"
    ):
        return None
    for field, limit, validate in (("taps", 12, valid_tap), ("swipes", 48, valid_swipe), ("keys", 24, valid_key)):
        if not array(frame[field], limit) or not all(map(validate, frame[field])):
            return None
    return frame
