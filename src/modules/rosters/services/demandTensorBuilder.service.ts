/**
 * demandTensorBuilder — turn a (date, scope) + existing shift list into the
 * DemandTensor[] the shift synthesizer consumes.
 *
 * Pipeline (ML path, default):
 *   1. Fetch venueops_events overlapping the date.
 *   2. For each event call mlClient.buildDemandAnalysisForRoles (all ML roles in one slice fan-out) → raw tensors.
 *   3. Merge raw tensors with the same roleId + subDepartmentId by summing per slot.
 *   4. Subtract existing-shift coverage per slot → residualHeadcount.
 *
 * Rule-engine path (VITE_DEMAND_ENGINE_MODE=rules_shadow|rules_primary):
 *   Runs the L3 rule engine + L7 finalization alongside or instead of ML.
 *   - rules_shadow:  writes demand_tensor rows but ML still drives the synthesizer.
 *   - rules_primary: rules drive the synthesizer; ML gated by VITE_ML_RUNTIME_MODE.
 */

import { supabase } from '@/platform/supabase/client';
import { fromZonedTime } from 'date-fns-tz';
import type { Shift } from '../domain/shift.entity';

const ICC_TIMEZONE = 'Australia/Sydney';
import {
  DemandSlot,
  DemandTensor,
  SynthesizedShift,
  SLOT_DURATION_MINUTES,
  SLOT_MINUTES,
  timeToMinutes,
} from '../domain/shiftSynthesizer.policy';
import type { TemplateGroupType } from '../domain/shift.entity';
import {
  buildDemandAnalysisForRoles,
  resolveMLRoleById,
  resolveMLRoleByNameFallback,
  ML_KNOWN_ROLES,
  type EventInput,
  type MLKnownRole,
} from './mlClient.service';
import { fetchRoleMLClassMap } from '../api/roleMlClass.queries';
import { createModuleLogger } from '@/modules/core/lib/logger';
// ── Rule-engine imports ────────────────────────────────────────────────────
import { buildEventFeature } from './eventFeatureBuilder.service';
import { demandRulesQueries } from '../api/demandRules.queries';
import { compileRules, runBaseline } from './ruleBaseline.service';
import { supervisorFeedbackQueries } from '../api/supervisorFeedback.queries';
import { finalizeDemand, finalizedRowsToSynthGrid } from './demandFinalization.service';
import { demandTensorDbQueries } from '../api/demandTensor.queries';
import { fetchL6Constraints } from '../api/workRules.queries';
import type { SupervisorFeedbackRow, FunctionCode } from '../api/supervisorFeedback.dto';

const log = createModuleLogger('demandTensorBuilder');

// ── Demand engine mode flag ────────────────────────────────────────────────
export type DemandEngineMode = 'ml_only' | 'rules_shadow' | 'rules_primary';

export function getDemandEngineMode(): DemandEngineMode {
  const raw = (import.meta.env.VITE_DEMAND_ENGINE_MODE as string | undefined)?.toLowerCase();
  if (raw === 'rules_shadow' || raw === 'rules_primary') return raw;
  return 'ml_only'; // safe default — no behavior change
}

const FUNCTION_CODES: FunctionCode[] = ['F&B', 'Logistics', 'AV', 'FOH', 'Security'];

export interface BuildScopeDemandParams {
  organizationId: string;
  date: string; // YYYY-MM-DD
  departmentId?: string;
  subDepartmentId?: string | null;
  /** Roles to generate tensors for (ML service returns per-role values keyed by name). */
  roles: Array<{
    id: string;
    name: string;
    subDepartmentId: string | null;
    forecasting_bucket?: 'static' | 'semi_dynamic' | 'dynamic' | null;
    supervision_ratio_min?: number | null;
    supervision_ratio_max?: number | null;
    is_baseline_eligible?: boolean;
  }>;
  /** Existing shifts for the scope/date, used to compute residuals. */
  existingShifts: Shift[];
  /** 'convention_centre' | 'exhibition_centre' | 'theatre' — feeds buildingType. */
  buildingType: TemplateGroupType;
  /** Forwarded to the ML service so it can tag demand_forecasts rows for rollback. */
  synthesisRunId?: string;
  /** Optional scenario context forwarded to ML service. */
  scenarioId?: string;
}

