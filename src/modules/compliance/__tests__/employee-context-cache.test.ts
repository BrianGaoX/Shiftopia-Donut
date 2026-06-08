/**
 * Verifies the 5-minute in-memory cache on fetchV8EmployeeContext.
 *
 * The cache lives at module scope in `src/modules/compliance/employee-context.ts`
 * — it is process-shared, NOT recreated per component. We mock the supabase
 * client so we can assert how many round-trips each call generates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();

vi.mock('@/platform/supabase/client', () => ({
  supabase: {
    from: (...args: any[]) => fromMock(...args),
  },
}));

import {
  fetchV8EmployeeContext,
  invalidateEmployeeContextCache,
  clearEmployeeContextCache,
} from '../employee-context';

function makeBuilder(rows: any) {
  // The real supabase chain we mimic looks like:
  //   .from(t).select(c).eq(k,v).single()        for profiles
  //   .from(t).select(c).eq(k,v).eq(k,v)         for contracts
  //   .from(t).select(c).eq(k,v)                 for skills/licenses
  // Promises resolve to { data, error }. Returning a thenable mock builder
  // lets a single instance handle every chain shape.
  const result = Promise.resolve({ data: rows, error: null });
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    single: () => result,
    then: (resolve: any, reject: any) => result.then(resolve, reject),
  };
  return builder;
}

beforeEach(() => {
  clearEmployeeContextCache();
  fromMock.mockReset();
  // profiles, user_contracts, employee_skills, employee_licenses each get
  // their own builder; we don't care about the content shape for these tests.
  fromMock.mockImplementation((table: string) => {
    if (table === 'profiles')          return makeBuilder({ id: 'emp-1', employment_type: 'full_time' });
    if (table === 'user_contracts')    return makeBuilder([]);
    if (table === 'employee_skills')   return makeBuilder([]);
    if (table === 'employee_licenses') return makeBuilder([]);
    return makeBuilder(null);
  });
});

describe('fetchV8EmployeeContext cache', () => {
  it('issues 4 parallel table queries on the first call', async () => {
    await fetchV8EmployeeContext('emp-1');
    expect(fromMock).toHaveBeenCalledTimes(4);
    const tables = fromMock.mock.calls.map(c => c[0]).sort();
    expect(tables).toEqual([
      'employee_licenses',
      'employee_skills',
      'profiles',
      'user_contracts',
    ]);
  });

  it('issues 0 queries on the second call within the TTL', async () => {
    await fetchV8EmployeeContext('emp-1');
    fromMock.mockClear();
    await fetchV8EmployeeContext('emp-1');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('re-fetches after invalidation for that employee', async () => {
    await fetchV8EmployeeContext('emp-1');
    invalidateEmployeeContextCache('emp-1');
    fromMock.mockClear();
    await fetchV8EmployeeContext('emp-1');
    expect(fromMock).toHaveBeenCalledTimes(4);
  });

  it('caches per-employee independently', async () => {
    await fetchV8EmployeeContext('emp-1');
    fromMock.mockClear();
    await fetchV8EmployeeContext('emp-2');
    expect(fromMock).toHaveBeenCalledTimes(4);
    fromMock.mockClear();
    await fetchV8EmployeeContext('emp-1');
    expect(fromMock).not.toHaveBeenCalled();
  });
});
