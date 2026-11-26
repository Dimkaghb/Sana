import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Ban,
  CircleDot,
  Coins,
  Fingerprint,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  Monitor,
  Network,
  Radio,
  ShieldCheck,
  Smartphone,
  Timer,
  X,
  Zap,
} from "lucide-react";
import { Brand } from "../components/Brand";
import {
  PopulationMap,
  Waveform,
  type SelectedDot,
} from "../components/PopulationMap";
import { fixtureData, fixtureIdentities } from "../demo";
import {
  decisionLabel,
  money,
  type DashboardData,
  type DashboardEvent,
} from "../types";

function useFeed(preview: boolean) {
  const [data, setData] = useState<DashboardData>();
  const [status, setStatus] = useState("Connecting");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((v) => v + 1), []);
  useEffect(() => {
    if (preview) {
      setStatus("Fixture preview");
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>,
      reconcile: ReturnType<typeof setTimeout>,
      socket: WebSocket | undefined,
      generation = 0;
    async function load() {
      const id = ++generation;
      try {
        const response = await fetch("/api/v1/dashboard/init", {
          signal: controller.signal,
        });
        if (!response.ok) throw Error();
        const next: DashboardData = await response.json();
        if (!Array.isArray(next.events) || !next.kpis) throw Error();
        if (id === generation && !controller.signal.aborted) setData(next);
      } catch {
        if (!controller.signal.aborted) setStatus("Service unavailable");
      }
    }
    function connect(attempt = 0) {
      if (controller.signal.aborted) return;
      socket = new WebSocket(
        (location.protocol === "https:" ? "wss://" : "ws://") +
          location.host +
          "/ws/dashboard",
      );
      socket.onopen = () => {
        setStatus("Connected");
        attempt = 0;
        void load();
      };
      socket.onmessage = ({ data: raw }) => {
        try {
          const update = JSON.parse(raw);
          if (update.type === "SESSION_SCORED") {
            ++generation;
            setData(
              (previous) =>
                previous && {
                  ...previous,
                  events: [
                    update,
                    ...previous.events.filter(
                      (e) => e.session_id !== update.session_id,
                    ),
                  ].slice(0, 100),
                },
            );
          }
          clearTimeout(reconcile);
          reconcile = setTimeout(() => void load(), 100);
        } catch {
          setStatus("Invalid update");
        }
      };
      socket.onclose = () => {
        if (!controller.signal.aborted) {
          setStatus("Reconnecting");
          timer = setTimeout(
            () => connect(attempt + 1),
            Math.min(12000, 800 * 2 ** attempt),
          );
        }
      };
    }
    void load();
    connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(reconcile);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [preview, refreshKey]);
  return { data: preview ? fixtureData : data, status, refresh };
}
const time = (s: string) =>
  new Date(s).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export function Dashboard() {
  const [preview, setPreview] = useState(
    new URLSearchParams(location.search).get("mode") === "fixtures",
  );
  const { data, status, refresh } = useFeed(preview);
  const [selected, setSelected] = useState<string>();
  const [dot, setDot] = useState<SelectedDot>();
  const [token, setToken] = useState("");
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState("");
  const [ownerVerified, setOwnerVerified] = useState(false);
  const [working, setWorking] = useState(false);
  const [dossier, setDossier] = useState<Record<string, unknown>>();
  const [range, setRange] = useState("all");
  const [credentials, setCredentials] = useState(false);
  const events = data?.events || [],
    current = events.find((e) => e.session_id === selected) || events[0];
  const active = data?.active_sessions || [];
  const liveTarget = active.includes(target) ? target : active[0];
  const selectedEvent = events.find((e) => e.session_id === dot?.session_id);
  const canEnroll =
    !preview &&
    data?.ml_mode === "live" &&
    dot?.status !== "BANNED" &&
    !dot?.synthetic &&
    selectedEvent?.map_point &&
    selectedEvent.decision !== "MIRAGE_HOLD" &&
    [
      selectedEvent.scores.anti_rat_physics_risk,
      selectedEvent.scores.coercion_stress_risk,
      selectedEvent.overall_risk_score,
    ].every((s) => s != null && s < 50) &&
    selectedEvent.flags.every((f) => f.code === "IDENTITY_UNAVAILABLE");
  const fixtureIdentity =
    preview && selectedEvent
      ? fixtureIdentities[selectedEvent.session_id]
      : undefined;
  const linked =
    fixtureIdentity?.linked_account_ids ||
    (Array.isArray(dossier?.linked_account_ids)
      ? dossier.linked_account_ids.filter(
          (id): id is string => typeof id === "string",
        )
      : undefined);
  const visibleAccounts = dot?.operator_id
    ? Array.from(
        new Set([
          ...events
            .filter((e) => e.map_point?.operator_id === dot.operator_id)
            .map((e) => e.account_id),
          ...(data?.population_map?.points || [])
            .filter((p) => p.operator_id === dot.operator_id)
            .map((p) => p.account_id)
            .filter((id): id is string => !!id),
        ]),
      )
    : [];
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dot || credentials) dialog.current?.showModal();
    else dialog.current?.close();
  }, [dot, credentials]);
  function close() {
    setCredentials(false);
    setDot(undefined);
    setDossier(undefined);
    setOwnerVerified(false);
  }
  async function action(endpoint: string, body?: unknown, download = false) {
    if (!token) {
      setNotice("Enter an analyst access token to continue.");
      setCredentials(true);
      return;
    }
    setWorking(true);
    setNotice("");
    try {
      const res = await fetch(endpoint, {
        method: download ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + token,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok)
        throw Error(
          res.status === 401 || res.status === 403
            ? "Access denied. Check the analyst token."
            : "Service returned " + res.status,
        );
      if (download) {
        setDossier(await res.json());
        setNotice("");
      } else {
        if (endpoint.endsWith("/enroll")) {
          const result = await res.json();
          setOwnerVerified(false);
          setNotice(
            "Owner enrollment confirmed. Baseline sessions for future scoring: " +
              result.baseline_sessions_count +
              ".",
          );
        } else setNotice("Command accepted.");
        refresh();
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setWorking(false);
    }
  }
  function inspect(e: DashboardEvent) {
    setSelected(e.session_id);
    const projection = data?.population_map?.points.find(
      (p) => p.session_id === e.session_id,
    );
    setDot({
      operator_id: e.map_point?.operator_id,
      synthetic: projection?.synthetic,
      status:
        projection?.status === "BANNED"
          ? "BANNED"
          : e.map_point?.status || e.decision,
      session_id: e.session_id,
      account_id: e.account_id,
    });
  }
  const metrics = [
    {
      icon: Activity,
      label: "Monitored sessions",
      value: data?.kpis.sessions,
      unit: "",
      sub: "Scored transfers",
      color: "mint",
    },
    {
      icon: Coins,
      label: "Held transfer value",
      value: preview ? undefined : data?.kpis.held_amount_kzt,
      unit: "₸",
      sub: "Simulated reservations",
      color: "sand",
    },
    {
      icon: Network,
      label: "Dropper rings",
      value: data?.kpis.ring_count,
      unit: "",
      sub: "Linked operators",
      color: "violet",
    },
    {
      icon: Timer,
      label: "Mean inference",
      value: data?.kpis.average_inference_ms,
      unit: "ms",
      sub: "ML service latency",
      color: "blue",
    },
  ];
  return (
    <div className="console">
      <header className="topbar">
        <a href="/dashboard">
          <Brand />
        </a>
        <div className="env">
          <i />
          {preview ? "Fixture preview" : status}
        </div>
        <div className="toplinks">
          <a href="/mobile">
            <Smartphone size={16} /> Mobile
          </a>
          <a href="/guardian">
            <ShieldCheck size={16} /> Guardian
          </a>
          <button
            onClick={() => {
              setCredentials(true);
              setNotice("");
            }}
          >
            <LockKeyhole size={16} />
            <span>Analyst access</span>
          </button>
        </div>
      </header>
      <main className="desk">
        <div className="overview">
          <div>
            <p className="eyebrow">
              <LayoutDashboard size={13} /> BCC ANTI-FRAUD OPERATIONS
            </p>
            <h1>
              Command center<span>.</span>
            </h1>
          </div>
          <label className="source">
            <Layers3 size={15} />
            <select
              aria-label="Data source"
              value={preview ? "fixtures" : "live"}
              onChange={(e) => {
                setPreview(e.target.value === "fixtures");
                setSelected(undefined);
                setNotice("");
              }}
            >
              <option value="live">Service feed</option>
              <option value="fixtures">Fixture preview</option>
            </select>
          </label>
        </div>
        <div className="metrics">
          {metrics.map(({ icon: Icon, label, value, unit, sub, color }) => (
            <div className="metric" key={label}>
              <div>
                <span>{label}</span>
                <i className={color}>
                  <Icon size={17} />
                </i>
              </div>
              <strong>
                {value == null ? "—" : money(value)} <small>{unit}</small>
              </strong>
              <footer>{sub}</footer>
            </div>
          ))}
        </div>
        <div className="analysis-grid">
          <PopulationMap
            data={data}
            selected={selected}
            onSelect={(d) => {
              setDot(d);
              setSelected(d.session_id);
            }}
          />
          <section className="panel signal">
            <header className="panel-head">
              <div>
                <p className="eyebrow">SESSION TELEMETRY</p>
                <h2>Signal inspection</h2>
              </div>
              <Activity size={20} />
            </header>
            <div className="signal-body">
              <div className="score-head">
                <span>Risk score</span>
                <strong>
                  {current?.overall_risk_score ?? "—"}
                  <small>/100</small>
                </strong>
              </div>
              {(
                [
                  ["anti_rat_physics_risk", "Touch physics"],
                  ["coercion_stress_risk", "Coercion signals"],
                  ["operator_mismatch_risk", "Operator mismatch"],
                ] as const
              ).map(([key, label]) => {
                const score = current?.scores[key];
                return (
                  <div className="bar" key={key}>
                    <div>
                      <span>{label}</span>
                      <b>{score ?? "Unavailable"}</b>
                    </div>
                    <i>
                      <b
                        style={{
                          width: (score ?? 0) + "%",
                          background:
                            score != null && score >= 75
                              ? "#f48c76"
                              : score != null && score >= 50
                                ? "#f0ba71"
                                : undefined,
                        }}
                      />
                    </i>
                  </div>
                );
              })}
              <Waveform event={current} />
            </div>
          </section>
        </div>
        <section className="panel ledger">
          <header className="panel-head">
            <div>
              <p className="eyebrow">DECISION HISTORY</p>
              <h2>Session ledger</h2>
            </div>
            <select
              aria-label="Filter decisions"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              <option value="all">All decisions</option>
              {Object.entries(decisionLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </header>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time · local</th>
                  <th>Account</th>
                  <th>Operator</th>
                  <th>Risk</th>
                  <th>Decision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events
                  .filter((e) => range === "all" || e.decision === range)
                  .map((e) => (
                    <tr key={e.session_id}>
                      <td>{time(e.timestamp)}</td>
                      <td>{e.account_label}</td>
                      <td className="mono">
                        {e.map_point?.operator_id || "Unavailable"}
                      </td>
                      <td>{e.overall_risk_score ?? "—"}</td>
                      <td>
                        <span className={"badge " + e.decision}>
                          {decisionLabel[e.decision]}
                        </span>
                      </td>
                      <td>
                        <button
                          aria-label={"Inspect " + e.session_id}
                          onClick={() => inspect(e)}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!events.filter((e) => range === "all" || e.decision === range)
            .length && (
            <div className="empty-row">
              <CircleDot size={17} /> No matching sessions
            </div>
          )}
        </section>
        {events.some((e) => e.flags.some((f) => f.severity !== "INFO")) && (
          <section className="panel alerts">
            <header className="panel-head">
              <div>
                <p className="eyebrow">FLAGGED EVIDENCE</p>
                <h2>Recent alerts</h2>
              </div>
              <Radio size={19} />
            </header>
            <div>
              {events
                .flatMap((e) =>
                  e.flags
                    .filter((f) => f.severity !== "INFO")
                    .map((f) => (
                      <button
                        key={e.session_id + f.code}
                        onClick={() => inspect(e)}
                      >
                        <span className="alert-mark" />
                        <span>
                          <strong>{f.title}</strong>
                          <small>
                            {e.account_label} · {time(e.timestamp)}
                          </small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    )),
                )
                .slice(0, 6)}
            </div>
          </section>
        )}
        <section className="toolbar">
          <span>
            <Monitor size={17} /> Demo controls
          </span>
          <a href={preview ? "/guardian?mode=fixtures" : "/guardian"}>
            {preview ? "Preview Guardian" : "Open Guardian"}
          </a>
          {preview && (
            <button
              onClick={() => {
                setRange("all");
                setSelected(undefined);
                close();
                setNotice("Fixture preview reset.");
              }}
            >
              Reset preview
            </button>
          )}
          <select
            aria-label="Active mobile session"
            value={liveTarget || ""}
            onChange={(e) => setTarget(e.target.value)}
          >
            {!active.length && (
              <option value="">No mobile session connected</option>
            )}
            {active.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            disabled={preview || working || !liveTarget}
            onClick={() =>
              void action("/api/v1/demo/inject-rat-click", {
                session_id: liveTarget,
              })
            }
          >
            <Zap size={15} /> Simulate remote click
          </button>
        </section>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <footer className="console-foot">
          <span>
            <ShieldCheck size={14} /> SANA Shield
          </span>
          <span>
            {preview
              ? "Synthetic fixture data"
              : data
                ? "Identity service · " + data.ml_mode
                : "Waiting for service"}
          </span>
        </footer>
      </main>
      <dialog ref={dialog} onCancel={close} onClose={close}>
        <button className="dialog-close" onClick={close} aria-label="Close">
          <X size={20} />
        </button>
        {credentials ? (
          <>
            <LockKeyhole className="dialog-symbol" />
            <h2>Analyst access</h2>
            <p>Enter the demo operator token for this tab.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                close();
                setNotice("Analyst token saved for this tab.");
              }}
            >
              <input
                type="password"
                autoComplete="off"
                aria-label="Analyst token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="primary">
                Continue <ArrowRight size={16} />
              </button>
            </form>
          </>
        ) : (
          dot && (
            <>
              <Fingerprint className="dialog-symbol" />
              <p className="eyebrow">OPERATOR DOSSIER</p>
              <h2>{dot.operator_id || "Session evidence"}</h2>
              <p className="mono">{dot.account_id}</p>
              {dot.synthetic && <p>Synthetic seed session</p>}
              {(dot.status === "BANNED" || dot.status === "UNVERIFIED") && (
                <p>Operator status · {dot.status.toLowerCase()}</p>
              )}
              {dot.operator_id && (
                <div className="flag">
                  <b>{linked ? "Linked accounts" : "Accounts in view"}</b>
                  <p>
                    {(linked || visibleAccounts).join(" · ") || "Unavailable"}
                  </p>
                  {fixtureIdentity?.match_confidence != null && (
                    <p>
                      Fixture match confidence ·{" "}
                      {Math.round(fixtureIdentity.match_confidence * 100)}%
                    </p>
                  )}
                </div>
              )}
              {selectedEvent?.flags.map((f) => (
                <div className="flag" key={f.code}>
                  <b>{f.title}</b>
                  <p>{f.detail}</p>
                </div>
              ))}
              {!selectedEvent?.flags.length && (
                <p>No session flags available.</p>
              )}
              <div className="dialog-actions">
                <button
                  disabled={preview || working || !dot.operator_id}
                  onClick={() =>
                    void action(
                      "/api/v1/operators/" +
                        encodeURIComponent(dot.operator_id!) +
                        "/ban",
                    )
                  }
                >
                  <Ban size={16} /> Ban operator
                </button>
                <button
                  disabled={preview || working || !selectedEvent}
                  onClick={() =>
                    void action(
                      "/api/v1/cases/" +
                        encodeURIComponent(selectedEvent!.session_id) +
                        "/export-antifraud",
                      undefined,
                      true,
                    )
                  }
                >
                  <ArrowDownToLine size={16} /> Preview dossier
                </button>
              </div>
              {canEnroll && (
                <div className="enrollment">
                  <label>
                    <input
                      type="checkbox"
                      checked={ownerVerified}
                      onChange={(e) => setOwnerVerified(e.target.checked)}
                    />{" "}
                    I independently verified this account owner for this
                    session.
                  </label>
                  <button
                    className="primary"
                    disabled={working || !ownerVerified}
                    onClick={() =>
                      void action(
                        "/api/v1/sessions/" +
                          encodeURIComponent(selectedEvent!.session_id) +
                          "/enroll",
                        { owner_verified: true },
                      )
                    }
                  >
                    Enroll verified session
                  </button>
                </div>
              )}
              {dossier && (
                <details open className="export-preview">
                  <summary>Case export preview</summary>
                  <pre>{JSON.stringify(dossier, null, 2)}</pre>
                  <button
                    className="primary"
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(dossier, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download =
                        "sana-case-" + (dossier.case_id || "demo") + ".json";
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    Download JSON <ArrowDownToLine size={16} />
                  </button>
                </details>
              )}
              {notice && <p role="status">{notice}</p>}
            </>
          )
        )}
      </dialog>
    </div>
  );
}
