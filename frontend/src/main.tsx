import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/manrope/index.css";
import "./style.css";
import { Dashboard } from "./views/Dashboard";
import { Guardian } from "./views/Guardian";
import { Mobile } from "./views/Mobile";
const route = location.pathname.replace(/\/$/, "");
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
    {route === "/mobile" ? (
      <Mobile />
    ) : route === "/guardian" ? (
      <Guardian />
    ) : (
      <Dashboard />
    )}
  </StrictMode>,
);
