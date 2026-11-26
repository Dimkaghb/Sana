import { useId } from "react";
import type { DashboardEvent, DecisionEvidence } from "../types";

const headings = {
  SUCCESS: "Why this transfer was approved",
  STEP_UP_LIVENESS: "Why another check was requested",
  STEALTH_HOLD: "Why this transfer was silently frozen",
  MIRAGE_HOLD: "Why this transfer was held",
};

function EvidenceCard({
  item,
  target,
}: {
  item: DecisionEvidence;
  target: string;
}) {
  return (
    <article
      id={target}
      className="decision-observation"
      data-status={item.status}
    >
      <h5>
        {item.title}
        {item.status === "unavailable" && <small>Unavailable</small>}
      </h5>
      <p>{item.summary}</p>
      {item.facts.length > 0 && (
        <dl>
          {item.facts.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

export function DecisionExplanation({
  event,
  preview,
}: {
  event: DashboardEvent;
  preview: boolean;
}) {
  const explanation = event.decision_explanation;
  const id = useId();
  const observations = explanation?.evidence ?? [];
  const activeIds = new Set(
    explanation?.reasons.flatMap((reason) => reason.evidence_ids ?? []),
  );
  const decisive = observations.filter((item) => activeIds.has(item.id));
  const supporting = observations.filter((item) => !activeIds.has(item.id));
  const anchor = (key: string) => id + "-" + key;
  const mockIdentity = event.flags.some(
    (flag) => flag.code === "MOCK_IDENTITY",
  );
  return (
    <section className="decision-explanation" aria-label="Decision explanation">
      <div className="decision-heading">
        <h3>
          {event.decision === "SUCCESS"
            ? "Why SANA approved this"
            : "Why SANA flagged this"}
        </h3>
        {explanation && <small>Policy {explanation.policy_version}</small>}
      </div>
      <h4>{headings[event.decision]}</h4>
      {(preview || mockIdentity) && (
        <p className="decision-source">
          {preview ? "Synthetic scenario" : "Simulated identity evidence"}
        </p>
      )}
      {explanation ? (
        <>
          <ol className="decision-triggers" aria-label="Decision rules">
            {explanation.reasons.map((reason) => (
              <li key={reason.code}>
                <strong>{reason.title}</strong>
                <p>{reason.detail}</p>
                {!!reason.evidence_ids?.length && (
                  <div className="decision-links">
                    <span>Evidence</span>
                    {reason.evidence_ids.map((key) => {
                      const item = decisive.find(
                        (observation) => observation.id === key,
                      );
                      return (
                        item && (
                          <a key={key} href={"#" + anchor(key)}>
                            {item.title}
                          </a>
                        )
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {decisive.length > 0 && (
            <div className="decision-observations">
              <h4>Evidence for this decision</h4>
              {decisive.map((item) => (
                <EvidenceCard
                  key={item.id}
                  item={item}
                  target={anchor(item.id)}
                />
              ))}
            </div>
          )}
          {supporting.length > 0 && (
            <details className="decision-support">
              <summary>Other measurements and coverage</summary>
              {supporting.map((item) => (
                <EvidenceCard
                  key={item.id}
                  item={item}
                  target={anchor(item.id)}
                />
              ))}
            </details>
          )}
          {observations.length > 0 ? (
            <p className="decision-source">
              Cosine similarity measures behavioral likeness between profiles.
              The policy combines those results with the recorded touch, timing
              and transfer evidence.
            </p>
          ) : (
            <p className="decision-source">
              This case was scored before detailed evidence was captured. The
              saved rules and recorded flags remain available.
            </p>
          )}
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
