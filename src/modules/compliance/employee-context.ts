/**
 * Employee Context Loader
 *
 * Builds V8EmployeeContext and fetches a full shift history for any employee,
 * using a SECURITY DEFINER RPC so cross-department shifts are always visible
 * regardless of the calling manager's RLS scope.
 *
 * Used by all assignment entry points that need to run V2 compliance checks.
 */

import { supabase } from '@/platform/realtime/client';
import { format, addDays, subDays, parseISO } from 'date-fns';
import type { ContractRecordV2, QualificationV2, ContractType } from './v8/types';
import type { V8EmployeeContext, V8OrchestratorShift } from './v8/orchestrator/types';

// =============================================================================
// SESSION-SCOPED CACHE  (TTL: 5 minutes per entry)
// Avoids N+1 fetches when checking compliance for multiple bids in one session.
// =============================================================================

interface CacheEntry {
    ctx:       V8EmployeeContext;
    expiresAt: number;   // Date.now() ms
}

const CACHE_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const _contextCache = new Map<string, CacheEntry>();

/** Invalidate the in-memory cache for a specific employee (call on profile update). */
export function invalidateEmployeeContextCache(employeeId: string): void {
    _contextCache.delete(employeeId);
}

/** Wipe the entire cache (e.g. on logout). */
export function clearEmployeeContextCache(): void {
    _contextCache.clear();
}

// =============================================================================
// EMPLOYEE CONTEXT
// =============================================================================

/**
 * Fetch the V8EmployeeContext needed by the V2 compliance engine.
 *
 * Data sources (all parallel):
 *   - profiles           → contract_type, contracted_weekly_hours
 *   - user_contracts     → full contract records (org + dept + sub_dept + role)
 *                          — primary source for R10 hierarchy matching
 *   - employee_skills    → skill qualifications + expiry
 *   - employee_licenses  → license qualifications + expiry + student-visa flag
 *
 * R10 contract matching strategy:
 *   user_contracts rows are loaded as ContractRecordV2[].
 *   R10 checks (org_id ∩ dept_id ∩ sub_dept_id ∩ role_id) against the
 *   candidate shift — only matching on dimensions the shift provides.
 *
 * Results are cached for 5 minutes per employee to prevent N+1 queries
 * when compliance is run across many bids in the same session.
 */
