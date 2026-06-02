import {} from './shiftSynthesiser.service';
import {
  DemandSlot,
  DemandTensor,
} from '@/modules/rosters/domain/shiftSynthesizer.policy';
import type { TemplateGroupType } from '../domain/shift.entity';

const ML_URL = (import.meta.env.VITE_ML_URL as string | undefined) || 'http://localhost:8000';
type EventType =
  | 'Concert'
  | 'Conference'
  | 'Corporate'
  | 'Exhibition'
  | 'Festival'
  | 'Gala Dinner'
  | 'Sporting Event'
  | 'Trade Show';
type FunctionType =
  | 'Breakout'
  | 'Ceremony'
  | 'Dinner'
  | 'Meeting'
  | 'Performance'
  | 'Reception'
  | 'Workshop';

export interface EventInput {
  eventType: EventType;
  expectedAttendance: number;
  dayOfWeek: number;
  month: number;
  functionType: FunctionType;
  roomCount: number;
  totalSqm: number;
  roomCapacity: number;
  simultaneousEventCount: number;
  totalVenueAttendanceSameTime: number;
  entryPeakFlag: boolean;
  exitPeakFlag: boolean;
  mealWindowFlag: boolean;
  timeSliceIndex: number;
  timeSliceCount: number;
  buildingType: TemplateGroupType;
  eventId?: string;
  synthesisRunId?: string;
  scenarioId?: string;
}

interface RoleResult {
  predicted: number;
  corrected: number;
}

/**
 * Roles the FastAPI ML service actually has trained models for.
 * Must match ROLES in ml/predict.py. Any other role passed to buildDemandAnalysis
 * will throw — callers should filter to this set first.
 */
export const ML_KNOWN_ROLES = ['Usher', 'Security', 'Food Staff', 'Supervisor'] as const;
export type MLKnownRole = typeof ML_KNOWN_ROLES[number];

export function isMLKnownRole(role: string): role is MLKnownRole {
  return (ML_KNOWN_ROLES as readonly string[]).includes(role);
}

/**
 * DB-backed lookup: returns the ML class for a role by its id, or null if unmapped.
 * Caller fetches the map once via `fetchRoleMLClassMap()` and reuses it across roles.
 */
export function resolveMLRoleById(
  roleId: string,
  map: ReadonlyMap<string, MLKnownRole>,
): MLKnownRole | null {
  return map.get(roleId) ?? null;
}

/**
 * @deprecated Fallback only. Prefer `resolveMLRoleById` with the DB-backed
 * `role_ml_class_map` table. Kept to handle roles that exist but were
 * created after the last regen of the mapping table.
 *
 * Precedence (first match wins):
 *   1. Supervisory titles → Supervisor
 *   2. Usher-style titles → Usher
 *   3. F&B / kitchen / beverage → Food Staff
 *   4. Security / guard / risk → Security
 *   5. Everything else → null
 */
export function resolveMLRoleByNameFallback(roleName: string): MLKnownRole | null {
  const n = roleName.toLowerCase();
  if (/supervisor|\bmanager\b|team\s*lead|coordinator|director|\bhead\b|\bchief\b|\bceo\b|duty/.test(n)) return 'Supervisor';
  if (/usher|greeter|ticketing/.test(n)) return 'Usher';
  if (/food|catering|f&b|beverage|\bbar\b|chef|cook|\bcafe\b|kitchen|waiter|waitress|\bserver\b/.test(n)) return 'Food Staff';
  if (/security|guard|\brisk\b|safety/.test(n)) return 'Security';
  return null;
}

type ApiSlicePayload = {
  event_type: EventType;
  function_type: FunctionType;
  expected_attendance: number;
  day_of_week: number;
  month: number;
  room_count: number;
  total_sqm: number;
  room_capacity: number;
  simultaneous_event_count: number;
  total_venue_attendance_same_time: number;
  entry_peak_flag: boolean;
  exit_peak_flag: boolean;
  meal_window_flag: boolean;
  event_id?: string;
  time_slice_index: number;
  synthesis_run_id?: string;
  scenario_id?: string;
};

