import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { useEffect, useState } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck, Snowflake } from "lucide-react";
import { Brand } from "../components/Brand";
import { GuardianDeviceAlerts } from "../components/GuardianDeviceAlerts";
import { money } from "../types";

interface Hold {
  session_id: string;
  account_id: string;
  amount_kzt: number;
  reference_code: string;
  status: "held" | "frozen";
  timestamp: string;
  urgent?: boolean;
  acknowledged?: boolean;
}
export function Guardian() {
  const preview =
    new URLSearchParams(location.search).get("mode") === "fixtures";
  const [entry, setEntry] = useState("");
  const [token, setToken] = useState("");
  const [holds, setHolds] = useState<Hold[]>(
    preview
      ? [
          {
            session_id: "sess_fixture_dictation",
            account_id: "acc_student_101",
            reference_code: "DEMO-42B7",
            amount_kzt: 450000,
            urgent: true,
            status: "frozen",
            timestamp: "2026-11-26T14:22:01Z",
          },
          {
            session_id: "sess_guardian_preview",
            account_id: "acc_student_101",
            reference_code: "BCC-DEMO-PREVIEW",
            amount_kzt: 450000,
            status: "held",
            timestamp: "2026-11-26T14:22:01Z",
          },
        ]
      : [],
  );
  const [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [request, setRequest] = useState("");
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const headers = { Authorization: "Bearer " + token };
    const acked = new Set<string>();
    const alerted = new Set<string>();
    let latest: Hold[] = [],
      revision = 0;
    async function observe(items: Hold[]) {
      if (controller.signal.aborted || !Array.isArray(items)) return;
      setAuthenticated(true);
      latest = items;
      setHolds(items);
      setError("");
      if (document.visibilityState !== "visible") return;
      for (const item of items) {
        if (item.acknowledged || acked.has(item.session_id)) continue;
        if (item.urgent && !alerted.has(item.session_id)) {
          alerted.add(item.session_id);
          navigator.vibrate?.([160, 80, 160]);
        }
        acked.add(item.session_id);
        try {
          const res = await fetch(
            "/api/v1/guardian/holds/" +
              encodeURIComponent(item.session_id) +
              "/ack",
            { method: "POST", headers, signal: controller.signal },
          );
          if (!res.ok) acked.delete(item.session_id);
        } catch {
          acked.delete(item.session_id);
        }
      }
    }
    async function poll() {
      const id = ++revision;
      try {
        const res = await fetch("/api/v1/guardian/holds", {
          headers,
          signal: controller.signal,
        });
        if (!res.ok)
          throw Error(
            res.status === 401 || res.status === 403
              ? "Access denied. Check your Guardian token."
              : "Guardian service unavailable.",
          );
        const data = await res.json();
        if (id === revision) void observe(data.holds);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Connection error");
      }
    }
    const socket = new WebSocket(
      (location.protocol === "https:" ? "wss://" : "ws://") +
        location.host +
        "/ws/guardian",
    );
    socket.onopen = () => socket.send(JSON.stringify({ token }));
    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "GUARDIAN_HOLDS") {
          revision++;
          void observe(data.holds);
        }
      } catch {
        /* poll recovers */
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") void observe(latest);
      },
      { signal: controller.signal },
    );
    return () => {
      controller.abort();
      socket.onopen = null;
      socket.onmessage = null;
      socket.close();
      clearInterval(interval);
    };
  }, [token]);
  async function freeze(hold: Hold) {
    if (preview) {
      setHolds((items) =>
        items.map((item) =>
          item.session_id === hold.session_id
            ? { ...item, status: "frozen" }
            : item,
        ),
      );
      return;
    }
    setRequest(hold.session_id);
    try {
      const res = await fetch(
        "/api/v1/guardian/holds/" +
          encodeURIComponent(hold.session_id) +
          "/freeze",
        { method: "POST", headers: { Authorization: "Bearer " + token } },
      );
      if (!res.ok) throw Error();
      setHolds((items) =>
        items.map((item) =>
          item.session_id === hold.session_id
            ? { ...item, status: "frozen" }
            : item,
        ),
      );
      setError("");
    } catch {
      setError("Freeze failed. Check the connection and try again.");
    } finally {
      setRequest("");
    }
  }
  return (
    <main className="guardian-stage">
      <header>
        <a href="/dashboard">
          <Brand />
        </a>
      </header>
      <section className="guardian">
        <div className="guardian-emblem">
          <ShieldCheck size={34} />
        </div>
        <p className="eyebrow">TRUSTED CONTACT</p>
        <h1>Guardian</h1>
        {!token && !preview ? (
          <>
            <p>
              Use your account’s Guardian token to review held demo transfers.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (entry.trim()) {
                  setToken(entry.trim());
                  setEntry("");
                }
              }}
            >
              <Label>
                Guardian token
                <Input
                  autoComplete="off"
                  required
                  type="password"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                />
              </Label>
              <Button className="primary">
                Open Guardian <ArrowRight size={17} />
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="guardian-status">
              <LockKeyhole size={16} />{" "}
              {preview ? "Synthetic Guardian preview" : "Account-scoped access"}{" "}
              <Button
                onClick={() => {
                  if (preview) {
                    setHolds((items) =>
                      items.map((item) =>
                        item.urgent ? item : { ...item, status: "held" },
                      ),
                    );
                    return;
                  }
                  setHolds([]);
                  setAuthenticated(false);
                  setToken("");
                  setError("");
                }}
              >
                {preview ? "Reset preview" : "Sign out"}
              </Button>
            </div>
            {authenticated && !error && (
              <GuardianDeviceAlerts key={token} token={token} />
            )}
            {!error && !holds.length && <p>Waiting for held transfers.</p>}
            {holds.map((h) => (
              <article key={h.session_id}>
                {h.urgent && (
                  <div className="guardian-urgent" role="alert">
                    <strong>Urgent · Call the account owner</strong>
                    <p>
                      Possible coercion during this transfer. Call the owner
                      using a number you already know.
                    </p>
                  </div>
                )}
                <span>{h.account_id}</span>
                <h2>{money(h.amount_kzt)} ₸</h2>
                <p>
                  {h.reference_code} ·{" "}
                  {new Date(h.timestamp).toLocaleTimeString()}
                </p>
                {h.urgent ? (
                  <p>
                    <Snowflake size={15} aria-hidden="true" /> Transfer
                    automatically frozen
                  </p>
                ) : (
                  <Button
                    disabled={!!request || h.status === "frozen"}
                    onClick={() => void freeze(h)}
                  >
                    <Snowflake size={16} />
                    {h.status === "frozen"
                      ? "Frozen"
                      : "Freeze simulated transfer"}
                  </Button>
                )}
              </article>
            ))}
          </>
        )}
        {error && (
          <p className="phone-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
