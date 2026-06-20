-- =====================================================================
-- Performance metrics fix — Part 2 of 4: idempotent backfill of shift_events
-- =====================================================================
-- Reconstructs the offer-behaviour ledger from current shift state so historical
-- ignored offers (and any confirmed/declined ones) appear on the Performance page.
-- Every INSERT is guarded by NOT EXISTS so this migration is safe to re-run.
-- All backfilled rows carry metadata.backfill = 'perf_2026_06' and can be undone with:
--   DELETE FROM public.shift_events WHERE metadata->>'backfill' = 'perf_2026_06';
--
-- Prod sizing at authoring time (srfozdlphoempdattvtx):
--   805 Draft+assigned shifts (ignored offers); 789 already have an OFFERED event;
--   0 have an IGNORED event. 0 confirmed / 0 declined / 0 cancelled / 0 no-show in data,
--   so the ACCEPTED/REJECTED backfills below are future-proofing (0 rows today).
-- =====================================================================

-- 1. OFFERED — ensure every reverted-to-Draft assigned shift has an OFFERED event,
--    so the ignorance-rate denominator (offered) is never short of its IGNORED count.
INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
SELECT s.id, s.assigned_employee_id, 'OFFERED',
       COALESCE(s.offer_sent_at, s.updated_at, now()),
       jsonb_build_object('backfill', 'perf_2026_06', 'reason', 'reverted_offer_missing_offered')
FROM public.shifts s
WHERE s.lifecycle_status = 'Draft'
  AND s.assigned_employee_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.shift_events e
      WHERE e.shift_id = s.id AND e.event_type = 'OFFERED'
  );

-- 2. IGNORED — the headline fix: the reverted-to-Draft assigned shifts are ignored offers.
INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
SELECT s.id, s.assigned_employee_id, 'IGNORED',
       COALESCE(s.offer_expires_at, s.updated_at, now()),
       jsonb_build_object('backfill', 'perf_2026_06', 'reason', 'reverted_to_draft')
FROM public.shifts s
WHERE s.lifecycle_status = 'Draft'
  AND s.assigned_employee_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.shift_events e
      WHERE e.shift_id = s.id AND e.event_type = 'IGNORED'
  );

-- 3. ACCEPTED — confirmed assignments lacking the event (future-proof).
INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
SELECT s.id, s.assigned_employee_id, 'ACCEPTED',
       COALESCE(s.confirmed_at, s.assigned_at, s.updated_at, now()),
       jsonb_build_object('backfill', 'perf_2026_06')
FROM public.shifts s
WHERE s.assignment_outcome = 'confirmed'
  AND s.assigned_employee_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.shift_events e
      WHERE e.shift_id = s.id AND e.event_type = 'ACCEPTED'
  );

-- 4. REJECTED — declined offers recorded only via shifts.last_rejected_by (future-proof).
INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
SELECT s.id, s.last_rejected_by, 'REJECTED',
       COALESCE(s.updated_at, now()),
       jsonb_build_object('backfill', 'perf_2026_06', 'reason', 'last_rejected_by')
FROM public.shifts s
WHERE s.last_rejected_by IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.shift_events e
      WHERE e.shift_id = s.id AND e.event_type = 'REJECTED' AND e.employee_id = s.last_rejected_by
  );

-- 5. Populate the (never-refreshed, WITH NO DATA) daily metrics matview.
--    First population must be non-concurrent.
REFRESH MATERIALIZED VIEW public.employee_daily_metrics;