export interface ScopeDemandResult {
  tensors: DemandTensor[];
  baselineShifts: SynthesizedShift[];
  eventCount: number;
  /** Diagnostic: true if any ML call failed. Caller can show a warning. */
  hasMlError: boolean;
  /** Per-failure details. Non-empty whenever hasMlError is true. */
  mlErrors: Array<{ eventId: string; role: string; message: string }>;
  /** L7 finalized demand tensor rows (Phase 2 output) */
  demandTensorRows?: import('../api/demandTensor.queries').DemandTensorInsertRow[];
}

interface VenueopsEventRow {
  event_id: string;
  name: string;
  start_date_time: string;
  end_date_time: string;
  estimated_total_attendance: number;
  event_type_name: string | null;
  venue_names: string | null;
  // L1 columns (Phase 1-D); nullable for legacy rows
  service_type: 'buffet' | 'plated' | 'cocktail' | 'none' | null;
  alcohol: boolean | null;
  bump_in_min: number | null;
  bump_out_min: number | null;
  layout_complexity: 'simple' | 'standard' | 'complex' | null;
}

import { getDay, parseISO } from 'date-fns';

async function fetchBaselineShifts(
  date: string,
  departmentId?: string,
  subDepartmentId?: string | null,
): Promise<any[]> {
  const dayOfWeek = getDay(parseISO(date));

  // 1. Find active base template
  let query = supabase
    .from('roster_templates')
    .select('id')
    .eq('is_active', true)
    .eq('is_base_template', true);
  
  if (departmentId) query = query.eq('department_id', departmentId);
  if (subDepartmentId) query = query.eq('sub_department_id', subDepartmentId);

  const { data: template, error: tError } = await query.maybeSingle();
  if (tError || !template) return [];

  // 2. Fetch shifts for this day
  const { data: shifts, error: sError } = await supabase
    .from('template_shifts')
    .select('*')
    .eq('template_id', template.id)
    .eq('day_of_week', dayOfWeek);

  if (sError) return [];
  return (shifts ?? []).map((ts) => ({
    ...ts,
    lifecycle_status: 'Published', // Treat template shifts as active for coverage
    group_type: 'convention_centre', // Default
  }));
}

async function fetchEventsForDate(date: string): Promise<VenueopsEventRow[]> {
  const dayStart = fromZonedTime(`${date}T00:00:00`, ICC_TIMEZONE).toISOString();
  const dayEnd   = fromZonedTime(`${date}T23:59:59.999`, ICC_TIMEZONE).toISOString();
  const { data, error } = await supabase
    .from('venueops_events')
    .select(
      'event_id, name, start_date_time, end_date_time, estimated_total_attendance, event_type_name, venue_names, service_type, alcohol, bump_in_min, bump_out_min, layout_complexity',
    )
    .lte('start_date_time', dayEnd)
    .gte('end_date_time', dayStart)
    .eq('is_canceled', false);
  if (error) {
    log.error(
      'fetchEventsForDate failed',
      { operation: 'fetchEventsForDate', date },
      error as Error,
    );
    return [];
  }
  return (data ?? []) as VenueopsEventRow[];
}

/**
 * Derive a FunctionType from the event_type_name string.
 * Covers the most common ICC Sydney event categories.
 */
function deriveFunctionType(eventTypeName: string | null): EventInput['functionType'] {
  if (!eventTypeName) return 'Reception';
  const n = eventTypeName.toLowerCase();
  if (/concert|festival|show|performance/.test(n)) return 'Performance';
  if (/conference|corporate|seminar|summit|forum/.test(n)) return 'Meeting';
  if (/gala|dinner|banquet/.test(n)) return 'Dinner';
  if (/trade\s*show|exhibition|expo/.test(n)) return 'Workshop';
  if (/ceremony|award/.test(n)) return 'Ceremony';
  if (/breakout/.test(n)) return 'Breakout';
  return 'Reception';
}

// deriveRoomCount lives in eventFeatureBuilder.service.ts — single source.
import { deriveRoomCount } from './eventFeatureBuilder.service';

