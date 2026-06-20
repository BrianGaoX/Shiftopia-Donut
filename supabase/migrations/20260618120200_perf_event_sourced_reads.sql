-- =====================================================================
-- Performance metrics fix — Part 3 of 4: event-source the offer-behaviour metrics
-- =====================================================================
-- The offer metrics (offered / accepted / rejected / ignored) move from the
-- shift_bids + shift-column heuristics onto the immutable shift_events ledger, so
-- they survive the offer->Draft reversion that previously hid them.
--
-- Deliberately NARROW: assignment / cancellation / no-show stay on `shifts`,
-- late/early on `timesheets`, swaps on `shift_swaps`, and the bidding metrics
-- (total_bids / bids_accepted / bid_success_rate) stay on `shift_bids`. Those
-- sources are not affected by offer reversion, so they need no change and are
-- left untouched to avoid any regression. Function SIGNATURES are unchanged, so
-- no TypeScript / RPC changes are required.
-- =====================================================================

-- ---------------------------------------------------------------------
-- compute_employee_quarter_metrics: offer counts now come from shift_events.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_employee_quarter_metrics(p_employee_id uuid, p_quarter_year text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_start       date; v_end         date;
    v_year        int;  v_quarter     int;
    v_offered     int := 0; v_accepted int := 0; v_rejected int := 0; v_expired  int := 0;
    v_assigned    int := 0; v_emergency int := 0; v_worked   int := 0; v_swapped  int := 0;
    v_std_cancel  int := 0; v_late_cancel int := 0; v_no_show int := 0;
    v_late_in     int := 0; v_early_out int := 0;
BEGIN
    IF p_quarter_year = 'ALL_TIME' THEN
        v_start := '2000-01-01'; v_end := '2099-12-31';
    ELSE
        v_quarter := replace(split_part(p_quarter_year, '_', 1), 'Q', '')::int;
        v_year    := split_part(p_quarter_year, '_', 2)::int;
        SELECT qdr.v_start, qdr.v_end INTO v_start, v_end FROM quarter_date_range(v_year, v_quarter) qdr;
    END IF;

    -- Offer behaviour from the immutable event ledger (survives Draft reversion).
    SELECT COUNT(*) FILTER (WHERE e.event_type = 'OFFERED'),
           COUNT(*) FILTER (WHERE e.event_type = 'ACCEPTED'),
           COUNT(*) FILTER (WHERE e.event_type = 'REJECTED'),
           COUNT(*) FILTER (WHERE e.event_type = 'IGNORED')
    INTO v_offered, v_accepted, v_rejected, v_expired
    FROM shift_events e JOIN shifts s ON s.id = e.shift_id
    WHERE e.employee_id = p_employee_id AND s.shift_date BETWEEN v_start AND v_end;

    SELECT COUNT(*) FILTER (WHERE assignment_source = 'offer'),
           COUNT(*) FILTER (WHERE assignment_source = 'direct'),
           COUNT(*) FILTER (WHERE lifecycle_status = 'Completed'),
           COUNT(*) FILTER (WHERE is_cancelled AND cancelled_at IS NOT NULL AND scheduled_start IS NOT NULL AND (scheduled_start - cancelled_at) > interval '24 hours'),
           COUNT(*) FILTER (WHERE is_cancelled AND cancelled_at IS NOT NULL AND scheduled_start IS NOT NULL AND (scheduled_start - cancelled_at) <= interval '24 hours'),
           COUNT(*) FILTER (WHERE attendance_status = 'no_show' OR assignment_outcome = 'no_show')
    INTO v_assigned, v_emergency, v_worked, v_std_cancel, v_late_cancel, v_no_show
    FROM shifts WHERE assigned_employee_id = p_employee_id AND shift_date BETWEEN v_start AND v_end AND lifecycle_status != 'Draft';

    SELECT COUNT(*) INTO v_swapped FROM shift_swaps ss JOIN shifts s ON s.id = ss.requester_shift_id
    WHERE ss.requester_id = p_employee_id AND s.shift_date BETWEEN v_start AND v_end AND ss.status IN ('OPEN','OFFER_SELECTED','MANAGER_PENDING','APPROVED');

    SELECT COUNT(*) FILTER (WHERE t.clock_in  > s.scheduled_start + interval '5 minutes'),
           COUNT(*) FILTER (WHERE t.clock_out < s.scheduled_end   - interval '5 minutes')
    INTO v_late_in, v_early_out
    FROM timesheets t JOIN shifts s ON s.id = t.shift_id
    WHERE t.employee_id = p_employee_id AND s.shift_date BETWEEN v_start AND v_end AND t.clock_in IS NOT NULL AND t.clock_out IS NOT NULL;

    INSERT INTO employee_performance_metrics (
        employee_id, period_start, period_end, quarter_year,
        shifts_offered, shifts_accepted, shifts_rejected, offer_expirations,
        shifts_assigned, emergency_assignments, shifts_worked, shifts_swapped,
        standard_cancellations, late_cancellations, no_shows, late_clock_ins, early_clock_outs,
        acceptance_rate, rejection_rate, offer_expiration_rate,
        cancellation_rate_standard, cancellation_rate_late, swap_ratio, reliability_score,
        late_clock_in_rate, early_clock_out_rate, no_show_rate, calculated_at
    ) VALUES (
        p_employee_id, v_start, v_end, p_quarter_year,
        v_offered, v_accepted, v_rejected, v_expired,
        v_assigned, v_emergency, v_worked, v_swapped,
        v_std_cancel, v_late_cancel, v_no_show, v_late_in, v_early_out,
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_accepted::numeric/v_offered*100,2) END,
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_rejected::numeric/v_offered*100,2) END,
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_expired::numeric /v_offered*100,2) END,
        CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE ROUND(v_std_cancel::numeric /(v_assigned + v_emergency)*100,2) END,
        CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE ROUND(v_late_cancel::numeric/(v_assigned + v_emergency)*100,2) END,
        CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE ROUND(v_swapped::numeric   /(v_assigned + v_emergency)*100,2) END,
        GREATEST(0,LEAST(100,ROUND(100
            - CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE (v_std_cancel+v_late_cancel)::numeric/(v_assigned + v_emergency)*30 END
            - CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE v_late_cancel::numeric/(v_assigned + v_emergency)*20 END
            - CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE v_no_show::numeric   /(v_assigned + v_emergency)*40 END
            - CASE WHEN v_worked=0   THEN 0 ELSE v_late_in::numeric   /v_worked  *5  END
            - CASE WHEN v_worked=0   THEN 0 ELSE v_early_out::numeric /v_worked  *5  END
        ,2))),
        CASE WHEN v_worked=0   THEN 0 ELSE ROUND(v_late_in::numeric   /v_worked  *100,2) END,
        CASE WHEN v_worked=0   THEN 0 ELSE ROUND(v_early_out::numeric /v_worked  *100,2) END,
        CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE ROUND(v_no_show::numeric   /(v_assigned + v_emergency)*100,2) END,
        now()
    ) ON CONFLICT (employee_id, quarter_year) DO UPDATE SET
        period_start=EXCLUDED.period_start, period_end=EXCLUDED.period_end,
        shifts_offered=EXCLUDED.shifts_offered, shifts_accepted=EXCLUDED.shifts_accepted,
        shifts_rejected=EXCLUDED.shifts_rejected, offer_expirations=EXCLUDED.offer_expirations,
        shifts_assigned=EXCLUDED.shifts_assigned, emergency_assignments=EXCLUDED.emergency_assignments,
        shifts_worked=EXCLUDED.shifts_worked, shifts_swapped=EXCLUDED.shifts_swapped,
        standard_cancellations=EXCLUDED.standard_cancellations, late_cancellations=EXCLUDED.late_cancellations, no_shows=EXCLUDED.no_shows,
        late_clock_ins=EXCLUDED.late_clock_ins, early_clock_outs=EXCLUDED.early_clock_outs,
        acceptance_rate=EXCLUDED.acceptance_rate, rejection_rate=EXCLUDED.rejection_rate,
        offer_expiration_rate=EXCLUDED.offer_expiration_rate, cancellation_rate_standard=EXCLUDED.cancellation_rate_standard,
        cancellation_rate_late=EXCLUDED.cancellation_rate_late, swap_ratio=EXCLUDED.swap_ratio, reliability_score=EXCLUDED.reliability_score,
        late_clock_in_rate=EXCLUDED.late_clock_in_rate, early_clock_out_rate=EXCLUDED.early_clock_out_rate,
        no_show_rate=EXCLUDED.no_show_rate, calculated_at=now()
    WHERE NOT employee_performance_metrics.is_locked;
