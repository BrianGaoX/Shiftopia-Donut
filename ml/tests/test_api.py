import pytest


def test_health_endpoint(client):
    r = client.get('/health')
    assert r.status_code == 200
    assert r.json() == {'status': 'ok'}


def test_predict_demand_returns_role_keyed_dict(client, valid_api_payload):
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {'Usher', 'Security', 'Food Staff', 'Supervisor'}
    for role, counts in body.items():
        assert 'predicted' in counts
        assert 'corrected' in counts
        assert isinstance(counts['predicted'], int)
        assert isinstance(counts['corrected'], int)


def test_predict_demand_without_event_id_skips_insert(client, valid_api_payload, mock_supabase_client):
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    called_tables = [c.args[0] for c in mock_supabase_client.table.call_args_list]
    assert 'predicted_labor_demand' not in called_tables


def test_predict_demand_with_event_id_attempts_upsert(client, valid_api_payload, mock_supabase_client):
    valid_api_payload['event_id'] = 'evt-test-001'
    valid_api_payload['synthesis_run_id'] = 'run-001'
    upsert_chain = mock_supabase_client.table.return_value.upsert.return_value
    upsert_chain.execute.return_value = mock_supabase_client.table.return_value.insert.return_value.execute.return_value
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    mock_supabase_client.table.assert_called_with('demand_forecasts')
    assert mock_supabase_client.table.return_value.upsert.call_count == 4


def test_predict_demand_upsert_payload_shape(client, valid_api_payload, mock_supabase_client):
    valid_api_payload['event_id'] = 'evt-test-002'
    valid_api_payload['synthesis_run_id'] = 'run-002'
    upsert_chain = mock_supabase_client.table.return_value.upsert.return_value
    upsert_chain.execute.return_value = mock_supabase_client.table.return_value.insert.return_value.execute.return_value
    client.post('/predict/demand', json=valid_api_payload)

    calls = mock_supabase_client.table.return_value.upsert.call_args_list
    assert len(calls) == 4
    for call in calls:
        row = call.args[0]
        assert row['event_id'] == 'evt-test-002'
        assert row['role'] in {'Usher', 'Security', 'Food Staff', 'Supervisor'}
        assert row['time_slot'] == valid_api_payload['time_slice_index']
        assert 'predicted_count' in row
        assert 'corrected_count' in row
        assert row['model_version'] == 'v1.0'


def test_predict_demand_missing_field_returns_422(client, valid_api_payload):
    del valid_api_payload['event_type']
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 422


def test_predict_demand_wrong_type_returns_422(client, valid_api_payload):
    valid_api_payload['expected_attendance'] = 'lots'
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 422


def test_predict_demand_malformed_json_returns_422(client):
    r = client.post(
        '/predict/demand',
        content='{not json',
        headers={'Content-Type': 'application/json'},
    )
    assert r.status_code == 422


def test_predict_demand_empty_body_returns_422(client):
    r = client.post('/predict/demand', json={})
    assert r.status_code == 422


def test_predict_demand_supabase_failure_does_not_break_response(client, valid_api_payload, monkeypatch):
    import api

    def boom(*_a, **_kw):
        raise RuntimeError('supabase offline')

    monkeypatch.setattr(api, 'create_client', boom)
    valid_api_payload['event_id'] = 'evt-will-fail'
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200


def test_predict_demand_missing_env_vars_swallows_error(client, valid_api_payload, monkeypatch):
    """If env vars are missing, create_client might fail, but API should still return predictions."""
    monkeypatch.delenv('VITE_SUPABASE_URL', raising=False)
    monkeypatch.delenv('VITE_SUPABASE_ANON_KEY', raising=False)
    valid_api_payload['event_id'] = 'evt-missing-env'

    # We expect it not to crash
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    assert 'Usher' in r.json()


# ---------------------------------------------------------------------------
# Batch endpoint
# ---------------------------------------------------------------------------
def test_predict_batch_returns_list_in_order(client, valid_api_payload):
    items = [
        {**valid_api_payload, 'time_slice_index': i} for i in range(3)
    ]
    r = client.post('/predict/demand/batch', json=items)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    assert len(body) == 3
    for item in body:
        assert set(item.keys()) == {'Usher', 'Security', 'Food Staff', 'Supervisor'}


def test_predict_batch_empty_returns_422(client):
    r = client.post('/predict/demand/batch', json=[])
    assert r.status_code == 422


def test_predict_batch_oversized_returns_413(client, valid_api_payload):
    import api
    items = [valid_api_payload] * (api.MAX_BATCH_SIZE + 1)
    r = client.post('/predict/demand/batch', json=items)
    assert r.status_code == 413


