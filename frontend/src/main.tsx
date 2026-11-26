import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/manrope/index.css";
import "./style.css";
import { WorkspaceAccess } from "./components/WorkspaceAccess";
const Dashboard = lazy(() =>
  import("./views/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Guardian = lazy(() =>
  import("./views/Guardian").then((m) => ({ default: m.Guardian })),
);
const Mobile = lazy(() =>
  import("./views/Mobile").then((m) => ({ default: m.Mobile })),
);
const route = location.pathname.replace(/\/$/, "");
if (route === "/guardian") {
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute("href", "/guardian.webmanifest");
}
document.documentElement.lang = route === "/mobile" ? "ru" : "en";
document.title =
  (
    {
      "/mobile": "BCC · Перевод",
      "/guardian": "Guardian · SANA Shield",
    } as Record<string, string>
  )[route] || "Command Center · SANA Shield";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense
      fallback={
        <p role="status" className="empty-row">
          {route === "/mobile" ? "Загрузка…" : "Loading workspace…"}
        </p>
      }
    >
      {route === "/mobile" ? (
        <WorkspaceAccess role="mobile">
          {(alias) => <Mobile alias={alias} />}
        </WorkspaceAccess>
      ) : route === "/guardian" ? (
        <Guardian />
      ) : (
        <WorkspaceAccess role="analyst">
          {(alias) => <Dashboard alias={alias} />}
        </WorkspaceAccess>
      )}
    </Suspense>
  </StrictMode>,
);
