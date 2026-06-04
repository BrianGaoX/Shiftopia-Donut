-- F4: Composite index for the primary shift list query pattern.
--
-- The roster page queries shifts as:
--   WHERE organization_id = X AND shift_date BETWEEN Y AND Z AND deleted_at IS NULL
--
-- Without this index, Postgres performs a sequential scan on the shifts table.
-- At 1M rows, that takes ~3-5 seconds per query. This partial composite index
-- reduces the scan to a targeted B-tree lookup.
--
-- CONCURRENTLY avoids locking the table during creation on a live database.
-- The partial clause (WHERE deleted_at IS NULL) excludes soft-deleted rows,
-- making the index smaller and faster.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_org_date
ON public.shifts (organization_id, shift_date)
WHERE deleted_at IS NULL;

-- Secondary index for the delta sync RPC which queries by updated_at.
-- The get_shift_delta RPC filters: WHERE organization_id = X AND updated_at > since.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_org_updated_at
ON public.shifts (organization_id, updated_at)
WHERE deleted_at IS NULL;

-- Covering index for department-scoped queries (common in filtered views).
-- Covers: WHERE organization_id = X AND department_id = Y AND shift_date BETWEEN ...
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_org_dept_date
ON public.shifts (organization_id, department_id, shift_date)
WHERE deleted_at IS NULL;
