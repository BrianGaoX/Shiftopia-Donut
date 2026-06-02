/**
 * V8 Compliance Engine — Unified Entry Point
 * 
 * The single source of truth for all roster compliance, 
 * auditing, and swap feasibility logic in Shiftopia.
 */

export { v8Engine } from './engine';
export * from './types';
import { V8_RULE_METADATA } from './metadata';
export { V8_RULE_METADATA };

// Transmission Adapters (Bridges)
import { runV8Compliance } from './adapters/v1-to-v8';
export { runV8Compliance as runV8LegacyBridge };
export { runV8ComplexBridge } from './adapters/v2-to-v8';

// Orchestration & Solving
export { runV8Orchestrator } from './orchestrator/index';
export type {
    V8OrchestratorInput,
    V8OrchestratorShift,
    V8OrchestratorResult,
    V8EmployeeContext,
    V8AvailabilityData,
} from './orchestrator/types';
export { V8SwapEngine }      from './swap-engine/constraint-engine';
export { applyV8Simulation } from './orchestrator/simulation';

// Eligibility & Validation
export { isV8Eligible, checkV8AvailabilityOnly } from './orchestrator/eligibility';
export { validateV8State }                       from './orchestrator/validate-combined-state';
export { getScenarioWindow }                     from './swap-engine/utils/scenario-window';
export {
    assignmentEvaluator,
    assignmentResultToComplianceResults
} from './swap-engine/assignment-evaluator';
export {
    swapEvaluator,
    runSwapGuards,
    SwapGuardError,
    solverResultToComplianceResults
} from './swap-engine/index';
export type {
    RosterShift,
    ConstraintViolation
} from './swap-engine/types';

/**
 * UI Compatibility Helper: Get all registered V8 rules
 */
export function getRegisteredRules() {
    return Object.values(V8_RULE_METADATA);
}

/**
 * UI Compatibility Helper: Run a specific V8 rule via the legacy bridge
 */
export async function runRule(ruleId: string, input: any) {
    const fullResult = await runV8Compliance(input);
    return fullResult.results.find((r: any) => r.rule_id === ruleId) || null;
}
