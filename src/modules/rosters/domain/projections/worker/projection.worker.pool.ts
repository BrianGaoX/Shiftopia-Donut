/**
 * Projection Worker Pool
 *
 * Phase 4: Distributes projection workloads across multiple Web Workers to
 * exploit multi-core CPUs. On an M1/M2/M3 with 8+ cores, this can deliver
 * 3-4x throughput improvement for large rosters.
 *
 * Architecture:
 *   Main Thread
 *       │
 *       ▼
 *   WorkerPool (this file)
 *       │  splits shifts into chunks
 *       ├──▶ Worker 0  ──▶  partial stats
 *       ├──▶ Worker 1  ──▶  partial stats
 *       ├──▶ Worker 2  ──▶  partial stats
 *       └──▶ Worker 3  ──▶  partial stats
 *                              │
 *                              ▼ merge
 *                        Final ProjectionResult
 *
 * Design decisions:
 *   - Pool size defaults to `navigator.hardwareConcurrency / 2` (leave cores
 *     for the main thread, GC, browser internals)
 *   - Falls back to 1 worker if `hardwareConcurrency` is unavailable
 *   - Small rosters (<100 shifts) bypass pooling entirely — the overhead of
 *     splitting + structuredClone + merging outweighs any parallel gain
 *   - Each worker is a standard projection.worker.ts instance
 *   - The pool handles request sequencing, cancellation, and stale-discard
 *     across all workers in the pool
 *
 * Worker-safe: no DOM, no React, no Supabase.
 */

