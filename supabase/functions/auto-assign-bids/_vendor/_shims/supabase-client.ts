// Deno shim for `@/platform/supabase/client`, imported (only) by the vendored
// v8 orchestrator/audit.ts (`logComplianceRejection` → fire-and-forget DB insert
// into `compliance_rejections`, plus an `auth.getUser()` read).
//
// In the Edge Function the engine runs under the SERVICE ROLE and we do NOT want
// the per-candidate compliance simulation to write its own audit rows — the
// run's own `assignment_decisions` / `assignment_events` are the audit of record
// (01 §3.9). So this stub returns a harmless no-op client: getUser() yields a
// null user, and `.from(...).insert(...)` resolves to `{ data: null, error: null }`.
//
// IMPORTANT: audit.ts is explicitly written to never throw, so a no-op here is
// safe. If you ever DO want compliance-level rejection rows persisted from the
// Edge Function, replace this stub with a real service-role client (and inject
// the actor id) rather than re-wiring audit.ts.

type Thenable<T> = { then: (resolve: (v: T) => void) => void };

function resolved<T>(value: T): Thenable<T> {
  return { then: (resolve) => resolve(value) };
}

const noopQuery = {
  insert: (_rows: unknown) => resolved({ data: null, error: null }),
  select: () => noopQuery,
  eq: () => noopQuery,
  in: () => noopQuery,
  maybeSingle: () => resolved({ data: null, error: null }),
};

export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
  },
  from: (_table: string) => noopQuery,
};

export default supabase;
