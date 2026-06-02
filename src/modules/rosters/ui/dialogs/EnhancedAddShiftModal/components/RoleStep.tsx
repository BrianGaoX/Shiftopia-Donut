import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/modules/core/ui/primitives/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Lock, Gavel, AlertTriangle } from 'lucide-react';
import { RoleStepProps } from '../types';
import { estimateShiftCost } from '@/modules/rosters/domain/projections/utils/cost';

export const RoleStep: React.FC<RoleStepProps> = ({
    form,
    isReadOnly,
    isLoadingData,
    isTemplateMode,
    roles,
    remunerationLevels,
    employees,
    existingShift,
    netLength,
    selectedRemLevel,
    safeContext,
    isRoleLocked,
    isEmployeeLocked
}) => {
    const watchV8RoleId = form.watch('role_id');
    const watchStartTime = form.watch('start_time');
    const watchEndTime = form.watch('end_time');
    const watchShiftDate = form.watch('shift_date');
    const watchIsOvernight = form.watch('is_overnight');
    const watchAllowances = form.watch('allowances');
    const watchIsAnnualLeave = form.watch('isAnnualLeave');
    const watchIsPersonalLeave = form.watch('isPersonalLeave');
    const watchIsCarerLeave = form.watch('isCarerLeave');

    const estimatedCost = estimateShiftCost(
        netLength,
        watchStartTime,
        watchEndTime,
        selectedRemLevel?.hourly_rate_min || 0,
        netLength, // Using netLength as scheduled_length placeholder
        watchIsOvernight || false,
        false, // is_cancelled
        watchShiftDate,
        watchAllowances,
        watchIsAnnualLeave,
        watchIsPersonalLeave,
        watchIsCarerLeave
    );

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <FormField
                    control={form.control}
                    name="role_id"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-muted-foreground">Role *</FormLabel>
                            {!isReadOnly && !isRoleLocked ? (
                                <Select onValueChange={field.onChange} value={field.value || ''} disabled={isReadOnly || isRoleLocked}>
                                    <FormControl>
                                        <SelectTrigger className={cn(
                                            "bg-muted/50 border-border text-foreground h-11 transition-all",
                                            !field.value && "border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.1)]"
                                        )}>
                                            <SelectValue placeholder={isLoadingData ? 'Loading...' : 'Select role'} />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent className="bg-popover border-border">
                                        {roles.map((role) => (
                                            <SelectItem key={role.id} value={role.id} className="text-foreground">
                                                {role.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="text-sm font-medium text-foreground px-1">
                                    {(() => {
                                        const match = roles.find(r => r.id === field.value);
                                        return isLoadingData ? (
                                            <span className="text-muted-foreground/80 italic">Loading role...</span>
                                        ) : (
                                            match?.name || 'No role selected'
                                        );
                                    })()}
                                </div>
                            )}
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="remuneration_level_id"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-muted-foreground flex items-center gap-2">
                                Pay Level
                                <Lock className="h-3 w-3 text-amber-400" />
                                <span className="text-xs text-muted-foreground/80 font-normal">(from role)</span>
                            </FormLabel>
                            {!isReadOnly ? (
                                <Select onValueChange={field.onChange} value={field.value || ''} disabled>
                                    <FormControl>
                                        <SelectTrigger className="bg-muted/50 border-border text-foreground h-11 opacity-70 cursor-not-allowed">
                                            <SelectValue placeholder={watchV8RoleId ? 'Loading...' : 'Select a role first'} />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent className="bg-popover border-border">
                                        {remunerationLevels.map((level) => (
                                            <SelectItem key={level.id} value={level.id} className="text-foreground">
                                                {level.level_name} - ${level.hourly_rate_min}/hr
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="text-sm font-medium text-foreground/60 px-1">
                                    {remunerationLevels.find(l => l.id === field.value)?.level_name || '—'}
                                </div>
                            )}
                        </FormItem>
                    )}
                />
            </div>

            <Separator className="bg-white/10" />

            {/* Bidding Warning */}
            {existingShift?.is_on_bidding && (
                <div className="p-3 mb-4 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
                    <div className="flex items-start gap-3">
                        <Gavel className="h-5 w-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-indigo-300">Shift is on Bidding</p>
                            <p className="text-xs text-foreground/60 mt-1">
                                This shift is currently accepting bids. Assigning an employee here will close bidding and assign the shift directly.
                                <br />
                                <span className="opacity-70 mt-1 block">
                                    You can also selecting a winner from the Open Bids page.
                                </span>
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {isTemplateMode ? (
                <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-amber-300">Employee Assignment Disabled</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Templates define shift structures only. Assign employees when applying
                                the template to a roster.
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <FormField
                    control={form.control}
                    name="assigned_employee_id"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-muted-foreground">Assigned Employee</FormLabel>
                            {!isReadOnly && !isEmployeeLocked ? (
                                <Select
                                    onValueChange={(v) => field.onChange(v === '__none__' ? null : v)}
                                    value={field.value || '__none__'}
                                    disabled={isReadOnly || isEmployeeLocked}
                                >
                                    <FormControl>
                                        <SelectTrigger className="bg-muted/50 border-border text-foreground h-11">
                                            <SelectValue placeholder="Unassigned" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent className="bg-popover border-border">
                                        <SelectItem value="__none__" className="text-muted-foreground">Unassigned</SelectItem>
                                        {employees.map((emp) => (
                                            <SelectItem key={emp.id} value={emp.id} className="text-foreground">
                                                {emp.first_name} {emp.last_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="text-sm font-medium text-foreground px-1">
                                    {field.value ? (
                                        employees.find(e => e.id === field.value) ? (
                                            `${employees.find(e => e.id === field.value)!.first_name} ${employees.find(e => e.id === field.value)!.last_name}`
                                        ) : 'Employee records not found'
                                    ) : 'Unassigned'}
                                </div>
                            )}
                        </FormItem>
                    )}
                />
            )}

            {selectedRemLevel && netLength > 0 && (
                <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <div className="flex justify-between items-center">
                        <span className="text-blue-300/70">Estimated Cost</span>
                        <span className="text-2xl font-bold text-blue-300">${estimatedCost.toFixed(2)}</span>
                    </div>
                </div>
            )}
        </div>
    );
};
