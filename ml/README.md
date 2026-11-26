# Behavioral identity service

The backend sends Contract A to a private FastAPI process on port 8001 and receives Contract B. The service trains a PyTorch encoder, measures behavioral similarity, projects sessions on a fitted UMAP, and persists pseudonymous embeddings in Qdrant. The default model trains on generated examples. Real-device calibration requires consented recordings.

## Run from the repository root

Prepare dependencies on the offline demo machine while connected. The uv lock covers Python 3.11–3.12 on Apple Silicon macOS and x86-64 Linux with CPU PyTorch.

```sh
uv sync --project ml --locked --python 3.12
ml/.venv/bin/python -m ml.train --output ml/artifacts/synthetic-v2
ml/.venv/bin/python -m uvicorn ml.app:app --host 127.0.0.1 --port 8001 --workers 1
```

Version 2 also encodes up to 64 overlapping time windows. A separate temporal convolution receives six normalized signals and six presence indicators per window. Only windows with observations contribute to its pooling. The encoder fuses this representation with the original temporal and static features. The score, centroid and projection use the same 128-dimensional space for a given generation.

Training creates a new directory. Reuse an existing model by skipping the training command. The default service trains a missing default generation during first startup. It loads the local model, warms up UMAP, and seeds 150 synthetic sessions before answering `GET /health`. Prepare and start the service once before the offline rehearsal. Set the backend to live ML with this loopback service. Keep Python dependencies, `ml/artifacts/`, and `ml/data/` on the demo machine.

| Setting | Purpose |
| --- | --- |
| `ML_MODEL_DIR` | Local generation containing trained weights, the fitted projector, and its checksum manifest. Load only artifacts generated or obtained from a trusted source. |
| `ML_DATA_DIR` | Embedded Qdrant storage and active generation pointer. Defaults to `ml/data/identity`. Use a fresh directory to start a clean rehearsal while preserving existing sessions. |
| `ML_SEED_POPULATION` | Set to `0` to skip inserting synthetic sessions into a new index. Synthetic and live sessions have isolated identity searches. Map points include a `synthetic` boolean. |
| `ML_ADMIN_TOKEN` | Runtime server credential protecting enrollment, ban, fingerprint, and model rotation. An empty value disables these routes. Configure the same credential on the backend. |
| `ML_CALIBRATION_MANIFEST` | Path to the local participant manifest used by the authenticated retrain route. |
| `ML_QDRANT_URL`, `ML_QDRANT_API_KEY` | Optional Qdrant server connection. This uses model-generation-specific collection names and HNSW configuration. Embedded local mode uses exact cosine search. Use one ML writer in either mode. |

## Inference and evidence

The 36 statistics include key dwell and inter-key cadence, touch radii and aspect ratio, slider velocity and signed curvature, grip orientation, recoil, and accelerometer band power. Slider duration is available through Contract A. New SDK recordings also contain paired contact durations and field categories. Older SDK recordings omit this stream. The six temporal channels are relative slider x and y, acceleration x, y and z, and roll. They share 64 sampling positions over the slider interval or available IMU interval. Interpolation stays within bounded gaps. Train-set centering imputes missing values solely inside the encoder.

At least two usable behavioral streams are required. Transfer amount and account identifiers do not enter the encoder. Session scoring calls a one-dimensional convolutional network and residual MLP trained with batch-hard triplet loss. Their fused output is a 128-component, L2-normalized float32 vector. HDBSCAN labels the fitted UMAP seed projection. Existing coordinates stay fixed during session scoring. A new point inherits its nearest training cluster only at cosine similarity of at least 0.80, otherwise its cluster is -1.

| Route | Behavior |
| --- | --- |
| `POST /ml/embed-and-score` | Accept Contract A and return B. Inadequate evidence or invalid telemetry returns HTTP 422. An identical session retry returns its originally stored B. Changed data under an existing ID returns 409. A new operator has a provisional ID and null match confidence. A cold account has null owner similarity. |
| `GET /ml/population-page?cursor=…` | Qdrant scroll page with up to 250 sessions, page cluster centroids and the next cursor. Omit the cursor for the first page. |
| `GET /ml/population-map` | Returns `points` with session, account, operator, coordinates, cluster, status, and synthetic marker plus `clusters` with centroid and size. These are ML observations. The backend owns transfer decisions. |
| `POST /ml/sessions/{session_id}/enroll` | Bearer-protected operator attestation that the scored session belongs to the independently verified account owner. Updates its normalized 0.8/0.2 EMA once. Three enrolled sessions enable the handoff rule. Scoring alone never enrolls a session. New enrollment returns 409 for a historical handoff or qualifying ring match, a banned operator, or a matching current ban centroid. An already-approved enrollment retry returns the existing count. |
| `POST /ml/operators/{operator_id}/ban` | Bearer-protected, idempotent ban. Saves the operator centroid for subsequent cross-account checks. Returns the operator ID and confirmed status. |
| `GET /ml/sessions/{session_id}/fingerprint` | Bearer-protected SHA-256 of the full stored session embedding in little-endian float32 order. The original case fingerprint survives model rotation. |
| `POST /ml/retrain` | Bearer-protected calibration, index rebuild, and atomic generation switch. Requires the consented source recording for each existing live embedding to re-embed it. Missing recordings preserve the active generation and return 409. Historical B responses, enrollment order, case fingerprints, and bans survive a successful switch. |

