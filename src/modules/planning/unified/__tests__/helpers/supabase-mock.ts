/**
 * Supabase query-builder mock for unit-testing the planning request service.
 *
 * Strategy: the builder is a thenable chainable object. Every terminal
 * operation (`.single()` or direct `await` on the chain) dequeues the next
 * response from a FIFO queue that the test pre-fills via `enqueue()`.
 *
 * Usage:
 *   const { client, enqueue } = createSupabaseMock();
 *
 *   // vi.mock must import this before the module under test
 *   vi.mock('@/platform/supabase/client', () => ({ supabase: client }));
 *
 *   // Arrange responses in call order
 *   enqueue({ data: shiftRow, error: null });
 *   enqueue({ data: requestRow, error: null });
 *   enqueue({ error: null });       // for fire-and-forget updates
 *
 *   // Act
 *   await planningRequestService.createPlanningRequest(...);
 */

import { vi } from 'vitest';

export type MockResult = { data?: unknown; error?: { message: string } | null };

export interface SupabaseMock {
  client: ReturnType<typeof buildClient>;
  enqueue: (...items: MockResult[]) => void;
  rpc: ReturnType<typeof vi.fn>;
  calls: string[];
}

function buildClient(queue: MockResult[], calls: string[], rpc: ReturnType<typeof vi.fn>) {
  function dequeue(): MockResult {
    const next = queue.shift();
    if (!next) {
      // Return a safe default so tests don't hang; log to help debugging
      console.warn('[supabase-mock] queue empty — returning { data: null, error: null }');
      return { data: null, error: null };
    }
    return next;
  }

  function makeChain(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      select:  () => chain,
      eq:      () => chain,
      neq:     () => chain,
      in:      (..._args: unknown[]) => chain,
      insert:  () => chain,
      update:  () => chain,
      upsert:  () => chain,
      delete:  () => chain,
      filter:  () => chain,
      order:   () => chain,
      limit:   () => chain,
      range:   () => chain,
      single:  () => Promise.resolve(dequeue()),
      // Thenable: lets `await chain` work without calling .single()
      then:    (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
                 Promise.resolve(dequeue()).then(resolve as (v: MockResult) => MockResult, reject),
    };
    return chain;
  }

  return {
    from: vi.fn().mockImplementation((table: string) => {
      calls.push(`from:${table}`);
      return makeChain(table);
    }),
    rpc,
  };
}

export function createSupabaseMock(): SupabaseMock {
  const queue: MockResult[] = [];
  const calls: string[] = [];
  const rpc = vi.fn().mockImplementation(() => Promise.resolve(dequeueFromQueue()));

  function dequeueFromQueue(): MockResult {
    return queue.shift() ?? { data: null, error: null };
  }

  const client = buildClient(queue, calls, rpc);

  return {
    client,
    enqueue: (...items: MockResult[]) => queue.push(...items),
    rpc,
    calls,
  };
}
