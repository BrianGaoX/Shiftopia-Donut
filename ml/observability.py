"""Observability — structured JSON logging, request_id correlation, Prometheus metrics."""

import contextvars
import json
import logging
import time
import uuid
from typing import Awaitable, Callable

from prometheus_client import Counter, Gauge, Histogram

# ---------------------------------------------------------------------------
# request_id contextvar — set by middleware, read by formatter and handlers.
# ---------------------------------------------------------------------------
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    'request_id', default='-'
)


# ---------------------------------------------------------------------------
# JSON log formatter
# ---------------------------------------------------------------------------
_STANDARD_RECORD_KEYS = {
    'name', 'msg', 'args', 'levelname', 'levelno', 'pathname', 'filename',
    'module', 'exc_info', 'exc_text', 'stack_info', 'lineno', 'funcName',
    'created', 'msecs', 'relativeCreated', 'thread', 'threadName',
    'processName', 'process', 'taskName', 'message', 'asctime',
}


class JsonFormatter(logging.Formatter):
    """Single-line JSON log records with request_id correlation."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            'ts': self.formatTime(record, '%Y-%m-%dT%H:%M:%S%z'),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'request_id': request_id_var.get(),
        }
        for key, value in record.__dict__.items():
            if key in _STANDARD_RECORD_KEYS or key.startswith('_'):
                continue
            payload[key] = value
        if record.exc_info:
            payload['exc'] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = 'INFO') -> None:
    """Install JsonFormatter on the root + uvicorn loggers. Idempotent."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Uvicorn installs its own handlers; route them through ours.
    for name in ('uvicorn', 'uvicorn.error', 'uvicorn.access'):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.addHandler(handler)
        lg.propagate = False


# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------
REQUESTS_TOTAL = Counter(
    'ml_requests_total',
    'Total HTTP requests processed by the ML service.',
    ['endpoint', 'method', 'status'],
)

REQUEST_LATENCY = Histogram(
    'ml_request_duration_seconds',
    'HTTP request latency in seconds.',
    ['endpoint', 'method'],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

PREDICTIONS_TOTAL = Counter(
    'ml_predictions_total',
    'Total per-role predictions produced.',
    ['role'],
)

UNKNOWN_CATEGORIES = Gauge(
    'ml_unknown_categories_total',
    'Cumulative count of unknown categorical values seen, by column.',
    ['column'],
)


# ---------------------------------------------------------------------------
# ASGI middleware: request_id + latency + access log + metrics
# ---------------------------------------------------------------------------
async def observability_middleware(request, call_next: Callable[..., Awaitable]):
    """Per-request: assign/propagate X-Request-ID, record latency, emit access log."""
    req_id = request.headers.get('X-Request-ID') or uuid.uuid4().hex
    token = request_id_var.set(req_id)

    start = time.perf_counter()
    status_code = 500
    response = None
    access_logger = logging.getLogger('ml.access')

    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers['X-Request-ID'] = req_id
        return response
    finally:
        elapsed = time.perf_counter() - start
        endpoint = request.url.path
        method = request.method
        REQUESTS_TOTAL.labels(endpoint=endpoint, method=method, status=str(status_code)).inc()
        REQUEST_LATENCY.labels(endpoint=endpoint, method=method).observe(elapsed)
        access_logger.info(
            'request',
            extra={
                'endpoint': endpoint,
                'method': method,
                'status': status_code,
                'latency_ms': round(elapsed * 1000, 2),
            },
        )
        request_id_var.reset(token)
