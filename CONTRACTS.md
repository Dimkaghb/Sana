# Shared data contracts

**Version: 1.0.0 foundation.** Source: PRD section 3 (pages 2-4), with Person Two behavior on pages 6-7. Field names and nesting are preserved. Schemas describe the complete PRD example shapes; operational extensions remain explicitly open below.

Do not silently alter fields. Update schemas, this document, affected fixtures, and consumers together. Sample values are examples, not fixed constants unless explicitly stated (128 dimensions, event type, and decision modes).

## Executable definitions

| Contract | Route/boundary | Schema |
| --- | --- | --- |
| A: `SessionTelemetryPayload` | SDK -> `POST /api/v1/sessions/ingest` -> `POST /ml/embed-and-score` | [A](contracts/schemas/session-telemetry.schema.json) |
| B: `MLScoreResponse` | ML -> backend | [B](contracts/schemas/ml-score.schema.json) |
| C: `DashboardRealtimeEvent` | Backend -> `WS /ws/dashboard` | [C](contracts/schemas/dashboard-event.schema.json) |
| D: `MobileTransferDecision` | Ingest response -> mobile | [D](contracts/schemas/mobile-decision.schema.json) |

All example fields are required. All objects reject extra properties, including nested objects, to catch drift and accidental text collection. Arrays may be empty where no observations exist. Numeric values must be finite. An unknown measurement is not encoded as zero; incomplete records must not be fabricated to satisfy a schema. Nullable partial measurements require an explicit extension before use.

JSON Schema validates shapes/ranges. The repository validator additionally checks timing order, duration coverage, ring cardinality, and cross-contract identity/decision coherence. Runtime payload-size limits and authorization are Step 2 work.

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

Each stream is ordered by its timestamps; paired key-up cannot precede key-down. The SDK stores at most the last 20 seconds of IMU. Earlier tap records cannot receive a recoil conclusion without overlapping retained data.

**Semantic clarification:** the PRD says linear acceleration but shows `az: 9.81` in its example. Follow the linear-acceleration requirement; fixtures use near-zero resting acceleration. This changes an example value, not a field. Normalize a gravity-inclusive fallback before serialization and record its provenance internally. Do not silently mix units or raw/gravity-inclusive signals across devices.

The sample-rate zero sentinel, precise offset normalization, fractional timestamps, and complete-record requirement are foundation conventions where the PRD is underspecified. Share these with Person Three before training. Browser acceleration can exclude gravity or be unavailable; rotation rate is a different measurement: [acceleration documentation](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/acceleration), [rotation-rate documentation](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/rotationRate).

## B - Identity evidence

- `embedding_dim` is exactly 128. `embedding_preview` contains 1-128 components, not necessarily the complete vector; do not normalize or hash the preview as though it were the full embedding.
- Cosine similarity ranges from -1 to 1; match confidence ranges from 0 to 1. Neither fixture value is a calibrated probability.
- `baseline_sessions_count` is nonnegative. Zero baseline sessions must not be interpreted as proven owner verification.
- `linked_account_ids` is unique; `ring_size` equals its cardinality for these complete-list contracts.
- `map_point` contains x/y and integer cluster ID; `inference_ms` is ML-reported duration, distinct from backend end-to-end latency.
- Missing operator identity, unavailable map projection, and ML error responses are not specified by the PRD's complete example. Do not manufacture values; settle the extension in Step 2 with Person Three.

## C - Dashboard snapshot

