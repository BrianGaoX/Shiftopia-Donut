import json
import os
import pickle
import sys
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
from sklearn.preprocessing import LabelEncoder

ML_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML_DIR))

# Tests run with auth bypassed. Production deployments must NOT set this env.
os.environ.setdefault('ML_AUTH_DISABLED', 'true')


ROLES = ['Usher', 'Security', 'Food Staff', 'Supervisor']
EVENT_TYPE_LABELS = ['Concert', 'Conference', 'Corporate', 'Exhibition']
FUNCTION_TYPE_LABELS = ['Meeting', 'Dinner', 'Reception', 'Breakout']


class StubRegressor:
    """Picklable stand-in for an XGBRegressor — returns a constant prediction."""

    def __init__(self, value):
        self.value = float(value)

    def predict(self, X):
        return np.array([self.value] * len(X))


def _fit_encoder(values):
    le = LabelEncoder()
    le.fit(values)
    return le


@pytest.fixture
def fake_models_dir(tmp_path):
    """Create a tmp models dir with encoders.pkl and one stub .pkl per role."""
    models_dir = tmp_path / 'models'
    models_dir.mkdir()

    encoders = {
        'event_type': _fit_encoder(EVENT_TYPE_LABELS),
        'function_type': _fit_encoder(FUNCTION_TYPE_LABELS),
    }
    with open(models_dir / 'encoders.pkl', 'wb') as f:
        pickle.dump(encoders, f)

    for idx, role in enumerate(ROLES):
        stub = StubRegressor(10.0 + idx)
        with open(models_dir / f'{role}.pkl', 'wb') as f:
            pickle.dump(stub, f)

    manifest = {
        "models": {role: "v1.0" for role in ROLES},
        "encoders": "v1.0",
    }
    with open(models_dir / 'MANIFEST.json', 'w') as f:
        json.dump(manifest, f)

    return models_dir


@pytest.fixture
def sample_features():
    return {
        'event_type': 'Conference',
        'expected_attendance': 500,
        'day_of_week': 1,
        'month': 11,
        'function_type': 'Reception',
        'room_count': 4,
        'total_sqm': 3000,
        'room_capacity': 600,
        'simultaneous_event_count': 2,
        'total_venue_attendance_same_time': 1200,
        'entry_peak_flag': True,
        'exit_peak_flag': False,
        'meal_window_flag': True,
        'time_slice_index': 10,
    }


@pytest.fixture
def valid_api_payload(sample_features):
    return sample_features.copy()


@pytest.fixture
def mock_supabase_client():
    """Returns a MagicMock configured to stand in for supabase.create_client."""
    client = MagicMock()
    insert_chain = MagicMock()
    insert_chain.execute.return_value = MagicMock(data=[])
    client.table.return_value.insert.return_value = insert_chain

    select_chain = MagicMock()
    select_chain.execute.return_value = MagicMock(data=[])
    client.table.return_value.select.return_value = select_chain
    return client


@pytest.fixture
def patched_predict(monkeypatch, fake_models_dir, mock_supabase_client):
    """Patch predict module so it reads from fake models dir + mocked supabase."""
    import predict

    monkeypatch.setattr(predict, 'MODELS_DIR', str(fake_models_dir))
    monkeypatch.setattr(predict, 'create_client', lambda *a, **kw: mock_supabase_client)
    # Reset module-level singletons so each test starts from a clean state.
    monkeypatch.setattr(predict, '_MODEL_CACHE', {})
    monkeypatch.setattr(predict, '_pipeline_singleton', None)
    monkeypatch.setattr(predict, '_correction_singleton', None)
    return predict


@pytest.fixture
def client(monkeypatch, patched_predict, mock_supabase_client):
    """FastAPI TestClient with all external dependencies mocked."""
    from fastapi.testclient import TestClient

    import api

    monkeypatch.setattr(api, 'create_client', lambda *a, **kw: mock_supabase_client)
    monkeypatch.setenv('VITE_SUPABASE_URL', 'http://fake-supabase')
    monkeypatch.setenv('VITE_SUPABASE_ANON_KEY', 'fake-key')
    return TestClient(api.app)