/**
 * Convert a UTC epoch ms timestamp to minutes-since-midnight in the
 * Sydney-local wall-clock frame. AEDT is UTC+11, AEST is UTC+10 — this
 * uses Intl to handle the DST boundary correctly.
 */
function sydneyMinutesSinceMidnight(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: ICC_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10);
    else if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  // 24:00 surfaces in some locales as the hour boundary; normalize to 0.
  if (h === 24) h = 0;
  return h * 60 + m;
}

/**
 * Per-slot flag calculator. Returns entryPeakFlag, exitPeakFlag and mealWindowFlag
 * for a given slot index within the SLOT_MINUTES array.
 *
 * @param sliceIndex  Index into SLOT_MINUTES (0-based).
 * @param eventStartMs  Event start time in epoch ms.
 * @param eventEndMs    Event end time in epoch ms.
 */
export function derivePerSliceFlags(
  sliceIndex: number,
  eventStartMs: number,
  eventEndMs: number,
): { entryPeakFlag: boolean; exitPeakFlag: boolean; mealWindowFlag: boolean } {
  const slotStartMinutes = SLOT_MINUTES[sliceIndex];
  if (slotStartMinutes === undefined) {
    return { entryPeakFlag: false, exitPeakFlag: false, mealWindowFlag: false };
  }
  const slotEndMinutes = slotStartMinutes + SLOT_DURATION_MINUTES;

  // Slot start/end and event start/end must be compared in the SAME wall-clock
  // frame. SLOT_MINUTES is Sydney-local (06:00 = 360). The previous version
  // used getUTCHours/Minutes — for AEDT (UTC+11) a 09:00 local event resolved
  // to 22:00 in the comparison frame, firing peak flags at the wrong slots.
  const eventStartMinutes = sydneyMinutesSinceMidnight(eventStartMs);
  const eventEndMinutes = sydneyMinutesSinceMidnight(eventEndMs);

  const PEAK_WINDOW_MINUTES = 60;

  // Slot overlaps the ±60-min window around event start
  const entryPeakFlag =
    slotStartMinutes < eventStartMinutes + PEAK_WINDOW_MINUTES &&
    slotEndMinutes > eventStartMinutes - PEAK_WINDOW_MINUTES;

  // Slot overlaps the ±60-min window around event end
  const exitPeakFlag =
    slotStartMinutes < eventEndMinutes + PEAK_WINDOW_MINUTES &&
    slotEndMinutes > eventEndMinutes - PEAK_WINDOW_MINUTES;

  // Meal windows: 12:00–13:30 (720–810) or 18:00–19:30 (1080–1170)
  const LUNCH_START = 720; const LUNCH_END = 810;
  const DINNER_START = 1080; const DINNER_END = 1170;
  const mealWindowFlag =
    (slotStartMinutes < LUNCH_END && slotEndMinutes > LUNCH_START) ||
    (slotStartMinutes < DINNER_END && slotEndMinutes > DINNER_START);

  return { entryPeakFlag, exitPeakFlag, mealWindowFlag };
}

/**
 * Build an EventInput suitable for the ML service from a VenueOps row.
 * Per-slice flags (entryPeak/exitPeak/mealWindow) must be overridden per slice —
 * call derivePerSliceFlags(sliceIndex, ...) and merge into the returned base object.
 */
function toEventInput(
  row: VenueopsEventRow,
  buildingType: TemplateGroupType,
  synthesisRunId?: string,
  scenarioId?: string,
): EventInput {
  const start = new Date(row.start_date_time);
  return {
    eventType: (row.event_type_name as EventInput['eventType']) ?? 'Conference',
    expectedAttendance: row.estimated_total_attendance ?? 0,
    dayOfWeek: start.getUTCDay(),
    month: start.getUTCMonth() + 1,
    functionType: deriveFunctionType(row.event_type_name),
    roomCount: deriveRoomCount(row.venue_names),
    // TODO: totalSqm has no source field in venueops_events — awaiting data-audit (see audit-doc issue #42)
    totalSqm: 0,
    roomCapacity: row.estimated_total_attendance ?? 0,
    simultaneousEventCount: 1,
    totalVenueAttendanceSameTime: row.estimated_total_attendance ?? 0,
    // These are per-slice values — overridden inside the buildDemandAnalysis call below.
    entryPeakFlag: false,
    exitPeakFlag: false,
    mealWindowFlag: false,
    timeSliceIndex: 0,
    timeSliceCount: SLOT_MINUTES.length,
    buildingType,
    eventId: row.event_id,
    synthesisRunId,
    scenarioId,
  };
}

