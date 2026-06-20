-- Feature C2 — promote service-level buffering to first-class demand_tensor columns.
--
-- Until now the C2 buffer (service level, added buffer, coverage confidence) was
-- recorded only inside the free-form `explanation` jsonb. Promoting it to typed
-- columns lets us query/report on coverage confidence and surface it as the
-- OI1 "coverage confidence score" without parsing strings.
--
-- All columns are NULLABLE: existing rows and any writer that omits the C2
-- buffer (service level <= 0.5, the default) leave them NULL, which reads as
-- "no buffer / median staffing" — fully backward-compatible.
--
-- Applied to project srfozdlphoempdattvtx (Shiftopia) on 2026-06-14.
-- Idempotent: safe to re-run (IF NOT EXISTS columns + guarded constraints).

ALTER TABLE public.demand_tensor
    ADD COLUMN IF NOT EXISTS service_level       numeric,   -- target P(scheduled >= demand), 0..1
    ADD COLUMN IF NOT EXISTS demand_buffer       integer,   -- headcount added above the point estimate (>= 0)
    ADD COLUMN IF NOT EXISTS coverage_confidence numeric;   -- modelled P(demand <= headcount), 0..1

COMMENT ON COLUMN public.demand_tensor.service_level IS
    'C2: target coverage confidence used to buffer this cell (0..1). NULL = no buffer applied (median).';
COMMENT ON COLUMN public.demand_tensor.demand_buffer IS
    'C2: extra headcount added above the point estimate to hit service_level. NULL/0 = none.';
COMMENT ON COLUMN public.demand_tensor.coverage_confidence IS
    'C2: modelled probability that the staffed headcount covers demand (0..1).';

-- Defensive range checks (only enforced for non-NULL values). Guarded so the
-- migration is idempotent — ADD CONSTRAINT has no IF NOT EXISTS form.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'demand_tensor_service_level_chk') THEN
        ALTER TABLE public.demand_tensor
            ADD CONSTRAINT demand_tensor_service_level_chk
            CHECK (service_level IS NULL OR (service_level >= 0 AND service_level <= 1)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'demand_tensor_coverage_conf_chk') THEN
        ALTER TABLE public.demand_tensor
            ADD CONSTRAINT demand_tensor_coverage_conf_chk
            CHECK (coverage_confidence IS NULL OR (coverage_confidence >= 0 AND coverage_confidence <= 1)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'demand_tensor_demand_buffer_chk') THEN
        ALTER TABLE public.demand_tensor
            ADD CONSTRAINT demand_tensor_demand_buffer_chk
            CHECK (demand_buffer IS NULL OR demand_buffer >= 0) NOT VALID;
    END IF;
END $$;
