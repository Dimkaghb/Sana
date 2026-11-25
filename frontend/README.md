# Frontend ownership

Person One owns mobile/dashboard components, styling, routes, and mocks. Person Two owns only `src/sdk/` here. Follow the PRD's React/Next.js + Tailwind direction; the application has not been bootstrapped.

Develop UI against Contracts C/D in `../contracts/fixtures/`. Agree permission, keypad, slider, and submission callbacks before wiring the SDK. Do not duplicate telemetry logic in components.
