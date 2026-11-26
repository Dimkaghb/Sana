import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { money } from "../types";

interface Receipt {
  reference_code: string;
  timestamp: string;
  amount: number;
  display_title: string;
}
export function TransferHistory() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Receipt[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    setFailed(false);
    setRows(undefined);
    fetch("/api/v1/mobile/history", { signal: c.signal, cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setRows)
      .catch(() => {
        if (!c.signal.aborted) setFailed(true);
      });
    return () => c.abort();
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="История переводов">
          <History />
        </Button>
      </DialogTrigger>
      <DialogContent className="dossier-dialog" aria-describedby={undefined}>
        <DialogTitle>История переводов</DialogTitle>
        {rows?.map((r) => (
          <article className="history-item" key={r.reference_code}>
            <strong>{money(r.amount)} ₸</strong>
            <span>{r.display_title}</span>
            <small>
              {new Date(r.timestamp).toLocaleString("ru-KZ")} ·{" "}
              {r.reference_code}
            </small>
          </article>
        ))}
        {!rows?.length && (
          <p>
            {failed
              ? "Не удалось загрузить историю."
              : rows
                ? "Переводов пока нет."
                : "Загрузка…"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
