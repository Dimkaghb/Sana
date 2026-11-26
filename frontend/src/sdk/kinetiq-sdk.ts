import type {
  Decision,
  KeySample,
  MotionSample,
  SessionTelemetry,
  SliderPoint,
  Tap,
  TransferContext,
} from "./types";

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
type SensorConstructor = { requestPermission?: () => Promise<string> };
export type SensorAccess = "allowed" | "limited";
export async function requestSensorAccess(): Promise<SensorAccess> {
  if (!window.isSecureContext) return "limited";
  const sensors: (SensorConstructor | undefined)[] = [
    window.DeviceMotionEvent as SensorConstructor | undefined,
    window.DeviceOrientationEvent as SensorConstructor | undefined,
  ];
  // Invoke both requests during the original user gesture on Safari.
  const results = await Promise.allSettled(
    sensors.map(async (sensor) =>
      sensor?.requestPermission
        ? sensor.requestPermission()
        : sensor
          ? "granted"
          : "unavailable",
    ),
  );
  return results.every((r) => r.status === "fulfilled" && r.value === "granted")
    ? "allowed"
    : "limited";
}

function osLabel() {
  if (/Android/i.test(navigator.userAgent)) return "Android";
  if (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
    return "iOS";
  return "Desktop";
}

export class KinetiqSDK {
  readonly sessionId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
  private readonly started = performance.now();
  private readonly epoch = Date.now();
  private readonly events = new AbortController();
  private readonly lifetime = new AbortController();
  private readonly taps: Tap[] = [];
  private readonly keys: KeySample[] = [];
  private readonly sliders: SliderPoint[] = [];
  private readonly motion: MotionSample[] = [];
  private motionHead = 0;
  private readonly touches = new Map<number, Omit<KeySample, "up_ms">>();
  private slider?: number;
  private orientation?: Pick<MotionSample, "alpha" | "beta" | "gamma" | "t_ms">;
  private frozen?: SessionTelemetry;
  private sending?: Promise<Decision>;
  private socket?: WebSocket;
  private reconnect?: ReturnType<typeof setTimeout>;
  private delay?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(readonly accountId: string) {}

  private time() {
    return performance.now() - this.started;
  }

  start(onDemoClick?: () => void) {
    if (this.running || this.lifetime.signal.aborted) return;
    this.running = true;
    const options = {
      signal: this.events.signal,
      capture: true,
      passive: true,
    };
    window.addEventListener(
      "deviceorientation",
      (event) => {
        if (finite(event.alpha) && finite(event.beta) && finite(event.gamma)) {
          this.orientation = {
            alpha: event.alpha,
            beta: event.beta,
            gamma: event.gamma,
            t_ms: this.time(),
          };
        }
      },
      options,
    );
    window.addEventListener(
      "devicemotion",
      (event) => {
        const a = event.acceleration;
        const angle = this.orientation;
        const t = this.time();
        if (
          !a ||
          !angle ||
          t - angle.t_ms > 250 ||
          !finite(a.x) ||
          !finite(a.y) ||
          !finite(a.z)
        )
          return;
        const sample = { ...angle, t_ms: t, ax: a.x, ay: a.y, az: a.z };
        this.motion[this.motionHead] = sample;
        this.motionHead = (this.motionHead + 1) % 4096;
      },
      options,
    );
    document.addEventListener(
      "pointerdown",
      (e) => {
        const field =
          e.target instanceof Element
            ? e.target.closest<HTMLElement>("[data-kinetiq-field]")
            : null;
        if (!field) return;
        const point = this.position(e);
        if (
          finite(e.width) &&
          finite(e.height) &&
          e.width >= 0 &&
          e.height >= 0 &&
          this.taps.length < 512
        ) {
          this.taps.push({
            ...point,
            radius_x: e.width / 2,
            radius_y: e.height / 2,
            is_trusted: e.isTrusted,
          });
        }
        if (
          field.dataset.kinetiqField === "slider" &&
          this.slider === undefined
        ) {
          this.slider = e.pointerId;
          this.trace(e);
        }
        const group = field.dataset.keyGroup;
        if (
          (group === "digit" || group === "backspace") &&
          this.touches.size < 16
        ) {
          const rect = field.getBoundingClientRect();
          if (rect.width && rect.height) {
            this.touches.set(e.pointerId, {
              key_group: group,
              down_ms: point.t_ms,
              dx_norm: clamp((e.clientX - rect.left) / rect.width - 0.5, -1, 1),
              dy_norm: clamp((e.clientY - rect.top) / rect.height - 0.5, -1, 1),
            });
          }
        }
      },
      options,
    );
    document.addEventListener("pointermove", (e) => this.trace(e), options);
    document.addEventListener(
      "pointerup",
      (e) => {
        this.trace(e);
        const key = this.touches.get(e.pointerId);
        if (key && this.keys.length < 512)
          this.keys.push({ ...key, up_ms: this.time() });
        this.release(e.pointerId);
      },
      options,
    );
    document.addEventListener(
      "pointercancel",
      (e) => this.release(e.pointerId),
      options,
    );
    if (onDemoClick) this.connect(onDemoClick);
  }

  private position(e: PointerEvent) {
    return {
      t_ms: this.time(),
      x_norm: clamp(e.clientX / Math.max(innerWidth, 1)),
      y_norm: clamp(e.clientY / Math.max(innerHeight, 1)),
    };
  }
  private release(id: number) {
    this.touches.delete(id);
    if (this.slider === id) this.slider = undefined;
  }
  private trace(e: PointerEvent) {
    if (
      this.slider === e.pointerId &&
      finite(e.pressure) &&
      this.sliders.length < 2048
    ) {
      this.sliders.push({ ...this.position(e), pressure: clamp(e.pressure) });
    }
  }
  private connect(onCommand: () => void, attempts = 0) {
    if (this.events.signal.aborted) return;
    const url = new URL("/ws/mobile/" + this.sessionId, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      attempts = 0;
    };
    socket.onmessage = (event) => {
      try {
        if (
          !this.events.signal.aborted &&
          JSON.parse(event.data).cmd === "INJECT_RAT_CLICK"
        )
          onCommand();
      } catch {
        /* Ignore unrecognized command frames. */
      }
    };
    socket.onclose = () => {
      if (!this.events.signal.aborted && attempts < 8)
        this.reconnect = setTimeout(
          () => this.connect(onCommand, attempts + 1),
          Math.min(1000 * 2 ** attempts, 12000),
        );
    };
  }
  snapshot(context: TransferContext): SessionTelemetry {
    const duration = this.time();
    const ordered = this.motion
      .slice(this.motionHead)
      .concat(this.motion.slice(0, this.motionHead));
    const samples = ordered.filter((sample) => sample.t_ms >= duration - 20000);
    const span =
      samples.length > 1 ? samples.at(-1)!.t_ms - samples[0].t_ms : 0;
    return {
      session_id: this.sessionId,
      account_id: this.accountId,
      started_at_ms: this.epoch,
      duration_ms: duration,
      device_meta: {
        screen_w: Math.max(innerWidth, 1),
        screen_h: Math.max(innerHeight, 1),
        os: osLabel(),
        sample_rate_hz: span > 0 ? ((samples.length - 1) * 1000) / span : 0,
      },
      taps: this.taps.map((t) => ({ ...t })),
      slider_trace: this.sliders.map((t) => ({ ...t })),
      keystrokes: this.keys
        .map((t) => ({ ...t }))
        .sort((a, b) => a.down_ms - b.down_ms),
      imu_samples: span > 0 ? samples.map((t) => ({ ...t })) : [],
      transfer_context: {
        amount_kzt: context.amount_kzt,
        is_new_recipient: context.is_new_recipient,
      },
    };
  }
  submit(context: TransferContext): Promise<Decision> {
    if (this.sending) return this.sending;
    this.sending = this.send(context).finally(() => {
      this.sending = undefined;
    });
    return this.sending;
  }
  private async send(context: TransferContext) {
    this.lifetime.signal.throwIfAborted();
    if (!this.frozen) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(this.lifetime.signal.reason);
        this.lifetime.signal.addEventListener("abort", onAbort, { once: true });
        this.delay = setTimeout(() => {
          this.lifetime.signal.removeEventListener("abort", onAbort);
          resolve();
        }, 50);
      });
      this.frozen = this.snapshot(context);
      this.detach();
    }
    const response = await fetch("/api/v1/sessions/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.frozen),
      signal: AbortSignal.any([
        this.lifetime.signal,
        AbortSignal.timeout(12000),
      ]),
    });
    if (!response.ok)
      throw new Error("Transfer service returned " + response.status);
    const data: Decision = await response.json();
    if (
      data.session_id !== this.sessionId ||
      !["SUCCESS", "STEP_UP_LIVENESS", "MIRAGE_HOLD"].includes(data.ui_mode) ||
      typeof data.display_title !== "string" ||
      typeof data.display_subtitle !== "string" ||
      typeof data.reference_code !== "string" ||
      typeof data.guardian_notified !== "boolean"
    )
      throw new Error("Invalid decision response");
    return data;
  }
  async saveCalibrationWithConsent() {
    if (!this.frozen)
      throw new Error("Complete the transfer before saving calibration.");
    const response = await fetch("/api/v1/calibration/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Calibration-Consent": "granted",
      },
      body: JSON.stringify(this.frozen),
      signal: AbortSignal.any([
        this.lifetime.signal,
        AbortSignal.timeout(5000),
      ]),
    });
    if (!response.ok) throw new Error("Calibration recording was not saved.");
  }
  private detach() {
    this.events.abort();
    clearTimeout(this.reconnect);
    if (this.socket) {
      this.socket.onmessage = this.socket.onclose = null;
      this.socket.close();
    }
    this.touches.clear();
  }
  stop() {
    this.detach();
    this.lifetime.abort();
    clearTimeout(this.delay);
    this.motion.length =
      this.keys.length =
      this.sliders.length =
      this.taps.length =
        0;
    this.frozen = this.orientation = undefined;
  }
}
