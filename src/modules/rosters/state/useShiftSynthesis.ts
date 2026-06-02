import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  synthesizeAndInsertShifts,
  rollbackSynthesisRun,
  type SynthesizeAndInsertParams,
  type SynthesizeAndInsertResult,
} from '../services/shiftSynthesiser.orchestrator';
import {
  previewShiftSynthesis,
  type DeltaPreviewResponse,
  markSynthesisAsApplied,
} from '../services/shiftSynthesiser.scan';
import { computeExistingCoverage } from '../services/demandTensorBuilder.service';
import { synthesisRunsQueries } from '../api/synthesisRuns.queries';
import { shiftKeys } from '../api/queryKeys';
import { createModuleLogger } from '@/modules/core/lib/logger';
import type { DemandTensor, SynthesizedShift } from '../domain/shiftSynthesizer.policy';
import type { Shift } from '../domain/shift.entity';

const log = createModuleLogger('shiftSynthesis');

export interface GenerateShiftsInput extends Omit<
  SynthesizeAndInsertParams,
  'synthesisRunId'
> {
  organizationId: string;
  subDepartmentId: string | null;
  baselineShifts?: SynthesizedShift[];
  /** Persisted verbatim on the synthesis_runs audit row. */
  options: Record<string, unknown>;
  snapshotHash?: string;
  suggestedDeletions?: string[];
}

export interface GenerateShiftsSuccess extends SynthesizeAndInsertResult {
  runId: string;
}

/**
 * Generate shifts in two steps:
 *   1. Insert synthesis_runs row → get runId.
 *   2. Call orchestrator with that runId → shifts get stamped.
 *   3. Finalize the run row with attempted/created counts.
 */
export function useGenerateShifts() {
  const queryClient = useQueryClient();

  return useMutation<GenerateShiftsSuccess, Error, GenerateShiftsInput>({
    mutationFn: async (input) => {
      log.info('generating shifts', {
        operation: 'useGenerateShifts',
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        subDepartmentId: input.subDepartmentId,
        rosterId: input.rosterId,
        shiftDate: input.shiftDate,
        tensorCount: input.demandTensors?.length ?? 0,
      });

      const run = await synthesisRunsQueries.createRun({
        organization_id: input.organizationId,
        department_id: input.departmentId,
        sub_department_id: input.subDepartmentId,
        roster_id: input.rosterId,
        shift_date: input.shiftDate,
        options: input.options,
      });
      log.info('synthesis run created', {
        operation: 'useGenerateShifts',
        runId: run.id,
      });

      // P1 follow-up: re-call buildScopeDemand here with synthesisRunId so
      // demand_forecasts rows get stamped for rollback. The page currently
      // builds tensors at preview-time without a run id, so the ML service
      // skips its DB write (see ml/api.py gate). To make rollback fully
      // revert predictions, plumb roles+existingShifts+buildingType from the
      // page into GenerateShiftsInput and fire one more buildScopeDemand call
      // here. Skipped in Phase-1 to keep surface area small.

      const result = await synthesizeAndInsertShifts({
        demandTensors: input.demandTensors,
        demandTensorRows: input.demandTensorRows,
        baselineShifts: input.baselineShifts,
        rosterId: input.rosterId,
        departmentId: input.departmentId,
        shiftDate: input.shiftDate,
        organizationId: input.organizationId,
        timezone: input.timezone,
        synthesisRunId: run.id,
        suggestedDeletions: input.suggestedDeletions,
        enforceSupervisorRatios: input.enforceSupervisorRatios,
        enforceMinimumStaff: input.enforceMinimumStaff,
        enforceMinMax: input.enforceMinMax,
        mergeMicroPeaks: input.mergeMicroPeaks,
      });

      if (input.snapshotHash) {
        markSynthesisAsApplied(input.snapshotHash);
      }

      const attempted = result.synthesizedShifts.reduce(
        (s, sh) => s + sh.headcount,
        0,
      );
      await synthesisRunsQueries.finalizeRun(
        run.id,
        attempted,
        result.createdCount,
        result.deletedCount,
      );

      log.info('shifts inserted', {
        operation: 'useGenerateShifts',
        runId: run.id,
        attempted,
        createdCount: result.createdCount,
        failedCount: result.failed.length,
        synthesizedShiftCount: result.synthesizedShifts.length,
      });

      if (result.failed.length > 0) {
        const uniqueReasons = [
          ...new Set(result.failed.map((f) => f.reason)),
        ].slice(0, 5);
        log.error('shifts failed to insert', {
          operation: 'useGenerateShifts',
          runId: run.id,
          attempted,
          createdCount: result.createdCount,
          failedCount: result.failed.length,
          uniqueReasons,
        });
      }

      return { ...result, runId: run.id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: ['scopeDemand'] });
    },
    onError: (err) => {
      log.error('generation failed', { operation: 'useGenerateShifts' }, err);
    },
  });
}

