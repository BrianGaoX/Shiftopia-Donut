-- Composite index for sub_department-scoped shift list queries.
--
-- The rosters page filters by sub_department_ids more often than by department
-- alone — that's how managers operate day-to-day. The existing indexes cover
-- (organization_id, shift_date) and (organization_id, department_id, shift_date)
-- but NOT (organization_id, sub_department_id, shift_date). At 1M+ shifts across
-- 30+ sub-departments, Postgres falls back to a less selective index plus a
-- recheck filter, which is materially slower than a dedicated partial index.
--
-- CONCURRENTLY avoids locking the table on a live database; IF NOT EXISTS makes
-- this migration idempotent. The partial WHERE clause keeps the index small by
-- excluding soft-deleted rows.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_org_subdept_date
ON public.shifts (organization_id, sub_department_id, shift_date)
WHERE deleted_at IS NULL;
