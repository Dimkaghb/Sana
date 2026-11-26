import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Focus,
  CircleHelp,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Radio,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/collapsible";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import type { DashboardData, DashboardEvent } from "../types";
import "./population-map.css";

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
export type SelectedDot = Pick<
  Dot,
  "operator_id" | "session_id" | "account_id" | "status" | "synthetic"
>;

const palette = {
  Normal: "var(--success)",
  Elevated: "var(--warning)",
  Critical: "var(--critical)",
  Unverified: "var(--muted)",
};
type Group = keyof typeof palette;
function statusGroup(status: string): Group {
  if (/CRITICAL|HOLD|BANNED/i.test(status)) return "Critical";
  if (/DRIFT|STRESS|WARN|STEP|ELEVATED/i.test(status)) return "Elevated";
  if (/^(NORMAL|SUCCESS)$/i.test(status)) return "Normal";
  return "Unverified";
}
const clusterName = (id: number) => (id < 0 ? "Ungrouped" : "Group " + id);
const sessionCount = (count: number) =>
  count + (count === 1 ? " session" : " sessions");
type Camera = { x: number; y: number; zoom: number };
function extent(dots: Dot[]) {
  const xs = dots.map((d) => d.x),
    ys = dots.map((d) => d.y);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    bottom = Math.min(...ys),
    top = Math.max(...ys);
  return dots.length
    ? {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        w: right - left,
        h: top - bottom,
      }
    : { x: 0, y: 0, w: 1, h: 1 };
}

// Choose ticks in projection units. X and Y always share one pixels-per-unit scale.
function ticks(low: number, high: number, count: number) {
  const rough = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    ([1, 2, 5, 10].find((n) => n * magnitude >= rough) || 10) * magnitude;
  const first = Math.ceil(low / step);
  return Array.from(
    { length: Math.max(0, Math.floor(high / step) - first + 1) },
    (_, i) => Number(((first + i) * step).toPrecision(8)),
  );
}

