-- Supplement to the baseline schema.
--
-- `supabase db dump` captures only the user (public) schema, so this trigger —
-- which lives on `auth.users` — is not present in 20251015000000_baseline_schema.sql.
-- The trigger function `public.handle_new_user()` IS in the baseline; only the
-- binding on auth.users was missing. Without it, a freshly provisioned database
-- would silently skip profile creation on user signup.
--
-- Verified against production (project srfozdlphoempdattvtx): this is the single
-- application-relevant trigger outside the public schema; the rest are
-- Supabase-managed (cron / realtime / storage) and provided by the base image.

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
