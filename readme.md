# SANA Shield

A simulated BCC transfer app, analyst dashboard, and Guardian view backed by physical-interaction checks and a separate behavioral identity service.

## Run locally

Use Python 3.12 for the backend and ML environments. From the repository root:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
ML_MODE=mock .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open the local Vite URL at `/mobile`, `/dashboard`, or `/guardian`. The eight-slide offline presentation is at `/pitch.html`. Use the arrow keys to advance. Development paths proxy to the local backend. Mock mode labels its synthetic identity evidence. Real phone sensors require a trusted HTTPS origin.

For live scoring, prepare the seed, model, and local identity service using the [ML instructions](ml/README.md). Start the backend with `ML_MODE=live` and `ML_SERVICE_URL=http://127.0.0.1:8001`. Use the [backend instructions](backend/README.md) to configure scoped demo credentials and SQLite, and the [offline runbook](docs/OFFLINE_REHEARSAL.md) for a single HTTPS origin on the LAN.

## Verify

```sh
.venv/bin/python scripts/validate_contracts.py
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m scripts.check_demo
```

The last command starts an isolated mock-mode service, uses HTTP and WebSocket clients, checks the seven scenarios, and restarts the service against its temporary database. Component-specific checks are in the [frontend](frontend/README.md), [backend](backend/README.md), and [ML](ml/README.md) guides.

## Project references

- [Product execution plan and verification record](docs/PRODUCT_EXECUTION_PLAN.md)
- [Contract schemas and semantics](CONTRACTS.md)
- [Architecture and handoffs](docs/ARCHITECTURE.md)
- [SDK and backend implementation milestones](docs/IMPLEMENTATION_PLAN.md)
- [Repository rules](AGENTS.md) and [original PRD](Markdown%20Live%20Preview.pdf)
