import { supabase } from '@/platform/supabase/client';
import type { DemandRuleRow } from '../domain/ruleEngine.types';

/**
 * Demand Engine L3 — demand_rules queries.
 * Table: public.demand_rules (migration 20260502000012).
 */
export const demandRulesQueries = {
    /**
     * All active rules, sorted by priority asc, then rule_code asc.
     * Lower priority numbers fire first. The executor expects a stable order
     * for deterministic explanation arrays.
     */
    async listActive(): Promise<DemandRuleRow[]> {
        const { data, error } = await supabase
            .from('demand_rules')
            .select('*')
            .eq('is_active', true)
            .order('priority', { ascending: true })
            .order('rule_code', { ascending: true });
        if (error) throw new Error(`demandRules.listActive failed: ${error.message}`);
        return (data ?? []) as DemandRuleRow[];
    },

    /** All versions of a single rule_code, newest first. */
    async listVersions(ruleCode: string): Promise<DemandRuleRow[]> {
        const { data, error } = await supabase
            .from('demand_rules')
            .select('*')
            .eq('rule_code', ruleCode)
            .order('version', { ascending: false });
        if (error) throw new Error(`demandRules.listVersions failed: ${error.message}`);
        return (data ?? []) as DemandRuleRow[];
    },

    /** Highest active version per rule_code (used to stamp rule_version_at_event). */
    async maxActiveVersion(): Promise<number> {
        const { data, error } = await supabase
            .from('demand_rules')
            .select('version')
            .eq('is_active', true)
            .order('version', { ascending: false })
            .limit(1);
        if (error) throw new Error(`demandRules.maxActiveVersion failed: ${error.message}`);
        return data && data.length > 0 ? (data[0] as { version: number }).version : 1;
    },
};
