-- R3: Harden existing Availability SELECT policies.
--
-- The previous policies used USING (true), allowing users to
-- read other employees' availability.
--
-- Employees should only read their own availability records.

ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all" ON public.availability_rules;
DROP POLICY IF EXISTS "Enable read access for all" ON public.availability_slots;

CREATE POLICY "Enable read access for all"
ON public.availability_rules
FOR SELECT
TO authenticated
USING (
    profile_id = (SELECT auth.uid())
);

CREATE POLICY "Enable read access for all"
ON public.availability_slots
FOR SELECT
TO authenticated
USING (
    profile_id = (SELECT auth.uid())
);

COMMENT ON POLICY "Enable read access for all" ON public.availability_rules
IS 'R3: replaces USING (true) with employee own-row availability rule visibility.';

COMMENT ON POLICY "Enable read access for all" ON public.availability_slots
IS 'R3: replaces USING (true) with employee own-row availability slot visibility.';