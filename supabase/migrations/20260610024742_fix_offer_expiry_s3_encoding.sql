-- S3 (offered) is encoded as Published + assigned + assignment_outcome NULL
-- (the enum value 'offered' is never written by the app), so this function's
-- `assignment_outcome = 'offered'` filter matched nothing and offers never
-- auto-expired (latent stuck "S3*"). Match the real S3 encoding instead.
CREATE OR REPLACE FUNCTION public.fn_process_offer_expirations()
 RETURNS TABLE(res_shift_id uuid, from_state text, to_state text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift       RECORD;
    v_new_state   TEXT := 'S2';
    v_shift_start TIMESTAMPTZ;
BEGIN
    FOR v_shift IN
        SELECT s.*
        FROM public.shifts s
        WHERE s.lifecycle_status   = 'Published'
          AND s.assignment_status  = 'assigned'
          AND s.assignment_outcome IS NULL
          AND s.deleted_at         IS NULL
          AND (
              (s.offer_expires_at IS NOT NULL AND s.offer_expires_at < NOW())
              OR
              (
                COALESCE(
                    s.start_at,
                    (s.shift_date::TEXT || ' ' || s.start_time::TEXT)::TIMESTAMP
                        AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
                ) < (NOW() + INTERVAL '4 hours')
              )
          )
        FOR UPDATE SKIP LOCKED
    LOOP
        v_shift_start := COALESCE(
            v_shift.start_at,
            (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP
                AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
        );

        UPDATE public.shift_offers
        SET
            status         = 'Expired',
            responded_at   = NOW(),
            response_notes = CASE
                WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                    THEN 'Auto-expired: deadline passed'
                ELSE 'Auto-retracted: 4h pre-shift lockout reached'
            END
        WHERE shift_id = v_shift.id
          AND status   = 'Pending';

        UPDATE public.shifts
        SET
            lifecycle_status     = 'Draft',
            assignment_status    = 'assigned',
            assignment_outcome   = NULL,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            is_on_bidding        = FALSE,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            updated_at           = NOW(),
            last_modified_reason = CASE
                WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                    THEN 'Offer expired - Reverted to Draft Assigned'
                ELSE '4h Lockout - Auto-retracted to Draft Assigned'
            END
        WHERE id = v_shift.id;

        res_shift_id := v_shift.id;
        from_state   := 'S3';
        to_state     := v_new_state;
        RETURN NEXT;
    END LOOP;
END;
$function$;
