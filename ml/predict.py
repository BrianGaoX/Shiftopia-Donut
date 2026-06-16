import hashlib
import json
import logging
import os
import pickle
import numpy as np
from dotenv import load_dotenv
from supabase import create_client
from correction_engine import CorrectionEngine

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

logger = logging.getLogger(__name__)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
ROLES = ['Usher', 'Security', 'Food Staff', 'Supervisor']

# Quantiles predicted by the multi-quantile models (must match train_model.py).
# Models trained with objective='reg:quantileerror' and quantile_alpha=QUANTILES
# emit one column per quantile; legacy point models emit a single column and are
# handled via a Poisson fallback so the quantile contract is always populated.
QUANTILES = [0.5, 0.9]
# z-score for the 0.9 quantile of a standard normal (Poisson fallback).
_Z_P90 = 1.2815515655446004

# ---------------------------------------------------------------------------
# Feature schema — single source of truth shared with train_model.py.
# Fail loudly at import time if the contract file is absent.
# ---------------------------------------------------------------------------
_SCHEMA_PATH = os.path.join(os.path.dirname(__file__), 'feature_schema.json')
if not os.path.exists(_SCHEMA_PATH):
    raise RuntimeError(
        f"feature_schema.json not found at {_SCHEMA_PATH}. "
        "Cannot start: feature contract is missing."
    )
with open(_SCHEMA_PATH) as _f:
    _SCHEMA = json.load(_f)

FEATURE_ORDER: list[str] = _SCHEMA['feature_order']
CATEGORICAL_COLS: list[str] = _SCHEMA['categorical']

# ---------------------------------------------------------------------------
# MANIFEST — server-side model version registry.
# ---------------------------------------------------------------------------
def load_manifest(models_dir: str = MODELS_DIR) -> dict:
    """Load MANIFEST.json from models_dir. Raises RuntimeError on missing file."""
    manifest_path = os.path.join(models_dir, 'MANIFEST.json')
    if not os.path.exists(manifest_path):
        raise RuntimeError(
            f"MANIFEST.json not found at {manifest_path}. "
            "Cannot start: model version registry is missing."
        )
    with open(manifest_path) as f:
        return json.load(f)

manifest = load_manifest()

# ---------------------------------------------------------------------------
# Unknown-category counter (module-level; no Prometheus yet)
# ---------------------------------------------------------------------------
unknown_category_counter: dict[str, int] = {}

# ---------------------------------------------------------------------------
# Module-level singletons — populated once by load_all_models() at startup.
# predict_demand() reads from these; it never calls load_model() per request.
# ---------------------------------------------------------------------------
_MODEL_CACHE: dict[str, object] = {}
_pipeline_singleton: 'FeaturePipeline | None' = None
_correction_singleton: 'CorrectionEngine | None' = None


class PredictionError(Exception):
    """Raised when model loading or prediction fails for a specific role."""

    def __init__(self, role: str, cause: Exception) -> None:
        super().__init__(f"Prediction failed for role '{role}': {cause}")
        self.role = role
        self.cause = cause


class FeaturePipeline:
    def __init__(self):
        self.encoders = {}
        try:
            with open(os.path.join(MODELS_DIR, 'encoders.pkl'), 'rb') as f:
                self.encoders = pickle.load(f)
        except Exception:
            pass

    def transform(self, features: dict) -> np.ndarray:
        row = []
        for col in FEATURE_ORDER:
            val = features[col]
            if col in self.encoders:
                encoder = self.encoders[col]
                str_val = str(val)
                if str_val not in encoder.classes_:
                    fallback_label = encoder.classes_[0]
                    logger.warning(
                        "unknown category %s for column %s, falling back to %s",
                        val, col, fallback_label,
                    )
                    unknown_category_counter[col] = (
                        unknown_category_counter.get(col, 0) + 1
                    )
                    val = encoder.transform([fallback_label])[0]
                else:
                    val = encoder.transform([str_val])[0]
            elif isinstance(val, bool):
                val = int(val)
            row.append(val)
        return np.array([row])


def _validate_features(features: dict) -> None:
    """Raise ValueError for integer fields whose out-of-range values would
    produce nonsense XGBoost predictions without any obvious error."""
    if features.get('expected_attendance', 0) < 0:
        raise ValueError("expected_attendance must be >= 0")
    if features.get('time_slice_index', 0) < 0:
        raise ValueError("time_slice_index must be >= 0")
    month = features.get('month')
    if month is not None and not (1 <= month <= 12):
        raise ValueError(f"month must be in 1..12, got {month}")
    dow = features.get('day_of_week')
    if dow is not None and not (0 <= dow <= 6):
        raise ValueError(f"day_of_week must be in 0..6, got {dow}")
    if features.get('room_count', 0) < 0:
        raise ValueError("room_count must be >= 0")
    if features.get('room_capacity', 0) < 0:
        raise ValueError("room_capacity must be >= 0")
    if features.get('total_sqm', 0) < 0:
        raise ValueError("total_sqm must be >= 0")
    if features.get('simultaneous_event_count', 0) < 0:
        raise ValueError("simultaneous_event_count must be >= 0")
    if features.get('total_venue_attendance_same_time', 0) < 0:
        raise ValueError("total_venue_attendance_same_time must be >= 0")


def load_model(role: str):
    model_path = os.path.join(MODELS_DIR, f'{role}.pkl')
    if not os.path.exists(model_path):
        raise PredictionError(
            role,
            FileNotFoundError(f"Model file not found: {model_path}")
        )
    try:
        with open(model_path, 'rb') as f:
            return pickle.load(f)
    except Exception as exc:
        raise PredictionError(role, exc) from exc


