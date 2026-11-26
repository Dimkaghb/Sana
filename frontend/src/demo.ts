import fixturePositions from "./fixture-positions.json";
import ringEvidence from "../../contracts/fixtures/ring/ml-score.json";
import ringTelemetry from "../../contracts/fixtures/ring/telemetry.json";
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
  rings: [
    {
      operator_id: ringEvidence.operator_reconciliation.matched_operator_id,
      cluster_id: ringEvidence.map_point.cluster_id,
      evidence_session_id: ringEvidence.session_id,
      match_confidence: ringEvidence.operator_reconciliation.match_confidence,
      accounts: ringEvidence.operator_reconciliation.linked_account_ids.map(
        (account_id) => ({ account_id, in_review: false }),
      ),
      exposure_kzt: ringTelemetry.transfer_context.amount_kzt,
      protected_kzt: 0,
    },
  ],
  population_map: {
    points: fixtureEvents.flatMap((event) => {
      if (!event.map_point) return [];
      const xyz =
        fixturePositions[event.session_id as keyof typeof fixturePositions];
      if (!xyz) return [];
      return [
        {
          ...event.map_point,
          session_id: event.session_id,
          account_id: event.account_id,
          synthetic: true,
          position_3d: [xyz[0], xyz[1], xyz[2]] as [number, number, number],
        },
      ];
    }),
    clusters: [],
  },
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
