import hashlib
import logging
import os
import pickle

import numpy as np
import pytest


class StubRegressor:
    def __init__(self, value):
        self.value = float(value)

    def predict(self, X):
        return np.array([self.value] * len(X))


def test_feature_pipeline_transforms_valid_dict_to_1x14(patched_predict, sample_features):
    pipeline = patched_predict.FeaturePipeline()
    arr = pipeline.transform(sample_features)
    assert arr.shape == (1, 14)


def test_feature_pipeline_respects_feature_order(patched_predict, sample_features):
    pipeline = patched_predict.FeaturePipeline()
    arr = pipeline.transform(sample_features)[0]

    encoded_event = pipeline.encoders['event_type'].transform(['Conference'])[0]
    encoded_function = pipeline.encoders['function_type'].transform(['Reception'])[0]

    assert arr[0] == encoded_event
    assert arr[1] == sample_features['expected_attendance']
    assert arr[4] == encoded_function
    assert arr[-1] == sample_features['time_slice_index']


def test_feature_pipeline_raises_on_missing_key(patched_predict, sample_features):
    pipeline = patched_predict.FeaturePipeline()
    incomplete = {k: v for k, v in sample_features.items() if k != 'room_count'}
    with pytest.raises(KeyError):
        pipeline.transform(incomplete)


def test_feature_pipeline_falls_back_on_unknown_category(patched_predict, sample_features, caplog):
    """Unknown category must not raise; it falls back to classes_[0] and logs a warning."""
    pipeline = patched_predict.FeaturePipeline()
    bogus = dict(sample_features)
    bogus['event_type'] = 'MadeUpType'
    with caplog.at_level(logging.WARNING):
        arr = pipeline.transform(bogus)
    assert arr.shape == (1, 14)
    assert any('MadeUpType' in m for m in caplog.messages)


def test_correction_engine_applies_factor_when_present(patched_predict, mock_supabase_client):
    mock_supabase_client.table.return_value.select.return_value.execute.return_value.data = [
        {'event_type': 'Concert', 'role': 'Security', 'correction_factor': 1.5},
    ]
    engine = patched_predict.CorrectionEngine()
    engine.load_factors(client_factory=lambda *a, **kw: mock_supabase_client)
    corrected, _ = engine.apply('Concert', 'Security', 10.0)
    assert corrected == pytest.approx(15.0)


def test_correction_engine_defaults_to_one_when_missing(patched_predict, mock_supabase_client):
    mock_supabase_client.table.return_value.select.return_value.execute.return_value.data = []
    engine = patched_predict.CorrectionEngine()
    engine.load_factors(client_factory=lambda *a, **kw: mock_supabase_client)
    corrected, _ = engine.apply('Concert', 'Usher', 7.0)
    assert corrected == pytest.approx(7.0)


def test_correction_engine_survives_supabase_unreachable(patched_predict, monkeypatch):
    """load_factors() must raise when the DB is unreachable; __init__ stays cheap."""
    def boom(*_a, **_kw):
        raise RuntimeError('network down')

    engine = patched_predict.CorrectionEngine()
    # __init__ does no I/O — factors is empty without touching the network.
    assert engine.factors == {}
    corrected, _ = engine.apply('Concert', 'Usher', 9.0)
    assert corrected == pytest.approx(9.0)
    # load_factors() propagates the connect failure.
    with pytest.raises(RuntimeError, match='network down'):
        engine.load_factors(client_factory=boom)


def test_predict_demand_returns_all_roles(patched_predict, sample_features):
    result = patched_predict.predict_demand(sample_features)
    assert set(result.keys()) == {'Usher', 'Security', 'Food Staff', 'Supervisor'}
    for role, counts in result.items():
        assert 'predicted' in counts and 'corrected' in counts
        assert counts['predicted'] >= 0
        assert counts['corrected'] >= 0
        assert isinstance(counts['predicted'], int)
        assert isinstance(counts['corrected'], int)


