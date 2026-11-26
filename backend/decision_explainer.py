"""Deterministic explanation of recorded observations and policy decisions."""

from .coercion_engine import DIGIT_GAP_MS, PAUSE_MIN_MS


def evidence(id, title, summary, available, **facts):
    return {
        "id": id,
        "title": title,
        "summary": summary,
        "status": "observed" if available else "unavailable",
        "facts": [
            {"label": label.replace("_", " "), "value": str(value)}
            for label, value in facts.items()
            if value is not None
        ],
    }


def touch_evidence(recoil, policy):
    measured = recoil.measurements
    total, covered = measured.get("total_taps"), measured.get("covered_taps")
    peak = measured.get("peak_m_s2")
    trusted = measured.get("is_trusted")
    empty_geometry = measured.get("zero_contact_geometry")
    variation = measured.get("slider_speed_cv")
    final_covered = measured.get("final_tap_covered")
    if recoil.score is None:
        if total == 0:
            summary = "The session contained no recorded pointer taps."
        elif measured.get("motion_samples") == 0:
            summary = "The session contained no usable motion readings."
        else:
            summary = "The final interaction lacked the motion coverage required for a score."
    elif peak is not None and peak < policy.recoil_floor:
        summary = "The tap used for scoring had weak motion along the screen's Z axis. A supported phone can also show weak recoil."
    else:
        summary = "Scoring used the covered tap with the highest touch risk and the browser's record of how that event was delivered."
    return evidence(
        "touch", "Tap recoil and browser input", summary, recoil.score is not None,
        Covered_taps=f"{covered} of {total}" if covered is not None else None,
        Low_recoil_taps=measured.get("weak_taps"),
        Selected_Z_peak=f"{peak:.6g} m/s²" if peak is not None else None,
        Low_recoil_cutoff=f"{policy.recoil_floor:.6g} m/s²",
        Selected_tap_time=f"{measured['tap_ms']:.0f} ms into session" if "tap_ms" in measured else None,
        Pointer_provenance=("Browser-trusted" if trusted else "Script-generated or otherwise untrusted") if trusted is not None else None,
        Contact_geometry=("Zero radius on both axes" if empty_geometry else "Nonzero radius") if empty_geometry is not None else None,
        Slider_speed_variation=f"{variation:.1%} (uniform below 2.5%)" if variation is not None else None,
        Final_tap_coverage=("Covered" if final_covered else "Insufficient") if total and final_covered is not None else None,
    )


def cadence_evidence(measured):
    sizes = measured.get("burst_sizes")
    pauses = measured.get("burst_pauses_ms")
    keys = measured.get("paired_keys")
    available = bool(sizes) or (keys is not None and keys >= 6)
    if sizes:
        summary = "The keypad timing fit the coached-entry pattern. Ordinary pauses can produce similar timing."
    elif available:
        summary = "No sequence of three qualifying digit bursts was recorded."
    else:
        summary = "Too few complete key presses to assess coached-entry cadence."
    return evidence(
        "cadence", "Keypad timing", summary, available,
        Complete_key_presses=keys,
        Digits_per_burst=" / ".join(map(str, sizes)) if sizes else None,
        Pauses_between_bursts=" and ".join(f"{pause:.0f} ms" for pause in pauses) if pauses else None,
        Pattern_rule=f"2–4 digits per burst, <{DIGIT_GAP_MS} ms within a burst, >{PAUSE_MIN_MS} ms between bursts",
    )


def motion_evidence(measured):
    tremor = measured.get("tremor_indicator")
    available = tremor is not None
    if available:
        summary = "The motion check looked for repeated changes in device angle and energy in the 8–12 Hz band. Device movement can have ordinary causes."
    else:
        summary = "The motion stream lacked a sufficiently long, continuous recording for this check."
    return evidence(
        "motion", "Device movement", summary, available,
        Motion_window=f"{measured['motion_window_ms'] / 1000:.2f} s" if "motion_window_ms" in measured else None,
        Band_energy=f"{measured['tremor_band_fraction']:.1%} of 1–16 Hz energy fell within 8–12 Hz" if "tremor_band_fraction" in measured else None,
        Acceleration_RMS=f"{measured['acceleration_rms_m_s2']:.4f} m/s²" if "acceleration_rms_m_s2" in measured else None,
        Tremor_band_rule=("Met" if tremor else "Below criteria") if available else None,
        Posture_transitions=measured.get("posture_transitions"),
    )


