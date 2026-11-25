# SANA Shield repository rules

## Source and scope

Read `CONTRACTS.md` and `docs/IMPLEMENTATION_PLAN.md` before implementation. The product source is `Markdown Live Preview.pdf`: Person Two's responsibilities are on pages 6-7, the timeline on pages 10-11, and the repository layout on page 11. Preserve the PRD's `KinetiqSDK` name and `data-kinetiq-field` attribute.

Use the PRD's monorepo layout, not person-numbered workspaces. Update the implementation plan as milestones are verified; a scaffold is not a running application.

## Ownership

| Path | Owner | Scope |
| --- | --- | --- |
| `frontend/`, except `frontend/src/sdk/` | Person One | Mobile/dashboard UI, styles, routes, mocks, pitch assets |
| `frontend/src/sdk/` | Person Two | Headless telemetry SDK, React adapter, transport |
| `backend/` | Person Two | Physics/coercion, FastAPI, WebSockets, risk fusion, SQLite, dossier export |
| `ml/` | Person Three | Features, embeddings, vector identity, population map, training |
| `contracts/`, `CONTRACTS.md`, root rules and integration docs | Shared | Interfaces and integration agreements |

Keep changes within the requested track. Integration edits in another owner's files must be necessary for the authorized task, minimal, and described. Backend accesses ML through HTTP, never by importing `ml/` internals. UI consumes a public SDK entry point; do not duplicate collectors in components.

## Contracts

- Preserve PRD field names and nesting in Contracts A-D. JSON Schema in `contracts/schemas/` is the executable reference; `CONTRACTS.md` documents semantics and open decisions.
- Update schemas, documentation, affected fixtures, and consumers together for interface changes. Record compatibility impact; never silently rename or reinterpret fields.
- Label proposals and unresolved interfaces. Synthetic scores and example thresholds are not measured performance.
- Validate schemas/fixtures with `python scripts/validate_contracts.py` and run `python -m unittest discover -s tests -v` after contract changes.
- At ingestion, reject unexpected fields and invalid numbers, and bound payload and collection sizes.

## Telemetry and decisions

- Collect timing, categories, and normalized coordinates only. Never collect/log input text, card/phone digits, clipboard data, or real names. Use fictional fixture labels. Behavioral/account identifiers are pseudonymous, not proof of anonymity.
- Event times are monotonic session-relative milliseconds; `started_at_ms` is epoch milliseconds; server timestamps are UTC.
- Acceleration is m/s^2; orientation is degrees. Measure sampling frequency and preserve native event provenance. Never invent missing motion, contact, key dwell, or trust measurements.
- Missing sensors, low coverage, and ML failures are unavailable evidence, not measured zero motion or verified-safe results.
- Apply explicit PRD hold rules before the general score policy. Keep thresholds deterministic, configurable, and versioned.
- Do not update owner baselines with unverified sessions. Keep simulated banking actions and demo command paths explicit.
- Do not claim browser injection proves detection of every remote-access tool, tremor proves coercion, or a dossier download is an official submission.

## Implementation and operations

- Use a TypeScript SDK, Python FastAPI backend, SQLite demo storage, and separate ML HTTP service on port 8001. Proposed backend development port: 8000.
- Keep SDK core independent of React; use `useKinetiq.ts` for lifecycle integration. Clean up listeners, timers, buffers, and sockets, including on repeated mounts.
- Keep signal processing and risk fusion as pure functions where practical; keep HTTP/storage outside those functions.
- Explicitly select mock or live ML. Never silently substitute synthetic results after live ML failure.
- Persist before broadcasting. Make session retries idempotent. Use one backend worker until shared messaging exists.
- Phone testing uses HTTPS/WSS. The offline final uses local services/assets and HTTPS trusted by the actual phones.
- Authenticate/restrict demo injection, bans, and Guardian actions. Never expose server secrets to frontend configuration.
- Do not commit `.env`, private keys/certificates, databases, real telemetry, dependencies, or builds. Commit synthetic fixtures and dependency locks.
- Preserve teammates' uncommitted work. Do not commit, push, or deploy unless requested. Run meaningful checks appropriate to the change and report remaining untested behavior.
