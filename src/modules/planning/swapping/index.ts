/**
 * Swapping Sub-Module - Public API
 * Shift swapping functionality
 */

// API
export * from './api/swaps.api';

// Types — explicitly re-export to avoid SwapOffer duplicate from swaps.api
export type {
    SwapType,
    SwapStatus,
    SwapRequest,
    SwapRequestWithDetails,
    TradeRequestStatus,
    SwapRequestStatus,
    SwapOfferStatus,
    SwapPriority,
    TradeRequest,
    SwapOfferWithDetails,
} from './model/swap.types';

// State
export * from './state/useSwaps';

// UI Components (selective exports)
// Add specific component exports as needed