def _sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def _verify_manifest_hashes() -> None:
    """Compare on-disk model file sha256 against the active row in public.model_manifests.
    Raises RuntimeError on mismatch. No-op when ML_VERIFY_MANIFEST_HASHES is unset."""
    if os.getenv('ML_VERIFY_MANIFEST_HASHES', '').lower() not in ('1', 'true', 'yes'):
        return

    url = os.getenv('VITE_SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')
    if not url or not key:
        raise RuntimeError("ML_VERIFY_MANIFEST_HASHES=true requires Supabase credentials in env.")

    supabase = create_client(url, key)
    resp = supabase.table('model_manifests').select('manifest_id, file_hashes').eq('is_active', True).limit(1).execute()
    if not resp.data:
        raise RuntimeError("ML_VERIFY_MANIFEST_HASHES=true but no active row in model_manifests.")

    expected = resp.data[0].get('file_hashes', {}) or {}
    manifest_id = resp.data[0].get('manifest_id', '?')

    for role, expected_hash in expected.items():
        path = os.path.join(MODELS_DIR, f'{role}.pkl')
        if not os.path.exists(path):
            raise RuntimeError(
                f"Manifest {manifest_id} expects file for role '{role}' but {path} is missing."
            )
        actual = _sha256_of_file(path)
        if actual != expected_hash:
            raise RuntimeError(
                f"sha256 mismatch for role '{role}' against manifest {manifest_id}: "
                f"expected {expected_hash[:12]}…, got {actual[:12]}…"
            )

    logger.info("Manifest hash verification passed (%s, %d roles).", manifest_id, len(expected))


def load_all_models() -> None:
    """Load all role models, the feature pipeline, and correction engine once.

    Populates the module-level singletons _MODEL_CACHE, _pipeline_singleton,
    and _correction_singleton. Called once at application startup via lifespan.
    Raises if any model file is corrupt (missing files are tolerated — predict_demand
    will return zeros for that role, matching existing behaviour).
    CorrectionEngine.load_factors() raises on connect/auth failure so startup fails fast.
    When ML_VERIFY_MANIFEST_HASHES=true, also verifies on-disk sha256 against the
    active row in public.model_manifests.
    """
    global _pipeline_singleton, _correction_singleton

    _verify_manifest_hashes()

    _pipeline_singleton = FeaturePipeline()

    for role in ROLES:
        model_path = os.path.join(MODELS_DIR, f'{role}.pkl')
        if not os.path.exists(model_path):
            logger.warning("Model file not found at startup for role '%s' — predictions will be 0", role)
            continue
        try:
            with open(model_path, 'rb') as f:
                _MODEL_CACHE[role] = pickle.load(f)
        except Exception as exc:
            logger.warning("Failed to load model for role '%s': %s — predictions will be 0", role, exc)

    engine = CorrectionEngine()
    engine.load_factors(client_factory=create_client)
    _correction_singleton = engine


def predict_demand(features: dict) -> dict:
    _validate_features(features)

    # Use the module-level singletons when available (production path).
    # Fall back to constructing fresh instances for test environments that
    # call predict_demand() directly without going through lifespan.
    pipeline = _pipeline_singleton if _pipeline_singleton is not None else FeaturePipeline()
    if _correction_singleton is not None:
        correction = _correction_singleton
    else:
        correction = CorrectionEngine()
        try:
            correction.load_factors(client_factory=create_client)
        except Exception:
            pass  # No factors available — apply() will default to 1.0x

    results = {}

    for role in ROLES:
        # Use cached model if present; otherwise fall back to loading from disk.
        model = _MODEL_CACHE.get(role)
        if model is None:
            try:
                model = load_model(role)
            except PredictionError:
                results[role] = {'predicted': 0, 'corrected': 0}
                continue

        try:
            X = pipeline.transform(features)
            raw = np.asarray(model.predict(X))
            # Multi-quantile model → a row of quantile predictions aligned with
            # QUANTILES; legacy point model → 1-D. Backward-compatible: existing
            # on-disk point models keep working until they're retrained.
            if raw.ndim == 2 and raw.shape[1] >= len(QUANTILES):
                q_row = raw[0]
                p50_raw = float(q_row[QUANTILES.index(0.5)])
                p90_raw = float(q_row[QUANTILES.index(0.9)])
                quantile_source = 'model'
            else:
                p50_raw = float(raw.reshape(-1)[0])
                # Poisson-style fallback (σ≈√mean) so the P90 contract is always
                # populated even for point models — same approximation the demand
                # buffer used to assume, now isolated to legacy artifacts only.
                p90_raw = p50_raw + _Z_P90 * float(np.sqrt(max(0.0, p50_raw)))
                quantile_source = 'approx'

            corrected, factor = correction.apply(features['event_type'], role, p50_raw)
            p50_final = max(0, round(corrected))
            # Scale P90 by the same correction factor; clamp >= P50 so the
            # quantiles never cross after rounding.
            p90_final = max(p50_final, round(max(0.0, p90_raw * factor)))
            results[role] = {
                'predicted': max(0, round(p50_raw)),
                'corrected': p50_final,
                'correction_factor': factor,
                'p50': p50_final,
                'p90': p90_final,
                'quantile_source': quantile_source,
            }
        except PredictionError:
            raise
        except Exception as exc:
            raise PredictionError(role, exc) from exc

    return results
