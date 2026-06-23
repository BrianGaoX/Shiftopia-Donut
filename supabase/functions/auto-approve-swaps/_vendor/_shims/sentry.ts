// Deno shim for `@sentry/react`, imported (transitively) by the vendored
// v8 engine. The swap pipeline (runSwapGuards + swapEvaluator) does not call
// Sentry directly, but the vendored v8 tree may reference it; these are no-ops
// so the pure compliance code loads unchanged under Deno.
//
// (Identical contract to supabase/functions/auto-assign-bids/_vendor/_shims/sentry.ts.)
export function getClient(): undefined {
  return undefined;
}
export function addBreadcrumb(_b: unknown): void {
  /* no-op */
}
export function captureException(_e: unknown): void {
  /* no-op */
}
export default { getClient, addBreadcrumb, captureException };