function toApiPayload(request: EventInput): ApiSlicePayload {
  return {
    event_type: request.eventType,
    function_type: request.functionType,
    expected_attendance: request.expectedAttendance,
    day_of_week: request.dayOfWeek,
    month: request.month,
    room_count: request.roomCount,
    total_sqm: request.totalSqm,
    room_capacity: request.roomCapacity,
    simultaneous_event_count: request.simultaneousEventCount,
    total_venue_attendance_same_time: request.totalVenueAttendanceSameTime,
    entry_peak_flag: request.entryPeakFlag,
    exit_peak_flag: request.exitPeakFlag,
    meal_window_flag: request.mealWindowFlag,
    event_id: request.eventId,
    time_slice_index: request.timeSliceIndex,
    synthesis_run_id: request.synthesisRunId,
    scenario_id: request.scenarioId,
  };
}

export async function predictSlice(request: EventInput): Promise<RoleResult[]> {
  const response = await fetch(`${ML_URL}/predict/demand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toApiPayload(request)),
  });

  if (!response.ok) {
    throw new Error(
      `ML prediction failed for event ${request.eventId ?? 'unknown'} slice ${request.timeSliceIndex}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * Batch endpoint binding. Sends N slice requests in ONE POST and returns the
 * server-ordered list of per-slice results. Server cap is 500 items.
 */
export async function predictBatch(requests: EventInput[]): Promise<Record<string, RoleResult>[]> {
  if (requests.length === 0) return [];
  const response = await fetch(`${ML_URL}/predict/demand/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests.map(toApiPayload)),
  });
  if (!response.ok) {
    throw new Error(
      `ML batch prediction failed for event ${requests[0]?.eventId ?? 'unknown'} (${requests.length} slices): HTTP ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * Send all `timeSliceCount` slice requests in ONE batch POST, then slice the
 * per-role predictions out of each response. Returns one DemandTensor per
 * entry in `roles`, in the same order.
 *
 * Call-count math: 1 HTTP call per event regardless of N roles or S slices.
 * Before Phase 1: N × S calls. After Phase 1: S calls. After Phase 4: 1 call.
 *
 * Scope: the slice responses are accumulated in a local array that is GC'd when
 * this function returns — no cross-run state or global cache.
 */
export async function buildDemandAnalysisForRoles(
  event: EventInput,
  roles: string[],
  derivePerSliceFlags?: (sliceIndex: number) => {
    entryPeakFlag: boolean;
    exitPeakFlag: boolean;
    mealWindowFlag: boolean;
  },
): Promise<DemandTensor[]> {
  const sliceRequests: EventInput[] = Array.from({ length: event.timeSliceCount }, (_, i) => {
    const flagOverrides = derivePerSliceFlags ? derivePerSliceFlags(i) : {};
    return { ...event, timeSliceIndex: i, ...flagOverrides };
  });

  const slices = await predictBatch(sliceRequests);

  // Guard: if the first slice came back empty the ML service is broken.
  if (!slices[0]) {
    throw new Error(
      `ML service returned an empty response for event '${event.eventId ?? 'unknown'}' slice 0`,
    );
  }

  // Build one DemandTensor per requested role from the shared slice responses.
  return roles.map((role) => {
    if (!(role in slices[0])) {
      throw new Error(
        `ML service did not return predictions for role '${role}'. Known roles: ${ML_KNOWN_ROLES.join(', ')}`,
      );
    }

    const packingSlots: DemandSlot[] = slices.map((slice, i) => {
      const corrected = (slice as unknown as Record<string, RoleResult>)[role].corrected;
      return {
        slotStart: i,
        slotEnd: i + 1,
        requiredHeadcount: corrected,
        residualHeadcount: corrected,
        residualHeadcountInt: Math.round(corrected),
      };
    });

    return {
      roleId: role,
      subDepartmentId: event.eventId ?? '',
      buildingType: event.buildingType,
      slots: packingSlots,
    };
  });
}

/**
 * Thin back-compat wrapper around buildDemandAnalysisForRoles.
 * Callers that pass a single role continue to work unchanged.
 * New callers should use buildDemandAnalysisForRoles directly to avoid
 * redundant HTTP round-trips when processing multiple roles per event.
 */
export async function buildDemandAnalysis(
  event: EventInput,
  role: string,
  derivePerSliceFlags?: (sliceIndex: number) => {
    entryPeakFlag: boolean;
    exitPeakFlag: boolean;
    mealWindowFlag: boolean;
  },
): Promise<DemandTensor> {
  const results = await buildDemandAnalysisForRoles(event, [role], derivePerSliceFlags);
  return results[0];
}
