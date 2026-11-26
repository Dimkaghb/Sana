"""Kinematic statistics. NaN means unobserved until training-set imputation."""

from dataclasses import dataclass

import numpy as np
from contracts.windows import CHANNELS, MAX_WINDOWS, sliding_windows

NAMES = (
    "dwell_mean dwell_std dwell_p90 iki_mean iki_std iki_iqr iki_skew backspace_ratio "
    "key_dx_mean key_dy_mean v_mean v_max v_std accel_peak jerk_peak peak_time_ratio "
    "arc_mean arc_max radius_x_mean radius_y_mean aspect_ratio slider_duration "
    "beta_mean beta_std gamma_mean gamma_std tilt_coupling recoil_mean recoil_std "
    "recoil_decay_ms power_0_4 power_4_8 power_8_12 ax_std ay_std az_std"
).split()


class InsufficientEvidence(ValueError):
    pass


@dataclass
class Features:
    stats: np.ndarray
    sequence: np.ndarray
    modalities: int
    windows: np.ndarray


def column(rows, key):
    return np.array([row[key] for row in rows], dtype=np.float64)


def interpolate(times, values, grid, max_gap):
    """Interpolate inside observed continuous segments only."""
    if len(times) < 2:
        return np.full(len(grid), np.nan)
    right = np.clip(np.searchsorted(times, grid), 1, len(times) - 1)
    valid = (
        (times[right] - times[right - 1] <= max_gap)
        & (grid >= times[0])
        & (grid <= times[-1])
    )
    return np.where(valid, np.interp(grid, times, values), np.nan)


