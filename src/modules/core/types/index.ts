/**
 * Global Types Definition File
 * Aggregates types from various modules.
 */

// ===================================
// 1. ROSTERS & SHIFTS
// ===================================
export * from '@/modules/rosters/model/shift.types';

// ===================================
// 2. USERS & EMPLOYEES
// ===================================
export * from '@/modules/users/model/employee.types';

// ===================================
// 3. CORE / ORGANIZATION
// ===================================
export * from '@/modules/core/model/org.types';

// ===================================
// 4. TEMPLATES
// ===================================
export * from '@/modules/templates/model/templates.types';

// ===================================
// 5. BROADCASTS
// ===================================
// Re-export everything except Employee (which conflicts with users module)
export type {
  Broadcast,
  BroadcastGroup,
  BroadcastChannel,
  BroadcastPriority,
  BroadcastStatus,
  BroadcastParticipantRole,
} from '@/modules/broadcasts/model/broadcast.types';

// ===================================
// 6. AVAILABILITY
// ===================================
export * from '@/modules/availability/model/availability.types';

// ===================================
// 7. PLANNING (BIDDING/SWAPPING)
// ===================================
export {
    type BidStatus,
    type TradeRequestStatus,
    type SwapRequestStatus,
    type SwapOfferStatus,
    type SwapPriority,
    type ShiftBid,
    type Bid,
    type TradeRequest,
    type SwapType,
    type SwapRequest,
    type SwapRequestWithDetails,
    type SwapOffer,
    type SwapOfferWithDetails
} from '@/modules/planning';

// ===================================
// 7. TIMESHEETS
// ===================================
export {
    type Timesheet,
    type TimesheetRow,
} from '@/modules/timesheets/model/timesheet.types';


