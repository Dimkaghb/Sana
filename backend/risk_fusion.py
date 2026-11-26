"""Versioned decision policy for simulated transfers."""

from .config import Policy
from .physics_engine import Evidence, flag


def reason(code, title, detail):
    return {"code": code, "title": title, "detail": detail}


def local_hold_reasons(context, recoil, coercion, policy):
    reasons = []
    if recoil.score is not None and recoil.score >= policy.hold_threshold:
        detail = f"Touch physics scored {recoil.score}/100 against a hold threshold of {policy.hold_threshold}."
        peak = recoil.measurements.get("peak_m_s2")
        if peak is not None:
            detail += f" Peak motion around the scored tap was {peak:.4f} m/s²."
        reasons.append(reason("TOUCH_HOLD", "Tap evidence triggered a hold", detail))
    if (coercion.score is not None and coercion.score >= policy.hold_threshold
            and context["is_new_recipient"]):
        detail = f"This was a new recipient. The coercion signal score was {coercion.score}/100, meeting the hold threshold of {policy.hold_threshold}."
        if any(item["code"] == "DICTATION_COERCION" for item in coercion.flags):
            detail += " The timing showed repeated short bursts of digits separated by pauses."
        reasons.append(reason("COERCION_NEW_RECIPIENT", "Possible coaching on a transfer to a new recipient", detail))
    return reasons


def decide(telemetry, recoil: Evidence, coercion: Evidence, ml, policy: Policy):
    context = telemetry["transfer_context"]
    flags = [*recoil.flags, *coercion.flags]
    owner = ml["owner_verification"] if ml else {}
    operator = ml["operator_reconciliation"] if ml else {}
    similarity = owner.get("cosine_similarity")
    identity_risk = None
    if owner.get("baseline_sessions_count", 0) >= 3 and similarity is not None:
        identity_risk = round(min(100, max(0, (1 - similarity) * 100)))
    if identity_risk is None:
        flags.append(
            flag(
                "IDENTITY_UNAVAILABLE",
                "INFO",
                "Owner evidence unavailable",
                "No valid score against a sufficiently enrolled owner.",
            )
        )
    confidence = operator.get("match_confidence")
    ring = (
        operator.get("ring_size", 0) >= 2
        and confidence is not None
        and confidence >= policy.ring_confidence
    )
    banned = operator.get("is_banned_operator", False)
    handoff = owner.get("is_handoff_detected", False)
    if handoff:
        flags.append(
            flag(
                "ACCOUNT_HANDOFF",
                "WARNING",
                "Possible account handoff",
                "The identity service reported an owner mismatch.",
            )
        )
        identity_risk = max(identity_risk or 0, 75)
    if ring:
        flags.append(
            flag(
                "DROPPER_RING_MATCH",
                "CRITICAL",
                "Cross-account operator match",
                f"The identity service linked {operator['ring_size']} accounts.",
            )
        )
        identity_risk = max(identity_risk or 0, round(confidence * 100))
    if banned:
        flags.append(
            flag(
                "BANNED_OPERATOR",
                "CRITICAL",
                "Banned operator match",
                "The identity service matched a banned operator.",
            )
        )
        identity_risk = 100
    scores = {
        "anti_rat_physics_risk": recoil.score,
        "coercion_stress_risk": coercion.score,
        "operator_mismatch_risk": identity_risk,
    }
    overall = max((s for s in scores.values() if s is not None), default=None)
    reasons = []
    if banned:
        reasons.append(reason("BANNED_OPERATOR", "Match to a banned operator profile",
                              f"The identity service matched the session to {operator['matched_operator_id']}, which was banned when this transfer was scored."))
    if ring:
        reasons.append(reason("CROSS_ACCOUNT_MATCH", "Similar behavior across accounts",
                              f"The operator match score was {confidence:.3f} across {operator['ring_size']} linked accounts. The hold rule requires at least two accounts and a score of {policy.ring_confidence:g} or higher."))
    if handoff and context["amount_kzt"] >= policy.handoff_amount:
        reasons.append(reason("HANDOFF_AMOUNT", "Owner mismatch on a large transfer",
                              f"The identity service reported a possible handoff. The transfer of ₸{context['amount_kzt']:,} met the ₸{policy.handoff_amount:,} hold threshold."))
    reasons.extend(local_hold_reasons(context, recoil, coercion, policy))
    if any(r["code"] == "COERCION_NEW_RECIPIENT" for r in reasons):
        decision = "STEALTH_HOLD"
    elif reasons:
        decision = "MIRAGE_HOLD"
    else:
        if identity_risk is None:
            reasons.append(reason("OWNER_EVIDENCE_MISSING", "Owner comparison unavailable",
                                  "The session had no usable comparison with a sufficiently enrolled owner."))
        if recoil.score is None:
            reasons.append(reason("RECOIL_EVIDENCE_MISSING", "Tap motion unavailable",
                                  "There was insufficient motion coverage to score the final interaction."))
        if overall is not None and overall >= policy.step_up_threshold:
            reasons.append(reason("STEP_UP_SCORE", "Risk score calls for another check",
                                  f"The highest available component scored {overall}/100, meeting the additional-check threshold of {policy.step_up_threshold}."))
        if reasons:
            decision = "STEP_UP_LIVENESS"
        else:
            decision = "SUCCESS"
            reasons.append(reason("BELOW_REVIEW_THRESHOLD", "Transfer met the approval rules",
                                  f"No hold rule applied. The highest available component scored {overall}/100, below the additional-check threshold of {policy.step_up_threshold}."))
    return decision, scores, overall, flags, {"policy_version": policy.version, "reasons": reasons}


def eligible_for_enrollment(event, step_up_threshold):
    # Cold owner identity is expected for first-time enrollment. Both physical
    # components must be observed and the historical result must be otherwise clean.
    physical_scores = (
        event["scores"]["anti_rat_physics_risk"],
        event["scores"]["coercion_stress_risk"],
    )
    return (
        event["decision"] not in {"MIRAGE_HOLD", "STEALTH_HOLD"}
        and event["map_point"] is not None
        and all(
            score is not None and score < step_up_threshold for score in physical_scores
        )
        and event["overall_risk_score"] is not None
        and event["overall_risk_score"] < step_up_threshold
        and all(flag["code"] == "IDENTITY_UNAVAILABLE" for flag in event["flags"])
    )
