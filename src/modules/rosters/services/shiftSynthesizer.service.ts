import {
  DemandSlot,
  DemandTensor,
  PeakWindow,
  SHIFT_POLICY,
  SynthesizedShift,
  detectPeaks,
  mergeMicroPeaks,
  enforceMinDuration,
  enforceMaxDuration,
} from '../domain/shiftSynthesizer.policy';
import type { TemplateGroupType } from '../domain/shift.entity';

// window size for smoothing demand
const DEFAULT_WINDOW_SIZE = 3;

// Minimum ratio of the raw slot demand that smoothed demand may fall to before reverting to raw demand.
const MIN_RAW_DEMAND_RATIO = 0.9;

export interface MicroPeak {
  slotStart: number;
  slotEnd: number;
  headcount: number;
}

export interface DemandAnalysisResult {
  roleId: string;
  subDepartmentId: string;
  buildingType: TemplateGroupType;
  smoothedSlots: DemandSlot[];
  primaryPeak: PeakWindow | null;
  microPeaks: MicroPeak[];
  demandSource?: 'ml_predicted' | 'derived' | 'baseline' | null;
  targetEmploymentType?: 'FT' | 'PT' | 'Casual' | null;
}

// Smooths headcount values by replacing each slot's headcount with the average of itself and its neighbors
export function smoothDemand(
  slots: DemandSlot[],
  windowSize = DEFAULT_WINDOW_SIZE,
): DemandSlot[] {
  if (slots.length === 0) return [];

  const smoothedDemand: DemandSlot[] = slots.map((slot, index) => {
    const windowStart = Math.max(0, index - Math.floor(windowSize / 2));
    const windowEnd = Math.min(
      slots.length,
      index + Math.floor(windowSize / 2) + 1,
    );
    const windowSlots = slots.slice(windowStart, windowEnd);
    const averageRequired =
      windowSlots.reduce((sum, s) => sum + s.requiredHeadcount, 0) /
      windowSlots.length;
    const averageResidual =
      windowSlots.reduce((sum, s) => sum + s.residualHeadcount, 0) /
      windowSlots.length;
    const allEvents = windowSlots.flatMap(s => s.contributingEvents || []);
    const uniqueEvents = [...new Set(allEvents)];
    const allReasons = windowSlots.flatMap(s => s.reasons || []);
    const uniqueReasons = [...new Set(allReasons)];
    return {
      ...slot,
      requiredHeadcount: Math.round(averageRequired),
      residualHeadcount: Math.max(0, averageResidual),
      residualHeadcountInt: Math.max(0, Math.round(averageResidual)),
      contributingEvents: uniqueEvents,
      reasons: uniqueReasons,
    };
  });

  return smoothedDemand;
}

function identifyMicroPeaks(
  slots: DemandSlot[],
  peak: PeakWindow,
): MicroPeak[] {
  if (!peak) return [];
  const microPeaks: MicroPeak[] = slots
    .filter(
      (s) =>
        s.slotStart >= peak.peakStart &&
        s.slotEnd <= peak.peakEnd &&
        s.slotEnd - s.slotStart < SHIFT_POLICY.microPeakMinutes,
    )
    .map((s) => ({
      slotStart: s.slotStart,
      slotEnd: s.slotEnd,
      headcount: s.residualHeadcountInt > 0 ? s.residualHeadcountInt : 0,
    }));
  return microPeaks;
}

// Find the earliest and latest slots that has residual demand above 0
export function getCoverageWindow(
  slots: DemandSlot[],
): { start: number; end: number } | null {
  const neededSlots = slots.filter((s) => s.residualHeadcountInt > 0);
  if (neededSlots.length === 0) return null;
  const start = Math.min(...neededSlots.map((s) => s.slotStart));
  const end = Math.max(...neededSlots.map((s) => s.slotEnd));
  return { start, end };
}

function getHighestResidualHeadcount(residualSlots: DemandSlot[]): number {
  if (residualSlots.length === 0) return 0;
  return Math.max(...residualSlots.map((s) => s.residualHeadcountInt));
}

function getLowestResidualHeadcount(residualSlots: DemandSlot[]): number {
  if (residualSlots.length === 0) return 0;
  return Math.min(...residualSlots.map((s) => s.residualHeadcountInt));
}

function applyOverstaffTolerance(
  rawSlots: DemandSlot[],
  smoothedSlots: DemandSlot[],
): DemandSlot[] {
  return smoothedSlots.map((smoothed, i) => {
    const raw = rawSlots[i];
    const minAcceptable = Math.ceil(
      raw.residualHeadcountInt * MIN_RAW_DEMAND_RATIO,
    );

    if (smoothed.residualHeadcountInt < minAcceptable) {
      return {
        ...smoothed,
        residualHeadcount: raw.residualHeadcount,
        residualHeadcountInt: raw.residualHeadcountInt,
        requiredHeadcount: Math.max(
          smoothed.requiredHeadcount,
          raw.requiredHeadcount,
          raw.residualHeadcountInt,
        ),
      };
    }
    return smoothed;
  });
}

