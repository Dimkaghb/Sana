import { useId, useLayoutEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { MapStack } from "./PopulationMap";

const home = { x: 0, y: 0, z: -2.8, yaw: 0, pitch: 0 };
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function frame(stacks: MapStack[]) {
  const center = { x: 0, y: 0, z: 0 };
  let span = 0.08;
  for (const axis of ["x", "y", "z"] as const) {
    const values = stacks.map((s) => s[axis]);
    if (!values.length) continue;
    const min = Math.min(...values),
      max = Math.max(...values);
    center[axis] = (min + max) / 2;
    span = Math.max(span, max - min);
  }
  // A rigid initial viewing angle and a uniform scale preserve the PCA geometry.
  return stacks.map((stack) => {
    const x = ((stack.x - center.x) * 2) / span;
    const y = ((stack.y - center.y) * 2) / span;
    const z = ((stack.z - center.z) * 2) / span;
    return { stack, x: x * 0.8 + z * 0.6, y, z: z * 0.8 - x * 0.6 };
  });
}

type LabelPosition = { x: number; y: number; radius: number };

// Offset only the numbered label when two centers coincide in screen space.
function placeLabel(
  anchor: LabelPosition,
  placed: LabelPosition[],
  width: number,
  height: number,
) {
  for (let ring = 0; ring <= 4; ring++) {
    const steps = Math.max(1, ring * 8);
    for (let index = 0; index < steps; index++) {
      const angle = (index * 2 * Math.PI) / steps;
      const x = anchor.x + ring * 16 * Math.cos(angle);
      const y = anchor.y + ring * 16 * Math.sin(angle);
      if (
        x < anchor.radius ||
        x > width - anchor.radius ||
        y < anchor.radius ||
        y > height - anchor.radius
      )
        continue;
      if (
        placed.every(
          (p) => Math.hypot(x - p.x, y - p.y) >= p.radius + anchor.radius + 4,
        )
      ) {
        return { x, y, radius: anchor.radius };
      }
    }
  }
  return anchor;
}

export function PopulationScene({
  stacks,
  overview,
  selected,
  onActivate,
}: {
  stacks: MapStack[];
  overview: boolean;
  selected?: string;
  onActivate: (marker: MapStack) => void;
}) {
  const id = useId();
  const canvas = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 450 });
  const [view, setView] = useState(home);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    if (width && height) setSize({ width, height });
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const world = frame(stacks);
  // Fit the home camera once per cloud/viewport. Walking changes depth and parallax.
  const width = size.width,
    height = size.height;
  let focal = Math.min(width, height) * 1.04;
  for (const p of world) {
    const distance = p.z - home.z;
    focal = Math.min(
      focal,
      (width * 0.39 * distance) / (Math.abs(p.x) || 0.001),
      (height * 0.34 * distance) / (Math.abs(p.y) || 0.001),
    );
  }
  const cy = Math.cos(view.yaw),
    sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch),
    sp = Math.sin(view.pitch);
  function project(x: number, y: number, z: number) {
    const dx = x - view.x,
      dy = y - view.y,
      dz = z - view.z;
    const forward = dx * sy + dz * cy;
    const depth = forward * cp + dy * sp;
    if (depth < 0.09) return undefined;
    return {
      x: width / 2 + ((dx * cy - dz * sy) * focal) / depth,
      y: height / 2 - ((dy * cp - forward * sp) * focal) / depth,
      depth,
    };
  }
  function look(yaw: number, pitch: number) {
    setView((v) => ({
      ...v,
      yaw: v.yaw + yaw,
      pitch: clamp(v.pitch + pitch, -1.4, 1.4),
    }));
  }
  function walk(direction: number) {
    setView((v) => ({
      ...v,
      x: clamp(
        v.x + direction * 0.35 * Math.sin(v.yaw) * Math.cos(v.pitch),
        -5,
        5,
      ),
      y: clamp(v.y + direction * 0.35 * Math.sin(v.pitch), -1.4, 4),
      z: clamp(
        v.z + direction * 0.35 * Math.cos(v.yaw) * Math.cos(v.pitch),
        -6,
        6,
      ),
    }));
  }
  const labelPositions: LabelPosition[] = [];
  const markers = world
    .flatMap((p) => {
      const screen = project(p.x, p.y, p.z);
      if (
        !screen ||
        screen.x < 0 ||
        screen.x > width ||
        screen.y < 0 ||
        screen.y > height
      )
        return [];
      return [{ stack: p.stack, ...screen }];
    })
    .sort((a, b) => b.depth - a.depth);

  return (
    <div className="population-scene">
      <div className="population-scene-bar">
        <div
          className="population-camera"
          role="group"
          aria-label="Map view controls"
        >
          <button
            type="button"
            onClick={() => walk(1)}
            aria-label="Move forward"
            title="Move forward (W)"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            onClick={() => walk(-1)}
            aria-label="Move backward"
            title="Move backward (S)"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            onClick={() => setView(home)}
            aria-label="Reset view"
            title="Reset view"
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      <svg
        ref={canvas}
        className="population-canvas"
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="Behavioral similarity plot"
        aria-describedby={id}
        tabIndex={0}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          suppressClick.current = false;
          drag.current = {
            pointer: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const state = drag.current;
          if (!state || state.pointer !== e.pointerId) return;
          const dx = e.clientX - state.x,
            dy = e.clientY - state.y;
          if (!state.moved && Math.hypot(dx, dy) < 4) return;
          if (!state.moved) e.currentTarget.setPointerCapture(e.pointerId);
          suppressClick.current = true;
          drag.current = {
            pointer: state.pointer,
            x: e.clientX,
            y: e.clientY,
            moved: true,
          };
          look(-dx * 0.004, dy * 0.004);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          if (!drag.current?.moved) drag.current = null;
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          switch (e.key.toLowerCase()) {
            case "arrowleft":
              look(-0.08, 0);
              break;
            case "arrowright":
              look(0.08, 0);
              break;
            case "arrowup":
              look(0, 0.08);
              break;
            case "arrowdown":
              look(0, -0.08);
              break;
            case "w":
              walk(1);
              break;
            case "s":
              walk(-1);
              break;
            default:
              return;
          }
          e.preventDefault();
        }}
      >
        {markers.map(({ stack, x, y, depth }) => {
          const first = stack.sessions[0];
          const multi = stack.sessions.length > 1;
          const label = overview
            ? `Explore Group ${stack.id}, ${stack.sessions.length} sessions`
            : multi
              ? `Inspect ${stack.sessions.length} overlapping sessions`
              : `Inspect ${first.operator_id ?? first.id}`;
          const radius = clamp(
            (overview || multi ? 37 : 21) / depth,
            overview || multi ? 10 : 5,
            overview || multi ? 18 : 11,
          );
          const anchor = { x, y, radius };
          const badge = overview
            ? placeLabel(anchor, labelPositions, width, height)
            : anchor;
          if (overview) labelPositions.push(badge);
          const tone =
            !overview && stack.sessions.every((s) => s.tone === first.tone)
              ? first.tone
              : undefined;
          return (
            <g
              key={stack.id}
              role="button"
              tabIndex={0}
              aria-label={label}
              className="population-marker"
              transform={`translate(${badge.x} ${badge.y})`}
              data-tone={tone}
              data-selected={
                !!selected &&
                stack.sessions.some((s) => s.session_id === selected)
              }
              onClick={(e) => {
                if (!suppressClick.current || !e.detail) onActivate(stack);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(stack);
                }
              }}
            >
              <title>
                {overview || multi ? label : `${first.label} · ${first.tone}`}
              </title>
              {(badge.x !== x || badge.y !== y) && (
                <g aria-hidden="true" pointerEvents="none">
                  <line
                    x1={x - badge.x}
                    y1={y - badge.y}
                    x2={0}
                    y2={0}
                    stroke="#92b2ae"
                    strokeWidth={0.8}
                  />
                  <circle
                    cx={x - badge.x}
                    cy={y - badge.y}
                    r={2}
                    fill="#bfdbd4"
                  />
                </g>
              )}
              <circle r={Math.max(radius + 3, 12)} fill="transparent" />
              <circle
                r={radius}
                className={
                  overview || multi
                    ? "population-node population-orb"
                    : "population-orb"
                }
              />
              {(overview || multi) && (
                <text className="population-node-label" dy=".34em">
                  {overview ? stack.id : stack.sessions.length}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {!markers.length && (
        <div className="population-empty">
          {stacks.length
            ? "Look around or reset the view to find the markers."
            : "No grouped positions in this view. Explore the session list."}
        </div>
      )}
      <p className="population-scene-help" id={id}>
        Drag to look around
        <span className="population-key-hint">
          {" "}
          · Arrow keys to look · W / S to move
        </span>
      </p>
    </div>
  );
}
