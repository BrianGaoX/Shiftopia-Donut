-- =====================================================================
-- Performance metrics fix — Part 4 of 4: hygiene / drift repair
-- =====================================================================

-- 1. Define the missing refresh_employee_performance_metrics(uuid).
--    pg_cron job "refresh_performance_metrics_hourly" runs refresh_performance_metrics()
--    every hour, which loops active profiles and calls this function — which DID NOT
--    EXIST in the database. That cron has therefore been erroring every hour, which is
--    why only a handful of employee_performance_metrics rows existed. Defining it makes
--    the hourly refresh actually populate the table.
CREATE OR REPLACE FUNCTION public.refresh_employee_performance_metrics(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_qy text;
BEGIN
    v_qy := 'Q'||date_part('quarter',now())::int||'_'||date_part('year',now())::int;
    PERFORM public.compute_employee_quarter_metrics(p_employee_id, v_qy);
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_employee_performance_metrics(uuid) FROM PUBLIC;
GRANT  ALL ON FUNCTION public.refresh_employee_performance_metrics(uuid) TO authenticated;
GRANT  ALL ON FUNCTION public.refresh_employee_performance_metrics(uuid) TO service_role;

-- 2. Drop the dead, drifted calculate_employee_metrics(): it reads from
--    public.v_employee_metric_events, a view that does not exist anywhere (so the
--    function crashes if called) and has no callers. Removing it resolves the drift
--    cleanly rather than materialising a fake view.
DROP FUNCTION IF EXISTS public.calculate_employee_metrics(uuid, date, date);

-- ---------------------------------------------------------------------
-- NOTE (documented, intentionally NOT changed here):
--   * RLS on shift_events / employee_performance_metrics is permissive
--     (INSERT/UPDATE WITH CHECK (true)). Tightening it is a security change with
--     app-write blast radius (the non-DEFINER shifts trigger inserts events as the
--     invoking user) and is out of scope for this fix.
--   * Clock-in/out (sm_clock_in / sm_clock_out_shift) still do not record
--     CHECKED_IN / LATE_IN / EARLY_OUT events, and sm_clock_out_shift's precondition
--     (attendance_status IN ('checked_in','late')) is never satisfied by sm_clock_in.
--     The Performance report reads punctuality from `timesheets`, so this does not
--     affect the metrics today; it is a separate attendance-flow fix.
-- ---------------------------------------------------------------------
