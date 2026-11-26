# Person Two implementation plan

Source: `Markdown Live Preview.pdf`, especially pages 6-7 and 10-11. Preserve its ownership and field names. These are implementation milestones; teammates can work independently against shared fixtures. No runtime component is implemented in Step 1.

## Step 1 - Repository foundation and contracts

**Verified locally.** Four schemas, 27 fixtures, seven scenarios, and 19 shared contract tests passed.

- Establish rules, PRD folder layout, ignored artifacts, and ownership docs.
- Express Contracts A-D as JSON Schema without renaming fields.
- Add synthetic normal, synthetic-touch, missing-sensor, dictation, handoff, ring, and banned-operator examples.
- Validate schemas, fixtures, identifiers, decision consistency, and malformed/extra-field rejection.
- Record ambiguities and missing interfaces in `CONTRACTS.md`.

Exit: teammates have valid examples and clear ownership without any services running; repository checks pass.

## Step 2 - Minimal backend and complete fixture-driven flow

**Local fixture flow verified** with the standalone demo check. Trusted real-phone connectivity remains a field check.

Dependencies: Step 1. Settle dashboard init, unavailable-result representation, and general risk semantics before freezing runtime models.

- Add FastAPI configuration/models, health/readiness routes, and runtime dependencies.
- Implement ingestion, explicit mock ML, initial risk policy, SQLite, and C/D mapping.
- Use one worker. Add an async live ML client configured by `ML_SERVICE_URL` with a 1.5-second timeout.
- Return the stored result for identical retries; reject a changed payload reusing a session ID. Prevent duplicate ML effects and KPIs.
- Persist before publishing; implement dashboard WebSocket and initialization/recovery.
- Restrict origins and administrative operations. Arrange HTTPS with Person One and probe connectivity from real phones.

Exit: A produces a stored decision, C event, and D response with matching identifiers. ML failure never becomes fabricated safe evidence.

## Step 3 - Real mobile telemetry SDK

Dependencies: Step 2 and callback agreement with Person One. Start sensor/HTTPS feasibility during Step 2.

- Implement `KinetiqSDK` and thin `useKinetiq.ts` adapter in `frontend/src/sdk/`.
- Request permissions from user interaction; support start/stop, account reset, and complete cleanup on unmount/remount.
- Use a common monotonic session clock, separate epoch start, and measured IMU frequency.
- Bound the 20-second IMU buffer and event arrays. Do not analyze older taps lacking IMU coverage.
- Collect provenance/geometry, normalized coordinates, permitted key groups/timings, and active slider movement. Prefer custom-keypad callbacks when native keyboard measurements are unavailable.
- Whitelist serialization; never store input text. Never invent missing measurements.
- Include the final post-tap window before snapshot submission. Expose errors and submission state to the UI.

Exit: iPhone and Android payloads validate over HTTPS; denied permissions are handled; remounts do not duplicate collection; account switches clear prior data.

## Step 4 - Recoil detection and attack simulator

Dependencies: Step 3 for real calibration; pure functions can start from fixtures earlier.

- Use PRD windows: tap [-40,+40] ms, baseline [-40,-15] ms, impact [-5,+35] ms.
- Begin with configurable 0.08 m/s^2 threshold; retain peak, coverage, waveform, and supporting evidence.
- Treat inadequate windows as unavailable. Combine provenance/contact/trajectory indicators without treating any one as universal proof of remote access.
- Add session-specific mobile WebSockets, bounded reconnect, and protected injection endpoint.
- Dispatch synthetic interactions through collectors and normal submission; never replace real IMU with zeros. Direct submit alone does not create tap evidence.
- Measure local detector and full-request latency separately. Agree update semantics before adding early hold plus asynchronous ML enrichment.

Exit: explainable normal/synthetic results, correctly targeted commands, and no zero-recoil flags caused by absent data. Calibrate handheld, tabletop, light taps, moving phones, and multiple devices.

## Step 5 - Coercion and calibrated risk fusion

- Implement repeated 2-4-digit bursts (<300 ms gaps), >900 ms pauses, and sufficient-observation checks.
- Use acceleration for MVP 8-12 Hz FFT: Contract A has orientation, not angular velocity. Validate sampling/duration/gaps, resample continuous segments, detrend, and window.
- Add smoothed posture transitions with hysteresis. A pause, posture change, or spectral peak is not proof of coercion.
- Apply the five PRD hold rules first. Version the agreed overall-score mapping and thresholds.
- Test boundaries: anti-RAT 74/75, amount 99,999/100,000, ring size 1/2, match 0.79/0.80, coercion 74/75, known/new recipient.

Exit: deterministic fixture behavior and policy checks pass; inadequate recordings stay unavailable; real false-positive evaluation remains distinct from synthetic tests.

## Step 6 - Live ML, operator actions, dossier export

Dependencies: agreed B/map/ban and safe-baseline interfaces from Person Three.

- Switch mock/live by configuration; validate responses and test timeouts, errors, malformed bodies, and retries.
- Prevent learning from unverified sessions via agreed feedback or safe enrollment.
- Merge map and persisted alerts/KPIs for initialization; define KPIs without claiming every hold prevented proven fraud.
- Forward operator bans and persist confirmed/pending/failed status; publish agreed updates.
- Export case IDs, linked accounts, evidence, timestamps, policy provenance, and an ML-provided fingerprint if available.
- Keep `guardian_notified` false until real delivery exists. Export does not imply external transmission.

Exit: UI consumes stable interfaces, bans/exports work, and failure states are recoverable.

## Step 7 - Semifinal verification

- Collect five real sessions from each of four people for Person Three; keep recordings/participant mapping out of Git and separate enrollment/evaluation.
- Rehearse normal transfer, synthetic input, handoff, cross-account match, ban, and export.
- Test sensor denial, ML outage, dashboard reconnect, retries, account switch, and restart.
- Record actual sample rate, detector/full-request latency, and false positives.
- Prepare repeatable reset and backup recording; rehearse the three-minute flow.

Exit: repeatable demonstration and truthful metrics; no claims of production accuracy or real escrow.

## Step 8 - Offline final and Guardian extension

- Nov 27-29: timing, coverage, calibration, real-device contract checks.
- Nov 30-Dec 3: thresholds, reconnect/failure handling, cross-device false positives.
- Dec 4-6: agreed Guardian contracts, authenticated notification/freeze, second-phone integration.
- Dec 7-9: local services/assets/datasets, trusted phone HTTPS, startup/reset runbook.
- Dec 10-11: dependency freeze and full rehearsals with internet disabled.

Exit: stage flow works over LAN without cloud/tunnel dependency; notification and freeze transitions work within the simulated transfer system.

## Semifinal time budget

| Hours | Target |
| --- | --- |
| 0-1 | Foundation and essential interface decisions |
| 1-3 | Minimal backend, HTTPS, real-phone sensor probe |
| 3-5 | SDK path, recoil, storage, initial policy |
| 5-7 | WebSockets, injection, cadence |
| 7-10 | UI/ML integration and calibration |
| 10-12 | Failure checks, ban/export, latency, rehearsal |

The PRD schedule is aggressive, not a completion guarantee. Protect the complete normal/synthetic flow first. Defer tremor/posture refinement and continuous streaming if needed; never replace missing functionality with unlabeled fabricated evidence.
