-- Atomic multi-pair bulk assignment + idempotency layer.
--
-- Adds two objects:
--
--   1. public.bulk_assign_idempotency  — lightweight dedup table (key, result,
--      created_at). RLS is intentionally OFF: the table is only accessible via
--      the sm_bulk_assign_atomic SECURITY DEFINER function below, so there is
--      no direct-query path for any client. Keeping RLS off avoids a policy
--      round-trip inside the hot commit path.
--
--   2. public.sm_bulk_assign_atomic(p_assignments, p_user_id, p_idempotency_key)
--      — SECURITY DEFINER function that:
--        a. Applies the SAME authorization gate as sm_bulk_assign (mirrors
--           the C1 fix in 20260613000000_harden_sm_bulk_assign.sql exactly).
--        b. Short-circuits and returns the stored result if p_idempotency_key
--           is not null and already present in bulk_assign_idempotency.
--        c. Iterates every { employee_id, shift_ids[] } pair and applies the
--           SAME UPDATE with the SAME lost-update guard as sm_bulk_assign.
--        d. Returns a structured jsonb result with per-employee breakdowns.
--        e. On any hard error the implicit plpgsql transaction rolls back the
--           entire batch (atomicity). Shifts held by a different employee are
--           NOT errors — they are surfaced as conflicts.
--        f. Stores the result in bulk_assign_idempotency when a key was given.
--
-- Authorization pattern (mirrors sm_bulk_assign exactly):
--   Gate on auth.uid() — never the caller-supplied p_user_id (spoof prevention).
--   NULL caller = service-role/system context → allowed.

-- =============================================================================
-- IDEMPOTENCY TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bulk_assign_idempotency (
    key        uuid         NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now(),
    result     jsonb        NOT NULL,
    CONSTRAINT pk_bulk_assign_idempotency PRIMARY KEY (key)
);

-- RLS is deliberately OFF (see header note above).
ALTER TABLE public.bulk_assign_idempotency DISABLE ROW LEVEL SECURITY;

-- Expire old records after 24 h via a partial index (for potential future
-- cron cleanup). The primary key already covers lookup by key.
CREATE INDEX IF NOT EXISTS idx_bulk_assign_idempotency_created_at
    ON public.bulk_assign_idempotency (created_at);

-- =============================================================================
-- ATOMIC BULK ASSIGN FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sm_bulk_assign_atomic(
    p_assignments      jsonb,
    p_user_id          uuid    DEFAULT auth.uid(),
    p_idempotency_key  uuid    DEFAULT NULL
)
RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_caller        uuid := auth.uid();
    v_user_name     text;
    v_user_role     text;

    -- iteration vars
    v_pair          jsonb;
    v_employee_id   uuid;
    v_shift_ids     uuid[];
    v_pair_total    int;
    v_pair_success  int;
    v_pair_conflicts jsonb; -- array of uuid strings

    -- accumulation across all pairs
    v_total_requested   int := 0;
    v_total_success     int := 0;
    v_total_conflict    int := 0;
    v_per_employee      jsonb := '[]'::jsonb;
    v_all_conflicts     jsonb := '[]'::jsonb;

    -- updated rows per pair
    v_updated_ids       uuid[];
    v_shift_id          uuid;
    v_final_result      jsonb;

    -- idempotency
    v_stored_result     jsonb;
