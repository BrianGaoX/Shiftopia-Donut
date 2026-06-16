"""
OR-Tools FastAPI Optimization Service — v2 (Production)

Key improvements over v1:
  - Configurable solver time limit + worker threads
  - Full debug metrics in response (variables, constraints, coverage_rate, timing)
  - INFEASIBLE/UNKNOWN returns graceful response (not 500)
  - Request size guards (max 5000 shifts / 1000 employees)
  - Structured JSON logging

Start:
    pip install -r requirements.txt
    python ortools_runner.py

Or via Docker:
    docker compose up optimizer
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import anyio
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from model_builder import (
    ScheduleModelBuilder,
    OptimizerInput,
    ShiftInput,
    EmployeeInput,
    ExistingShiftInput,
    AvailabilitySlotInput,
    OptimizerConstraints,
    SolverParameters,
    StrategyInput,
    existing_blocks_proposal,
    shift_window,
    _time_to_abs_minutes,
)
from security import (
    AuthContext,
    install as install_security,
    limiter,
    readiness_status,
    require_auth,
    RATE_OPTIMIZE,
    RATE_AUDIT,
)
from metrics import (
    optimize_requests_total,
    optimize_solve_seconds,
    optimize_coverage_rate,
    optimize_infeasible_total,
    optimize_unknown_total,
    optimize_in_progress,
    audit_requests_total,
    metrics_response,
)

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger('ortools_runner')

# =============================================================================
# CONCURRENCY CAP
# =============================================================================
# Each CP-SAT solve is CPU-bound and can run 30–90 s. Without a cap, N
# simultaneous requests would each spin up `num_workers` OS threads (default 8),
# thrashing the CPU and slowing every solve. The semaphore limits parallel solves
# to OPTIMIZER_MAX_CONCURRENT_SOLVES per process. With gunicorn multi-worker the
# effective cluster-wide cap = WEB_CONCURRENCY × OPTIMIZER_MAX_CONCURRENT_SOLVES.
_MAX_CONCURRENT_SOLVES = int(os.environ.get('OPTIMIZER_MAX_CONCURRENT_SOLVES', '2'))
_solve_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_SOLVES)

# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================

class ShiftReq(BaseModel):
    id: str
    shift_date: str
    start_time: str
    end_time: str
    duration_minutes: int
    role_id: Optional[str] = None
    required_skill_ids: list[str] = Field(default_factory=list)
    required_license_ids: list[str] = Field(default_factory=list)
    priority: int = 1
    unpaid_break_minutes: int = 0
    target_employment_type: Optional[str] = None
    level: int = 0
    is_training: bool = False
    # Penalty-rate flags — promoted to the wire boundary so the TS layer
    # can mark a Sunday/PH shift and have the solver actually charge the
    # 1.5×/2.5× rate. Previously these were dataclass-only and silently
    # ignored on the boundary.
    is_sunday: bool = False
    is_public_holiday: bool = False
    # 'NORMAL' or 'MULTI_HIRE' — affects the rest-gap rule (480m vs 600m).
    # MULTI_HIRE handling is currently approximated by AddNoOverlap with
    # the 600m pad; flag is here for forward-compat.
    shift_type: str = 'NORMAL'


class ExistingShiftReq(BaseModel):
    """A shift already committed to the employee. Pinned — the optimizer
    treats it as immutable when proposing new assignments."""
    id: str
    shift_date: str
    start_time: str
    end_time: str
    duration_minutes: int
    unpaid_break_minutes: int = 0


class AvailabilitySlotReq(BaseModel):
    """A declared availability window for an employee on a given date."""
    slot_date: str
    start_time: str
    end_time: str


class EmployeeReq(BaseModel):
    id: str
    name: str
    role_id: Optional[str] = None
    contracted_role_ids: list[str] = Field(default_factory=list)
    employment_type: str = 'Casual'
    hourly_rate: float = 25.0
    max_weekly_minutes: int = 2400
    min_contract_minutes: int = 0
    skill_ids: list[str] = Field(default_factory=list)
    license_ids: list[str] = Field(default_factory=list)
    preferred_shift_ids: list[str] = Field(default_factory=list)
    unavailable_dates: list[str] = Field(default_factory=list)
    # Severity-based availability (dates or intervals)
    # [ (start_time, end_time, severity) ]
    availability_overrides: list[tuple[str, str, str]] = Field(default_factory=list)
    # Declared availability slots in the optimization window. When
    # `has_availability_data` is True, these become the only times the
    # employee may be assigned (hard filter).
    availability_slots: list[AvailabilitySlotReq] = Field(default_factory=list)
    has_availability_data: bool = False
    existing_shifts: list[ExistingShiftReq] = Field(default_factory=list)
    level: int = 0
    is_flexible: bool = False
    is_student: bool = False
    visa_limit: int = 2880
    contract_weekly_minutes: int = 2280
    # F1 fairness-ledger debts per metric. Declared so it survives the wire and
    # reaches EmployeeInput.fairness_debts (consumed by SC-11). Without this the
    # controller's debts are silently dropped here.
    fairness_debts: dict[str, float] = Field(default_factory=dict)


class ConstraintsReq(BaseModel):
    min_rest_minutes: int = 600
    enforce_role_match: bool = True
    enforce_skill_match: bool = True
    allow_partial: bool = True
    relax_constraints: bool = False


class StrategyReq(BaseModel):
    fatigue_weight: int = 50
    fairness_weight: int = 50
    cost_weight: int = 50
    coverage_weight: int = 100


class SolverParamsReq(BaseModel):
    max_time_seconds: float = 30.0
    num_workers: int = 8
    enable_greedy_hint: bool = True
    # Surface the solver's verbose search log when debugging a stuck
    # problem. Off by default — produces ~MB of output per second.
    log_search: bool = False
    # B4 — also compute Pareto "what-if" alternatives (cheapest / most-balanced)
    # for the trade-off explorer. Off by default (adds extra solves).
    compute_alternatives: bool = False


class OptimizeReq(BaseModel):
    shifts: list[ShiftReq]
    employees: list[EmployeeReq]
    constraints: ConstraintsReq = Field(default_factory=ConstraintsReq)
    strategy: StrategyReq = Field(default_factory=StrategyReq)
    solver_params: SolverParamsReq = Field(default_factory=SolverParamsReq)


class DebugMetricsRes(BaseModel):
    raw_pairs: int
    eligible_pairs: int
    rest_eliminated_pairs: int
    final_variables: int
    num_constraints: int
    greedy_hint_applied: bool
    preprocess_ms: float
    solve_ms: float
    coverage_rate: float  # assignments / shifts


class AssignmentRes(BaseModel):
    shift_id: str
    employee_id: str
    employment_type: str
    cost: float
    # B5 — per-assignment "why this person" factors (optional).
    rationale: Optional[dict] = None


class OptimizeRes(BaseModel):
    status: str
    assignments: list[AssignmentRes]
    unassigned_shift_ids: list[str]
    objective_value: float
    best_objective_bound: float
    proven_optimal: bool
    debug: DebugMetricsRes
    objective_breakdown: Optional[dict[str, int]] = None
    # B3/B5 — single-mode transparency for the UI.
    tier_values: Optional[dict[str, float]] = None
    pillars: Optional[dict] = None
    binding_constraints: Optional[list[dict]] = None
    # B4 — Pareto "what-if" alternatives for the trade-off explorer.
    alternatives: Optional[list[dict]] = None


# ---- /audit (server-side eligibility audit) -------------------------------
#
# Replaces the controller's per-(employee, shift) `simulate()` fan-out
# (~5 000 round-trips for a 50-shift × 103-employee audit) with a single
# server-side computation. Uses the same `employee_eligible` filter the
# solver uses, plus identifies the *specific* reason each pair was
# rejected so the UI can show a meaningful violation type.

class AuditReq(BaseModel):
    """Audit a target subset of shifts against a candidate employee pool.

    `target_shift_ids` is the subset to audit (typically the uncovered
    shifts from a previous /optimize run). When omitted, every shift is
    audited.
    """
    shifts: list[ShiftReq]
    employees: list[EmployeeReq]
    constraints: ConstraintsReq = Field(default_factory=ConstraintsReq)
    target_shift_ids: Optional[list[str]] = None


class AuditEmployeeRow(BaseModel):
    employee_id: str
    status: str            # 'PASS' | 'FAIL'
    rejection_reasons: list[str]


class AuditShiftRow(BaseModel):
    shift_id: str
    rejection_summary: dict[str, int]  # reason → count
    employees: list[AuditEmployeeRow]


class AuditRes(BaseModel):
    audited_shift_count: int
    rows: list[AuditShiftRow]
    elapsed_ms: float


# =============================================================================
# APP
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info('Superman OR-Tools optimizer service v2 started')
    yield
    logger.info('Superman OR-Tools optimizer service stopped')


app = FastAPI(
    title='Superman Workforce Optimizer v2',
    description=(
        'Production CP-SAT solver for shift assignment optimization.\n\n'
        'PROPOSALS ONLY — never writes to the database.\n'
        'TypeScript compliance engine validates every proposal before DB commit.'
    ),
    version='2.0.0',
    lifespan=lifespan,
)

# Phase 3: install CORS allowlist, rate limiter, OpenTelemetry, and the
# auth-posture banner all in one call. Replaces the previous wide-open
# `allow_origins=['*']` middleware. See `security.py` for the env-driven
# config (OPTIMIZER_CORS_ORIGINS, OPTIMIZER_RATE_*, SUPABASE_JWT_SECRET,
# OTEL_EXPORTER_OTLP_ENDPOINT).
install_security(app)

# =============================================================================
# ROUTES
# =============================================================================

@app.get('/metrics', include_in_schema=False)
def prometheus_metrics():
    """Prometheus scrape endpoint — no auth required (standard scraper contract).

    Returns all registered metrics in the Prometheus text exposition format.
    Should be scraped by your Prometheus/VictoriaMetrics instance, NOT
    exposed to the public internet — protect it at the network/firewall layer.
    """
    body, content_type = metrics_response()
    return Response(content=body, media_type=content_type)


@app.get('/health')
def health_check():
    """Liveness probe — process is up. Cheap; no auth, no rate limit.

    K8s should use this for `livenessProbe`. Use `/ready` for
    `readinessProbe` (which also checks JWT + OR-Tools availability).
    """
    try:
        from ortools.sat.python import cp_model  # noqa: F401
        return {
            'status': 'ok',
            'engine': 'CP-SAT',
            'version': '2.0.0',
            'or_tools': 'available',
        }
    except ImportError:
        raise HTTPException(status_code=503, detail='OR-Tools not available')


@app.get('/ready')
def ready_check():
    """Readiness probe — service can actually accept traffic.

    K8s should use this for `readinessProbe`. Returns 503 (not 200)
    when JWT is misconfigured, so the deployment manager refuses to
    route traffic to a misconfigured pod.
    """
    status = readiness_status()
    if not status['ready']:
        raise HTTPException(status_code=503, detail=status)
    return status


@app.post('/optimize', response_model=OptimizeRes)
@limiter.limit(RATE_OPTIMIZE)
async def optimize(
    request: Request,
    auth: AuthContext = Depends(require_auth),
) -> OptimizeRes:
    """
    Run the CP-SAT optimizer and return proposed shift assignments.

    Requires a valid Supabase JWT in `Authorization: Bearer <token>`
    (or OPTIMIZER_AUTH_DISABLED=true for dev). Rate-limited per principal
    (JWT sub, falling back to IP) via OPTIMIZER_RATE_OPTIMIZE (default
    30/minute). Concurrency-capped per process via
    OPTIMIZER_MAX_CONCURRENT_SOLVES (default 2); returns 429 when
    saturated so the caller can retry or fall back to greedy.

    The CP-SAT solve is offloaded to a worker thread via
    anyio.to_thread.run_sync so the event loop remains responsive to
    /health, /ready, and /metrics during a long 30–90 s solve.
    """
    # Correlation ID — accept the client's X-Request-ID and prefix every
    # log line for this request. When a user reports a bad run, grep this
    # ID across browser console, optimizer container logs, and any
    # downstream writers.
    request_id = request.headers.get('X-Request-ID') or '-'
    rid = f'[rid={request_id[:8]} sub={auth.subject[:8]}]'

    try:
        raw_body = await request.json()
        logger.info("%s [optimize] Raw request body received", rid)
        req = OptimizeReq(**raw_body)
    except Exception as e:
        logger.error("%s [optimize] Pydantic validation failed: %s", rid, e)
        raise HTTPException(status_code=400, detail=f"Validation Error: {e}")
    if not req.shifts:
        raise HTTPException(status_code=400, detail='shifts list is empty')
    if not req.employees:
        raise HTTPException(status_code=400, detail='employees list is empty')
    if len(req.shifts) > 5000:
        raise HTTPException(status_code=400, detail='Max 5000 shifts per request')
    if len(req.employees) > 1000:
        raise HTTPException(status_code=400, detail='Max 1000 employees per request')

    logger.info(
        '%s [optimize] %d shifts × %d employees | time_limit=%.1fs workers=%d hint=%s',
        rid, len(req.shifts), len(req.employees),
        req.solver_params.max_time_seconds,
        req.solver_params.num_workers,
        req.solver_params.enable_greedy_hint,
    )

    # ── Concurrency cap ─────────────────────────────────────────────────────
    # Try to acquire immediately (non-blocking). If the semaphore is
    # saturated, return 429 so the caller can retry or fall back to greedy.
    if _solve_semaphore.locked():
        optimize_requests_total.labels(status='rejected_capacity').inc()
        raise HTTPException(
            status_code=429,
            detail=(
                f'Optimizer at capacity ({_MAX_CONCURRENT_SOLVES} concurrent solves). '
                'Retry after the current solves complete.'
            ),
        )

    def _build_employee(e: EmployeeReq) -> EmployeeInput:
        payload = e.model_dump()
        existing = [
            ExistingShiftInput(**{
                k: v for k, v in es.items()
                if k in ExistingShiftInput.__dataclass_fields__
            })
            for es in payload.pop('existing_shifts', []) or []
        ]
        slots = [
            AvailabilitySlotInput(**{
                k: v for k, v in s.items()
                if k in AvailabilitySlotInput.__dataclass_fields__
            })
            for s in payload.pop('availability_slots', []) or []
        ]
        return EmployeeInput(
            **{
                k: v for k, v in payload.items()
                if k in EmployeeInput.__dataclass_fields__
                and k not in ('existing_shifts', 'availability_slots')
            },
            existing_shifts=existing,
            availability_slots=slots,
        )

    data = OptimizerInput(
        shifts=[ShiftInput(**{k: v for k, v in s.model_dump().items() if k in ShiftInput.__dataclass_fields__}) for s in req.shifts],
        employees=[_build_employee(e) for e in req.employees],
        constraints=OptimizerConstraints(**{k: v for k, v in req.constraints.model_dump().items() if k in OptimizerConstraints.__dataclass_fields__}),
        strategy=StrategyInput(**{k: v for k, v in req.strategy.model_dump().items() if k in StrategyInput.__dataclass_fields__}) if hasattr(req, 'strategy') else StrategyInput(),
        solver_params=SolverParameters(**{k: v for k, v in req.solver_params.model_dump().items() if k in SolverParameters.__dataclass_fields__}),
    )

    # ── Offload CPU-bound solve to a worker thread ───────────────────────────
    # anyio.to_thread.run_sync releases the event loop for the entire
    # duration of build_and_solve (30–90 s), keeping /health, /ready, and
    # /metrics responsive under load.
    t_start = time.perf_counter()
    try:
        async with _solve_semaphore:
            optimize_in_progress.inc()
            try:
                builder = ScheduleModelBuilder(data)
                output = await anyio.to_thread.run_sync(
                    builder.build_and_solve,
                    abandon_on_cancel=False,  # CP-SAT manages its own timeout
                )
            finally:
                optimize_in_progress.dec()
    except Exception as exc:
        logger.exception('%s [optimize] Unexpected error: %s', rid, exc)
        optimize_requests_total.labels(status='error').inc()
        raise HTTPException(status_code=500, detail=f'Solver error: {exc}')

    solve_wall_seconds = time.perf_counter() - t_start

    m = output.metrics
    coverage_rate = len(output.assignments) / max(len(req.shifts), 1)

    # ── Record Prometheus metrics ────────────────────────────────────────────
    optimize_requests_total.labels(status=output.status).inc()
    optimize_solve_seconds.observe(solve_wall_seconds)
    optimize_coverage_rate.observe(coverage_rate)
    if output.status == 'INFEASIBLE':
        optimize_infeasible_total.inc()
    elif output.status == 'UNKNOWN':
        optimize_unknown_total.inc()

    logger.info(
        '%s [optimize] status=%s assignments=%d unassigned=%d coverage=%.0f%% '
        'vars=%d constraints=%d pre=%.1fms solve=%.1fms wall=%.1fs obj=%.1f',
        rid,
        output.status, len(output.assignments), len(output.unassigned_shift_ids),
        coverage_rate * 100,
        m.final_variables, m.num_constraints,
        m.preprocess_ms, m.solve_ms, solve_wall_seconds, output.objective_value,
    )

    return OptimizeRes(
        status=output.status,
        assignments=[
            AssignmentRes(shift_id=a.shift_id, employee_id=a.employee_id,
                          employment_type=a.employment_type, cost=a.cost,
                          rationale=getattr(a, 'rationale', None))
            for a in output.assignments
        ],
        unassigned_shift_ids=output.unassigned_shift_ids,
        objective_value=output.objective_value,
        best_objective_bound=output.best_objective_bound,
        proven_optimal=output.proven_optimal,
        debug=DebugMetricsRes(
            raw_pairs=m.raw_pairs,
            eligible_pairs=m.eligible_pairs,
            rest_eliminated_pairs=m.rest_eliminated_pairs,
            final_variables=m.final_variables,
            num_constraints=m.num_constraints,
            greedy_hint_applied=m.greedy_hint_applied,
            preprocess_ms=m.preprocess_ms,
            solve_ms=m.solve_ms,
            coverage_rate=round(coverage_rate, 3),
        ),
        objective_breakdown=output.objective_breakdown,
        tier_values=getattr(output, 'tier_values', None),
        pillars=getattr(output, 'pillars', None),
        binding_constraints=getattr(output, 'binding_constraints', None),
        alternatives=getattr(output, 'alternatives', None),
    )


# =============================================================================
# AUDIT
# =============================================================================
#
# This is the C3 fix from the audit doc. Previously the TS controller
# made one bulk-assignment-controller.simulate() call per (employee,
# shift) pair to populate the "why is this shift uncovered?" report —
# at 50 audited shifts × 103 employees that's ~5 000 round-trips,
# typically 2+ minutes wall-clock. The same eligibility logic already
# runs in the solver's `employee_eligible()`. Exposing it via /audit
# collapses everything into a single server-side computation.
#
# The handler returns one row per audited shift, with a per-employee
# breakdown of the rejection reason (or PASS).
#
# Note: this audit covers SOLVER-SIDE eligibility only. The downstream
# V8 compliance engine still runs in the browser to catch divergent
# rules (qualifications expiry, complex multi-rule interactions).
# C3 reduces the *bulk* of audit work from O(N×M) RPCs to O(1).

def _explain_eligibility(
    emp: EmployeeInput, shift: ShiftInput, c: OptimizerConstraints,
) -> list[str]:
    """Run the same checks as `employee_eligible` but return REASON CODES
    instead of a bool. Empty list = eligible.

    Reason codes intentionally mirror the violation types surfaced by the
    TS bulk-validator so the UI can render them with existing labels.
    """
    reasons: list[str] = []

    # Calendar-day unavailability
    if shift.shift_date in emp.unavailable_dates:
        reasons.append('UNAVAILABLE_DATE')

    # Role / skill / license
    if c.enforce_role_match and shift.role_id:
        if shift.role_id not in emp.contracted_role_ids:
            reasons.append('ROLE_MISMATCH')
    if c.enforce_skill_match and shift.required_skill_ids:
        if not set(shift.required_skill_ids).issubset(set(emp.skill_ids)):
            reasons.append('QUALIFICATION_MISSING')
    if c.enforce_skill_match and shift.required_license_ids:
        if not set(shift.required_license_ids).issubset(set(emp.license_ids)):
            reasons.append('QUALIFICATION_MISSING')

    # Existing-shift overlap / rest gap
    if emp.existing_shifts and existing_blocks_proposal(
        shift, emp.existing_shifts, c.min_rest_minutes,
    ):
        if not c.relax_constraints:
            reasons.append('REST_GAP')



    # Min engagement floor
    if shift.duration_minutes < 60:
        reasons.append('SHIFT_TOO_SHORT')

    # HARD availability override windows
    for start, end, severity in emp.availability_overrides:
        if severity == 'HARD':
            s0, s1 = shift_window(shift)
            a0 = _time_to_abs_minutes(shift.shift_date, start)
            a1 = _time_to_abs_minutes(shift.shift_date, end)
            if a1 <= a0:
                a1 += 1440
            if s0 < a1 and a0 < s1:
                reasons.append('HARD_AVAILABILITY_BLOCK')
                break

    # Declared availability slots (HC-5d)
    if emp.has_availability_data:
        s0, s1 = shift_window(shift)
        covered = False
        for slot in emp.availability_slots:
            if slot.slot_date != shift.shift_date:
                continue
            a0 = _time_to_abs_minutes(slot.slot_date, slot.start_time)
            a1 = _time_to_abs_minutes(slot.slot_date, slot.end_time)
            if a1 <= a0:
                a1 += 1440
            if a0 <= s0 and a1 >= s1:
                covered = True
                break
        if not covered:
            reasons.append('OUTSIDE_DECLARED_AVAILABILITY')

    return reasons


@app.post('/audit', response_model=AuditRes)
@limiter.limit(RATE_AUDIT)
async def audit(
    request: Request,
    auth: AuthContext = Depends(require_auth),
) -> AuditRes:
    """Server-side eligibility audit — replaces the per-pair TS RPC fan-out.

    Returns, for each requested shift, the eligibility status of every
    employee in the candidate pool plus the specific rejection reason(s).

    Auth: same Supabase JWT contract as /optimize. Rate limit:
    OPTIMIZER_RATE_AUDIT (default 60/minute per principal).

    For large payloads (50 shifts × 1000 employees = 50 000 comparisons)
    the Python loop can occupy the thread for tens of milliseconds. The
    computation is offloaded to a worker thread so the event loop stays
    responsive.
    """
    request_id = request.headers.get('X-Request-ID') or '-'
    rid = f'[rid={request_id[:8]} sub={auth.subject[:8]}]'

    try:
        raw_body = await request.json()
        req = AuditReq(**raw_body)
    except Exception as e:
        logger.error('%s [audit] Pydantic validation failed: %s', rid, e)
        raise HTTPException(status_code=400, detail=f'Validation Error: {e}')

    if not req.shifts:
        raise HTTPException(status_code=400, detail='shifts list is empty')
    if not req.employees:
        raise HTTPException(status_code=400, detail='employees list is empty')

    # Reuse the optimize endpoint's payload→dataclass adapter so the
    # eligibility logic sees identical inputs to the solver.
    def _build_employee(e: EmployeeReq) -> EmployeeInput:
        payload = e.model_dump()
        existing = [
            ExistingShiftInput(**{
                k: v for k, v in es.items()
                if k in ExistingShiftInput.__dataclass_fields__
            })
            for es in payload.pop('existing_shifts', []) or []
        ]
        slots = [
            AvailabilitySlotInput(**{
                k: v for k, v in s.items()
                if k in AvailabilitySlotInput.__dataclass_fields__
            })
            for s in payload.pop('availability_slots', []) or []
        ]
        return EmployeeInput(
            **{
                k: v for k, v in payload.items()
                if k in EmployeeInput.__dataclass_fields__
                and k not in ('existing_shifts', 'availability_slots')
            },
            existing_shifts=existing,
            availability_slots=slots,
        )

    shifts_dc = [
        ShiftInput(**{
            k: v for k, v in s.model_dump().items()
            if k in ShiftInput.__dataclass_fields__
        })
        for s in req.shifts
    ]
    employees_dc = [_build_employee(e) for e in req.employees]
    constraints_dc = OptimizerConstraints(**{
        k: v for k, v in req.constraints.model_dump().items()
        if k in OptimizerConstraints.__dataclass_fields__
    })

    target_ids = set(req.target_shift_ids) if req.target_shift_ids else None
    targets = [s for s in shifts_dc if target_ids is None or s.id in target_ids]

    def _run_audit() -> tuple[list[AuditShiftRow], float]:
        """Pure-Python eligibility loop — runs in a worker thread."""
        t0 = time.perf_counter()
        rows: list[AuditShiftRow] = []
        for shift in targets:
            summary: dict[str, int] = {}
            emp_rows: list[AuditEmployeeRow] = []
            for emp in employees_dc:
                reasons = _explain_eligibility(emp, shift, constraints_dc)
                if reasons:
                    for r in reasons:
                        summary[r] = summary.get(r, 0) + 1
                    emp_rows.append(AuditEmployeeRow(
                        employee_id=emp.id, status='FAIL', rejection_reasons=reasons,
                    ))
                else:
                    # Pass at the eligibility level — solver still chose not
                    # to assign, which is recorded by the controller as
                    # OPTIMIZER_TRADEOFF in the final UI summary.
                    emp_rows.append(AuditEmployeeRow(
                        employee_id=emp.id, status='PASS', rejection_reasons=[],
                    ))
            rows.append(AuditShiftRow(
                shift_id=shift.id,
                rejection_summary=summary,
                employees=emp_rows,
            ))
        elapsed = round((time.perf_counter() - t0) * 1000, 2)
        return rows, elapsed

    try:
        rows, elapsed_ms = await anyio.to_thread.run_sync(_run_audit, abandon_on_cancel=False)
        audit_requests_total.labels(status='ok').inc()
    except Exception as exc:
        logger.exception('%s [audit] Unexpected error: %s', rid, exc)
        audit_requests_total.labels(status='error').inc()
        raise HTTPException(status_code=500, detail=f'Audit error: {exc}')

    logger.info(
        '%s [audit] %d targets × %d employees → %d rows in %.1fms',
        rid, len(targets), len(employees_dc), len(rows), elapsed_ms,
    )

    return AuditRes(
        audited_shift_count=len(rows),
        rows=rows,
        elapsed_ms=elapsed_ms,
    )


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(
        'ortools_runner:app',
        host='0.0.0.0',
        port=5005,
        reload=True,
        log_level='info',
    )
