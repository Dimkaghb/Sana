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

**Verification** — Implemented and exercised with Chromium touch input, permission denial, account switching, retries, and virtual motion sensors. The system WebKit mobile layout completed a step-up transfer. Physical iPhone and Android validation is pending.

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

**Verification** — The targeted simulator, covered recoil, missing coverage, and protected commands passed software integration. Physical calibration on different surfaces and phones is pending.

Dependencies: Step 3 for real calibration; pure functions can start from fixtures earlier.

- Use PRD windows: tap [-40,+40] ms, baseline [-40,-15] ms, impact [-5,+35] ms.
- Begin with configurable 0.08 m/s^2 threshold; retain peak, coverage, waveform, and supporting evidence.
- Treat inadequate windows as unavailable. Combine provenance/contact/trajectory indicators without treating any one as universal proof of remote access.
- Add session-specific mobile WebSockets, bounded reconnect, and protected injection endpoint.
- Dispatch synthetic interactions through collectors and normal submission; never replace real IMU with zeros. Direct submit alone does not create tap evidence.
- Measure local detector and full-request latency separately. Agree update semantics before adding early hold plus asynchronous ML enrichment.

Exit: explainable normal/synthetic results, correctly targeted commands, and no zero-recoil flags caused by absent data. Calibrate handheld, tabletop, light taps, moving phones, and multiple devices.

## Step 5 - Coercion and calibrated risk fusion

**Verification** — Deterministic boundary and synthetic cadence tests passed. Configurable versioned policy values are included in case evidence. Real-world false-positive evaluation is pending.

- Implement repeated 2-4-digit bursts (<300 ms gaps), >900 ms pauses, and sufficient-observation checks.
- Use acceleration for MVP 8-12 Hz FFT: Contract A has orientation, not angular velocity. Validate sampling/duration/gaps, resample continuous segments, detrend, and window.
- Add smoothed posture transitions with hysteresis. A pause, posture change, or spectral peak is not proof of coercion.
- Apply the five PRD hold rules first. Version the agreed overall-score mapping and thresholds.
- Test boundaries: anti-RAT 74/75, amount 99,999/100,000, ring size 1/2, match 0.79/0.80, coercion 74/75, known/new recipient.

Exit: deterministic fixture behavior and policy checks pass; inadequate recordings stay unavailable; real false-positive evaluation remains distinct from synthetic tests.

## Step 6 - Live ML, operator actions, dossier export

**Verification** — Verified real HTTP scoring, unchanged owner baselines before explicit enrollment, protected operator ban, re-entry, case fingerprint, export, and failure recovery.

Dependencies: agreed B/map/ban and safe-baseline interfaces from Person Three.

- Switch mock/live by configuration; validate responses and test timeouts, errors, malformed bodies, and retries.
- Prevent learning from unverified sessions via agreed feedback or safe enrollment.
- Merge map and persisted alerts/KPIs for initialization; define KPIs without claiming every hold prevented proven fraud.
- Forward operator bans and persist confirmed/pending/failed status; publish agreed updates.
- Export case IDs, linked accounts, evidence, timestamps, policy provenance, and an ML-provided fingerprint if available.
- Keep `guardian_notified` false until real delivery exists. Export does not imply external transmission.

Exit: UI consumes stable interfaces, bans/exports work, and failure states are recoverable.

## Step 7 - Semifinal verification

**Verification** — The eight-slide presentation and sixty-second software backup are ready. Software rehearsals passed. Consented real-person sessions, device measurements, and a timed two-phone performance are pending.

- Collect five real sessions from each of four people for Person Three; keep recordings/participant mapping out of Git and separate enrollment/evaluation.
- Rehearse normal transfer, synthetic input, handoff, cross-account match, ban, and export.
- Test sensor denial, ML outage, dashboard reconnect, retries, account switch, and restart.
- Record actual sample rate, detector/full-request latency, and false positives.
- Prepare repeatable reset and backup recording; rehearse the three-minute flow.

Exit: repeatable demonstration and truthful metrics; no claims of production accuracy or real escrow.

## Step 8 - Offline final and Guardian extension

**Verification** — The scoped Guardian WebSocket, delivery acknowledgement, freeze, reconnect recovery, local serving and TLS rehearsal passed on the laptop. The final two-phone LAN rehearsal and participant calibration are pending.

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

## Authenticated workspace and windowed identity expansion

**Verified on the local live stack.** Two fictional mobile accounts signed in from a phone-sized Chromium context and submitted simulated transfers. A separate authenticated analyst received the first persisted session by WebSocket, opened its normalized timeline and UMAP point, then filtered the directory to the originating account. The second account had an empty receipt history before its own transfer. The build produces separate mobile, Guardian and dashboard JavaScript chunks.