/** Initialise a zero-headcount slot array aligned with SLOT_MINUTES. */
function emptySlots(): DemandSlot[] {
  return SLOT_MINUTES.map((start) => ({
    slotStart: start,
    slotEnd: start + SLOT_DURATION_MINUTES,
    requiredHeadcount: 0,
    residualHeadcount: 0,
    residualHeadcountInt: 0,
    contributingEvents: [],
  }));
}

/**
 * Sum one tensor's slots into an accumulator, optionally dividing the headcount
 * by a peer count. The raw tensor indexes slots 0..timeSliceCount-1 — we remap
 * to SLOT_MINUTES (07:00 onwards).
 *
 * Divisor use-case: when N DB roles share the same ML class (e.g. 5 chef titles
 * → Food Staff), the ML's prediction is the TOTAL for that class. We split it
 * evenly across the N peer roles so total generated shifts ≈ original prediction.
 */
function mergeTensorInto(
  accumulator: DemandSlot[],
  raw: DemandTensor,
  eventName: string,
  divisor = 1,
): void {
  raw.slots.forEach((rawSlot, i) => {
    if (i >= accumulator.length) return;
    const addedHeadcount = Math.round(rawSlot.requiredHeadcount / divisor);
    accumulator[i].requiredHeadcount += addedHeadcount;
    if (addedHeadcount > 0 && accumulator[i].contributingEvents) {
      if (!accumulator[i].contributingEvents!.includes(eventName)) {
        accumulator[i].contributingEvents!.push(eventName);
      }
    }
  });
}

/** Count existing shifts (non-cancelled) covering each 30-min slot for a role. */
export function computeExistingCoverage(
  slots: DemandSlot[],
  shifts: Shift[],
  roleId: string,
  subDepartmentId: string | null,
  buildingType: string,
): number[] {
  return slots.map((slot) => {
    let totalSlotCoverage = 0;
    for (const shift of shifts) {
      if (shift.lifecycle_status === 'Cancelled') continue;
      if (shift.role_id !== roleId) continue;
      // Exact match for sub_department_id. Treat undefined/empty as null for comparison
      const shiftSubDept = shift.sub_department_id || null;
      const targetSubDept = subDepartmentId || null;
      if (shiftSubDept !== targetSubDept) continue;

      const shiftGroup = shift.group_type || 'convention_centre';
      if (shiftGroup !== buildingType) continue;

      const shiftStart = timeToMinutes(shift.start_time);
      const shiftEnd = timeToMinutes(shift.end_time);

      // Calculate overlap between shift [shiftStart, shiftEnd] and slot [slotStart, slotEnd]
      const overlapStart = Math.max(shiftStart, slot.slotStart);
      const overlapEnd = Math.min(shiftEnd, slot.slotEnd);
      const overlapMinutes = Math.max(0, overlapEnd - overlapStart);

      if (overlapMinutes > 0) {
        // Contribution is the fraction of the slot covered by this shift
        totalSlotCoverage += overlapMinutes / (slot.slotEnd - slot.slotStart);
      }
    }
    return totalSlotCoverage;
  });
}

