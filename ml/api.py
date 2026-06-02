"""FastAPI service: predicts per-role headcount demand for ICC Sydney events using XGBoost models."""

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, field_validator
from supabase import create_client

import predict
from auth import verify_jwt
from observability import (
    PREDICTIONS_TOTAL,
    UNKNOWN_CATEGORIES,
    configure_logging,
    observability_middleware,
    request_id_var,
)
from predict import PredictionError, load_all_models, manifest, predict_demand

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

configure_logging()
logger = logging.getLogger(__name__)

MAX_BATCH_SIZE = 500


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Load models and correction factors once at startup; release on shutdown."""
    load_all_models()
    logger.info("ML models and correction factors loaded.")
    yield
    logger.info("ML service shutting down.")


app = FastAPI(title="ICC Predictive Labour Engine", lifespan=lifespan)
app.middleware('http')(observability_middleware)

# ---------------------------------------------------------------------------
# CORS — read allowed origins from ML_ALLOWED_ORIGINS (comma-separated list).
# Falls back to localhost-only regex when the env var is unset.
# ---------------------------------------------------------------------------
_raw_origins = os.getenv('ML_ALLOWED_ORIGINS', '')
_explicit_origins = [o.strip() for o in _raw_origins.split(',') if o.strip()]

if _explicit_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_explicit_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.exception_handler(PredictionError)
async def prediction_error_handler(_request, exc: PredictionError):
    return JSONResponse(
        status_code=502,
        content={
            "detail": str(exc),
            "role": exc.role,
            "cause": str(exc.cause),
        },
    )


@app.exception_handler(ValueError)
async def value_error_handler(_request, exc: ValueError):
    return JSONResponse(
        status_code=422,
        content={"detail": str(exc)},
    )


class PredictRequest(BaseModel):
    event_type: Literal[
        'Concert', 'Conference', 'Corporate', 'Exhibition',
        'Festival', 'Gala Dinner', 'Sporting Event', 'Trade Show'
    ]
    expected_attendance: int
    day_of_week: int
    month: int
    function_type: Literal[
        'Breakout', 'Ceremony', 'Dinner', 'Meeting',
        'Performance', 'Reception', 'Workshop'
    ]
    room_count: int
    total_sqm: int
    room_capacity: int
    simultaneous_event_count: int
    total_venue_attendance_same_time: int
    entry_peak_flag: bool
    exit_peak_flag: bool
    meal_window_flag: bool
    time_slice_index: int
    event_id: Optional[str] = None
    synthesis_run_id: Optional[str] = None
    scenario_id: Optional[str] = None

    @field_validator('expected_attendance')
    @classmethod
    def expected_attendance_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("expected_attendance must be >= 0")
        return v

    @field_validator('day_of_week')
    @classmethod
    def day_of_week_range(cls, v: int) -> int:
        if not (0 <= v <= 6):
            raise ValueError(f"day_of_week must be in 0..6, got {v}")
        return v

    @field_validator('month')
    @classmethod
    def month_range(cls, v: int) -> int:
        if not (1 <= v <= 12):
            raise ValueError(f"month must be in 1..12, got {v}")
        return v

    @field_validator('room_count', 'room_capacity', 'total_sqm')
    @classmethod
    def spatial_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("room_count, room_capacity, and total_sqm must be >= 0")
        return v

    @field_validator('simultaneous_event_count', 'total_venue_attendance_same_time')
    @classmethod
    def concurrent_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError(
                "simultaneous_event_count and total_venue_attendance_same_time must be >= 0"
            )
        return v

    @field_validator('time_slice_index')
    @classmethod
    def time_slice_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("time_slice_index must be >= 0")
        return v


def _get_supabase_client():
    return create_client(
        os.getenv('VITE_SUPABASE_URL'),
        os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY'),
    )


def _persist_results(supabase, req: PredictRequest, results: dict, features: dict) -> None:
    """Upsert one row per role into demand_forecasts. Raises HTTPException on DB failure."""
    feature_payload = {k: v for k, v in features.items()}
    for role, counts in results.items():
        row = {
            'event_id': req.event_id,
            'role': role,
            'time_slot': features['time_slice_index'],
            'predicted_count': counts['predicted'],
            'corrected_count': counts['corrected'],
            'correction_factor': counts.get('correction_factor', 1.0),
            'source': 'ML',
            'model_version': manifest['models'].get(role, 'v1.0'),
            'version': 1,
            'synthesis_run_id': req.synthesis_run_id,
            'scenario_id': req.scenario_id,
            'feature_payload': feature_payload,
        }
        try:
            supabase.table('demand_forecasts').upsert(
                row,
                on_conflict='event_id,role,time_slot,version,scenario_id',
            ).execute()
        except Exception as exc:
            logger.error("Failed to upsert demand_forecasts for role %s: %s", role, exc)
            raise HTTPException(
                status_code=500,
                detail=f"DB write failed for role '{role}': {exc}",
            ) from exc


def _record_predictions(results: dict) -> None:
    for role in results:
        PREDICTIONS_TOTAL.labels(role=role).inc()


def _build_log_rows(
    req: PredictRequest,
    results: dict,
    features: dict,
    *,
    latency_ms: float,
    endpoint: str,
    request_id: str,
) -> list[dict]:
    """Build one ml_prediction_log row per role for a single request."""
    is_preview = not req.synthesis_run_id
    return [
        {
            'request_id': request_id,
            'endpoint': endpoint,
            'event_id': req.event_id,
            'synthesis_run_id': req.synthesis_run_id,
            'scenario_id': req.scenario_id,
            'role': role,
            'predicted': counts['predicted'],
            'corrected': counts['corrected'],
            'correction_factor': counts.get('correction_factor', 1.0),
            'model_version': manifest['models'].get(role, 'v1.0'),
            'feature_payload': features,
            'latency_ms': round(latency_ms, 2),
            'is_preview': is_preview,
        }
        for role, counts in results.items()
    ]


def _insert_log_rows(supabase, rows: list[dict]) -> None:
    """Best-effort insert into ml_prediction_log. Failures log a warning but
    never raise — observability must not break inference."""
    if not rows:
        return
    try:
        supabase.table('ml_prediction_log').insert(rows).execute()
    except Exception as exc:
        logger.warning("ml_prediction_log insert skipped (%d rows): %s", len(rows), exc)


@app.post("/predict/demand")
def predict_one(req: PredictRequest, _claims: dict = Depends(verify_jwt)):
    features = req.model_dump(
        exclude={'event_id', 'synthesis_run_id', 'scenario_id'}
    )

    inference_start = time.perf_counter()
    results = predict_demand(features)
    inference_latency_ms = (time.perf_counter() - inference_start) * 1000.0

    _record_predictions(results)

    # Build the log rows up-front (cheap). The Supabase client is created lazily
    # and reused for the persist path below when present.
    log_rows = _build_log_rows(
        req, results, features,
        latency_ms=inference_latency_ms,
        endpoint='single',
        request_id=request_id_var.get(),
    )

    supabase = None
    try:
        supabase = _get_supabase_client()
        _insert_log_rows(supabase, log_rows)
    except Exception as exc:
        logger.warning("ml_prediction_log skipped (client construction): %s", exc)
        supabase = None

    # Persist forecasts only when the caller is committing a synthesis run.
    # Preview-time calls (no synthesis_run_id) intentionally skip the write so
    # demand_forecasts never accumulates untagged rows that rollback cannot reach.
    if req.event_id and req.synthesis_run_id:
        if supabase is None:
            supabase = _get_supabase_client()
        _persist_results(supabase, req, results, features)

    return results


@app.post("/predict/demand/batch")
def predict_batch(reqs: list[PredictRequest], _claims: dict = Depends(verify_jwt)):
    """Predict for an array of requests in one round-trip. Same persistence rules as
    /predict/demand. The Supabase client (when needed) is reused across all items
    in the batch, and ml_prediction_log rows for the whole batch are flushed in a
    single INSERT — the largest backend cost of the single endpoint is the per-call
    client construction, not the model inference itself."""
    if not reqs:
        raise HTTPException(status_code=422, detail="Batch must contain at least one request")
    if len(reqs) > MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Batch size {len(reqs)} exceeds limit of {MAX_BATCH_SIZE}",
        )

    responses: list[dict] = []
    supabase = None
    log_rows: list[dict] = []
    request_id = request_id_var.get()

    for req in reqs:
        features = req.model_dump(
            exclude={'event_id', 'synthesis_run_id', 'scenario_id'}
        )

        inference_start = time.perf_counter()
        results = predict_demand(features)
        inference_latency_ms = (time.perf_counter() - inference_start) * 1000.0

        _record_predictions(results)
        responses.append(results)

        log_rows.extend(_build_log_rows(
            req, results, features,
            latency_ms=inference_latency_ms,
            endpoint='batch',
            request_id=request_id,
        ))

        if req.event_id and req.synthesis_run_id:
            if supabase is None:
                supabase = _get_supabase_client()
            _persist_results(supabase, req, results, features)

    # Single bulk insert for all log rows across the batch.
    try:
        if supabase is None:
            supabase = _get_supabase_client()
        _insert_log_rows(supabase, log_rows)
    except Exception as exc:
        logger.warning("ml_prediction_log skipped (client construction): %s", exc)

    return responses


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/metrics")
def metrics():
    """Prometheus scrape endpoint. Re-emits in-process counters from predict module."""
    for col, count in predict.unknown_category_counter.items():
        UNKNOWN_CATEGORIES.labels(column=col).set(count)
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
