import { useId, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Layers3,
  Maximize2,
  Minimize2,
  Network,
} from "lucide-react";
import {
  decisionLabel,
  type DashboardData,
  type DashboardEvent,
} from "../types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { PopulationScene } from "./PopulationScene";
import "./population-map.css";

type Dot = NonNullable<DashboardData["population_map"]>["points"][number];
export type SelectedDot = Pick<
  Dot,
  "session_id" | "account_id" | "status" | "synthetic"
> &
  Partial<Pick<Dot, "operator_id">>;

const statuses = ["Normal", "Elevated", "Critical", "Unverified"] as const;
export type MapStatus = (typeof statuses)[number];

function statusFor(status: string): MapStatus {
  if (/CRITICAL|HOLD|BANNED/i.test(status)) return "Critical";
  if (/DRIFT|STRESS|WARN|STEP|ELEVATED/i.test(status)) return "Elevated";
  if (/NORMAL|SUCCESS/i.test(status)) return "Normal";
  return "Unverified";
}

type Session = Dot & {
  id: string;
  label: string;
  description?: string;
  tone: MapStatus;
};

export type MapStack = {
  id: string;
  x: number;
  y: number;
  z: number;
  sessions: Session[];
};

function hasPosition(session: Session) {
  return (
    session.position_3d?.length === 3 &&
    session.position_3d.every(Number.isFinite)
  );
}

function groupMarker(group: number, members: Session[]): MapStack[] {
  const plotted = members.filter(hasPosition);
  if (group < 0 || !plotted.length) return [];
  const center = [0, 0, 0];
  for (const session of plotted) {
    session.position_3d!.forEach((value, axis) => {
      center[axis] += value;
    });
  }
  return [
    {
      id: String(group),
      x: center[0] / plotted.length,
      y: center[1] / plotted.length,
      z: center[2] / plotted.length,
      sessions: members,
    },
  ];
}

function collectSessions(data?: DashboardData) {
  const byId = new Map<string, Dot>();
  const map = data?.population_map;
  for (const [index, dot] of (map?.points ?? []).entries()) {
    byId.set(dot.session_id ?? `point-${index}`, dot);
  }
  const events = new Map(
    data?.events.map((event) => [event.session_id, event]),
  );
  for (const event of events.values()) {
    if (!event.map_point) continue;
    const stored = byId.get(event.session_id);
    if (map && "next" in map && !stored) continue;
    byId.set(event.session_id, {
      ...event.map_point,
      // Use the current model generation's position and cluster when available.
      ...stored,
      status:
        stored?.status === "BANNED" ? stored.status : event.map_point.status,
      session_id: event.session_id,
      account_id: event.account_id,
    });
  }

  return [...byId]
    .filter(([, dot]) => Number.isFinite(dot.x) && Number.isFinite(dot.y))
    .map(([id, dot]): Session => {
      const event = events.get(id);
      return {
        ...dot,
        id,
        label: event?.account_label ?? dot.account_id ?? dot.operator_id ?? id,
        description:
          event && (event.flags[0]?.title ?? decisionLabel[event.decision]),
        tone: statusFor(dot.status),
      };
    });
}

