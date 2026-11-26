# Product Requirements Document (PRD)
## **SANA Shield** — Continuous Behavioral Identity & Anti-RAT Physics Layer for BCC Bank
**Event:** V Regional ITU Hackathon-2026 (Fintech Case — Bank CenterCredit / BCC Bank)  
**Target Milestones:** Semifinal MVP (Nov 26) → Offline-Only Final / Demo Day (Dec 11)  
**Team Structure:** 3 Independent Tracks (Zero-Blocking Contract-First Architecture)

---

## 1. Executive Summary & Product Vision

### 1.1 The Problem
Banks like BCC verify identity at onboarding (KYC) and login (FaceID), but have **zero continuous signal** for *who* is physically operating an account during a session or *under what physical conditions*:
1. **Dropper Farms (Дропперство):** Students legitimately pass KYC/FaceID and sell account access to syndicates. One mule operator controls 20–40 unrelated accounts across rotated devices and IPs.
2. **Remote Access Trojans (AnyDesk / RustDesk / Bots):** Scammers trick victims into installing screen-control apps and click "Transfer" remotely.
3. **Phone Social Engineering (APP Fraud):** Victims hold their own phone while terrified by fake "National Bank / KNB" callers, entering dictated card numbers under acute stress.

### 1.2 The Solution
**SANA Shield** is a privacy-by-design behavioral & physical security layer embedded via a lightweight SDK into `bcc.kz`:
* **Continuous Behavioral Identity (Zero-PII):** Encodes each session's motor biomechanics (keystroke rhythms, tap offsets, slide-to-confirm trajectory, and 100Hz IMU grip tilt) into a **128-dimensional Behavioral Embedding (512 bytes)** stored in a Vector DB (`HNSW`). Detects **mid-life account handoffs**, **1-operator-to-many-accounts dropper rings**, and **banned operator re-entry**.
* **Newton’s 3rd Law Anti-RAT Physics (Zero History Needed):** Verifies that every touch event produces a physical Z-axis accelerometer micro-recoil within `±25ms`. Remote/synthetic clicks produce `0.00g` recoil and are caught instantly.
* **Coercion & Dictation Radar (Zero History Needed):** Detects phone-scam dictation bursts and `8–12 Hz` adrenaline hand tremors via gyroscope FFT.
* **Active Cyber-Deception ("Mirage Vault"):** Instead of showing a scary `"BLOCKED"` error (which alerts the scammer to move the victim to another bank/ATM), high-risk transfers seamlessly enter a calm shadow-escrow state (`"Interbank Clearing Verification..."`) while alerting BCC analysts and/or a trusted Guardian.

---

## 2. System Architecture & Strict Ownership Boundaries

To allow all **3 teammates to work 100% independently in parallel**, the system is split into **3 decoupled layers** communicating exclusively through the locked JSON contracts in Section 3.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  PERSON 1: DESIGN & UI ONLY (Figma + React/Next.js + Tailwind + Charts)      │
│  • Mobile PWA UI (bcc.kz Transfer Clone, Slide-to-Confirm, Mirage Screen)    │
│  • Desktop BCC Anti-Fraud Command Center (2D Population Map, Live Gauges)    │
│  • Uses typed Mock JSON props until final wiring (Zero backend/ML code!)     │
└───────────────────────────────▲───────────────────────────────▲──────────────┘
                                │ Props / WebSocket DTOs        │
┌───────────────────────────────┴───────────────────────────────┴──────────────┐
│  PERSON 2: SDK, PHYSICS ENGINE & REALTIME BACKEND (TS SDK + Python FastAPI)  │
│  • Headless Mobile Telemetry SDK (100Hz IMU, Touch, Keystroke — zero UI!)    │
│  • Physics Engine: Newton's 3rd Law Anti-RAT (0.00g) + Dictation/Tremor FFT  │
│  • FastAPI Orchestrator, WebSockets, Risk Fusion, AnyDesk Attack Simulator   │
│  • HTTPS Hosting (Vercel/Render/ngrok) + Anti-Fraud Center Dossier Export    │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ Strict HTTP JSON Contract (Port 8001)
┌───────────────────────────────────────▼──────────────────────────────────────┐
│  PERSON 3: ML & VECTOR IDENTITY MICROSERVICE (Python + PyTorch + Qdrant)     │
│  • Kinematic Feature Extractor (Raw Telemetry → 32+ Normalized Features)     │
│  • Temporal / Triplet-Loss Encoder (→ 128-dim L2-Normalized Embedding)       │
│  • Vector DB (Qdrant HNSW): EMA-Centroid (1:1 Handoff) + Ring Search (1:N)   │
│  • Parametric UMAP 2D Map Projector + Synthetic/Real Dataset & Metrics       │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. LOCKED SHARED DATA CONTRACTS (Single Source of Truth)

