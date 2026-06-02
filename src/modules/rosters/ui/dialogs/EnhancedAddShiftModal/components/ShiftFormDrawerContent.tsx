/**
 * ShiftFormDrawerContent — Redesigned with full light / dark mode support
 *
 * Section order:
 *   01 Scope  (Org › Dept › SubDept › Group › SubGroup — all locked)
 *   02 Shift Identity  (Role*, Training, Skills, Certifications)
 *   03 Shift Timings   (Date locked, Start* / End* 24h, Length / Net, Breaks, Rec)
 *   04 Assignment
 *   05 Compliance
 *   06 Notes
 *
 * Light-mode design: white card surface, slate text, slate borders.
 * Dark-mode design:  near-black base (#09090e), zinc text, white/alpha borders.
 *
 * Mandatory fields marked with red *.
 * Read-only banners: Published (amber) / Started or Past (rose).
 * Validation messages on every form field + hard-validation rows.
 */

import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/modules/core/ui/primitives/form';
import { Input } from '@/modules/core/ui/primitives/input';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { cn } from '@/modules/core/lib/utils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Clock,
    AlertCircle,
    AlertTriangle,
    Briefcase,
    Lock as LockIcon,
    StickyNote,
    Shield,
    CalendarCheck,
    GraduationCap,
    Utensils,
    Coffee,
    CheckCircle2,
    Info,
    Search,
    UserCircle,
    Building2,
    ChevronRight,
    Calendar,
    Timer,
    Loader2,
} from 'lucide-react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Button } from '@/modules/core/ui/primitives/button';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';
import { MultiSelect } from './MultiSelect';
import type { ShiftFormDrawerContentProps } from '../types';
import { formatHours, calculateShiftLength } from '../utils';

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════ */

const GROUP_LABEL: Record<string, string> = {
    convention_centre: 'Convention Centre',
    exhibition_centre: 'Exhibition Centre',
    theatre: 'Theatre',
};

/* ═══════════════════════════════════════════════════════════════════════
   PRIMITIVE HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

/** Indigo required asterisk */
const Req = () => <span className="text-indigo-500 ml-0.5 select-none">*</span>;

/**
 * Numbered section header with leading / trailing rule lines.
 * Adapts to light and dark automatically via semantic color classes.
 */
const Section = ({
    num,
    title,
    icon: Icon,
    badge,
}: {
    num: string;
    title: string;
    icon: React.ElementType;
    badge?: React.ReactNode;
}) => (
    <div className="flex items-center gap-2.5 mb-4">
        <span className="text-[9px] font-black font-mono text-indigo-500/50 w-4 shrink-0 tabular-nums">
            {num}
        </span>
        <div className="h-px w-3 bg-indigo-500/20 shrink-0" />
        <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">
            {title}
        </span>
        {badge && <span className="ml-1">{badge}</span>}
        <div className="h-px flex-1 bg-border/50" />
    </div>
);

/** Tiny label above each form field */
const FieldLabel = ({
    children,
    required,
    hint,
}: {
    children: React.ReactNode;
    required?: boolean;
    hint?: string;
}) => (
    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/80 mb-1.5 flex items-center gap-1.5">
        {children}
        {required && <Req />}
        {hint && (
            <span className="text-muted-foreground/40 font-mono normal-case tracking-normal text-[8px]">
                {hint}
            </span>
        )}
    </p>
);

