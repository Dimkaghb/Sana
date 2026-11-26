# Shared data contracts

**Contracts C and D version 1.3.0. Contracts A and B retain their existing schemas.** Source: PRD section 3 (pages 2-4), with Person Two behavior on pages 6-7. Field names and nesting are preserved. Schemas preserve the PRD example shapes and document the runtime extensions below.

Do not silently alter fields. Update schemas, this document, affected fixtures, and consumers together. Sample values are examples, not fixed constants unless explicitly stated (128 dimensions, event type, and decision modes).

## Executable definitions

| Contract | Route/boundary | Schema |
| --- | --- | --- |
| A: `SessionTelemetryPayload` | SDK -> `POST /api/v1/sessions/ingest` -> `POST /ml/embed-and-score` | [A](contracts/schemas/session-telemetry.schema.json) |
| B: `MLScoreResponse` | ML -> backend | [B](contracts/schemas/ml-score.schema.json) |
| C: `DashboardRealtimeEvent` | Backend -> `WS /ws/dashboard` | [C](contracts/schemas/dashboard-event.schema.json) |
| D: `MobileTransferDecision` | Ingest response -> mobile | [D](contracts/schemas/mobile-decision.schema.json) |

All field names remain required. In v1.1, unavailable scores and the missing dashboard map point accept JSON null. Consumers of v1.0 must handle these values before upgrading. All objects reject extra properties, including nested objects, to catch drift and accidental text collection. Arrays may be empty where no observations exist. Numeric values must be finite. An unknown measurement is not encoded as zero; incomplete records must not be fabricated to satisfy a schema. Nullable partial measurements require an explicit extension before use.

JSON Schema validates shapes/ranges. The repository validator additionally checks timing order, duration coverage, ring cardinality, and cross-contract identity/decision coherence. Runtime ingestion also enforces byte and stream-size limits.

## A - Telemetry semantics

| Fields | Meaning |
| --- | --- |
| `session_id`, `account_id` | Opaque pseudonymous identifiers; one session submission corresponds to one transfer attempt |
| `device_meta.screen_w/screen_h` | Positive viewport dimensions in CSS pixels at session capture |
| `device_meta.os` | OS label, e.g. `iOS`; not an asserted fingerprint |
| `device_meta.sample_rate_hz` | Measured motion sampling frequency; use 0 when no motion samples are available |
| `started_at_ms` | Unix epoch milliseconds at session start |
| `duration_ms` | Elapsed monotonic milliseconds at snapshot cutoff |
| Event `t_ms`, `down_ms`, `up_ms` | Nonnegative milliseconds relative to the same session start; fractional values allowed |
| `keystrokes[].key_group` | `digit` or `backspace`; never the actual digit |
| `dx_norm`, `dy_norm` | Signed offsets relative to the relevant key/control center, normalized by its dimensions; range [-1,1] |
| Tap/slider `x_norm`, `y_norm` | Viewport-normalized coordinates in [0,1] |
| `radius_x`, `radius_y` | Contact radii in CSS pixels; convert width/height to radii rather than changing units |
| `is_trusted` | Actual browser event provenance; never force it to true |
| `pressure` | Browser-reported normalized pressure in [0,1] |
| `ax`, `ay`, `az` | Gravity-removed acceleration in m/s^2 |
| `alpha`, `beta`, `gamma` | Orientation angles in degrees, not angular velocity |
| `transfer_context` | Nonnegative amount in KZT and whether recipient is new; no recipient digits/details |

In the browser SDK each IMU record corresponds to a motion event. Its angles come from the last complete orientation event in the current uninterrupted visible collection period. Browsers can report orientation on change. Contract A carries the motion timestamp and does not carry the original angle timestamp. If no valid orientation is available, the SDK omits that IMU record.

Each stream is ordered by its timestamps; paired key-up cannot precede key-down. The SDK stores at most the last 20 seconds of IMU. Earlier tap records cannot receive a recoil conclusion without overlapping retained data.

**Semantic clarification:** the PRD says linear acceleration but shows `az: 9.81` in its example. Follow the linear-acceleration requirement; fixtures use near-zero resting acceleration. This changes an example value, not a field. Normalize a gravity-inclusive fallback before serialization and record its provenance internally. Do not silently mix units or raw/gravity-inclusive signals across devices.

The sample-rate zero sentinel, precise offset normalization, fractional timestamps, and complete-record requirement are foundation conventions where the PRD is underspecified. Share these with Person Three before training. Browser acceleration can exclude gravity or be unavailable; rotation rate is a different measurement: [acceleration documentation](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/acceleration), [rotation-rate documentation](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/rotationRate).