> **Rule:** Nobody changes field names without updating this contract in Git. Person 1 mocks Contracts C & D; Person 2 mocks Contract B; Person 3 tests against sample JSON files of Contract A.

### Contract A: `SessionTelemetryPayload` (Person 2 SDK → Person 2 Backend → Person 3 ML)
```json
{
  "session_id": "sess_9f82a1",
  "account_id": "acc_student_101",
  "device_meta": {
    "screen_w": 390,
    "screen_h": 844,
    "os": "iOS",
    "sample_rate_hz": 60
  },
  "started_at_ms": 1764100000000,
  "duration_ms": 14200,
  "keystrokes": [
    { "key_group": "digit", "down_ms": 1200, "up_ms": 1285, "dx_norm": 0.04, "dy_norm": -0.02 }
  ],
  "taps": [
    { "t_ms": 800, "x_norm": 0.52, "y_norm": 0.78, "radius_x": 14.2, "radius_y": 15.0, "is_trusted": true }
  ],
  "slider_trace": [
    { "t_ms": 13100, "x_norm": 0.12, "y_norm": 0.88, "pressure": 0.5 },
    { "t_ms": 13120, "x_norm": 0.19, "y_norm": 0.87, "pressure": 0.5 }
  ],
  "imu_samples": [
    { "t_ms": 790, "ax": 0.02, "ay": -0.11, "az": 9.81, "alpha": 12.1, "beta": 44.5, "gamma": -3.2 }
  ],
  "transfer_context": {
    "amount_kzt": 450000,
    "is_new_recipient": true
  }
}
```
*(Notice: Zero PII! No card digits, no phone numbers, no names—only `"key_group": "digit"` and relative timings/coordinates.)*

### Contract B: `MLScoreResponse` (Person 3 ML Service → Person 2 Backend)
`POST /ml/embed-and-score` accepts `SessionTelemetryPayload` and returns:
```json
{
  "session_id": "sess_9f82a1",
  "embedding_dim": 128,
  "embedding_preview": [0.142, -0.089, 0.311, 0.015],
  "owner_verification": {
    "cosine_similarity": 0.41,
    "is_handoff_detected": true,
    "baseline_sessions_count": 7
  },
  "operator_reconciliation": {
    "matched_operator_id": "op_mule_04",
    "match_confidence": 0.93,
    "is_banned_operator": false,
    "linked_account_ids": ["acc_student_101", "acc_victim_409", "acc_drop_772"],
    "ring_size": 3
  },
  "map_point": {
    "x": 4.82,
    "y": -2.14,
    "cluster_id": 4
  },
  "inference_ms": 11.4
}
```

### Contract C: `DashboardRealtimeEvent` (Person 2 Backend → Person 1 Dashboard UI via WebSocket)
```json
{
  "type": "SESSION_SCORED",
  "timestamp": "2026-11-26T14:22:01Z",
  "session_id": "sess_9f82a1",
  "account_id": "acc_student_101",
  "account_label": "Aibek K. (Student Card)",
  "decision": "MIRAGE_HOLD",
  "overall_risk_score": 94,
  "scores": {
    "anti_rat_physics_risk": 98,
    "coercion_stress_risk": 62,
    "operator_mismatch_risk": 91
  },
  "flags": [
    { "code": "ZERO_RECOIL_RAT", "severity": "CRITICAL", "title": "Synthetic Touch (0.00g Z-Recoil)", "detail": "Tap detected without physical IMU impulse — AnyDesk/RAT suspected" },
    { "code": "DROPPER_RING_MATCH", "severity": "CRITICAL", "title": "1 Operator → 3 Accounts", "detail": "93% behavioral match with Operator #04 (acc_victim_409, acc_drop_772)" }
  ],
  "recoil_waveform": [
    { "t_ms": -30, "az_delta": 0.01 },
    { "t_ms": 0, "az_delta": 0.00 },
    { "t_ms": 15, "az_delta": 0.01 }
  ],
  "map_point": { "x": 4.82, "y": -2.14, "cluster_id": 4, "operator_id": "op_mule_04", "status": "CRITICAL" }
}
```

### Contract D: `MobileTransferDecision` (Person 2 Backend → Person 1 Mobile UI)
```json
{
  "session_id": "sess_9f82a1",
  "ui_mode": "MIRAGE_HOLD",
  "display_title": "Межбанковская обработка",
  "display_subtitle": "Проверка реквизитов получателя (до 15 мин). Средства зарезервированы.",
  "reference_code": "BCC-88412-MRG",
  "guardian_notified": true
}
```
*(Allowed `ui_mode` values: `"SUCCESS"`, `"MIRAGE_HOLD"`, `"STEP_UP_LIVENESS"`.)*

