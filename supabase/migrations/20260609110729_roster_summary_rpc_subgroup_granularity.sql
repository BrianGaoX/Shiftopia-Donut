DROP FUNCTION IF EXISTS public.get_roster_summary(uuid,date,date,uuid[],uuid[]);

CREATE OR REPLACE FUNCTION public.get_roster_summary(
  p_organization_id uuid,
  p_start_date      date,
  p_end_date        date,
  p_department_ids  uuid[] DEFAULT NULL,
  p_sub_department_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  shift_date        date,
  group_type        text,
  sub_group_name    text,
  total_shifts      int,
  assigned_shifts   int,
  open_shifts       int,
  published_shifts  int,
  draft_shifts      int,
  cancelled_shifts  int,
  total_net_minutes  bigint,
  unique_employees  int
)
LANGUAGE sql STABLE
AS $$
  SELECT
    s.shift_date,
    s.group_type::text,
    s.sub_group_name::text,
    COUNT(*)::int                                            AS total_shifts,
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::int AS assigned_shifts,
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NULL)::int    AS open_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status = 'Published')::int  AS published_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status = 'Draft')::int      AS draft_shifts,
    COUNT(*) FILTER (WHERE s.is_cancelled)::int                    AS cancelled_shifts,
    COALESCE(SUM(s.net_length_minutes), 0)::bigint                 AS total_net_minutes,
    COUNT(DISTINCT s.assigned_employee_id)::int                    AS unique_employees
  FROM shifts s
  WHERE s.organization_id = p_organization_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND s.deleted_at IS NULL
    AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
    AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  GROUP BY s.shift_date, s.group_type, s.sub_group_name
  ORDER BY s.shift_date, s.group_type, s.sub_group_name;
$$;

DROP INDEX IF EXISTS idx_shifts_summary_covering;
CREATE INDEX IF NOT EXISTS idx_shifts_summary_covering
ON shifts (organization_id, shift_date, group_type, sub_group_name)
INCLUDE (assigned_employee_id, lifecycle_status, is_cancelled, net_length_minutes, deleted_at)
WHERE deleted_at IS NULL;
