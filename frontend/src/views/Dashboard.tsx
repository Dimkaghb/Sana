import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  NativeSelect,
  NativeSelectOption,
} from "../components/ui/native-select";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  UsersRound,
  ChevronRight,
  LogOut,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Ban,
  CircleDot,
  Coins,
  Fingerprint,
  Layers3,
  ListFilter,
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
import { DecisionExplanation } from "../components/DecisionExplanation";
import { FraudRings } from "../components/FraudRings";
import { AccountDirectory } from "../components/AccountDirectory";
import { ActivityChart, Signals } from "../components/Signals";
import { Theme } from "../components/Theme";
import { signOut } from "../components/WorkspaceAccess";
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

function useFeed(
  preview: boolean,
  map: boolean,
  account: string,
  cursor: string,
) {
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
        const params = new URLSearchParams({ include_map: String(map) });
        if (map) params.set("map_page", cursor);
        if (account) params.set("account", account);
        const response = await fetch("/api/v1/dashboard/init?" + params, {
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
          if (
            update.type === "SESSION_SCORED" &&
            (!account || update.account_id === account)
          ) {
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
    setData(undefined);
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
  }, [preview, refreshKey, map, account, cursor]);
  return { data: preview ? fixtureData : data, status, refresh };
}
const time = (s: string) =>
  new Date(s).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export function Dashboard({ alias }: { alias?: string }) {
  const preview =
    new URLSearchParams(location.search).get("mode") === "fixtures";
  const views = [
    ["queue", "Transfer review", ListFilter],
    ["map", "Population map", Network],
    ["signals", "Signal windows", Activity],
    ["accounts", "Accounts", UsersRound],
  ] as const;
  const view =
    views.find(([path]) => path === location.pathname.split("/")[2])?.[0] ||
    "queue";
  const [accountFilter, setAccountFilter] = useState(
    new URLSearchParams(location.search).get("account") || "",
  );

  const [pages, setPages] = useState(["first"]);
  const { data, status, refresh } = useFeed(
    preview,
    view === "map",
    accountFilter,
    pages.at(-1)!,
  );
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

  const events = data?.events || [];
  const priority = {
    STEALTH_HOLD: -1,
    MIRAGE_HOLD: 0,
    STEP_UP_LIVENESS: 1,
    SUCCESS: 2,
  };
  const visible = events
    .filter(
      (e) =>
        (!accountFilter || e.account_id === accountFilter) &&
        (range === "all" || e.decision === range),
    )
    .sort((a, b) => priority[a.decision] - priority[b.decision]);
  const current = visible.find((e) => e.session_id === selected) || visible[0];
  const active = data?.active_sessions || [];
  const liveTarget = active.includes(target) ? target : active[0];
  const selectedEvent = events.find((e) => e.session_id === dot?.session_id);
  const sessionIdentity =
    selectedEvent && data?.session_identity?.[selectedEvent.session_id];
  const canEnroll =
    !preview &&
    data?.ml_mode === "live" &&
    dot?.status !== "BANNED" &&
    !dot?.synthetic &&
    sessionIdentity?.eligible_for_enrollment;
  const fixtureIdentity =
    preview && selectedEvent
      ? fixtureIdentities[selectedEvent.session_id]
      : undefined;
  const confidence =
    fixtureIdentity?.match_confidence ?? sessionIdentity?.match_confidence;
  const linked =
    fixtureIdentity?.linked_account_ids ||
    sessionIdentity?.linked_account_ids ||
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
  function close() {
    setCredentials(false);
    setDot(undefined);
    setDossier(undefined);
    setOwnerVerified(false);
  }
  async function action(endpoint: string, body?: unknown, download = false) {
    if (!token && !alias) {
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
          ...(token ? { Authorization: "Bearer " + token } : {}),
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
      <aside className="workrail">
        <a className="rail-brand" href={"/dashboard" + location.search}>
          <Brand />
        </a>
        <nav aria-label="Investigation views">
          {views.map(([path, title, Icon]) => (
            <Button
              key={path}
              aria-pressed={view === path}
              onClick={() => {
                const url = new URL(location.href);
                url.pathname =
                  path === "queue" ? "/dashboard" : "/dashboard/" + path;
                url.searchParams.delete("account");
                location.assign(url);
              }}
            >
              <Icon size={17} />
              {title}
            </Button>
          ))}
        </nav>
        <div className="rail-foot">
          <Fingerprint />
          <span>Identity workspace</span>
        </div>
      </aside>
      <header className="topbar">
        <div className="crumb">
          Workspace <ChevronRight size={14} />{" "}
          <b>{views.find((v) => v[0] === view)?.[1]}</b>
        </div>
        <div className="env">
          <i />
          {preview ? "Fixture preview" : status}
        </div>
        <div className="toplinks">
          <Theme />
          <a href={preview ? "/mobile?mode=fixtures" : "/mobile"}>
            <Smartphone size={16} /> Mobile
          </a>
          <a href="/guardian">
            <ShieldCheck size={16} /> Guardian
          </a>
          {alias ? (
            <Button
              onClick={() =>
                signOut("analyst").catch(() =>
                  setNotice("Sign-out failed. Try again."),
                )
              }
            >
              <LogOut size={16} />
              {alias}
            </Button>
          ) : (
            <Button
              onClick={() => {
                setCredentials(true);
                setNotice("");
              }}
            >
              <LockKeyhole size={16} />
              <span>Analyst access</span>
            </Button>
          )}
        </div>
      </header>
      <main className="desk">
        <div className="overview">
          <div>
            <h1>
              {view === "queue"
                ? "Transfer operations"
                : view === "map"
                  ? "Population map"
                  : view === "signals"
                    ? "Signal windows"
                    : "Account directory"}
            </h1>
          </div>
          <Label className="source">
            <Layers3 size={15} />
            <NativeSelect
              aria-label="Data source"
              value={preview ? "fixtures" : "live"}
              onChange={(e) => {
                const url = new URL(location.href);
                if (e.target.value === "fixtures")
                  url.searchParams.set("mode", "fixtures");
                else url.searchParams.delete("mode");
                location.assign(url);
              }}
            >
              <NativeSelectOption value="live">Service feed</NativeSelectOption>
              <NativeSelectOption value="fixtures">
                Fixture preview
              </NativeSelectOption>
            </NativeSelect>
          </Label>
        </div>
        {view === "queue" && (
          <div className="metrics">
            {metrics.map(({ icon: Icon, label, value, unit, sub, color }) => (
              <Card className="metric" key={label}>
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
              </Card>
            ))}
          </div>
        )}
        {view === "queue" && <ActivityChart events={events} />}
        {view === "queue" && !!data?.rings?.length && (
          <FraudRings
            rings={data.rings}
            preview={preview}
            token={token}
            refresh={refresh}
          />
        )}
        {view === "map" ? (
          <>
            <PopulationMap
              key={pages.at(-1)}
              preview={preview}
              unavailable={status === "Service unavailable"}
              data={data}
              selected={selected}
              onSelect={(d) => {
                setDot(d);
                setSelected(d.session_id);
              }}
            />
            {data &&
              !preview &&
              data.ml_mode === "live" &&
              !data.population_map && (
                <p role="status">
                  Population service unavailable. Showing recent scored
                  transfers.
                </p>
              )}
            {(pages.length > 1 || data?.population_map?.next) && (
              <div className="page-buttons">
                <Button
                  disabled={pages.length === 1}
                  onClick={() => setPages((p) => p.slice(0, -1))}
                >
                  Previous points
                </Button>
                <span>Page {pages.length}</span>
                <Button
                  disabled={!data?.population_map?.next}
                  onClick={() =>
                    setPages((p) => [...p, data!.population_map!.next!])
                  }
                >
                  Next points
                </Button>
              </div>
            )}
            {!!data?.rings?.length && (
              <FraudRings
                rings={data.rings}
                preview={preview}
                token={token}
                refresh={refresh}
              />
            )}
          </>
        ) : view === "signals" ? (
          <Signals events={events} preview={preview} />
        ) : view === "accounts" ? (
          <AccountDirectory events={events} preview={preview} />
        ) : (
          <div className="analysis-grid review-grid">
            {" "}
            <section className="panel ledger">
              <header className="panel-head">
                <div>
                  <h2>Transfer queue</h2>
                  {accountFilter && (
                    <Button
                      onClick={() => {
                        setAccountFilter("");
                        const url = new URL(location.href);
                        url.searchParams.delete("account");
                        history.replaceState(null, "", url);
                      }}
                    >
                      {accountFilter} ×
                    </Button>
                  )}
                </div>
                <NativeSelect
                  aria-label="Filter decisions"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                >
                  <NativeSelectOption value="all">
                    All decisions
                  </NativeSelectOption>
                  {Object.entries(decisionLabel).map(([k, v]) => (
                    <NativeSelectOption key={k} value={k}>
                      {v}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </header>
              <div className="table-scroll">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time · local</TableHead>
                      <TableHead>Account</TableHead>

                      <TableHead>Risk</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((e) => (
                      <TableRow
                        key={e.session_id}
                        className={
                          current?.session_id === e.session_id ? "chosen" : ""
                        }
                      >
                        <TableCell>{time(e.timestamp)}</TableCell>
                        <TableCell>
                          <Button
                            className="case-select"
                            aria-pressed={current?.session_id === e.session_id}
                            onClick={() => setSelected(e.session_id)}
                          >
                            {e.account_label}
                            <small>
                              {e.decision_explanation?.reasons[0]?.title ||
                                e.flags.find((f) => f.severity !== "INFO")
                                  ?.title ||
                                e.session_id}
                            </small>
                          </Button>
                        </TableCell>

                        <TableCell>{e.overall_risk_score ?? "—"}</TableCell>
                        <TableCell>
                          <Badge className={"badge " + e.decision}>
                            {decisionLabel[e.decision]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            aria-label={"Inspect " + e.session_id}
                            onClick={() => inspect(e)}
                          >
                            <ArrowUpRight size={16} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {!visible.length && (
                <div className="empty-row">
                  <CircleDot size={17} /> No matching sessions
                </div>
              )}
            </section>
            <section className="panel signal">
              <header className="panel-head">
                <div>
                  <h2>Transfer evidence</h2>
                  <p className="case-name">
                    {current?.account_label || "No transfer selected"}
                  </p>
                </div>
                <Activity size={20} />
              </header>
              <div className="signal-body">
                {current && (
                  <DecisionExplanation event={current} preview={preview} />
                )}
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
                                ? "var(--critical)"
                                : score != null && score >= 50
                                  ? "var(--warning)"
                                  : undefined,
                          }}
                        />
                      </i>
                    </div>
                  );
                })}
                <Waveform event={current} />
                {current && (
                  <>
                    <div className="evidence-operator">
                      <span>Matched operator</span>
                      <code>
                        {current.map_point?.operator_id || "Unavailable"}
                      </code>
                    </div>
                    <Button
                      className="dossier-link"
                      onClick={() => inspect(current)}
                    >
                      Open dossier <ArrowUpRight size={15} />
                    </Button>
                  </>
                )}
              </div>
            </section>
          </div>
        )}
        {view === "queue" &&
          events.some((e) => e.flags.some((f) => f.severity !== "INFO")) && (
            <section className="panel alerts">
              <header className="panel-head">
                <div>
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
                        <Button
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
                        </Button>
                      )),
                  )
                  .slice(0, 6)}
              </div>
            </section>
          )}
        {view === "queue" && (
          <section className="toolbar">
            <span>
              <Monitor size={17} /> Demo controls
            </span>
            <a href={preview ? "/guardian?mode=fixtures" : "/guardian"}>
              {preview ? "Preview Guardian" : "Open Guardian"}
            </a>
            {preview && (
              <Button
                onClick={() => {
                  setRange("all");
                  setSelected(undefined);
                  close();
                  setNotice("Fixture preview reset.");
                }}
              >
                Reset preview
              </Button>
            )}
            <NativeSelect
              aria-label="Active mobile session"
              value={liveTarget || ""}
              onChange={(e) => setTarget(e.target.value)}
            >
              {!active.length && (
                <NativeSelectOption value="">
                  No mobile session connected
                </NativeSelectOption>
              )}
              {active.map((s) => (
                <NativeSelectOption key={s}>{s}</NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              disabled={preview || working || !liveTarget}
              onClick={() =>
                void action("/api/v1/demo/inject-rat-click", {
                  session_id: liveTarget,
                })
              }
            >
              <Zap size={15} /> Simulate remote click
            </Button>
          </section>
        )}
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
      <Dialog
        open={!!dot || credentials}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className="dossier-dialog"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <Button className="dialog-close" onClick={close} aria-label="Close">
            <X size={20} />
          </Button>
          {credentials ? (
            <>
              <LockKeyhole className="dialog-symbol" />
              <DialogTitle>Analyst access</DialogTitle>
              <p>Enter the demo operator token for this tab.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  close();
                  setNotice("Analyst token saved for this tab.");
                }}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  aria-label="Analyst token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <Button className="primary">
                  Continue <ArrowRight size={16} />
                </Button>
              </form>
            </>
          ) : (
            dot && (
              <>
                <Fingerprint className="dialog-symbol" />
                <p className="eyebrow">OPERATOR DOSSIER</p>
                <DialogTitle>
                  {dot.operator_id || "Session evidence"}
                </DialogTitle>
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
                    {confidence != null && (
                      <p>
                        {preview || data?.ml_mode === "mock"
                          ? "Fixture match"
                          : "Operator match"}{" "}
                        · {Math.round(confidence * 100)}%
                      </p>
                    )}
                  </div>
                )}
                {selectedEvent && (
                  <DecisionExplanation
                    event={selectedEvent}
                    preview={preview}
                  />
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
                  <Button
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
                  </Button>
                  <Button
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
                  </Button>
                </div>
                {canEnroll && (
                  <div className="enrollment">
                    <Label>
                      <Checkbox
                        checked={ownerVerified}
                        onCheckedChange={(value) =>
                          setOwnerVerified(value === true)
                        }
                      />{" "}
                      I independently verified this account owner for this
                      session.
                    </Label>
                    <Button
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
                    </Button>
                  </div>
                )}
                {dossier && (
                  <Collapsible defaultOpen className="export-preview">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost">Case export preview</Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre>{JSON.stringify(dossier, null, 2)}</pre>
                      <Button
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
                            "sana-case-" +
                            (dossier.case_id || "demo") +
                            ".json";
                          link.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        }}
                      >
                        Download JSON <ArrowDownToLine size={16} />
                      </Button>
                    </CollapsibleContent>
                  </Collapsible>
                )}
                {notice && <p role="status">{notice}</p>}
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
