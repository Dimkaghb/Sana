"""Internal single-worker identity service. Bind to loopback behind the backend."""
import os
# UMAP and the encoder are small single-session inference workloads.
os.environ.setdefault("NUMBA_NUM_THREADS","1")

from contextlib import asynccontextmanager
import hmac
import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from qdrant_client import QdrantClient
from starlette.concurrency import run_in_threadpool
import torch

from scripts.validate_contracts import unique_object, reject_constant, validate_payload, validators
from .calibrate_team import calibrate
from .features import InsufficientEvidence
from .seed_population import population
from .train import fit, load, synthetic_training
from .vector_store import Conflict, IdentityStore, where

BASE = Path(__file__).resolve().parent
MAX_BYTES = 2 * 1024 * 1024
LIMITS = {"imu_samples":4096,"keystrokes":1024,"taps":1024,"slider_trace":4096}


def open_store(directory, data, seed):
    model, projector, manifest = load(directory)
    location = data/manifest["id"]
    client = QdrantClient(path=str(location))
    try:
        store = IdentityStore(client,model,projector)
        if seed:
            for person,payload in population():
                response = store.score(payload,"synthetic")
                if person < 15:
                    store.enroll(payload["session_id"],"synthetic")
                if person == 17:
                    store.ban(response["operator_reconciliation"]["matched_operator_id"],"synthetic")
        return store, manifest
    except Exception:
        client.close()
        raise


def create_app(model_dir=None, data_dir=None, seed=None, token=None):
    configured = Path(model_dir or os.environ.get("ML_MODEL_DIR",BASE/"artifacts"/"synthetic-v1")).resolve()
    data = Path(data_dir or os.environ.get("ML_DATA_DIR",BASE/"data"/"identity")).resolve()
    seed = os.environ.get("ML_SEED_POPULATION","1") == "1" if seed is None else seed
    secret = token if token is not None else os.environ.get("ML_ADMIN_TOKEN","")
    lock = RLock()
    checks = validators()

    @asynccontextmanager
    async def lifespan(app):
        torch.set_num_threads(1)
        data.mkdir(parents=True,exist_ok=True)
        pointer = data/"active-model.json"
        active = configured
        if pointer.exists():
            saved = json.loads(pointer.read_text())
            if saved["base"] == str(configured):
                active = Path(saved["active"])
        if not active.exists() and active == BASE/"artifacts"/"synthetic-v1":
            await run_in_threadpool(fit,active,synthetic_training(),"synthetic")
        store, manifest = await run_in_threadpool(open_store,active,data,seed)
        app.state.store, app.state.manifest, app.state.active = store, manifest, active
        try:
            yield
        finally:
            app.state.store.client.close()

    app = FastAPI(title="SANA Shield identity service",lifespan=lifespan)

    def admin(request:Request):
        provided = request.headers.get("authorization","")
        if not secret or not hmac.compare_digest(provided.encode(),("Bearer "+secret).encode()):
            raise HTTPException(403,"Administrative credential required")

    def with_store(method,*args):
        with lock:
            try:
                return getattr(app.state.store,method)(*args)
            except Conflict as exc:
                raise HTTPException(409,str(exc)) from exc
            except InsufficientEvidence as exc:
                raise HTTPException(422,str(exc)) from exc
            except KeyError as exc:
                raise HTTPException(404,"Unknown session or operator") from exc

    @app.get("/health")
    def health():
        with lock:
            manifest = app.state.manifest
            return {"status":"ready","model_id":manifest["id"],"training_source":manifest["source"],
                    "seed_population":seed}

    @app.post("/ml/embed-and-score")
    async def score(request:Request):
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw)+len(chunk)>MAX_BYTES:
                raise HTTPException(413,"Session exceeds request limit")
            raw.extend(chunk)
        try:
            payload = json.loads(raw,parse_constant=reject_constant,object_pairs_hook=unique_object)
            if not isinstance(payload,dict):
                raise ValueError
            for key,limit in LIMITS.items():
                if isinstance(payload.get(key),list) and len(payload[key])>limit:
                    raise HTTPException(413,"Session stream exceeds collection limit")
            if validate_payload("A",payload,checks):
                raise ValueError
        except (TypeError,ValueError,RecursionError,OverflowError) as exc:
            raise HTTPException(422,"Invalid Contract A session") from exc
        return await run_in_threadpool(with_store,"score",payload)

    @app.get("/ml/population-map")
    def population_map():
        return with_store("population_map")

    @app.post("/ml/operators/{operator_id}/ban",dependencies=[Depends(admin)])
    def ban(operator_id:str):
        return with_store("ban_by_id",operator_id)

    @app.post("/ml/sessions/{session_id}/enroll",dependencies=[Depends(admin)])
    def enroll(session_id:str):
        return with_store("enroll",session_id)

    @app.post("/ml/retrain",dependencies=[Depends(admin)])
    def retrain():
        source = os.environ.get("ML_CALIBRATION_MANIFEST")
        if not source:
            raise HTTPException(409,"Configure a local consented calibration manifest first")
        with lock:
            previous = app.state.store
            if next(previous.scroll("global_sessions",where(scope="live")),None):
                raise HTTPException(409,"Existing live decisions use this model. Train and evaluate a new offline generation before a separate deployment.")
            candidate = data/"models"/str(uuid4())
            try:
                calibrate(source,candidate,app.state.active)
                next_store, manifest = open_store(candidate,data,seed)
            except (ValueError,FileNotFoundError) as exc:
                raise HTTPException(422,"Calibration manifest or training recordings are invalid") from exc
            try:
                # Keep any manually banned seed identities when rotating a seeded-only store.
                for point in previous.scroll("banned_operators",where(scope="synthetic")):
                    op = point.payload["operator_id"]
                    if next(next_store.scroll("global_sessions",where(scope="synthetic",operator_id=op)),None):
                        next_store.ban(op,"synthetic")
                tmp = data/"active-model.tmp"
                tmp.write_text(json.dumps({"base":str(configured),"active":str(candidate)}))
                tmp.replace(data/"active-model.json")
            except Exception:
                next_store.client.close()
                raise
            app.state.store, app.state.manifest, app.state.active = next_store, manifest, candidate
            previous.client.close()
            return {"model_id":manifest["id"],"training_sessions":manifest["training_sessions"]}

    return app


app = create_app()
