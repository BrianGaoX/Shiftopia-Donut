import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import {
    Check,
    AlertTriangle,
    Loader2,
    Camera,
    CalendarRange,
    CalendarCheck,
    Info,
    ArrowRight,
    FileText,
    Sparkles,
    Building2,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useSnapRosterAsTemplate } from '@/modules/templates/state/useTemplates';
import { supabase } from '@/platform/supabase/client';
import { useNavigate } from 'react-router-dom';

/* ============================================================
   LOCAL HELPERS
   ============================================================ */

function formatDateShort(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

function buildDefaultName(
    subDepartmentName: string,
    startDate: string,
    endDate: string
): string {
    if (!startDate || !endDate) return '';
    const s = formatDateShort(startDate);
    const e = formatDateShort(endDate);
    if (!s || !e) return '';
    return `${subDepartmentName} Pattern ${s}\u2013${e}`;
}

/* ============================================================
   PROPS
   ============================================================ */

interface SnapFromRosterDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    subDepartmentId: string;
    subDepartmentName: string;
    defaultStartDate?: string;
    defaultEndDate?: string;
}

/* ============================================================
   ERROR CODE → MESSAGE
   ============================================================ */

function resolveErrorMessage(err: unknown): string {
    if (!err) return '';
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'Failed to capture template. Please try again.';
}

/* ============================================================
   COMPONENT
   ============================================================ */

