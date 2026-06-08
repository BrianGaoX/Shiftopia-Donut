# ML service

FastAPI service that predicts staff counts per role for ICC events. One XGBoost regressor per role, loaded at request time. Predictions are wrapped by a correction factor read from Supabase so the output can be tuned from post-event actuals.

## Requirements

Pinned in `requirements.txt`:

- Python 3.13 (pickled models are version-sensitive, do not use 3.12 or 3.14)
- xgboost 3.2.0
- scikit-learn 1.8.0
- fastapi 0.135.3
- uvicorn 0.44.0
- pandas 3.0.2, numpy 2.4.4
- supabase 2.28.3
- pydantic 2.13.0

## Setup

```bash
cd ml
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Needs Supabase env vars at the repo root `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Run

```bash
uvicorn api:app --reload --port 8000
```

Or via Docker from the repo root:

```bash
docker compose up --build ml
```

Docker image is `python:3.13-slim` to match the venv that pickled the models. Healthcheck hits `GET /health` every 30 s.

## Train

Requires `venueops_ml_features` to be seeded first.

```bash
python train_model.py
```

Writes `models/{role}.pkl` for each of Usher / Security / Food Staff / Supervisor, plus `models/encoders.pkl`.

Retrain whenever the seed changes. The current pickled models were refit after the ICC rooms rollout, so `room_count`, `total_sqm`, and `room_capacity` now reflect the real `venueops_rooms` table instead of attendance-tier approximations.

## Test

Unit and integration tests cover both happy and sad cases. Supabase and the XGB models are stubbed so tests are hermetic (no DB, no real model files).

```bash
pip install -r requirements-dev.txt
pytest -v
```

Coverage:

```bash
pip install coverage
coverage run -m pytest && coverage report -m
```

Layout:

- `tests/test_predict.py` — FeaturePipeline, CorrectionEngine, `predict_demand` (13 tests)
- `tests/test_api.py` — FastAPI TestClient hitting `/health` and `/predict/demand` with valid, missing, wrong-type, malformed, and Supabase-down payloads (11 tests)
- `tests/conftest.py` — shared fixtures: tmp `MODELS_DIR`, picklable stub regressor, mocked Supabase client

## API

`GET /health` returns `{ "status": "ok" }`.

`POST /predict/demand` takes the feature set defined in `FEATURE_ORDER` in `predict.py` (PRD Appendix A):

```bash
curl -X POST http://localhost:8000/predict/demand \
  -H 'Content-Type: application/json' \
  -d '{
    "event_type": "Conference",
    "expected_attendance": 500,
    "day_of_week": 1,
    "month": 11,
    "function_type": "Reception",
    "room_count": 4,
    "total_sqm": 3000,
    "room_capacity": 600,
    "simultaneous_event_count": 2,
    "total_venue_attendance_same_time": 1200,
    "entry_peak_flag": true,
    "exit_peak_flag": false,
    "meal_window_flag": true,
    "time_slice_index": 10,
    "event_id": "evt-001"
  }'
```

Response:

```json
{
  "Usher":      { "predicted": 12, "corrected": 12 },
  "Security":   { "predicted": 11, "corrected": 11 },
  "Food Staff": { "predicted": 15, "corrected": 15 },
  "Supervisor": { "predicted":  3, "corrected":  3 }
}
```

`event_id` is optional. When set, predictions are also written to `predicted_labor_demand`. Missing / wrong-type fields return 422 with Pydantic's error body.

## Known limitations

- `labor_correction_factors` is empty, so `corrected == predicted` until the feedback loop populates it.
- Supabase insert failures are swallowed so a DB outage won't break the prediction response. Logging / retries are future work.
- `event_type` or `function_type` values not seen during training will raise at `LabelEncoder.transform`. Keep categories in sync with the seed data.
- CORS only allows `localhost:5173` and `localhost:3000`. Tighten for any non-dev deployment.
- Pickled models are coupled to Python 3.13 plus the exact library versions listed above. Bumping any of them requires retraining.