/** Horizontal breadcrumb showing locked scope context */
const ScopeBreadcrumb = ({ items }: { items: { label: string; key: string }[] }) => {
    if (!items.length) return null;
    return (
        <div className="flex items-center flex-wrap gap-1.5 px-3 py-2.5 rounded-xl border border-border/60 bg-muted/30">
            {items.map((item, i) => (
                <React.Fragment key={item.key}>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/60 border border-border/60">
                        <LockIcon className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                        <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
                            {item.label}
                        </span>
                    </div>
                    {i < items.length - 1 && (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};

/** Duration stat tile */
const DurationCard = ({
    label,
    value,
    colorClass,
    icon: Icon,
}: {
    label: string;
    value: string;
    colorClass: string;
    icon: React.ElementType;
}) => (
    <div className="flex-1 p-3 rounded-lg bg-muted/40 border border-border/50 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
            <Icon className="h-3 w-3 text-muted-foreground/50" />
            <p className="text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
                {label}
            </p>
        </div>
        <p className={cn('text-xl font-black font-mono leading-none', colorClass)}>{value}</p>
    </div>
);

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export const ShiftFormDrawerContent: React.FC<ShiftFormDrawerContentProps> = ({
    form,
    isReadOnly,
    isPast,
    isStarted,
    isPublished,
    isTemplateMode,
    editMode,
    existingShift,
    roles,
    employees,
    skills,
    licenses,
    events,
    rosters,
    rosterStructure,
    activeSubGroups,
    isLoadingData,
    isLoadingShifts,
    resolvedContext,
    selectedRosterId,
    setSelectedRosterId,
    shiftLength,
    netLength,
    hardValidation,
    isAssignmentEnabled,
    minShiftHours,
    compliancePanel,
    runV2Compliance,
    onUnpublish,
    canUnpublish,
    isGroupLocked,
    isSubGroupLocked,
    isRoleLocked,
    isEmployeeLocked,
    isScheduleDefined,
}) => {
    const [searchTerm, setSearchTerm] = useState('');

    /* ── Watched fields ── */
    const watchShiftDate    = form.watch('shift_date');
    const watchGroup        = form.watch('group_type');
    const watchSubGroupName = form.watch('sub_group_name');
    const watchUnpaidBreak  = form.watch('unpaid_break_minutes');
    const watchPaidBreak    = form.watch('paid_break_minutes');
    // Watch times directly so break recommendations update immediately on each keystroke
    const watchStart        = form.watch('start_time');
    const watchEnd          = form.watch('end_time');

    /* ── Break recommendation logic (named vars → fully reactive) ── */
    const localShiftLength = useMemo(
        () => calculateShiftLength(watchStart, watchEnd),
        [watchStart, watchEnd],
    );
    const reqUnpaid    = localShiftLength > 10 ? 60 : localShiftLength > 5 ? 30 : 0;
    const recPaid      = Math.floor(localShiftLength / 4) * 15;
    const curUnpaid    = watchUnpaidBreak ?? 0;
    const curPaid      = watchPaidBreak ?? 0;
    const showUnpaidRec        = !isReadOnly && reqUnpaid > 0 && curUnpaid < reqUnpaid;
    const showPaidRec          = !isReadOnly && recPaid > 0 && curPaid < recPaid;
    const showBreakEnforcement = localShiftLength > 5 && curUnpaid < reqUnpaid;

    /* ── Filtered employees ── */
    const filteredEmployees = useMemo(() => {
        const base = employees.slice(0, 50);
        if (!searchTerm) return base;
        const term = searchTerm.toLowerCase();
        return employees
            .filter(e => {
                const name = (
                    e.profiles?.full_name ||
                    e.full_name ||
                    `${e.first_name} ${e.last_name}`
                ).toLowerCase();
                return name.includes(term);
            })
            .slice(0, 50);
    }, [employees, searchTerm]);

    /* ── Available Groups from Roster ── */
    const availableGroups = useMemo(() => {
        const roster = rosters.find(r => r.id === (selectedRosterId || resolvedContext.rosterId));
        return roster?.groups || [];
    }, [rosters, selectedRosterId, resolvedContext.rosterId]);

    const activeGroup = useMemo(() => {
        if (!watchGroup) return null;
        return availableGroups.find(g => 
            g.external_id === watchGroup || 
            g.name.toLowerCase().replace(/\s+/g, '_') === watchGroup
        );
    }, [availableGroups, watchGroup]);

    const availableSubGroupsList = useMemo(() => {
        return activeGroup?.subGroups || [];
    }, [activeGroup]);

    /* ── Breadcrumb items ── */
    const breadcrumbs = useMemo(() => {
        const raw = [
            { label: resolvedContext.organizationName,  key: 'org'      },
            { label: resolvedContext.departmentName,    key: 'dept'     },
            { label: resolvedContext.subDepartmentName, key: 'subdept'  },
            // Only show group/subgroup in breadcrumb if they are LOCKED (inherited)
            ...(isGroupLocked ? [{
                label:
                    GROUP_LABEL[watchGroup] ||
                    resolvedContext.groupName ||
                    (resolvedContext.group_type ? GROUP_LABEL[resolvedContext.group_type] : undefined) ||
                    availableGroups.find(g => g.external_id === watchGroup || g.name.toLowerCase().replace(/\s+/g, '_') === watchGroup)?.name,
                key: 'group',
            }] : []),
            ...(isSubGroupLocked ? [{ label: watchSubGroupName || resolvedContext.subGroupName, key: 'subgroup' }] : []),
        ];
        const genericFallbacks = new Set([
            'All Organizations',
            'All Departments',
            'All Sub-Departments',
        ]);
        return raw.filter(
            b => b.label && !genericFallbacks.has(b.label),
        ) as { label: string; key: string }[];
    }, [resolvedContext, watchGroup, watchSubGroupName]);

    /* ── Formatted locked date ── */
    const dateDisplay = useMemo(() => {
        if (watchShiftDate) return format(watchShiftDate, 'EEEE, d MMMM yyyy');
        if (resolvedContext.date) {
            try {
                return format(new Date(resolvedContext.date + 'T00:00:00'), 'EEEE, d MMMM yyyy');
            } catch {
                return resolvedContext.date;
            }
        }
        return 'Inherited from grid';
    }, [watchShiftDate, resolvedContext.date]);

    /* ── Read-only banner config ── */
    const readOnlyBanner = isPublished
        ? {
              kind: 'published' as const,
              title: 'Published — Read Only',
              body: 'Unpublish this shift to make changes.',
          }
        : isStarted
        ? { kind: 'locked' as const, title: 'Shift In Progress — Read Only', body: 'This shift has already started.' }
        : isPast
        ? { kind: 'locked' as const, title: 'Past Shift — Read Only', body: 'Shifts in the past cannot be edited.' }
        : null;

    /* ── Shared input className ── */
    const inputCls =
        'h-10 bg-background border-border rounded-lg text-xs font-medium text-foreground focus:ring-indigo-500/30 focus:border-indigo-500/40 focus-visible:ring-indigo-500/30';

    return (
        <div className={cn(
            "flex-1 min-h-0 flex flex-col transition-all duration-500",
            isReadOnly 
                ? "bg-[#0a0a0c]" 
                : isPublished 
                    ? "bg-[#0c0512]" 
                    : "bg-card dark:bg-[#09090e]"
        )}>

            {/* ── STICKY HEADER ─────────────────────────────────────── */}
            <div className="flex-shrink-0 border-b border-border bg-card/90 dark:bg-[rgba(13,14,18,0.90)] backdrop-blur-xl px-5 py-3.5 flex items-center justify-between z-20">
                <div className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-500 shrink-0">
                        <CalendarCheck className="h-3.5 w-3.5" />
                    </div>
                    <div>
                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/90 leading-none mb-0.5">
                            {editMode ? 'Update Shift' : 'Add New Shift'}
                        </h2>
                        <p className="text-[9px] font-mono text-muted-foreground/60 leading-none">
                            {editMode && existingShift?.id
                                ? `#${existingShift.id.slice(0, 8).toUpperCase()}`
                                : 'New draft'}
                        </p>
                    </div>
                </div>

                {compliancePanel.result?.summary?.blockers > 0 && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-500">
                        <AlertCircle className="h-2.5 w-2.5" />
                        <span className="text-[8px] font-black uppercase tracking-widest">
                            {compliancePanel.result.summary.blockers} blocker
                            {compliancePanel.result.summary.blockers > 1 ? 's' : ''}
                        </span>
                    </div>
                )}
            </div>

            <ScrollArea className="flex-1">
                <div className="px-5 py-5 pb-8 space-y-8">

                    {/* ── READ-ONLY BANNER ─────────────────────────────── */}
                    {readOnlyBanner && (
                        <div
                            className={cn(
                                'flex items-start gap-3 p-3.5 rounded-xl border',
                                readOnlyBanner.kind === 'published'
                                    ? 'bg-purple-500/5 border-purple-500/20'
                                    : 'bg-slate-500/5 border-slate-500/20',
                            )}
                        >
                            <LockIcon
                                className={cn(
                                    'h-4 w-4 shrink-0 mt-0.5',
                                    readOnlyBanner.kind === 'published'
                                        ? 'text-purple-400'
                                        : 'text-slate-400',
                                )}
                            />
                            <div className="flex-1 min-w-0">
                                <p
                                    className={cn(
                                        'text-[9px] font-black uppercase tracking-[0.15em] mb-0.5',
                                        readOnlyBanner.kind === 'published'
                                            ? 'text-purple-400'
                                            : 'text-slate-400',
                                    )}
                                >
                                    {readOnlyBanner.title}
                                </p>
                                <p
                                    className={cn(
                                        'text-[9px] font-medium leading-tight opacity-70',
                                        readOnlyBanner.kind === 'published'
                                            ? 'text-purple-300'
                                            : 'text-slate-300',
                                    )}
                                >
                                    {readOnlyBanner.body}
                                </p>
                            </div>
                            {readOnlyBanner.kind === 'published' && canUnpublish && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={onUnpublish}
                                    className="h-7 px-3 text-[9px] font-black uppercase tracking-widest bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 shrink-0"
                                >
                                    Unpublish
                                </Button>
                            )}
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════
                        01 — SCOPE
                        ══════════════════════════════════════════════════ */}
                    <section>
                        <Section num="01" title="Scope" icon={Building2} />
                        <div className="space-y-4">
                            <ScopeBreadcrumb items={breadcrumbs} />

                            {(!isGroupLocked || !isSubGroupLocked) && (
                                <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-border bg-card dark:bg-white/[0.016]">
                                    {/* Group Selector */}
                                    <FormField
                                        control={form.control}
                                        name="group_type"
                                        render={({ field }) => (
                                            <FormItem className="flex-1">
                                                <FormLabel asChild>
                                                    <FieldLabel required>Roster Group</FieldLabel>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        // Clear subgroup when group changes — do not validate yet to avoid premature error
                                                        form.setValue('sub_group_name', '', { shouldValidate: false });
                                                    }}
                                                    value={field.value}
                                                    disabled={isReadOnly || isGroupLocked}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className={cn(inputCls, 'h-10')}>
                                                            <SelectValue placeholder="Select Group…" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="bg-popover border-border text-popover-foreground text-xs">
                                                        {availableGroups.map(g => {
                                                            const val = g.external_id || g.name.toLowerCase().replace(/\s+/g, '_');
                                                            return (
                                                                <SelectItem key={g.id} value={val} className="focus:bg-indigo-500/15">
                                                                    {g.name}
                                                                </SelectItem>
                                                            );
                                                        })}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage className="text-[9px] text-rose-500 mt-1" />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Subgroup Selector */}
                                    <FormField
                                        control={form.control}
                                        name="sub_group_name"
                                        render={({ field }) => (
                                            <FormItem className="flex-1">
                                                <FormLabel asChild>
                                                    <FieldLabel required>Subgroup</FieldLabel>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        // Explicitly trigger validation to clear "required" error immediately
                                                        setTimeout(() => form.trigger('sub_group_name'), 0);
                                                    }}
                                                    value={field.value}
                                                    disabled={isReadOnly || isSubGroupLocked || !watchGroup}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className={cn(inputCls, 'h-10')}>
                                                            <SelectValue placeholder={!watchGroup ? "Pick group first…" : "Select Subgroup…"} />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="bg-popover border-border text-popover-foreground text-xs">
                                                        {availableSubGroupsList.map(sg => (
                                                            <SelectItem key={sg.id} value={sg.name} className="focus:bg-indigo-500/15">
                                                                {sg.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage className="text-[9px] text-rose-500 mt-1" />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}
                        </div>
                    </section>

                    {/* ══════════════════════════════════════════════════
                        02 — SHIFT IDENTITY
                        ══════════════════════════════════════════════════ */}
                    <section>
                        <Section num="02" title="Shift Identity" icon={Briefcase} />
                        <div className="rounded-xl border border-border bg-card dark:bg-white/[0.016] p-4 space-y-4">

                            {/* Role — required */}
                            <FormField
                                control={form.control}
                                name="role_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel asChild>
                                            <FieldLabel required>Role</FieldLabel>
                                        </FormLabel>
                                        <Select
                                            onValueChange={field.onChange}
                                            value={field.value}
                                            disabled={isReadOnly || isRoleLocked}
                                        >
                                            <FormControl>
                                                <SelectTrigger
                                                    className={cn(
                                                        inputCls,
                                                        'h-10 [&>span]:text-foreground',
                                                    )}
                                                >
                                                    <SelectValue placeholder="Select a role…" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="bg-popover border-border text-popover-foreground text-xs">
                                                {roles.map(r => (
                                                    <SelectItem
                                                        key={r.id}
                                                        value={r.id}
                                                        className="focus:bg-indigo-500/15"
                                                    >
                                                        {r.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage className="text-[9px] text-rose-500 mt-1" />
                                    </FormItem>
                                )}
                            />

                            <div className="h-px bg-border/50" />

                            {/* Training toggle */}
                            <FormField
                                control={form.control}
                                name="is_training"
                                render={({ field }) => (
                                    <FormItem className="flex items-center justify-between p-3 rounded-lg border border-border bg-indigo-50/60 dark:bg-indigo-500/[0.04] hover:bg-indigo-100/60 dark:hover:bg-indigo-500/[0.07] transition-colors">
                                        <div className="flex items-center gap-2.5">
                                            <GraduationCap className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400/60 shrink-0" />
                                            <div>
                                                <p className="text-[10px] font-bold text-foreground leading-tight">
                                                    Training Shift
                                                </p>
                                                <p className="text-[9px] text-muted-foreground/60 leading-tight mt-0.5">
                                                    Enables 2h minimum duration exemption
                                                </p>
                                            </div>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                disabled={isReadOnly}
                                                className="data-[state=checked]:bg-indigo-500"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <div className="h-px bg-border/50" />

                            {/* Skills + Certifications */}
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="required_skills"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel>Skills</FieldLabel>
                                            <MultiSelect
                                                options={skills.map(s => ({ name: s.name, id: s.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None"
                                                disabled={isReadOnly}
                                            />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="required_licenses"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel>Certifications</FieldLabel>
                                            <MultiSelect
                                                options={licenses.map(l => ({ name: l.name, id: l.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None"
                                                disabled={isReadOnly}
                                            />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    </section>

                    {/* ══════════════════════════════════════════════════
                        03 — SHIFT TIMINGS
                        Order: Date → Start/End → Breaks → Rec → Duration → Validation
                        ══════════════════════════════════════════════════ */}
                    <section>
                        <Section num="03" title="Shift Timings" icon={Clock} />
                        <div className="rounded-xl border border-border bg-card dark:bg-white/[0.016] p-4 space-y-4">

                            {/* Date — locked / inherited from column */}
                            {!isTemplateMode && (
                                <>
                                    <div>
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            <Calendar className="h-3 w-3 text-muted-foreground/60" />
                                            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/80">
                                                Shift Date
                                            </p>
                                            <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[8px] font-bold uppercase tracking-widest">
                                                Locked
                                            </span>
                                        </div>
                                        <div className="h-10 flex items-center gap-2.5 px-3 rounded-lg bg-muted/40 border border-border select-none">
                                            <LockIcon className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                            <span className="text-xs text-foreground/80 font-medium truncate">
                                                {dateDisplay}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="h-px bg-border/50" />
                                </>
                            )}

                            {/* Start / End Time — true 24h text inputs */}
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="start_time"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel asChild>
                                                <FieldLabel required hint="(24h)">
                                                    Start Time
                                                </FieldLabel>
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="text"
                                                    inputMode="numeric"
                                                    placeholder="HH:MM"
                                                    value={field.value ?? ''}
                                                    disabled={isReadOnly}
                                                    onChange={e => {
                                                        // Keep only digits, auto-insert colon
                                                        const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
                                                        const formatted = raw.length > 2
                                                            ? `${raw.slice(0, 2)}:${raw.slice(2)}`
                                                            : raw;
                                                        field.onChange(formatted);
                                                    }}
                                                    onBlur={e => {
                                                        // Normalize on blur: ensure HH:MM format
                                                        const v = e.target.value;
                                                        if (v && /^\d{1,2}:\d{2}$/.test(v)) {
                                                            const [h, m] = v.split(':');
                                                            field.onChange(
                                                                `${h.padStart(2, '0')}:${m}`
                                                            );
                                                        }
                                                        field.onBlur();
                                                    }}
                                                    className={cn(
                                                        inputCls,
                                                        'font-mono font-semibold text-sm tracking-widest',
                                                    )}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-[9px] text-rose-500 mt-1" />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="end_time"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel asChild>
                                                <FieldLabel required hint="(24h)">
                                                    End Time
                                                </FieldLabel>
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="text"
                                                    inputMode="numeric"
                                                    placeholder="HH:MM"
                                                    value={field.value ?? ''}
                                                    disabled={isReadOnly}
                                                    onChange={e => {
                                                        const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
                                                        const formatted = raw.length > 2
                                                            ? `${raw.slice(0, 2)}:${raw.slice(2)}`
                                                            : raw;
                                                        field.onChange(formatted);
                                                    }}
                                                    onBlur={e => {
                                                        const v = e.target.value;
                                                        if (v && /^\d{1,2}:\d{2}$/.test(v)) {
                                                            const [h, m] = v.split(':');
                                                            field.onChange(
                                                                `${h.padStart(2, '0')}:${m}`
                                                            );
                                                        }
                                                        field.onBlur();
                                                    }}
                                                    className={cn(
                                                        inputCls,
                                                        'font-mono font-semibold text-sm tracking-widest',
                                                    )}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-[9px] text-rose-500 mt-1" />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <div className="h-px bg-border/50" />

                            {/* Breaks — immediately after Start/End */}
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="unpaid_break_minutes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel asChild>
                                                <FieldLabel>
                                                    <Coffee className="h-3 w-3 inline-block mr-1 relative -top-px" />
                                                    Unpaid Break (min)
                                                </FieldLabel>
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    value={field.value === undefined ? '' : field.value}
                                                    onChange={e =>
                                                        field.onChange(
                                                            e.target.value === ''
                                                                ? undefined
                                                                : Number(e.target.value),
                                                        )
                                                    }
                                                    disabled={isReadOnly}
                                                    placeholder="0"
                                                    className={cn(inputCls, 'font-mono font-semibold')}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-[9px] text-rose-500 mt-1" />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="paid_break_minutes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel asChild>
                                                <FieldLabel>
                                                    <Utensils className="h-3 w-3 inline-block mr-1 relative -top-px" />
                                                    Paid Break (min)
                                                </FieldLabel>
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    value={field.value === undefined ? '' : field.value}
                                                    onChange={e =>
                                                        field.onChange(
                                                            e.target.value === ''
                                                                ? undefined
                                                                : Number(e.target.value),
                                                        )
                                                    }
                                                    disabled={isReadOnly}
                                                    placeholder="0"
                                                    className={cn(inputCls, 'font-mono font-semibold')}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-[9px] text-rose-500 mt-1" />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Break recommendations — reactive named vars, no IIFE */}
                            {(showUnpaidRec || showPaidRec) && (
                                <div className="space-y-2">
                                    {showUnpaidRec && (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => form.setValue('unpaid_break_minutes', reqUnpaid, { shouldDirty: true })}
                                            onKeyDown={e => e.key === 'Enter' && form.setValue('unpaid_break_minutes', reqUnpaid, { shouldDirty: true })}
                                            className="flex items-center justify-between p-3 rounded-lg border border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.06] cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-500/[0.1] transition-colors group outline-none focus-visible:ring-1 focus-visible:ring-amber-500/40"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                                <div>
                                                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-0.5">
                                                        Unpaid Break Required
                                                    </p>
                                                    <p className="text-[9px] text-amber-700/70 dark:text-amber-500 font-medium leading-tight">
                                                        {reqUnpaid} min for shifts &gt; {localShiftLength > 10 ? '10' : '5'}h — currently {curUnpaid} min set
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 shrink-0 group-hover:bg-amber-200 dark:group-hover:bg-amber-500/20 transition-colors">
                                                Apply {reqUnpaid}m
                                            </span>
                                        </div>
                                    )}
                                    {showPaidRec && (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => form.setValue('paid_break_minutes', recPaid, { shouldDirty: true })}
                                            onKeyDown={e => e.key === 'Enter' && form.setValue('paid_break_minutes', recPaid, { shouldDirty: true })}
                                            className="flex items-center justify-between p-3 rounded-lg border border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.06] cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-500/[0.1] transition-colors group outline-none focus-visible:ring-1 focus-visible:ring-amber-500/40"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                                <div>
                                                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-0.5">
                                                        Paid Break Recommended
                                                    </p>
                                                    <p className="text-[9px] text-amber-700/70 dark:text-amber-500 font-medium leading-tight">
                                                        15 min per 4h block — {recPaid} min for this shift (currently {curPaid} min)
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 shrink-0 group-hover:bg-amber-200 dark:group-hover:bg-amber-500/20 transition-colors">
                                                Apply {recPaid}m
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="h-px bg-border/50" />

                            {/* Duration tiles — auto-calculated from times and breaks */}
                            <div className="flex gap-3">
                                <DurationCard
                                    label="Length"
                                    value={formatHours(shiftLength)}
                                    colorClass={
                                        shiftLength > 0
                                            ? 'text-foreground'
                                            : 'text-muted-foreground/30'
                                    }
                                    icon={Timer}
                                />
                                <DurationCard
                                    label="Net Length"
                                    value={formatHours(netLength)}
                                    colorClass={
                                        netLength <= 0
                                            ? 'text-muted-foreground/30'
                                            : netLength < minShiftHours
                                            ? 'text-rose-500'
                                            : 'text-emerald-500'
                                    }
                                    icon={Shield}
                                />
                            </div>

                            {/* Min length alert */}
                            {netLength > 0 && netLength < minShiftHours && (
                                <div className="flex items-start gap-2.5 p-3 rounded-lg border border-rose-300 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/[0.07] animate-in fade-in slide-in-from-top-1 duration-150">
                                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-px" />
                                    <p className="text-[10px] text-rose-700 dark:text-rose-400 font-medium leading-snug">
                                        Net duration ({formatHours(netLength)}) is below the{' '}
                                        <span className="font-black">{formatHours(minShiftHours)} minimum</span>{' '}
                                        for this shift type.
                                    </p>
                                </div>
                            )}

                            {/* Break enforcement — rose error when minimum unpaid break is not met */}
                            {showBreakEnforcement && (
                                <div className="flex items-start gap-2.5 p-3 rounded-lg border border-rose-300 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/[0.07] animate-in fade-in slide-in-from-top-1 duration-150">
                                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-px" />
                                    <p className="text-[10px] text-rose-700 dark:text-rose-400 font-medium leading-snug">
                                        Unpaid break of <span className="font-black">{reqUnpaid} min</span> is required for shifts &gt;{localShiftLength > 10 ? ' 10' : ' 5'}h. Currently{' '}
                                        <span className="font-black">{curUnpaid} min</span> set.
                                    </p>
                                </div>
                            )}

                            {/* Hard validation errors */}
                            {hardValidation && !hardValidation.passed && (hardValidation.errors?.length ?? 0) > 0 && (
                                <div className="space-y-1.5">
                                    {hardValidation.errors.map((err: any, i: number) => (
                                        <div
                                            key={i}
                                            className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-300 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/[0.06]"
                                        >
                                            <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-px" />
                                            <p className="text-[10px] text-rose-700 dark:text-rose-400 font-medium leading-tight">
                                                {err.message}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* ══════════════════════════════════════════════════
                        04 — ASSIGNMENT
                        ══════════════════════════════════════════════════ */}
                    <section>
                        <Section
                            num="04"
                            title="Assignment"
                            icon={UserCircle}
                            badge={
                                resolvedContext.mode === 'people' ? (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/15 text-[8px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                                        Locked
                                    </span>
                                ) : isTemplateMode ? (
                                    <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/15 text-[8px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                                        Templates remain unassigned
                                    </span>
                                    ) : !isScheduleDefined && !isTemplateMode ? (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/15 text-[8px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                                            Compliance pending details
                                        </span>
                                    ) : null

                            }
                        />
                        <div
                            className={cn(
                                'transition-all duration-300',
                                (isEmployeeLocked || isTemplateMode) &&
                                    'opacity-70 grayscale pointer-events-none cursor-not-allowed',
                                !isScheduleDefined && !isTemplateMode && 'opacity-90',
                            )}
                        >
                            <div className="rounded-xl border border-border bg-card dark:bg-white/[0.016] p-4 space-y-3">
                                <FormField
                                    control={form.control}
                                    name="assigned_employee_id"
                                    render={({ field }) => (
                                        <FormItem className="space-y-3">
                                            {/* Search input */}
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                                                <Input
                                                    placeholder="Search employees by name…"
                                                    value={searchTerm}
                                                    onChange={e => setSearchTerm(e.target.value)}
                                                    className={cn(inputCls, 'pl-9')}
                                                />
                                            </div>

                                            {/* Employee list */}
                                            <div className="space-y-1 max-h-[260px] overflow-y-auto pr-px">

                                                {/* Unassigned */}
                                                <button
                                                    type="button"
                                                    onClick={() => field.onChange(null)}
                                                    className={cn(
                                                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left',
                                                        field.value === null
                                                            ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/25'
                                                            : 'bg-muted/30 border-border hover:bg-muted/50',
                                                    )}
                                                    disabled={isReadOnly}
                                                >
                                                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center border border-border shrink-0">
                                                        <Search className="h-3 w-3 text-muted-foreground/50" />
                                                    </div>
                                                    <span
                                                        className={cn(
                                                            'text-xs font-semibold flex-1',
                                                            field.value === null
                                                                ? 'text-indigo-600 dark:text-indigo-400'
                                                                : 'text-muted-foreground',
                                                        )}
                                                    >
                                                        Leave Unassigned
                                                    </span>
                                                    {field.value === null && (
                                                        <CheckCircle2 className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                                                    )}
                                                </button>

                                                {/* Employee rows */}
                                                {filteredEmployees.map(emp => {
                                                    const isSelected = field.value === emp.id;
                                                    const displayName =
                                                        emp.profiles?.full_name ||
                                                        emp.full_name ||
                                                        `${emp.first_name} ${emp.last_name}`;
                                                    const initials = `${emp.first_name?.[0] || ''}${emp.last_name?.[0] || ''}`.toUpperCase();
                                                    return (
                                                        <button
                                                            key={emp.id}
                                                            type="button"
                                                            onClick={() => field.onChange(emp.id)}
                                                            className={cn(
                                                                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left',
                                                                isSelected
                                                                    ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/25'
                                                                    : 'bg-muted/30 border-border hover:bg-muted/50',
                                                            )}
                                                            disabled={isReadOnly}
                                                        >
                                                            <div
                                                                className={cn(
                                                                    'h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors',
                                                                    isSelected
                                                                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                                                                        : 'bg-muted text-muted-foreground',
                                                                )}
                                                            >
                                                                {initials}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p
                                                                    className={cn(
                                                                        'text-xs font-semibold truncate',
                                                                        isSelected
                                                                            ? 'text-emerald-700 dark:text-emerald-400'
                                                                            : 'text-foreground',
                                                                    )}
                                                                >
                                                                    {displayName}
                                                                </p>
                                                                <p className="text-[9px] text-muted-foreground/50 font-mono">
                                                                    {emp.id.slice(0, 8)}
                                                                </p>
                                                            </div>
                                                            {isSelected && (
                                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    </section>

                    {/* ══════════════════════════════════════════════════
                        05 — COMPLIANCE
                        ══════════════════════════════════════════════════ */}
                    <section>
                        <Section num="05" title="Compliance" icon={Shield} />
                        <div className="relative rounded-xl border border-border bg-card dark:bg-white/[0.012] p-4 overflow-hidden">
                            {isLoadingShifts && (
                                <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 backdrop-blur-[2px] transition-all duration-300">
                                    <div className="flex flex-col items-center gap-2 text-center animate-in fade-in zoom-in-95 duration-300">
                                        <div className="relative">
                                            <Shield className="h-6 w-6 text-indigo-500/20" />
                                            <Loader2 className="absolute inset-0 h-6 w-6 animate-spin text-indigo-500" />
                                        </div>
                                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Fetching Shift History...</span>
                                    </div>
                                </div>
                            )}
                            
                            {isTemplateMode && !form.watch('assigned_employee_id') ? (
                                <div className="text-center py-6">
                                    <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mx-auto mb-3 border border-emerald-500/20">
                                        <CheckCircle2 className="h-5 w-5" />
                                    </div>
                                    <h3 className="text-[11px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">
                                        Compliance Checks Passed
                                    </h3>
                                    <p className="text-[10px] text-muted-foreground/60 max-w-[200px] mx-auto leading-relaxed">
                                        Templated shifts are validated when assigned to a specific employee.
                                    </p>
                                </div>
                            ) : (
                                <CompliancePanel
                                    hook={compliancePanel}
                                    className="compliance-panel-integrated"
                                    disabled={isReadOnly || isLoadingShifts}
                                />
                            )}
                        </div>
                    </section>

                    {/* ══════════════════════════════════════════════════
                        06 — NOTES
                        ══════════════════════════════════════════════════ */}
                    <section>
                        <Section num="06" title="Notes" icon={StickyNote} />
                        <FormField
                            control={form.control}
                            name="notes"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <Textarea
                                            {...field}
                                            placeholder="Shift notes, handover instructions, or internal comments…"
                                            disabled={isReadOnly}
                                            className="min-h-[96px] bg-background border-border rounded-xl text-xs font-medium p-3.5 focus:ring-indigo-500/30 resize-none placeholder:text-muted-foreground/40"
                                        />
                                    </FormControl>
                                    <FormMessage className="text-[9px] text-rose-500 mt-1" />
                                </FormItem>
                            )}
                        />
                    </section>

                </div>
            </ScrollArea>
        </div>
    );
};