def identity_evidence(ml, account, timed_out):
    owner = ml["owner_verification"] if ml else {}
    operator = ml["operator_reconciliation"] if ml else {}
    cosine = owner.get("cosine_similarity")
    baseline = owner.get("baseline_sessions_count")
    usable = cosine is not None and baseline is not None and baseline >= 3
    match = operator.get("match_confidence")
    banned = operator.get("is_banned_operator", False)
    missing = (
        "The identity check exceeded its scoring deadline."
        if timed_out else "The identity service did not return a usable result."
    )
    if usable and owner.get("is_handoff_detected"):
        owner_summary = "The model flagged a mismatch against this account's enrolled owner."
    elif usable:
        owner_summary = "The transfer was compared with this account's enrolled owner baseline."
    elif ml:
        owner_summary = "A usable owner comparison requires an available score and at least three enrolled sessions."
    else:
        owner_summary = missing
    if banned:
        operator_summary = "The matched operator profile was on the ban list at scoring time."
    elif match is None:
        operator_summary = "The service returned no prior operator match." if ml else missing
    else:
        operator_summary = "The vector search returned a similar behavioral profile. A profile can include more than one account."
    linked = operator.get("linked_account_ids")
    other_accounts = len(set(linked) - {account}) if linked is not None else None
    return [
        evidence(
            "operator", "Behavioral operator match", operator_summary, match is not None or banned,
            Profile_ID=operator.get("matched_operator_id") if match is not None or banned else None,
            Cosine_similarity=f"{match:.4f}" if match is not None else None,
            Other_linked_accounts=other_accounts if match is not None else None,
        ),
        evidence(
            "owner", "Account owner comparison", owner_summary, usable,
            Enrolled_sessions=baseline,
            Owner_cosine_similarity=f"{cosine:.4f}" if cosine is not None else None,
        ),
    ]


def add_evidence(explanation, telemetry, recoil, coercion, ml, policy, scores, review, timed_out):
    context = telemetry["transfer_context"]
    measurements = coercion.measurements
    groups = [
        touch_evidence(recoil, policy),
        cadence_evidence(measurements),
        motion_evidence(measurements),
        *identity_evidence(ml, telemetry["account_id"], timed_out),
        evidence(
            "transfer", "Transfer context", "The hold policy considers recipient history and amount for specific rules.", True,
            Recipient="New" if context["is_new_recipient"] else "Previously used",
            Amount=f"₸ {context['amount_kzt']:,.2f}",
        ),
    ]
    if review is not None:
        groups.append(evidence(
            "review", "Analyst account restriction", "This account is on a persisted linked-account review list.", True,
            Operator_profile=review["operator"],
            Evidence_session=review["evidence_session"],
        ))
    coercion_ids = []
    if measurements.get("burst_sizes"):
        coercion_ids.append("cadence")
    if (measurements.get("posture_transitions") or 0) >= 3 or (
        measurements.get("tremor_indicator") and not coercion_ids
    ):
        coercion_ids.append("motion")
    score_sources = {
        "anti_rat_physics_risk": ["touch"],
        "coercion_stress_risk": coercion_ids,
        "operator_mismatch_risk": ["owner"],
    }
    highest = max((score for score in scores.values() if score is not None), default=None)
    score_evidence = [
        group for key, score in scores.items()
        if score is not None and score == highest
        for group in score_sources[key]
    ]
    references = {
        "RING_ACCOUNT_REVIEW": ["review"],
        "BANNED_OPERATOR": ["operator"],
        "CROSS_ACCOUNT_MATCH": ["operator"],
        "HANDOFF_AMOUNT": ["owner", "transfer"],
        "TOUCH_HOLD": ["touch"],
        "COERCION_NEW_RECIPIENT": [*coercion_ids, "transfer"],
        "OWNER_EVIDENCE_MISSING": ["owner"],
        "RECOIL_EVIDENCE_MISSING": ["touch"],
        "STEP_UP_SCORE": score_evidence,
        "BELOW_REVIEW_THRESHOLD": ["owner", "touch"],
    }
    return {
        **explanation,
        "reasons": [
            {**rule, "evidence_ids": references[rule["code"]]}
            for rule in explanation["reasons"]
        ],
        "evidence": groups,
    }