export async function buildScopeDemand(
  params: BuildScopeDemandParams,
): Promise<ScopeDemandResult> {
  const engineMode = getDemandEngineMode();

  // 1. Fetch baseline coverage from active templates
  const baselineShifts = await fetchBaselineShifts(
    params.date,
    params.departmentId,
    params.subDepartmentId,
  );
  const allCoverageShifts = [...params.existingShifts, ...baselineShifts];

  // 2. Map roles and filter those requiring ML
  const roleMlMap = await fetchRoleMLClassMap();
  const mappedRoles = params.roles.map((r) => ({
    ...r,
    mlRole: resolveMLRoleById(r.id, roleMlMap) ?? resolveMLRoleByNameFallback(r.name),
  }));

  // Roles that are 'static' don't use ML predictions — they rely solely on baseline/manual shifts.
  const knownRoles = mappedRoles.filter(
    (r): r is typeof r & { mlRole: MLKnownRole } =>
      r.mlRole !== null && r.forecasting_bucket !== 'static'
  );

  const peerCountByClass = new Map<MLKnownRole, number>();
  for (const r of knownRoles) {
    peerCountByClass.set(r.mlRole, (peerCountByClass.get(r.mlRole) ?? 0) + 1);
  }

  log.info('building scope demand', {
    operation: 'buildScopeDemand',
    date: params.date,
    engineMode,
    baselineCount: baselineShifts.length,
    predictionRoleCount: knownRoles.length,
  });

  const events = await fetchEventsForDate(params.date);

  // ── Rule-engine path (L3 → L7) ────────────────────────────────────────
  // Runs when engineMode is 'rules_shadow' or 'rules_primary'.
  // In shadow mode: writes demand_tensor rows but doesn't change synthesizer input.
  // In primary mode: also builds synthGrid that replaces ML accumulators below.
  let rulesSynthGrid: Map<string, Float32Array> | null = null;
  // Hoisted: referenced by the return statement below regardless of engineMode.
  // In ml_only mode this stays empty; in shadow/primary it is populated inside
  // the try block and read both for DB persistence and the return payload.
  let allFinalizedRows: import('../api/demandTensor.queries').DemandTensorInsertRow[] = [];

  if (engineMode !== 'ml_only' && events.length > 0) {
    try {
      // Compile active rules once for all events
      const activeRules = await demandRulesQueries.listActive();
      const { compiled, errors: compileErrors } = compileRules(activeRules);
      if (compileErrors.length > 0) {
        log.warn('rule compile errors', { operation: 'compileRules', errors: compileErrors });
      }

      // Fetch feedback rows for all (function, level) buckets in a single bulk call (Phase 2 optimization)
      const buckets = FUNCTION_CODES.flatMap(fc =>
        Array.from({ length: 8 }, (_, lvl) => ({ function_code: fc, level: lvl }))
      );
      const batchFeedback = await supervisorFeedbackQueries.listBatchForBuckets(buckets, 10);

      const feedbackByBucket = new Map<string, SupervisorFeedbackRow[]>();
      for (const row of batchFeedback) {
        const key = `${row.function_code}|${row.level}`;
        const existing = feedbackByBucket.get(key) ?? [];
        existing.push(row);
        feedbackByBucket.set(key, existing);
      }

      // L4 Timecard Adjustment — Phase 1 placeholder.
      // Pinned to 1.0 (no-op) until the timecard ingestion + bucket aggregation
      // service exists. The previous implementation referenced an unimported
      // `shiftsQueries` and properties (.roleId, .functionCode) that don't exist
      // on the role row type, which would have thrown ReferenceError at runtime
      // and been silently swallowed by the outer catch — masking L4 entirely.
      // See L4 build-out task; finalizeDemand defaults timecardMultByBucket
      // values to 1.0 if absent, so passing an empty map is safe.
      const timecardMultByBucket = new Map<string, number>();

      // Fetch L6 Operational Constraints (Phase 2 Hardening)
      const { localFloors, globalFloors } = await fetchL6Constraints();

      // Run L3 + L7 per event
      for (const event of events) {
        const feature = buildEventFeature(event, params.date);
        if (feature.first_slice_idx > feature.last_slice_idx) continue; // empty window

        const baselineResult = runBaseline(feature, compiled);
        if (baselineResult.runtimeErrors.length > 0) {
          log.warn('rule runtime errors', {
            operation: 'runBaseline',
            eventId: event.event_id,
            errors: baselineResult.runtimeErrors,
          });
        }

        const finResult = finalizeDemand({
          synthesis_run_id: params.synthesisRunId ?? null,
          event_id: event.event_id,
          baselineCells: baselineResult.cells,
          feedbackByBucket,
          timecardMultByBucket,
          constraintFloors: localFloors,
          globalFloors,
        });

        allFinalizedRows.push(...finResult.rows);
      }

      // Persist to demand_tensor (shadow or primary — always write provenance)
      if (allFinalizedRows.length > 0) {
        if (params.synthesisRunId) {
          await demandTensorDbQueries.deleteForRun(params.synthesisRunId);
        }
        await demandTensorDbQueries.insertBatch(allFinalizedRows);
        log.info('demand_tensor rows written', {
          operation: 'demandTensorWrite',
          rowCount: allFinalizedRows.length,
          engineMode,
        });
      }

      // In primary mode, build a synth grid from finalized rows
      if (engineMode === 'rules_primary') {
        rulesSynthGrid = finalizedRowsToSynthGrid(allFinalizedRows);
      }
    } catch (err) {
      log.error(
        'rule-engine path failed — falling back to ML',
        { operation: 'ruleEnginePath', engineMode },
        err as Error,
      );
      // Fallback: rulesSynthGrid stays null, ML path runs normally below
    }
  }

  let hasMlError = false;
  const mlErrors: Array<{ eventId: string; role: string; message: string }> = [];
  let mlCallCount = 0;
  const accumulators = new Map<
    string,
    { roleName: string; subDepartmentId: string; slots: DemandSlot[] }
  >();

  // Initialise accumulators for ALL roles in scope (including static ones for coverage calc)
  for (const role of params.roles) {
    accumulators.set(role.id, {
      roleName: role.name,
      subDepartmentId: role.subDepartmentId ?? params.subDepartmentId ?? '',
      slots: emptySlots(),
    });
  }

  // 3a. Bridge approximation removed in Phase 2.
  // The L7 rows (allFinalizedRows) are returned directly via ScopeDemandResult.
  // synthesizeAndInsertShifts now natively maps (function, level) to roles.

  // 3. Call ML for predictive roles (skipped in rules_primary when grid is available)
  if (rulesSynthGrid === null && events.length > 0 && knownRoles.length > 0) {
    for (const event of events) {
      const eventInput = toEventInput(
        event,
        params.buildingType,
        params.synthesisRunId,
        params.scenarioId,
      );
      const eventStartMs = new Date(event.start_date_time).getTime();
      const eventEndMs = new Date(event.end_date_time).getTime();

      // mlCache is scoped to this event: keyed by ML role name → DemandTensor.
      // Populated first from demand_forecasts (DB cache), then from the live ML
      // service via a single buildDemandAnalysisForRoles call that fans out slices
      // ONCE for all DB-cache-missing roles.
      const mlCache = new Map<string, DemandTensor>();

      // ── Step A: attempt DB-cache lookup for each distinct ML role ──────────
      const mlRolesNeeded = [...new Set(knownRoles.map((r) => r.mlRole))];
      const mlRolesForLiveCall: MLKnownRole[] = [];

      for (const mlRole of mlRolesNeeded) {
        try {
          // First, try to fetch from demand_forecasts table.
          // NOTE: time_slot column stores a slot INDEX (0-based), not minutes.
          // slotStart/slotEnd below are index-valued placeholders; mergeTensorInto
          // re-aligns by array index, so the merge is still correct.
          const { data: cachedDemand, error } = await (supabase as any)
            .from('demand_forecasts')
            .select('*')
            .eq('event_id', event.event_id)
            .eq('role', mlRole)
            .order('time_slot', { ascending: true });

          if (!error && cachedDemand && cachedDemand.length > 0) {
            const packingSlots: DemandSlot[] = cachedDemand.map((row: any) => ({
              slotStart: row.time_slot,
              slotEnd: row.time_slot + 1,
              requiredHeadcount: row.corrected_count,
              residualHeadcount: row.corrected_count,
              residualHeadcountInt: Math.round(row.corrected_count),
            }));
            mlCache.set(mlRole, {
              roleId: mlRole,
              subDepartmentId: event.event_id,
              buildingType: params.buildingType,
              slots: packingSlots,
            });
          } else {
            // DB miss — queue for the live ML call.
            mlRolesForLiveCall.push(mlRole);
          }
        } catch (err) {
          // DB lookup error — queue for the live ML call so we don't lose the role.
          mlRolesForLiveCall.push(mlRole);
        }
      }

      // ── Step B: single live ML call for all DB-cache-missing roles ─────────
      // buildDemandAnalysisForRoles fans out timeSliceCount POSTs ONCE and
      // returns one DemandTensor per requested role from the shared responses.
      // Before: N_missing × S POSTs. After: S POSTs (for any N_missing ≥ 1).
      if (mlRolesForLiveCall.length > 0) {
        try {
          const tensors = await buildDemandAnalysisForRoles(
            eventInput,
            mlRolesForLiveCall,
            (sliceIndex) => derivePerSliceFlags(sliceIndex, eventStartMs, eventEndMs),
          );
          mlCallCount++;
          for (let i = 0; i < mlRolesForLiveCall.length; i++) {
            mlCache.set(mlRolesForLiveCall[i], tensors[i]);
          }
        } catch (err) {
          // If the batch call fails, record an error for each role that needed it.
          const message = err instanceof Error ? err.message : String(err);
          log.warn('ML call failed', { operation: 'buildDemandAnalysisForRoles', eventId: event.event_id, roles: mlRolesForLiveCall }, err as Error);
          hasMlError = true;
          for (const mlRole of mlRolesForLiveCall) {
            mlErrors.push({ eventId: event.event_id, role: mlRole, message });
          }
        }
      }

      // ── Step C: merge cached tensors into per-DB-role accumulators ─────────
      for (const role of knownRoles) {
        const raw = mlCache.get(role.mlRole);
        if (!raw) continue; // was in mlRolesForLiveCall and the live call failed
        const acc = accumulators.get(role.id);
        const divisor = peerCountByClass.get(role.mlRole) ?? 1;
        if (acc) mergeTensorInto(acc.slots, raw, event.name, divisor);
      }
    }
  }

  // 4. Derive Supervision for Semi-Dynamic roles
  const supervisionRoles = params.roles.filter(
    r => r.forecasting_bucket === 'semi_dynamic' && r.supervision_ratio_min
  );

  if (supervisionRoles.length > 0) {
    // Total predicted headcount across all slots (excluding the supervisors themselves)
    const totalPredictedPerSlot = emptySlots().map((_, i) => {
      let sum = 0;
      for (const [roleId, acc] of accumulators) {
        if (!supervisionRoles.some(sr => sr.id === roleId)) {
          sum += acc.slots[i].requiredHeadcount;
        }
      }
      return sum;
    });

    for (const sRole of supervisionRoles) {
      const acc = accumulators.get(sRole.id);
      if (!acc) continue;
      const ratio = sRole.supervision_ratio_min!;
      acc.slots.forEach((slot, i) => {
        const derived = Math.ceil(totalPredictedPerSlot[i] / ratio);
        slot.requiredHeadcount = Math.max(slot.requiredHeadcount, derived);
      });
    }
  }

  // 5. Subtract coverage (Baseline + Existing) → residualHeadcount
  const tensors: DemandTensor[] = [];
  for (const [roleId, acc] of accumulators) {
    const existing = computeExistingCoverage(
      acc.slots,
      allCoverageShifts, // Includes both baseline and real DB shifts
      roleId,
      acc.subDepartmentId,
      params.buildingType,
    );

    const slots = acc.slots.map((s, i) => {
      const residual = s.requiredHeadcount - existing[i];
      return {
        ...s,
        residualHeadcount: residual,
        residualHeadcountInt: Math.round(Math.max(0, residual)),
      };
    });

    if (slots.every((s) => s.requiredHeadcount === 0 && s.residualHeadcount === 0)) continue;

    const isSupervision = supervisionRoles.some(sr => sr.id === roleId);

    tensors.push({
      roleId,
      subDepartmentId: acc.subDepartmentId,
      buildingType: params.buildingType,
      slots,
      demandSource: isSupervision ? 'derived' : 'ml_predicted',
    });
  }

  const baselineSynthesized: SynthesizedShift[] = baselineShifts.map(s => ({
    roleId: s.role_id,
    subDepartmentId: s.subgroup_id,
    buildingType: params.buildingType,
    startMinutes: timeToMinutes(s.start_time),
    endMinutes: timeToMinutes(s.end_time),
    type: 'core',
    headcount: 1,
    demand_source: 'baseline',
    target_employment_type: 'FT', // Default preference for baseline
  }));

  return {
    tensors,
    baselineShifts: baselineSynthesized,
    eventCount: events.length,
    hasMlError,
    mlErrors,
    demandTensorRows: allFinalizedRows,
  };
}
