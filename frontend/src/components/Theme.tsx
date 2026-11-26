import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "./ui/button";

const themeKey =
  "sana-theme-" +
  (location.pathname.startsWith("/mobile") ? "mobile" : "console");
const initial =
  localStorage.getItem(themeKey) ||
  (location.pathname.startsWith("/mobile") ? "light" : "dark");
document.documentElement.dataset.theme = initial;
document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute("content", initial === "dark" ? "#101213" : "#ffffff");
export function Theme() {
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark",
  );
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        document
          .querySelector('meta[name="theme-color"]')
          ?.setAttribute("content", next === "dark" ? "#101213" : "#ffffff");
        localStorage.setItem(themeKey, next);
        setDark(!dark);
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