def test_predict_demand_zero_clamps_negative_prediction(patched_predict, fake_models_dir, sample_features):
    """A model returning a negative value must be clamped to 0."""
    with open(os.path.join(fake_models_dir, 'Usher.pkl'), 'wb') as f:
        pickle.dump(StubRegressor(-5.0), f)

    result = patched_predict.predict_demand(sample_features)
    assert result['Usher']['predicted'] == 0
    assert result['Usher']['corrected'] == 0


def test_predict_demand_returns_zero_when_model_file_missing(patched_predict, fake_models_dir, sample_features):
    os.remove(os.path.join(fake_models_dir, 'Security.pkl'))
    result = patched_predict.predict_demand(sample_features)
    assert result['Security'] == {'predicted': 0, 'corrected': 0}
    assert result['Usher']['predicted'] > 0


def test_predict_demand_returns_zero_on_pickle_error(patched_predict, fake_models_dir, sample_features):
    """If a model file is corrupted (not a valid pickle), it should be treated as 0 demand."""
    with open(os.path.join(fake_models_dir, 'Supervisor.pkl'), 'w') as f:
        f.write('not a pickle')

    result = patched_predict.predict_demand(sample_features)
    assert result['Supervisor'] == {'predicted': 0, 'corrected': 0}
    assert result['Usher']['predicted'] > 0


def test_predict_demand_returns_zero_on_missing_encoders(patched_predict, fake_models_dir, sample_features):
    """If encoders.pkl is missing, FeaturePipeline should handle it gracefully (though predictions might be off)."""
    os.remove(os.path.join(fake_models_dir, 'encoders.pkl'))
    
    # It shouldn't crash
    pipeline = patched_predict.FeaturePipeline()
    assert pipeline.encoders == {}
    
    # Prediction might fail later if categorical fields are used, but we've caught Exception in predict_demand
    result = patched_predict.predict_demand(sample_features)
    assert 'Usher' in result


def test_predict_demand_applies_correction_factor(patched_predict, mock_supabase_client, sample_features):
    mock_supabase_client.table.return_value.select.return_value.execute.return_value.data = [
        {'event_type': 'Conference', 'role': 'Usher', 'correction_factor': 2.0},
    ]
    result = patched_predict.predict_demand(sample_features)
    assert result['Usher']['corrected'] >= result['Usher']['predicted']


def test_predict_demand_unknown_event_type_no_exception(patched_predict, sample_features, caplog):
    """predict_demand() with an unseen event_type must return all four roles,
    not raise, and emit at least one WARNING naming the unknown value."""
    bogus = dict(sample_features)
    bogus['event_type'] = 'MadeUpType'
    with caplog.at_level(logging.WARNING):
        result = patched_predict.predict_demand(bogus)
    assert set(result.keys()) == {'Usher', 'Security', 'Food Staff', 'Supervisor'}
    for role, counts in result.items():
        assert 'predicted' in counts and 'corrected' in counts
    assert any('MadeUpType' in m for m in caplog.messages)


# ---------------------------------------------------------------------------
# C2 — quantile predictions (multi-quantile model + legacy point fallback)
# ---------------------------------------------------------------------------
class MultiQuantileStub:
    """Stand-in for a multi-quantile XGBRegressor — returns [[p50, p90]] per row."""

    def __init__(self, p50, p90):
        self.p50 = float(p50)
        self.p90 = float(p90)

    def predict(self, X):
        return np.array([[self.p50, self.p90]] * len(X))


def test_predict_demand_multiquantile_model_returns_quantiles(patched_predict, sample_features):
    """A model emitting a 2-D (P50, P90) row → quantile_source='model' with both
    quantiles surfaced (no correction data in the fixture → factor 1.0)."""
    patched_predict._MODEL_CACHE['Usher'] = MultiQuantileStub(8, 12)
    result = patched_predict.predict_demand(sample_features)
    usher = result['Usher']
    assert usher['quantile_source'] == 'model'
    assert usher['p50'] == 8
    assert usher['p90'] == 12
    assert usher['corrected'] == usher['p50']
    assert usher['p90'] >= usher['p50']