export function PopulationMap({
  data,
  selected,
  preview,
  unavailable,
  onSelect,
}: {
  data?: DashboardData;
  selected?: string;
  preview: boolean;
  unavailable: boolean;
  onSelect: (dot: Dot) => void;
}) {
  const dots = useMemo(() => {
    const byId = new Map<string, Dot>();
    for (const [i, d] of (data?.population_map?.points || []).entries())
      if (Number.isFinite(d.x) && Number.isFinite(d.y))
        byId.set(d.session_id || "map-" + i, d);
    for (const e of data?.events || []) {
      const stored = byId.get(e.session_id);
      if (
        !e.map_point ||
        (data?.population_map && "next" in data.population_map && !stored)
      )
        continue;
      byId.set(e.session_id, {
        ...e.map_point,
        ...stored,
        session_id: e.session_id,
        account_id: e.account_id,
        status: stored?.status === "BANNED" ? "BANNED" : e.map_point.status,
      });
    }
    return [...byId.values()];
  }, [data]);
  const [expanded, setExpanded] = useState(false);
  const [cluster, setCluster] = useState<number | null>(null);
  const [filter, setFilter] = useState<Group | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [hover, setHover] = useState<Dot>();
  const [highlight, setHighlight] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 700, h: 430 });
  const drag = useRef<{
    px: number;
    py: number;
    cx: number;
    cy: number;
  } | null>(null);
  const clip = useId();
  const measureCanvas = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const measure = () =>
      setSize({
        w: Math.max(120, node.clientWidth),
        h: Math.max(120, node.clientHeight),
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      drag.current = null;
    };
  }, []);

  const clusters = useMemo(() => {
    const result = new Map<number, Dot[]>();
    for (const d of dots) {
      if (!result.has(d.cluster_id)) result.set(d.cluster_id, []);
      result.get(d.cluster_id)!.push(d);
    }
    return [...result];
  }, [dots]);
  const active = clusters.find(([id]) => id === cluster);
  const scope = active?.[1] ?? dots;
  const visible = scope.filter(
    (d) => !filter || statusGroup(d.status) === filter,
  );
  const visibleSet = new Set(visible);
  const view = extent(dots);
  const left = 18,
    right = size.w - 18,
    top = 18,
    bottom = size.h - 18;
  const width = right - left,
    height = bottom - top;
  const fit = (e: ReturnType<typeof extent>) =>
    Math.min(width / Math.max(e.w, 0.01), height / Math.max(e.h, 0.01)) * 0.86;
  const base = fit(view);
  const zoom = camera?.zoom ?? 1;
  const scale = base * zoom;
  const center = camera ?? view;
  const px = (x: number) => (left + right) / 2 + (x - center.x) * scale;
  const py = (y: number) => (top + bottom) / 2 - (y - center.y) * scale;
  const groups = useMemo(() => {
    return clusters
      .flatMap(([id, points]) => {
        const matches = filter
          ? points.filter((d) => statusGroup(d.status) === filter)
          : points;
        if (!matches.length) return [];
        return [
          {
            id,
            matches,
            accounts: new Set(matches.map((d) => d.account_id).filter(Boolean))
              .size,
            critical: matches.filter(
              (d) => statusGroup(d.status) === "Critical",
            ).length,
          },
        ];
      })
      .sort(
        (a, b) =>
          Number(a.id < 0) - Number(b.id < 0) ||
          b.matches.length - a.matches.length ||
          a.id - b.id,
      );
  }, [clusters, filter]);
  const example =
    highlight === null ? groups[0] : groups.find((g) => g.id === highlight);
  // Anchor the label to a real session and keep it off neighboring points.
  function locateLabel(points: Dot[]) {
    const boxW = 144,
      boxH = 30;
    if (width < boxW + 40) return null;
    const bounds = extent(points);
    const distance = (d: Dot) => Math.hypot(d.x - bounds.x, d.y - bounds.y);
    const anchor = points.reduce((a, b) =>
      distance(a) <= distance(b) ? a : b,
    );
    const ax = px(anchor.x),
      ay = py(anchor.y);
    if (ax < left || ax > right || ay < top || ay > bottom) return null;
    const candidates = [
      [ax + 22, ay - boxH - 15],
      [ax - boxW - 22, ay - boxH - 15],
      [ax + 22, ay + 15],
      [ax - boxW - 22, ay + 15],
    ].map(([x, y]) => {
      x = Math.max(4, Math.min(size.w - boxW - 4, x));
      y = Math.max(4, Math.min(size.h - boxH - 4, y));
      return { x, y, lineX: ax < x ? x : x + boxW };
    });
    const box = candidates.find(
      ({ x, y }) =>
        !dots.some(
          (d) =>
            px(d.x) >= x - 6 &&
            px(d.x) <= x + boxW + 6 &&
            py(d.y) >= y - 6 &&
            py(d.y) <= y + boxH + 6,
        ),
    );
    return box ? { ...box, ax, ay, boxW, boxH } : null;
  }
  const label =
    !active &&
    !hover &&
    example &&
    example.id >= 0 &&
    example.matches.length > 1
      ? locateLabel(example.matches)
      : null;
  const tx = ticks(
    center.x - width / (2 * scale),
    center.x + width / (2 * scale),
    Math.max(2, Math.floor(width / 140)),
  );
  const ty = ticks(
    center.y - height / (2 * scale),
    center.y + height / (2 * scale),
    Math.max(2, Math.floor(height / 100)),
  );
  const hovered =
    hover &&
    visible.find(
      (d) =>
        d === hover || (hover.session_id && d.session_id === hover.session_id),
    );
  function focusCluster(id: number, points: Dot[]) {
    const bounds = extent(points);
    setCluster(id);
    setHighlight(null);
    setHover(undefined);
    setCamera({
      x: bounds.x,
      y: bounds.y,
      zoom: Math.min(64, Math.max(1, fit(bounds) / base)),
    });
  }
  function reset() {
    setCamera(null);
    setCluster(null);
    setHover(undefined);
    setHighlight(null);
  }
  function inspect(d: Dot) {
    setHover(undefined);
    setExpanded(false);
    onSelect(d);
  }
  function changeZoom(factor: number) {
    setHover(undefined);
    setCamera({
      x: center.x,
      y: center.y,
      zoom: Math.min(64, Math.max(1, zoom * factor)),
    });
  }
  const statusCounts = Object.fromEntries(
    Object.keys(palette).map((g) => [
      g,
      scope.filter((d) => statusGroup(d.status) === g).length,
    ]),
  );
  const seedCount = dots.filter((d) => d.synthetic).length;
  const overviewCount = groups.filter(({ id }) => id >= 0).length;
  const header = (large: boolean) => (
    <header className="atlas-head">
      <div>
        <h2>Sessions with similar behavior</h2>
        <p>
          Each dot is one transfer session. Nearby dots suggest similar tapping,
          typing or swiping patterns. Color shows the session’s status.
        </p>
      </div>
      {large ? (
        <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
          <Minimize2 />
          Collapse
        </Button>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Maximize2 />
            Expand
          </Button>
        </DialogTrigger>
      )}
    </header>
  );
  const contents = (
    <>
      <div
        className="atlas-key"
        role="group"
        aria-label="Filter sessions by status"
      >
        <strong>Session status</strong>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={filter === null}
          onClick={() => setFilter(null)}
        >
          All <small>{scope.length}</small>
        </Button>
        {(Object.keys(palette) as Group[]).map((g) => (
          <Button
            variant="ghost"
            size="sm"
            key={g}
            aria-label={g}
            title={g + " · " + statusCounts[g] + " sessions"}
            aria-pressed={filter === g}
            onClick={() => {
              setHover(undefined);
              setFilter(filter === g ? null : g);
            }}
          >
            <i style={{ background: palette[g] }} />
            {g} <small>{statusCounts[g]}</small>
          </Button>
        ))}
      </div>
      <div className="atlas-layout">
        <div className="atlas-graph">
          <div className="atlas-canvas" ref={measureCanvas}>
            {example && label && (
              <button
                type="button"
                className="atlas-annotation"
                style={{
                  left: label.x,
                  top: label.y,
                  width: label.boxW,
                  height: label.boxH,
                }}
                onClick={() => focusCluster(example.id, example.matches)}
                aria-label={`Explore ${clusterName(example.id)}, ${sessionCount(example.matches.length)}`}
              >
                <strong>{clusterName(example.id)}</strong>
                <span>{sessionCount(example.matches.length)}</span>
                <ChevronRight aria-hidden="true" size={12} />
              </button>
            )}
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${size.w} ${size.h}`}
              role="group"
              tabIndex={0}
              aria-label="Transfer sessions grouped by similar behavior"
              aria-description="Use arrow keys to pan and Enter on a point to inspect its session."
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowDown: [0, -1],
                  ArrowUp: [0, 1],
                };
                const move = moves[e.key];
                if (!move) return;
                e.preventDefault();
                setHover(undefined);
                setCamera({
                  x: center.x + (move[0] * width) / (6 * scale),
                  y: center.y + (move[1] * height) / (6 * scale),
                  zoom,
                });
              }}
              onPointerDown={(e) => {
                if (
                  e.button !== 0 ||
                  (e.target as Element).closest("[role=button]")
                )
                  return;
                drag.current = {
                  px: e.clientX,
                  py: e.clientY,
                  cx: center.x,
                  cy: center.y,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (d)
                  setCamera({
                    x: d.cx - (e.clientX - d.px) / scale,
                    y: d.cy + (e.clientY - d.py) / scale,
                    zoom,
                  });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
            >
              <defs>
                <clipPath id={clip}>
                  <rect x={left} y={top} width={width} height={height} />
                </clipPath>
              </defs>
              <g className="atlas-grid" aria-hidden="true">
                {tx.map((t) => (
                  <g key={t}>
                    <line x1={px(t)} x2={px(t)} y1={top} y2={bottom} />
                  </g>
                ))}
                {ty.map((t) => (
                  <g key={t}>
                    <line x1={left} x2={right} y1={py(t)} y2={py(t)} />
                  </g>
                ))}
              </g>
              <g clipPath={`url(#${clip})`}>
                {label && (
                  <line
                    className="atlas-leader"
                    x1={label.ax}
                    y1={label.ay}
                    x2={label.lineX}
                    y2={label.y + label.boxH / 2}
                  />
                )}
                {dots.map((d, i) => {
                  const enabled = visibleSet.has(d);
                  const focused =
                    hovered === d || (!!selected && selected === d.session_id);
                  const muted =
                    !enabled ||
                    (highlight !== null && d.cluster_id !== highlight);
                  return (
                    <g
                      key={d.session_id ?? i}
                      transform={`translate(${px(d.x)} ${py(d.y)})`}
                      opacity={muted ? 0.1 : 1}
                      role={enabled ? "button" : undefined}
                      tabIndex={
                        enabled &&
                        px(d.x) >= left &&
                        px(d.x) <= right &&
                        py(d.y) >= top &&
                        py(d.y) <= bottom
                          ? 0
                          : undefined
                      }
                      aria-label={
                        "Inspect session " +
                        (d.session_id || String(i + 1)) +
                        ", " +
                        statusGroup(d.status) +
                        ", " +
                        clusterName(d.cluster_id)
                      }
                      aria-hidden={enabled ? undefined : true}
                      className="atlas-point"
                      style={{
                        pointerEvents: enabled ? "auto" : "none",
                        color: palette[statusGroup(d.status)],
                      }}
                      onPointerEnter={() => setHover(d)}
                      onPointerLeave={() => setHover(undefined)}
                      onFocus={() => setHover(d)}
                      onBlur={() => setHover(undefined)}
                      onClick={() => inspect(d)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          inspect(d);
                        }
                      }}
                    >
                      <circle r="8" fill="transparent" />
                      <circle
                        className="atlas-ring"
                        r="8"
                        fill="none"
                        stroke="currentColor"
                        opacity={focused ? 1 : 0}
                      />
                      <circle
                        r={d.synthetic ? 3.9 : 5}
                        fill="currentColor"
                        fillOpacity={d.synthetic ? 0.65 : 1}
                        stroke="var(--panel)"
                        strokeWidth=".8"
                      />
                    </g>
                  );
                })}
              </g>
            </svg>
            {hovered && (
              <div
                className="atlas-tip"
                style={{
                  left: Math.max(4, Math.min(size.w - 195, px(hovered.x) + 10)),
                  top: Math.max(4, Math.min(size.h - 63, py(hovered.y) - 59)),
                }}
              >
                <strong>{hovered.account_id || hovered.session_id}</strong>
                <span>
                  {clusterName(hovered.cluster_id)} ·{" "}
                  {statusGroup(hovered.status)}
                  {hovered.synthetic ? " · Simulated" : ""}
                </span>
              </div>
            )}
            {!visible.length && (
              <div className="atlas-empty">
                <Radio />
                <strong>
                  {!data
                    ? unavailable
                      ? "Map service unavailable"
                      : "Loading map…"
                    : !dots.length
                      ? "No projected sessions"
                      : "No matching sessions"}
                </strong>
                {filter && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFilter(null)}
                  >
                    Clear filter
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="atlas-scale">
            <small>Select a dot to review its session.</small>
            <div className="atlas-zoom">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Zoom out"
                disabled={zoom <= 1 || !dots.length}
                onClick={() => changeZoom(0.5)}
              >
                <Minus />
              </Button>
              <span>{Number(zoom.toFixed(1))}×</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Zoom in"
                disabled={zoom >= 64 || !dots.length}
                onClick={() => changeZoom(2)}
              >
                <Plus />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Fit all sessions"
                title="Fit all sessions"
                onClick={reset}
              >
                <Focus />
              </Button>
            </div>
          </div>
        </div>
        <aside className="atlas-index" aria-label="Behavior groups">
          <div className="atlas-index-head">
            {active ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                aria-label="Back to behavior groups"
              >
                <ArrowLeft />
                {clusterName(active[0])}
              </Button>
            ) : (
              <h3>
                Behavior groups <span>{overviewCount}</span>
              </h3>
            )}
            {!active && <small>Sessions ↓</small>}
          </div>
          <div className="atlas-scroll">
            {active
              ? visible.map((d, i) => (
                  <Button
                    variant="ghost"
                    key={d.session_id ?? i}
                    className="atlas-row atlas-session"
                    onFocus={() => setHover(d)}
                    onBlur={() => setHover(undefined)}
                    onMouseEnter={() => setHover(d)}
                    onMouseLeave={() => setHover(undefined)}
                    onClick={() => inspect(d)}
                  >
                    <i style={{ background: palette[statusGroup(d.status)] }} />
                    <span>
                      {d.account_id || "Session"}
                      <small>
                        {statusGroup(d.status)} ·{" "}
                        {d.session_id || d.operator_id}
                      </small>
                    </span>
                    <ArrowUpRight />
                  </Button>
                ))
              : groups.map(
                  ({
                    id,
                    matches,
                    accounts: accountCount,
                    critical: criticalCount,
                  }) => {
                    return (
                      <Button
                        key={id}
                        variant="ghost"
                        className="atlas-row"
                        onMouseEnter={() => setHighlight(id)}
                        onMouseLeave={() => setHighlight(null)}
                        onFocus={() => setHighlight(id)}
                        onBlur={() => setHighlight(null)}
                        onClick={() => focusCluster(id, matches)}
                      >
                        <span className="atlas-group-label">
                          {clusterName(id)}
                          <small>
                            {accountCount
                              ? accountCount +
                                (accountCount === 1 ? " account" : " accounts")
                              : "Account unavailable"}
                            {criticalCount > 0 && (
                              <>
                                {" "}
                                · <em>{criticalCount} critical</em>
                              </>
                            )}
                          </small>
                        </span>
                        <b>{matches.length}</b>
                        <ChevronRight />
                      </Button>
                    );
                  },
                )}
          </div>
        </aside>
      </div>
      <Collapsible className="atlas-guide">
        <footer className="atlas-footer">
          <small>
            {preview
              ? `Example data · ${sessionCount(dots.length)}`
              : seedCount
                ? `${sessionCount(dots.length)} on this page · ${seedCount} simulated`
                : `${sessionCount(dots.length)} on this page`}
          </small>
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="ghost">
              <CircleHelp />
              How to read this map
            </Button>
          </CollapsibleTrigger>
        </footer>
        <CollapsibleContent className="atlas-guide-body">
          <p>
            <strong>Position shows similarity.</strong> UMAP places sessions on
            a flat map using their interaction patterns. Left, right, up and
            down have no risk meaning. Several sessions can overlap.
          </p>
          <p>
            <strong>Color shows status.</strong> Choose a status above the map
            to highlight matching sessions. Critical sessions warrant review.
            Unverified means there is insufficient evidence to verify the
            operator.
          </p>
          <p>
            <strong>Groups help you investigate.</strong> Select a group to see
            its sessions and accounts. A group can include different people with
            similar habits. Open a session to review the evidence.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
  return (
    <Dialog
      open={expanded}
      onOpenChange={(open) => {
        setHover(undefined);
        setHighlight(null);
        setExpanded(open);
      }}
    >
      <Card className="atlas">
        {header(false)}
        {expanded ? <div className="atlas-placeholder" /> : contents}
      </Card>
      {expanded && (
        <DialogContent
          className="atlas atlas-expanded"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Expanded population map</DialogTitle>
          {header(true)}
          {contents}
        </DialogContent>
      )}
    </Dialog>
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
          <path d="M0 50h310" stroke="#c1ccda" strokeDasharray="3 4" />
          <path d={path} fill="none" stroke="var(--navy)" strokeWidth="2" />
        </svg>
      ) : (
        <p>Waveform unavailable</p>
      )}
    </div>
  );
}
