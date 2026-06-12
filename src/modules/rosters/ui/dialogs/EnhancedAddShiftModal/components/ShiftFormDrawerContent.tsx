/**
 * ShiftFormDrawerContent — Card-based compact layout
 *
 * 2-column grid of equal-height cards:
 *   Card 1: Identity   (Group / Subgroup / Role)
 *   Card 2: Timings    (Date, Start/End, Breaks, Duration stats)
 *   Card 3: Details    (Training, Skills, Certs, Notes)
 *   Card 4: Assignment (Employee inline picker)
 *   Card 5: Compliance (full-width)
 *
 * Uses native Radix Select for all dropdowns (fixes cmdk populate bug).
 * Industrial dark-mode aesthetic — dense, information-rich, zero waste.
 */

import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import {
    FormControl,
    FormField,
    FormItem,
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
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from '@/modules/core/ui/primitives/command';
import {
    Clock,
    AlertCircle,
    AlertTriangle,
    Lock as LockIcon,
    Shield,
    CalendarCheck,
    GraduationCap,
    Coffee,
    Utensils,
    Info,
    Users,
    UserCircle,
    ChevronRight,
    Timer,
    Loader2,
    CheckCircle2,
    Search,
    X,
    Briefcase,
    Layers,
    StickyNote,
    Award,
    Zap,
    Plus,
    ChevronDown,
    ChevronUp,
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
    the_cutaway: 'The Cutaway',
};

/* ═══════════════════════════════════════════════════════════════════════
   PRIMITIVES
   ═══════════════════════════════════════════════════════════════════════ */

/** Card wrapper — consistent styling for every card in the grid */
const Card = ({
    children,
    className,
    accent = 'default',
}: {
    children: React.ReactNode;
    className?: string;
    accent?: 'amber' | 'cyan' | 'emerald' | 'indigo' | 'default';
}) => {
    const themeMap = {
        amber: { bg: 'bg-card dark:bg-[#15171c]', patternColor: 'rgba(245, 158, 11, 0.03)' },
        cyan: { bg: 'bg-card dark:bg-[#15171c]', patternColor: 'rgba(6, 182, 212, 0.03)' },
        emerald: { bg: 'bg-card dark:bg-[#15171c]', patternColor: 'rgba(16, 185, 129, 0.03)' },
        indigo: { bg: 'bg-card dark:bg-[#15171c]', patternColor: 'rgba(99, 102, 241, 0.03)' },
        default: { bg: 'bg-card dark:bg-[#15171c]', patternColor: 'rgba(113, 113, 122, 0.03)' },
    };

    const theme = themeMap[accent];

    const getPattern = (acc: string, color: string) => {
        if (acc === 'amber') {
            return <svg viewBox="0 0 100 100" className="absolute -bottom-8 -right-8 w-64 h-64 pointer-events-none"><g fill="none" stroke={color} strokeWidth="3"><path d="M0,10 L100,110 M0,25 L100,125 M0,40 L100,140 M0,55 L100,155 M0,70 L100,170 M0,85 L100,185" /></g></svg>;
        }
        if (acc === 'cyan') {
            return <svg viewBox="0 0 100 100" className="absolute -bottom-8 -right-8 w-72 h-72 pointer-events-none"><g fill="none" stroke={color} strokeWidth="2"><path d="M0,20 Q25,0 50,20 T100,20 M0,30 Q25,10 50,30 T100,30 M0,40 Q25,20 50,40 T100,40 M0,50 Q25,30 50,50 T100,50 M0,60 Q25,40 50,60 T100,60 M0,70 Q25,50 50,70 T100,70" /></g></svg>;
        }
        if (acc === 'emerald') {
            return <svg viewBox="0 0 100 100" className="absolute -bottom-4 -right-4 w-56 h-56 pointer-events-none" fill={color}><circle cx="20" cy="20" r="3"/><circle cx="40" cy="20" r="5"/><circle cx="60" cy="20" r="6"/><circle cx="80" cy="20" r="3"/><circle cx="30" cy="40" r="7"/><circle cx="50" cy="40" r="4"/><circle cx="70" cy="40" r="8"/><circle cx="90" cy="40" r="5"/><circle cx="20" cy="60" r="5"/><circle cx="40" cy="60" r="8"/><circle cx="60" cy="60" r="3"/><circle cx="80" cy="60" r="6"/><circle cx="30" cy="80" r="6"/><circle cx="50" cy="80" r="4"/><circle cx="70" cy="80" r="5"/><circle cx="90" cy="80" r="7"/></svg>;
        }
        if (acc === 'indigo') {
            return <svg viewBox="0 0 100 100" className="absolute -bottom-6 -right-6 w-64 h-64 pointer-events-none" stroke={color} strokeWidth="3" strokeLinecap="round"><path d="M20,20 L30,25 M40,10 L45,20 M60,30 L70,25 M80,10 L85,20 M10,40 L15,50 M30,45 L40,55 M50,40 L55,50 M80,45 L90,55 M20,70 L30,75 M40,60 L45,70 M60,80 L70,75 M80,60 L85,70 M10,90 L15,100 M30,95 L40,105 M50,90 L55,100 M80,95 L90,105" /></svg>;
        }
        return <svg viewBox="0 0 100 100" className="absolute -bottom-10 -right-10 w-64 h-64 pointer-events-none"><circle cx="100" cy="100" r="80" fill="none" stroke={color} strokeWidth="2" /><circle cx="100" cy="100" r="60" fill="none" stroke={color} strokeWidth="2" /><circle cx="100" cy="100" r="40" fill="none" stroke={color} strokeWidth="2" /></svg>;
    };

    return (
        <div className={cn(
            'relative flex-1 min-h-0 overflow-hidden rounded-[20px] border border-border/40 shadow-xl transition-all duration-300',
            theme.bg,
            className,
        )}>
            {getPattern(accent, theme.patternColor)}
            <div className="relative z-10 p-5 sm:p-6 flex flex-col h-full">
                {children}
            </div>
        </div>
    );
};

/** Card title bar */
const CardHeader = ({
    icon: Icon,
    title,
    badge,
    color = 'text-muted-foreground/60',
}: {
    icon: React.ElementType;
    title: string;
    badge?: React.ReactNode;
    color?: string;
}) => {
    const colorName = color.match(/text-([a-z]+)-/)?.[1] || 'gray';
    const bgClass = colorName === 'amber' ? 'bg-[#f59e0b]' :
                    colorName === 'cyan' ? 'bg-[#06b6d4]' :
                    colorName === 'emerald' ? 'bg-[#10b981]' :
                    colorName === 'indigo' ? 'bg-[#6366f1]' :
                    'bg-zinc-600 dark:bg-zinc-700';

    return (
        <div className="flex items-start justify-between mb-8 relative z-10">
            <div className="flex flex-col gap-3">
                <div className={cn('h-11 w-11 flex items-center justify-center rounded-[12px] shadow-md', bgClass)}>
                    <Icon className="h-5 w-5 text-white" />
                </div>
                <div>
                    <span className="text-[10px] font-bold text-muted-foreground/80 block mb-1 uppercase tracking-[0.2em]">{colorName === 'gray' ? 'Metadata' : 'Form Section'}</span>
                    <h3 className="text-xl font-bold text-foreground tracking-tight leading-none">{title}</h3>
                </div>
            </div>
            <div className="text-right flex flex-col items-end">
                {badge || <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mt-1">Details</span>}
            </div>
        </div>
    );
}

/** Tiny label */
const FieldLabel = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/80 mb-1.5">
        {children}
        {required && <span className="text-amber-500 ml-0.5">*</span>}
    </p>
);

/** Locked breadcrumb pill */
const ScopePill = ({ label }: { label: string }) => (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/[0.06] border border-amber-500/15 text-amber-600 dark:text-amber-400/80 mr-1.5 mb-1.5">
        <LockIcon className="h-2 w-2 shrink-0 opacity-60" />
        <span className="text-[9px] font-bold whitespace-nowrap">{label}</span>
    </div>
);

/** Duration stat chip */
const StatChip = ({
    label,
    value,
    colorClass,
}: {
    label: string;
    value: string;
    colorClass: string;
}) => (
    <div className={cn(
        "flex-1 py-2 px-3 rounded-lg border",
        value === '—' || value === '0.00h' || value === '0m'
            ? 'bg-zinc-900/40 border-border/20'
            : 'bg-zinc-800/80 border-border/40'
    )}>
        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/80 mb-0.5">{label}</p>
        <p className={cn('text-base font-black font-mono leading-none', colorClass)}>{value}</p>
    </div>
);

/** Inline employee picker row */
const EmployeeRow = ({
    name,
    initials,
    id,
    isSelected,
    onClick,
}: {
    name: string;
    initials: string;
    id: string;
    isSelected: boolean;
    onClick: () => void;
}) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150',
            isSelected
                ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                : 'hover:bg-muted/50 border border-transparent',
        )}
    >
        <div className={cn(
            'h-7 w-7 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0',
            isSelected
                ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                : 'bg-muted text-muted-foreground/70',
        )}>
            {initials}
        </div>
        <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate">{name}</p>
            <p className="text-[9px] text-zinc-400 font-mono">{id.slice(0, 8)}</p>
        </div>
        {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
    </button>
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
    const [poolOpen, setPoolOpen] = useState(false);
    const [poolQuery, setPoolQuery] = useState('');

    /* ── Watched fields ── */
    const watchShiftDate    = form.watch('shift_date');
    const watchGroup        = form.watch('group_type');
    const watchSubGroupName = form.watch('sub_group_name');
    const watchUnpaidBreak  = form.watch('unpaid_break_minutes');
    const watchPaidBreak    = form.watch('paid_break_minutes');
    const watchStart        = form.watch('start_time');
    const watchEnd          = form.watch('end_time');

    /* ── Break recommendation logic ── */
    const localShiftLength = useMemo(
        () => calculateShiftLength(watchStart, watchEnd),
        [watchStart, watchEnd],
    );
    const reqUnpaid    = localShiftLength > 10 ? 60 : localShiftLength > 5 ? 30 : 0;
    const recPaid      = Math.floor(localShiftLength / 4) * 15;
    const curUnpaid    = watchUnpaidBreak ?? 0;
    const curPaid      = watchPaidBreak ?? 0;
    const showUnpaidRec        = !isReadOnly && reqUnpaid > 0 && curUnpaid < reqUnpaid;
    const showBreakEnforcement = localShiftLength > 5 && curUnpaid < reqUnpaid;

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

    /* ── Scope breadcrumb items ── */
    const scopeItems = useMemo(() => {
        const raw = [
            resolvedContext.organizationName,
            resolvedContext.departmentName,
            resolvedContext.subDepartmentName,
            ...(isGroupLocked ? [
                GROUP_LABEL[watchGroup] ||
                resolvedContext.groupName ||
                (resolvedContext.group_type ? GROUP_LABEL[resolvedContext.group_type] : undefined) ||
                availableGroups.find(g => g.external_id === watchGroup || g.name.toLowerCase().replace(/\s+/g, '_') === watchGroup)?.name
            ] : []),
            ...(isSubGroupLocked ? [watchSubGroupName || resolvedContext.subGroupName] : []),
        ];
        const genericFallbacks = new Set([
            'All Organizations', 'All Departments', 'All Sub-Departments',
        ]);
        return raw.filter(Boolean).filter(s => !genericFallbacks.has(s!)) as string[];
    }, [resolvedContext, watchGroup, watchSubGroupName, isGroupLocked, isSubGroupLocked, availableGroups]);

    /* ── Formatted locked date ── */
    const dateDisplay = useMemo(() => {
        if (watchShiftDate) return format(watchShiftDate, 'EEE, d MMM yyyy');
        if (resolvedContext.date) {
            try { return format(new Date(resolvedContext.date + 'T00:00:00'), 'EEE, d MMM yyyy'); }
            catch { return resolvedContext.date; }
        }
        return 'Select date';
    }, [watchShiftDate, resolvedContext.date]);

    /* ── Employee pool filtering ── */
    const filteredEmployees = useMemo(() => {
        const q = poolQuery.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter(e => {
            const name = e.profiles?.full_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
            return name.toLowerCase().includes(q);
        });
    }, [employees, poolQuery]);

    const displayNameOf = (e: any) =>
        e.profiles?.full_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Employee';

    const initialsOf = (e: any) =>
        `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase() || '??';

    /* ── Shared input class ── */
    const inputCls =
        'h-9 bg-background border-border/60 rounded-lg text-xs font-medium text-foreground focus:ring-amber-500/30 focus:border-amber-500/40 focus-visible:ring-amber-500/30';

    /* ── Read-only banner config ── */
    const readOnlyBanner = isPublished
        ? { kind: 'published' as const, title: 'Published — Read Only', body: 'Unpublish to edit.' }
        : isStarted
        ? { kind: 'locked' as const, title: 'In Progress — Read Only', body: 'Shift has started.' }
        : isPast
        ? { kind: 'locked' as const, title: 'Past — Read Only', body: 'Cannot edit past shifts.' }
        : null;

    return (
        <div className="flex-1 min-h-0 flex flex-col bg-card dark:bg-[#0a0c10]">

            {/* ── COMPACT HEADER ─────────────────────────────────── */}
            <div className="flex-shrink-0 border-b border-border/50 bg-card/90 dark:bg-[#0c0e14]/90 backdrop-blur-xl px-5 py-3 flex items-center justify-between z-20">
                <div className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                        <CalendarCheck className="h-3.5 w-3.5" />
                    </div>
                    <div>
                        <h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-foreground/90 leading-none mb-0.5">
                            {editMode ? 'Update Shift' : 'New Shift'}
                        </h2>
                        <p className="text-[9px] font-mono text-muted-foreground/80 leading-none">
                            {editMode && existingShift?.id
                                ? `#${existingShift.id.slice(0, 8).toUpperCase()}`
                                : dateDisplay}
                        </p>
                    </div>
                </div>

                {/* Scope pills */}
                <div className="flex items-center flex-wrap justify-end max-w-[60%]">
                    {scopeItems.map((s, i) => (
                        <ScopePill key={i} label={s} />
                    ))}
                </div>
            </div>

            {readOnlyBanner && (
                <div className="flex-shrink-0 px-5 py-2 border-b border-border/40">
                    <div className={cn(
                        'flex items-center gap-2 p-2 rounded-lg border text-[9px] font-bold uppercase tracking-widest',
                        readOnlyBanner.kind === 'published'
                            ? 'bg-purple-500/5 border-purple-500/20 text-purple-400'
                            : 'bg-slate-500/5 border-slate-500/20 text-slate-400',
                    )}>
                        <LockIcon className="h-3 w-3 shrink-0" />
                        <span>{readOnlyBanner.title}</span>
                        <span className="font-medium normal-case tracking-normal opacity-70">— {readOnlyBanner.body}</span>
                        {readOnlyBanner.kind === 'published' && canUnpublish && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={onUnpublish}
                                className="h-6 px-2 text-[8px] font-black uppercase tracking-widest ml-auto bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20"
                            >
                                Unpublish
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* ── CARD GRID ─────────────────────────────────────── */}
            <div className="flex-1 min-h-0 p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start overflow-y-auto">
                {/* Left Column */}
                <div className="flex flex-col gap-4">
                    {/* CARD 1: Identity */}
                    <Card accent="amber" className="flex flex-col">
                            <CardHeader icon={Briefcase} title="1. Role & Details" color="text-amber-500/60" />

                            <div className="space-y-2.5">
                                {/* Group */}
                                {!isGroupLocked && (
                                    <FormField
                                        control={form.control}
                                        name="group_type"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel required>Group</FieldLabel>
                                                <Select
                                                    value={field.value || ""}
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        form.setValue('sub_group_name', '', { shouldValidate: false });
                                                    }}
                                                    disabled={isReadOnly}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 text-sm bg-background border-border/60 rounded-lg">
                                                            <SelectValue placeholder="Select group…" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="z-[200]">
                                                        {availableGroups.map(g => (
                                                            <SelectItem
                                                                key={g.id}
                                                                value={g.external_id || g.name.toLowerCase().replace(/\s+/g, '_')}
                                                            >
                                                                {g.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage className="text-[9px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {/* Subgroup */}
                                {!isSubGroupLocked && (
                                    <FormField
                                        control={form.control}
                                        name="sub_group_name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel required>Subgroup</FieldLabel>
                                                <Select
                                                    value={field.value || ""}
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        setTimeout(() => form.trigger('sub_group_name'), 0);
                                                    }}
                                                    disabled={isReadOnly || !watchGroup}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 text-sm bg-background border-border/60 rounded-lg">
                                                            <SelectValue placeholder={!watchGroup ? 'Pick group first' : 'Select subgroup…'} />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="z-[200]">
                                                        {availableSubGroupsList.map(sg => (
                                                            <SelectItem key={sg.id || sg.name} value={sg.name}>
                                                                {sg.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage className="text-[9px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {/* Role */}
                                <FormField
                                    control={form.control}
                                    name="role_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel required>Role</FieldLabel>
                                            <Select
                                                value={field.value || ""}
                                                onValueChange={field.onChange}
                                                disabled={isReadOnly || isRoleLocked}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className={cn(
                                                        "h-11 text-sm bg-background border-border/60 rounded-lg",
                                                        isRoleLocked && "opacity-60"
                                                    )}>
                                                        <SelectValue placeholder="Select role…" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="z-[200] max-h-[280px]">
                                                    {roles.map(r => (
                                                        <SelectItem key={r.id} value={r.id}>
                                                            {r.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage className="text-[9px] text-rose-500" />
                                        </FormItem>
                                    )}
                                />
                            
                                {/* Divider */}
                                <div className="h-px w-full bg-border/40 my-3" />

                                {/* Training toggle */}
                                <FormField
                                    control={form.control}
                                    name="is_training"
                                    render={({ field }) => (
                                        <FormItem className="flex items-center justify-between p-2 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                                            <div className="flex items-center gap-2">
                                                <GraduationCap className="h-3.5 w-3.5 text-amber-500/60 shrink-0" />
                                                <div>
                                                    <p className="text-[10px] font-bold text-foreground leading-tight">Training</p>
                                                    <p className="text-[8px] text-muted-foreground/80">2h min exemption</p>
                                                </div>
                                            </div>
                                            <FormControl>
                                                <Switch
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={isReadOnly}
                                                    className="data-[state=checked]:bg-amber-500 scale-90"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                {/* Skills + Certs */}
                                <div className="grid grid-cols-2 gap-2">
                                    <FormField
                                        control={form.control}
                                        name="required_skills"
                                        render={({ field }) => (
                                            <FormItem>
                                                <MultiSelect
                                                    label="Skills"
                                                    options={skills.map(s => ({ name: s.name, id: s.id }))}
                                                    selected={field.value || []}
                                                    onChange={field.onChange}
                                                    placeholder="None"
                                                    disabled={isReadOnly}
                                                    compact
                                                />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="required_licenses"
                                        render={({ field }) => (
                                            <FormItem>
                                                <MultiSelect
                                                    label="Certs"
                                                    options={licenses.map(l => ({ name: l.name, id: l.id }))}
                                                    selected={field.value || []}
                                                    onChange={field.onChange}
                                                    placeholder="None"
                                                    disabled={isReadOnly}
                                                    compact
                                                />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* Notes */}
                                <FormField
                                    control={form.control}
                                    name="notes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel>
                                                <StickyNote className="h-2.5 w-2.5 inline mr-0.5 relative -top-px" />
                                                Notes
                                            </FieldLabel>
                                            <FormControl>
                                                <Textarea
                                                    {...field}
                                                    placeholder="Shift notes or handover…"
                                                    disabled={isReadOnly}
                                                    className="min-h-[56px] bg-background border-border/60 rounded-lg text-xs font-medium p-2.5 focus:ring-amber-500/30 resize-none placeholder:text-muted-foreground/30"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </Card>

                        {/* CARD 2: Timings */}
                        <Card accent="cyan" className="flex flex-col">
                            <CardHeader icon={Clock} title="2. Timings" color="text-cyan-500/60" />

                            <div className="space-y-2.5">
                                {/* Date (locked) */}
                                {!isTemplateMode && (
                                    <div>
                                        <FieldLabel>Date <span className="text-amber-500/60 text-[8px] ml-1">LOCKED</span></FieldLabel>
                                        <div className="h-9 flex items-center gap-2 px-3 rounded-lg bg-muted/30 border border-border/40 select-none">
                                            <LockIcon className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />
                                            <span className="text-xs text-foreground/70 font-medium truncate">{dateDisplay}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Start / End */}
                                <div className="grid grid-cols-2 gap-2">
                                    <FormField
                                        control={form.control}
                                        name="start_time"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel required>Start</FieldLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Input
                                                        type="time"
                                                        placeholder="HH:MM"
                                                        defaultValue={field.value ?? undefined}
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
                                                                field.onChange(`${h.padStart(2, '0')}:${m}`);
                                                            }
                                                            field.onBlur();
                                                        }}
                                                        className={cn(inputCls, 'font-mono font-semibold tracking-widest pl-9 h-11')}
                                                    />
                                                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cyan-500/50" />
                                                </div>
                                                </FormControl>
                                                <FormMessage className="text-[9px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="end_time"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel required>End</FieldLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Input
                                                        type="time"
                                                        placeholder="HH:MM"
                                                        defaultValue={field.value ?? undefined}
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
                                                                field.onChange(`${h.padStart(2, '0')}:${m}`);
                                                            }
                                                            field.onBlur();
                                                        }}
                                                        className={cn(inputCls, 'font-mono font-semibold tracking-widest pl-9 h-11')}
                                                    />
                                                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cyan-500/50" />
                                                </div>
                                                </FormControl>
                                                <FormMessage className="text-[9px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* Breaks */}
                                <div className="grid grid-cols-2 gap-2">
                                    <FormField
                                        control={form.control}
                                        name="unpaid_break_minutes"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel>
                                                    <Coffee className="h-2.5 w-2.5 inline mr-0.5 relative -top-px" />
                                                    Unpaid (min)
                                                </FieldLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        value={field.value === undefined ? '' : field.value}
                                                        onChange={e =>
                                                            field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                                                        }
                                                        disabled={isReadOnly}
                                                        placeholder="0"
                                                        className={cn(inputCls, 'h-11 text-sm font-mono')}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="paid_break_minutes"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel>
                                                    <Utensils className="h-2.5 w-2.5 inline mr-0.5 relative -top-px" />
                                                    Paid (min)
                                                </FieldLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        value={field.value === undefined ? '' : field.value}
                                                        onChange={e =>
                                                            field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                                                        }
                                                        disabled={isReadOnly}
                                                        placeholder="0"
                                                        className={cn(inputCls, 'h-11 text-sm font-mono')}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* Break recommendation */}
                                {showUnpaidRec && (
                                    <button
                                        type="button"
                                        onClick={() => form.setValue('unpaid_break_minutes', reqUnpaid, { shouldDirty: true })}
                                        className="w-full flex items-center justify-between p-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.08] transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <Info className="h-3 w-3 text-amber-500/60 shrink-0" />
                                            <span className="text-[9px] text-amber-600 dark:text-amber-400/80 font-medium">
                                                {reqUnpaid}m unpaid required ({curUnpaid}m set)
                                            </span>
                                        </div>
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-amber-500 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/15 shrink-0">
                                            Apply
                                        </span>
                                    </button>
                                )}

                                {/* Duration stats */}
                                <div className="flex gap-2">
                                    <StatChip
                                        label="Length"
                                        value={formatHours(shiftLength)}
                                        colorClass={shiftLength > 0 ? 'text-foreground' : 'text-muted-foreground/30'}
                                    />
                                    <StatChip
                                        label="Net"
                                        value={formatHours(netLength)}
                                        colorClass={
                                            netLength <= 0 ? 'text-muted-foreground/30'
                                            : netLength < minShiftHours ? 'text-rose-500'
                                            : 'text-emerald-500'
                                        }
                                    />
                                </div>

                                {/* Duration warning */}
                                {netLength > 0 && netLength < minShiftHours && (
                                    <div className="flex items-center gap-1.5 p-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] text-rose-500">
                                        <AlertTriangle className="h-3 w-3 shrink-0" />
                                        <p className="text-[9px] font-medium">
                                            Below {formatHours(minShiftHours)} minimum
                                        </p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>

                    {/* Right Column */}
                    <div className="flex flex-col gap-4">
                        {/* CARD 4: Assignment */}
                        <Card accent="emerald" className="flex flex-col">
                            <CardHeader
                                icon={UserCircle}
                                title="3. Assignment"
                                color="text-emerald-500/60"
                                badge={
                                    isTemplateMode ? (
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/80 px-1.5 py-0.5 rounded bg-muted/30 border border-border/40">
                                            Templates unassigned
                                        </span>
                                    ) : isEmployeeLocked ? (
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-amber-500/70 px-1.5 py-0.5 rounded bg-amber-500/[0.06] border border-amber-500/15">
                                            Locked
                                        </span>
                                    ) : null
                                }
                            />

                            <FormField
                                control={form.control}
                                name="assigned_employee_id"
                                render={({ field }) => {
                                    const assignedEmployee = employees.find(e => e.id === field.value);
                                    let displayName = 'Unassigned';
                                    let initials = '';

                                    if (assignedEmployee) {
                                        displayName = displayNameOf(assignedEmployee);
                                        initials = initialsOf(assignedEmployee);
                                    } else if (existingShift && (existingShift.assigned_employee_id === field.value || existingShift.assignedEmployeeId === field.value)) {
                                        const profiles = existingShift.assigned_profiles || existingShift.profiles;
                                        if (profiles) {
                                            displayName = profiles.full_name || `${profiles.first_name || ''} ${profiles.last_name || ''}`.trim() || 'Assigned';
                                            initials = `${profiles.first_name?.[0] || ''}${profiles.last_name?.[0] || ''}`.toUpperCase() || '??';
                                        }
                                    }

                                    const isAssigned = !!field.value;

                                    return (
                                        <FormItem className="space-y-2">
                                            {/* Current assignment display */}
                                            {isAssigned ? (
                                                <div className="flex items-center justify-between p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03]">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="h-10 w-10 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center text-xs font-bold ring-2 ring-emerald-500/20 shrink-0">
                                                            {initials}
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-bold text-foreground">{displayName}</p>
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70 bg-emerald-500/10 px-1 rounded flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Available</span>
                                                                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70 bg-emerald-500/10 px-1 rounded flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Qualified</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {!isReadOnly && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => field.onChange(null)}
                                                            className="h-6 px-2 text-[8px] font-bold uppercase tracking-widest text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-between p-2.5 rounded-lg border border-dashed border-border/60 bg-muted/10">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="h-8 w-8 rounded-full bg-muted/50 flex items-center justify-center border border-border/40 shrink-0">
                                                            <UserCircle className="h-4 w-4 text-muted-foreground/30" />
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-medium text-foreground/60">Unassigned</p>
                                                            <p className="text-[8px] text-zinc-400">Open for bidding</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Inline employee picker */}
                                            {!isReadOnly && !isTemplateMode && !isEmployeeLocked && (
                                                <Popover open={poolOpen} onOpenChange={setPoolOpen} modal={false}>
                                                    <PopoverTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            variant="default"
                                                            className="w-full h-11 text-[11px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 gap-2 mt-2"
                                                        >
                                                            <Plus className="h-4 w-4" />
                                                            Select Employee
                                                            <span className="ml-auto text-zinc-400 font-mono normal-case tracking-normal">{employees.length}</span>
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent
                                                        className="w-[var(--radix-popover-trigger-width)] border-none shadow-none p-0 bg-transparent overflow-visible z-[200] pointer-events-auto outline-none animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300"
                                                        sideOffset={10}
                                                        align="center"
                                                    >
                                                        <Command className="bg-transparent overflow-visible w-full outline-none">
                                                            <div className="flex flex-col gap-1.5 w-full">
                                                                {/* Search bar — unified with Skills/Certs */}
                                                                <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                                                                    <CommandInput
                                                                        placeholder="Search employees…"
                                                                        className="h-14 text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                                                        autoFocus
                                                                    />
                                                                </div>

                                                                {/* Results — unified with Skills/Certs */}
                                                                <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden">
                                                                    <CommandList className="max-h-[300px] p-1.5 overflow-y-auto overflow-x-hidden">
                                                                        <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">
                                                                            No employees found.
                                                                        </CommandEmpty>
                                                                        <CommandGroup>
                                                                            {/* Leave Unassigned */}
                                                                            <CommandItem
                                                                                value="__leave_unassigned__"
                                                                                onSelect={() => { field.onChange(null); setPoolOpen(false); }}
                                                                                className="flex items-center gap-2.5 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-indigo-600 aria-selected:text-white group"
                                                                            >
                                                                                <div className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 bg-muted text-muted-foreground/70 group-aria-selected:bg-white/20 group-aria-selected:text-white">—</div>
                                                                                <div className="flex-1 min-w-0">
                                                                                    <p className="text-xs font-semibold truncate">Leave Unassigned</p>
                                                                                    <p className="text-[9px] text-zinc-400 font-mono group-aria-selected:text-white/60">open for bidding</p>
                                                                                </div>
                                                                                {!field.value && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 group-aria-selected:text-white shrink-0" />}
                                                                            </CommandItem>

                                                                            {filteredEmployees.map(emp => {
                                                                                const selected = field.value === emp.id;
                                                                                return (
                                                                                    <CommandItem
                                                                                        key={emp.id}
                                                                                        value={`${displayNameOf(emp)} ${emp.id}`.toLowerCase()}
                                                                                        onSelect={() => { field.onChange(emp.id); setPoolOpen(false); }}
                                                                                        className={cn(
                                                                                            'flex items-center gap-2.5 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-indigo-600 aria-selected:text-white group',
                                                                                            selected && 'bg-emerald-500/10 dark:bg-emerald-500/5',
                                                                                        )}
                                                                                    >
                                                                                        <div className={cn(
                                                                                            'h-7 w-7 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0',
                                                                                            selected
                                                                                                ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30 group-aria-selected:bg-white/20 group-aria-selected:text-white group-aria-selected:ring-0'
                                                                                                : 'bg-muted text-muted-foreground/70 group-aria-selected:bg-white/20 group-aria-selected:text-white',
                                                                                        )}>
                                                                                            {initialsOf(emp)}
                                                                                        </div>
                                                                                        <div className="flex-1 min-w-0">
                                                                                            <p className="text-xs font-semibold truncate">{displayNameOf(emp)}</p>
                                                                                            <p className="text-[9px] text-zinc-400 font-mono group-aria-selected:text-white/60">{emp.id.slice(0, 8)}</p>
                                                                                        </div>
                                                                                        {selected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 group-aria-selected:text-white shrink-0" />}
                                                                                    </CommandItem>
                                                                                );
                                                                            })}
                                                                        </CommandGroup>
                                                                    </CommandList>

                                                                    {/* Unified Footer */}
                                                                    <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-indigo-500/5 dark:border-white/5 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-indigo-500/50 dark:text-muted-foreground/50">
                                                                        <div className="flex items-center gap-4">
                                                                            <span className="flex items-center gap-1">
                                                                                <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">↑↓</kbd> NAV
                                                                            </span>
                                                                            <span className="flex items-center gap-1">
                                                                                <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">↵</kbd> SELECT
                                                                            </span>
                                                                        </div>
                                                                        <span className="flex items-center gap-1">
                                                                            <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">ESC</kbd> CLOSE
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </Command>
                                                    </PopoverContent>
                                                </Popover>
                                            )}

                                            {/* Hard validation errors */}
                                            {hardValidation && !hardValidation.passed && (hardValidation.errors?.length ?? 0) > 0 && (
                                                <div className="space-y-1">
                                                    {hardValidation.errors.map((err: any, i: number) => (
                                                        <div
                                                            key={i}
                                                            className="flex items-center gap-1.5 p-1.5 rounded-md border border-rose-500/20 bg-rose-500/[0.04] text-rose-500"
                                                        >
                                                            <AlertCircle className="h-3 w-3 shrink-0" />
                                                            <p className="text-[9px] font-medium">{err.message}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </FormItem>
                                    );
                                }}
                            />
                        </Card>

                        {/* CARD 4: Compliance */}
                        <Card accent="indigo" className="flex flex-col">
                            <CardHeader
                                icon={Shield}
                                title="Compliance"
                                color="text-indigo-500/60"
                                badge={
                                    compliancePanel.result?.summary?.blockers > 0 ? (
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-rose-400 px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20">
                                            {compliancePanel.result.summary.blockers} blocker{compliancePanel.result.summary.blockers > 1 ? 's' : ''}
                                        </span>
                                    ) : null
                                }
                            />
                            <ScrollArea className="flex-1 min-h-0 w-full">
                                <div className="relative overflow-hidden rounded-lg">
                                    {isLoadingShifts && (
                                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 backdrop-blur-[2px]">
                                            <div className="flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                                                <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Fetching history…</span>
                                            </div>
                                        </div>
                                    )}

                                    {isTemplateMode && !form.watch('assigned_employee_id') ? (
                                        <div className="text-center py-6">
                                            <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mx-auto mb-2 border border-emerald-500/20">
                                                <CheckCircle2 className="h-4 w-4" />
                                            </div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-0.5">
                                                Checks Passed
                                            </p>
                                            <p className="text-[9px] text-muted-foreground/80 max-w-[200px] mx-auto">
                                                Validated when assigned to an employee.
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
                            </ScrollArea>
                        </Card>
                    </div>
                </div>
        </div>
    );
};
