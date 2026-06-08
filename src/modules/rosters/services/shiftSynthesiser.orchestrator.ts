import {
  DemandTensor,
  SynthesizedShift,
  minutesToTime,
  applySupervisorRatios,
  applyMinimumStaff,
} from '../domain/shiftSynthesizer.policy';
import {
  synthesizeShifts,
  getCoverageWindow,
} from './shiftSynthesiser.service';
import { SLOT_MINUTES, type DemandSlot } from '../domain/shiftSynthesizer.policy';
import type { DemandTensorInsertRow } from '../api/demandTensor.queries';
import { shiftsCommands } from '../api/shifts.commands';
import { synthesisRunsQueries } from '../api/synthesisRuns.queries';
import { processInChunks } from '../domain/bulk-action-engine';
import {
  fetchSupervisoryRatios,
  fetchMinimumStaffRules,
} from '../api/workRules.queries';
import type { CreateShiftData } from '../api/shifts.dto';
import type { TemplateGroupType } from '../domain/shift.entity';
import { supabase } from '@/platform/supabase/client';
import { createModuleLogger } from '@/modules/core/lib/logger';
import { tryAutoBuildTemplate, buildClusterKey } from './templateBuilder.service';
import { deriveRoomCount } from './eventFeatureBuilder.service';

// ── Compliance Engine v2 ──────────────────────────────────────────────────────
// Rewired from capstone's compliance.service to the parent's unified engine.
// All synthesized shifts are inserted as Draft for manager review (option b).
// Hard-blocked shifts are NOT silently dropped — they land as Draft with a
// compliance_status flag so a manager can inspect and approve or discard.
//
// TODO: The `shifts` table may not yet have a `compliance_status` column.
//       When it is added (planned for a later phase), stamp it here on insert.
//       For now we log the compliance result and proceed with Draft insertion.
import { runV8Orchestrator } from '@/modules/compliance/v8/index';
import { buildSkeletonInput } from '@/modules/planning/unified/compliance/input-builder';
import type { V8OrchestratorInput, V8OrchestratorShift } from '@/modules/compliance/v8/index';

const logger = createModuleLogger('shiftSynthesiser.orchestrator');

export interface SynthesizeAndInsertParams {
  demandTensors?: DemandTensor[];
  demandTensorRows?: DemandTensorInsertRow[];
  rosterId: string;
  departmentId: string;
  shiftDate: string; // YYYY-MM-DD
  organizationId?: string;
  timezone?: string;
  /** When provided, stamped onto every created shift so the run can be rolled back. */
  synthesisRunId?: string;
  /** Pre-synthesized shifts from templates (Step 1). */
  baselineShifts?: SynthesizedShift[];
  /** Pass the array of unassigned shift IDs computed from dry run for immediate deletion. */
  suggestedDeletions?: string[];
  /** Gate supervisor-ratio expansion (Step 6). Default true. */
  enforceSupervisorRatios?: boolean;
  /** Gate minimum-staff enforcement (Step 7). Default true. */
  enforceMinimumStaff?: boolean;
  /** Gate min 3h / max 12h shift duration (Steps 8-9). Default true. */
  enforceMinMax?: boolean;
  /** Merge sub-1h spikes into adjacent shifts. Default false. */
  mergeMicroPeaks?: boolean;
  /**
   * When true (default), attempt to auto-build or refresh an L9 demand template
   * for each unique event_id found in demandTensorRows after a successful insert.
   * Set to false in tests or callers that want to skip the post-synthesis step.
   */
  enableTemplateBuilder?: boolean;
}

export interface SynthesizeAndInsertResult {
  createdCount: number;
  deletedCount: number;
  failed: Array<{ index: number; reason: string }>;
  synthesizedShifts: SynthesizedShift[];
}

/** Map the shift's building type to the roster_group name a DB trigger accepts. */
function buildingTypeToGroupName(
  buildingType: string,
): 'Convention Centre' | 'Exhibition Centre' | 'Theatre' {
  if (buildingType === 'exhibition_centre') return 'Exhibition Centre';
  if (buildingType === 'theatre') return 'Theatre';
  return 'Convention Centre'; // Default
}

/**
 * Every shift row needs a `roster_subgroup_id` (NOT NULL). Resolve one for the
 * roster by reusing what's there, falling back to creating a minimal default.
 */
