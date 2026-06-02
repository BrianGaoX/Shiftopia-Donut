import React from 'react';
import { format, parseISO, getDay, isAfter, isBefore, isSameDay } from 'date-fns';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/modules/core/ui/primitives/form';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { cn } from '@/modules/core/lib/utils';
import { formatHours, formatTimeDisplay } from '../utils';
import { isPublicHoliday } from '@/modules/core/lib/date.utils';
import type { ScheduleStepProps } from '../types';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    Clock,
    Timer,
    X,
    CheckCircle,
    AlertCircle,
    AlertTriangle,
    Briefcase,
    Tag,
    Lock as LockIcon,
    StickyNote,
    Star,
    Shield,
    CalendarCheck,
    GraduationCap,
    Utensils,
    Coffee,
    Sparkles,
    CheckCircle2,
    Info,
} from 'lucide-react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import {
    HierarchyColumn
} from './HierarchyColumn';
import { MultiSelect } from './MultiSelect';

/* ═══════════════════════════════════════════════════════════════════════
   MINI BADGE — used in Column 5 for high-density requirement display
   ═══════════════════════════════════════════════════════════════════════ */
const MiniBadge = ({ label, color = 'emerald' }: { label: string; color?: string }) => {
    const colorMap: Record<string, string> = {
        emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
        blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
        violet: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
        rose: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    };
    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold border truncate max-w-[100px] cursor-default',
                        colorMap[color] || colorMap.emerald
                    )}>
                        {label}
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-popover border-border text-popover-foreground text-xs">
                    {label}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

/* ═══════════════════════════════════════════════════════════════════════
   SCHEDULE STEP — 6-column dense layout
   Col 1: Hierarchy   Col 2: Context   Col 3: Timings
   Col 4: Breaks      Col 5: Criteria  Col 6: Notes
   ═══════════════════════════════════════════════════════════════════════ */