def test_predict_demand_legacy_point_model_approximates_p90(patched_predict, sample_features):
    """A legacy 1-D point model → quantile_source='approx' with a Poisson P90
    (>= P50), so the quantile contract is always populated."""
    result = patched_predict.predict_demand(sample_features)  # fixture stub = 1-D
    usher = result['Usher']  # StubRegressor(10.0)
    assert usher['quantile_source'] == 'approx'
    assert usher['p50'] == 10
    assert usher['p90'] >= usher['p50']  # 10 + 1.28·√10 ≈ 14
    assert 'predicted' in usher and 'corrected' in usher


def test_manifest_loadable_and_contains_all_roles(patched_predict, fake_models_dir):
    """MANIFEST.json written by the fixture must carry version entries for every role."""
    import json, os
    manifest_path = os.path.join(str(fake_models_dir), 'MANIFEST.json')
    with open(manifest_path) as f:
        data = json.load(f)
    assert 'models' in data
    for role in ('Usher', 'Security', 'Food Staff', 'Supervisor'):
        assert role in data['models'], f"MANIFEST missing role: {role}"


# ---------------------------------------------------------------------------
# Manifest-hash verification (opt-in via ML_VERIFY_MANIFEST_HASHES)
# ---------------------------------------------------------------------------
def _sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def test_verify_manifest_hashes_no_op_when_disabled(patched_predict, monkeypatch):
    monkeypatch.delenv('ML_VERIFY_MANIFEST_HASHES', raising=False)
    # Should return without error and without touching Supabase.
    patched_predict._verify_manifest_hashes()


def test_verify_manifest_hashes_passes_with_matching_hash(patched_predict, fake_models_dir, mock_supabase_client, monkeypatch):
    monkeypatch.setenv('ML_VERIFY_MANIFEST_HASHES', 'true')
    monkeypatch.setenv('VITE_SUPABASE_URL', 'http://fake')
    monkeypatch.setenv('VITE_SUPABASE_ANON_KEY', 'fake-key')

    expected = {role: _sha256(os.path.join(str(fake_models_dir), f'{role}.pkl'))
                for role in ('Usher', 'Security', 'Food Staff', 'Supervisor')}
    mock_supabase_client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {'manifest_id': 'test-v1', 'file_hashes': expected}
    ]
    monkeypatch.setattr(patched_predict, 'create_client', lambda *a, **kw: mock_supabase_client)

    patched_predict._verify_manifest_hashes()  # must not raise


def test_verify_manifest_hashes_fails_on_mismatch(patched_predict, fake_models_dir, mock_supabase_client, monkeypatch):
    monkeypatch.setenv('ML_VERIFY_MANIFEST_HASHES', 'true')
    monkeypatch.setenv('VITE_SUPABASE_URL', 'http://fake')
    monkeypatch.setenv('VITE_SUPABASE_ANON_KEY', 'fake-key')

    bogus = {role: 'deadbeef' * 8 for role in ('Usher',)}
    mock_supabase_client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {'manifest_id': 'test-v1', 'file_hashes': bogus}
    ]
    monkeypatch.setattr(patched_predict, 'create_client', lambda *a, **kw: mock_supabase_client)

    with pytest.raises(RuntimeError, match='sha256 mismatch'):
        patched_predict._verify_manifest_hashes()


def test_verify_manifest_hashes_fails_when_no_active_row(patched_predict, mock_supabase_client, monkeypatch):
    monkeypatch.setenv('ML_VERIFY_MANIFEST_HASHES', 'true')
    monkeypatch.setenv('VITE_SUPABASE_URL', 'http://fake')
    monkeypatch.setenv('VITE_SUPABASE_ANON_KEY', 'fake-key')
    mock_supabase_client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr(patched_predict, 'create_client', lambda *a, **kw: mock_supabase_client)

    with pytest.raises(RuntimeError, match='no active row'):
        patched_predict._verify_manifest_hashes()
