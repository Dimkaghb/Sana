# SANA Shield

Continuous behavioral identity and physical-interaction fraud detection for the BCC hackathon case.

Browser telemetry, deterministic physics/coercion signals, and a separate ML identity service produce a mobile transfer decision and analyst-dashboard evidence.

**Status:** Step 1 foundation only. Repository rules, shared schemas, synthetic fixtures, and validation tooling are available. No running SDK, API, frontend, or ML service exists yet.

## Start here

- [Repository rules and ownership](AGENTS.md)
- [Shared contracts and open decisions](CONTRACTS.md)
- [Person Two implementation steps](docs/IMPLEMENTATION_PLAN.md)
- [Architecture and handoffs](docs/ARCHITECTURE.md)
- [Original PRD](Markdown%20Live%20Preview.pdf)

## Structure

```text
frontend/src/components/   Person One: UI
frontend/src/mocks/        Person One: UI mock data
frontend/src/sdk/          Person Two: SDK and React adapter
backend/                  Person Two: API, detection, risk, realtime, storage
ml/                       Person Three: identity and vector service
contracts/schemas/        Shared Contracts A-D as JSON Schema
contracts/fixtures/       Synthetic integration examples
docs/                     Architecture and implementation plan
scripts/                  Validation utilities
tests/                    Shared contract checks
```

## Validate the foundation

Use Python 3.11 or newer from the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/validate_contracts.py
.venv/bin/python -m unittest discover -s tests -v
```

Only contract-tooling dependencies are introduced now. Runtime manifests and startup commands follow when implementation begins. Fixture scores and map points are synthetic examples, not measured performance; checks validate interfaces, not an unimplemented detector.
