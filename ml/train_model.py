import json
import os
import pickle
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import mean_absolute_error, r2_score
from xgboost import XGBRegressor

# Quantiles to predict (must match QUANTILES in predict.py). Multi-quantile
# regression replaces the old point estimate so the demand engine can buffer to
# a true service level (P90) instead of a Poisson approximation around the mean.
QUANTILES = [0.5, 0.9]

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('VITE_SUPABASE_ANON_KEY')

# ---------------------------------------------------------------------------
# Feature schema — single source of truth shared with predict.py.
# Fail loudly at import time if the contract file is absent.
# ---------------------------------------------------------------------------
_SCHEMA_PATH = os.path.join(os.path.dirname(__file__), 'feature_schema.json')
if not os.path.exists(_SCHEMA_PATH):
    raise RuntimeError(
        f"feature_schema.json not found at {_SCHEMA_PATH}. "
        "Cannot train: feature contract is missing."
    )
with open(_SCHEMA_PATH) as _f:
    _SCHEMA = json.load(_f)

FEATURE_COLS: list[str] = _SCHEMA['feature_order']
CATEGORICAL_COLS: list[str] = _SCHEMA['categorical']
ROLES = ['Usher', 'Security', 'Food Staff', 'Supervisor']


def fetch_training_data():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        response = supabase.table('venueops_ml_features').select('*').range(offset, offset + page_size - 1).execute()
        rows = response.data
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    print(f"Fetched {len(all_rows)} rows from venueops_ml_features")
    return pd.DataFrame(all_rows)


def train_all_models():
    df = fetch_training_data()

    df['entry_peak_flag'] = df['entry_peak_flag'].astype(int)
    df['exit_peak_flag'] = df['exit_peak_flag'].astype(int)
    df['meal_window_flag'] = df['meal_window_flag'].astype(int)

    encoders = {}
    for col in CATEGORICAL_COLS:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col].astype(str))
        encoders[col] = le

    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)

    with open(os.path.join(models_dir, 'encoders.pkl'), 'wb') as f:
        pickle.dump(encoders, f)
    print("Saved label encoders")

    for role in ROLES:
        role_df = df[df['target_role'] == role]
        if role_df.empty:
            print(f"No data for role: {role}, skipping")
            continue

        X = role_df[FEATURE_COLS]
        y = role_df['target_staff_count']

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

        # Multi-quantile regression: one model per role predicting all QUANTILES
        # at once (XGBoost >= 2.0). predict() then returns shape (n, len(QUANTILES)).
        model = XGBRegressor(
            objective='reg:quantileerror',
            quantile_alpha=np.array(QUANTILES),
            n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42,
        )
        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        # Score against the P50 (median) column for an apples-to-apples MAE/R².
        p50_pred = y_pred[:, QUANTILES.index(0.5)] if y_pred.ndim == 2 else y_pred
        mae = mean_absolute_error(y_test, p50_pred)
        r2 = r2_score(y_test, p50_pred)
        print(f"{role}: MAE={mae:.2f}, R²={r2:.4f} ({len(role_df)} rows, quantiles={QUANTILES})")

        model_path = os.path.join(models_dir, f'{role}.pkl')
        with open(model_path, 'wb') as f:
            pickle.dump(model, f)

    print("Training complete")


if __name__ == '__main__':
    train_all_models()