The service searches the banned set first, then the ten closest global session vectors with cosine similarity of at least 0.80. Operator membership carries distinct linked accounts. Match confidence is a similarity score. Re-entry checks compare a session against the saved banned centroid. The PRD thresholds are demo settings requiring human calibration.

## Calibration and evaluation

Keep participant mappings and recordings under ignored local data directories. Use the backend’s opt-in capture. In the same local folder place a JSON array describing the operator label and session split, for example:

```json
[
  {"file":"<capture-hash-a>.json","operator_id":"participant_01","split":"train"},
  {"file":"<capture-hash-b>.json","operator_id":"participant_01","split":"enroll"},
  {"file":"<capture-hash-c>.json","operator_id":"participant_01","split":"eval"}
]
```

Supply at least two operators with two training sessions each and at least five total training sessions. Keep enrollment and evaluation recordings disjoint from training, including each other. Include cross-account sessions when measuring operator recall across accounts. Use a participant-disjoint dataset as an additional test of generalization. The evaluation enrollment split is a gallery for metric calculation. Production-like owner enrollment in the running demo requires a separate verified enrollment action.

```sh
ml/.venv/bin/python -m ml.calibrate_team ml/data/consented/manifest.json --output ml/artifacts/team-v1
ml/.venv/bin/python -m ml.eval --model ml/artifacts/team-v1 --manifest ml/data/consented/manifest.json
ml/.venv/bin/python -m unittest discover -s ml/tests -v
```

The baseline uses mean temporal pooling. Train the optional temporal-attention model with the same training sessions and seed, then compare the two on the same held-out sessions.

```sh
ml/.venv/bin/python -m ml.train --attention --output ml/artifacts/attention-v2
ml/.venv/bin/python -m ml.eval --model ml/artifacts/synthetic-v2
ml/.venv/bin/python -m ml.eval --model ml/artifacts/attention-v2
```

### Windowed encoder verification

With version 2, the session-disjoint synthetic evaluation used 18 gallery sessions and 18 queries. The run returned ROC-AUC 0.99964, approximate EER 0.33%, and two correct cross-account matches out of two eligible queries. These measurements describe generated profiles. Real-device false matches and generalization require separate participant data.

### Earlier version 1 synthetic rehearsal measurements

Both models trained on 108 generated sessions from 18 simulated operators. A different session per operator formed the enrollment gallery and another session per operator formed the queries, giving 324 pairs. Two queries had a cross-account gallery match. This evaluates held-out sessions from the same synthetic profiles.

| Warm local run | Baseline | Attention |
| --- | ---: | ---: |
| ROC-AUC | 0.99964 | 0.99982 |
| Approximate empirical EER | 0.16% | 0.16% |
| Cross-account recall@1 | 2/2 | 2/2 |
| Feature extraction and encoder p95 | 1.37 ms | 1.12 ms |

With the baseline service on localhost, 20 fresh synthetic HTTP submissions returned schema-valid B. Warm ML compute p95 was 5.67 ms and full ML HTTP p95 was 17.03 ms on the development machine. The seeded map contained 150 points, 18 density clusters and two inferred four-account rings. The version 1 comparison predates the additional window encoder.

### Qdrant server rehearsal

The native Qdrant 1.20.2 Apple Silicon server was exercised on loopback with telemetry disabled, using the same service routes and model. With the default optimizer threshold of 10,000 KiB, the seeded global collection reported 150 points and zero indexed vectors. At that size it used exact vector search. Enrollment, retry, cross-account match, ban, re-entry, and fingerprint export all passed against the server.

A separate check lowered the optimizer and full-scan thresholds to 10 KiB on the disposable global collection. Qdrant then reported 155 indexed vectors for 155 points. Vector queries and a subsequent ML scoring request succeeded with the HNSW index present. The server selects the search strategy per query and filter. The application keeps the server's default thresholds.
