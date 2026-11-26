import type {
  Decision,
  KeySample,
  MotionSample,
  SessionTelemetry,
  SliderPoint,
  Tap,
  TransferContext,
} from "./types";

type Contact = NonNullable<SessionTelemetry["contacts"]>[number];
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

export interface KinetiqConfig {
  accountId: string;
  collectMotion: boolean;
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
  private readonly motion: (MotionSample | undefined)[] = [];
  private motionHead = 0;
  private motionCount = 0;
  private readonly touches = new Map<number, Omit<KeySample, "up_ms">>();
  private contacts: Contact[] = [];
  private held = new Map<number, Omit<Contact, "up_ms">>();
  private slider?: number;
  private orientation?: Pick<MotionSample, "alpha" | "beta" | "gamma">;
  private frozen?: SessionTelemetry;
  private sending?: Promise<Decision>;
  private socket?: WebSocket;
  private reconnect?: ReturnType<typeof setTimeout>;
  private delay?: ReturnType<typeof setTimeout>;
  private running = false;

  readonly accountId: string;
  private readonly collectMotion: boolean;
  constructor(config: KinetiqConfig | string) {
    this.accountId = typeof config === "string" ? config : config.accountId;
    this.collectMotion = typeof config === "string" || config.collectMotion;
  }
  private pruneMotion(cutoff: number) {
    while (this.motionCount) {
      const oldest = (this.motionHead - this.motionCount + 4096) % 4096;
      const sample = this.motion[oldest];
      if (sample && sample.t_ms >= cutoff) break;
      this.motion[oldest] = undefined;
      this.motionCount--;
    }
  }

  private time(event?: Event) {
    const now = performance.now();
    if (!event || !finite(event.timeStamp) || event.timeStamp <= 0)
      return now - this.started;
    // Legacy WebKit timestamps may use Unix milliseconds instead of timeOrigin.
    const stamp =
      event.timeStamp > 1e12
        ? event.timeStamp - performance.timeOrigin
        : event.timeStamp;
    return clamp(stamp - this.started, 0, now - this.started);
  }