async function ensureDefaultRosterSubgroup(
  rosterId: string,
  buildingType: string,
): Promise<string> {
  const { data: groups, error: qErr } = await supabase
    .from('roster_groups')
    .select('id, name, roster_subgroups(id)')
    .eq('roster_id', rosterId);
  if (qErr) throw new Error(`Failed to read roster subgroups: ${qErr.message}`);

  const existingGroups = (groups ?? []) as Array<{
    id: string;
    name: string;
    roster_subgroups?: { id: string }[];
  }>;

  // 1. Any subgroup already attached anywhere on the roster — use it.
  for (const g of existingGroups) {
    if ((g.roster_subgroups ?? []).length > 0) return g.roster_subgroups![0].id;
  }

  // 2/3. Reuse an existing same-named group, or create the correctly-named one.
  const groupName = buildingTypeToGroupName(buildingType);
  let groupId = existingGroups.find((g) => g.name === groupName)?.id;

  if (!groupId) {
    const { data: newGroup, error: gErr } = await supabase
      .from('roster_groups')
      .insert({ roster_id: rosterId, name: groupName, sort_order: 0 })
      .select('id')
      .single();
    if (gErr || !newGroup)
      throw new Error(
        `Failed to create default roster_group: ${gErr?.message}`,
      );
    groupId = newGroup.id;
  }

  const { data: newSub, error: sErr } = await supabase
    .from('roster_subgroups')
    .insert({ roster_group_id: groupId, name: 'General', sort_order: 0 })
    .select('id')
    .single();
  if (sErr || !newSub)
    throw new Error(
      `Failed to create default roster_subgroup: ${sErr?.message}`,
    );

  return newSub.id;
}

/**
 * Run Compliance Engine v2 against a synthesized shift (skeleton mode -- no employee).
 *
 * Uses `employee_id: 'skeleton'` so only structural rules fire (R01 overlap,
 * R02 min length, R08 meal break). Employee-centric rules are skipped.
 *
 * Returns the compliance status string. 'BLOCKING' shifts are still inserted
 * as Draft so managers can review -- they are never silently dropped.
 */
function runSkeletonCompliance(
  shift: SynthesizedShift,
  shiftDate: string,
): { status: string; blocked: boolean } {
  const candidateShift: V8OrchestratorShift = {
    id: `synth-${shift.roleId}-${shift.startMinutes}-${shift.endMinutes}`,
    date: shiftDate,
    start_time: minutesToTime(shift.startMinutes),
    end_time: minutesToTime(shift.endMinutes),
    role_id: shift.roleId,
    required_qualifications: [],
    is_ordinary_hours: true,
    break_minutes: 0,
  };

  const input = buildSkeletonInput({ candidateShift });

  const result = runV8Orchestrator(input);
  const blocked = result.overall_status === 'BLOCKING';
  return { status: result.overall_status, blocked };
}

/**
 * Expand a single SynthesizedShift (which may have headcount > 1)
 * into individual CreateShiftData payloads ready for DB insertion.
 */
function expandToCreatePayloads(
  shifts: SynthesizedShift[],
  params: SynthesizeAndInsertParams,
  rosterSubgroupId: string,
): CreateShiftData[] {
  const payloads: CreateShiftData[] = [];

  for (const shift of shifts) {
    const base: CreateShiftData = {
      roster_id: params.rosterId,
      department_id: params.departmentId,
      shift_date: params.shiftDate,
      start_time: minutesToTime(shift.startMinutes),
      end_time: minutesToTime(shift.endMinutes),
      sub_department_id: shift.subDepartmentId,
      role_id: shift.roleId,
      group_type: shift.buildingType as TemplateGroupType,
      organization_id: params.organizationId ?? null,
      timezone: params.timezone ?? 'Australia/Sydney',
      creation_source: 'synthesizer',
      synthesis_run_id: params.synthesisRunId ?? null,
      shift_subgroup_id: rosterSubgroupId,
      notes: shift.reasons?.[0],
      demand_source: shift.demand_source,
      target_employment_type: shift.target_employment_type,
      demand_group_id: shift.demand_group_id,
    };

    for (let i = 0; i < shift.headcount; i++) {
      payloads.push({ ...base });
    }
  }

  return payloads;
}

/**
 * Phase 2 Refactor: Maps native `demand_tensor` (L7) rows to `DemandTensor` objects.
 * Performs a lookup in `function_map` and `roles` to resolve the exact `role_id`
 * and `sub_department_id` for each (function, level) bucket.
 */