The browser SDK now pairs capped pointer down/up observations with a whitelisted field and pointer type. The backend dossier and version 2 ML encoder share a bounded window implementation. Tests exercise overlap, missing channels, compatibility with old recordings, window influence on the normalized embedding, account spoof rejection, sign-out, pagination, snapshot recovery and backfill of dashboard totals. The phone and console each remember their theme. Local rehearsal generates separate credentials for each account and the analyst.

The latest run passed 21 shared contract/window tests, 17 backend tests, seven ML tests and nine browser tests, plus the seven-scenario HTTP/WebSocket rehearsal and the live enrollment, ring and ban check. Database evidence comes from local SQLite and embedded Qdrant. Deployment capacity, physical handset performance and participant accuracy still need measurements.

The population map was checked in desktop and phone-sized Chromium views against the local service feed. Selecting a labeled group opened all nine sessions counted by its label. The expanded map also opened an individual session dossier. First-time user comprehension still needs a usability check with participants.

## Three-dimensional population view

Verified the dashboard volume against the existing local rehearsal with 150 seeded sessions and one live submission. All 151 points received three PCA coordinates derived from their stored embeddings. The production build, 21 shared tests, 17 backend tests, seven ML tests and ten browser tests passed. The browser check exercised the live view at desktop and phone widths.

The analyst now explores the three-dimensional projection from a first-person camera. The live rehearsal showed 18 numbered groups for 143 grouped sessions and listed eight ungrouped sessions separately. Selecting a group reveals its member sessions. At 1500 px and 390 px browser widths, all 18 overview markers were visible and individually selectable by center-point hit testing. The production build and all ten browser tests passed.

## Analyst decision explanations

Selected the decision explainer for the judging demo. The existing Mirage Hold already gives the phone a calm processing receipt and sends the held transfer to the scoped Guardian. A coordinated account freeze would require a persistent account restriction and an undo workflow. A live sensor strip would require a new pre-submission stream and validation on physical phones.

1. Capture the decisive rule or rules in risk fusion using the active policy and available evidence.
2. Persist the explanation with the analyst event and render it in the transfer queue, case detail and export. Keep historical cases readable and the mobile receipt calm.
3. Exercise coexisting hold rules, missing sensors, mock identity, replay, recovery and browser navigation.

Verified all three steps locally. All seven scenario decisions passed the HTTP and WebSocket rehearsal, including retry and restart. The isolated live-model rehearsal passed enrollment, owner approval, cross-account hold, ban and re-entry. The production build and 56 tests passed across the shared, backend, ML and browser suites.

On this laptop, the seven mock-identity requests took 3.3–16.5 ms each. The synthetic evaluation used 18 enrolled and 18 query sessions. Feature extraction plus encoder inference took about 1 ms at p95. Both eligible cross-account queries ranked the expected operator first. Participant accuracy and end-to-end latency on physical phones remain open.

For a repeatable demonstration, open the fixture dashboard, select the transfer labeled “Possible coaching on a transfer to a new recipient,” and open its dossier. The synthetic decision cites repeated digit bursts, a new recipient and a score of 82 against the hold threshold of 75.

## Silent Duress

Implemented the dedicated coercion outcome across risk fusion, Contracts C/D, SQLite, mobile receipt and history, analyst queue and dossier, and the account-scoped Guardian. A qualifying new-recipient coercion hold takes precedence when other hold reasons also match. The automatic freeze and pending device alerts commit together before the backend broadcasts the event.

Verified one simulated ₸50,000 transfer on the local live model using three independent Chromium sessions. The customer entered three rapid digit groups with pauses. The customer receipt and history displayed neutral processing text, the analyst saw Silent Duress and both matching rules, and the Guardian saw the same reference already frozen. The dossier recorded the Guardian acknowledgement.

The production build, four schemas, 27 fixtures, seven HTTP/WebSocket scenarios, isolated live-model rehearsal and 62 automated tests passed. Tests cover opt-in and opt-out, a browser service-worker notification, a signed payload-free request to a simulated push service, transient failure/restart recovery, expired subscriptions, account isolation, hold totals and retry idempotency. Actual provider delivery on a physical phone and participant calibration remain unverified.

## Linked account review

The analyst queue and population map connect suspected mule rings to persisted cross-account cosine matches. The detail card shows the linked accounts and the simulated KZT exposure and protected value. After confirmation, the backend bans the operator, freezes existing held transfers attributed to the confirmed ring and places subsequent transfers from the linked accounts in review.

Verified the workflow against the isolated live identity service. The check established the owner baseline, identified the cross-account match, froze the linked accounts, held a subsequent transfer and counted the frozen KZT. The browser test verified that cancel leaves the ring unchanged and confirmation refreshes the counter. Backend tests cover persistence after restart, retry accounting, permission and evidence checks, and identity-service failure.
