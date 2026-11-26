import type { DashboardEvent } from "../types";

const headings = {
  SUCCESS: "Why this transfer was approved",
  STEP_UP_LIVENESS: "Why another check was requested",
  MIRAGE_HOLD: "Why this transfer was held",
};

export function DecisionExplanation({
  event,
  preview,
}: {
  event: DashboardEvent;
  preview: boolean;
}) {
  const explanation = event.decision_explanation;
  const mockIdentity = event.flags.some(
    (flag) => flag.code === "MOCK_IDENTITY",
  );
  return (
    <section className="decision-explanation" aria-label="Decision explanation">
      <h3>{headings[event.decision]}</h3>
      {explanation ? (
        <>
          <ul>
            {explanation.reasons.map((reason) => (
              <li key={reason.code}>
                <strong>{reason.title}</strong>
                <p>{reason.detail}</p>
              </li>
            ))}
          </ul>
          <small>
            Policy {explanation.policy_version}
            {preview
              ? " · Synthetic scenario"
              : mockIdentity
                ? " · Simulated identity evidence"
                : ""}
          </small>
        </>
      ) : (
        <p>
          This case predates recorded decision reasons. Its saved scores and
          flags are available for review.
        </p>
      )}
    </section>
  );
}
