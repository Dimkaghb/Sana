import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  LockKeyhole,
  Fingerprint,
  PanelsTopLeft,
} from "lucide-react";
import { Brand } from "./Brand";
import { Theme } from "./Theme";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function WorkspaceAccess({
  role,
  children,
}: {
  role: "mobile" | "analyst";
  children: (alias?: string) => ReactNode;
}) {
  const preview =
    new URLSearchParams(location.search).get("mode") === "fixtures";
  const mobile = role === "mobile";
  const [session, setSession] = useState<{
    alias?: string;
    fixture_access?: boolean;
  }>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const path = "/api/v1/auth/" + role;
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    function refresh() {
      fetch(path + "/me", { signal: controller.signal, cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw Error();
          return r.json();
        })
        .then(setSession)
        .catch(() => {
          if (!controller.signal.aborted) {
            setSession((previous) => previous ?? {});
            setError(
              mobile
                ? "Сервис входа недоступен."
                : "Sign-in service unavailable.",
            );
          }
        });
    }
    refresh();
    window.addEventListener("focus", refresh, { signal: controller.signal });
    const interval = setInterval(refresh, 60000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [path, preview, mobile]);
  if (preview || session?.alias || session?.fixture_access)
    return children(session?.alias);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setWorking(true);
    setError("");
    try {
      const res = await fetch(path + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      if (!res.ok)
        throw Error(
          res.status === 401
            ? mobile
              ? "Проверьте логин и пароль."
              : "Check your alias and password."
            : mobile
              ? "Не удалось войти. Попробуйте ещё раз."
              : "Unable to sign in. Try again.",
        );
      setSession(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error");
    } finally {
      setWorking(false);
    }
  }
  return (
    <main className={"access " + (mobile ? "bank-access" : "analyst-access")}>
      <header>
        <Brand />
        <Theme />
      </header>
      <div className="access-grid">
        <section
          className="access-art"
          aria-label={
            mobile
              ? "Демонстрационная карта"
              : "Behavioral identity illustration"
          }
        >
          <div className="art-top">
            <Fingerprint size={28} />
            <span>{mobile ? "SANA / PAY" : "IDENTITY LAB"}</span>
          </div>
          <div className="identity-print" aria-hidden="true">
            {Array.from({ length: 22 }, (_, i) => (
              <i key={i} style={{ width: 84 + i * 12, height: 40 + i * 9 }} />
            ))}
          </div>
          <div className="art-bottom">
            <span>
              {mobile ? "Демонстрационный счёт" : "Behavioral identity"}
            </span>
            <strong>{mobile ? "Карта перевода" : "128 dimensions"}</strong>
          </div>
        </section>
        <section className="access-form">
          <LockKeyhole size={22} />
          <h1>{mobile ? "Вход в банк" : "Analyst sign-in"}</h1>
          <p>
            {mobile
              ? "Войдите в учебный счёт для защищённого перевода."
              : "Sign in to review transfers, session signals and operator matches."}
          </p>
          <form onSubmit={login}>
            <Label htmlFor="alias">{mobile ? "Логин" : "Account alias"}</Label>
            <Input
              id="alias"
              name="alias"
              autoComplete="username"
              required
              maxLength={48}
            />
            <Label htmlFor="password">{mobile ? "Пароль" : "Password"}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
            {error && <p role="alert">{error}</p>}
            <Button className="primary" disabled={working || !session}>
              {working ? "…" : mobile ? "Войти" : "Sign in"}
              <ArrowRight />
            </Button>
          </form>
          <Button asChild variant="outline">
            <a href={location.pathname + "?mode=fixtures"}>
              <PanelsTopLeft />
              {mobile ? "Открыть демо" : "Explore fixture workspace"}
            </a>
          </Button>
        </section>
      </div>
    </main>
  );
}

export async function signOut(role: "mobile" | "analyst") {
  const res = await fetch("/api/v1/auth/" + role + "/logout", {
    method: "POST",
  });
  if (!res.ok) throw Error("Sign-out failed");
  location.reload();
}