- `type` is `SESSION_SCORED`; `timestamp` is a UTC RFC 3339 timestamp ending in `Z`.
- `session_id` and `account_id` match A. All risk scores are in [0,100].
- `decision` uses the same three outcomes as D. Both outputs represent the same persisted decision.
- `account_label` is a fictional demo display label or approved account alias; the telemetry SDK does not collect names.
- Flag entries contain `code`, `severity`, `title`, and `detail`. The PRD establishes `ZERO_RECOIL_RAT`, `ACCOUNT_HANDOFF`, `DROPPER_RING_MATCH`, `DICTATION_COERCION`, and `HAND_TREMOR`. Fixtures additionally use `BANNED_OPERATOR`; this is an additive example code, not a closed enum change.
- Severity/status strings remain open because the PRD does not define complete enums. Fixtures use `CRITICAL` severity and `NORMAL`/`CRITICAL` map statuses.
- `recoil_waveform.t_ms` is relative to the selected tap and can be negative; `az_delta` is baseline-relative m/s^2. If UI displays g, convert explicitly.
- C's map coordinates/cluster/operator match B when B is present.

C is a completed-session event, not the streaming protocol for a continuously updating oscilloscope. Do not present an unmeasured inference result or absent sensor score as a numeric zero just to fill this shape.

## D - Mobile outcome

Allowed `ui_mode`: `SUCCESS`, `MIRAGE_HOLD`, `STEP_UP_LIVENESS`. Display strings and reference code are backend-provided. The reference identifies a simulated transfer in the prototype.

`guardian_notified` is false until a real notification has been delivered. The PRD's true example is not a requirement to claim delivery before implementing Guardian support.

## Required decision behavior

Evaluate these PRD hold rules before the general score:

1. Anti-RAT score >= 75.
2. Banned operator match.
3. Handoff and amount >= 100,000 KZT.
4. Ring size >= 2 and match confidence >= 0.80.
5. Coercion score >= 75 and new recipient.

The PRD assigns `STEP_UP_LIVENESS` to overall scores 50-74 and `SUCCESS` below 50. Its overall-score formula and >=75 cases without an explicit hold are unresolved. Proposed default: maximum available component score, explicit hold precedence, otherwise step-up at >=50. This remains a proposal until runtime policy is documented in Step 2; fixture scores do not implement the policy.

## Open interfaces and decisions

| Item | Owner(s) | Required resolution |
| --- | --- | --- |
| Partial motion/keyboard records | Persons Two + Three | Nullable/capability representation; absent values must not become zeros |
| Unavailable ML/map/component score | All three | Optional/null status and dashboard behavior, with synchronized schema changes |
| Dashboard init | Persons One + Two + Three | Points, clusters, recent alerts, KPI definitions, pagination/recovery boundary |
| Population map and ban | Persons Two + Three | Exact request/response schemas and confirmation/error behavior |
| Safe baseline updates | Persons Two + Three | Decision feedback or safe enrollment before centroid updates |
| Operator fingerprint | Persons Two + Three | Stable full-vector fingerprint supplied by ML; preview is insufficient |
| <200 ms hold vs 1.5 s ML timeout | Persons One + Two | Separate latency targets, or explicit early-hold/enrichment event |
| Demo/reset and Guardian | Persons One + Two | Authentication, command acknowledgment, delivery/freeze state and reset scope |
| Official dossier | Person Two | Prototype schema now; official receiving specification needed before compatibility claims |

Keep the initial complete-example fixtures usable while these are resolved. No public integration is claimed ready while the required failure modes remain unspecified.

## Fixtures and checks

`contracts/fixtures/manifest.json` lists seven synthetic scenarios. Normal, synthetic touch, dictation, handoff, ring, and banned operator include A-D. Missing sensors includes A only: B/C/D are intentionally absent because the missing-evidence response is not settled. This is a missing-data example, not a successful score or physics result.

Synthetic IMU/key timings are constructed examples; B embeddings/identity matches and C scores/map points are hand-authored illustrative data. They are not algorithm outputs or calibration datasets. Do not report fixture checks as detection accuracy. `STEP_UP_LIVENESS` enum compatibility is tested even though no full gray-zone fixture is frozen yet.

Run `python scripts/validate_contracts.py` and `python -m unittest discover -s tests -v` from the repo root in the configured environment.
