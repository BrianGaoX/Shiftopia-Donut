/**
 * OR-Tools Optimizer HTTP Client
 *
 * Sends scheduling problems to the Python CP-SAT service and returns
 * the proposed assignment solution.
 *
 * The service URL defaults to VITE_OPTIMIZER_URL (set in .env.local)
 * or falls back to http://localhost:8080.
 *
 * Never writes to the database — only proposes assignments.
 */

import { supabase } from '@/platform/supabase/client';
import type {
    OptimizeRequest,
    OptimizeResponse,
    OptimizerHealth,
    AuditRequest,
    AuditResponse,
} from '../types';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_OPTIMIZER_URL = 'http://localhost:5005';

function getOptimizerUrl(): string {
    return (import.meta.env.VITE_OPTIMIZER_URL as string | undefined)
        ?? DEFAULT_OPTIMIZER_URL;
}

/**
 * Resolve the current user's Supabase JWT and return it as an
 * Authorization header value. Phase 3 — the optimizer service rejects
 * unauthenticated calls in production.
 *
 * Returns `null` (not throw) when no session is available; the caller
 * decides whether to send the request anyway. In local dev with
 * OPTIMIZER_AUTH_DISABLED=true, the optimizer accepts unauthenticated
 * requests so a missing token isn't fatal there.
 */
async function getAuthHeader(): Promise<string | null> {
    try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        return token ? `Bearer ${token}` : null;
    } catch {
        return null;
    }
}

// =============================================================================
// CLIENT
// =============================================================================

export class OptimizerClient {
    private readonly baseUrl: string;

    constructor(baseUrl?: string) {
        this.baseUrl = baseUrl ?? getOptimizerUrl();
    }

    /**
     * Check whether the Python optimizer service is reachable.
     */
    async healthCheck(): Promise<OptimizerHealth> {
        const t0 = performance.now();
        try {
            const response = await fetch(`${this.baseUrl}/health`, {
                signal: AbortSignal.timeout(3000),
            });
            const latencyMs = Math.round(performance.now() - t0);
            if (!response.ok) {
                return { available: false, url: this.baseUrl, latencyMs, error: `HTTP ${response.status}` };
            }
            return { available: true, url: this.baseUrl, latencyMs };
        } catch (err: any) {
            return {
                available: false,
                url: this.baseUrl,
                error: err?.message ?? 'Connection refused',
            };
        }
    }

