import { useId, useLayoutEffect, useRef, useState } from "react";
import type { MapSession } from "./PopulationMap";

type Props = {
  groups: [number, MapSession[]][];
  domain: MapSession[];
  group?: number;
  highlighted?: number;
  selected?: string;
  onHighlight: (id?: number) => void;
  onGroup: (id: number) => void;
  onInspect: (sessions: MapSession[]) => void;
};

function bounds(sessions: MapSession[]) {
  let left = Infinity,
    right = -Infinity,
    bottom = Infinity,
    top = -Infinity;
  for (const { x, y } of sessions) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    bottom = Math.min(bottom, y);
    top = Math.max(top, y);
  }
  return { left, right, bottom, top };
}

export function SimilarityPlot({
  groups,
  domain,
  group,
  highlighted,
  selected,
  onHighlight,
  onGroup,
  onInspect,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const grid = useId();
  const [size, setSize] = useState({ width: 720, height: 380 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    if (width && height) setSize({ width, height });
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const { left, right, bottom, top } = bounds(domain);
  const spanX = right - left;
  const spanY = top - bottom;
  const scale = Math.min(
    spanX > 0 ? (width - 64) / spanX : Infinity,
    spanY > 0 ? (height - 72) / spanY : Infinity,
  );
  const fit = Number.isFinite(scale) ? scale : 1;
  const labels: { x: number; y: number }[] = [];
  const overview = group === undefined;
  const visibleGroups = overview
    ? groups
    : groups.filter(([id]) => id === group);
  const clouds = visibleGroups.map(([id, sessions]) => {
    const at = new Map<string, MapSession[]>();
    for (const s of sessions) {
      const key = [s.x, s.y].join(",");
      const dots = at.get(key);
      if (dots) dots.push(s);
      else at.set(key, [s]);
    }
    const points = [...at.values()].map((members) => ({
      members,
      x: width / 2 + (members[0].x - (left + right) / 2) * fit,
      y: height / 2 - (members[0].y - (bottom + top) / 2) * fit,
    }));
    const meanX =
      points.reduce((n, p) => n + p.x * p.members.length, 0) / sessions.length;
    const meanY =
      points.reduce((n, p) => n + p.y * p.members.length, 0) / sessions.length;
    const anchor = points.reduce((a, p) =>
      Math.hypot(p.x - meanX, p.y - meanY) <
      Math.hypot(a.x - meanX, a.y - meanY)
        ? p
        : a,
    );
    return { id, sessions, points, anchor };
  });
  // Label the largest groups first. Other groups reveal their label on hover or focus.
  const allPoints = clouds.flatMap((c) => c.points);
  const annotations = clouds
    .flatMap(({ id, anchor }) => {
      if (!overview || (id < 0 && highlighted !== id)) return [];
      const text = id < 0 ? "Ungrouped" : "Group " + id;
      const half = text.length * 3.6 + 5;
      const offsets = [
        [0, -19],
        [0, 20],
        [half + 12, 0],
        [-half - 12, 0],
        [0, -34],
        [0, 34],
      ];
      for (const [dx, dy] of offsets) {
        const x = Math.max(half + 3, Math.min(width - half - 3, anchor.x + dx));
        const y = Math.max(11, Math.min(height - 11, anchor.y + dy));
        if (
          labels.length >= (width < 480 ? 5 : 9) ||
          labels.some(
            (p) => Math.abs(p.x - x) < half * 2 + 6 && Math.abs(p.y - y) < 21,
          ) ||
          allPoints.some(
            (p) => Math.abs(p.x - x) < half && Math.abs(p.y - y) < 11,
          )
        )
          continue;
        labels.push({ x, y });
        return [{ id, text, x, y, anchor }];
      }
      return highlighted === id
        ? [
            {
              id,
              text,
              x: Math.max(half, Math.min(width - half, anchor.x)),
              y: Math.max(11, anchor.y - 19),
              anchor,
            },
          ]
        : [];
    })
    .filter((label) => highlighted === undefined || highlighted === label.id);

  return (
    <div className="similarity-field">
      <svg
        ref={ref}
        className="similarity-plot"
        role="group"
        aria-label="Session similarity map"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <pattern
            id={grid}
            width="36"
            height="36"
            patternUnits="userSpaceOnUse"
          >
            <path
              className="similarity-grid"
              d="M 17 18 h 3 M 18.5 16.5 v 3"
              fill="none"
            />
          </pattern>
        </defs>
        <rect
          width={width}
          height={height}
          fill={`url(#${grid})`}
          aria-hidden="true"
        />
        {clouds.map(({ id, sessions, points }) => {
          const name = id < 0 ? "Ungrouped" : "Group " + id;
          return (
            <g
              key={id}
              className="similarity-cloud"
              data-dimmed={
                overview && highlighted !== undefined && highlighted !== id
              }
              role={overview ? "button" : undefined}
              tabIndex={overview ? 0 : undefined}
              aria-label={
                overview
                  ? `Explore ${name}, ${sessions.length} sessions`
                  : undefined
              }
              onMouseEnter={() => overview && onHighlight(id)}
              onMouseLeave={() => onHighlight(undefined)}
              onFocus={() => overview && onHighlight(id)}
              onBlur={() => onHighlight(undefined)}
              onClick={overview ? () => onGroup(id) : undefined}
              onKeyDown={(e) => {
                if (overview && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onGroup(id);
                }
              }}
            >
              {points.map(({ members, x, y }) => {
                const s = members[0];
                const multi = members.length > 1;
                const r = multi && !overview ? 10 : multi ? 6 : 4.4;
                const tone = members.every((p) => p.tone === s.tone)
                  ? s.tone
                  : "Mixed";
                const description = multi
                  ? `${members.length} overlapping sessions`
                  : `${s.label} · ${s.tone}`;
                return (
                  <g
                    key={s.id}
                    transform={`translate(${x} ${y})`}
                    className="similarity-point"
                    role={overview ? undefined : "button"}
                    tabIndex={overview ? undefined : 0}
                    aria-label={
                      overview
                        ? undefined
                        : "Inspect " +
                          (multi ? description : (s.operator_id ?? s.id))
                    }
                    data-selected={
                      !!selected &&
                      members.some((p) => p.session_id === selected)
                    }
                    onClick={overview ? undefined : () => onInspect(members)}
                    onKeyDown={(e) => {
                      if (!overview && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onInspect(members);
                      }
                    }}
                  >
                    <title>
                      {overview ? name + " · " + description : description}
                    </title>
                    <circle r={Math.max(8, r + 3)} fill="transparent" />
                    <circle className="similarity-dot" data-tone={tone} r={r} />
                    {multi && !overview && (
                      <text className="similarity-count" dy=".35em">
                        {members.length}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        {annotations.map(({ id, text, x, y, anchor }) => (
          <g
            key={id}
            className="similarity-annotation"
            aria-hidden="true"
            onMouseEnter={() => onHighlight(id)}
            onMouseLeave={() => onHighlight(undefined)}
            onClick={() => onGroup(id)}
          >
            <line
              x1={anchor.x}
              y1={anchor.y}
              x2={x}
              y2={y}
              pointerEvents="none"
            />
            <text x={x} y={y} dy=".34em" textAnchor="middle">
              {text}
            </text>
          </g>
        ))}
      </svg>
      {!clouds.length && (
        <p className="population-empty">No sessions to plot in this view.</p>
      )}
    </div>
  );
}
