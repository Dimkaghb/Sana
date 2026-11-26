# SANA Shield demo backend

Run commands from the repository root. The supported local topology uses a single Uvicorn worker and SQLite. Install the locked Python 3.12 environment once while online.

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
ML_MODE=mock backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The mock identity service replays Contract B examples for the six labeled fixture IDs. Other mock sessions use an explicitly labeled normal demo identity. The physics and policy still run on the submitted observations. With `ML_MODE=live`, the backend calls the private ML process on port 8001 over HTTP. A missing, late, malformed, or inconsistent ML result leaves identity evidence unavailable. Scoring never enrolls an owner.

## Configuration

| Variable | Meaning |
| --- | --- |
| `ML_MODE` | Required. Select `mock` or `live`. Use a fresh database when switching demonstration populations. |
| `ML_SERVICE_URL` | Private identity URL. Default `http://127.0.0.1:8001`. Scoring has a 1.5-second total timeout. |
| `SANA_DB` | SQLite path. Default `backend/data/demo.sqlite3`. Start a fresh rehearsal with an unused path. |
| `SANA_ALLOWED_ORIGINS` | Comma-separated exact frontend origins. Defaults to localhost and 127.0.0.1 on port 5173. |
| `SANA_ADMIN_TOKEN` | Operator bearer token for simulation, bans, and dossier download. Unset disables these actions. |
| `ML_ADMIN_TOKEN` | Server-side bearer for the separate ML admin API. Match the value configured in that process. |
| `SANA_GUARDIAN_TOKENS` | JSON object mapping each demo account ID to its own bearer token. Give a Guardian only the token for their account. |
| `SANA_RECOIL_FLOOR` | Positive low-recoil threshold in m/s². Default 0.08. Case exports record the settings used. |
| `SANA_CALIBRATION_DIR` | Opt-in raw recording directory under the ignored `backend/data`. Unset disables recording. |

Enter credentials through the relevant analyst or Guardian view. Keep the server-to-server ML credential on the laptop. Run the service on a private demo network. The dashboard is intended for all observers on that network. See [offline setup](../docs/OFFLINE_REHEARSAL.md) for real-phone HTTPS.

## Session flow

1. `POST /api/v1/sessions/ingest` accepts Contract A as JSON, up to 1 MiB, with at most 4,096 IMU samples, 2,048 slider points, 512 taps, and 512 keystrokes. It rejects invalid timing, unknown fields, non-finite values and duplicate properties. Error responses omit submitted data.
2. Tap recoil uses gravity-removed Z acceleration in the PRD windows. A weak, well-covered impact combined with native event provenance or contact geometry contributes to the demo risk score. Uneven coverage and missing samples can prevent assessment. Coercion indicators use repeated digit cadence, windowed 8–12 Hz acceleration power and smoothed posture transitions. Calibrate these heuristics with actual devices before drawing conclusions from their scores.
3. The five explicit hold rules take priority. The general score uses the highest available component. The demo steps up at 50 and whenever owner or recoil evidence is unavailable. Owner assessment requires three verified enrollment sessions. Missing evidence appears as null in Contract C.
4. The backend stores the payload digest, decision, dashboard event, and case evidence before broadcasting C and returning D. Identical retries return the original decision. A reused ID with a changed payload returns 409. Completed cases never change their original decision when a later Guardian action is recorded.
5. `WS /ws/dashboard` sends C or a `DASHBOARD_REFRESH` control. On open or refresh, `GET /api/v1/dashboard/init` returns the latest 200 events newest first, active phone sessions, ML mode, and identity population map when available. KPIs count all stored sessions, simulated held KZT, distinct matched ring operators and mean live ML inference time. A receiver can merge events by session ID while recovering the initial snapshot.

## Operator and Guardian actions

The mobile view connects to `/ws/mobile/{session_id}`. An authorized `POST /api/v1/demo/inject-rat-click` with a JSON `session_id` sends `INJECT_RAT_CLICK` to that specific connected phone. The backend waits for normal client collection and submission to produce an assessment.

An authorized `POST /api/v1/operators/{operator_id}/ban` records pending, failed or confirmed status. A successful live response requires ML confirmation. Retrying a confirmed ban is idempotent. Download a simulated case through `GET /api/v1/cases/{session_id}/export-antifraud`. When the live identity service supplies a SHA-256 fingerprint of the full stored session vector, the dossier includes and caches it. Subsequent recordings from the same operator can have different fingerprints.

A Guardian connects to `/ws/guardian` and sends `{"token":"…"}` as the first frame. The server returns `GUARDIAN_HOLDS` snapshots scoped to that account on connection, new hold and freeze. The same list is available at `GET /api/v1/guardian/holds` with a scoped bearer header. Once displayed, acknowledge the hold via `POST /api/v1/guardian/holds/{session_id}/ack`. Use `POST /api/v1/guardian/holds/{session_id}/freeze` for the simulated one-tap freeze. Both operations persist across restarts and retries. Original D records the delivery state at submission. The case dossier exposes subsequent acknowledgement and freeze state.

## Consented calibration

With local capture enabled, a session participant can explicitly authorize `POST /api/v1/calibration/sessions` with Contract A and `X-Calibration-Consent: granted`. Each accepted session is written with private file permissions under a hashed name derived from the session ID. A matching retry returns the same filename. Keep participant labels in a separate local manifest, with distinct train, enrollment, and evaluation sessions as described in [the ML guide](../ml/README.md).

## Checks

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -v
backend/.venv/bin/python scripts/validate_contracts.py
backend/.venv/bin/python -m unittest discover -s tests -v
```

`GET /health` reports process availability. `GET /ready` checks local storage and returns the configured identity mode. Dashboard initialization reports a null population map when the live identity service is unavailable.
