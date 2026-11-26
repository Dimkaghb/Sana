"""Exploratory cadence and movement indicators for the simulated decision."""

import numpy as np
from numpy.fft import rfft, rfftfreq

from .physics_engine import Evidence, flag

DIGIT_GAP_MS = 300
PAUSE_MIN_MS = 900


def cadence_pattern(keys):
    """Return the first run of bursts that satisfies the cadence rule."""
    size, previous, preceding_pause = 0, None, None
    sizes, pauses = [], []

    def finish_burst():
        if 2 <= size <= 4:
            if sizes:
                pauses.append(preceding_pause)
            sizes.append(size)
        else:
            sizes.clear()
            pauses.clear()
        return len(sizes) == 3

    for key in keys:
        time = key["down_ms"]
        gap = time - previous if previous is not None else None
        digit = key["key_group"] == "digit"
        if not digit or gap is None or gap >= DIGIT_GAP_MS:
            if finish_burst():
                return sizes, pauses
            if not digit or gap is None or gap <= PAUSE_MIN_MS:
                sizes.clear()
                pauses.clear()
            preceding_pause = gap
            size = 0
        if digit:
            size += 1
        previous = time if digit else None
    return (sizes, pauses) if finish_burst() else None


def repeated_bursts(keys):
    return cadence_pattern(keys) is not None


def motion_indicators(samples, measurements=None):
    if len(samples) < 65:
        return None, None
    times = np.array([s["t_ms"] for s in samples]) / 1000
    # Analyze the longest contiguous recording. Effective frequency and
    # Nyquist margin come from actual timestamps, independent of device labels.
    breaks = np.where((np.diff(times) > 0.05) | (np.diff(times) <= 0))[0] + 1
    sections = np.split(np.arange(len(times)), breaks)
    idx = max(sections, key=lambda i: times[i[-1]] - times[i[0]])
    times = times[idx]
    if len(idx) < 65 or times[-1] - times[0] < 2 or np.median(np.diff(times)) > 0.03:
        return None, None
    grid = np.arange(times[0], times[-1], 1 / 40)
    axes = np.array(
        [[samples[i][key] for i in idx] for key in ("ax", "ay", "az", "beta")]
    )
    motion = np.array([np.interp(grid, times, axis) for axis in axes])
    acceleration = motion[:3]
    acceleration -= acceleration.mean(axis=1, keepdims=True)
    power = (abs(rfft(acceleration * np.hanning(len(grid)), axis=1)) ** 2).sum(
        axis=0
    )
    hz = rfftfreq(len(grid), 1 / 40)
    total = power[(hz >= 1) & (hz <= 16)].sum()
    ratio = float(power[(hz >= 8) & (hz <= 12)].sum() / total) if total > 0 else 0.0
    # A ratio alone can be large even at the instrument noise floor.
    rms = float(np.sqrt((acceleration**2).mean()))
    tremor = ratio > 0.50 and rms > 0.035
    posture = np.convolve(motion[3], np.ones(9) / 9, mode="valid")
    transitions, previous = 0, None
    for angle in posture:
        state = "upright" if angle >= 75 else "reading" if angle <= 55 else None
        if state is not None:
            transitions += previous is not None and previous != state
            previous = state
    if measurements is not None:
        measurements.update(
            motion_window_ms=float((times[-1] - times[0]) * 1000),
            tremor_band_fraction=ratio,
            acceleration_rms_m_s2=rms,
        )
    return tremor, transitions


def analyze_coercion(payload):
    keys = payload["keystrokes"]
    result = Evidence()
    tremor, transitions = motion_indicators(payload["imu_samples"], result.measurements)
    result.measurements["paired_keys"] = len(keys)
    if len(keys) >= 6 or tremor is not None:
        result.score = 0
    pattern = cadence_pattern(keys)
    if pattern:
        sizes, pauses = pattern
        result.measurements.update(burst_sizes=sizes, burst_pauses_ms=pauses)
        result.score = 80
        result.flags.append(
            flag(
                "DICTATION_COERCION",
                "WARNING",
                "Repeated digit bursts",
                f"Three rapid digit groups were separated by pauses of {pauses[0]:.0f} ms and {pauses[1]:.0f} ms.",
            )
        )
    if tremor:
        result.score = max(result.score or 0, 42)
        result.flags.append(
            flag(
                "HAND_TREMOR",
                "WARNING",
                "Motion energy at 8–12 Hz",
                "Observed a narrow-band acceleration pattern.",
            )
        )
    if transitions is not None and transitions >= 3:
        result.score = min(100, (result.score or 0) + 12)
        result.flags.append(
            flag(
                "POSTURE_CHANGE",
                "INFO",
                "Repeated posture changes",
                "Smoothed pitch crossed both posture thresholds repeatedly.",
            )
        )
    result.measurements.update(tremor_indicator=tremor, posture_transitions=transitions)
    return result
