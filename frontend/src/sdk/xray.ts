import type {
  KeySample,
  MotionSample,
  SessionTelemetry,
  SliderPoint,
  Tap,
} from "./types";

type ZSample = Pick<MotionSample, "t_ms" | "az">;
export type RecoilTap = {
  at: number;
  trusted: boolean;
  trace: [offsetMs: number, deltaZ: number][];
};
export type XRayFrame = {
  type: "XRAY_FRAME";
  taps: RecoilTap[];
  swipes: [timeMs: number, x: number, y: number, stroke: number][];
  keys: [downMs: number, upMs: number][];
};

export function tapWindow(
  tap: Pick<Tap, "t_ms" | "is_trusted">,
  samples: readonly ZSample[],
): RecoilTap {
  const at = tap.t_ms;
  const window = samples.filter((sample) => Math.abs(sample.t_ms - at) <= 40);
  const baseline = window.filter(
    ({ t_ms }) => t_ms >= at - 40 && t_ms <= at - 15,
  );
  const impact = window.filter(({ t_ms }) => t_ms >= at - 5 && t_ms <= at + 35);
  const covered =
    baseline.length > 0 &&
    impact.length >= 2 &&
    window.at(-1)!.t_ms >= at + 10 &&
    window.every(
      (sample, index) =>
        index === 0 ||
        (sample.t_ms > window[index - 1].t_ms &&
          sample.t_ms - window[index - 1].t_ms <= 25),
    );
  if (!covered) return { at, trusted: tap.is_trusted, trace: [] };
  const rest =
    baseline.reduce((sum, sample) => sum + sample.az, 0) / baseline.length;
  const peak = impact.reduce((largest, sample) =>
    Math.abs(sample.az - rest) > Math.abs(largest.az - rest) ? sample : largest,
  );
  const stride = Math.ceil(window.length / 23);
  const trace: RecoilTap["trace"] = window
    .filter((sample, index) => index % stride === 0 || sample === peak)
    .map(({ t_ms, az }) => [t_ms - at, az - rest]);
  return { at, trusted: tap.is_trusted, trace };
}

export class XRayPublisher {
  private samples: ZSample[] = [];
  private pending: Pick<Tap, "t_ms" | "is_trusted">[] = [];
  private swipes: XRayFrame["swipes"] = [];
  private keys: XRayFrame["keys"] = [];
  private stroke = 0;

  motion(sample: ZSample) {
    // Cover pre-tap intervals and the maximum batching delay.
    this.samples = this.samples.filter(({ t_ms }) => t_ms >= sample.t_ms - 350);
    if (this.samples.length >= 256) this.samples.shift();
    if (Math.abs(sample.az) <= 200) this.samples.push(sample);
  }

  tap(tap: Pick<Tap, "t_ms" | "is_trusted">) {
    if (this.pending.length < 12) this.pending.push(tap);
  }

  swipe(point: SliderPoint, first: boolean) {
    if (first) this.stroke++;
    if (this.swipes.length < 48)
      this.swipes.push([point.t_ms, point.x_norm, point.y_norm, this.stroke]);
  }

  key(key: Pick<KeySample, "down_ms" | "up_ms">) {
    if (this.keys.length < 24) this.keys.push([key.down_ms, key.up_ms]);
  }

  flush(socket: WebSocket | undefined, now: number, final = false) {
    const taps = this.pending.filter((tap) => final || tap.t_ms + 45 <= now);
    this.pending = this.pending.filter((tap) => !taps.includes(tap));
    const frame: XRayFrame = {
      type: "XRAY_FRAME",
      taps: taps.map((tap) => tapWindow(tap, this.samples)),
      swipes: this.swipes,
      keys: this.keys,
    };
    this.swipes = [];
    this.keys = [];
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      socket.bufferedAmount > 16_384
    )
      return;
    if (frame.taps.length || frame.swipes.length || frame.keys.length)
      socket.send(JSON.stringify(frame));
  }

  clearMotion() {
    this.samples = [];
  }

  reset() {
    this.clearMotion();
    this.pending = [];
    this.swipes = [];
    this.keys = [];
    this.stroke++;
  }
}

// Fixture replay uses the same tap window and display packet as a live phone.
export function replayFrames(
  recording: SessionTelemetry,
): { at: number; frame: XRayFrame }[] {
  const frames = new Map<number, XRayFrame>();
  const frameAt = (time: number) => {
    const bucket = Math.ceil(time / 150) * 150;
    const frame = frames.get(bucket) ?? {
      type: "XRAY_FRAME",
      taps: [],
      swipes: [],
      keys: [],
    };
    frames.set(bucket, frame);
    return frame;
  };
  for (const tap of recording.taps)
    frameAt(tap.t_ms + 45).taps.push(tapWindow(tap, recording.imu_samples));
  let stroke = 1;
  let previous = -Infinity;
  for (const point of recording.slider_trace) {
    if (point.t_ms - previous > 150) stroke++;
    previous = point.t_ms;
    frameAt(point.t_ms).swipes.push([
      point.t_ms,
      point.x_norm,
      point.y_norm,
      stroke,
    ]);
  }
  for (const key of recording.keystrokes)
    frameAt(key.up_ms).keys.push([key.down_ms, key.up_ms]);
  return [...frames]
    .sort(([a], [b]) => a - b)
    .map(([at, frame]) => ({ at, frame }));
}