## B - Identity evidence

- `embedding_dim` is exactly 128. `embedding_preview` contains 1-128 components, not necessarily the complete vector; do not normalize or hash the preview as though it were the full embedding.
- Available cosine similarity ranges from -1 to 1 and available match confidence ranges from 0 to 1. Use null similarity without a verified owner baseline and null confidence for a newly allocated operator without a prior match. Neither fixture value is a calibrated probability.
- `baseline_sessions_count` is nonnegative. Zero baseline sessions must not be interpreted as proven owner verification.
- `linked_account_ids` is unique; `ring_size` equals its cardinality for these complete-list contracts.
- `map_point` contains x/y and integer cluster ID; `inference_ms` is ML-reported duration, distinct from backend end-to-end latency.
- When ML cannot score the session, there is no Contract B. The backend can still return a decision using the available physical evidence.

## C - Dashboard snapshot

- `type` is `SESSION_SCORED`; `timestamp` is a UTC RFC 3339 timestamp ending in `Z`.
- `session_id` and `account_id` match A. Available risk scores are in [0,100]. Each component and the overall score accept null. With no B, map_point is null.
- `decision` uses the same four outcomes as D. Both outputs represent the same persisted decision.
- `account_label` is a fictional demo display label or approved account alias; the telemetry SDK does not collect names.
- Flag entries contain `code`, `severity`, `title`, and `detail`. The PRD establishes `ZERO_RECOIL_RAT`, `ACCOUNT_HANDOFF`, `DROPPER_RING_MATCH`, `DICTATION_COERCION`, and `HAND_TREMOR`. Fixtures additionally use `BANNED_OPERATOR`; this is an additive example code, not a closed enum change.
- Severity/status strings remain open because the PRD does not define complete enums. Fixtures use `CRITICAL` severity and `NORMAL`/`CRITICAL` map statuses.
- `recoil_waveform.t_ms` is relative to the selected tap and can be negative; `az_delta` is baseline-relative m/s^2. Fixtures round waveform amplitudes to six decimal places. Compare within half of the final decimal unit plus floating-point evaluation error. If UI displays g, convert explicitly.
- C's map coordinates/cluster/operator match B when B is present.

C is a completed-session event, not the streaming protocol for a continuously updating oscilloscope. Do not present an unmeasured inference result or absent sensor score as a numeric zero just to fill this shape.

## D - Mobile outcome

Allowed `ui_mode`: `SUCCESS`, `MIRAGE_HOLD`, `STEALTH_HOLD`, `STEP_UP_LIVENESS`. Display strings and reference code are backend-provided. The reference identifies a simulated transfer in the prototype.

`guardian_notified` is false until a real notification has been delivered. The PRD's true example is not a requirement to claim delivery before implementing Guardian support.

## Required decision behavior

Evaluate these PRD hold rules before the general score:

1. Anti-RAT score >= 75.
2. Banned operator match.
3. Handoff and amount >= 100,000 KZT.
4. Ring size >= 2 and match confidence >= 0.80.
5. Coercion score >= 75 and new recipient.

The demo uses the maximum available component score, or null when all components are unavailable. After the explicit holds, unavailable identity or recoil evidence or a score of at least 50 triggers step-up. Otherwise the transfer succeeds. The policy and thresholds describe a simulated decision. Calibration requires separate observations.

## Runtime interfaces

Dashboard initialization returns persisted recent events and the active ML mode. Its session_identity object maps those session IDs to the stored match confidence, linked account IDs and analyst enrollment eligibility. Similarity values are scores, not calibrated probabilities. Older dossiers can lack a stored confidence. Open the dashboard WebSocket before taking the recovery snapshot and reconcile by session ID. Keep the browser SDK and frontend decoupled through the SDK public entry point. Administrative credentials are configured on the server. Authorized users enter their scoped credentials at runtime.

Contract A keeps the original complete measurement records. Omit incomplete observations, including keys without both timing and offset or motion samples without orientation. Partial measurements would need a future contract extension. The backend accesses ML over HTTP and enrolls only explicitly verified sessions. A case download contains a prototype incident record. Any official submission needs a separate receiving specification.

## Fixtures and checks

`contracts/fixtures/manifest.json` lists seven synthetic scenarios. Normal, synthetic touch, dictation, handoff, ring, and banned operator include A-D. Missing sensors includes A, C and D and illustrates step-up with unavailable motion and identity evidence. Its waveform is empty.

