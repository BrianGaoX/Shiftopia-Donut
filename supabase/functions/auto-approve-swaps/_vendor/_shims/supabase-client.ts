// =============================================================================
// Deno shim for `@/platform/supabase/client`.
//
// Unlike the auto-assign-bids shim (which is a hard no-op because that pipeline
// is pure), the SWAP pipeline reuses `runSwapGuards`, which performs REAL DB
// reads through this exact `supabase` binding (guards.ts:21). A no-op client
// would make the guards fail OPEN (return zero violations) — the opposite of the
// worker's fail-closed contract.
//
// So this shim exposes an INJECTABLE binding: the worker builds a service-role
// SupabaseClient and calls `setComplianceSupabaseClient(service)` BEFORE invoking
// `runSwapGuards`. The vendored guards then run their real queries
// (shifts / profiles / shift_swaps) under the service role (RLS-blind — required
// so compliance cannot be blinded by RLS, per 00 D3).
//
// If the client was never injected, every property access throws — which the
// worker's try/catch converts into a fail-closed RETRY (never an approve). We
// intentionally do NOT silently degrade to a no-op here.
// =============================================================================

// The shape `runSwapGuards` uses is just `.from(table).select(...).in(...)...`,
// i.e. the standard supabase-js query builder. We accept anything that quacks
// like it (the injected service client does).
// deno-lint-ignore no-explicit-any
type AnySupabase = any;

let injected: AnySupabase | null = null;

/** Worker calls this once per process with a real service-role client. */
export function setComplianceSupabaseClient(client: AnySupabase): void {
  injected = client;
}

// A Proxy so that `import { supabase }` returns a stable binding, but every
// access is forwarded to the (later-)injected real client. Accessing it before
// injection throws — surfaced as a fail-closed error in the worker.
export const supabase: AnySupabase = new Proxy(
  {},
  {
    get(_t, prop) {
      if (!injected) {
        throw new Error(
          `[auto-approve-swaps] compliance supabase client used before injection (prop=${String(prop)}). ` +
            'Call setComplianceSupabaseClient(service) before runSwapGuards.',
        );
      }
      // deno-lint-ignore no-explicit-any
      const v = (injected as any)[prop];
      return typeof v === 'function' ? v.bind(injected) : v;
    },
  },
);

export default supabase;