def extract(payload):
    keys, taps, slide, imu = (
        payload[k] for k in ("keystrokes", "taps", "slider_trace", "imu_samples")
    )
    stats = np.full(36, np.nan)
    modalities = 0
    if len(keys) >= 3:
        down = column(keys, "down_ms")
        dwell = column(keys, "up_ms") - down
        gaps = np.diff(down)
        spread = gaps.std()
        stats[:10] = [
            dwell.mean(),
            dwell.std(),
            np.percentile(dwell, 90),
            gaps.mean(),
            spread,
            np.ptp(np.percentile(gaps, [25, 75])),
            np.mean(((gaps - gaps.mean()) / spread) ** 3) if spread > 1e-8 else 0,
            np.mean([k["key_group"] == "backspace" for k in keys]),
            column(keys, "dx_norm").mean(),
            column(keys, "dy_norm").mean(),
        ]
        modalities += 1

    st = column(slide, "t_ms")
    sx, sy = column(slide, "x_norm"), column(slide, "y_norm")
    if len(st):
        st, indices = np.unique(st, return_index=True)
        sx, sy = sx[indices], sy[indices]
    if len(st) >= 4 and st[-1] > st[0]:
        seconds = st / 1000
        velocity = np.hypot(np.diff(sx), np.diff(sy)) / np.diff(seconds)
        mid = (seconds[1:] + seconds[:-1]) / 2
        acceleration = np.diff(velocity) / np.diff(mid)
        jerk = np.diff(acceleration) / np.diff((mid[1:] + mid[:-1]) / 2)
        dx, dy = sx[-1] - sx[0], sy[-1] - sy[0]
        arc = ((sy - sy[0]) * dx - (sx - sx[0]) * dy) / max(np.hypot(dx, dy), 1e-8)
        stats[10:18] = [
            velocity.mean(),
            velocity.max(),
            velocity.std(),
            np.abs(acceleration).max(),
            np.abs(jerk).max(),
            (mid[np.argmax(velocity)] - seconds[0]) / np.ptp(seconds),
            arc.mean(),
            np.abs(arc).max(),
        ]
        stats[21] = st[-1] - st[0]
        modalities += 1

    trusted = [
        t for t in taps if t["is_trusted"] and t["radius_x"] > 0 and t["radius_y"] > 0
    ]
    if len(trusted) >= 2:
        rx, ry = column(trusted, "radius_x"), column(trusted, "radius_y")
        stats[18:21] = [rx.mean(), ry.mean(), (rx / ry).mean()]
        modalities += 1

    times = column(imu, "t_ms")
    grid = (
        np.linspace(st[0], st[-1], 64)
        if len(st) >= 2
        else (
            np.linspace(times[0], times[-1], 64) if len(times) >= 2 else np.arange(64)
        )
    )
    sequence = np.full((64, 6), np.nan)
    if len(st) >= 2:
        sequence[:, 0] = interpolate(st, sx - sx[0], grid, 150)
        sequence[:, 1] = interpolate(st, sy - sy[0], grid, 150)
    if len(times) >= 4 and times[-1] > times[0]:
        times, indices = np.unique(times, return_index=True)
        accel = np.stack([column(imu, k)[indices] for k in ("ax", "ay", "az")], axis=1)
        beta, gamma = column(imu, "beta")[indices], column(imu, "gamma")[indices]
        stats[22:26] = [beta.mean(), beta.std(), gamma.mean(), gamma.std()]
        stats[33:36] = accel.std(axis=0)
        for i, signal in enumerate([*accel.T, gamma / 90]):
            sequence[:, i + 2] = interpolate(times, signal, grid, 60)
        if len(trusted) >= 3:
            roll = interpolate(times, gamma, column(trusted, "t_ms"), 60)
            valid = np.isfinite(roll)
            x = column(trusted, "x_norm")[valid]
            if valid.sum() >= 3 and x.std() > 1e-6 and roll[valid].std() > 1e-6:
                stats[26] = np.corrcoef(x, roll[valid])[0, 1]
        peaks, decays = [], []
        for tap in trusted:
            at = tap["t_ms"]
            left, middle, impact, right = np.searchsorted(
                times, [at - 40, at - 15, at - 5, at + 35]
            )
            if middle - left < 2 or right - impact < 2:
                continue
            pulse = np.abs(accel[impact:right, 2] - np.median(accel[left:middle, 2]))
            peak_i = int(np.argmax(pulse))
            peaks.append(pulse[peak_i])
            after = np.flatnonzero(pulse[peak_i + 1 :] <= pulse[peak_i] / np.e)
            if after.size:
                decays.append(
                    times[impact + peak_i + 1 + after[0]] - times[impact + peak_i]
                )
        if peaks:
            stats[27:29] = np.mean(peaks), np.std(peaks)
        if decays:
            stats[29] = np.mean(decays)
        interval = np.median(np.diff(times))
        if (
            1 <= interval < 40
            and np.ptp(times) >= 800
            and np.max(np.diff(times)) <= 2.5 * interval
        ):
            regular = np.arange(times[0], times[-1], interval)
            z = np.interp(regular, times, accel[:, 2])
            power = np.abs(np.fft.rfft((z - z.mean()) * np.hanning(len(z)))) ** 2
            freq = np.fft.rfftfreq(len(z), interval / 1000)
            for idx, low in enumerate((0, 4, 8)):
                stats[30 + idx] = power[(freq >= low) & (freq < low + 4)].sum() / max(
                    power.sum(), 1e-12
                )
        if len(times) >= 8 and np.ptp(times) >= 200:
            modalities += 1
    if modalities < 2:
        raise InsufficientEvidence(
            "At least two usable motion, slider, contact, or key streams are required"
        )
    finite = stats[np.isfinite(stats)]
    if (
        np.any(np.abs(finite) > 1e14)
        or np.any(np.isinf(stats))
        or np.any(np.isinf(sequence))
    ):
        raise InsufficientEvidence("Measurements exceed supported numerical range")
    windows = np.full((MAX_WINDOWS, len(CHANNELS)), np.nan, dtype=np.float32)
    for i, window in enumerate(sliding_windows(payload)):
        windows[i] = [window[channel] for channel in CHANNELS]
    return Features(
        stats.astype("float32"), sequence.astype("float32"), modalities, windows
    )