async function mapRowsToTensors(rows: DemandTensorInsertRow[]): Promise<DemandTensor[]> {
  if (rows.length === 0) return [];

  // 1. Fetch the taxonomy mappings
  const { data: fmap, error: fErr } = await supabase.from('function_map').select('*');
  // TODO: 'employment_type' does not exist on the roles table in the generated types (schema drift).
  // Cast as any to access the column until the generated types are regenerated.
  const { data: roles, error: rErr } = await (supabase as any).from('roles').select('id, level, sub_department_id, employment_type') as { data: any[] | null; error: any };

  if (fErr || rErr) {
    logger.error('Failed to fetch taxonomy for demand mapping', { fErr, rErr, operation: 'mapRowsToTensors' });
    return [];
  }

  // 2. Group headcounts by resolved role_id
  const roleTensors = new Map<string, DemandTensor>();

  for (const row of rows) {
    // A single function_code can map to multiple sub-departments (e.g., F&B -> Culinary & Service)
    const matches = (fmap ?? []).filter(f => f.function_code === row.function_code);

    for (const m of matches) {
      // Find the specific role matching this sub-department and level
      const targetRole = (roles ?? []).find(r =>
        r.sub_department_id === m.sub_department_id &&
        r.level === row.level
      );

      if (!targetRole) {
        // This is expected for roles outside the current department scope
        continue;
      }

      const roleId = targetRole.id;
      if (!roleTensors.has(roleId)) {
        roleTensors.set(roleId, {
          roleId,
          subDepartmentId: m.sub_department_id,
          buildingType: 'convention_centre', // Default
          demandSource: 'derived',
          slots: SLOT_MINUTES.map(start => ({
            slotStart: start,
            slotEnd: start + 30,
            requiredHeadcount: 0,
            residualHeadcount: 0,
            residualHeadcountInt: 0,
          })),
        });
      }

      const tensor = roleTensors.get(roleId)!;
      const weightedHeadcount = Math.round(row.headcount * (m.weight ?? 1.0));

      if (row.slice_idx >= 0 && row.slice_idx < tensor.slots.length) {
        const slot = tensor.slots[row.slice_idx];
        slot.requiredHeadcount += weightedHeadcount;
        slot.residualHeadcount += weightedHeadcount;
        slot.residualHeadcountInt += weightedHeadcount;

        // Append explanations from the L7 row to the slot
        if (row.explanation && Array.isArray(row.explanation)) {
          const reasons = slot.reasons ?? [];
          // Deduplicate and append
          for (const exp of row.explanation) {
            if (typeof exp === 'string' && !reasons.includes(exp)) {
              reasons.push(exp);
            }
          }
          slot.reasons = reasons;
        }
      }
    }
  }

  return Array.from(roleTensors.values());
}

/**
 * Fire-and-forget post-synthesis hook: attempt to auto-build (or refresh) an
 * L9 demand template for each unique event_id present in demandTensorRows.
 *
 * Each event is processed independently -- one bad event does not abort the rest.
 * This function must never be awaited before the orchestrator returns its result.
 */