    /**
     * Run the CP-SAT optimizer.
     *
     * @param request  - The scheduling problem (shifts + employees + constraints)
     * @returns        - Proposed assignments (NEVER written to DB by this function)
     * @throws         - OptimizerError if the service is unreachable or returns error
     */
    async optimize(request: OptimizeRequest, externalSignal?: AbortSignal): Promise<OptimizeResponse> {
        const url = `${this.baseUrl}/optimize`;
        // Correlation ID — same UUID flows through every log line on
        // every layer, so a user-reported run can be reconstructed end-to-
        // end (browser console → optimizer container logs → DB writes).
        // crypto.randomUUID is available in all browsers we target.
        const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

        console.info('[OptimizerClient] POST', url, {
            request_id: requestId,
            shifts: request.shifts.length,
            employees: request.employees.length,
            time_limit: request.solver_params?.max_time_seconds ?? 30,
            sample_employee: request.employees[0] ? {
                id: request.employees[0].id,
                level: request.employees[0].level,
                employment_type: request.employees[0].employment_type,
                min_contract_minutes: request.employees[0].min_contract_minutes,
                max_weekly_minutes: request.employees[0].max_weekly_minutes,
                existing_shifts: request.employees[0].existing_shifts?.length ?? 0,
            } : null,
            sample_shift: request.shifts[0] ? {
                id: request.shifts[0].id,
                level: request.shifts[0].level,
                role_id: request.shifts[0].role_id,
                duration: request.shifts[0].duration_minutes,
                target_employment_type: request.shifts[0].target_employment_type,
            } : null,
        });

        // Combine the time-limit timeout with any caller-supplied abort signal
        // so the in-flight request actually cancels when the user hits Cancel.
        //
        // The client timeout MUST exceed (preprocess_ms + solve_ms +
        // network round-trip). At ~64k vars / 1.5M constraints, preprocess
        // alone is ~8s, plus 30s solve = ~38s. We add a generous 30s
        // buffer (preprocess_ms grows quadratically with shift count).
        // Reading from `solver_params.max_time_seconds` — the legacy
        // `request.time_limit_seconds` field name didn't exist on the
        // type, so the timeout was always falling back to 30s and
        // racing the solver to a false-CONNECTION_REFUSED.
        const solverBudgetSec = request.solver_params?.max_time_seconds ?? 30;
        const timeoutSignal = AbortSignal.timeout(solverBudgetSec * 1000 + 30_000);
        const signal = externalSignal
            ? AbortSignal.any([timeoutSignal, externalSignal])
            : timeoutSignal;

        const authHeader = await getAuthHeader();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
        };
        if (authHeader) headers['Authorization'] = authHeader;

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(request),
                signal,
            });
        } catch (err: any) {
            // Distinguish three cases:
            //   1. user cancelled (externalSignal aborted) → propagate AbortError
            //   2. our timeout fired before the solver returned → SOLVER_ERROR
            //      (NOT connection_refused — the service IS up, it just ran
            //      past our budget). Don't engage greedy fallback for this.
            //   3. actual TCP failure → CONNECTION_REFUSED.
            if (externalSignal?.aborted) {
                throw err;  // let caller's AbortError propagate
            }
            const isTimeout = err?.name === 'TimeoutError'
                || (err?.name === 'AbortError' && timeoutSignal.aborted);
            if (isTimeout) {
                throw new OptimizerError(
                    `Optimizer ran longer than the ${solverBudgetSec + 30}s client budget. Increase max_time_seconds or narrow the date range.`,
                    'SOLVER_ERROR',
                    err,
                );
            }
            throw new OptimizerError(
                `Cannot reach optimizer service at ${this.baseUrl}. Is it running? (pip install -r requirements.txt && python ortools_runner.py)`,
                'CONNECTION_REFUSED',
                err,
            );
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            console.error('[OptimizerClient] Error Body:', body);
            throw new OptimizerError(
                `Optimizer returned HTTP ${response.status}: ${body}`,
                'HTTP_ERROR',
            );
        }

        const data = await response.json() as OptimizeResponse;

        console.info('[OptimizerClient] Result:', {
            request_id: requestId,
            status: data.status,
            assignments: data.assignments.length,
            unassigned: data.unassigned_shift_ids.length,
            solve_ms: data.solve_time_ms,
            num_variables: data.num_variables,
            num_constraints: data.num_constraints,
            objective: data.objective_value,
        });

        return data;
    }

    /**
     * Server-side eligibility audit.
     *
     * Replaces the controller's per-(employee, shift) Supabase RPC fan-out
     * (~5 000 round-trips for a 50-shift × 103-employee audit) with a single
     * call to the Python service, which runs the same eligibility filter
     * the solver uses and returns per-(shift, employee) reason codes.
     *
     * Typical observed elapsed_ms: under 20ms server-side; full round-trip
     * including HTTP under 100ms. Compared to the prior ~120s round-trip
     * fan-out, this is a ~1000× improvement on the audit phase alone.
     *
     * Falls through to OptimizerError on transport failure; the controller
     * decides whether to retry, fall back to local audit, or surface an
     * error to the user.
     */
    async audit(request: AuditRequest, externalSignal?: AbortSignal): Promise<AuditResponse> {
        const url = `${this.baseUrl}/audit`;
        const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

        // Audit is pure-CPU server-side and bounded by JSON payload
        // serialization. 30s is overkill for the actual work but
        // tolerates large rosters with slow networks.
        const timeoutSignal = AbortSignal.timeout(30_000);
        const signal = externalSignal
            ? AbortSignal.any([timeoutSignal, externalSignal])
            : timeoutSignal;

        const authHeader = await getAuthHeader();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
        };
        if (authHeader) headers['Authorization'] = authHeader;

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(request),
                signal,
            });
        } catch (err: any) {
            if (externalSignal?.aborted) throw err;
            throw new OptimizerError(
                `Audit endpoint unreachable at ${this.baseUrl}/audit`,
                'CONNECTION_REFUSED',
                err,
            );
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new OptimizerError(
                `Audit returned HTTP ${response.status}: ${body}`,
                'HTTP_ERROR',
            );
        }

        const data = await response.json() as AuditResponse;
        console.info('[OptimizerClient] Audit:', {
            request_id: requestId,
            audited: data.audited_shift_count,
            elapsed_ms: data.elapsed_ms,
        });
        return data;
    }
}

// =============================================================================
// ERROR CLASS
// =============================================================================

export class OptimizerError extends Error {
    constructor(
        message: string,
        public readonly code: 'CONNECTION_REFUSED' | 'HTTP_ERROR' | 'SOLVER_ERROR',
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'OptimizerError';
    }
}

/** Singleton client — uses VITE_OPTIMIZER_URL env variable. */
export const optimizerClient = new OptimizerClient();