import type {
  ProjectionRequest,
  ProjectionResult,
  ProjectionStatsResult,
  WorkerShiftDTO,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './protocol';
import { computeUtilizationPct, isOverContractedHours, periodContractedHours, computePeakFatigue } from '../utils/workload';
import { UNASSIGNED_BUCKET_ID } from '../constants';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Below this threshold, the pool delegates to a single worker (no split). */
const POOL_THRESHOLD = 100;

/** Default debounce before dispatching to the pool. */
const DEFAULT_DEBOUNCE_MS = 50;

// ── Stats Merger ──────────────────────────────────────────────────────────────

/**
 * Merge an array of partial ProjectionStatsResult into a single aggregate.
 * All numeric fields are summed; cost is rounded at the end.
 */
function mergeStats(partials: ProjectionStatsResult[]): ProjectionStatsResult {
  const merged: ProjectionStatsResult = {
    totalShifts: 0,
    assignedShifts: 0,
    openShifts: 0,
    publishedShifts: 0,
    totalNetMinutes: 0,
    estimatedCost: 0,
    costBreakdown: { base: 0, penalty: 0, overtime: 0, allowance: 0, leave: 0 },
  };

  for (const p of partials) {
    merged.totalShifts += p.totalShifts;
    merged.assignedShifts += p.assignedShifts;
    merged.openShifts += p.openShifts;
    merged.publishedShifts += p.publishedShifts;
    merged.totalNetMinutes += p.totalNetMinutes;
    merged.estimatedCost += p.estimatedCost;
    merged.costBreakdown.base += p.costBreakdown.base;
    merged.costBreakdown.penalty += p.costBreakdown.penalty;
    merged.costBreakdown.overtime += p.costBreakdown.overtime;
    merged.costBreakdown.allowance += p.costBreakdown.allowance;
    merged.costBreakdown.leave += p.costBreakdown.leave;
  }

  merged.estimatedCost = Math.round(merged.estimatedCost * 100) / 100;
  return merged;
}

/**
 * Merge multiple partial ProjectionResults into a single final result.
 */
/**
 * Merge multiple partial ProjectionResults into a single final result.
 */
function mergeResults(
  partials: ProjectionResult[],
  requestId: number,
  mode: ProjectionResult["mode"],
  t0: number,
  rangeDays?: number,
): ProjectionResult {
  const stats = mergeStats(partials.map((p) => p.stats));

  return {
    requestId,
    durationMs: Math.round(performance.now() - t0),
    mode,
    stats,
    // Mode-specific data: we must merge chunks for the active mode.
    group: mode === "group" ? mergeGroups(partials.map((p) => p.group).filter(Boolean) as any[]) : null,
    people: mode === "people" ? mergePeople(partials.map((p) => p.people).filter(Boolean) as any[], rangeDays) : null,
    events: mode === "events" ? mergeEvents(partials.map((p) => p.events).filter(Boolean) as any[]) : null,
    roles: mode === "roles" ? mergeRoles(partials.map((p) => p.roles).filter(Boolean) as any[]) : null,
  };
}

/**
 * Merge partial PeopleMode projections.
 */
function mergePeople(partials: any[], rangeDays?: number): any {
  if (partials.length === 0) return null;
  const employeeMap = new Map<string, any>();

  for (const p of partials) {
    for (const emp of p.employees) {
      const existing = employeeMap.get(emp.id);
      if (!existing) {
        // Deep clone the objects that will be mutated
        employeeMap.set(emp.id, {
          ...emp,
          shifts: { ...emp.shifts },
          payBreakdown: { ...emp.payBreakdown },
        });
      } else {
        existing.currentHours += emp.currentHours;
        existing.estimatedPay += emp.estimatedPay;
        existing.payBreakdown.base += emp.payBreakdown.base;
        existing.payBreakdown.penalty += emp.payBreakdown.penalty;
        existing.payBreakdown.overtime += emp.payBreakdown.overtime;
        existing.payBreakdown.allowance += emp.payBreakdown.allowance;
        existing.payBreakdown.leave += emp.payBreakdown.leave;

        for (const [date, shifts] of Object.entries(emp.shifts)) {
          existing.shifts[date] = [...(existing.shifts[date] || []), ...(shifts as any[])];
        }

        existing.fatigueScore = Math.max(existing.fatigueScore, emp.fatigueScore);
      }
    }
  }

  // Recompute utilization AFTER merging — currentHours is only complete once
  // every chunk's contribution is summed (the pool splits shifts by index, so a
  // single employee's shifts can land in different workers). Uses the same
  // helpers as people.projector so the formula can never drift again.
  const employees = Array.from(employeeMap.values()).map((emp) => {
    // Fatigue is recomputed over the FULL merged shift set (not max-of-chunks):
    // the pool splits shifts by index, so an employee's consecutive-day shifts
    // can land in different workers and a per-chunk peak would understate it.
    let fatigueScore = emp.fatigueScore;
    if (emp.id !== UNASSIGNED_BUCKET_ID) {
      const mergedShifts = (Object.values(emp.shifts).flat() as any[]).map((ps) => ({
        shift_date: ps.date,
        start_time: ps.startTime,
        end_time: ps.endTime,
        unpaid_break_minutes: ps.unpaidBreakMinutes ?? 0,
      }));
      if (mergedShifts.length > 0) fatigueScore = computePeakFatigue(mergedShifts);
    }

    return {
      ...emp,
      fatigueScore,
      periodContractedHours: periodContractedHours(emp.contractedHours, rangeDays),
      utilization: computeUtilizationPct(emp.currentHours, emp.contractedHours, rangeDays),
      overHoursWarning: isOverContractedHours(emp.currentHours, emp.contractedHours, rangeDays),
    };
  });

  return { employees, stats: null }; // stats handled by mergeResults
}

/**
 * Merge partial GroupMode projections.
 */
function mergeGroups(partials: any[]): any {
  if (partials.length === 0) return null;
  const groupMap = new Map<string, any>();

  for (const p of partials) {
    for (const g of p.groups) {
      let existing = groupMap.get(g.id);
      if (!existing) {
        // Deep clone the group structure
        existing = {
          ...g,
          subGroups: g.subGroups.map((sg: any) => ({
            ...sg,
            shiftsByDate: { ...sg.shiftsByDate },
            stats: { ...sg.stats, costBreakdown: { ...sg.stats.costBreakdown } },
          })),
          stats: { ...g.stats, costBreakdown: { ...g.stats.costBreakdown } },
        };
        groupMap.set(g.id, existing);
      } else {
        // Merge stats for the group
        existing.stats.totalShifts += g.stats.totalShifts;
        existing.stats.assignedShifts += g.stats.assignedShifts;
        existing.stats.totalHours += g.stats.totalHours;
        existing.stats.estimatedCost += g.stats.estimatedCost;
        existing.stats.costBreakdown.base += g.stats.costBreakdown.base;
        existing.stats.costBreakdown.penalty += g.stats.costBreakdown.penalty;
        existing.stats.costBreakdown.overtime += g.stats.costBreakdown.overtime;
        existing.stats.costBreakdown.allowance += g.stats.costBreakdown.allowance;
        existing.stats.costBreakdown.leave += g.stats.costBreakdown.leave;

        // Merge subGroups
        for (const sg of g.subGroups) {
          const existingSg = existing.subGroups.find((esg: any) => esg.id === sg.id);
          if (!existingSg) {
            existing.subGroups.push({
              ...sg,
              shiftsByDate: { ...sg.shiftsByDate },
              stats: { ...sg.stats, costBreakdown: { ...sg.stats.costBreakdown } },
            });
          } else {
            existingSg.stats.totalShifts += sg.stats.totalShifts;
            existingSg.stats.assignedShifts += sg.stats.assignedShifts;
            existingSg.stats.totalHours += sg.stats.totalHours;
            existingSg.stats.estimatedCost += sg.stats.estimatedCost;
            existingSg.stats.costBreakdown.base += sg.stats.costBreakdown.base;
            existingSg.stats.costBreakdown.penalty += sg.stats.costBreakdown.penalty;
            existingSg.stats.costBreakdown.overtime += sg.stats.costBreakdown.overtime;
            existingSg.stats.costBreakdown.allowance += sg.stats.costBreakdown.allowance;
            existingSg.stats.costBreakdown.leave += sg.stats.costBreakdown.leave;

            for (const [date, shifts] of Object.entries(sg.shiftsByDate)) {
              existingSg.shiftsByDate[date] = [...(existingSg.shiftsByDate[date] || []), ...(shifts as any[])];
            }
          }
        }
      }
    }
  }

  // Final pass: re-derive coverage health for sub-groups
  const groups = Array.from(groupMap.values());
  for (const g of groups) {
    for (const sg of g.subGroups) {
      sg.coverage = deriveCoverage(sg.stats.assignedShifts, sg.stats.totalShifts);
    }
  }

  return { groups, stats: null };
}


/**
 * Merge partial RolesMode projections.
 */
function mergeRoles(partials: any[]): any {
  if (partials.length === 0) return null;
  const levelMap = new Map<string, any>();
  const unassignedRoleMap = new Map<string, any>();

  for (const p of partials) {
    // Merge Levels
    for (const lvl of p.levels) {
      const existingLvl = levelMap.get(lvl.id);
      if (!existingLvl) {
        levelMap.set(lvl.id, {
          ...lvl,
          roles: lvl.roles.map((r: any) => ({ ...r, shiftsByDate: { ...r.shiftsByDate } })),
        });
      } else {
        existingLvl.totalHours += lvl.totalHours;
        existingLvl.totalCost += lvl.totalCost;
        for (const r of lvl.roles) {
          const existingR = existingLvl.roles.find((er: any) => er.id === r.id);
          if (!existingR) {
            existingLvl.roles.push({ ...r, shiftsByDate: { ...r.shiftsByDate } });
          } else {
            existingR.totalHours += r.totalHours;
            existingR.totalCost += r.totalCost;
            for (const [date, shifts] of Object.entries(r.shiftsByDate)) {
              existingR.shiftsByDate[date] = [...(existingR.shiftsByDate[date] || []), ...(shifts as any[])];
            }
          }
        }
      }
    }

    // Merge Unassigned Roles
    for (const r of p.unassignedRoles) {
      const existingR = unassignedRoleMap.get(r.id);
      if (!existingR) {
        unassignedRoleMap.set(r.id, { ...r, shiftsByDate: { ...r.shiftsByDate } });
      } else {
        existingR.totalHours += r.totalHours;
        existingR.totalCost += r.totalCost;
        for (const [date, shifts] of Object.entries(r.shiftsByDate)) {
          existingR.shiftsByDate[date] = [...(existingR.shiftsByDate[date] || []), ...(shifts as any[])];
        }
      }
    }
  }

  return {
    levels: Array.from(levelMap.values()),
    unassignedRoles: Array.from(unassignedRoleMap.values()),
    stats: null,
  };
}

/**
 * Merge partial EventsMode projections.
 */
function mergeEvents(partials: any[]): any {
  if (partials.length === 0) return null;
  const eventMap = new Map<string, any>();

  for (const p of partials) {
    for (const ev of p.events) {
      const existing = eventMap.get(ev.eventId);
      if (!existing) {
        eventMap.set(ev.eventId, { ...ev, shifts: [...ev.shifts] });
      } else {
        existing.totalHours += ev.totalHours;
        existing.assignedCount += ev.assignedCount;
        existing.totalCount += ev.totalCount;
        existing.shifts = [...existing.shifts, ...ev.shifts];
      }
    }
  }

  const events = Array.from(eventMap.values()).map((ev) => ({
    ...ev,
    coverage: deriveCoverage(ev.assignedCount, ev.totalCount),
  }));

  return { events, stats: null };
}

/**
 * Minimal inline coverage health derivation to avoid complex imports in the pool.
 */
function deriveCoverage(assigned: number, total: number) {
  if (total === 0) {
    return { ratio: 1, label: "No Shifts", colorClass: "text-slate-500", bgClass: "bg-slate-500/10", pct: 100 };
  }
  const ratio = assigned / total;
  const pct = Math.min(100, Math.round(ratio * 100));
  if (ratio >= 1) return { ratio, label: "Fully Staffed", colorClass: "text-emerald-400", bgClass: "bg-emerald-500/10", pct };
  if (ratio >= 0.8) return { ratio, label: "Nearly Staffed", colorClass: "text-amber-400", bgClass: "bg-amber-500/10", pct };
  if (ratio >= 0.5) return { ratio, label: "Low Coverage", colorClass: "text-orange-400", bgClass: "bg-orange-500/10", pct };
  return { ratio, label: "Critical", colorClass: "text-red-400", bgClass: "bg-red-500/10", pct };
}



// ── Chunk Utility ─────────────────────────────────────────────────────────────

/**
 * Split an array into `n` roughly equal chunks.
 */
function chunkArray<T>(arr: T[], n: number): T[][] {
  const chunks: T[][] = [];
  const chunkSize = Math.ceil(arr.length / n);
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

// ── Pool Class ────────────────────────────────────────────────────────────────

export class ProjectionWorkerPool {
  private workers: Worker[] = [];
  private poolSize: number;
  private requestCounter = 0;
  private lastSentRequestId = -1;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;

  /** Called when a valid (non-stale) merged projection result arrives. */
  onResult: ((result: ProjectionResult) => void) | null = null;

  /** Called when any worker reports an error. */
  onError: ((error: { requestId: number; message: string }) => void) | null = null;

  // Track in-flight partial results for merging
  private pendingPartials = new Map<number, {
    expected: number;
    received: ProjectionResult[];
    mode: ProjectionResult['mode'];
    t0: number;
    rangeDays?: number;
  }>();

  constructor(options?: {
    poolSize?: number;
    debounceMs?: number;
  }) {
    const hwConcurrency = typeof navigator !== 'undefined'
      ? navigator.hardwareConcurrency ?? 2
      : 2;
    this.poolSize = options?.poolSize ?? Math.max(1, Math.floor(hwConcurrency / 2));
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  // ── Lazy worker init ──────────────────────────────────────────────────────

  private ensureWorkers(): Worker[] {
    if (this.workers.length === 0) {
      for (let i = 0; i < this.poolSize; i++) {
        const worker = new Worker(
          // @ts-ignore: Vite worker syntax
          new URL('./projection.worker.ts', import.meta.url),
          { type: 'module' },
        );
        worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) =>
          this.handleWorkerMessage(event, i);
        worker.onerror = (e) =>
          console.error(`[ProjectionWorkerPool] Worker ${i} error:`, e);
        this.workers.push(worker);
      }
    }
    return this.workers;
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private handleWorkerMessage = (
    event: MessageEvent<WorkerOutboundMessage>,
    _workerIndex: number,
  ) => {
    const msg = event.data;

    switch (msg.type) {
      case 'result': {
        const { requestId } = msg.payload;

        // Discard stale results
        if (requestId !== this.lastSentRequestId) return;

        const pending = this.pendingPartials.get(requestId);
        if (!pending) return;

        pending.received.push(msg.payload);

        // All chunks received — merge and emit
        if (pending.received.length >= pending.expected) {
          this.pendingPartials.delete(requestId);
          const merged = mergeResults(
            pending.received,
            requestId,
            pending.mode,
            pending.t0,
            pending.rangeDays,
          );
          this.onResult?.(merged);
        }
        break;
      }
      case 'error': {
        if (msg.payload.requestId !== this.lastSentRequestId) return;
        // On any chunk error, propagate immediately
        this.pendingPartials.delete(msg.payload.requestId);
        this.onError?.(msg.payload);
        break;
      }
    }
  };

  // ── Public API ────────────────────────────────────────────────────────────

  /** The effective pool size (how many workers will be used). */
  get size(): number {
    return this.poolSize;
  }

  /**
   * Request a projection. For small rosters (<POOL_THRESHOLD), uses a single
   * worker. For larger rosters, splits shifts across the pool.
   *
   * Returns the assigned requestId.
   */
  requestProjection(
    request: Omit<ProjectionRequest, 'requestId'>,
  ): number {
    const requestId = ++this.requestCounter;

    // Cancel previous in-flight request
    if (this.lastSentRequestId > 0) {
      this.cancelProjection(this.lastSentRequestId);
    }
    this.lastSentRequestId = requestId;

    // Clear any pending debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.dispatch({ ...request, requestId });
    }, this.debounceMs);

    return requestId;
  }

  private dispatch(request: ProjectionRequest): void {
    const workers = this.ensureWorkers();
    const shifts = request.shifts;

    // ── Small roster fast path: single worker, no split overhead ─────────
    const effectivePoolSize = shifts.length < POOL_THRESHOLD ? 1 : workers.length;

    if (effectivePoolSize === 1) {
      // Send entire payload to worker 0
      this.pendingPartials.set(request.requestId, {
        expected: 1,
        received: [],
        mode: request.mode,
        t0: performance.now(),
        rangeDays: request.rangeDays,
      });

      const message: WorkerInboundMessage = {
        type: 'project',
        payload: request,
      };
      workers[0].postMessage(message);
      return;
    }

    // ── Multi-worker path: chunk shifts across pool ─────────────────────
    const chunks = chunkArray(shifts, effectivePoolSize);

    this.pendingPartials.set(request.requestId, {
      expected: chunks.length,
      received: [],
      mode: request.mode,
      t0: performance.now(),
      rangeDays: request.rangeDays,
    });

    for (let i = 0; i < chunks.length; i++) {
      const chunkRequest: ProjectionRequest = {
        ...request,
        shifts: chunks[i],
      };

      const message: WorkerInboundMessage = {
        type: 'project',
        payload: chunkRequest,
      };
      workers[i].postMessage(message);
    }
  }

  /**
   * Explicitly cancel an in-flight projection across all workers.
   */
  cancelProjection(requestId: number): void {
    this.pendingPartials.delete(requestId);

    for (const worker of this.workers) {
      const message: WorkerInboundMessage = {
        type: 'cancel',
        payload: { requestId },
      };
      worker.postMessage(message);
    }
  }

  /**
   * Terminate all workers and clean up. Call on component unmount.
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.pendingPartials.clear();
    this.onResult = null;
    this.onError = null;
  }
}
