import { useEffect, useState } from "react";
import { Activity, Fingerprint, MoveUpRight } from "lucide-react";
import { replayFrames, type XRayFrame, type SessionTelemetry } from "../sdk";
import type { DashboardEvent } from "../types";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import "./telemetry-xray.css";

type Replay = "normal" | "synthetic_touch";
const empty: XRayFrame = { type: "XRAY_FRAME", taps: [], swipes: [], keys: [] };

function useFrames(session: string, replay?: Replay) {
  const [samples, setSamples] = useState(empty);
  const [status, setStatus] = useState(
    replay ? "Loading fixture…" : "Connecting…",
  );

  useEffect(() => {
    function append(frame: XRayFrame) {
      setSamples((current) => ({
        type: "XRAY_FRAME",
        taps: [...current.taps, ...frame.taps].slice(-12),
        swipes: [...current.swipes, ...frame.swipes].slice(-240),
        keys: [...current.keys, ...frame.keys].slice(-80),
      }));
    }
    if (replay) {
      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      async function play() {
        const module =
          replay === "normal"
            ? await import("../../../contracts/fixtures/normal/telemetry.json")
            : await import("../../../contracts/fixtures/synthetic_touch/telemetry.json");
        if (cancelled) return;
        const frames = replayFrames(module.default as SessionTelemetry);
        setStatus("Playing synthetic fixture");
        for (const { at, frame } of frames)
          timers.push(setTimeout(() => append(frame), at));
        timers.push(
          setTimeout(
            () => setStatus("Fixture playback complete"),
            frames.at(-1)?.at ?? 0,
          ),
        );
      }
      void play().catch(() => {
        if (!cancelled) setStatus("Fixture unavailable");
      });
      return () => {
        cancelled = true;
        timers.forEach((timer) => clearTimeout(timer));
      };
    }
    if (!session) return;
    const url = new URL(
      "/ws/xray/" + encodeURIComponent(session),
      location.href,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout>;
    let delay = 500;
    let ended = false;
    function connect() {
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        delay = 500;
        setStatus("Connected · waiting for shared signals");
      };
      ws.onmessage = ({ data }) => {
        try {
          const frame = JSON.parse(data);
          if (
            frame.type === "XRAY_FRAME" &&
            Array.isArray(frame.taps) &&
            Array.isArray(frame.swipes) &&
            Array.isArray(frame.keys)
          ) {
            setStatus("Receiving live phone signals");
            append(frame);
          } else if (frame.type === "XRAY_ENDED") {
            ended = true;
            setStatus("Phone stream ended · last samples shown");
            ws.close();
          }
        } catch {
          // A malformed message does not interrupt the phone's transfer.
        }
      };
      ws.onclose = ({ code }) => {
        if (ended) return;
        if (code === 1008) {
          setStatus("Session unavailable · select an active phone");
          return;
        }
        setStatus("Stream disconnected · reconnecting");
        reconnect = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 5000);
      };
    }
    connect();
    return () => {
      clearTimeout(reconnect);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = null;
        socket.close();
      }
    };
  }, [session, replay]);

  return { samples, status };
}

function Polyline({ points }: { points: [number, number][] }) {
  return <polyline points={points.map(([x, y]) => `${x},${y}`).join(" ")} />;
}

