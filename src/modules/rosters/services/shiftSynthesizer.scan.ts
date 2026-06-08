import {
  DemandTensor,
  SynthesizedShift,
} from '../domain/shiftSynthesizer.policy';
import { synthesizeShifts } from './shiftSynthesizer.service';
import type { Shift } from '../domain/shift.entity';
import { timeToMinutes } from '../domain/shiftSynthesizer.policy';

export interface DeltaPreviewResponse {
  appliedTensors?: DemandTensor[];
  snapshotHash: string;
  addedShifts: SynthesizedShift[];
  suggestedDeletions: string[];
  projectedCostDelta: number;
  isIdempotent: boolean;
}

// Simple in-memory cache for idempotency tracking and performance
const appliedHashes = new Set<string>();
const previewCache = new Map<string, DeltaPreviewResponse>();

export function markSynthesisAsApplied(hash: string): void {
  appliedHashes.add(hash);
  // Clear preview cache to force re-computation on next fetch (prevents loop with stale results)
  previewCache.clear();
}

export function hasSynthesisBeenApplied(hash: string): boolean {
  return appliedHashes.has(hash);
}

export async function generateSnapshotHash(
  demandTensors: DemandTensor[],
  existingDraftShifts: Shift[],
): Promise<string> {
  const payload = JSON.stringify({
    demand: demandTensors.map((t) => ({
      role: t.roleId,
      subDept: t.subDepartmentId,
      building: t.buildingType,
      slots: t.slots.map((s) => ({
        start: s.slotStart,
        req: s.requiredHeadcount,
        res: s.residualHeadcount,
      })),
    })),
    shifts: existingDraftShifts
      .map((s) => ({
        id: s.id,
        start: s.start_time,
        end: s.end_time,
        role: s.role_id,
        subDept: s.sub_department_id,
        status: s.lifecycle_status,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });

  const msgUint8 = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function suggestSafeDeletions(
  demandTensors: DemandTensor[],
  existingShifts: Shift[],
): { safeDeletions: string[]; adjustedResiduals: Map<string, number> } {
  const safeDeletions: Set<string> = new Set();

  // Create a GLOBAL shadow of residuals across ALL tensors to prevent double-deletion.
  const shadowResiduals = new Map<string, number>();
  for (const tensor of demandTensors) {
    for (const slot of tensor.slots) {
      const key = `${tensor.roleId}-${tensor.subDepartmentId || ''}-${tensor.buildingType}-${slot.slotStart}`;
      shadowResiduals.set(key, slot.residualHeadcount);
    }
  }

  const eligibleShifts = existingShifts
    .filter(
      (s) =>
        s.lifecycle_status === 'Draft' &&
        s.assigned_employee_id === null &&
        s.start_time &&
        s.end_time &&
        s.role_id,
    )
    .map((s) => {
      const lengthMinutes =
        s.scheduled_length_minutes ??
        timeToMinutes(s.end_time) - timeToMinutes(s.start_time);
      return { ...s, lengthMinutes };
    })
    .sort((a, b) => a.lengthMinutes - b.lengthMinutes); // Sort shortest to longest

  for (const shift of eligibleShifts) {
    const startMin = timeToMinutes(shift.start_time);
    const endMin = timeToMinutes(shift.end_time);

    const relevantTensors = demandTensors.filter(
      (t) =>
        t.roleId === shift.role_id &&
        (t.subDepartmentId || null) === (shift.sub_department_id || null) &&
        t.buildingType === (shift.group_type || 'convention_centre'),
    );

    if (relevantTensors.length === 0) continue;

    let canDeleteAcrossAll = true;
    const affectedTensorsAndSlots: Array<{ key: string; contribution: number }> = [];

    for (const tensor of relevantTensors) {
      const overlappingSlots = tensor.slots
        .filter((s) => s.slotStart < endMin && s.slotEnd > startMin)
        .sort((a, b) => a.slotStart - b.slotStart);

      if (overlappingSlots.length === 0) {
        canDeleteAcrossAll = false;
        break;
      }

      // Blindspot Check
      const firstSlot = overlappingSlots[0];
      const lastSlot = overlappingSlots[overlappingSlots.length - 1];
      if (firstSlot.slotStart > startMin || lastSlot.slotEnd < endMin) {
        canDeleteAcrossAll = false;
        break;
      }

      let hasDeficit = false;
      let oversuppliedContribution = 0;
      let totalShiftContributionAcrossSlots = 0;

      for (const slot of overlappingSlots) {
        const key = `${tensor.roleId}-${tensor.subDepartmentId || ''}-${tensor.buildingType}-${slot.slotStart}`;
        const currentRes = shadowResiduals.get(key) ?? 0;

        const overlapStart = Math.max(startMin, slot.slotStart);
        const overlapEnd = Math.min(endMin, slot.slotEnd);
        const overlapMins = Math.max(0, overlapEnd - overlapStart);
        const contribution = overlapMins / (slot.slotEnd - slot.slotStart);

        if (currentRes + contribution > 0.001) {
          hasDeficit = true;
          break;
        }

        if (currentRes < -0.001) {
          oversuppliedContribution += contribution;
        }
        totalShiftContributionAcrossSlots += contribution;
        affectedTensorsAndSlots.push({ key, contribution });
      }

      const oversupplyRatio = totalShiftContributionAcrossSlots > 0
        ? oversuppliedContribution / totalShiftContributionAcrossSlots
        : 0;

      if (hasDeficit || oversupplyRatio < 0.8) {
        canDeleteAcrossAll = false;
        break;
      }
    }

    if (canDeleteAcrossAll && affectedTensorsAndSlots.length > 0) {
      safeDeletions.add(shift.id);
      for (const { key, contribution } of affectedTensorsAndSlots) {
        const current = shadowResiduals.get(key) ?? 0;
        shadowResiduals.set(key, current + contribution);
      }
    }
  }

  return {
    safeDeletions: Array.from(safeDeletions),
    adjustedResiduals: shadowResiduals,
  };
}

export async function previewShiftSynthesis(
  demandTensors: DemandTensor[],
  existingShifts: Shift[],
): Promise<DeltaPreviewResponse> {
  // 1. Generate deterministic hash based purely on the inputs
  const snapshotHash = await generateSnapshotHash(
    demandTensors,
    existingShifts,
  );

  // 2. Cache & Idempotency Check
  if (hasSynthesisBeenApplied(snapshotHash)) {
    return {
      snapshotHash,
      addedShifts: [],
      suggestedDeletions: [],
      projectedCostDelta: 0,
      isIdempotent: true,
    };
  }

  const cached = previewCache.get(snapshotHash);
  if (cached) return cached;

  // 3. Heavy Async Processing
  const { safeDeletions, adjustedResiduals } = suggestSafeDeletions(
    demandTensors,
    existingShifts,
  );

  const updatedTensors = demandTensors.map((tensor) => ({
    ...tensor,
    slots: tensor.slots.map((slot) => {
      const key = `${tensor.roleId}-${tensor.subDepartmentId || ''}-${tensor.buildingType}-${slot.slotStart}`;
      const res = adjustedResiduals.get(key) ?? slot.residualHeadcount;
      return {
        ...slot,
        residualHeadcount: res,
        residualHeadcountInt: Math.round(Math.max(0, res)),
      };
    }),
  }));

  const addedShifts: SynthesizedShift[] = [];
  for (const tensor of updatedTensors) {
    const shifts = synthesizeShifts(tensor);
    addedShifts.push(...shifts);
  }

  const isIdempotent =
    addedShifts.length === 0 && safeDeletions.length === 0;

  const response: DeltaPreviewResponse = {
    snapshotHash,
    addedShifts,
    suggestedDeletions: safeDeletions,
    projectedCostDelta: 0, // Mocked for phase 5 UI
    isIdempotent,
    appliedTensors: updatedTensors,
  };

  previewCache.set(snapshotHash, response);
  return response;
}
