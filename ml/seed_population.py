"""Deterministic synthetic Contract A population for training and rehearsals."""

import numpy as np


def session(person, sample, seed=42):
    profile = np.random.default_rng([seed, person])
    rng = np.random.default_rng([seed, person, sample, 1])
    dwell, iki, dx, dy, roll, pitch, arc, radius, speed, freq = profile.uniform(
        [48, 105, -0.45, -0.35, -38, 12, -0.18, 4, 350, 1],
        [140, 290, 0.45, 0.35, 38, 68, 0.18, 14, 900, 10],
    )
    keys, taps = [], []
    down = 120
    for _ in range(9):
        down += max(50, rng.normal(iki, 12))
        keys.append(
            dict(
                key_group="digit",
                down_ms=down,
                up_ms=down + max(25, rng.normal(dwell, 5)),
                dx_norm=np.clip(rng.normal(dx, 0.05), -1, 1),
                dy_norm=np.clip(rng.normal(dy, 0.05), -1, 1),
            )
        )
        taps.append(
            dict(
                t_ms=down,
                x_norm=rng.uniform(0.2, 0.8),
                y_norm=rng.uniform(0.4, 0.8),
                radius_x=radius + rng.normal(0, 0.3),
                radius_y=radius * 1.1 + rng.normal(0, 0.3),
                is_trusted=True,
            )
        )
    start = down + dwell + 100
    speed *= rng.uniform(0.93, 1.07)
    slide = [
        dict(
            t_ms=start + p * speed,
            x_norm=0.1 + 0.8 * p,
            y_norm=0.7 + arc * np.sin(np.pi * p),
            pressure=0.5,
        )
        for p in np.linspace(0, 1, 26)
    ]
    times = np.arange(0, int(slide[-1]["t_ms"] + 120), 16.0)
    z = 0.04 * np.sin(2 * np.pi * freq * times / 1000) + rng.normal(
        0, 0.006, len(times)
    )
    for tap in taps:
        z += 0.5 * np.exp(-(((times - tap["t_ms"] - 8) / 9) ** 2))
    imu = [
        dict(
            t_ms=t,
            ax=rng.normal(0, 0.04),
            ay=rng.normal(0, 0.04),
            az=v,
            alpha=0.0,
            beta=pitch + rng.normal(0, 0.35),
            gamma=roll + rng.normal(0, 0.35),
        )
        for t, v in zip(times, z)
    ]
    suffix = sample % 4 if person in (15, 16) else 0
    return dict(
        session_id=f"syn_{seed}_{person}_{sample}",
        account_id=f"syn_acc_{person}_{suffix}",
        device_meta=dict(
            screen_w=[375, 412][sample % 2],
            screen_h=844,
            os="Synthetic",
            sample_rate_hz=62.5,
        ),
        started_at_ms=1700000000000 + sample * 10000,
        duration_ms=times[-1] + 2,
        keystrokes=keys,
        taps=taps,
        slider_trace=slide,
        imu_samples=imu,
        transfer_context=dict(amount_kzt=100000, is_new_recipient=True),
    )


def population():
    return [
        (person, session(person, i))
        for person in range(18)
        for i in range(8 + int(person < 6))
    ]