async function runTemplateBuilderForEvents(
  demandTensorRows: DemandTensorInsertRow[],
): Promise<void> {
  // Collect unique non-null event_ids from this run's tensor rows.
  const eventIds = [
    ...new Set(
      demandTensorRows
        .map((r) => r.event_id)
        .filter((id): id is string => id != null && id !== ''),
    ),
  ];

  if (eventIds.length === 0) return;

  await Promise.allSettled(
    eventIds.map(async (eventId) => {
      try {
        const { data: ev, error: evErr } = await supabase
          .from('venueops_events')
          .select('event_type_name, estimated_total_attendance, service_type, alcohol, venue_names')
          .eq('event_id', eventId)
          .single();

        if (evErr || !ev) {
          logger.warn('templateBuilder: could not fetch event row', { operation: 'runTemplateBuilderForEvents', eventId, error: evErr?.message });
          return;
        }

        const clusterKey = buildClusterKey({
          event_type:   ev.event_type_name ?? null,
          pax:          ev.estimated_total_attendance ?? 0,
          service_type: ev.service_type ?? null,
          alcohol:      ev.alcohol ?? null,
          room_count:   deriveRoomCount(ev.venue_names ?? null),
        });

        const template = await tryAutoBuildTemplate(clusterKey);
        if (template) {
          logger.info('templateBuilder: template upserted', {
            operation: 'runTemplateBuilderForEvents',
            eventId,
            templateCode: template.template_code,
            clusterKey,
          });
        } else {
          logger.info('templateBuilder: insufficient sample size, skipped', { operation: 'runTemplateBuilderForEvents', eventId, clusterKey });
        }
      } catch (err) {
        logger.warn('templateBuilder: error processing event', {
          operation: 'runTemplateBuilderForEvents',
          eventId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

/**
 * Full pipeline: synthesize shifts from demand tensors, apply business rules
 * (supervisor ratios + minimum staff), run compliance check per shift,
 * then insert all as draft shifts for manager review.
 *
 * Compliance rewiring (Phase 2c):
 *   - Capstone's compliance.service calls are replaced by runV8Orchestrator()
 *     from the parent's Compliance Engine v2.
 *   - Skeleton mode (employee_id = 'skeleton') evaluates structural rules only.
 *   - Option (b): all synthesized shifts land as Draft regardless of compliance
 *     status -- hard-blocked shifts are flagged in logs for manager review.
 *   - TODO: stamp compliance_status column on shift row once schema supports it.
 */
export async function synthesizeAndInsertShifts(
  params: SynthesizeAndInsertParams,
): Promise<SynthesizeAndInsertResult> {
  // Resolve demand tensors: either passed directly (ML fallback) or mapped from L7 rows (Rules)
  let demandTensors = params.demandTensors || [];
  if (params.demandTensorRows && params.demandTensorRows.length > 0) {
    const mapped = await mapRowsToTensors(params.demandTensorRows);
    // If we have both, prefer the mapped rows (rule-engine primary)
    demandTensors = mapped.length > 0 ? mapped : demandTensors;
  }

  let deletedCount = 0;
  if (params.suggestedDeletions && params.suggestedDeletions.length > 0) {
    try {
      deletedCount = await shiftsCommands.bulkDeleteShifts(
        params.suggestedDeletions,
      );
    } catch (err) {
      logger.error(
        'Failed to remove draft shift redundancies before new allocation',
        {
          err,
          operation: '',
        },
      );
    }
  }

  const enforceSupervisorRatios = params.enforceSupervisorRatios !== false;
  const enforceMinimumStaff = params.enforceMinimumStaff !== false;
  const synthesizeOptions = {
    enforceMinMax: params.enforceMinMax !== false,
    mergeMicroPeaks: params.mergeMicroPeaks === true,
  };

  // 1. Synthesize shifts from each demand tensor with the caller's options.
  const allShifts: SynthesizedShift[] = [];
  let globalCoverageWindow: { start: number; end: number } | null = null;

  for (const tensor of demandTensors) {
    const shifts = synthesizeShifts(tensor, synthesizeOptions);
    allShifts.push(...shifts);

    const cw = getCoverageWindow(tensor.slots);
    if (cw) {
      if (!globalCoverageWindow) {
        globalCoverageWindow = { ...cw };
      } else {
        globalCoverageWindow.start = Math.min(
          globalCoverageWindow.start,
          cw.start,
        );
        globalCoverageWindow.end = Math.max(globalCoverageWindow.end, cw.end);
      }
    }
  }

  if (allShifts.length === 0 && !globalCoverageWindow) {
    return { createdCount: 0, deletedCount, failed: [], synthesizedShifts: [] };
  }

  // 2. Fetch business rules from work_rules table only if we might use them.
  const subDeptIds = [
    ...new Set([
      ...allShifts.map((s) => s.subDepartmentId),
      ...(params.demandTensors ?? []).map((t) => t.subDepartmentId),
    ]),
  ];
  const [ratios, minimums] = await Promise.all([
    enforceSupervisorRatios
      ? fetchSupervisoryRatios(subDeptIds)
      : Promise.resolve([]),
    enforceMinimumStaff
      ? fetchMinimumStaffRules(subDeptIds)
      : Promise.resolve([]),
  ]);

  // 3. Apply supervisor ratios then minimum staff rules, each gated by flag.
  let finalShifts = enforceSupervisorRatios
    ? applySupervisorRatios(allShifts, ratios)
    : allShifts;

  // Add pre-synthesized baseline shifts
  if (params.baselineShifts) {
    finalShifts = [...finalShifts, ...params.baselineShifts];
  }

  if (globalCoverageWindow && enforceMinimumStaff) {
    finalShifts = applyMinimumStaff(
      finalShifts,
      minimums,
      globalCoverageWindow,
    );
  }

  // 4. Run Compliance Engine v2 per synthesized shift (skeleton -- no employee).
  //    All shifts proceed to Draft regardless of compliance status (option b).
  //    Blocked shifts are logged so managers can review them in the Draft queue.
  let complianceBlockedCount = 0;
  for (const shift of finalShifts) {
    const { status, blocked } = runSkeletonCompliance(shift, params.shiftDate);
    if (blocked) {
      complianceBlockedCount++;
      logger.warn('synthesized shift has structural compliance violation -- inserting as Draft for manager review', {
        operation: 'synthesizeAndInsertShifts',
        roleId: shift.roleId,
        subDepartmentId: shift.subDepartmentId,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        headcount: shift.headcount,
        complianceStatus: status,
        // TODO: stamp compliance_status on the shift row once the column exists.
      });
    }
  }

  if (complianceBlockedCount > 0) {
    logger.info('compliance check complete -- blocked shifts still inserted as Draft', {
      operation: 'synthesizeAndInsertShifts',
      totalShifts: finalShifts.length,
      complianceBlockedCount,
    });
  }

  // 5. Every shift needs a roster_subgroup_id -- use or create a default on this roster.
  const buildingType = finalShifts[0]?.buildingType ?? 'convention_centre';
  const defaultSubgroupId = await ensureDefaultRosterSubgroup(
    params.rosterId,
    buildingType,
  );

  // 6. Expand headcount into individual CreateShiftData payloads
  const payloads = expandToCreatePayloads(
    finalShifts,
    params,
    defaultSubgroupId,
  );

  if (payloads.length === 0) {
    return {
      createdCount: 0,
      deletedCount,
      failed: [],
      synthesizedShifts: finalShifts,
    };
  }

  // 7. Bulk insert using processInChunks (20 at a time)
  const results = await processInChunks(
    payloads.map((_, i) => String(i)),
    async (index) => {
      return shiftsCommands.createShift(payloads[Number(index)]);
    },
  );

  const failed: Array<{ index: number; reason: string }> = [];
  let createdCount = 0;
  const createdV8ShiftIds: string[] = [];

  for (const r of results) {
    if (r.ok) {
      createdCount++;
      const shift = (r as { value: { id?: string } }).value;
      if (shift?.id) createdV8ShiftIds.push(shift.id);
    } else {
      failed.push({
        index: Number(r.id),
        reason: (r as { id: string; ok: false; error: string }).error,
      });
    }
  }

  // 8. Stamp synthesis_run_id onto the new rows directly.
  //    The sm_create_shift RPC has a hardcoded field allow-list that predates
  //    this column, so it silently drops synthesis_run_id from the payload.
  if (params.synthesisRunId && createdV8ShiftIds.length > 0) {
    const { error: stampErr } = await supabase
      .from('shifts')
      .update({ synthesis_run_id: params.synthesisRunId })
      .in('id', createdV8ShiftIds);
    if (stampErr) {
      logger.error('failed to stamp synthesis_run_id', {
        runId: params.synthesisRunId,
        shiftIdCount: createdV8ShiftIds.length,
        supabaseError: stampErr.message,
        operation: '',
      });
    }
  }

  // 9. Fire-and-forget: attempt to auto-build / refresh L9 demand templates for
  //    each unique event_id present in this run's tensor rows.
  //    Guard: only when enableTemplateBuilder is not explicitly false, tensor rows
  //    exist, and at least one row carries a non-null event_id.
  const enableTemplateBuilder = params.enableTemplateBuilder !== false;
  const tensorRows = params.demandTensorRows;
  if (
    enableTemplateBuilder &&
    tensorRows &&
    tensorRows.length > 0 &&
    tensorRows.some((r) => r.event_id != null && r.event_id !== '')
  ) {
    // Intentionally not awaited -- must not block the return value.
    void runTemplateBuilderForEvents(tensorRows);
  }

  return { createdCount, deletedCount, failed, synthesizedShifts: finalShifts };
}

/**
 * Rollback a synthesis run. Deletes shifts that match the run id AND are still unassigned.
 * Assigned shifts are kept -- someone has already committed.
 */
export async function rollbackSynthesisRun(runId: string): Promise<{
  deletedCount: number;
  skippedAssigned: number;
  failedDeletes: Array<{ id: string; reason: string }>;
  orphaned: boolean;
}> {
  return synthesisRunsQueries.rollbackRun(runId);
}