// Create long core shifts covering the majority of the demand window then subtract covered demand
export function packShifts(demand: DemandAnalysisResult): SynthesizedShift[] {
  const { roleId, subDepartmentId, buildingType, primaryPeak } = demand;

  const residualSlots = demand.smoothedSlots.map((s) => ({ ...s }));
  if (residualSlots.every((s) => s.residualHeadcountInt <= 0)) return [];

  const shifts: SynthesizedShift[] = [];

  let hasRemainingDemand = true;
  while (hasRemainingDemand) {
    const maxResidualHeadcount = getHighestResidualHeadcount(residualSlots);
    if (maxResidualHeadcount === 0) {
      hasRemainingDemand = false;
      break;
    }
    const peakIndex = residualSlots.findIndex(
      (s) => s.residualHeadcountInt === maxResidualHeadcount,
    );

    let shiftStart = peakIndex;
    let shiftEnd = peakIndex;

    while (
      shiftStart > 0 &&
      residualSlots[shiftStart - 1].residualHeadcountInt > 0
    ) {
      shiftStart--;
    }
    while (
      shiftEnd < residualSlots.length - 1 &&
      residualSlots[shiftEnd + 1].residualHeadcountInt > 0
    ) {
      shiftEnd++;
    }
    const coverageWindow = residualSlots.slice(shiftStart, shiftEnd + 1);
    const minHeadcount = getLowestResidualHeadcount(coverageWindow);

    const uniqueEvents = new Set<string>();
    const uniqueReasons = new Set<string>();
    for (let i = shiftStart; i <= shiftEnd; i++) {
      residualSlots[i].residualHeadcountInt -= minHeadcount;
      const events = residualSlots[i].contributingEvents;
      if (events) events.forEach((e) => uniqueEvents.add(e));
      const rsn = residualSlots[i].reasons;
      if (rsn) rsn.forEach((r) => uniqueReasons.add(r));
    }

    const eventsList = Array.from(uniqueEvents);
    let reason: string | undefined = undefined;
    if (eventsList.length > 0) {
      const joined = eventsList.slice(0, 2).join(', ');
      reason = `Generated to meet demand for: ${joined}${eventsList.length > 2 ? ` and ${eventsList.length - 2} more` : ''}`;
    }

    shifts.push({
      roleId,
      subDepartmentId,
      buildingType,
      startMinutes: residualSlots[shiftStart].slotStart,
      endMinutes: residualSlots[shiftEnd].slotEnd,
      type:
        primaryPeak &&
        residualSlots[shiftStart].slotStart >= primaryPeak.peakStart &&
        residualSlots[shiftEnd].slotEnd <= primaryPeak.peakEnd
          ? 'peak_buffer'
          : 'core',
      headcount: minHeadcount,
      reasons: Array.from(uniqueReasons),
      demand_source: demand.demandSource,
      target_employment_type: demand.targetEmploymentType ?? undefined,
    });
  }
  return shifts;
}

/**
 * Runtime-configurable options for the shift-packing pipeline.
 */
export interface SynthesizeShiftsOptions {
  /** Pad shifts < 3h and split shifts > 12h. Default: true. */
  enforceMinMax?: boolean;
  /** Merge sub-1h spikes into adjacent shifts. Default: false. */
  mergeMicroPeaks?: boolean;
}

// Main function to synthesize shifts from demand tensor input
export function synthesizeShifts(
  demandTensor: DemandTensor,
  options: SynthesizeShiftsOptions = {},
): SynthesizedShift[] {
  const {
    enforceMinMax = true,
    mergeMicroPeaks: shouldMergeMicroPeaks = false,
  } = options;

  const smoothedSlots = smoothDemand(demandTensor.slots);
  const primaryPeak = detectPeaks(smoothedSlots, demandTensor.roleId);
  const microPeaks = identifyMicroPeaks(smoothedSlots, primaryPeak!);

  const toleratedSmoothedSlots = applyOverstaffTolerance(
    demandTensor.slots,
    smoothedSlots,
  );

  const demandAnalysisResult: DemandAnalysisResult = {
    roleId: demandTensor.roleId,
    subDepartmentId: demandTensor.subDepartmentId,
    buildingType: demandTensor.buildingType,
    smoothedSlots: toleratedSmoothedSlots,
    primaryPeak,
    microPeaks,
    demandSource: demandTensor.demandSource,
    targetEmploymentType: demandTensor.targetEmploymentType,
  };
  let shifts = packShifts(demandAnalysisResult);

  if (shouldMergeMicroPeaks) {
    shifts = mergeMicroPeaks(shifts);
  }

  if (enforceMinMax) {
    shifts = enforceMinDuration(shifts);
    shifts = enforceMaxDuration(shifts);
  }

  return shifts;
}
