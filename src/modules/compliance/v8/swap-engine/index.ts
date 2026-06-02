// Guards (pre-flight API-level checks)
export type { GuardViolation, GuardViolationCode, GuardResult, SwapGuardInput } from './guards';
export { runSwapGuards, SwapGuardError } from './guards';

// Chain swap scenario
export type { ChainSwapScenario } from './scenario-builder';

// Types
export type {
    RosterShift,
    SwapParty,
    SwapScenario,
    SolverConfig,
    ConstraintViolation,
    SolverResult,
    SwapPartyInput,
    SwapEvaluationInput,
} from './types';

// Scenario builder
export { ScenarioBuilder } from './scenario-builder';

// Constraint engine + adapter
export { V8SwapEngine, solverResultToComplianceResults } from './constraint-engine';

// Unified scenario entry point (use when scenario is already built)
export { evaluateScenario } from './evaluate-scenario';

// Utilities: scenario window + schedule aggregation
export { getScenarioWindow, SCENARIO_WINDOW_DAYS } from './utils/scenario-window';
export type { ScenarioWindow } from './utils/scenario-window';
export { aggregateSchedule, aggregateSchedules } from './utils/schedule-aggregator';
export type { UnifiedShift, ShiftState } from './utils/schedule-aggregator';

// Services: concurrency revalidation before commit
export { validateBeforeCommit, ConcurrencyValidationError } from './services/concurrency-validator';
export type { ConcurrencyCheckInput, ConcurrencyCheckResult } from './services/concurrency-validator';

// Public evaluator for swaps (2-party)
export { SwapEvaluator, swapEvaluator } from './swap-evaluator';

// Public evaluator for single-party actions: add / assign / bid
export {
    AssignmentEvaluator,
    assignmentEvaluator,
    assignmentResultToComplianceResults,
} from './assignment-evaluator';
export type { AssignmentEvaluationInput } from './assignment-evaluator';