END;
$function$;

-- ---------------------------------------------------------------------
-- get_quarterly_performance_report: offer metrics from shift_events (offer_agg);
-- bidding metrics stay on shift_bids (bid_agg); everything else unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_quarterly_performance_report(p_year integer, p_quarter integer, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(employee_id uuid, employee_name text, total_offers integer, accepted integer, rejected integer, expired integer, assigned integer, emergency_assigned integer, cancel_standard integer, cancel_late integer, swap_out integer, late_clock_in integer, early_clock_out integer, no_show integer, completed integer, acceptance_rate numeric, rejection_rate numeric, ignorance_rate numeric, cancel_rate numeric, late_cancel_rate numeric, swap_rate numeric, reliability_score numeric, late_clock_in_rate numeric, early_clock_out_rate numeric, no_show_rate numeric, drop_rate numeric, total_bids integer, bids_accepted integer, bid_success_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_start date;
    v_end   date;
BEGIN
    SELECT qdr.v_start, qdr.v_end INTO v_start, v_end
    FROM quarter_date_range(p_year, p_quarter) qdr;

    RETURN QUERY
    WITH
    -- ── Activity CTEs ──────────────────────────────────────────────────────

    -- Potential assignments (Current + Dropped)
    assignment_events AS (
        -- (1) Current assignments
        SELECT
            s.assigned_employee_id          AS emp_id,
            s.id                            AS shift_id,
            s.lifecycle_status,
            s.attendance_status,
            s.assignment_outcome,
            s.assignment_source,
            s.is_cancelled,
            s.cancelled_at,
            s.scheduled_start,
            s.scheduled_end,
            COALESCE(t.clock_in, s.actual_start) AS clock_in_time,
            COALESCE(t.clock_out, s.actual_end)  AS clock_out_time,
            s.emergency_assigned_at,
            s.organization_id,
            s.department_id,
            s.sub_department_id,
            FALSE                           AS is_drop,
            NULL::timestamp                 AS dropped_at
        FROM shifts s
        LEFT JOIN timesheets t ON t.shift_id = s.id
        WHERE s.assigned_employee_id IS NOT NULL
          AND s.shift_date BETWEEN v_start AND v_end
          AND s.lifecycle_status != 'Draft'
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))

        UNION ALL

        -- (2) Dropped shifts
        SELECT
            s.last_dropped_by               AS emp_id,
            s.id                            AS shift_id,
            s.lifecycle_status,
            s.attendance_status,
            s.assignment_outcome,
            s.assignment_source,
            s.is_cancelled,
            s.cancelled_at,
            s.scheduled_start,
            s.scheduled_end,
            NULL::timestamp                 AS clock_in_time,
            NULL::timestamp                 AS clock_out_time,
            s.emergency_assigned_at,
            s.organization_id,
            s.department_id,
            s.sub_department_id,
            TRUE                            AS is_drop,
            s.updated_at                    AS dropped_at
        FROM shifts s
        WHERE s.last_dropped_by IS NOT NULL
          AND s.shift_date BETWEEN v_start AND v_end
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
    ),

    asgn_agg AS (
        SELECT
            emp_id,
            COUNT(*)                                                                    AS total_assigned_shifts,
            COUNT(*) FILTER (
                WHERE is_drop = FALSE
                  AND is_cancelled = FALSE
                  AND (assignment_source IS DISTINCT FROM 'direct' AND emergency_assigned_at IS NULL)
            )                                                                           AS current_assigned,
            COUNT(*) FILTER (
                WHERE is_drop = FALSE
                  AND is_cancelled = FALSE
                  AND (assignment_source = 'direct' OR emergency_assigned_at IS NOT NULL)
            )                                                                           AS emergency_count,
            COUNT(*) FILTER (WHERE is_drop = TRUE)                                      AS dropped_count,
            COUNT(*) FILTER (
                WHERE is_cancelled = true AND cancelled_at IS NOT NULL AND scheduled_start IS NOT NULL AND (scheduled_start - cancelled_at) > interval '24 hours'
            )                                                                           AS cancel_standard_count,
            COUNT(*) FILTER (
                WHERE is_cancelled = true AND cancelled_at IS NOT NULL AND scheduled_start IS NOT NULL AND (scheduled_start - cancelled_at) <= interval '24 hours'
            )                                                                           AS cancel_late_count,
            COUNT(*) FILTER (
                WHERE attendance_status = 'no_show' OR assignment_outcome = 'no_show'
            )                                                                           AS no_show_agg_count,
            COUNT(*) FILTER (WHERE lifecycle_status = 'Completed')                      AS completed_agg_count,
            COUNT(*) FILTER (WHERE lifecycle_status IN ('InProgress', 'Completed'))    AS started_agg_count,
            COUNT(*) FILTER (
                WHERE clock_in_time IS NOT NULL AND scheduled_start IS NOT NULL
                  AND clock_in_time > scheduled_start + interval '5 minutes'
            )                                                                           AS late_clock_in_count,
            COUNT(*) FILTER (
                WHERE clock_out_time IS NOT NULL AND scheduled_end IS NOT NULL
                  AND clock_out_time < scheduled_end - interval '5 minutes'
            )                                                                           AS early_clock_out_count
        FROM assignment_events
        GROUP BY emp_id
    ),

    -- Offer behaviour from the immutable event ledger (survives Draft reversion).
    -- Joined to shifts for quarter window + org/dept/subdept scoping.
    offer_agg AS (
        SELECT
            e.employee_id AS emp_id,
            COUNT(*) FILTER (WHERE e.event_type = 'OFFERED')  AS total_offers_sent,
            COUNT(*) FILTER (WHERE e.event_type = 'ACCEPTED') AS total_accepted,
            COUNT(*) FILTER (WHERE e.event_type = 'REJECTED') AS total_rejected,
            COUNT(*) FILTER (WHERE e.event_type = 'IGNORED')  AS total_expired
        FROM shift_events e
        JOIN shifts s ON s.id = e.shift_id
        WHERE s.shift_date BETWEEN v_start AND v_end
          AND e.event_type IN ('OFFERED','ACCEPTED','REJECTED','IGNORED')
          AND e.employee_id IS NOT NULL
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
        GROUP BY e.employee_id
    ),

    -- Bidding metrics stay sourced from shift_bids.
    bid_agg AS (
        SELECT
            sb.employee_id AS emp_id,
            COUNT(*)::int                                       AS total_bids,
            COUNT(*) FILTER (WHERE sb.status = 'accepted')::int AS bids_accepted
        FROM shift_bids sb
        JOIN shifts s ON s.id = sb.shift_id
        WHERE s.shift_date BETWEEN v_start AND v_end
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
        GROUP BY sb.employee_id
    ),

    swap_agg AS (
        SELECT
            ss.requester_id AS emp_id,
            COUNT(*)        AS total_swap_out
        FROM shift_swaps ss
        JOIN shifts s ON s.id = ss.requester_shift_id
        WHERE s.shift_date BETWEEN v_start AND v_end
          AND ss.status IN ('OPEN','OFFER_SELECTED','MANAGER_PENDING','APPROVED')
        GROUP BY ss.requester_id
    ),

    all_emps AS (
        SELECT emp_id FROM asgn_agg
        UNION
        SELECT emp_id FROM offer_agg
        UNION
        SELECT emp_id FROM bid_agg
        UNION
        SELECT emp_id FROM swap_agg
    )

    SELECT
        ae.emp_id                                               AS employee_id,
        COALESCE(prof.full_name, ae.emp_id::text)               AS employee_name,
        COALESCE(oa.total_offers_sent,    0)::int              AS total_offers,
        COALESCE(oa.total_accepted,       0)::int              AS accepted,
        COALESCE(oa.total_rejected,       0)::int              AS rejected,
        COALESCE(oa.total_expired,        0)::int              AS expired,
        COALESCE(aa.current_assigned,     0)::int              AS assigned,
        COALESCE(aa.emergency_count,0)::int                    AS emergency_assigned,
        COALESCE(aa.cancel_standard_count,0)::int              AS cancel_standard,
        COALESCE(aa.cancel_late_count,    0)::int              AS cancel_late,
        COALESCE(sa.total_swap_out,       0)::int              AS swap_out,
        COALESCE(aa.late_clock_in_count,  0)::int              AS late_clock_in,
        COALESCE(aa.early_clock_out_count,0)::int              AS early_clock_out,
        COALESCE(aa.no_show_agg_count,    0)::int              AS no_show,
        COALESCE(aa.completed_agg_count,  0)::int              AS completed,

        ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
              ELSE oa.total_accepted::numeric/oa.total_offers_sent*100 END,1) AS acceptance_rate,
        ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
              ELSE oa.total_rejected::numeric/oa.total_offers_sent*100 END,1) AS rejection_rate,
        ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
              ELSE oa.total_expired::numeric/oa.total_offers_sent*100 END,1)  AS ignorance_rate,

        ROUND(CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
              ELSE COALESCE(aa.cancel_standard_count,0)::numeric/aa.total_assigned_shifts*100 END,1) AS cancel_rate,
        ROUND(CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
              ELSE COALESCE(aa.cancel_late_count,0)::numeric/aa.total_assigned_shifts*100 END,1) AS late_cancel_rate,
        ROUND(CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
              ELSE COALESCE(sa.total_swap_out,0)::numeric/aa.total_assigned_shifts*100 END,1) AS swap_rate,

        GREATEST(0,LEAST(100,ROUND(
            100
            -CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
                  ELSE (COALESCE(aa.cancel_standard_count,0)+COALESCE(aa.cancel_late_count,0))::numeric/aa.total_assigned_shifts*30 END
            -CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
                  ELSE COALESCE(aa.cancel_late_count,0)::numeric/aa.total_assigned_shifts*20 END
            -CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
                  ELSE COALESCE(aa.no_show_agg_count,0)::numeric/aa.total_assigned_shifts*40 END
            -CASE WHEN COALESCE(aa.started_agg_count,0)=0 THEN 0
                  ELSE COALESCE(aa.late_clock_in_count,0)::numeric/aa.started_agg_count*5 END
            -CASE WHEN COALESCE(aa.started_agg_count,0)=0 THEN 0
                  ELSE COALESCE(aa.early_clock_out_count,0)::numeric/aa.started_agg_count*5 END
        ,1))) AS reliability_score,

        ROUND(CASE WHEN COALESCE(aa.started_agg_count,0)=0 THEN 0
              ELSE COALESCE(aa.late_clock_in_count,0)::numeric/aa.started_agg_count*100 END,1) AS late_clock_in_rate,
        ROUND(CASE WHEN COALESCE(aa.started_agg_count,0)=0 THEN 0
              ELSE COALESCE(aa.early_clock_out_count,0)::numeric/aa.started_agg_count*100 END,1) AS early_clock_out_rate,
        ROUND(CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
              ELSE COALESCE(aa.no_show_agg_count,0)::numeric/aa.total_assigned_shifts*100 END,1) AS no_show_rate,
        ROUND(CASE WHEN COALESCE(oa.total_accepted,0)=0 THEN 0
              ELSE COALESCE(aa.dropped_count,0)::numeric/oa.total_accepted*100 END,1) AS drop_rate,

        COALESCE(ba.total_bids, 0)::int AS total_bids,
        COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
        ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
              ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 1) AS bid_success_rate
    FROM all_emps ae
    LEFT JOIN profiles      prof ON prof.id   = ae.emp_id
    LEFT JOIN offer_agg     oa   ON oa.emp_id = ae.emp_id
    LEFT JOIN bid_agg       ba   ON ba.emp_id = ae.emp_id
    LEFT JOIN asgn_agg      aa   ON aa.emp_id = ae.emp_id
    LEFT JOIN swap_agg      sa   ON sa.emp_id = ae.emp_id
    ORDER BY employee_name;
END;
$function$;

-- ---------------------------------------------------------------------
-- refresh_all_performance_metrics: enroll everyone with ledger activity, so
-- offer-only / ignored-only employees (who have no non-Draft assigned shift)
-- still get an employee_performance_metrics row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_all_performance_metrics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_qy text; v_emp record;
BEGIN
    v_qy := 'Q'||date_part('quarter',now())::int||'_'||date_part('year',now())::int;
    FOR v_emp IN
        SELECT DISTINCT id FROM (
            SELECT assigned_employee_id AS id FROM shifts
            WHERE assigned_employee_id IS NOT NULL AND lifecycle_status != 'Draft'
            UNION
            SELECT employee_id AS id FROM shift_events WHERE employee_id IS NOT NULL
        ) q
        WHERE id IS NOT NULL
    LOOP
        PERFORM compute_employee_quarter_metrics(v_emp.id, v_qy);
    END LOOP;
END;
$function$;
