import React from 'react';
import { Filter, X, Check } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { cn } from '@/modules/core/lib/utils';

export const RosterFilterPopover: React.FC = () => {
    const {
        advancedFilters,
        setAdvancedFilters,
        resetAdvancedFilters,
        hasActiveFilters,
    } = useRosterUI();

    const handleFilterChange = (key: keyof typeof advancedFilters, value: string) => {
        setAdvancedFilters({ [key]: value === 'all' ? (key === 'stateId' ? null : 'all') : value });
    };

    const activeCount = [
        advancedFilters.stateId,
        advancedFilters.lifecycleStatus !== 'all',
        advancedFilters.assignmentStatus !== 'all',
        advancedFilters.assignmentOutcome !== 'all',
        advancedFilters.biddingStatus !== 'all',
        advancedFilters.tradingStatus !== 'all',
    ].filter(Boolean).length;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant={hasActiveFilters ? "secondary" : "outline"}
                    size="icon"
                    className={cn(
                        "h-8 w-8 transition-all",
                        hasActiveFilters && "bg-primary/20 text-primary hover:bg-primary/30 border-primary/50"
                    )}
                >
                    <Filter className="h-4 w-4" />
                    {activeCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground shadow-sm">
                            {activeCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-4 bg-background/95 backdrop-blur-md border-border/50" align="end">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="font-medium leading-none">Filters</h4>
                        {hasActiveFilters && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={resetAdvancedFilters}
                                className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                            >
                                Reset
                            </Button>
                        )}
                    </div>

                    <div className="grid gap-4">
                        {/* State ID (S1-S15) */}
                        <div className="grid gap-2">
                            <Label htmlFor="stateId">State ID</Label>
                            <Select
                                value={advancedFilters.stateId || 'all'}
                                onValueChange={(v) => startTransition(() => handleFilterChange('stateId', (v === 'all' ? null : v) as any))}
                            >
                                <SelectTrigger id="stateId">
                                    <SelectValue placeholder="All States" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All States</SelectItem>
                                    {Array.from({ length: 15 }, (_, i) => `S${i + 1}`).map((id) => (
                                        <SelectItem key={id} value={id}>
                                            {id}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Lifecycle Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="lifecycle">Lifecycle</Label>
                            <Select
                                value={advancedFilters.lifecycleStatus}
                                onValueChange={(v) => handleFilterChange('lifecycleStatus', v)}
                            >
                                <SelectTrigger id="lifecycle">
                                    <SelectValue placeholder="All Lifecycles" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="draft">Draft</SelectItem>
                                    <SelectItem value="published">Published</SelectItem>
                                    <SelectItem value="cancelled">Cancelled</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Assignment Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="assignment">Assignment</Label>
                            <Select
                                value={advancedFilters.assignmentStatus}
                                onValueChange={(v) => handleFilterChange('assignmentStatus', v)}
                            >
                                <SelectTrigger id="assignment">
                                    <SelectValue placeholder="All Assignments" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="unassigned">Unassigned</SelectItem>
                                    <SelectItem value="assigned">Assigned</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Assignment Outcome */}
                        <div className="grid gap-2">
                            <Label htmlFor="outcome">Outcome</Label>
                            <Select
                                value={advancedFilters.assignmentOutcome}
                                onValueChange={(v) => handleFilterChange('assignmentOutcome', v)}
                            >
                                <SelectTrigger id="outcome">
                                    <SelectValue placeholder="All Outcomes" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="offered">Offered</SelectItem>
                                    <SelectItem value="confirmed">Confirmed</SelectItem>
                                    <SelectItem value="emergency_assigned">Emergency</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Bidding Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="bidding">Bidding</Label>
                            <Select
                                value={advancedFilters.biddingStatus}
                                onValueChange={(v) => handleFilterChange('biddingStatus', v)}
                            >
                                <SelectTrigger id="bidding">
                                    <SelectValue placeholder="All Bidding" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="not_on_bidding">Not on Bidding</SelectItem>
                                    <SelectItem value="on_bidding">On Bidding</SelectItem>
                                    <SelectItem value="bidding_closed_no_winner">Closed (No Winner)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Trading Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="trading">Trading</Label>
                            <Select
                                value={advancedFilters.tradingStatus}
                                onValueChange={(v) => handleFilterChange('tradingStatus', v)}
                            >
                                <SelectTrigger id="trading">
                                    <SelectValue placeholder="All Trading" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="none">No Trade</SelectItem>
                                    <SelectItem value="requested">Trade Requested</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};

// Start transition helper
function startTransition(callback: () => void) {
    callback();
}