function Charts({
  session,
  replay,
  event,
}: {
  session: string;
  replay?: Replay;
  event?: DashboardEvent;
}) {
  const { samples, status } = useFrames(session, replay);
  const tap = samples.taps.at(-1);
  const scale = Math.max(1, ...(tap?.trace.map(([, z]) => Math.abs(z)) ?? []));
  const peak = tap?.trace
    .filter(([t]) => t >= -5 && t <= 35)
    .reduce((max, [, z]) => Math.max(max, Math.abs(z)), 0);
  const swipe = samples.swipes.filter(
    (point) => point[3] === samples.swipes.at(-1)?.[3],
  );
  const duration = Math.max(1, (swipe.at(-1)?.[0] ?? 0) - (swipe[0]?.[0] ?? 0));
  const speeds = swipe
    .slice(1)
    .flatMap(([time, x, y], index): [number, number][] => {
      const previous = swipe[index];
      const elapsed = time - previous[0];
      return elapsed >= 1 && elapsed <= 150
        ? [
            [
              time,
              (Math.hypot(x - previous[1], y - previous[2]) * 1000) / elapsed,
            ],
          ]
        : [];
    });
  const maxSpeed = Math.max(1, ...speeds.map(([, speed]) => speed));
  const keys = [...samples.keys].sort(([a], [b]) => a - b);
  const lastKey = keys.at(-1);
  const previousKey = keys.at(-2);
  const keyStart = Math.max(0, (lastKey?.[1] ?? 0) - 6000);
  const keySpan = Math.max(1000, (lastKey?.[1] ?? 0) - keyStart);
  const flag = event?.flags.find(
    ({ code }) => code === "ZERO_RECOIL_RAT" || code === "RECOIL_UNAVAILABLE",
  );
  return (
    <>
      <p role="status" className="xray-status">
        {status}
      </p>
      <div className="xray-grid">
        <article>
          <h3>
            <Activity size={17} /> Tap recoil
          </h3>
          {tap?.trace.length ? (
            <>
              <svg
                viewBox="0 0 240 80"
                role="img"
                aria-label="Baseline-relative Z acceleration from 40 milliseconds before to 40 milliseconds after the tap"
              >
                <path className="xray-gridline" d="M0 40h240 M120 0v80" />
                <Polyline
                  points={tap.trace.map(([t, z]) => [
                    (t + 40) * 3,
                    40 - (z / scale) * 37,
                  ])}
                />
              </svg>
              <p>
                {peak?.toFixed(3)} m/s² peak ·{" "}
                {tap.trusted
                  ? "Browser-trusted tap"
                  : "Synthetic pointer event"}
              </p>
            </>
          ) : (
            <p className="xray-empty">
              {tap
                ? "Tap motion unavailable · insufficient sensor coverage"
                : "Waiting for a tap with motion samples"}
            </p>
          )}
          {flag && (
            <p className="xray-result">Scored transfer · {flag.title}</p>
          )}
        </article>
        <article>
          <h3>
            <MoveUpRight size={17} /> Swipe curve and speed
          </h3>
          {swipe.length > 1 ? (
            <>
              <div className="xray-swipes">
                <svg
                  viewBox="0 0 120 80"
                  role="img"
                  aria-label="Swipe path in normalized screen coordinates"
                >
                  <Polyline
                    points={swipe.map(([, x, y]) => [x * 120, y * 80])}
                  />
                </svg>
                <svg
                  viewBox="0 0 120 80"
                  role="img"
                  aria-label="Swipe speed over time"
                >
                  {speeds.map(([time, speed], index) => (
                    <line
                      key={index}
                      x1={((time - swipe[0][0]) / duration) * 120}
                      x2={((time - swipe[0][0]) / duration) * 120}
                      y1="80"
                      y2={80 - (speed / maxSpeed) * 75}
                    />
                  ))}
                </svg>
              </div>
              <p>
                Path ·{" "}
                {speeds.length
                  ? `${Math.max(...speeds.map(([, v]) => v)).toFixed(2)} viewport units/s peak`
                  : "Speed unavailable"}
              </p>
            </>
          ) : (
            <p className="xray-empty">
              Waiting for a swipe on the confirmation slider
            </p>
          )}
        </article>
        <article>
          <h3>
            <Fingerprint size={17} /> Cadence rhythm
          </h3>
          {lastKey ? (
            <>
              <svg
                viewBox="0 0 240 80"
                role="img"
                aria-label="Key dwell and the gaps between key presses over the last six seconds"
              >
                <path className="xray-gridline" d="M0 62h240" />
                {keys
                  .filter(([, up]) => up >= keyStart)
                  .map(([down, up], index) => (
                    <rect
                      key={index}
                      x={
                        ((Math.max(down, keyStart) - keyStart) / keySpan) * 240
                      }
                      y="25"
                      width={Math.max(
                        2,
                        ((up - Math.max(down, keyStart)) / keySpan) * 240,
                      )}
                      height="37"
                      rx="1"
                    />
                  ))}
              </svg>
              <p>
                {Math.round(lastKey[1] - lastKey[0])} ms dwell
                {previousKey
                  ? ` · ${Math.round(Math.max(0, lastKey[0] - previousKey[1]))} ms preceding gap`
                  : ""}
              </p>
            </>
          ) : (
            <p className="xray-empty">Waiting for a keypad press and release</p>
          )}
        </article>
      </div>
    </>
  );
}

export function TelemetryXRay({
  active,
  events,
  preview,
}: {
  active: string[];
  events: DashboardEvent[];
  preview: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState("");
  const [replay, setReplay] = useState<Replay>();
  const [generation, setGeneration] = useState(0);
  const first = active[0];
  useEffect(() => {
    if (open && first) setSession((current) => current || first);
  }, [open, first]);
  const options =
    session && !active.includes(session) ? [session, ...active] : active;
  return (
    <section className="panel xray-panel" aria-label="Telemetry X-Ray">
      <header className="panel-head">
        <h2>Telemetry X-Ray</h2>
        <Button
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide live signals" : "Show live signals"}
        </Button>
      </header>
      {open && (
        <div className="xray-body">
          <div className="xray-controls">
            {!preview && (
              <NativeSelect
                aria-label="X-Ray mobile session"
                value={replay ? "" : session}
                onChange={(e) => {
                  setSession(e.target.value);
                  setReplay(undefined);
                  setGeneration((n) => n + 1);
                }}
              >
                <NativeSelectOption value="" disabled>
                  Select a phone session
                </NativeSelectOption>
                {options.map((id) => (
                  <NativeSelectOption key={id} value={id}>
                    {id}
                    {active.includes(id) ? "" : " · ended"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
            <Button
              variant="outline"
              aria-pressed={replay === "normal"}
              onClick={() => {
                setReplay("normal");
                setGeneration((n) => n + 1);
              }}
            >
              Replay handheld fixture
            </Button>
            <Button
              variant="outline"
              aria-pressed={replay === "synthetic_touch"}
              onClick={() => {
                setReplay("synthetic_touch");
                setGeneration((n) => n + 1);
              }}
            >
              Replay synthetic-touch fixture
            </Button>
          </div>
          {replay || (session && !preview) ? (
            <Charts
              key={`${replay ?? session}-${generation}`}
              session={replay ? "" : session}
              replay={replay}
              event={
                replay
                  ? undefined
                  : events.find((event) => event.session_id === session)
              }
            />
          ) : (
            <p className="xray-status">
              {preview
                ? "Choose a synthetic fixture to replay."
                : "Start a phone transfer with live analyst sharing enabled."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