const SnapFromRosterDialog: React.FC<SnapFromRosterDialogProps> = ({
    open,
    onOpenChange,
    subDepartmentId,
    subDepartmentName,
    defaultStartDate = '',
    defaultEndDate = '',
}) => {
    const navigate = useNavigate();

    const [startDate, setStartDate] = useState<string>(defaultStartDate);
    const [endDate, setEndDate] = useState<string>(defaultEndDate);
    const [templateName, setTemplateName] = useState<string>('');
    const [nameDirty, setNameDirty] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [successResult, setSuccessResult] = useState<{
        templateId: string;
        shiftsCaptured: number;
    } | null>(null);

    const snapMutation = useSnapRosterAsTemplate();

    /* ----------------------------------------------------------
       Sync defaultProps when dialog is opened
       ---------------------------------------------------------- */
    const prevOpen = useRef(false);
    useEffect(() => {
        if (open && !prevOpen.current) {
            setStartDate(defaultStartDate);
            setEndDate(defaultEndDate);
            setNameDirty(false);
            setError(null);
            setSuccessResult(null);
            const suggested = buildDefaultName(
                subDepartmentName,
                defaultStartDate,
                defaultEndDate
            );
            setTemplateName(suggested);
        }
        prevOpen.current = open;
    }, [open, defaultStartDate, defaultEndDate, subDepartmentName]);

    /* ----------------------------------------------------------
       Auto-name whenever dates change (unless user has typed)
       ---------------------------------------------------------- */
    useEffect(() => {
        if (!nameDirty) {
            setTemplateName(
                buildDefaultName(subDepartmentName, startDate, endDate)
            );
        }
    }, [startDate, endDate, subDepartmentName, nameDirty]);

    /* ----------------------------------------------------------
       Derived validation
       ---------------------------------------------------------- */
    const datesValid = useMemo(() => {
        if (!startDate || !endDate) return false;
        return new Date(startDate) <= new Date(endDate);
    }, [startDate, endDate]);

    /* ----------------------------------------------------------
       Live shift count preview
       ---------------------------------------------------------- */
    const [previewCount, setPreviewCount] = useState<number | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    useEffect(() => {
        if (!datesValid || !startDate || !endDate) {
            setPreviewCount(null);
            return;
        }
        setPreviewLoading(true);
        supabase
            .from('shifts')
            .select('id', { count: 'exact', head: true })
            .eq('sub_department_id', subDepartmentId)
            .gte('shift_date', startDate)
            .lte('shift_date', endDate)
            .neq('lifecycle_status', 'Cancelled')
            .is('deleted_at', null)
            .then(({ count }) => {
                setPreviewCount(count ?? 0);
                setPreviewLoading(false);
            });
    }, [startDate, endDate, datesValid, subDepartmentId]);

    const nameValid = useMemo(
        () => templateName.trim().length >= 3 && templateName.trim().length <= 100,
        [templateName]
    );

    const nameError = useMemo(() => {
        const t = templateName.trim();
        if (t.length === 0) return null;
        if (t.length < 3) return 'Name must be at least 3 characters.';
        if (t.length > 100) return 'Name must be fewer than 100 characters.';
        return null;
    }, [templateName]);

    const canSubmit =
        datesValid &&
        nameValid &&
        !snapMutation.isPending &&
        (previewCount ?? 0) > 0 &&
        !previewLoading;

    /* ----------------------------------------------------------
       Handler
       ---------------------------------------------------------- */
    const handleSnap = async () => {
        if (!canSubmit) return;
        setError(null);
        try {
            const result = await snapMutation.mutateAsync({
                subDepartmentId,
                startDate,
                endDate,
                templateName: templateName.trim(),
            });
            setSuccessResult({
                templateId: result.templateId,
                shiftsCaptured: result.shiftsCaptured,
            });
        } catch (err) {
            setError(resolveErrorMessage(err));
        }
    };

    const handleClose = () => {
        onOpenChange(false);
    };

    /* ----------------------------------------------------------
       Render
       ---------------------------------------------------------- */
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="w-[calc(100vw-1rem)] sm:max-w-[1040px] h-[85vh] sm:h-[720px] max-h-[85vh] bg-background border border-border p-0 overflow-hidden shadow-2xl flex flex-col rounded-2xl sm:rounded-[2.5rem] [&>button]:hidden z-[150]"
            >
                <VisuallyHidden>
                    <DialogTitle>Capture Template from Roster</DialogTitle>
                    <DialogDescription>
                        Select a date range and capture existing roster shifts as a reusable draft template.
                    </DialogDescription>
                </VisuallyHidden>

                <div className="flex flex-col md:flex-row flex-1 h-full min-h-0 overflow-auto md:overflow-hidden">

                    {/* ============================================================
                        LEFT PANE — RANGE
                        ============================================================ */}
                    <div className="w-full md:w-[280px] border-r border-border flex flex-col bg-muted/30">
                        <div className="p-10 pb-8">
                            <div className="flex items-center gap-4 mb-10">
                                <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
                                    <CalendarRange className="h-5 w-5 text-primary" />
                                </div>
                                <div className="flex flex-col">
                                    <h2 className="text-lg font-black text-foreground tracking-tight leading-none">
                                        Date Range
                                    </h2>
                                    <p className="text-[9px] text-muted-foreground uppercase font-black tracking-[0.15em] mt-1.5">
                                        Capture Window
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-5">
                                {/* Start date */}
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                        Start Date
                                    </Label>
                                    <Input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="bg-background border-border text-foreground dark:bg-black/60 dark:border-white/5 dark:text-white focus:ring-primary/40 rounded-xl font-mono text-sm h-11 px-4"
                                    />
                                </div>

                                {/* End date */}
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                        End Date
                                    </Label>
                                    <Input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="bg-background border-border text-foreground dark:bg-black/60 dark:border-white/5 dark:text-white focus:ring-primary/40 rounded-xl font-mono text-sm h-11 px-4"
                                    />
                                </div>

                                {/* Date range validation feedback */}
                                {startDate && endDate && !datesValid && (
                                    <div
                                        className="flex items-center gap-2.5 p-3 bg-red-500/5 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400"
                                    >
                                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="text-[10px] font-black uppercase tracking-tight">
                                            End date precedes start date
                                        </span>
                                    </div>
                                )}

                                <Separator className="bg-border" />

                                {/* Subdepartment read-only */}
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                        Subdepartment
                                    </Label>
                                    <div className="flex items-center gap-2.5 h-11 px-4 rounded-xl bg-muted/60 border border-border">
                                        <Building2 className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                                        <span className="text-sm font-semibold text-foreground dark:text-white truncate">
                                            {subDepartmentName}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Instructions footer */}
                        <div className="mt-auto p-8 pt-4 border-t border-border bg-muted/50">
                            <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10">
                                <div className="flex gap-3">
                                    <Info className="h-3.5 w-3.5 text-blue-500/60 dark:text-blue-400/60 flex-shrink-0 mt-0.5" />
                                    <p className="text-[10px] font-bold text-muted-foreground/70 leading-relaxed tracking-tight">
                                        Select a date range. Shifts will be captured as a reusable template
                                        (employee assignments will be removed).
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ============================================================
                        MIDDLE PANE — PREVIEW
                        ============================================================ */}
                    <div className="flex-1 flex flex-col bg-background relative overflow-hidden">

                        {/* Ambient flares */}
                        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full pointer-events-none opacity-50" />
                        <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-indigo-500/5 blur-[100px] rounded-full pointer-events-none opacity-50" />

                        <div className="flex-1 flex flex-col p-10 relative z-10">
                            <div className="max-w-[480px] mx-auto w-full flex flex-col h-full">

                                {/* Header */}
                                <div className="mb-10 text-center">
                                    <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 shadow-inner">
                                        <Sparkles className="h-3 w-3 text-primary" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">
                                            Template Preview
                                        </span>
                                    </div>
                                    <h2 className="text-3xl font-black text-foreground tracking-tighter leading-none mb-4">
                                        Preview
                                    </h2>
                                    <p className="text-sm text-muted-foreground font-medium leading-relaxed max-w-[400px] mx-auto opacity-70">
                                        Review what will be captured before committing.
                                    </p>
                                </div>

                                <div className="flex-1 flex flex-col justify-center gap-8">
                                    {/* Summary card */}
                                    <div className="space-y-0 bg-slate-100/60 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 p-7 rounded-[2rem] shadow-inner relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-20 h-20 bg-primary/5 blur-3xl rounded-full" />

                                        <div className="space-y-4 relative z-10">
                                            {/* Date range row */}
                                            <div className="flex items-center gap-3">
                                                <CalendarRange className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                                                    Date range
                                                </span>
                                                <div className="ml-auto flex items-center gap-1.5 font-mono text-xs bg-background dark:bg-muted/40 border border-border px-2.5 py-1 rounded-lg text-foreground dark:text-white">
                                                    {startDate ? (
                                                        <>
                                                            <span>{formatDateShort(startDate) || startDate}</span>
                                                            <ArrowRight className="h-3 w-3 opacity-40" />
                                                            <span>{endDate ? (formatDateShort(endDate) || endDate) : '—'}</span>
                                                        </>
                                                    ) : (
                                                        <span className="text-muted-foreground italic">Not set</span>
                                                    )}
                                                </div>
                                            </div>

                                            <Separator className="bg-border/50" />

                                            {/* Subdepartment row */}
                                            <div className="flex items-center gap-3">
                                                <Building2 className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                                                    Subdepartment
                                                </span>
                                                <span className="ml-auto text-xs font-semibold text-foreground dark:text-white">
                                                    {subDepartmentName}
                                                </span>
                                            </div>

                                            <Separator className="bg-border/50" />

                                            {/* Status row */}
                                            <div className="flex items-center gap-3">
                                                <FileText className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                                                    Status
                                                </span>
                                                <span className="ml-auto text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                                    DRAFT
                                                </span>
                                            </div>

                                            <Separator className="bg-border/50" />

                                            {/* Shifts found row */}
                                            <div className="flex items-center gap-3">
                                                <CalendarCheck className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                                                    Shifts found
                                                </span>
                                                <span className="ml-auto text-xs font-semibold text-foreground dark:text-white">
                                                    {previewLoading ? (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : previewCount === null ? (
                                                        <span className="text-muted-foreground italic text-[11px]">—</span>
                                                    ) : (
                                                        <span className={previewCount === 0 ? 'text-red-500' : ''}>{previewCount}</span>
                                                    )}
                                                </span>
                                            </div>

                                            <Separator className="bg-border/50" />

                                            {/* Assignment strip note */}
                                            <div className="flex items-start gap-3 pt-1">
                                                <Info className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
                                                <p className="text-[10px] font-medium text-muted-foreground/60 leading-snug">
                                                    Employee assignments will be stripped. The template will be saved as a draft — publish manually from the Templates page.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Template name input */}
                                    <div className="space-y-3">
                                        <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                            Template Name
                                        </Label>
                                        <Input
                                            value={templateName}
                                            onChange={(e) => {
                                                setTemplateName(e.target.value);
                                                setNameDirty(true);
                                            }}
                                            placeholder="e.g. ICU Pattern Mar 1–7"
                                            className={cn(
                                                'bg-background border-border text-foreground dark:bg-black/60 dark:border-white/5 dark:text-white focus:ring-primary/40 rounded-xl font-medium text-sm h-12 px-4',
                                                nameError && 'border-red-500/50 focus:ring-red-500/30'
                                            )}
                                        />
                                        {nameError && (
                                            <p
                                                className="text-[10px] font-bold text-red-500 dark:text-red-400 flex items-center gap-1.5 mt-1"
                                            >
                                                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                                                {nameError}
                                            </p>
                                        )}
                                        <p className="text-[10px] text-muted-foreground/50 font-medium">
                                            {templateName.trim().length}/100 characters
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ============================================================
                        RIGHT PANE — CONFIRM
                        ============================================================ */}
                    <div className="w-full md:w-[300px] border-l border-border flex flex-col bg-muted/30">
                        <div className="p-10 pb-8">
                            <div className="flex items-center gap-4 mb-10">
                                <div className="h-10 w-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                    <Camera className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div className="flex flex-col">
                                    <h2 className="text-md font-black text-foreground tracking-tight leading-none uppercase tracking-widest text-xs opacity-80">
                                        Capture
                                    </h2>
                                </div>
                            </div>

                            <Separator className="bg-border" />
                        </div>

                        <div className="flex-1 overflow-y-auto px-8 pb-10 flex flex-col gap-6 custom-scrollbar">

                        {successResult ? (
                            /* ---- SUCCESS STATE ---- */
                            <div
                                className="flex flex-col items-center justify-center text-center py-10 gap-6"
                            >
                                <div className="h-20 w-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-inner">
                                    <Check className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div className="space-y-2">
                                    <p className="text-lg font-black text-foreground tracking-tight">
                                        Template captured!
                                    </p>
                                    <p className="text-sm text-muted-foreground font-medium">
                                        <span className="font-black text-foreground dark:text-white">
                                            {successResult.shiftsCaptured}
                                        </span>{' '}
                                        shift{successResult.shiftsCaptured !== 1 ? 's' : ''} saved as draft.
                                    </p>
                                    <p className="text-[11px] text-muted-foreground/70 font-medium mt-1">
                                        Visit Templates to publish it.
                                    </p>
                                </div>
                                <Button
                                    onClick={() => { navigate('/templates'); onOpenChange(false); }}
                                    variant="outline"
                                    className="w-full h-12 rounded-2xl font-black text-xs uppercase tracking-widest border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                                >
                                    Go to Templates
                                </Button>
                                <Button
                                    onClick={handleClose}
                                    className="w-full h-12 rounded-2xl font-black text-xs uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white border-b-4 border-emerald-700 transition-all active:scale-[0.97]"
                                >
                                    Close
                                </Button>
                            </div>
                        ) : (
                            /* ---- NORMAL STATE ---- */
                            <div
                                className="flex flex-col gap-6"
                            >
                                {/* What will happen summary */}
                                <div className="space-y-3 p-5 rounded-2xl bg-muted/40 border border-border">
                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                        What will happen
                                    </p>
                                    <ul className="space-y-2">
                                        {[
                                            'Shifts in the selected range will be read from the roster.',
                                            'Employee assignments will be stripped from all shifts.',
                                            'A new template will be created in DRAFT status.',
                                            'No existing roster data will be modified.',
                                        ].map((line, i) => (
                                            <li key={i} className="flex items-start gap-2">
                                                <div className="h-1.5 w-1.5 rounded-full bg-primary/60 mt-1.5 flex-shrink-0" />
                                                <span className="text-[11px] font-medium text-muted-foreground leading-snug">
                                                    {line}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                {/* Inline errors */}
                                {error && (
                                    <div
                                        className="flex items-start gap-3 p-4 bg-red-500/5 border border-red-500/20 rounded-2xl text-red-600 dark:text-red-400"
                                    >
                                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                        <span className="text-[11px] font-bold leading-snug">{error}</span>
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <Button
                                        onClick={handleSnap}
                                        disabled={!canSubmit}
                                        className={cn(
                                            'w-full h-16 rounded-[1.5rem] font-black text-md uppercase tracking-[0.2em] transition-all relative overflow-hidden active:scale-[0.97]',
                                            canSubmit
                                                ? 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 border-b-4 border-primary/20'
                                                : 'bg-muted text-muted-foreground cursor-not-allowed border-border'
                                        )}
                                    >
                                        {snapMutation.isPending ? (
                                            <div className="flex items-center gap-3">
                                                <Loader2 className="h-5 w-5 animate-spin" />
                                                <span>Capturing...</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-3">
                                                <Camera className="h-5 w-5" />
                                                <span>Snap Template</span>
                                            </div>
                                        )}
                                    </Button>

                                    {previewCount === 0 && !previewLoading && (
                                        <p className="text-[10px] text-center text-red-500 font-black uppercase tracking-[0.1em] px-4 animate-in fade-in slide-in-from-top-1">
                                            No shifts found in selected range
                                        </p>
                                    )}
                                </div>

                                {/* Cancel */}
                                <Button
                                    variant="ghost"
                                    onClick={handleClose}
                                    className="w-full h-12 rounded-2xl font-black text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                                >
                                    Cancel
                                </Button>
                            </div>
                        )}
                        </div>

                        {/* Footer hint */}
                        {!successResult && (
                            <div className="p-8 pt-4 border-t border-border bg-muted/50">
                                <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10">
                                    <div className="flex gap-3">
                                        <Info className="h-3.5 w-3.5 text-emerald-600/60 dark:text-emerald-400/60 flex-shrink-0 mt-0.5" />
                                        <p className="text-[10px] font-bold text-muted-foreground/60 leading-tight uppercase tracking-tight">
                                            The captured template will be saved as draft and must be published manually.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </DialogContent>
        </Dialog>
    );
};

export default SnapFromRosterDialog;
