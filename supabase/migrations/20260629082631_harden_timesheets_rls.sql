-- R3: Harden legacy timesheets RLS policies.
--
-- The previous policies used USING (true) / WITH CHECK (true), allowing
-- authenticated users to read, create, or update other employees'
-- timesheets.
--
-- Rules:
--   - employees can view only their own timesheets;
--   - employees can create timesheets only for themselves;
--   - employees can update only their own timesheets.

ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view timesheets" ON public.timesheets;

DROP POLICY IF EXISTS "Employees can create timesheets" ON public.timesheets;

DROP POLICY IF EXISTS "Employees can update their timesheets" ON public.timesheets;


CREATE POLICY "Authenticated users can view timesheets"
ON public.timesheets
FOR SELECT
TO authenticated
USING (
    profile_id = (SELECT auth.uid())
);

CREATE POLICY "Employees can create timesheets"
ON public.timesheets
FOR INSERT
TO authenticated
WITH CHECK (
    profile_id = (SELECT auth.uid())
);


CREATE POLICY "Employees can update their timesheets"
ON public.timesheets
FOR UPDATE
TO authenticated
USING (
    profile_id = (SELECT auth.uid())
    AND status = ANY (
        ARRAY[
            'draft'::public.timesheet_status,
            'rejected'::public.timesheet_status
        ]
    )
)
WITH CHECK (
    profile_id = (SELECT auth.uid())
);


COMMENT ON POLICY "Authenticated users can view timesheets" ON public.timesheets
IS 'R3: replaces USING (true) with employee own-row visibility.';


COMMENT ON POLICY "Employees can create timesheets" ON public.timesheets
IS 'R3: replaces WITH CHECK (true) with employee own-row creation.';


COMMENT ON POLICY "Employees can update their timesheets" ON public.timesheets
IS 'R3: replaces USING/WITH CHECK (true) with employee own-row updates.';