---

# 👤 PERSON 1: Design & UI Engineer (Design & Frontend UI Only)

### Role Summary
You own the entire **visual identity, UX craft, mobile mock UI, desktop command center UI, and pitch visuals**. You do **NOT** write sensor collection logic, FastAPI endpoints, or ML code. You build gorgeous, ultra-responsive UI components powered by static/mock JSON matching Contracts C & D so Person 2 can plug in real data in 15 minutes.

### 1. Design System & Branding
* **Visual Identity:** Authentic **BCC Bank** aesthetic — deep fintech charcoal/slate for the Analyst Dashboard (`#0B1215` background, `#131F24` cards) paired with BCC signature Emerald Green (`#00A859`) for Safe states, Amber (`#F59E0B`) for Stress/Drift, Crimson (`#EF4444`) for Critical Fraud/RAT, and Calm Slate-Blue (`#3B82F6`) for Mirage Vault mode.
* **Mobile App Aesthetic:** Clean, light-mode clone of `bcc.kz` mobile transfer flow so judges immediately feel it's a native BCC feature.

### 2. Deliverable A: Mobile PWA Screens (`/mobile` — Pure UI Components)
Build modular React/Next.js + Tailwind components accepting clean props/callbacks:
1. **Sensor Activation Overlay (`SensorConsentModal.tsx`):**
   * Clean 1-button BCC splash: *"Включить защиту SANA Shield"* (calls `onRequestSensors()` prop — needed for iOS Safari IMU permission).
2. **Account Switcher Bar (`DemoAccountBar.tsx`):**
   * Subtle top pill for live demo switching between mock profiles: `Student Aibek (#101)`, `Victim Dana (#409)`, `Dropper Card (#772)`.
