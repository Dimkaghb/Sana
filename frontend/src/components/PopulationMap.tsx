import { useId, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  decisionLabel,
  type DashboardData,
  type DashboardEvent,
} from "../types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { SimilarityPlot } from "./SimilarityPlot";
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

export type MapSession = Dot & {
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
  sessions: MapSession[];
};

function hasPosition(session: MapSession) {
  return (
    session.position_3d?.length === 3 &&
    session.position_3d.every(Number.isFinite)
  );
}

function groupMarker(group: number, members: MapSession[]): MapStack[] {
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
    .map(([id, dot]): MapSession => {
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
  const [projection, setProjection] = useState<"2D" | "3D">("2D");
  const [highlighted, setHighlighted] = useState<number>();
  const visible = filter
    ? sessions.filter((session) => session.tone === filter)
    : sessions;
  const groups = new Map<number, MapSession[]>();
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
    if (projection !== "3D") return [];
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
  const stackSessions =
    stackId === undefined
      ? undefined
      : projection === "3D"
        ? markers.find((marker) => marker.id === stackId)?.sessions
        : groupSessions?.filter((s) => [s.x, s.y].join(",") === stackId);
  const groupTotal = groupRows.filter(([id]) => id >= 0).length;
  const detail = stackSessions ?? groupSessions;
  function openGroup(next?: number) {
    setHighlighted(undefined);
    setStackId(undefined);
    setGroup(next);
  }
  function changeFilter(next?: MapStatus) {
    setHighlighted(undefined);
    setStackId(undefined);
    if (next && !groupSessions?.some((session) => session.tone === next))
      setGroup(undefined);
    setFilter(next);
  }
  const synthetic = sessions.filter((session) => session.synthetic).length;
  const ringEvidence = new Set(
    data?.rings?.map((ring) => ring.evidence_session_id),
  );
  const ringGroups = new Set(
    sessions
      .filter((session) => ringEvidence.has(session.id))
      .map((session) => session.cluster_id),
  );

  const header = (large: boolean) => (
    <header className="population-header">
      <div>
        <h2 id={large ? undefined : "population-title"}>Session similarity</h2>
        <p>
          {projection === "2D"
            ? "Each dot is a session. Nearby dots suggest similar tapping, typing or swiping patterns."
            : "Select a numbered group to explore its sessions in three dimensions."}
        </p>
      </div>
      <div className="population-tools">
        <div
          className="population-switch"
          role="group"
          aria-label="Map projection"
        >
          {(["2D", "3D"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={projection === mode}
              onClick={() => {
                setProjection(mode);
                setStackId(undefined);
                setHighlighted(undefined);
              }}
            >
              {mode === "2D" ? "2D map" : "3D view"}
            </button>
          ))}
        </div>
        {large ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded(false)}
          >
            <Minimize2 />
            <span className="sr-only">Collapse</span>
          </Button>
        ) : (
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="Expand">
              <Maximize2 />
              <span className="sr-only">Expand</span>
            </Button>
          </DialogTrigger>
        )}
      </div>
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
          <div className="population-plot-meta">
            <span aria-live="polite">
              {groupSessions ? (
                <>
                  <button
                    type="button"
                    className="population-back"
                    aria-label="Return to group overview"
                    onClick={() => openGroup()}
                  >
                    All groups
                  </button>
                  <ChevronRight size={13} />
                  {groupLabel(group!)}
                </>
              ) : (
                <>
                  {groupTotal} {groupTotal === 1 ? "group" : "groups"}
                </>
              )}
              <span className="population-total">
                {sessionCount((groupSessions ?? visible).length)}
              </span>
            </span>
          </div>
          {projection === "2D" ? (
            <SimilarityPlot
              groups={groupRows}
              group={overview ? undefined : group}
              domain={
                overview
                  ? sessions
                  : sessions.filter((s) => s.cluster_id === group)
              }
              highlighted={highlighted}
              selected={selected}
              onHighlight={setHighlighted}
              onGroup={openGroup}
              onInspect={(members) => {
                if (members.length === 1) inspect(members[0]);
                else setStackId([members[0].x, members[0].y].join(","));
              }}
            />
          ) : (
            <PopulationScene
              key={overview ? "overview" : group}
              stacks={markers}
              overview={overview}
              selected={selected}
              onActivate={(marker) => {
                if (overview) openGroup(Number(marker.id));
                else if (marker.sessions.length > 1) setStackId(marker.id);
                else inspect(marker.sessions[0]);
              }}
            />
          )}
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
        </div>
        <aside
          id={browserId}
          tabIndex={-1}
          className="population-browser"
          aria-label="Behavior groups and sessions"
        >
          <div className="population-browser-head">
            {stackSessions && (
              <button
                type="button"
                className="population-back"
                onClick={() => openGroup(group)}
              >
                <ArrowLeft size={14} aria-hidden="true" /> {groupLabel(group!)}
              </button>
            )}
            <h3>
              {stackSessions
                ? "Overlapping sessions"
                : groupSessions
                  ? groupLabel(group!)
                  : "Groups"}
            </h3>
            <p aria-live="polite">
              {detail
                ? sessionCount(detail.length)
                : groupRows.length
                  ? "Bars show the status mix."
                  : "No sessions match this filter."}
            </p>
            {group !== undefined && group >= 0 && ringGroups.has(group) && (
              <a
                className="population-back"
                href="#suspected-mule-rings"
                onClick={() => setExpanded(false)}
              >
                Suspected mule ring{" "}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            )}
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
            <ul className="population-list population-groups">
              {groupRows.map(([id, members]) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => openGroup(id)}
                    data-highlighted={highlighted === id}
                    onMouseEnter={() => setHighlighted(id)}
                    onMouseLeave={() => setHighlighted(undefined)}
                    onFocus={() => setHighlighted(id)}
                    onBlur={() => setHighlighted(undefined)}
                  >
                    <span>
                      <strong>{groupLabel(id)}</strong>
                      {id >= 0 && ringGroups.has(id) && (
                        <small aria-hidden="true">Suspected mule ring</small>
                      )}
                    </span>
                    <span className="population-composition" aria-hidden="true">
                      {statuses.map((tone) => {
                        const count = members.filter(
                          (s) => s.tone === tone,
                        ).length;
                        return (
                          count > 0 && (
                            <i
                              key={tone}
                              data-tone={tone}
                              style={{ flexGrow: count }}
                              title={tone + " · " + count}
                            />
                          )
                        );
                      })}
                    </span>
                    <span className="population-group-size">
                      {members.length}
                      <span className="sr-only">
                        {" "}
                        {members.length === 1 ? "session" : "sessions"}
                      </span>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      <footer className="population-footer">
        <details className="population-guide">
          <summary>How to read this map</summary>
          <p>
            A group can include different people with similar interactions. In
            2D, each dot represents a session. Sessions at identical coordinates
            share a dot. Select a group to inspect its sessions. Hollow dots
            have unverified status.
          </p>
          <p>
            The 2D map uses UMAP. The 3D view uses a separate PCA projection,
            with numbered markers at the average position of each group.
            Sessions without 3D coordinates and ungrouped sessions remain in the
            list.
          </p>
        </details>
        {(preview || synthetic > 0) && (
          <span className="population-note">
            {preview
              ? "Synthetic fixture data"
              : synthetic +
                (synthetic === 1
                  ? " synthetic session"
                  : " synthetic sessions")}
          </span>
        )}
      </footer>
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