def test_predict_batch_reuses_supabase_client(client, valid_api_payload, mock_supabase_client, monkeypatch):
    """The batch endpoint must build the Supabase client at most once even for many items."""
    import api

    call_count = {'n': 0}

    def counting_factory(*a, **kw):
        call_count['n'] += 1
        return mock_supabase_client

    monkeypatch.setattr(api, 'create_client', counting_factory)
    upsert_chain = mock_supabase_client.table.return_value.upsert.return_value
    upsert_chain.execute.return_value = mock_supabase_client.table.return_value.insert.return_value.execute.return_value

    items = [
        {**valid_api_payload, 'time_slice_index': i, 'event_id': 'evt-batch', 'synthesis_run_id': 'run-batch'}
        for i in range(5)
    ]
    r = client.post('/predict/demand/batch', json=items)
    assert r.status_code == 200
    assert call_count['n'] == 1  # one client for the entire batch


# ---------------------------------------------------------------------------
# Observability: /metrics, request_id propagation
# ---------------------------------------------------------------------------
def test_metrics_endpoint_returns_prometheus_text(client):
    r = client.get('/metrics')
    assert r.status_code == 200
    assert r.headers['content-type'].startswith('text/plain')
    body = r.text
    assert 'ml_requests_total' in body
    assert 'ml_request_duration_seconds' in body


def test_metrics_counts_increment(client, valid_api_payload):
    client.post('/predict/demand', json=valid_api_payload)
    r = client.get('/metrics')
    assert 'ml_predictions_total' in r.text
    # Each prediction call produces 4 role increments
    assert 'ml_predictions_total{role="Usher"}' in r.text


def test_request_id_echoed_in_response_header(client, valid_api_payload):
    r = client.post(
        '/predict/demand',
        json=valid_api_payload,
        headers={'X-Request-ID': 'test-req-123'},
    )
    assert r.headers.get('X-Request-ID') == 'test-req-123'


def test_request_id_generated_when_absent(client, valid_api_payload):
    r = client.post('/predict/demand', json=valid_api_payload)
    rid = r.headers.get('X-Request-ID')
    assert rid is not None
    assert len(rid) >= 16  # uuid4 hex is 32 chars


# ---------------------------------------------------------------------------
# ml_prediction_log writes (preview + commit + failure-safe)
# ---------------------------------------------------------------------------
def _captured_log_rows(mock_supabase_client) -> list[dict]:
    """Pull every batch of rows passed to .insert() on ml_prediction_log."""
    rows: list[dict] = []
    for call in mock_supabase_client.table.return_value.insert.call_args_list:
        arg = call.args[0]
        if isinstance(arg, list):
            rows.extend(arg)
        else:
            rows.append(arg)
    return rows


def test_preview_call_logs_to_ml_prediction_log_with_is_preview_true(client, valid_api_payload, mock_supabase_client):
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200

    tables_inserted = [
        c.args[0] for c in mock_supabase_client.table.call_args_list
        if 'insert' in str(c)
    ]
    # ml_prediction_log MUST have been touched even for preview calls.
    assert 'ml_prediction_log' in [c.args[0] for c in mock_supabase_client.table.call_args_list]

    rows = _captured_log_rows(mock_supabase_client)
    assert len(rows) == 4  # one row per role
    for row in rows:
        assert row['is_preview'] is True
        assert row['endpoint'] == 'single'
        assert row['event_id'] is None
        assert row['synthesis_run_id'] is None
        assert row['role'] in {'Usher', 'Security', 'Food Staff', 'Supervisor'}
        assert 'feature_payload' in row
        assert isinstance(row['latency_ms'], float)
        assert row['request_id']  # non-empty


def test_commit_call_logs_with_is_preview_false_and_persists(client, valid_api_payload, mock_supabase_client):
    valid_api_payload['event_id'] = 'evt-commit'
    valid_api_payload['synthesis_run_id'] = 'run-commit'
    upsert_chain = mock_supabase_client.table.return_value.upsert.return_value
    upsert_chain.execute.return_value = mock_supabase_client.table.return_value.insert.return_value.execute.return_value

    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200

    rows = _captured_log_rows(mock_supabase_client)
    assert len(rows) == 4
    for row in rows:
        assert row['is_preview'] is False
        assert row['event_id'] == 'evt-commit'
        assert row['synthesis_run_id'] == 'run-commit'


def test_batch_call_bulk_inserts_all_log_rows_in_one_call(client, valid_api_payload, mock_supabase_client):
    items = [
        {**valid_api_payload, 'time_slice_index': i} for i in range(5)
    ]
    r = client.post('/predict/demand/batch', json=items)
    assert r.status_code == 200

    # The batch endpoint MUST flush all 5*4=20 log rows in a single insert call.
    log_insert_calls = [
        c for c in mock_supabase_client.table.return_value.insert.call_args_list
        if isinstance(c.args[0], list) and len(c.args[0]) > 0 and 'request_id' in c.args[0][0]
    ]
    assert len(log_insert_calls) == 1
    assert len(log_insert_calls[0].args[0]) == 20  # 5 items × 4 roles


def test_log_insert_failure_does_not_break_response(client, valid_api_payload, mock_supabase_client):
    """If ml_prediction_log insert raises, the response must still be 200 — observability never blocks inference."""
    insert_chain = mock_supabase_client.table.return_value.insert.return_value
    insert_chain.execute.side_effect = RuntimeError('table missing or RLS denied')

    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    body = r.json()
    assert 'Usher' in body
