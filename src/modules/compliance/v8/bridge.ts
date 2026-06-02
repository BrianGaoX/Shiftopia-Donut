/**
 * V8 Compliance Engine — Legacy Bridge
 * 
 * Provides backward compatibility for components still using 
 * the single-shift validation pattern.
 */

import { ComplianceCheckInput, ComplianceResult } from './types';
import { runV8LegacyBridge } from './index';

/**
 * @deprecated Use runV8LegacyBridge directly from @/modules/compliance/v8
 */
export async function runV8ComplianceCheck(input: ComplianceCheckInput): Promise<ComplianceResult[]> {
    const result = await runV8LegacyBridge(input);
    return (result as any).results ?? [];
}

/**
 * @deprecated Use runV8LegacyBridge directly from @/modules/compliance/v8
 */
export async function checkV8Compliance(input: ComplianceCheckInput): Promise<ComplianceResult[]> {
    const result = await runV8LegacyBridge(input);
    return (result as any).results ?? [];
}

export async function isV8ActionAllowed(input: ComplianceCheckInput): Promise<boolean> {
    const result = await runV8LegacyBridge(input);
    const results = (result as any).results ?? [];
    return !results.some((r: any) => r.blocking);
}

export function getV8ComplianceSummary(results: ComplianceResult[]) {
    const failing = results.filter(r => r.status === 'fail');
    const warning = results.filter(r => r.status === 'warning');
    
    if (failing.length > 0) return 'BLOCKING';
    if (warning.length > 0) return 'WARNING';
    return 'PASS';
}
