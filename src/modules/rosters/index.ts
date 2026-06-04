/**
 * Rosters Module - Public API
 * Shift scheduling and management (Domain-Driven Design)
 */

// Domain Layer - Commands (Write Operations)
export * from './domain/commands/createShift.command';
export * from './domain/commands/updateShift.command';
export * from './domain/commands/deleteShift.command';
export * from './domain/commands/assignShift.command';
export * from './domain/commands/publishRoster.command';

export * from './domain/commands/createSubGroup.command';

// Domain Layer - Queries (Read Operations)
export * from './domain/queries/getRostersForPeriod.query';
export * from './domain/queries/getShiftDetails.query';
export * from './domain/queries/getGroupsModeGrid.query';
export * from './domain/queries/getOrgHierarchy.query';

// Domain Layer - Policies (Business Rules)
export * from './domain/policies/canEditShift.policy';
export * from './domain/policies/canPublishRoster.policy';

// Domain Entities & Types
export * from './domain/shift.entity';
export * from './model/roster.types';

// API Layer
export * from './api/shifts.queries';
export * from './api/shifts.commands';
export type { Shift } from './api/shifts.api';
export { shiftsApi } from './api/shifts.api';

// Services
export * from './services/compliance.service';

// State Management
export * from './state/useEnhancedRosters';

// Hooks
export * from './hooks/useResolvedAvailability';
export * from './hooks/useMyRoster';
export * from './hooks/useRosterView';

// Pages
export { default as RostersPlannerPage } from './pages/RostersPlannerPage';
export { default as MyRosterPage } from './pages/MyRosterPage';

// UI Components
export { default as RosterGroup } from './ui/components/RosterGroup';
export { LazyEnhancedAddShiftModal as EnhancedAddShiftModal } from './ui/dialogs/EnhancedAddShiftModal/Lazy';
