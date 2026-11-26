import { useMemo } from "react";
import { LocateFixed, Radio } from "lucide-react";
import type { DashboardData, DashboardEvent } from "../types";

interface Dot {
  x: number;
  y: number;
  status: string;
  operator_id?: string;
  session_id?: string;
  account_id?: string;
  cluster_id: number;
  synthetic?: boolean;
}
export type SelectedDot = Dot;
export function PopulationMap({
  data,
  selected,
  onSelect,
}: {
  data?: DashboardData;
  selected?: string;
  onSelect: (dot: Dot) => void;
}) {
  const dots = useMemo(() => {
    const byId = new Map<string, Dot>();
    for (const [i, dot] of (data?.population_map?.points || []).entries()) {
      if (Number.isFinite(dot.x) && Number.isFinite(dot.y))
        byId.set(dot.session_id || "map-" + i, dot);
    }
    for (const e of data?.events || []) {
      if (!e.map_point) continue;
      const stored = byId.get(e.session_id);
      byId.set(e.session_id, {
        ...e.map_point,
        session_id: e.session_id,
        account_id: e.account_id,
        status: stored?.status === "BANNED" ? "BANNED" : e.map_point.status,
        synthetic: stored?.synthetic,
      });
    }
    return Array.from(byId.values());
  }, [data]);
  const xs = dots.map((d) => d.x),
    ys = dots.map((d) => d.y);
  const minX = Math.min(0, ...xs),
    maxX = Math.max(1, ...xs),
    minY = Math.min(0, ...ys),
    maxY = Math.max(1, ...ys);
  const px = (x: number) => 50 + ((x - minX) / (maxX - minX)) * 600,
    py = (y: number) => 230 - ((y - minY) / (maxY - minY)) * 190;
  const color = (status: string) =>
    status === "UNVERIFIED"
      ? "#9faea7"
      : /CRITICAL|HOLD|BANNED/i.test(status)
        ? "#ff816b"
        : /DRIFT|STRESS|WARN|STEP/i.test(status)
          ? "#f7be6d"
          : "#5bdfae";
  const clusters = new Map<number, Dot[]>();
  dots
    .filter((dot) => dot.cluster_id >= 0)
    .forEach((dot) => {
      const group = clusters.get(dot.cluster_id) || [];
      group.push(dot);
      clusters.set(dot.cluster_id, group);
    });
  return (
    <section className="panel map-panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">VECTOR INTELLIGENCE</p>
          <h2>Behavioral population map</h2>
        </div>
        <LocateFixed size={20} />
      </header>
      <div className="map">
        <svg
          viewBox="0 0 700 270"
          role="group"
          aria-label="Behavioral embedding projection"
        >
          <defs>
            <pattern
              id="dots"
              width="12"
              height="12"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="0.8" fill="#465e53" />
            </pattern>
            <pattern
              id="grid"
              width="60"
              height="60"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 60 0 L 0 0 0 60"
                fill="none"
                stroke="#668271"
                strokeWidth=".4"
              />
            </pattern>
          </defs>
          <rect width="700" height="270" fill="url(#dots)" />
          <rect width="700" height="270" fill="url(#grid)" />
          <path
            d="M350 0v270M0 135h700"
            stroke="#597066"
            strokeDasharray="3 7"
            opacity=".65"
          />
          {Array.from(clusters).map(([id, group]) => {
            const sx = group.map((d) => px(d.x)),
              sy = group.map((d) => py(d.y));
            const cx = sx.reduce((a, b) => a + b, 0) / sx.length,
              cy = sy.reduce((a, b) => a + b, 0) / sy.length;
            const rx = Math.max(15, ...sx.map((x) => Math.abs(x - cx) + 9)),
              ry = Math.max(13, ...sy.map((y) => Math.abs(y - cy) + 9));
            return (
              <g key={id} aria-hidden="true">
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={rx}
                  ry={ry}
                  fill="#5bdfae"
                  fillOpacity=".035"
                  stroke="#67b789"
                  strokeOpacity=".28"
                  strokeDasharray="3 4"
                />
                <text
                  x={cx}
                  y={Math.max(10, cy - ry - 4)}
                  textAnchor="middle"
                  fill="#9eb4a5"
                  fontSize="8"
                >
                  {"C" + id + " · " + group.length}
                </text>
              </g>
            );
          })}
          {dots.map((dot, i) => (
            <g
              key={(dot.session_id || dot.operator_id || "") + i}
              className="map-dot"
              role="button"
              tabIndex={0}
              aria-label={
                "Inspect " + (dot.operator_id || dot.session_id || "point")
              }
              onClick={() => onSelect(dot)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(dot);
                }
              }}
            >
              <title>
                {dot.synthetic ? "Synthetic seed · " : ""}
                {dot.operator_id} · {dot.status}
              </title>
              <circle
                cx={px(dot.x)}
                cy={py(dot.y)}
                r="13"
                fill={color(dot.status)}
                opacity=".10"
              />
              <circle
                cx={px(dot.x)}
                cy={py(dot.y)}
                r={selected && selected === dot.session_id ? 8 : 4}
                fill={color(dot.status)}
                stroke={dot.synthetic ? color(dot.status) : "#14261e"}
                fillOpacity={dot.synthetic ? 0.35 : 1}
                strokeWidth="1"
              />
            </g>
          ))}
        </svg>
        {!dots.length && (
          <div className="map-empty">
            <Radio size={23} />
            <strong>Awaiting population data</strong>
            <small>Scored sessions with map coordinates appear here.</small>
          </div>
        )}
      </div>
      <footer className="map-legend">
        <div>
          <span>
            <i />
            Normal
          </span>
          <span>
            <i />
            Elevated
          </span>
          <span>
            <i />
            Critical
          </span>
          <span>
            <i style={{ background: "#9faea7" }} />
            Unverified
          </span>
        </div>
        <b>
          {dots.length} POINTS
          {dots.some((dot) => dot.synthetic) && (
            <span>
              {" "}
              · {dots.filter((dot) => dot.synthetic).length} SYNTHETIC
            </span>
          )}
        </b>
      </footer>
    </section>
  );
}
export function Waveform({ event }: { event?: DashboardEvent }) {
  const wave = event?.recoil_waveform || [];
  const times = wave.map((p) => p.t_ms),
    min = Math.min(...times),
    max = Math.max(...times);
  const scale = Math.max(0.001, ...wave.map((p) => Math.abs(p.az_delta)));
  const path = wave
    .map(
      (p, i) =>
        (i ? "L" : "M") +
        (12 + ((p.t_ms - min) / (max - min || 1)) * 286) +
        " " +
        (50 - (p.az_delta / scale) * 40),
    )
    .join(" ");
  return (
    <div className="wave">
      <div>
        <span>Z-axis recoil</span>
        <small>m/s²</small>
      </div>
      {wave.length ? (
        <svg
          viewBox="0 0 310 100"
          role="img"
          aria-label={
            "Recoil waveform across " +
            wave.length +
            " observations, peak " +
            scale.toFixed(3) +
            " meters per second squared"
          }
        >
          <path d="M0 50h310" stroke="#395448" strokeDasharray="3 4" />
          <path d={path} fill="none" stroke="#65dfae" strokeWidth="2" />
        </svg>
      ) : (
        <p>Waveform unavailable</p>
      )}
    </div>
  );
}