export function useRollbackSynthesisRun() {
  const queryClient = useQueryClient();

  return useMutation<
    {
      deletedCount: number;
      skippedAssigned: number;
      failedDeletes: Array<{ id: string; reason: string }>;
      orphaned: boolean;
    },
    Error,
    string
  >({
    mutationFn: async (runId) => {
      log.info('rolling back run', {
        operation: 'useRollbackSynthesisRun',
        runId,
      });
      const result = await rollbackSynthesisRun(runId);
      log.info('rollback complete', {
        operation: 'useRollbackSynthesisRun',
        runId,
        deletedCount: result.deletedCount,
        skippedAssigned: result.skippedAssigned,
        orphaned: result.orphaned,
        failedDeleteCount: result.failedDeletes.length,
      });
      if (result.failedDeletes.length > 0) {
        log.error('rollback partial failure', {
          operation: 'useRollbackSynthesisRun',
          runId,
          uniqueReasons: [
            ...new Set(result.failedDeletes.map((f) => f.reason)),
          ].slice(0, 5),
        });
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    },
    onError: (err) => {
      log.error(
        'rollback failed',
        { operation: 'useRollbackSynthesisRun' },
        err,
      );
    },
  });
}

/**
 * Preview shift synthesis safely using idempotency and fast calculations via DeltaPreviewResponse.
 */
export function useShiftSynthesisPreview(
  demandTensors: DemandTensor[] | undefined,
  baselineShifts: SynthesizedShift[] | undefined,
  existingShifts: Shift[] | undefined,
  enabled: boolean,
) {
  return useQuery<DeltaPreviewResponse, Error>({
    queryKey: [
      'shiftSynthesisPreview',
      demandTensors?.length,
      demandTensors?.map((t) => `${t.roleId}-${t.subDepartmentId}`).join('|'),
      existingShifts?.length,
      existingShifts
        ?.map((s) => `${s.id}-${s.lifecycle_status}`)
        .slice(0, 100)
        .join('|'),
    ],
    queryFn: async () => {
      if (!demandTensors || !existingShifts)
        return {
          snapshotHash: '',
          addedShifts: [],
          suggestedDeletions: [],
          projectedCostDelta: 0,
          isIdempotent: true,
        };

      // Recalculate residualHeadcount based on the latest existingShifts
      const updatedTensors = demandTensors.map((tensor) => {
        const coverage = computeExistingCoverage(
          tensor.slots,
          existingShifts,
          tensor.roleId,
          tensor.subDepartmentId,
          tensor.buildingType,
        );
        return {
          ...tensor,
          slots: tensor.slots.map((s, i) => {
            const residual = s.requiredHeadcount - coverage[i];
            return {
              ...s,
              residualHeadcount: residual,
              residualHeadcountInt: Math.round(Math.max(0, residual)),
            };
          }),
        };
      });

      const preview = await previewShiftSynthesis(
        updatedTensors,
        existingShifts,
      );

      return {
        ...preview,
        addedShifts: [...preview.addedShifts, ...(baselineShifts || [])],
        appliedTensors: updatedTensors,
      };
    },
    enabled: enabled && !!demandTensors && !!existingShifts,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
