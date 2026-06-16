"""
Prometheus metrics for the Superman OR-Tools optimizer service.

Exposes:
  optimize_requests_total{status}   — Counter   — total /optimize calls by outcome
  optimize_solve_seconds            — Histogram  — wall-clock time inside build_and_solve
  optimize_coverage_rate            — Histogram  — fraction of shifts assigned (0–1)
  optimize_infeasible_total         — Counter    — INFEASIBLE outcomes (TS falls back to greedy)
  optimize_unknown_total            — Counter    — UNKNOWN outcomes   (TS falls back to greedy)
  optimize_in_progress              — Gauge      — /optimize requests currently being solved
  audit_requests_total{status}      — Counter    — total /audit calls by outcome

The /metrics endpoint is registered in ortools_runner.py and does NOT require auth
(standard for Prometheus scrapers behind an internal firewall).

Re-registration safety: prometheus_client raises ValueError if you register a
metric with the same name twice against the global REGISTRY. This module uses
_get_or_create helpers so that importlib.reload() (used in tests) is idempotent.
"""
from __future__ import annotations

from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
    REGISTRY,
)


# ---------------------------------------------------------------------------
# Re-registration helpers
# ---------------------------------------------------------------------------
# importlib.reload() re-executes the module body, which would call Counter(...)
# again against the same global REGISTRY and raise ValueError. We check whether
# a collector with that name already exists and return it unchanged if so.

def _counter(name: str, doc: str, labels: list[str] | None = None) -> Counter:
    try:
        return Counter(name, doc, labels or [])
    except ValueError:
        return REGISTRY._names_to_collectors[name]  # type: ignore[attr-defined]


def _histogram(name: str, doc: str, buckets: list[float]) -> Histogram:
    try:
        return Histogram(name, doc, buckets=buckets)
    except ValueError:
        return REGISTRY._names_to_collectors[name]  # type: ignore[attr-defined]


def _gauge(name: str, doc: str) -> Gauge:
    try:
        return Gauge(name, doc)
    except ValueError:
        return REGISTRY._names_to_collectors[name]  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Metric definitions
# ---------------------------------------------------------------------------

optimize_requests_total: Counter = _counter(
    'optimize_requests_total',
    'Total number of /optimize requests by outcome status',
    ['status'],
)

optimize_solve_seconds: Histogram = _histogram(
    'optimize_solve_seconds',
    'Wall-clock solve time in seconds (build_and_solve duration)',
    buckets=[1, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180],
)

optimize_coverage_rate: Histogram = _histogram(
    'optimize_coverage_rate',
    'Fraction of requested shifts that received an assignment (0–1)',
    buckets=[0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0],
)

optimize_infeasible_total: Counter = _counter(
    'optimize_infeasible_total',
    'Number of /optimize calls that returned INFEASIBLE (TS falls back to greedy)',
)

optimize_unknown_total: Counter = _counter(
    'optimize_unknown_total',
    'Number of /optimize calls that returned UNKNOWN (TS falls back to greedy)',
)

optimize_in_progress: Gauge = _gauge(
    'optimize_in_progress',
    'Number of /optimize solve operations currently in flight',
)

audit_requests_total: Counter = _counter(
    'audit_requests_total',
    'Total number of /audit requests by outcome status',
    ['status'],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def metrics_response() -> tuple[bytes, str]:
    """Return (body_bytes, content_type) suitable for a raw HTTP response."""
    return generate_latest(), CONTENT_TYPE_LATEST
