"""Shared, bounded event-time windows for the analyst trace and temporal encoder."""

from bisect import bisect_left
from math import hypot
from statistics import fmean

WIDTH_MS = 2000
STRIDE_MS = 1000
MAX_WINDOWS = 64
CHANNELS = (
    "key_dwell",
    "contact_dwell",
    "pressure",
    "motion",
    "travel",
    "key_interval",
)


def sliding_windows(payload):
    """Half-open windows, plus the final observation. None means no usable sample."""
    duration = payload["duration_ms"]
    last = int(duration // STRIDE_MS)
    streams = {}
    for name, key in (
        ("keystrokes", "down_ms"),
        ("contacts", "down_ms"),
        ("slider_trace", "t_ms"),
        ("imu_samples", "t_ms"),
    ):
        rows = payload.get(name, [])
        streams[name] = ([row[key] for row in rows], rows)

    def mean(values):
        return round(fmean(values), 6) if values else None

    result = []
    for tick in range(max(0, last - MAX_WINDOWS + 1), last + 1):
        start = tick * STRIDE_MS
        end = start + WIDTH_MS
        groups = []
        for times, rows in streams.values():
            groups.append(rows[bisect_left(times, start) : bisect_left(times, end)])
        keys, contacts, slider, motion = groups
        values = [
            mean(
                [
                    min(1, (k["up_ms"] - k["down_ms"]) / 1000)
                    for k in keys
                    if k["up_ms"] < end
                ]
            ),
            mean(
                [
                    min(1, (c["up_ms"] - c["down_ms"]) / 1000)
                    for c in contacts
                    if c["up_ms"] < end
                ]
            ),
            mean([s["pressure"] for s in slider]),
            mean([min(1, hypot(m["ax"], m["ay"], m["az"]) / 9.80665) for m in motion]),
            mean(
                [
                    min(
                        1,
                        hypot(b["x_norm"] - a["x_norm"], b["y_norm"] - a["y_norm"])
                        * 1000
                        / (b["t_ms"] - a["t_ms"]),
                    )
                    for a, b in zip(slider, slider[1:])
                    if 0 < b["t_ms"] - a["t_ms"] <= 150
                ]
            ),
            mean(
                [
                    min(1, (b["down_ms"] - a["down_ms"]) / 2000)
                    for a, b in zip(keys, keys[1:])
                ]
            ),
        ]
        result.append(
            {
                "start_ms": start,
                "end_ms": min(end, duration),
                **dict(zip(CHANNELS, values)),
            }
        )
    return result
