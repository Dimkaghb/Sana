import { useEffect, useState } from "react";
import { ArrowRight, Fingerprint } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import type { DashboardEvent } from "../types";

type Account = { account_id: string; transfers: number; operators: number };
type Page = { accounts: Account[]; next: string | null };
export function AccountDirectory({
  events,
  preview,
}: {
  events: DashboardEvent[];
  preview: boolean;
}) {
  const [prefix, setPrefix] = useState("");
  const [cursors, setCursors] = useState([""]);
  const [page, setPage] = useState<Page>();
  const [failed, setFailed] = useState(false);
  const after = cursors.at(-1)!;
  useEffect(() => {
    setFailed(false);
    setPage(undefined);
    if (preview) {
      const ids = Array.from(new Set(events.map((e) => e.account_id)))
        .sort()
        .filter((id) => id.startsWith(prefix));
      setPage({
        accounts: ids.map((account_id) => {
          const rows = events.filter((e) => e.account_id === account_id);
          return {
            account_id,
            transfers: rows.length,
            operators: new Set(
              rows.map((e) => e.map_point?.operator_id).filter(Boolean),
            ).size,
          };
        }),
        next: null,
      });
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ prefix, after });
    fetch("/api/v1/dashboard/accounts?" + params, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setPage)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [events, preview, prefix, after]);
  return (
    <Card className="panel account-list">
      <header className="panel-head">
        <h2>Scored accounts</h2>
        <Input
          aria-label="Search account aliases"
          placeholder="Search alias"
          value={prefix}
          onChange={(e) => {
            setPrefix(e.target.value);
            setCursors([""]);
          }}
        />
      </header>
      {page?.accounts.map((row) => {
        const q = new URLSearchParams(location.search);
        q.set("account", row.account_id);
        return (
          <Button asChild variant="ghost" key={row.account_id}>
            <a href={"/dashboard?" + q}>
              <Fingerprint />
              <span>
                <strong>{row.account_id}</strong>
                <small>
                  {row.transfers} transfers · {row.operators} matched operators
                </small>
              </span>
              <ArrowRight />
            </a>
          </Button>
        );
      })}
      {!page?.accounts.length && (
        <p className="empty-row">
          {failed
            ? "Unable to load accounts."
            : page
              ? "No matching accounts."
              : "Loading accounts…"}
        </p>
      )}
      {(cursors.length > 1 || page?.next) && (
        <footer>
          <Button
            variant="outline"
            disabled={cursors.length === 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={!page?.next}
            onClick={() => page?.next && setCursors((c) => [...c, page.next!])}
          >
            Next
          </Button>
        </footer>
      )}
    </Card>
  );
}
