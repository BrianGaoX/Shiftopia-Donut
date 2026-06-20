-- The Cutaway — seed/guard updates + backfill of existing templates & rosters.
-- Runs after 20260609010000 (enum value committed). None of the statements here
-- reference the 'the_cutaway' enum literal directly (roster_groups.external_id is
-- text; template_groups.name is text), so this is safe in a single transaction.

-- 1. Guard: permit the four standard ICC Sydney groups (was three).
CREATE OR REPLACE FUNCTION public.enforce_exactly_three_groups()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NEW.external_id NOT IN ('convention_centre', 'exhibition_centre', 'theatre', 'the_cutaway') OR NEW.external_id IS NULL THEN
        RAISE EXCEPTION 'Only standard ICC Sydney groups (Convention, Exhibition, Theatre, The Cutaway) are allowed. Attempted to add: %', NEW.name;
    END IF;
    RETURN NEW;
END;
$function$;

-- 2. Active seed trigger fn (on roster_templates): seed four groups.
CREATE OR REPLACE FUNCTION public.fn_seed_fixed_template_groups()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
BEGIN
    INSERT INTO public.template_groups (template_id, name, color, icon, sort_order)
    VALUES
        (NEW.id, 'Convention Centre', '#3b82f6', 'building',     1),
        (NEW.id, 'Exhibition Centre', '#22c55e', 'layout-grid',  2),
        (NEW.id, 'Theatre',           '#ef4444', 'theater',      3),
        (NEW.id, 'The Cutaway',       '#f59e0b', 'film',         4);
    RETURN NEW;
END;
$function$;

-- 3. Legacy seed fn (not currently wired to a trigger) kept in sync.
CREATE OR REPLACE FUNCTION public.seed_fixed_template_groups()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    INSERT INTO template_groups (template_id, name, color, icon, sort_order)
    VALUES
        (NEW.id, 'Convention Centre', '#3b82f6', 'building',    1),
        (NEW.id, 'Exhibition Centre', '#10b981', 'layout-grid', 2),
        (NEW.id, 'Theatre',           '#8b5cf6', 'theater',     3),
        (NEW.id, 'The Cutaway',       '#f59e0b', 'film',        4);
    RETURN NEW;
END;
$function$;

-- 4. Protect The Cutaway from rename like the other fixed groups.
CREATE OR REPLACE FUNCTION public.protect_fixed_roster_groups()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF OLD.name IN ('Convention Centre', 'Exhibition Centre', 'Theatre', 'The Cutaway') THEN
        IF TG_OP = 'UPDATE' AND NEW.name != OLD.name THEN
            RAISE EXCEPTION 'Renaming of fixed group "%" is not allowed.', OLD.name;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

-- 5. Backfill existing templates with The Cutaway.
INSERT INTO public.template_groups (template_id, name, color, icon, sort_order)
SELECT rt.id, 'The Cutaway', '#f59e0b', 'film',
       COALESCE((SELECT max(tg.sort_order) FROM public.template_groups tg WHERE tg.template_id = rt.id), 0) + 1
FROM public.roster_templates rt
WHERE NOT EXISTS (
    SELECT 1 FROM public.template_groups tg
    WHERE tg.template_id = rt.id AND tg.name = 'The Cutaway'
);

-- 6. Backfill existing rosters with a The Cutaway roster_group.
INSERT INTO public.roster_groups (roster_id, name, external_id, sort_order)
SELECT r.id, 'The Cutaway', 'the_cutaway',
       COALESCE((SELECT max(rg.sort_order) FROM public.roster_groups rg WHERE rg.roster_id = r.id), -1) + 1
FROM public.rosters r
WHERE NOT EXISTS (
    SELECT 1 FROM public.roster_groups rg
    WHERE rg.roster_id = r.id AND rg.external_id = 'the_cutaway'
);