  start(onDemoClick?: () => void) {
    if (this.running || this.lifetime.signal.aborted) return;
    this.running = true;
    const options = {
      signal: this.events.signal,
      capture: true,
      passive: true,
    };
    if (this.collectMotion) this.listenForMotion(options);
    document.addEventListener(
      "pointerdown",
      (e) => {
        const field =
          e.target instanceof Element
            ? e.target.closest<HTMLElement>("[data-kinetiq-field]")
            : null;
        if (!field) return;
        const point = this.position(e);
        const category = field.dataset.kinetiqField;
        if (
          (category === "recipient" ||
            category === "amount" ||
            category === "slider" ||
            category === "preset" ||
            category === "review" ||
            category === "recipient_type") &&
          (e.pointerType === "touch" ||
            e.pointerType === "mouse" ||
            e.pointerType === "pen") &&
          this.held.size < 16
        )
          this.held.set(e.pointerId, {
            field: category,
            pointer_type: e.pointerType,
            is_trusted: e.isTrusted,
            down_ms: point.t_ms,
          });
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
        const released = this.time(e);
        const contact = this.held.get(e.pointerId);
        if (
          contact &&
          released >= contact.down_ms &&
          this.contacts.length < 512
        )
          this.contacts.push({
            ...contact,
            is_trusted: contact.is_trusted && e.isTrusted,
            up_ms: released,
          });
        if (key && released >= key.down_ms && this.keys.length < 512)
          this.keys.push({ ...key, up_ms: released });
        this.release(e.pointerId);
      },
      options,
    );
    document.addEventListener(
      "pointercancel",
      (e) => this.release(e.pointerId),
      options,
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        this.held.clear();
        this.touches.clear();
        this.slider = undefined;
      },
      options,
    );
    if (onDemoClick) this.connect(onDemoClick);
  }

  private listenForMotion(options: AddEventListenerOptions) {
    let permissionLost = false;
    let lastMotionTime = -1;
    let orientationTime = -1;
    // Browser support for querying individual sensor permissions varies.
    for (const name of ["accelerometer", "gyroscope"]) {
      navigator.permissions
        ?.query({ name: name as PermissionName })
        .then((status) => {
          if (this.events.signal.aborted) return;
          const check = () => {
            if (status.state !== "denied") return;
            permissionLost = true;
            this.orientation = undefined;
            this.motion.length = 0;
            this.motionHead = this.motionCount = 0;
          };
          check();
          status.addEventListener("change", check, {
            signal: this.events.signal,
          });
        })
        .catch(() => {
          /* Permission remains governed by browser event delivery. */
        });
    }
    // Browsers can publish orientation only on change while motion is periodic.
    // Keep the last observed attitude valid only within the same visible session.
    document.addEventListener(
      "visibilitychange",
      () => {
        this.orientation = undefined;
        this.touches.clear();
        this.slider = undefined;
      },
      options,
    );
    window.addEventListener(
      "deviceorientation",
      (event) => {
        if (!event.isTrusted || document.hidden || permissionLost) return;
        orientationTime = this.time(event);
        if (finite(event.alpha) && finite(event.beta) && finite(event.gamma)) {
          this.orientation = {
            alpha: event.alpha,
            beta: event.beta,
            gamma: event.gamma,
          };
        } else {
          this.orientation = undefined;
        }
      },
      options,
    );
    window.addEventListener(
      "devicemotion",
      (event) => {
        const a = event.acceleration;
        const angle = this.orientation;
        const t = this.time(event);
        if (
          !event.isTrusted ||
          permissionLost ||
          t < orientationTime ||
          t <= lastMotionTime ||
          !a ||
          !angle ||
          document.hidden ||
          !finite(a.x) ||
          !finite(a.y) ||
          !finite(a.z)
        )
          return;
        lastMotionTime = t;
        const sample = { ...angle, t_ms: t, ax: a.x, ay: a.y, az: a.z };
        this.pruneMotion(t - 20000);
        this.motion[this.motionHead] = sample;
        this.motionCount = Math.min(4096, this.motionCount + 1);
        this.motionHead = (this.motionHead + 1) % 4096;
      },
      options,
    );
  }
  private position(e: PointerEvent) {
    return {
      t_ms: this.time(e),
      x_norm: clamp(e.clientX / Math.max(innerWidth, 1)),
      y_norm: clamp(e.clientY / Math.max(innerHeight, 1)),
    };
  }
  private release(id: number) {
    this.held.delete(id);
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
    this.pruneMotion(duration - 20000);
    const samples: MotionSample[] = [];
    const first = (this.motionHead - this.motionCount + 4096) % 4096;
    for (let offset = 0; offset < this.motionCount; offset++) {
      const sample = this.motion[(first + offset) % 4096];
      if (sample) samples.push({ ...sample });
    }
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
      contacts: this.contacts
        .map((c) => ({ ...c }))
        .sort((a, b) => a.down_ms - b.down_ms),
      taps: this.taps.map((t) => ({ ...t })).sort((a, b) => a.t_ms - b.t_ms),
      slider_trace: this.sliders
        .map((t) => ({ ...t }))
        .sort((a, b) => a.t_ms - b.t_ms),
      keystrokes: this.keys
        .map((t) => ({ ...t }))
        .sort((a, b) => a.down_ms - b.down_ms),
      imu_samples: span > 0 ? samples : [],
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
    this.contacts.length = 0;
    this.held.clear();
    this.lifetime.abort();
    clearTimeout(this.delay);
    this.motion.length =
      this.keys.length =
      this.sliders.length =
      this.taps.length =
        0;
    this.motionCount = 0;
    this.frozen = this.orientation = undefined;
  }
}
