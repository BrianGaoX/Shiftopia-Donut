-- F1 — Longitudinal Fairness Ledger.
--
-- Tracks cumulative fairness metrics per employee over a rolling window
-- (default 91 days / 1 quarter). The optimizer reads pre-computed `debt`
-- values (rolling_value − team_average) as per-employee objective
-- coefficients so someone who worked the last 3 Sundays is biased toward
-- a weekend off in this week's solve.
--
-- Metrics tracked:
--   weekend_shifts          — count of Sat/Sun shifts assigned
--   night_shifts            — count of shifts overlapping 00:00–06:00
--   public_holiday_shifts   — count of shifts on public holidays
--   overtime_minutes        — minutes beyond contracted weekly hours
--   total_hours             — total hours worked
--
-- Row cardinality: one row per (org, employee, metric, window_end).
-- Updated incrementally on every commit; full-rebuild available.
--
-- Applied to project srfozdlphoempdattvtx (Shiftopia) on 2026-06-15.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.fairness_ledger (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid NOT NULL,
    employee_id     uuid NOT NULL,
    metric          text NOT NULL,
    window_start    date NOT NULL,
    window_end      date NOT NULL,
    rolling_value   numeric NOT NULL DEFAULT 0,
    team_average    numeric NOT NULL DEFAULT 0,
    debt            numeric NOT NULL DEFAULT 0,
    last_updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by_run  uuid
);

-- Composite unique: one row per (org, employee, metric, window_end).
-- CREATE UNIQUE INDEX is idempotent with IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fairness_ledger_unique
    ON public.fairness_ledger (organization_id, employee_id, metric, window_end);

-- Lookup: fetch all employee debts for a given org+metric+window.
CREATE INDEX IF NOT EXISTS idx_fairness_ledger_lookup
    ON public.fairness_ledger (organization_id, metric, window_end);

-- Per-employee history lookup.
CREATE INDEX IF NOT EXISTS idx_fairness_ledger_employee
    ON public.fairness_ledger (employee_id, metric);

COMMENT ON TABLE public.fairness_ledger IS
    'F1: Longitudinal fairness ledger — cumulative per-employee fairness metrics over a rolling window.';
COMMENT ON COLUMN public.fairness_ledger.metric IS
    'Fairness dimension: weekend_shifts | night_shifts | public_holiday_shifts | overtime_minutes | total_hours';
COMMENT ON COLUMN public.fairness_ledger.rolling_value IS
    'Accumulated metric value for this employee in the window.';
COMMENT ON COLUMN public.fairness_ledger.team_average IS
    'Average of rolling_value across all employees in the team at last update.';
COMMENT ON COLUMN public.fairness_ledger.debt IS
    'rolling_value − team_average. Positive = employee has done more than average (owed rest). Negative = done less (owes work).';

-- RLS: the ledger holds whole-team fairness data — restrict to managers/admins
-- (consistent with other operational tables). service_role bypasses RLS for
-- server-side recompute jobs. Guarded so the migration stays idempotent.
-- NOTE: this is manager-gated, not org-scoped — cross-org isolation for a true
-- multi-tenant deployment should add an `organization_id = <caller's org>` clause.
ALTER TABLE public.fairness_ledger ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fairness_ledger'
          AND policyname = 'fairness_ledger_manager_all'
    ) THEN
        CREATE POLICY fairness_ledger_manager_all ON public.fairness_ledger
            FOR ALL TO authenticated
            USING (public.is_manager_or_above() OR public.is_admin())
            WITH CHECK (public.is_manager_or_above() OR public.is_admin());
    END IF;
END $$;
