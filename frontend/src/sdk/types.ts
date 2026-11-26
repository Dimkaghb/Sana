export interface KeySample {
  key_group: "digit" | "backspace";
  down_ms: number;
  up_ms: number;
  dx_norm: number;
  dy_norm: number;
}
interface Position {
  t_ms: number;
  x_norm: number;
  y_norm: number;
}
export interface Tap extends Position {
  radius_x: number;
  radius_y: number;
  is_trusted: boolean;
}
export interface SliderPoint extends Position {
  pressure: number;
}
export interface MotionSample {
  t_ms: number;
  ax: number;
  ay: number;
  az: number;
  alpha: number;
  beta: number;
  gamma: number;
}
export interface TransferContext {
  amount_kzt: number;
  is_new_recipient: boolean;
}
export interface SessionTelemetry {
  session_id: string;
  account_id: string;
  device_meta: {
    screen_w: number;
    screen_h: number;
    os: string;
    sample_rate_hz: number;
  };
  started_at_ms: number;
  duration_ms: number;
  keystrokes: KeySample[];
  contacts?: {
    down_ms: number;
    up_ms: number;
    field:
      | "recipient"
      | "amount"
      | "preset"
      | "review"
      | "recipient_type"
      | "slider";
    pointer_type: "mouse" | "touch" | "pen";
    is_trusted: boolean;
  }[];
  taps: Tap[];
  slider_trace: SliderPoint[];
  imu_samples: MotionSample[];
  transfer_context: TransferContext;
}
export interface Decision {
  session_id: string;
  ui_mode: "MIRAGE_HOLD" | "STEALTH_HOLD" | "SUCCESS" | "STEP_UP_LIVENESS";
  display_title: string;
  display_subtitle: string;
  reference_code: string;
  guardian_notified: boolean;
}
