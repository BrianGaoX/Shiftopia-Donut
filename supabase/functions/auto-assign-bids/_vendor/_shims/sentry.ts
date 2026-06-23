// Deno shim for `@sentry/react`, imported (only) by the vendored
// v8 orchestrator/index.ts and audit.ts. The Edge Function does not run Sentry;
// these are no-ops so the pure compliance code loads unchanged.
//
// The orchestrator uses exactly: Sentry.getClient(), Sentry.addBreadcrumb().
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
