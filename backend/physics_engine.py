"""Session-relative tap analysis. No observations are synthesized."""

import itertools
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from math import hypot
from statistics import mean, pstdev

from .config import Policy


def flag(code, severity, title, detail):
    return {"code": code, "severity": severity, "title": title, "detail": detail}


@dataclass
class Evidence:
    score: int | None = None
    flags: list[dict] = field(default_factory=list)
    waveform: list[dict] = field(default_factory=list)
    measurements: dict = field(default_factory=dict)


def slider_uniformity(trace):
    """Coefficient of variation for a sufficiently long, ordered slider gesture."""
    if len(trace) < 8 or trace[-1]["t_ms"] - trace[0]["t_ms"] < 120:
        return None
    speeds = []
    for a, b in itertools.pairwise(trace):
        elapsed = b["t_ms"] - a["t_ms"]
        if not 0.25 <= elapsed <= 80:
            return None
        speeds.append(
            hypot(b["x_norm"] - a["x_norm"], b["y_norm"] - a["y_norm"]) / elapsed
        )
    average = mean(speeds)
    return pstdev(speeds) / average if average > 0 else None


def analyze_tap_recoil(payload, policy: Policy) -> Evidence:
    samples = payload["imu_samples"]
    times = [s["t_ms"] for s in samples]
    result = Evidence()
    covered = 0
    latest_covered = None
    slider_cv = slider_uniformity(payload["slider_trace"])
    taps = payload["taps"]
    result.measurements["slider_speed_cv"] = slider_cv
    radii = [tap["radius_x"] for tap in taps]
    result.measurements["radius_x_std_px"] = pstdev(radii) if len(radii) >= 2 else None
    for tap in payload["taps"]:
        at = tap["t_ms"]
        window = samples[bisect_left(times, at - 40) : bisect_right(times, at + 40)]
        baseline = [s["az"] for s in window if at - 40 <= s["t_ms"] <= at - 15]
        impact = [s["az"] for s in window if at - 5 <= s["t_ms"] <= at + 35]
        # Require observed samples before and after contact, with no large gap.
        if not baseline or len(impact) < 2 or window[-1]["t_ms"] < at + 10:
            continue
        if any(
            not 0 < b["t_ms"] - a["t_ms"] <= 25 for a, b in itertools.pairwise(window)
        ):
            continue
        rest = mean(baseline)
        peak = max(abs(z - rest) for z in impact)
        covered += 1
        latest_covered = at
        weak = peak < policy.recoil_floor
        suspect_event = not tap["is_trusted"]
        empty_contact = tap["radius_x"] == tap["radius_y"] == 0
        score = 0
        if weak:
            score = min(
                100,
                55
                + 30 * suspect_event
                + 10 * empty_contact
                + 10 * (slider_cv is not None and slider_cv < 0.025),
            )
        elif suspect_event:
            score = 50
        if result.score is not None and score <= result.score:
            continue
        result.score = score
        result.waveform = [
            {"t_ms": s["t_ms"] - at, "az_delta": s["az"] - rest} for s in window
        ]
        result.measurements.update(
            peak_m_s2=peak, tap_ms=at, is_trusted=tap["is_trusted"]
        )
        if weak:
            result.flags = [
                flag(
                    "ZERO_RECOIL_RAT",
                    "CRITICAL" if score >= policy.hold_threshold else "WARNING",
                    "Low tap recoil",
                    f"Observed peak {peak:.4f} m/s² in a covered tap window.",
                )
            ]
        else:
            result.flags = []
    result.measurements.update(covered_taps=covered, total_taps=len(payload["taps"]))
    if (
        taps
        and latest_covered != taps[-1]["t_ms"]
        and (result.score or 0) < policy.hold_threshold
    ):
        # Earlier observed recoil cannot establish coverage of the final interaction.
        result.score = None
    if result.score is None:
        result.flags.append(
            flag(
                "RECOIL_UNAVAILABLE",
                "INFO",
                "Tap recoil unavailable",
                "The final interaction lacked sufficient overlapping motion samples.",
            )
        )
    return result
