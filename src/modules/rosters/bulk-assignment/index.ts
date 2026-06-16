/**
 * Bulk Assignment Engine — Public API
 *
 * Entry points for the bulk assignment feature in the Rosters Planner.
 */

export type {
    CandidateShift,
    SimulatedRoster,
    ViolationType,
    ShiftViolation,
    ShiftAssignmentStatus,
    ShiftAssignmentResult,
    BulkAssignmentResult,
    BulkAssignmentOptions,
    EmployeeInfo,

} from './types';

export { BulkAssignmentController, bulkAssignmentController } from './bulk-assignment.controller';
export { ScenarioLoader, scenarioLoader } from './engine/scenario-loader';
export { ShiftSorter, shiftSorter } from './engine/shift-sorter';
export { IncrementalValidator, incrementalValidator } from './engine/incremental-validator';
export { ComplianceEvaluator, complianceEvaluator } from './engine/compliance-evaluator';
export { ConflictReporter, conflictReporter } from './engine/conflict-reporter';
export { AssignmentCommitter, assignmentCommitter } from './engine/assignment-committer';
export type { CommitResult, AtomicCommitResult } from './engine/assignment-committer';
export type { LoadedScenario } from './engine/scenario-loader';