export const ScheduleStep: React.FC<ScheduleStepProps> = ({
    form,
    isReadOnly,
    shiftLength,
    netLength,
    hardValidation,
    rosters,
    rosterStructure,
    selectedRosterId,
    onRosterChange,
    isGroupLocked,
    isSubGroupLocked,
    isRosterLocked,
    isTemplateMode: isTemplateModeProp,
    context,
    activeSubGroups = {},
    // Column 5 props
    roles,
    remunerationLevels,
    skills,
    licenses,
    events,
    selectedRemLevel,
    isRoleLocked,
}) => {
        const watchPaidBreak = form.watch('paid_break_minutes');
    const watchUnpaidBreak = form.watch('unpaid_break_minutes');
    const watchIsTraining = form.watch('is_training');
    const watchShiftDate = form.watch('shift_date');
    const watchGroupType = form.watch('group_type');
    const watchSubGroup = form.watch('sub_group_name');
    const watchV8RoleId = form.watch('role_id');
    const watchSkills = form.watch('required_skills') || [];
    const watchLicenses = form.watch('required_licenses') || [];
    const watchEvents = form.watch('event_ids') || [];

    // Reset custom mode when group changes, unless locked
    React.useEffect(() => {
        if (!isGroupLocked) {
            // noop — guard for future custom group logic
        }
    }, [watchGroupType, isGroupLocked]);

    // Derived Logic
    const availableGroups = React.useMemo(() => {
        if (!rosterStructure?.length) return [];
        return Array.from(new Set(rosterStructure.map(x => x.groupType))).filter(Boolean);
    }, [rosterStructure]);

    const availableSubGroups = React.useMemo(() => {
        const structureSubGroups = !rosterStructure?.length || !watchGroupType
            ? []
            : Array.from(new Set(
                rosterStructure
                    .filter(x => x.groupType === watchGroupType)
                    .map(x => x.subGroupName)
            )).filter(Boolean);

        const activeForGroup = (activeSubGroups && watchGroupType)
            ? activeSubGroups[watchGroupType] || []
            : [];

        return Array.from(new Set([...structureSubGroups, ...activeForGroup]));
    }, [rosterStructure, watchGroupType, activeSubGroups]);

    const showDefaultGroups = !availableGroups.length;

    const isTemplateMode = isTemplateModeProp || context?.mode === 'template';
    const selectedRoster = rosters.find(r => r.id === selectedRosterId);
    const isRosterActive = isTemplateMode || (selectedRoster?.status === 'published' || selectedRoster?.status === 'draft');

    // Sync Roster with Global Scope
    React.useEffect(() => {
        if (isTemplateMode) return;
        if (!rosters.length || !context?.date) return;

        const match = rosters.find(r => r.start_date === context.date);
        if (match) {
            onRosterChange(match.id);
        }
    }, [isTemplateMode, rosters, onRosterChange, context?.date]);

    // Min/max shift length validation (inline Step 1 feedback)
    const { minShiftHours, minShiftReason } = React.useMemo(() => {
        if (watchIsTraining) return { minShiftHours: 2, minShiftReason: 'Training shifts' };
        if (watchShiftDate && isPublicHoliday(watchShiftDate)) return { minShiftHours: 4, minShiftReason: 'Public holidays' };
        if (watchShiftDate && getDay(watchShiftDate) === 0) return { minShiftHours: 4, minShiftReason: 'Sundays' };
        return { minShiftHours: 3, minShiftReason: 'Weekdays' };
    }, [watchIsTraining, watchShiftDate]);
    const isShiftTooShort = !isTemplateMode && netLength > 0 && netLength < minShiftHours;
    const isShiftTooLong  = !isTemplateMode && netLength > 12;

    // Resolve names for badge display
    const selectedRole = roles.find(r => r.id === watchV8RoleId);
    const selectedSkillNames = skills.filter(s => watchSkills.includes(s.id)).map(s => s.name);
    const selectedLicenseNames = licenses.filter(l => watchLicenses.includes(l.id)).map(l => l.name);
    const selectedEventNames = events.filter(e => watchEvents.includes(e.id)).map(e => e.name);

    // Break recommendation logic
    const breakRecs = React.useMemo(() => {
        if (shiftLength > 10) {
            return {
                unpaid: 60,
                paid: 30,
                label: 'Long Shift (> 10h)',
                description: 'We recommend 2 unpaid meal breaks (total ~60 min) and optional paid rest breaks (20–30 min).',
                icon: <Utensils className="h-4 w-4 text-amber-500" />
            };
        } else if (shiftLength > 5) {
            return {
                unpaid: 30,
                paid: 15,
                label: 'Standard Shift (> 5h)',
                description: 'We recommend 1 unpaid meal break (~30 min) and an optional short paid rest break (10–15 min).',
                icon: <Coffee className="h-4 w-4 text-blue-500" />
            };
        } else {
            return {
                unpaid: 0,
                paid: 0,
                label: 'Short Shift (≤ 5h)',
                description: 'No mandatory breaks recommended for this shift length.',
                icon: <Sparkles className="h-4 w-4 text-emerald-500" />
            };
        }
    }, [shiftLength]);

    // Intelligence feedback strings
    const intelligenceStrings = React.useMemo(() => {
        const isSunday = watchShiftDate && getDay(watchShiftDate) === 0;
        const isPH = watchShiftDate && isPublicHoliday(watchShiftDate);
        
        if (watchIsTraining) {
            return {
                title: 'Training Exemption',
                description: 'This is a training shift. Minimum duration is reduced to 2h.',
                icon: <GraduationCap className="h-4 w-4 text-violet-500" />,
                color: 'text-violet-500',
                bgColor: 'bg-violet-500/10'
            };
        }

        if (isPH) {
            return {
                title: 'Public Holiday Context',
                description: 'Shift falls on a Public Holiday. 4h minimum net duration applies.',
                icon: <AlertCircle className="h-4 w-4 text-orange-500" />,
                color: 'text-orange-500',
                bgColor: 'bg-orange-500/10'
            };
        }

        if (isSunday) {
            return {
                title: 'Sunday Context',
                description: 'Shift falls on a Sunday. 4h minimum net duration applies.',
                icon: <AlertCircle className="h-4 w-4 text-orange-500" />,
                color: 'text-orange-500',
                bgColor: 'bg-orange-500/10'
            };
        }

        return {
            title: 'Standard Weekday',
            description: 'Standard 3h minimum net duration applies for this roster day.',
            icon: <Info className="h-4 w-4 text-blue-500" />,
            color: 'text-blue-500',
            bgColor: 'bg-blue-500/10'
        };
    }, [watchShiftDate, watchIsTraining]);

    const isRoleMissing = !watchV8RoleId;

    const applyBreakSuggestions = () => {
        form.setValue('unpaid_break_minutes', breakRecs.unpaid, { shouldDirty: true });
        form.setValue('paid_break_minutes', breakRecs.paid, { shouldDirty: true });
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 h-[550px]">
                {/* ═══════════════════════════════════════════════════════════════════════
                   PANE 1: SCOPE & CONTEXT (6 Rows)
                   ═══════════════════════════════════════════════════════════════════════ */}
                <div className="bg-card border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                            <Shield className="h-4 w-4" />
                        </div>
                        <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Scope & Context</h3>
                    </div>
                    <div className="p-4 space-y-3 flex-1">
                        {/* Row 1: Org */}
                        <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Organization</Label>
                            <Input value={context?.organizationName || 'DeepMind Global'} disabled className="h-9 bg-muted/20 border-border/50 font-bold text-sm" />
                        </div>
                        {/* Row 2: Dept */}
                        <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Department</Label>
                            <Input value={context?.departmentName || 'Core Operations'} disabled className="h-9 bg-muted/20 border-border/50 font-bold text-sm" />
                        </div>
                        {/* Row 3: Sub-Dept */}
                        <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Sub-Department</Label>
                            <Input value={context?.subDepartmentName || 'General Staffing'} disabled className="h-9 bg-muted/20 border-border/50 font-bold text-sm" />
                        </div>
                        {/* Row 4: Roster Selection */}
                        <FormField
                            control={form.control}
                            name="roster_id"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider">Roster / Date Context</FormLabel>
                                    <Select
                                        disabled={isReadOnly || isRosterLocked}
                                        onValueChange={onRosterChange}
                                        value={selectedRosterId || undefined}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="h-9 border-border/50 bg-background font-bold text-sm">
                                                <SelectValue placeholder="Select roster" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {rosters.map(r => (
                                                <SelectItem key={r.id} value={r.id} className="text-sm font-medium">
                                                    {r.name} ({format(parseISO(r.start_date), 'MMM d')})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                        />
                        {/* Row 5: Group */}
                        <FormField
                            control={form.control}
                            name="group_type"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider">Venue Group</FormLabel>
                                    <Select
                                        disabled={isReadOnly || isGroupLocked}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="h-9 border-border/50 bg-background font-bold text-sm">
                                                <SelectValue placeholder="Select group" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {showDefaultGroups ? (
                                                <>
                                                    <SelectItem value="Front of House">Front of House</SelectItem>
                                                    <SelectItem value="Back of House">Back of House</SelectItem>
                                                    <SelectItem value="Management">Management</SelectItem>
                                                </>
                                            ) : (
                                                availableGroups.map(g => (
                                                    <SelectItem key={g} value={g} className="text-sm font-medium">{g}</SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                        />
                        {/* Row 6: Sub-Group */}
                        <FormField
                            control={form.control}
                            name="sub_group_name"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider">Sub-Group / Area</FormLabel>
                                    <Select
                                        disabled={isReadOnly || isSubGroupLocked || !availableSubGroups.length}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="h-9 border-border/50 bg-background font-bold text-sm">
                                                <SelectValue placeholder="Select sub-group" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {availableSubGroups.map(sg => (
                                                <SelectItem key={sg} value={sg} className="text-sm font-medium">{sg}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════════════════════
                   PANE 2: TIMING & METRICS (6 Rows)
                   ═══════════════════════════════════════════════════════════════════════ */}
                <div className="bg-card border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                            <Clock className="h-4 w-4" />
                        </div>
                        <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Timing & Metrics</h3>
                    </div>
                    <div className="p-4 space-y-3 flex-1">
                        {/* Row 1: Start Time */}
                        <FormField
                            control={form.control}
                            name="start_time"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider">Start Time</FormLabel>
                                    <Input {...field} type="time" disabled={isReadOnly} className="h-9 border-border/50 font-bold text-sm" />
                                </FormItem>
                            )}
                        />
                        {/* Row 2: End Time */}
                        <FormField
                            control={form.control}
                            name="end_time"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider">End Time</FormLabel>
                                    <Input {...field} type="time" disabled={isReadOnly} className="h-9 border-border/50 font-bold text-sm" />
                                </FormItem>
                            )}
                        />
                        {/* Row 3: Total Gross */}
                        <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Total Duration (Gross)</Label>
                            <div className="h-9 flex items-center px-3 bg-muted/20 border border-border/50 rounded-md font-bold text-sm text-foreground">
                                {formatHours(shiftLength)}
                            </div>
                        </div>
                        {/* Row 4: Paid Break */}
                        <FormField
                            control={form.control}
                            name="paid_break_minutes"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider flex justify-between">
                                        Paid Break <span>(min)</span>
                                    </FormLabel>
                                    <Input
                                        type="number"
                                        disabled={isReadOnly}
                                        value={field.value}
                                        onChange={e => field.onChange(parseInt(e.target.value) || 0)}
                                        className="h-9 border-border/50 font-bold text-sm"
                                    />
                                </FormItem>
                            )}
                        />
                        {/* Row 5: Unpaid Break */}
                        <FormField
                            control={form.control}
                            name="unpaid_break_minutes"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider flex justify-between">
                                        Unpaid Break <span>(min)</span>
                                    </FormLabel>
                                    <Input
                                        type="number"
                                        disabled={isReadOnly}
                                        value={field.value}
                                        onChange={e => field.onChange(parseInt(e.target.value) || 0)}
                                        className="h-9 border-border/50 font-bold text-sm"
                                    />
                                </FormItem>
                            )}
                        />
                        {/* Row 6: Net Length */}
                        <div className="space-y-1 pt-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider text-emerald-500/80">Net Paid Length</Label>
                            <div className={cn(
                                "h-10 flex items-center justify-center rounded-xl font-black text-lg shadow-sm",
                                isShiftTooShort
                                    ? "bg-red-500/10 border border-red-500/30 text-red-500 shadow-red-500/5"
                                    : isShiftTooLong
                                        ? "bg-amber-500/10 border border-amber-500/30 text-amber-500 shadow-amber-500/5"
                                        : "bg-emerald-500/5 border border-emerald-500/20 text-emerald-500 shadow-emerald-500/5",
                            )}>
                                {formatHours(netLength)}
                            </div>
                            {isShiftTooShort && (
                                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                                    <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                    <p className="text-[11px] font-bold text-red-500">
                                        Min {minShiftHours}h — {minShiftReason} require at least {minShiftHours} hours (net paid).
                                    </p>
                                </div>
                            )}
                            {isShiftTooLong && (
                                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                    <p className="text-[11px] font-bold text-amber-500">
                                        Max 12h — Net paid length exceeds 12 hours.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════════════════════
                   PANE 3: CRITERIA & NOTES (6 Rows)
                   ═══════════════════════════════════════════════════════════════════════ */}
                <div className="bg-card border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                            <Briefcase className="h-4 w-4" />
                        </div>
                        <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Criteria & Notes</h3>
                    </div>
                    <div className="p-4 space-y-3 flex-1 overflow-y-auto custom-scrollbar">
                        {/* Row 1: Role */}
                        <FormField
                            control={form.control}
                            name="role_id"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider">Required Role</FormLabel>
                                    <Select
                                        disabled={isReadOnly || isRoleLocked}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="h-9 border-border/50 bg-background font-bold text-sm">
                                                <SelectValue placeholder="Select role" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {roles.map(r => (
                                                <SelectItem key={r.id} value={r.id} className="text-sm font-medium">{r.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                        />
                        {/* Row 2: Skills */}
                        <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider">Required Skills</Label>
                            <MultiSelect
                                options={skills}
                                selected={watchSkills}
                                onChange={(val) => form.setValue('required_skills', val)}
                                placeholder="Select skills..."
                                className="min-h-[36px]"
                            />
                        </div>
                        {/* Row 3: Licenses */}
                        <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider">Certifications</Label>
                            <MultiSelect
                                options={licenses}
                                selected={watchLicenses}
                                onChange={(val) => form.setValue('required_licenses', val)}
                                placeholder="Select licenses..."
                                className="min-h-[36px]"
                            />
                        </div>
                        {/* Row 4: Events */}
                        <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider">Event Context</Label>
                            <MultiSelect
                                options={events}
                                selected={watchEvents}
                                onChange={(val) => form.setValue('event_ids', val)}
                                placeholder="Link to event..."
                                className="min-h-[36px]"
                            />
                        </div>
                        {/* Row 5: Location Context (Static Placeholder as requested) */}
                        <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Location Context</Label>
                            <Input value="Main Venue Context" disabled className="h-9 bg-muted/20 border-border/50 font-bold text-sm italic" />
                        </div>
                        {/* Row 6: Notes */}
                        <FormField
                            control={form.control}
                            name="notes"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider">Operational Notes</FormLabel>
                                    <Textarea
                                        {...field}
                                        disabled={isReadOnly}
                                        placeholder="Add shift notes..."
                                        className="h-20 bg-background border-border/50 text-[11px] font-medium resize-none"
                                    />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════════════════════
                   PANE 4: INTELLIGENCE / RECOMMENDATIONS
                   ═══════════════════════════════════════════════════════════════════════ */}
                <div className="bg-card border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden bg-gradient-to-br from-card to-muted/20">
                    <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-500">
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Intelligence</h3>
                    </div>
                    <div className="flex-1 flex flex-col divide-y divide-border/50">
                        {/* Segment 1: Warnings/Context */}
                        <div className="p-4 space-y-3">
                            <div className="flex items-start gap-3">
                                <div className={cn("p-1.5 rounded-lg", intelligenceStrings.bgColor)}>
                                    {intelligenceStrings.icon}
                                </div>
                                <div className="space-y-1">
                                    <p className={cn("text-[10px] font-bold uppercase tracking-wider leading-none", intelligenceStrings.color)}>
                                        {intelligenceStrings.title}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground font-medium leading-relaxed italic">
                                        {intelligenceStrings.description}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Segment 2: Training Toggle */}
                        <div className="p-4">
                            <div className="flex items-center justify-between p-3 rounded-xl bg-background border border-border/50 shadow-sm">
                                <div className="flex items-center gap-2">
                                    <GraduationCap className="h-4 w-4 text-violet-500" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider">Training Shift</span>
                                </div>
                                <FormField
                                    control={form.control}
                                    name="is_training"
                                    render={({ field }) => (
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                disabled={isReadOnly}
                                            />
                                        </FormControl>
                                    )}
                                />
                            </div>
                        </div>

                        {/* Segment 2: Missing Data */}
                        {isRoleMissing && (
                            <div className="mx-4 p-3 rounded-xl bg-orange-500/5 border border-orange-500/20 flex items-center gap-3">
                                <div className="p-1.5 rounded-lg bg-orange-500/10">
                                    <Shield className="h-4 w-4 text-orange-500" />
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-orange-500 uppercase tracking-wider leading-none">Role Required</p>
                                    <p className="text-[10px] text-muted-foreground font-medium mt-1 italic">
                                        Please select a role to finalize assignment and check full compliance.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Segment 3: Advice */}
                        <div className="p-4 space-y-4">
                            <div className="flex items-center gap-3">
                                {breakRecs.icon}
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider leading-none mb-1">{breakRecs.label}</p>
                                    <p className="text-[10px] text-muted-foreground italic truncate leading-tight">{breakRecs.description}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={applyBreakSuggestions}
                                disabled={isReadOnly || breakRecs.unpaid === 0}
                                className={cn(
                                    "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg",
                                    "bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20 active:scale-95",
                                    (isReadOnly || breakRecs.unpaid === 0) && "opacity-30 grayscale cursor-not-allowed shadow-none"
                                )}
                            >
                                <Sparkles className="h-3 w-3" />
                                Apply Recommendations
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── ERROR ALERTS ────────────────────── */}
            {!hardValidation.passed && (
                <div className="fade-in slide-in-from-top-2 duration-500">
                    <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 backdrop-blur-sm flex items-start gap-3 shadow-lg shadow-red-500/5">
                        <div className="p-1.5 rounded-lg bg-red-500/10">
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                        </div>
                        <div className="space-y-1 flex-1 pt-0.5">
                            <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest">Compliance Warnings</h4>
                            <div className="space-y-1">
                                {hardValidation.errors.map((error, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5">
                                        <div className="h-1 w-1 rounded-full bg-red-500/40" />
                                        <p className="text-[10px] font-semibold text-red-400 leading-relaxed italic">
                                            {error.message}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

