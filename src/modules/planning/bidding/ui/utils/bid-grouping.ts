import { format, parseISO } from 'date-fns';
import { getDeptAccent, type DeptAccent } from './bid-dept-styles';
import type { ShiftOpportunity } from '../types';

export type BidGroupBy = 'none' | 'date' | 'subDepartment' | 'group' | 'subGroupName' | 'role';

export interface BidGroup {
    key: string;
    label: string;
    items: ShiftOpportunity[];
    accent?: DeptAccent;
}

export function groupOpportunities(opps: ShiftOpportunity[], groupBy: BidGroupBy): BidGroup[] {
    if (groupBy === 'none' || opps.length === 0) {
        return [{ key: '__all__', label: '', items: opps }];
    }

    const buckets = new Map<string, BidGroup>();

    for (const opp of opps) {
        let key: string;
        let label: string;
        let accent: DeptAccent | undefined;

        if (groupBy === 'date') {
            key = opp.date;
            try { label = format(parseISO(opp.date), 'EEE d MMM'); }
            catch { label = opp.date; }
        } else if (groupBy === 'subDepartment') {
            key = `${opp.department}|${opp.subDepartment}`;
            label = opp.subDepartment && opp.subDepartment !== opp.department
                ? `${opp.department} · ${opp.subDepartment}`
                : opp.department;
            accent = getDeptAccent(opp.groupType, opp.department);
        } else if (groupBy === 'group') {
            key = opp.group;
            label = opp.group;
        } else if (groupBy === 'subGroupName') {
            key = opp.subGroupName;
            label = opp.subGroupName;
            accent = getDeptAccent(opp.groupType, opp.department);
        } else {
            key = opp.role;
            label = opp.role;
        }

        if (!buckets.has(key)) {
            buckets.set(key, { key, label, items: [], accent });
        }
        buckets.get(key)!.items.push(opp);
    }

    const groups = Array.from(buckets.values());

    if (groupBy === 'date') {
        groups.sort((a, b) => a.key.localeCompare(b.key));
    } else {
        groups.sort((a, b) => a.label.localeCompare(b.label));
    }

    return groups;
}
