import json
import logging

from observability import JsonFormatter, request_id_var


def _format(record: logging.LogRecord) -> dict:
    return json.loads(JsonFormatter().format(record))


def _record(msg: str, level: int = logging.INFO, **extra) -> logging.LogRecord:
    rec = logging.LogRecord(
        name='test', level=level, pathname='', lineno=0,
        msg=msg, args=(), exc_info=None,
    )
    for k, v in extra.items():
        setattr(rec, k, v)
    return rec


def test_json_formatter_emits_required_fields():
    payload = _format(_record('hello'))
    assert payload['level'] == 'INFO'
    assert payload['logger'] == 'test'
    assert payload['message'] == 'hello'
    assert 'ts' in payload
    assert 'request_id' in payload


def test_json_formatter_picks_up_request_id_from_contextvar():
    token = request_id_var.set('rid-xyz')
    try:
        payload = _format(_record('inside'))
        assert payload['request_id'] == 'rid-xyz'
    finally:
        request_id_var.reset(token)


def test_json_formatter_default_request_id_is_dash():
    # New contextvar invocation outside any middleware-set token defaults to '-'.
    payload = _format(_record('no-mw'))
    assert payload['request_id'] == '-'


def test_json_formatter_includes_extras():
    rec = _record('with-extras', endpoint='/predict/demand', latency_ms=12.5, status=200)
    payload = _format(rec)
    assert payload['endpoint'] == '/predict/demand'
    assert payload['latency_ms'] == 12.5
    assert payload['status'] == 200


def test_json_formatter_includes_exception():
    try:
        raise RuntimeError('boom')
    except RuntimeError:
        import sys
        rec = logging.LogRecord(
            name='test', level=logging.ERROR, pathname='', lineno=0,
            msg='oops', args=(), exc_info=sys.exc_info(),
        )
    payload = _format(rec)
    assert 'exc' in payload
    assert 'RuntimeError' in payload['exc']
    assert 'boom' in payload['exc']
