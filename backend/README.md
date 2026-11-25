# Backend - Person Two

See `../docs/IMPLEMENTATION_PLAN.md`. No server exists yet.

Planned modules: `main.py`, `schemas.py`, `config.py`, `physics_engine.py`, `coercion_engine.py`, `risk_fusion.py`, `ml_client.py`, `websocket_manager.py`, `storage.py`, and `antifraud_export.py`.

Use FastAPI, an asynchronous HTTP client, NumPy, and SQLite. Access ML separately over HTTP on port 8001. Add runtime dependencies and startup commands in Step 2.

`tests/` is reserved for backend tests. Shared synthetic fixtures live in `../contracts/fixtures/`; real calibration recordings belong in ignored `data/` and require deliberate handling.
