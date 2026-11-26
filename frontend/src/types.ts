import type { Decision } from "./sdk";
export interface MapPoint {
  x: number;
  y: number;
  cluster_id: number;
  operator_id: string;
  status: string;
}
export interface DashboardEvent {
  type: "SESSION_SCORED";
  timestamp: string;
  session_id: string;
  account_id: string;
  account_label: string;
  decision: Decision["ui_mode"];
  decision_explanation?: {
    policy_version: string;
    reasons: { code: string; title: string; detail: string }[];
  };
  overall_risk_score: number | null;
  scores: {
    anti_rat_physics_risk: number | null;
    coercion_stress_risk: number | null;
    operator_mismatch_risk: number | null;
  };
  flags: { code: string; severity: string; title: string; detail: string }[];
  recoil_waveform: { t_ms: number; az_delta: number }[];
  map_point: MapPoint | null;
}
export interface DashboardData {
  events: DashboardEvent[];
  ml_mode: "mock" | "live";
  active_sessions: string[];
  session_identity?: Record<
    string,
    {
      match_confidence: number | null;
      linked_account_ids: string[];
      eligible_for_enrollment: boolean;
    }
  >;
  population_map: {
    points: (MapPoint & {
      position_3d?: [number, number, number];
      session_id?: string;
      account_id?: string;
      synthetic?: boolean;
    })[];
    clusters: unknown[];
    next?: string | null;
  } | null;
  kpis: {
    sessions: number;
    held_amount_kzt: number;
    ring_count: number;
    average_inference_ms: number | null;
  };
}
export const money = (value: number) =>
  new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value);
export const decisionLabel = {
  SUCCESS: "Approved",
  STEALTH_HOLD: "Silent Duress",
  MIRAGE_HOLD: "Mirage hold",
  STEP_UP_LIVENESS: "Step-up",
};
