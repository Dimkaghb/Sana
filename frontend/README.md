# SANA Shield frontend

React and TypeScript UI with bundled fonts, icons, styles and synthetic contract examples. Run commands from this directory using Node 22.12 or later.

```sh
npm ci
npm run dev
npm run build
npm test
```

Vite proxies same-origin `/api` and `/ws` to the FastAPI backend at `127.0.0.1:8000`. Set `SANA_BACKEND_URL` for another local backend. Set the backend’s `SANA_ALLOWED_ORIGINS` to the exact frontend origin. The browser tests use local Chrome on macOS or Playwright Chromium elsewhere (`npx playwright install chromium`). An installed Chromium can be selected with `SANA_TEST_CHROME`.

| Route | Use |
| --- | --- |
| `/dashboard` | Sign in as an analyst to view the service feed, flags and dossiers. Prepare a valid transfer on the phone, then select its connected session before sending the synthetic-click command. On eligible live sessions, the analyst can explicitly attest independent owner verification and enroll the session for future scoring. |
| `/dashboard/map`, `/dashboard/signals`, `/dashboard/accounts` | Explore paged UMAP points, inspect normalized session windows, or search account aliases and review their transfers. |
| `/mobile` | Sign in with a provisioned mobile alias, activate protection, enter at least four simulated recipient digits, and drag the slider. Keyboard users can focus the slider and press Enter. Grant browser motion access when prompted. |
| `/guardian` | Sign in with the Guardian token for a single demo account. Visible holds are acknowledged. Freezing a transfer requires an explicit click. |
| `/dashboard?mode=fixtures`, `/mobile?mode=fixtures`, `/guardian?mode=fixtures` | Explicit local fixture previews. A transfer fixture can be selected by scenario. |
| `/pitch.html` | Offline presentation. |

On the phone, optional per-transfer calibration consent saves the exact submitted telemetry to the configured local backend capture directory. Configure `SANA_CALIBRATION_DIR` on the backend before a capture session. The mobile screen reports whether the recording was saved.

For phone development, configure `SANA_TLS_KEY` and `SANA_TLS_CERT` on the Vite process, issue a certificate for the actual LAN hostname, trust its issuer on the phones, and start `npm run dev -- --host 0.0.0.0`. For the offline stage, serve `dist/` over trusted HTTPS with a history fallback and route same-origin API and WebSocket requests to FastAPI. The LAN services remain necessary for live scoring. Mobile and analyst sessions use HttpOnly cookies. Guardian tokens stay in memory for the active tab.

The UI uses locally owned shadcn/ui New York primitives in `src/components/ui` with the upstream MIT license. Theme preferences are saved separately for the mobile and analyst workspaces.
