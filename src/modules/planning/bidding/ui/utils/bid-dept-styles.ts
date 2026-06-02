// Department badge / card classes — uses CSS defined in index.css (light + dark adaptive)

export function getDeptColor(groupType: string | null | undefined, dept: string): string {
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return 'dept-badge-convention';
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return 'dept-badge-exhibition';
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return 'dept-badge-theatre';
    return 'dept-badge-default';
}

export function getCardBg(groupType: string | null | undefined, dept: string): string {
    const base = 'dept-card-base';
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return `${base} dept-card-convention`;
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return `${base} dept-card-exhibition`;
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return `${base} dept-card-theatre`;
    return `${base} dept-card-default`;
}

export function getRowClass(groupType: string | null | undefined, dept: string): string {
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return 'dept-row-convention';
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return 'dept-row-exhibition';
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return 'dept-row-theatre';
    return 'dept-row-default';
}

// Inline Tailwind classes for mobile list rows (div-based, not table-row).
// Pairs a soft bg tint with a 4px left stripe — same palette as `getRowClass`.
export type DeptAccent = {
    bg: string;
    stripe: string;
    dot: string;
};

export function getDeptAccent(groupType: string | null | undefined, dept: string): DeptAccent {
    const d = (dept || '').toLowerCase();
    if (groupType === 'convention_centre' || d.includes('convention')) {
        return {
            bg: 'bg-blue-500/[0.06] dark:bg-blue-500/[0.10]',
            stripe: 'border-l-blue-500/70 dark:border-l-blue-400/70',
            dot: 'bg-blue-500',
        };
    }
    if (groupType === 'exhibition_centre' || d.includes('exhibition')) {
        return {
            bg: 'bg-emerald-500/[0.06] dark:bg-emerald-500/[0.10]',
            stripe: 'border-l-emerald-500/70 dark:border-l-emerald-400/70',
            dot: 'bg-emerald-500',
        };
    }
    if (groupType === 'theatre' || d.includes('theatre')) {
        return {
            bg: 'bg-rose-500/[0.06] dark:bg-rose-500/[0.10]',
            stripe: 'border-l-rose-500/70 dark:border-l-rose-400/70',
            dot: 'bg-rose-500',
        };
    }
    return {
        bg: 'bg-slate-500/[0.04] dark:bg-slate-500/[0.08]',
        stripe: 'border-l-slate-400/60 dark:border-l-slate-500/60',
        dot: 'bg-slate-400',
    };
}
