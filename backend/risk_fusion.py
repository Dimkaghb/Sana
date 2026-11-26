"""Versioned decision policy for simulated transfers."""

from .config import Policy
from .physics_engine import Evidence, flag


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
    hold = (
        (recoil.score or 0) >= policy.hold_threshold
        or banned
        or ring
        or (handoff and context["amount_kzt"] >= policy.handoff_amount)
        or (
            (coercion.score or 0) >= policy.hold_threshold
            and context["is_new_recipient"]
        )
    )
    if hold:
        decision = "MIRAGE_HOLD"
    elif (
        identity_risk is None
        or recoil.score is None
        or overall >= policy.step_up_threshold
    ):
        decision = "STEP_UP_LIVENESS"
    else:
        decision = "SUCCESS"
    return decision, scores, overall, flags


def eligible_for_enrollment(event, step_up_threshold):
    # Cold owner identity is expected for first-time enrollment. Both physical
    # components must be observed and the historical result must be otherwise clean.
    physical_scores = (
        event["scores"]["anti_rat_physics_risk"],
        event["scores"]["coercion_stress_risk"],
    )
    return (
        event["decision"] != "MIRAGE_HOLD"
        and event["map_point"] is not None
        and all(
            score is not None and score < step_up_threshold for score in physical_scores
        )
        and event["overall_risk_score"] is not None
        and event["overall_risk_score"] < step_up_threshold
        and all(flag["code"] == "IDENTITY_UNAVAILABLE" for flag in event["flags"])
    )