BEGIN
    -- ── Idempotency short-circuit ────────────────────────────────────────────
    IF p_idempotency_key IS NOT NULL THEN
        SELECT result INTO v_stored_result
        FROM public.bulk_assign_idempotency
        WHERE key = p_idempotency_key;

        IF FOUND THEN
            RETURN v_stored_result;
        END IF;
    END IF;

    -- ── Authorization (mirrors sm_bulk_assign C1 fix exactly) ────────────────
    -- Gate on the real caller, never the spoofable p_user_id. Manager = a
    -- manager/admin by role column, or an active gamma+ access cert.
    -- NULL caller = service-role/system context → allowed (see header note).
    IF v_caller IS NOT NULL AND NOT (
           public.is_manager_or_above()
           OR public.is_admin()
           OR EXISTS (
                SELECT 1 FROM public.app_access_certificates c
                WHERE c.user_id = v_caller
                  AND c.is_active = true
                  AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
              )
         ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Not authorized to assign shifts',
            'total_requested', 0,
            'success_count', 0,
            'conflict_count', 0,
            'conflicts', '[]'::jsonb,
            'per_employee', '[]'::jsonb
        );
    END IF;

    -- ── Resolve audit attribution ────────────────────────────────────────────
    IF p_user_id IS NOT NULL THEN
        SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
               left(lower(legacy_system_role::text), 50)
        INTO v_user_name, v_user_role
        FROM public.profiles
        WHERE id = p_user_id;
    ELSE
        v_user_name := 'System';
        v_user_role := 'system_automation';
    END IF;

    -- ── Iterate assignment pairs ─────────────────────────────────────────────
    -- p_assignments is a JSON array: [{ "employee_id": uuid, "shift_ids": [uuid,...] }, ...]
    FOR v_pair IN SELECT * FROM jsonb_array_elements(p_assignments)
    LOOP
        v_employee_id := (v_pair->>'employee_id')::uuid;
        v_shift_ids   := ARRAY(
            SELECT (elem::text)::uuid
            FROM jsonb_array_elements_text(v_pair->'shift_ids') AS elem
        );
        v_pair_total    := array_length(v_shift_ids, 1);
        v_pair_success  := 0;
        v_pair_conflicts := '[]'::jsonb;
        v_updated_ids   := '{}';

        -- Guard against empty shift_ids array (array_length returns NULL for empty)
        IF v_pair_total IS NULL OR v_pair_total = 0 THEN
            CONTINUE;
        END IF;

        v_total_requested := v_total_requested + v_pair_total;

        -- ── The core UPDATE — mirrors sm_bulk_assign column-for-column ───────
        -- Lost-update guard: only claim shifts that are unassigned OR already
        -- held by this employee (idempotent re-apply). Shifts held by another
        -- employee fall through to the conflict list below.
        WITH updated_rows AS (
            UPDATE public.shifts s SET
                assigned_employee_id = v_employee_id,
                assignment_status    = 'assigned'::public.shift_assignment_status,
                assignment_outcome   = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN 'confirmed'::public.shift_assignment_outcome
                                         ELSE s.assignment_outcome
                                       END,
                emergency_source     = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN public.set_emergency_source(
                                                  'NORMAL_ASSIGN',
                                                  EXTRACT(EPOCH FROM (s.scheduled_start - NOW()))::int,
                                                  s.emergency_source)
                                         ELSE s.emergency_source
                                       END,
                confirmed_at         = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN NOW()
                                         ELSE s.confirmed_at
                                       END,
                updated_at           = NOW(),
                last_modified_by     = p_user_id
            WHERE s.id = ANY(v_shift_ids)
              AND s.deleted_at IS NULL
              -- Lost-update guard (same as sm_bulk_assign): never overwrite a
              -- shift already held by a different employee.
              AND (s.assigned_employee_id IS NULL OR s.assigned_employee_id = v_employee_id)
            RETURNING s.id
        )
        SELECT array_agg(id) INTO v_updated_ids FROM updated_rows;

        -- Normalise NULL (no rows updated) → empty array
        IF v_updated_ids IS NULL THEN
            v_updated_ids := '{}';
        END IF;

        v_pair_success := array_length(v_updated_ids, 1);
        IF v_pair_success IS NULL THEN v_pair_success := 0; END IF;

        -- Build conflict list: requested - updated = held by someone else
        FOREACH v_shift_id IN ARRAY v_shift_ids LOOP
            IF NOT (v_shift_id = ANY(v_updated_ids)) THEN
                v_pair_conflicts := v_pair_conflicts || to_jsonb(v_shift_id::text);
                v_all_conflicts  := v_all_conflicts  || to_jsonb(v_shift_id::text);
            END IF;
        END LOOP;

        v_total_success  := v_total_success  + v_pair_success;
        v_total_conflict := v_total_conflict + (v_pair_total - v_pair_success);

        v_per_employee := v_per_employee || jsonb_build_object(
            'employee_id', v_employee_id,
            'committed',   v_pair_success,
            'conflicts',   v_pair_conflicts
        );
    END LOOP;

    -- ── Assemble final result ────────────────────────────────────────────────
    v_final_result := jsonb_build_object(
        'success',         true,
        'total_requested', v_total_requested,
        'success_count',   v_total_success,
        'conflict_count',  v_total_conflict,
        'conflicts',       v_all_conflicts,
        'per_employee',    v_per_employee
    );

    -- ── Idempotency store ────────────────────────────────────────────────────
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.bulk_assign_idempotency (key, result)
        VALUES (p_idempotency_key, v_final_result)
        ON CONFLICT (key) DO NOTHING; -- race-safe: another concurrent call won
    END IF;

    RETURN v_final_result;

EXCEPTION WHEN OTHERS THEN
    -- Any hard error rolls back the implicit plpgsql transaction for all
    -- UPDATE statements in this call (atomicity guarantee).
    RAISE WARNING 'Error in sm_bulk_assign_atomic: %', SQLERRM;
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'total_requested', v_total_requested,
        'success_count', 0,
        'conflict_count', 0,
        'conflicts', '[]'::jsonb,
        'per_employee', '[]'::jsonb
    );
END;
$$;

-- =============================================================================
-- GRANTS — mirror the grant block style used by the baseline for sm_bulk_assign
-- =============================================================================

-- Revoke any accidental public access first
REVOKE ALL ON FUNCTION public.sm_bulk_assign_atomic(jsonb, uuid, uuid) FROM PUBLIC;

-- Allow authenticated users and service_role (server-side automation)
GRANT EXECUTE ON FUNCTION public.sm_bulk_assign_atomic(jsonb, uuid, uuid)
    TO authenticated, service_role;

-- The idempotency table is accessed ONLY through the SECURITY DEFINER function
-- above, so we do NOT grant direct table access to authenticated or anon.
GRANT SELECT, INSERT ON TABLE public.bulk_assign_idempotency TO service_role;
