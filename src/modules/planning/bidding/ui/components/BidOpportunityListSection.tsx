import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { DeptAccent } from '../utils/bid-dept-styles';

interface Props {
    label: string;
    count: number;
    accent?: DeptAccent;
    defaultCollapsed?: boolean;
    children: React.ReactNode;
}

export const BidOpportunityListSection: React.FC<Props> = ({
    label, count, accent, defaultCollapsed = false, children,
}) => {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

    return (
        <div className="border-b border-border/40 last:border-0">
            <button
                type="button"
                onClick={() => setCollapsed(c => !c)}
                className={cn(
                    'sticky top-0 z-10 w-full flex items-center gap-2.5 px-4 py-2 text-left',
                    'bg-background/95 backdrop-blur-md border-b border-border/40',
                    'hover:bg-muted/40 transition-colors',
                )}
            >
                {accent && <span className={cn('h-2 w-2 rounded-full shrink-0', accent.dot)} />}
                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-foreground/70 truncate">
                    {label}
                </span>
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground/60">
                    {count}
                </span>
                <ChevronDown
                    className={cn(
                        'ml-auto h-3.5 w-3.5 text-muted-foreground/50 shrink-0 transition-transform',
                        collapsed && '-rotate-90',
                    )}
                />
            </button>
            {!collapsed && <div>{children}</div>}
        </div>
    );
};
