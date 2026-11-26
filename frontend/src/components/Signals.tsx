import { useState, useEffect } from "react";
import { Activity } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Card } from "./ui/card";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  TableHeader,
} from "./ui/table";
import type { DashboardEvent } from "../types";
import examples from "../window-fixtures.json";

const channels = {
  key_dwell: "Key dwell",
  contact_dwell: "Contact dwell",
  pressure: "Pressure",
  motion: "Acceleration",
  travel: "Slide speed",
  key_interval: "Key interval",
};
type Sample = { start_ms: number; end_ms: number } & Record<
  string,
  number | null
>;
export function Signals({
  events,
  preview,
}: {
  events: DashboardEvent[];
  preview: boolean;
}) {
  const [selected, select] = useState("");
  const session =
    events.find((e) => e.session_id === selected)?.session_id ||
    events[0]?.session_id;
  const [samples, setSamples] = useState<Sample[] | null>();
  const [error, setError] = useState(false);
  useEffect(() => {
    setError(false);
    setSamples(undefined);
    if (!session) return;
    if (preview) {
      setSamples((examples as Record<string, Sample[]>)[session] || null);
      return;
    }
    const controller = new AbortController();
    fetch("/api/v1/sessions/" + encodeURIComponent(session) + "/windows", {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((r) => setSamples(r.windows))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [session, preview]);
  return (
    <Card className="panel trace-panel">
      <header className="panel-head">
        <div>
          <h2>Session timeline</h2>
          <p>2 s windows · 1 s stride · normalized to 0–1</p>
        </div>
        <Activity />
      </header>
      <NativeSelect
        aria-label="Signal session"
        value={session || ""}
        onChange={(e) => select(e.target.value)}
      >
        {events.map((e) => (
          <NativeSelectOption key={e.session_id} value={e.session_id}>
            {e.account_id} · {e.session_id}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {samples?.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time (s)</TableHead>
              {Object.entries(channels).map(([k, v]) => (
                <TableHead key={k}>{v}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {samples.map((row) => (
              <TableRow key={row.start_ms}>
                <TableCell>
                  {row.start_ms / 1000}–{(row.end_ms / 1000).toFixed(2)}
                </TableCell>
                {Object.keys(channels).map((k) => (
                  <TableCell
                    key={k}
                    title={row[k] == null ? "Unavailable" : undefined}
                  >
                    {row[k]?.toFixed(3) ?? "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="empty-row">
          {error
            ? "Unable to retrieve signal windows."
            : !session
              ? "Waiting for a scored transfer."
              : samples === undefined
                ? "Loading windows…"
                : "No stored windows for this transfer."}
        </p>
      )}
    </Card>
  );
}

export function ActivityChart({ events }: { events: DashboardEvent[] }) {
  if (!events.length) return null;
  const times = events.map((e) => Date.parse(e.timestamp));
  const final = Math.max(...times);
  if (final === Math.min(...times)) {
    const outcomes = [
      ["SUCCESS", "Approved"],
      ["STEP_UP_LIVENESS", "Step-up"],
      ["MIRAGE_HOLD", "Mirage hold"],
    ] as const;
    return (
      <Card className="activity-chart">
        <header>
          <h2>Decision breakdown</h2>
          <span>{events.length} recent sessions</span>
        </header>
        <div className="decision-strip">
          {outcomes.map(([key, label]) => {
            const count = events.filter((e) => e.decision === key).length;
            return (
              count > 0 && (
                <i
                  key={key}
                  className={key}
                  style={{ flex: count }}
                  title={label + " · " + count}
                />
              )
            );
          })}
        </div>
        <footer>
          {outcomes.map(([key, label]) => (
            <span key={key}>
              {label} · {events.filter((e) => e.decision === key).length}
            </span>
          ))}
        </footer>
      </Card>
    );
  }
  const span = Math.max(1000, Math.ceil((final - Math.min(...times) + 1) / 32));
  const start = final + 1 - span * 32;
  const buckets = Array.from({ length: 32 }, () => ({
    SUCCESS: 0,
    MIRAGE_HOLD: 0,
    STEP_UP_LIVENESS: 0,
  }));
  events.forEach((e, i) => {
    buckets[Math.floor((times[i] - start) / span)][e.decision]++;
  });
  const peak = Math.max(
    ...buckets.map((b) => b.SUCCESS + b.MIRAGE_HOLD + b.STEP_UP_LIVENESS),
  );
  const format = (ms: number) => new Date(ms).toLocaleTimeString("en-GB");
  return (
    <Card className="activity-chart">
      <header>
        <h2>Transfer activity</h2>
        <span>{events.length} recent sessions</span>
      </header>
      <div
        className="bars"
        role="img"
        aria-label={
          events.length +
          " scored transfers from " +
          format(start) +
          " to " +
          format(final)
        }
      >
        {buckets.map((b, i) => (
          <div
            key={i}
            title={
              format(start + i * span) +
              " · " +
              (b.SUCCESS + b.MIRAGE_HOLD + b.STEP_UP_LIVENESS) +
              " transfers"
            }
          >
            {(["SUCCESS", "STEP_UP_LIVENESS", "MIRAGE_HOLD"] as const).map(
              (k) => (
                <i
                  key={k}
                  className={k}
                  style={{ height: (b[k] / peak) * 100 + "%" }}
                />
              ),
            )}
          </div>
        ))}
      </div>
      <footer>
        <span>{format(start)}</span>
        <span className="chart-key">
          <i />
          Approved <i />
          Step-up <i />
          Mirage hold
        </span>
        <span>{format(final)}</span>
      </footer>
    </Card>
  );
}