function sessionCount(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

function groupLabel(group: number) {
  return group < 0 ? "Ungrouped" : `Group ${group}`;
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
  onSelect: (dot: SelectedDot) => void;
}) {
  const browserId = useId();
  const [expanded, setExpanded] = useState(false);
  function inspect(dot: SelectedDot) {
    setExpanded(false);
    onSelect(dot);
  }
  const sessions = useMemo(() => collectSessions(data), [data]);
  const [filter, setFilter] = useState<MapStatus>();
  const [group, setGroup] = useState<number>();
  const [stackId, setStackId] = useState<string>();
  const visible = filter
    ? sessions.filter((session) => session.tone === filter)
    : sessions;
  const groups = new Map<number, Session[]>();
  for (const session of visible) {
    const members = groups.get(session.cluster_id) ?? [];
    members.push(session);
    groups.set(session.cluster_id, members);
  }
  const groupRows = [...groups].sort(
    ([left, a], [right, b]) =>
      Number(left < 0) - Number(right < 0) ||
      b.length - a.length ||
      left - right,
  );
  const groupSessions = group === undefined ? undefined : groups.get(group);
  const overview = !groupSessions;
  const markers = (() => {
    if (!groupSessions)
      return groupRows.flatMap(([id, members]) => groupMarker(id, members));
    const locations = new Map<string, MapStack>();
    for (const session of groupSessions) {
      if (!hasPosition(session)) continue;
      const [x, y, z] = session.position_3d!;
      const id = [x, y, z].join(",");
      const stack = locations.get(id) ?? { id, x, y, z, sessions: [] };
      stack.sessions.push(session);
      locations.set(id, stack);
    }
    return [...locations.values()];
  })();
  const stackSessions = stackId
    ? markers.find((marker) => marker.id === stackId)?.sessions
    : undefined;
  const detail = stackSessions ?? groupSessions;
  function openGroup(next?: number) {
    setStackId(undefined);
    setGroup(next);
  }
  function changeFilter(next?: MapStatus) {
    setStackId(undefined);
    if (next && !groupSessions?.some((session) => session.tone === next))
      setGroup(undefined);
    setFilter(next);
  }
  const synthetic = sessions.filter((session) => session.synthetic).length;

  const header = (large: boolean) => (
    <header className="population-header">
      <div>
        <h2 id={large ? undefined : "population-title"}>Embedding space</h2>
        <p>
          Explore groups of transfers with similar interaction patterns. Select
          a group to see its sessions.
        </p>
      </div>
      <span className="population-count">
        <Network size={16} aria-hidden="true" />
        {sessionCount(sessions.length)}
      </span>
      {large ? (
        <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
          <Minimize2 /> Collapse
        </Button>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Maximize2 /> Expand
          </Button>
        </DialogTrigger>
      )}
    </header>
  );
  const contents = !data ? (
    <p role="status">
      {unavailable ? "Map service unavailable" : "Loading map…"}
    </p>
  ) : (
    <>
      <div className="population-layout">
        <a className="population-skip" href={`#${browserId}`}>
          Skip to behavior groups
        </a>
        <div className="population-main">
          <PopulationScene
            key={overview ? "overview" : group}
            stacks={markers}
            onBack={() => openGroup(undefined)}
            overview={overview}
            heading={overview ? "Group overview" : groupLabel(group!)}
            selected={selected}
            onActivate={(marker) => {
              if (overview) openGroup(Number(marker.id));
              else if (marker.sessions.length > 1) setStackId(marker.id);
              else inspect(marker.sessions[0]);
            }}
          />
          <div
            className="population-legend"
            role="group"
            aria-label="Filter by session status"
          >
            <button
              type="button"
              aria-pressed={!filter}
              onClick={() => changeFilter(undefined)}
            >
              All <b>{sessions.length}</b>
            </button>
            {statuses.map((status) => {
              const count = sessions.filter(
                (session) => session.tone === status,
              ).length;
              return (
                <button
                  type="button"
                  key={status}
                  aria-pressed={filter === status}
                  disabled={!count}
                  onClick={() =>
                    changeFilter(filter === status ? undefined : status)
                  }
                >
                  <i data-tone={status} aria-hidden="true" />
                  {status} <b>{count}</b>
                </button>
              );
            })}
          </div>
          <p className="population-note">
            {overview
              ? "Each number identifies a group at its average 3D position."
              : "Color shows session status. A number marks sessions at the same position."}
            {overview &&
              groups.has(-1) &&
              " Ungrouped sessions are listed separately."}
            {sessions.some((s) => !s.position_3d) &&
              " Sessions without 3D coordinates are available in the group list."}
            {preview
              ? " Showing synthetic fixtures."
              : synthetic > 0
                ? ` Seeded examples: ${synthetic}.`
                : ""}
          </p>
        </div>
        <aside
          id={browserId}
          tabIndex={-1}
          className="population-browser"
          aria-label="Behavior groups and sessions"
        >
          <div className="population-browser-head">
            {detail && (
              <button
                type="button"
                className="population-back"
                onClick={() => openGroup(stackSessions ? group : undefined)}
              >
                <ArrowLeft size={14} aria-hidden="true" />{" "}
                {stackSessions ? groupLabel(group!) : "All groups"}
              </button>
            )}
            <h3>
              {stackSessions
                ? "Overlapping sessions"
                : groupSessions
                  ? groupLabel(group!)
                  : "Behavior groups"}
            </h3>
            <p aria-live="polite">
              {detail
                ? `${sessionCount(detail.length)}. Select a session to inspect it.`
                : groupRows.length
                  ? "Choose a group to see its sessions."
                  : "Sessions appear here when they have a map position."}
            </p>
          </div>
          {detail ? (
            <ul className="population-list">
              {detail.map((session) => (
                <li key={session.id}>
                  <button type="button" onClick={() => inspect(session)}>
                    <i
                      className="population-status"
                      data-tone={session.tone}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{session.description ?? session.label}</strong>
                      {session.description && <small>{session.label}</small>}
                      <small>{session.session_id ?? session.id}</small>
                      <small
                        className="population-row-tone"
                        data-tone={session.tone}
                      >
                        {session.status === "BANNED" ? "Banned" : session.tone}
                        {session.synthetic ? " · Seed" : ""}
                      </small>
                    </span>
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="population-list">
              {groupRows.map(([group, members]) => (
                <li key={group}>
                  <button type="button" onClick={() => openGroup(group)}>
                    <span className="population-group-icon">
                      {group < 0 ? (
                        <Layers3 size={17} aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">{group}</span>
                      )}
                    </span>
                    <span>
                      <strong>{groupLabel(group)}</strong>
                      <small>{sessionCount(members.length)}</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      <details className="population-guide">
        <summary>How to read this map</summary>
        <p>
          A group can include different people with similar tapping, typing or
          swiping patterns. Open a numbered group to inspect its sessions. Color
          shows a session’s status.
        </p>
      </details>
    </>
  );
  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <section
        className="panel population-panel"
        aria-labelledby="population-title"
      >
        {header(false)}
        {!expanded && contents}
      </section>
      {expanded && (
        <DialogContent
          className="population-panel population-expanded"
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