export async function fetchV8EmployeeContext(
    employeeId: string,
): Promise<V8EmployeeContext> {
    // --- Cache check ---
    const cached = _contextCache.get(employeeId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.ctx;
    }

    const [profileRes, contractsRes, skillsRes, licensesRes] = await Promise.all([
        supabase
            .from('profiles')
            .select('id, employment_type')
            .eq('id', employeeId)
            .single(),
        supabase
            .from('user_contracts')
            .select('organization_id, department_id, sub_department_id, role_id')
            .eq('user_id', employeeId)
            .eq('status', 'active'),
        supabase
            .from('employee_skills')
            .select('skill_id, expiration_date')
            .eq('employee_id', employeeId),
        supabase
            .from('employee_licenses')
            .select('license_id, expiration_date, issue_date, has_restricted_work_limit, license_type')
            .eq('employee_id', employeeId),
    ]);

    const profile  = profileRes.data;
    const rawContracts = contractsRes.data ?? [];
    const skills   = skillsRes.data ?? [];
    const licenses = licensesRes.data ?? [];

    // Determine contract type — map DB employment_type enum to ContractType,
    // then visa flag override, then default to CASUAL.
    const rawType = (profile?.employment_type || '').toLowerCase().replace(/[-_]/g, ' ');
    const employmentTypeMap: Record<string, ContractType> = {
        'full time':   'FULL_TIME',
        'full_time':   'FULL_TIME', // fallback
        'part time':   'PART_TIME',
        'part_time':   'PART_TIME', // fallback
        'casual':      'CASUAL',
        'contractual': 'CASUAL',
    };
    let contract_type: ContractType =
        (employmentTypeMap[rawType] || (profile?.employment_type as any)) ?? 'CASUAL';
    
    // Explicit safety for Title-Case variants that might bypass normalization
    if (!employmentTypeMap[rawType]) {
        if (/full/i.test(rawType)) contract_type = 'FULL_TIME';
        else if (/part/i.test(rawType)) contract_type = 'PART_TIME';
    }

    const hasStudentVisa = licenses.some(
        l => l.license_type === 'WorkRights' && l.has_restricted_work_limit === true,
    );
    if (hasStudentVisa) contract_type = 'STUDENT_VISA';

    // Build qualifications array — skills and licenses share the same shape.
    const FALLBACK_ISSUED = '2000-01-01';
    const qualifications: QualificationV2[] = [
        ...skills.map(s => ({
            qualification_id: s.skill_id as string,
            issued_at:        FALLBACK_ISSUED,
            expires_at:       (s.expiration_date as string | null) ?? null,
        })),
        ...licenses.map(l => ({
            qualification_id: l.license_id as string,
            issued_at:        (l.issue_date as string | null) ?? FALLBACK_ISSUED,
            expires_at:       (l.expiration_date as string | null) ?? null,
        })),
    ];

    // Map user_contracts rows to ContractRecordV2 — source of truth for R10.
    const contracts: ContractRecordV2[] = rawContracts
        .filter((c: any) => c.organization_id && c.department_id && c.role_id)
        .map((c: any) => ({
            organization_id:   c.organization_id as string,
            department_id:     c.department_id as string,
            sub_department_id: (c.sub_department_id as string | null) ?? null,
            role_id:           c.role_id as string,
        }));

    // Derive assigned_role_ids from contracts for backward compat.
    const assigned_role_ids = [...new Set(contracts.map(c => c.role_id))];

    const ctx: V8EmployeeContext = {
        employee_id:             employeeId,
        contract_type,
        contracted_weekly_hours: 0,
        assigned_role_ids,
        contracts,
        qualifications,
    };

    // Cache the result
    _contextCache.set(employeeId, { ctx, expiresAt: Date.now() + CACHE_TTL_MS });

    return ctx;
}

// =============================================================================
// SHIFT HISTORY  (via SECURITY DEFINER RPC — cross-department safe)
// =============================================================================

/**
 * Fetch the employee's assigned shift history via the SECURITY DEFINER RPC.
 *
 * Uses `get_employee_shift_window` (same RPC as useHardValidation) so that
 * shifts assigned across ALL departments are visible regardless of the
 * caller's RLS scope.
 *
 * @param employeeId   Target employee
 * @param centerDate   YYYY-MM-DD date to centre the window on
 * @param windowDays   Days either side of centerDate (default 35)
 * @param excludeV8ShiftId  Optional: shift ID to exclude (for edit scenarios)
 */
export async function fetchEmployeeShiftsV2(
    employeeId: string,
    centerDate: string,
    windowDays = 35,
    excludeV8ShiftId: string | null = null,
): Promise<V8OrchestratorShift[]> {
    const center   = centerDate ? parseISO(centerDate) : new Date();
    const startDate = format(subDays(center, windowDays), 'yyyy-MM-dd');
    const endDate   = format(addDays(center, windowDays), 'yyyy-MM-dd');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_employee_shift_window', {
        p_employee_id: employeeId,
        p_start_date:  startDate,
        p_end_date:    endDate,
        p_exclude_id:  excludeV8ShiftId,
    });

    if (error || !data) return [];

    return (data as Array<{
        id:                   string;
        shift_date:           string;
        start_time:           string;
        end_time:             string;
        unpaid_break_minutes: number | null;
    }>).map(s => ({
        id:                      s.id,
        date:                    s.shift_date,
        start_time:              s.start_time,
        end_time:                s.end_time,
        // Existing shifts don't need role/quals — time-based rules only.
        // R10/R11/R12 apply only to candidate (incoming) shifts.
        role_id:                 '',
        required_qualifications: [],
        is_ordinary_hours:       true,
        break_minutes:           s.unpaid_break_minutes ?? 0,
        unpaid_break_minutes:    s.unpaid_break_minutes ?? 0,
    }));
}