Synthetic IMU/key timings are constructed examples. Fixture embeddings, scores and map points are hand-authored illustrations. Evaluate algorithm performance separately.

Run `python scripts/validate_contracts.py` and `python -m unittest discover -s tests -v` from the repo root in the configured environment.

## Contact observations and window features

Contract A 1.1 adds the optional `contacts` array. A 1.0 sender can continue omitting it. A strict 1.0 receiver rejects the new field, so upgrade backend and ML validators before rolling out the SDK. The synthetic normal fixture includes paired contacts. Each record contains session-relative down/up times, browser pointer type, trust provenance and one whitelisted field category. The category distinguishes recipient, amount, recipient type, preset, details review and confirmation slider interactions. Actual keypad digits and recipient values never enter this stream. Dropped, canceled or unpaired contacts do not yield durations. The stream is ordered by down time and limited to 512 records.

Window version 1 uses 2,000 ms half-open intervals anchored to session start every 1,000 ms. It retains the final 64 window starts and clips displayed ends to the observed duration. Durations contribute only when both ends fall inside the window. Channel values are clipped to [0, 1] before averaging. Key and contact dwell use a 1,000 ms reference, key interval uses 2,000 ms, acceleration magnitude uses 9.80665 m/s² and slider travel uses one normalized viewport unit per second. Slider speed omits gaps above 150 ms. Pressure uses browser units. Null means no eligible observations in the interval. These are fixed feature scales, independent of risk thresholds. Older dossiers can lack window evidence. The exported dossier contains derived windows. Raw recording still requires calibration consent.

Live browser ingestion and calibration require a mobile login matching A's account ID. Analyst session cookies authorize dashboard HTTP and WebSocket access. A stored login alias identifies the account. The matched operator ID identifies a behavioral similarity hypothesis and can link multiple aliases. Contract B–D shapes are unchanged.

### Population map coordinates

The ML population endpoints and dashboard initialization add an optional `position_3d` array to each population point. Its three finite numbers are PC1, PC2 and PC3 of the full stored session embedding, using PCA fitted to the active model generation's training embeddings. All pages and sessions in a generation share this basis. Existing stored vectors are projected on read. The existing x/y values and cluster IDs retain their UMAP semantics in Contracts B and C. Receivers with the previous strict population validator need the updated backend before serving the extended map. When 3D coordinates are unavailable the dashboard still lists the session for inspection.

### Analyst decision explanation

Contract C 1.2 adds optional `decision_explanation` to the completed event. New decisions record the policy version and an ordered list of the rules that determined the outcome. Each rule has a stable code, short title and plain-English detail. Multiple qualifying holds are retained. A missing-evidence step-up is recorded only when no hold rule applies. Flags continue to describe observations independently. Mock identity remains labeled by the event’s `MOCK_IDENTITY` flag. The saved event supplies the WebSocket, dashboard recovery and dossier export. Existing events can omit the field. Upgrade strict Contract C validators before enabling a 1.2 producer. In version 1.2 this extension affected only the analyst event.

### Silent Duress

Contracts C and D version 1.3 extend the original PRD with a fourth outcome, `STEALTH_HOLD`. A coercion score at or above the configured hold threshold and a new recipient activate it. If another hold rule also qualifies, the decision is stealth and the recorded explanation retains all qualifying reasons. Other hold rules still select `MIRAGE_HOLD`. The default policy version is `demo-2`. Strict enum consumers, including the mobile SDK, must upgrade with the backend. Historical decisions and receipts keep their original meanings.

The backend saves the stealth receipt, frozen simulated transfer and pending device notifications in one SQLite transaction. Both hold types count toward held KZT. Mobile displays neutral processing text and a reference. The analyst sees Silent Duress. A scoped Guardian hold includes `urgent` and `acknowledged` booleans. Stealth holds are immediately frozen. Other holds retain the manual freeze action. Acknowledgement records display in an authenticated, visible Guardian view. Neither push-provider acceptance nor a browser notification alone acknowledges the case.

A Guardian can opt in to Web Push for their own device. The service worker receives a payload-free notification and opens the authenticated Guardian page. The server coalesces pending notifications per device and retries temporary failures for up to an hour. The held transfer remains in account history. Supply the operator contact with `SANA_PUSH_CONTACT` (a mailto URL) when using a real push service. The VAPID signing key and device endpoints are private local database records. Signing out closes the private view. Device notifications remain enabled until the Guardian disables them or revokes browser permission.
