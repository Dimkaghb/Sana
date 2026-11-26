import { useId, useState } from "react";
import { Network, Snowflake } from "lucide-react";
import { money, type FraudRing } from "../types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import "./fraud-rings.css";

export function FraudRings({
  rings,
  preview,
  token,
  refresh,
}: {
  rings: FraudRing[];
  preview: boolean;
  token: string;
  refresh: () => void;
}) {
  return (
    <section
      id="suspected-mule-rings"
      className="panel fraud-rings"
      aria-label="Suspected mule rings"
    >
      <header className="panel-head">
        <div>
          <h2>Suspected mule rings</h2>
          <p>Cross-account operator matches for analyst review</p>
        </div>
        <Network size={20} aria-hidden="true" />
      </header>
      <div className="fraud-ring-list">
        {rings.map((ring) => (
          <Ring key={ring.operator_id} {...{ ring, preview, token, refresh }} />
        ))}
      </div>
    </section>
  );
}

function Ring({
  ring,
  preview,
  token,
  refresh,
}: {
  ring: FraudRing;
  preview: boolean;
  token: string;
  refresh: () => void;
}) {
  const [confirmation, setConfirmation] = useState<FraudRing>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const descriptionId = useId();
  const inReview = ring.accounts.every((account) => account.in_review);
  const group =
    ring.cluster_id != null && ring.cluster_id >= 0
      ? `Operator Cluster #${ring.cluster_id}`
      : "Matched operator";

  async function freeze() {
    if (!confirmation || working) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(
        "/api/v1/rings/" +
          encodeURIComponent(confirmation.evidence_session_id) +
          "/freeze",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          body: JSON.stringify({ confirmed: true }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(
          typeof result.detail === "string" ? result.detail : "Freeze failed.",
        );
      setConfirmation(undefined);
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Freeze failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <article className="fraud-ring">
      <header>
        <h3>Suspected Multi-Account Operator (Mule Ring)</h3>
        <p>
          <strong>₸ {money(ring.exposure_kzt)}</strong> exposure across{" "}
          {ring.accounts.length} linked accounts
        </p>
      </header>
      <div className="ring-graph" aria-label="Operator and linked accounts">
        <div className="ring-operator">
          <strong>{group}</strong>
          <code>{ring.operator_id}</code>
          <small>Cosine match {ring.match_confidence.toFixed(3)}</small>
        </div>
        <ul>
          {ring.accounts.map((account) => (
            <li key={account.account_id}>
              <code>{account.account_id}</code>
              {account.in_review && <small>In review</small>}
            </li>
          ))}
        </ul>
      </div>
      <footer>
        <div>
          <strong>₸ {money(ring.protected_kzt)} protected</strong>
          <small>
            {preview ? "Fixture preview" : "Frozen simulated transfers"}
          </small>
        </div>
        <Dialog
          open={!!confirmation}
          onOpenChange={(open) => {
            if (!working) {
              setError("");
              setConfirmation(open ? ring : undefined);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" disabled={preview || inReview}>
              <Snowflake size={16} aria-hidden="true" />
              {inReview
                ? "Linked accounts in review"
                : "Freeze Linked Accounts"}
            </Button>
          </DialogTrigger>
          {confirmation && (
            <DialogContent
              showCloseButton={!working}
              aria-describedby={descriptionId}
            >
              <DialogTitle>Freeze linked accounts?</DialogTitle>
              <p id={descriptionId}>
                Ban the matched operator, freeze held transfers attributed to
                this ring, and place future simulated transfers from these
                accounts into review.
              </p>
              <ul className="ring-confirm-accounts">
                {confirmation.accounts.map((account) => (
                  <li key={account.account_id}>{account.account_id}</li>
                ))}
              </ul>
              {error && <p role="alert">{error}</p>}
              <div className="dialog-actions">
                <Button
                  variant="outline"
                  disabled={working}
                  onClick={() => setConfirmation(undefined)}
                >
                  Cancel
                </Button>
                <Button disabled={working} onClick={() => void freeze()}>
                  {working ? "Freezing…" : "Confirm freeze"}
                </Button>
              </div>
            </DialogContent>
          )}
        </Dialog>
      </footer>
    </article>
  );
}