3. **Transfer Screen (`TransferForm.tsx`):**
   * Card balance header (`bcc.kz` Iron/Travel card visual).
   * Recipient phone/card input + custom clean numeric keypad (or native inputs with `data-kinetiq-field="recipient"` attributes for Person 2's SDK).
   * Amount input (KZT) + quick-amount chips (`50 000 ₸`, `250 000 ₸`, `1 000 000 ₸`).
   * **Custom "Slide to Confirm" Component (`BiometricSlider.tsx`):** Smooth draggable thumb (`"Потяните для перевода →"`) with animated progress fill and haptic-style visual feedback. Exposes `onSlideStart`, `onSlideMove(x, y)`, `onSlideComplete`.
4. **Post-Transfer Outcome Screens:**
   * **`SuccessReceipt.tsx`:** Standard green BCC receipt.
   * **`MirageVaultScreen.tsx` (The Cyber-Deception UX):** Looks 100% calm and official — animated subtle spinner, *"Межбанковская проверка реквизитов..."*, fake reference code, zero mention of "fraud" or "blocked" so a watching scammer doesn't panic.
   * **`RecipientLivenessModal.tsx` (Stretch for Dec 11 Final):** Mock screen showing the Dropper's phone receiving *"Подтвердите личность получателя (FaceID)"* with a simulated camera frame & "Fail / Pass" demo toggle.

### 3. Deliverable B: BCC Anti-Fraud Command Center (`/dashboard` — Projector-Ready!)
Design this specifically to look **mind-blowing on a 1920×1080 offline stage projector**:
1. **Top KPI Strip:** Active Monitored Sessions, Prevented Loss (KZT), Active Dropper Rings Detected, Avg Inference Latency (`11.4 ms`).
2. **Centerpiece — Interactive 2D Behavioral Population Map (`PopulationMap.tsx`):**
   * Built with **Plotly.js / Recharts / ECharts / Canvas**.
   * Renders background clusters (soft translucent halos per human operator), individual session dots colored by status (Green = Normal, Amber = Stress Drift, Red = Handoff/RAT/Dropper).
   * **Animated Live Dot Drop:** When a new WebSocket event arrives, the new dot pulses/ripples onto the map!
   * **Interactive Cluster Inspection:** Clicking any red dot or cluster opens the **Operator Dossier Drawer** showing:
     * Linked Account IDs controlled by this 1 human (`acc_101`, `acc_409`, `acc_772`).
     * Similarity % badge (`93% Behavioral Match`).
     * **`[Забанить оператора навсегда]`** button (`onBanOperator(opId)`).
     * **`[Отправить досье в Антифрод-центр НБ РК]`** button (opens formatted preview modal of official report!).
3. **Right Panel — Live Physics & Coercion Telemetry (`TelemetryPanel.tsx`):**
   * **Newton's 3rd Law Recoil Oscilloscope:** Real-time mini line chart comparing a normal human tap spike (`+0.85g`) vs. a flat-line synthetic RAT click (`0.00g` flashing red!).
   * **3 Risk Gauges:**
     1. *Anti-RAT Physics* (Recoil Integrity)
     2. *Cognitive Stress / Dictation* (Tremor + Cadence)
     3. *Behavioral Operator Match* (128D Embedding Similarity)
   * **Live Alert Feed:** Scrolling cards for `ZERO_RECOIL_RAT`, `ACCOUNT_HANDOFF`, `DROPPER_RING_MATCH`, `DICTATION_COERCION`.
4. **Demo Director Toolbar (`DemoControls.tsx`):**
   * Subtle bottom bar for the presenter:
     * `⚡ Simulate AnyDesk Attack` (triggers `onTriggerRatAttack()`)
     * `🛡️ Guardian Alert Preview` (shows slide-in mock push notification sent to victim's family member with `[Заморозить перевод]` button)
     * `🔄 Reset Demo`

### 4. Deliverable C: Pitch Deck & Architecture Visuals
* 8–10 crisp slides (Figma/Canva) for Nov 26 Semifinal & Dec 11 Final: Problem (KZ 2026 Dropper + APP stats), Architecture Diagram (`100Hz IMU → Temporal Encoder → 128D Vector → Qdrant HNSW + Anti-RAT Physics`), Live Demo transition slide, Business Impact for BCC (`bcc.kz`, `JuniorBank`, `bcc business`, `antifraud.kz`).

### Person 1 Definition of Done (DoD)
* [ ] All Mobile & Dashboard views render cleanly with realistic mock data (`mockData.ts`) without any backend running.
* [ ] Mobile PWA fits cleanly on iPhone (390×844) and Android without scroll jank.
* [ ] Dashboard is readable from 15 meters away on a projector (large fonts, high contrast).
* [ ] All interactive callbacks match Contracts C & D.

---

# 👤 PERSON 2: Telemetry SDK, Physics Engine & Realtime Backend Engineer

### Role Summary
You own **the headless browser telemetry SDK, the deterministic Physics Anti-Fraud Engine (Anti-RAT + Stress/Dictation), the FastAPI Orchestration Backend, WebSockets, Risk Fusion, and HTTPS Deployment**. You do **NOT** design UI components or train ML models. You talk to Person 3's ML service over a single HTTP call (using a stub until Person 3 is ready).

### 1. Deliverable A: Headless Zero-PII Mobile SDK (`sdk/kinetiq-sdk.ts`)
A pure TypeScript class (`new KinetiqSDK(config)`) that Person 1 mounts via a single React hook (`useKinetiqSDK()`):
1. **Sensor Permission & Lifecycle Manager:**
   * Handles iOS 13+ `DeviceMotionEvent.requestPermission()` & `DeviceOrientationEvent.requestPermission()` safely; gracefully falls back on Android/desktop.
   * Ring buffer keeping last 20 seconds of IMU samples (`ax, ay, az` linear acceleration + `alpha, beta, gamma` orientation) at max browser frequency (`~60–100 Hz`).
2. **Zero-PII Event Collectors:**
   * **Keystroke Collector:** Attaches to inputs marked `data-kinetiq-field`. Records `down_ms`, `up_ms`, and normalized tap offset `(dx_norm, dy_norm)` — **strictly strips actual character values**, tagging only `"digit"` or `"backspace"`.
   * **Tap Collector:** Captures every `pointerdown` (`t_ms`, normalized `x/W, y/H`, `width/height` contact radius, and native `event.isTrusted`).
   * **Slider Collector:** Captures continuous `pointermove` trace at ~60Hz during `BiometricSlider` drag.
3. **Remote Attack Receiver (For Live Stage Demo!):**
   * Listens on phone WebSocket `/ws/mobile/{session_id}` for `{"cmd": "INJECT_RAT_CLICK"}`.
   * When triggered from the presenter's laptop, programmatically dispatches a synthetic click/slide completion on the mobile DOM **without human touch** — naturally producing **`0.00g` IMU recoil** and triggering your real Physics Engine!
4. **Payload Serializer:**
   * Exports exact **Contract A (`SessionTelemetryPayload`)** JSON to `POST /api/v1/sessions/ingest`.

### 2. Deliverable B: Physics & Coercion Engine (`backend/physics_engine.py`)
100% deterministic, zero-cold-start signal processing (works on the very first transfer with 0 user history!):
1. **Newton's 3rd Law Anti-RAT Detector (`analyze_tap_recoil`):**
   * For each recorded tap at timestamp `t_tap`:
     * Slice IMU samples in window `[t_tap - 40ms, t_tap + 40ms]`.
     * Compute baseline gravity-removed Z-acceleration (`az_baseline` from `[t_tap - 40ms, t_tap - 15ms]`) and impact peak (`max(|az - az_baseline|)` in `[t_tap - 5ms, t_tap + 35ms]`).
     * Also inspect `is_trusted`, touch contact radius variance (`radius_x == 0` on synthetic clicks), and slider velocity uniformity (constant `dv/dt` = bot).
   * **Output:** `anti_rat_physics_risk` (0–100), extracted `recoil_waveform` array for Person 1's oscilloscope chart, and `ZERO_RECOIL_RAT` flag if peak recoil `< 0.08 m/s²` (tunable config!).
2. **Dictation Cadence & Tremor Analyzer (`analyze_coercion`):**
   * **Dictation Rhythm:** Compute inter-keystroke intervals (`IKI`) across digit entries. Detect "burst-pause-burst" pattern (e.g., 2–4 rapid digits `< 300ms` followed by `> 900ms` listening pause repeated ≥ 2 times) → high dictation score!
   * **Adrenaline Tremor FFT:** Run `numpy.fft.rfft` on IMU accelerometer/gyroscope magnitude during the session; measure spectral power ratio in the **8–12 Hz physiological tremor band**.
   * **Posture Anomaly:** Detect frequent rapid pitch flips (`beta` swinging between `~45°` reading and `~85°` ear/call posture).
   * **Output:** `coercion_stress_risk` (0–100) + `DICTATION_COERCION` / `HAND_TREMOR` flags.

### 3. Deliverable C: FastAPI Orchestrator, Risk Fusion & APIs (`backend/main.py`)
1. **Endpoints:**
   * `POST /api/v1/sessions/ingest` — Validates Contract A → runs `physics_engine` → calls Person 3 (`POST {ML_URL}/ml/embed-and-score` with 1.5s timeout + graceful fallback) → runs Risk Fusion → saves to SQLite → broadcasts **Contract C** to `/ws/dashboard` → returns **Contract D** to Mobile PWA.
   * `GET /api/v1/dashboard/init` — Proxies initial population map from Person 3 (`GET {ML_URL}/ml/population-map`) + recent alerts & KPIs from SQLite.
   * `POST /api/v1/demo/inject-rat-click` — Sends WebSocket command to active mobile session to simulate an AnyDesk click.
   * `POST /api/v1/operators/{operator_id}/ban` — Forwards ban to Person 3 + updates DB + broadcasts updated map state.
   * `GET /api/v1/cases/{session_id}/export-antifraud` — Generates structured JSON incident dossier formatted for Kazakhstan's **National Anti-Fraud Center (`antifraud.kz`)** (anonymized operator vector hash, linked accounts, physics evidence, timestamps).
   * `WS /ws/dashboard` and `WS /ws/mobile/{session_id}`.
2. **Risk Fusion Matrix (`backend/risk_fusion.py`):**
   * `MIRAGE_HOLD` triggered if:
     * `anti_rat_physics_risk >= 75`, OR
     * `is_banned_operator == true`, OR
     * `is_handoff_detected == true AND amount_kzt >= 100_000`, OR
     * `ring_size >= 2 AND match_confidence >= 0.80`, OR
     * `coercion_stress_risk >= 75 AND is_new_recipient == true`.
   * `STEP_UP_LIVENESS` triggered for medium-risk gray zone (`overall_risk_score` 50–74).
   * `SUCCESS` otherwise (`< 50`).
3. **Deployment & HTTPS Infrastructure:**
   * **CRITICAL:** iOS/Android browsers **silently disable** `DeviceMotionEvent` on plain HTTP!
   * Deploy frontend + backend behind **HTTPS** (e.g., Vercel for Next.js + Railway/Render/Cloudflare Tunnel/ngrok with `wss://` for FastAPI) by Day 1 so phone sensors can be tested on real devices immediately.

### Person 2 Definition of Done (DoD)
* [ ] Real iPhone + Android phone successfully streams 60–100Hz IMU + touch + slider JSON over HTTPS to FastAPI.
* [ ] Real finger tap registers measurable Z-axis recoil spike (`> 0.3 m/s²`), while `inject-rat-click` registers `0.00g` and triggers `MIRAGE_HOLD` in `< 200ms`.
* [ ] Dictated digit typing reliably triggers `DICTATION_COERCION`.
* [ ] Works end-to-end with a mock ML stub, and switches cleanly to Person 3's live URL via `.env` (`ML_SERVICE_URL`).

---

# 👤 PERSON 3: ML & Vector Identity Engineer (Embeddings, Vector DB & Population Map)

### Role Summary
You own the **entire Behavioral Intelligence Engine**: turning raw movement JSON into **128-dim Zero-PII Behavioral Embeddings**, matching operators in a **Vector Database (Qdrant HNSW)**, projecting the **2D Population Map (UMAP)**, generating synthetic + real calibration datasets, and producing scientific accuracy metrics for the judges. You work 100% in Python and never touch frontend code or browser sensors.

### 1. Deliverable A: Kinematic Feature Engineering Pipeline (`ml/features.py`)
Transforms **Contract A (`SessionTelemetryPayload`)** into a clean, device-invariant **36-dimensional statistical kinematic vector** + resampled temporal sequences:
1. **Keystroke Dynamics (10 features):**
   * `dwell_mean`, `dwell_std`, `dwell_p90` (how long finger stays on key).
   * `iki_mean`, `iki_std`, `iki_iqr`, `iki_skew` (flight time rhythm).
   * `backspace_ratio`, `key_dx_mean`, `key_dy_mean` (anatomical thumb aim bias).
2. **Touch & Slider Trajectory Physics (12 features):**
   * Screen-normalized slider velocity (`v_mean`, `v_max`, `v_std`), peak acceleration, jerk (`da/dt`), time-to-peak-velocity ratio (front-loaded vs. back-loaded swipe style).
   * **Thumb Arc Curvature:** Mean & max perpendicular deviation `y_dev` from a straight line (right-handed vs. left-handed vs. two-handed signature!).
   * Tap contact geometry (`radius_x_mean`, `radius_y_mean`, `aspect_ratio`, tap duration).
3. **IMU Grip & Biomechanics (14 features):**
   * Grip posture: `beta_mean`, `beta_std` (pitch angle), `gamma_mean`, `gamma_std` (roll tilt — left vs. right hand!).
   * **Dynamic Tilt Coupling:** Correlation between `x_norm` tap position and `gamma` roll shift (proves which hand is holding the phone!).
   * Tap recoil profile: `recoil_peak_mean`, `recoil_peak_std`, `recoil_decay_ms`.
   * Micro-tremor spectral energy (`0–4 Hz`, `4–8 Hz`, `8–12 Hz` bands).
* **Robustness:** Must handle missing/partial fields cleanly (e.g., if a desktop browser sends empty `imu_samples`, impute gracefully and lower confidence rather than crashing!).

### 2. Deliverable B: 128-Dim Behavioral Embedding Encoder (`ml/encoder.py`)
* **Architecture (PyTorch):**
  * **Hybrid Temporal + Kinematic Metric Encoder:**
    * Branch 1: Lightweight `1D-CNN` over resampled fixed-length `(slider_trace + imu_window)` sequence `[T=64, C=6]`.
    * Branch 2: 2-layer Residual MLP (`36 → 128 → 128`) with LayerNorm + SiLU + Dropout over statistical kinematic features.
    * Fusion Head → `Linear(256 → 128)` → **L2 Normalization** (`||e||₂ = 1.0`, 128 floats = **512 bytes**).
* **Training Objective:** **Batch-Hard Triplet Margin Loss** (or **Cosine ArcFace / SupConLoss**):
  * Pulls sessions from the *same human* (even across different `account_id`s and simulated device sizes!) close together on the unit hypersphere (`cosine_sim > 0.85`).
  * Pushes *different humans* apart (`cosine_sim < 0.45`).
* **Smart Hackathon Safeguard:** Include a `StandardScaler + Weighted Cosine` fallback mode or joint training with strong Gaussian noise augmentation (simulating walking/sitting/new phone screen sizes) so live stage tests with 10–15 real humans never overfit or collapse!

### 3. Deliverable C: Vector DB & Operator Reconciliation Engine (`ml/vector_store.py`)
Powered by **Qdrant** (in-memory `QdrantClient(":memory:")` with persistence snapshot to disk — zero Docker friction on Demo Day, instant HNSW cosine search!):
1. **Collection 1 — `account_centroids` (1-to-1 Owner Verification / Handoff Detection):**
   * Stores each `account_id`'s **EMA-Centroid** (`c_new = 0.8 * c_old + 0.2 * e_session`, re-normalized) and `session_count`.
   * On new session: computes `cosine_similarity(e_session, c_account)`.
   * If `session_count >= 3` and `cosine_similarity < 0.68` → flags `is_handoff_detected = true` (**Mid-Life Account Sale / ATO!**).
   * *(Only updates EMA-Centroid when session is verified safe so fraudsters can't poison the owner's baseline!)*
2. **Collection 2 — `global_sessions` (1-to-N Dropper Ring Discovery):**
   * Runs `HNSW ANN` top-K search (`K=10`, `score_threshold=0.80`) across all sessions.
   * Collects distinct `account_id`s belonging to the top matching cluster.
   * If `len(linked_account_ids) >= 2` → identifies **Multi-Account Operator (`op_mule_XX`)** and returns `ring_size` + `linked_account_ids`!
   * Runs periodic/on-demand `HDBSCAN` clustering to assign clean `cluster_id`s for the Population Map.
3. **Collection 3 — `banned_operators` (Lifetime Operator Ban):**
   * When `POST /ml/operators/{id}/ban` is called, stores the operator's centroid vector in `banned_operators`.
   * Every future session (even on a brand-new account!) checks `banned_operators` first → if `cosine_sim > 0.80`, sets `is_banned_operator = true`!

### 4. Deliverable D: Parametric 2D Population Map Projector (`ml/map_projector.py`)
* Fits **`umap.UMAP(n_components=2, metric="cosine", random_state=42)`** on the initial population embeddings.
* Uses `umap_model.transform(new_embedding)` for every live session so **new dots appear in `< 30ms` at the exact right location without re-scrambling the whole map!**
* Exposes `GET /ml/population-map` returning all historical + live points `(x, y, account_id, operator_id, cluster_id, status)` + cluster centroid metadata.

### 5. Deliverable E: Dataset Bootstrap, Live Calibration & ML Benchmarks (`ml/train.py`, `ml/eval.py`)
1. **Synthetic Population Seed (`ml/seed_population.py`):**
   * Generates **150 realistic synthetic sessions** across:
     * 15 distinct "Normal BCC Clients" (clean, separate tight clusters).
     * 2 hidden "Dropper Rings" (e.g., Operator #04 operating 4 different account IDs from different simulated phones — landing in ONE dense cluster!).
     * 1 "Previously Banned Operator".
   * Gives the dashboard an instantly impressive, realistic Population Map on boot!
2. **Real Human Calibration Script (`ml/calibrate_team.py`):**
   * Ingests 5–8 real recorded sessions per person from your team + 5–10 friends (saved as JSON via Person 2's endpoint).
   * Fine-tunes the encoder + refits UMAP in `< 30 seconds` so your **live stage demo runs on 100% real human biomechanics**!
3. **Evaluation Metrics Report (`ml/eval.py`):**
   * Computes **ROC-AUC**, **Equal Error Rate (EER %)**, **Cross-Account Operator Recall@1**, and **p95 Inference Latency (ms)** — print these exact real numbers on your Pitch Deck!

### 6. Deliverable F: Standalone ML FastAPI Service (`ml/app.py` on port `8001`)
* `POST /ml/embed-and-score` → Contract A in, Contract B out.
* `GET /ml/population-map` → Returns full 2D map JSON for dashboard init.
* `POST /ml/operators/{operator_id}/ban` → Adds operator centroid to `banned_operators`.
* `POST /ml/retrain` → Reloads collected sessions, retrains encoder & UMAP, updates Qdrant.

### Person 3 Definition of Done (DoD)
* [ ] Standalone FastAPI server starts cleanly with `uvicorn ml.app:app --port 8001` and loads seeded Qdrant + trained PyTorch weights + fitted UMAP.
* [ ] Unit test passing 20 sample Contract A JSONs returns valid Contract B in `< 30 ms` per request.
* [ ] Two sessions from the same real teammate (even under different `account_id`s) achieve `cosine_sim > 0.80` and land visually inside the same 2D UMAP cluster.
* [ ] Different teammates achieve `cosine_sim < 0.55` and trigger `is_handoff_detected = true` when swapping phones on the same account.

---

## 4. Integration & Execution Timeline

### Phase 1: Semifinal Sprint (Immediate — Working End-to-End MVP)
| Block | Person 1 (Design & UI) | Person 2 (SDK, Physics & Backend) | Person 3 (ML & Vector Map) |
| :--- | :--- | :--- | :--- |
| **Hours 0–3** | Build `TransferForm` + `BiometricSlider` + `MirageVaultScreen` with mock state | Build `kinetiq-sdk.ts` + deploy HTTPS FastAPI + verify real phone IMU stream | Build `features.py` + `seed_population.py` (150 synthetic sessions + sample Contract A files) |
| **Hours 3–7** | Build Desktop Dashboard (`PopulationMap` Plotly + `TelemetryPanel` recoil chart + `DemoControls`) | Build `physics_engine.py` (Anti-RAT `0.00g` + Dictation FFT) + WebSocket Hub + `inject-rat-click` | Train Triplet Encoder (`encoder.py`) + Qdrant HNSW (`vector_store.py`) + UMAP (`map_projector.py`) + `ml/app.py` |
| **Hours 7–10** | **INTEGRATION:** Connect Person 1's components to Person 2's SDK hook & WebSocket; connect Person 2's backend to Person 3's ML port `8001`. | Collect 5 real sessions × 4 people → Person 3 runs `calibrate_team.py`! | Verify live clusters + record 60-sec backup demo video. |
| **Hours 10–12** | Finalize 8-slide Semifinal Deck + rehearse 3-minute live pitch! | Stress-test HTTPS + Wi-Fi hotspot fallback. | Export real ROC-AUC / EER / latency slide metrics. |

### Phase 2: Polish for Offline-Only Final / Demo Day (Nov 27 – Dec 11)
Once past the Semifinal, each track upgrades independently for a jaw-dropping live stage show:
* **Person 1:** Add **Guardian Mobile Push View** (second phone buzzes on Mirage Hold), **Asymmetric Recipient FaceID Liveness UI**, and cinematic dark-mode animations for the projector.
* **Person 2:** Add **live Guardian WebSocket flow** (real 1-tap freeze from Phone #2), refine `8–12 Hz` tremor calibration on real pacing/stress tests, and harden offline-resilient local LAN fallback (in case venue Wi-Fi drops during Demo Day!).
* **Person 3:** Collect real telemetry from **20–30 students/friends** across iOS & Android to boost cross-device generalization; upgrade Branch 1 to a full **1D-CNN + Temporal Attention Encoder**; add optional **rPPG heart-rate stress module** on liveness frames.

---

## 5. Offline Demo Day Live Script (3-Minute Judge-Slayer Runbook)

1. **Act 1 — Normal Baseline (20 sec):** Teammate A holds Phone #1 (`Student Aibek #101`), enters a normal transfer, drags the slider → Recoil chart shows crisp human tap spikes (`+0.75g`), green dot lands smoothly inside **Aibek's Cluster** → `SUCCESS`.
2. **Act 2 — Newton’s 3rd Law Anti-RAT Attack (30 sec):** Presenter clicks **`⚡ Simulate AnyDesk Attack`** on laptop → Phone #1 submits remotely without anyone touching it → Projector flashes **`CRITICAL: 0.00g PHYSICAL RECOIL — REMOTE ACCESS DETECTED`** → Phone #1 silently shifts into calm **Mirage Vault Mode** (scammer stays fooled while funds stay safe!).
3. **Act 3 — Dropper Handoff & Multi-Account Reconciliation (45 sec):**
   * Teammate A hands Phone #1 (`#101`) to **Teammate B ("Mule Operator")**. Teammate B types & slides → Red dot leaps across the 2D Population Map (**`ACCOUNT HANDOFF DETECTED`**).
   * Teammate B picks up **Phone #2** logged into a totally different account (`Victim Dana #409`) → Live dot drops **right on top of Teammate B's previous session!** Dashboard alerts: **`DROPPER RING EXPOSED: 1 Operator Controlling Multiple Accounts (93% Match)`**.
   * Presenter clicks **`[Ban Operator]`** + **`[Export to National Anti-Fraud Center]`** → Done. Mic drop.

---

## 6. Suggested Git Monorepo Structure (Zero Merge Conflicts!)
```text
sana-shield/
├── CONTRACTS.md                # Locked JSON schemas (Section 3)
├── frontend/                   # 👤 PERSON 1 owns /components, /styles, /pages
│   ├── src/components/         # Pure UI components (Person 1)
│   ├── src/mocks/              # Typed mock JSONs (Person 1)
│   └── src/sdk/                # 👤 PERSON 2 owns ONLY this folder in frontend!
│       ├── kinetiq-sdk.ts      # Headless sensor/touch collector
│       └── useKinetiq.ts       # React hook binding SDK + WebSocket to UI
├── backend/                    # 👤 PERSON 2 owns entire directory
│   ├── main.py                 # FastAPI + WebSockets + Risk Fusion
│   ├── physics_engine.py       # Newton's 3rd Law Anti-RAT + Dictation/Tremor FFT
│   └── antifraud_export.py     # NBK Anti-Fraud Center JSON dossier builder
└── ml/                         # 👤 PERSON 3 owns entire directory
    ├── app.py                  # Standalone ML FastAPI (port 8001)
    ├── features.py             # 36+ kinematic features & sequence resampler
    ├── encoder.py              # PyTorch 1D-CNN + Triplet-Loss 128D Encoder
    ├── vector_store.py         # Qdrant HNSW + EMA-Centroid + HDBSCAN
    ├── map_projector.py        # Parametric UMAP (128D → 2D)
    ├── seed_population.py      # Synthetic 150-session dataset generator
    └── train_and_eval.py       # Calibration + ROC-AUC / EER metrics
```

*Need starter code for any specific track right now (e.g., Person 2's `kinetiq-sdk.ts` + `physics_engine.py`, or Person 3's `encoder.py` + `vector_store.py`)? Just tell me which person to generate first.*