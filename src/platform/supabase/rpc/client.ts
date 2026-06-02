/**
 * Typed RPC client — the single entry point for all Supabase RPC calls.
 *
 * Every call through this client:
 *  1. Asserts the user is authenticated (throws AuthenticationError if not)
 *  2. Executes the RPC
 *  3. Maps Supabase error codes to typed AppErrors
 *  4. Validates the response shape with a Zod schema
 *  5. Returns the parsed, fully-typed value — never `any`
 *
 * This eliminates:
 *  - `supabase.rpc('name' as any, ...)`
 *  - `data as unknown as SomeType`
 *  - `user?.id || '00000000-...'` NULL UUID fallbacks
 */

import { z, ZodType } from 'zod';
import { supabase } from '@/platform/realtime/client';
import {
  AppError,
  AuthenticationError,
  PermissionError,
  toAppError,
  type RPCErrorCode,
} from './errors';

// ── Auth helper ────────────────────────────────────────────────────────────

/**
 * Assert the current user is authenticated and return their ID.
 * Throws AuthenticationError — never returns a NULL UUID fallback.
 */
export async function requireUser(): Promise<{ id: string; email: string | undefined }> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) throw new AuthenticationError();
  return { id: user.id, email: user.email };
}

// ── Supabase error → typed AppError mapper ─────────────────────────────────

const SUPABASE_CODE_MAP: Record<string, RPCErrorCode> = {
  '42501': 'PERMISSION_DENIED', // insufficient_privilege
  'PGRST116': 'NOT_FOUND',      // Row not found (PostgREST)
  '23505': 'CONFLICT',          // unique_violation
  '23503': 'VALIDATION',        // foreign_key_violation
  'P0001': 'STATE_TRANSITION',  // raise_exception from PL/pgSQL
  '40001': 'CONFLICT',          // serialization_failure — optimistic concurrency version mismatch
};

function mapSupabaseError(error: { code?: string; message: string; hint?: string }, rpcName: string): AppError {
  const code: RPCErrorCode = ((error.code && SUPABASE_CODE_MAP[error.code]) || 'RPC_NETWORK') as RPCErrorCode;
  return new AppError({
    code,
    message: error.message,
    rpcName,
    details: error.hint ? { hint: error.hint, pgCode: error.code } : { pgCode: error.code },
  });
}

// ── Core typed RPC call ────────────────────────────────────────────────────

/**
 * Execute a Supabase RPC with full type safety.
 *
 * @param rpcName      The Postgres function name
 * @param params       Input parameters (passed as-is to supabase.rpc)
 * @param outputSchema Zod schema that the response must satisfy
 * @returns            The parsed, typed response value
 * @throws             AppError on network, auth, permission, or schema errors
 */
export async function callRpc<TOutput>(
  rpcName: string,
  params: Record<string, unknown>,
  outputSchema: ZodType<TOutput>,
): Promise<TOutput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(rpcName, params);

  if (error) {
    throw mapSupabaseError(error, rpcName);
  }

  const parsed = outputSchema.safeParse(data);
  if (!parsed.success) {
    console.error('RPC_VALIDATION mismatch for', rpcName, 'Received data:', data, 'Issues:', parsed.error.issues);
    throw new AppError({
      code: 'RPC_VALIDATION',
      message: `RPC '${rpcName}' returned an unexpected shape — types may be out of sync`,
      rpcName,
      details: {
        issues: parsed.error.issues.slice(0, 5), // cap to avoid log noise
        received: typeof data,
      },
    });
  }

  return parsed.data;
}

/**
 * Execute an RPC that requires authentication.
 * Asserts auth, then delegates to callRpc.
 */
export async function callAuthenticatedRpc<TOutput>(
  rpcName: string,
  paramsFn: (userId: string) => Record<string, unknown>,
  outputSchema: ZodType<TOutput>,
): Promise<TOutput> {
  const user = await requireUser();
  return callRpc(rpcName, paramsFn(user.id), outputSchema);
}

// ── Convenience: RPC returning void / boolean ──────────────────────────────

export async function callVoidRpc(
  rpcName: string,
  params: Record<string, unknown>,
): Promise<void> {
  await callRpc(rpcName, params, z.unknown());
}

/**
 * Execute an authenticated RPC that returns no meaningful value.
 * Asserts auth, then calls the RPC, discarding the response.
 */
export async function callAuthenticatedVoidRpc(
  rpcName: string,
  paramsFn: (userId: string) => Record<string, unknown>,
): Promise<void> {
  const user = await requireUser();
  await callVoidRpc(rpcName, paramsFn(user.id));
}

// ── Re-exports ─────────────────────────────────────────────────────────────

export type { AppError, RPCErrorCode };
export { AppError as RPCError } from './errors';
