import type { Decision } from "./sdk";
import type { DashboardData, DashboardEvent } from "./types";
const files = import.meta.glob<DashboardEvent>(
  "../../contracts/fixtures/*/dashboard-event.json",
  { eager: true, import: "default" },
);
export const fixtureEvents = Object.values(files).sort((a, b) =>
  b.timestamp.localeCompare(a.timestamp),
);
export const fixtureData: DashboardData = {
  events: fixtureEvents,
  ml_mode: "mock",
  active_sessions: [],
  population_map: null,
  kpis: {
    sessions: fixtureEvents.length,
    held_amount_kzt: 0,
    ring_count: fixtureEvents.filter((e) =>
      e.flags.some((f) => f.code === "DROPPER_RING_MATCH"),
    ).length,
    average_inference_ms: null,
  },
};

const decisions = import.meta.glob<Decision>(
  "../../contracts/fixtures/*/mobile-decision.json",
  { eager: true, import: "default" },
);
export const fixtureDecisions = Object.fromEntries(
  Object.entries(decisions).map(([path, decision]) => [
    path.split("/").at(-2)!,
    decision,
  ]),
);

type IdentityFixture = {
  session_id: string;
  operator_reconciliation: {
    linked_account_ids: string[];
    match_confidence: number | null;
  };
};
const identities = import.meta.glob<IdentityFixture>(
  "../../contracts/fixtures/*/ml-score.json",
  { eager: true, import: "default" },
);
export const fixtureIdentities = Object.fromEntries(
  Object.values(identities).map((identity) => [
    identity.session_id,
    identity.operator_reconciliation,
  ]),
);
