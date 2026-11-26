import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const target = env.SANA_BACKEND_URL || "http://127.0.0.1:8000";
  const https =
    env.SANA_TLS_KEY && env.SANA_TLS_CERT
      ? {
          key: readFileSync(env.SANA_TLS_KEY),
          cert: readFileSync(env.SANA_TLS_CERT),
        }
      : undefined;
  const proxy = { "/api": { target }, "/ws": { target, ws: true } };
  return {
    plugins: [react(), tailwind()],
    server: { https, proxy },
    preview: { https, proxy },
  };
});
