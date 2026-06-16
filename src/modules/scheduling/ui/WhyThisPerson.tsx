/**
 * WhyThisPerson — U4 per-assignment explainability.
 *
 * Single-mode means the manager no longer tunes weights, so each pick must be
 * self-explanatory. Hovering the badge reveals the solver's factors for "why
 * this employee got this shift": cost rank within the eligible pool, fairness
 * ledger debt, and qualification fit. Data comes from AssignmentRationale (B5).
 */
import { HelpCircle, DollarSign, Scale, BadgeCheck } from 'lucide-react';
import {
    HoverCard, HoverCardContent, HoverCardTrigger,
} from '@/modules/core/ui/primitives/hover-card';
import type { AssignmentRationale } from '../types';

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2">
            <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
            <span>{children}</span>
        </li>
    );
}

export function WhyThisPerson({ rationale }: { rationale?: AssignmentRationale | null }) {
    if (!rationale) return null;
    const { cost_rank, eligible_count, cheapest_eligible, fairness_debt, qual_gap } = rationale;

    return (
        <HoverCard openDelay={120} closeDelay={60}>
            <HoverCardTrigger asChild>
                <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Why this employee was chosen"
                >
                    <HelpCircle className="h-3.5 w-3.5" />
                    Why?
                </button>
            </HoverCardTrigger>
            <HoverCardContent className="w-72 text-xs" align="start">
                <p className="font-semibold text-foreground mb-2">Why this employee</p>
                <ul className="space-y-1.5 text-muted-foreground">
                    <Row icon={<DollarSign className="h-3.5 w-3.5" />}>
                        {cheapest_eligible
                            ? <>Cheapest of <span className="font-medium text-foreground">{eligible_count}</span> eligible staff</>
                            : <>#{cost_rank ?? '?'} cheapest of <span className="font-medium text-foreground">{eligible_count}</span> eligible</>}
                    </Row>
                    <Row icon={<Scale className="h-3.5 w-3.5" />}>
                        {fairness_debt > 0
                            ? <>Owed undesirable shifts (fairness debt <span className="font-medium text-foreground">+{fairness_debt}</span>)</>
                            : fairness_debt < 0
                                ? <>Has done less than their share (debt <span className="font-medium text-foreground">{fairness_debt}</span>)</>
                                : <>On par with the team’s fair share</>}
                    </Row>
                    <Row icon={<BadgeCheck className="h-3.5 w-3.5" />}>
                        {qual_gap === 0
                            ? <>Exact role/level fit</>
                            : qual_gap > 0
                                ? <>Over-qualified by <span className="font-medium text-foreground">{qual_gap}</span> level{qual_gap !== 1 ? 's' : ''}</>
                                : <>Stretch assignment ({qual_gap} level)</>}
                    </Row>
                </ul>
                <p className="mt-2 pt-2 border-t border-border text-[11px] text-muted-foreground">
                    Chosen under the fixed policy: coverage → wellbeing → cost.
                </p>
            </HoverCardContent>
        </HoverCard>
    );
}
