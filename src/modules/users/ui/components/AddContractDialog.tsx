import React, { useState } from 'react'; // Re-triggering build
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { Plus, Building2, Users, ChevronRight, Briefcase, DollarSign, Loader2, Sparkles, CheckCircle2, Pencil, Clock, GraduationCap, Award, School, BookOpen, Trophy, Info, Accessibility, Scale, CalendarClock } from 'lucide-react';
import { useReferenceData } from '../hooks/useReferenceData';
import { useContractForm } from '../hooks/useContractForm';
import { CommandSelector } from './CommandSelector';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { supabase } from '@/platform/supabase/client';
import { Input } from '@/modules/core/ui/primitives/input';

interface AddContractDialogProps {
    employeeId: string;
    employeeName: string;
    existingContract?: {
        id: string;
        organization_id?: string | null;
        department_id?: string | null;
        sub_department_id?: string | null;
        role_id: string;
        rem_level_id?: string | null;
        employment_status?: string | null;
    };
    onSuccess?: () => void;
}

export const AddContractDialog: React.FC<AddContractDialogProps> = ({ employeeId, employeeName, existingContract, onSuccess }) => {
    const [open, setOpen] = useState(false);

    // Hooks
    const {
        organizations, departments, subDepartments, roles, remLevels,
        isLoading: isLoadingRefs, loadReferenceData
    } = useReferenceData(open);

    const {
        formData, isSubmitting, updateField, updateRole, submit, setFormData
    } = useContractForm(employeeId, () => {
        setOpen(false);
        if (onSuccess) onSuccess();
    });

    // Determines if we are in Edit Mode
    const isEditMode = !!existingContract;

    // Pre-fill form when editing
    React.useEffect(() => {
        if (open && existingContract) {
            setFormData({
                organization_id: existingContract.organization_id || '',
                department_id: existingContract.department_id || '',
                sub_department_id: existingContract.sub_department_id || '',
                role_id: existingContract.role_id,
                rem_level_id: existingContract.rem_level_id || '',
                employment_status: (existingContract.employment_status as any) || 'Casual',
                contracted_weekly_hours: (existingContract as any).contracted_weekly_hours || 0,
                is_apprentice: (existingContract as any).is_apprentice || false,
                apprentice_type: (existingContract as any).apprentice_type || 'standard',
                apprentice_year: (existingContract as any).apprentice_year || 1,
                has_completed_year_12: (existingContract as any).has_completed_year_12 || false,
                is_trainee: (existingContract as any).is_trainee || false,
                trainee_category: (existingContract as any).trainee_category || 'junior',
                trainee_level: (existingContract as any).trainee_level || 'A',
                trainee_exit_year: (existingContract as any).trainee_exit_year || 12,
                trainee_years_out: (existingContract as any).trainee_years_out || 0,
                trainee_aqf_level: (existingContract as any).trainee_aqf_level || 3,
                trainee_year: (existingContract as any).trainee_year || 1,
                is_training_on_job: (existingContract as any).is_training_on_job || false,
                prefers_sba_loading: (existingContract as any).prefers_sba_loading || false,
                is_sws: (existingContract as any).is_sws || false,
                sws_capacity_percentage: (existingContract as any).sws_capacity_percentage || 50,
                is_sws_trial: (existingContract as any).is_sws_trial || false,
                sws_trial_start_date: (existingContract as any).sws_trial_start_date || '',
                annual_guaranteed_hours: (existingContract as any).annual_guaranteed_hours || 0
            });
        } else if (open && !existingContract) {
            setFormData({
                organization_id: '',
                department_id: '',
                sub_department_id: '',
                role_id: '',
                rem_level_id: '',
                employment_status: '',
                contracted_weekly_hours: 0,
                annual_guaranteed_hours: 0,
                is_apprentice: false,
                apprentice_type: 'standard',
                apprentice_year: 1,
                has_completed_year_12: false,
                is_trainee: false,
                trainee_category: 'junior',
                trainee_level: 'A',
                trainee_exit_year: 12,
                trainee_years_out: 0,
                trainee_aqf_level: 3,
                trainee_year: 1,
                is_training_on_job: false,
                prefers_sba_loading: false,
                is_sws: false,
                sws_capacity_percentage: 50,
                is_sws_trial: false,
                sws_trial_start_date: ''
            });
        }
    }, [open, existingContract, setFormData]);

    // Filtered options based on form selection
    const filteredDepartments = departments.filter(d => d.organization_id === formData.organization_id);
    const filteredSubDepartments = subDepartments.filter(sd => sd.department_id === formData.department_id);
    
    // Clean role names (remove L0, L1 redundancy)
    const cleanRoleName = (name: string) => name.replace(/\s*\(L\d+\)$/i, '').trim();
    
    const filteredRoles = roles
        .filter(r => r.sub_department_id === formData.sub_department_id)
        .map(r => ({ ...r, name: cleanRoleName(r.name) }));

    const handleSubmit = async () => {
        if (isEditMode) {
            // Implement update logic here or in useContractForm
            const { error } = await supabase
                .from('user_contracts')
                .update({
                    organization_id: formData.organization_id,
                    department_id: formData.department_id,
                    sub_department_id: formData.sub_department_id,
                    role_id: formData.role_id,
                    rem_level_id: formData.rem_level_id,
                    employment_status: formData.employment_status as any,
                    contracted_weekly_hours: formData.contracted_weekly_hours,
                    is_apprentice: formData.is_apprentice,
                    apprentice_type: formData.apprentice_type,
                    apprentice_year: formData.apprentice_year,
                    has_completed_year_12: formData.has_completed_year_12,
                    is_trainee: formData.is_trainee,
                    trainee_category: formData.trainee_category,
                    trainee_level: formData.trainee_level,
                    trainee_exit_year: formData.trainee_exit_year,
                    trainee_years_out: formData.trainee_years_out,
                    trainee_aqf_level: formData.trainee_aqf_level,
                    trainee_year: formData.trainee_year,
                    is_training_on_job: formData.is_training_on_job,
                    prefers_sba_loading: formData.prefers_sba_loading,
                    is_sws: formData.is_sws,
                    sws_capacity_percentage: formData.sws_capacity_percentage,
                    is_sws_trial: formData.is_sws_trial,
                    sws_trial_start_date: formData.sws_trial_start_date || null,
                    annual_guaranteed_hours: formData.annual_guaranteed_hours
                })
                .eq('id', existingContract!.id);
            
            if (error) {
                console.error('Update error:', error);
                return;
            }
            setOpen(false);
            if (onSuccess) onSuccess();
        } else {
            await submit();
        }
    };

    // Sequential unlocking logic
    const isOrgSelected = !!formData.organization_id;
    const isDeptSelected = !!formData.department_id;
    const isSubDeptSelected = !!formData.sub_department_id;
    const isRoleSelected = !!formData.role_id;

    const selectedRole = roles.find(r => r.id === formData.role_id);
    const selectedRemLevel = remLevels.find(rl => rl.id === formData.rem_level_id);
    const isRemLocked = !!formData.role_id && !!selectedRole?.remuneration_level_id;

    // Auto-populate remuneration level when role changes
    React.useEffect(() => {
        if (formData.role_id && !formData.rem_level_id) {
            const role = roles.find(r => r.id === formData.role_id);
            if (role?.remuneration_level_id) {
                updateField('rem_level_id', role.remuneration_level_id);
            }
        }
    }, [formData.role_id, roles, formData.rem_level_id, updateField]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button 
                    variant="outline" 
                    size="sm" 
                    className={cn(
                        "transition-all duration-300",
                        isEditMode 
                            ? "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary" 
                            : "ml-auto bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary"
                    )}
                    onClick={() => loadReferenceData()}
                >
                    {isEditMode ? (
                        <Pencil className="w-4 h-4" />
                    ) : (
                        <>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Contract
                        </>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl h-auto flex flex-col bg-background/95 border-border/40 text-foreground shadow-2xl backdrop-blur-2xl rounded-[2rem] overflow-hidden p-0">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
                
                <div className="p-8 pb-4 flex-shrink-0">
                    <DialogHeader className="mb-6">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-xl bg-primary/10 text-primary shadow-inner">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-bold tracking-tight">
                                    {isEditMode ? 'Edit Contract' : 'Add Contract'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground/60">
                                    {isEditMode ? 'Update existing' : 'Create a new'} organizational role for {employeeName}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 overflow-visible relative">
                        {/* Vertical Divider for Desktop */}
                        <div className="hidden md:block absolute left-1/2 top-4 bottom-4 w-[1px] bg-border/40 -translate-x-1/2" />

                        {/* Left Column: Primary Selection */}
                        <div className="flex flex-col gap-6">
                            {/* 1. Organization */}
                            <CommandSelector
                                label="Organization"
                                placeholder="Select organization"
                                value={formData.organization_id}
                                options={organizations.map(o => ({ id: o.id, name: o.name }))}
                                onValueChange={(val) => {
                                    updateField('organization_id', val);
                                    updateField('department_id', '');
                                    updateField('sub_department_id', '');
                                    updateField('role_id', '');
                                }}
                                icon={<Building2 className="w-5 h-5" />}
                            />

                            {/* 2. Department */}
                            <AnimatePresence mode="wait">
                                {isOrgSelected && (
                                    <motion.div
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        <CommandSelector
                                            label="Department"
                                            placeholder="Select department"
                                            value={formData.department_id}
                                            options={filteredDepartments.map(d => ({ id: d.id, name: d.name }))}
                                            onValueChange={(val) => {
                                                updateField('department_id', val);
                                                updateField('sub_department_id', '');
                                                updateField('role_id', '');
                                            }}
                                            icon={<Users className="w-5 h-5" />}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* 3. Sub-Department */}
                            <AnimatePresence mode="wait">
                                {isDeptSelected && (
                                    <motion.div
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        <CommandSelector
                                            label="Sub-Department"
                                            placeholder="Select sub-department"
                                            value={formData.sub_department_id}
                                            options={filteredSubDepartments.map(sd => ({ id: sd.id, name: sd.name }))}
                                            onValueChange={(val) => {
                                                updateField('sub_department_id', val);
                                                updateField('role_id', '');
                                            }}
                                            icon={<ChevronRight className="w-5 h-5" />}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* 4. Role */}
                            <AnimatePresence mode="wait">
                                {isSubDeptSelected && (
                                    <motion.div
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        <CommandSelector
                                            label="Position / Role"
                                            placeholder="Select role"
                                            value={formData.role_id}
                                            options={filteredRoles.map(r => ({ id: r.id, name: r.name }))}
                                            onValueChange={(val) => {
                                            const role = roles.find(r => r.id === val);
                                            updateRole(val, role?.remuneration_level_id);
                                        }}
                                            icon={<Briefcase className="w-5 h-5" />}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                        {/* 5. Remuneration & Employment */}
                        <AnimatePresence>
                            {isRoleSelected && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, y: 10 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
                                    className="flex flex-col gap-6"
                                >
                                    <div className="grid grid-cols-2 gap-4 mt-2 p-4 rounded-2xl bg-primary/5 border border-primary/10 shadow-inner">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold flex items-center gap-1.5">
                                                <DollarSign className="w-3 h-3" /> Remuneration
                                            </Label>
                                            <div className="text-sm font-semibold text-primary/90 flex items-center gap-2">
                                                {selectedRemLevel ? (
                                                    <>
                                                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-xs">L{selectedRemLevel.level_number}</span>
                                                        <span>{selectedRemLevel.level_name}</span>
                                                    </>
                                                ) : '—'}
                                            </div>
                                        </div>
                                        <div className="space-y-1 border-l border-border/40 pl-4">
                                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold flex items-center gap-1.5">
                                                <Briefcase className="w-3 h-3" /> Selection Type
                                            </Label>
                                            <div className="text-sm font-semibold text-primary/90 flex items-center gap-2">
                                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                                {formData.employment_status || '—'}
                                            </div>
                                        </div>
                                    </div>

                                    <CommandSelector
                                        label="Change Employment Type"
                                        placeholder="Select type"
                                        value={formData.employment_status}
                                        options={[
                                            { id: 'Full-Time', name: 'Full-Time' },
                                            { id: 'Part-Time', name: 'Part-Time' },
                                            { id: 'Casual', name: 'Casual' },
                                            { id: 'Flexible Part-Time', name: 'Flexible Part-Time' }
                                        ]}
                                        onValueChange={(val) => updateField('employment_status', val)}
                                        icon={<Briefcase className="w-5 h-5" />}
                                    />

                                    {(formData.employment_status === 'Full-Time' || formData.employment_status === 'Part-Time' || formData.employment_status === 'Flexible Part-Time') && (
                                        <motion.div
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="p-4 rounded-2xl bg-primary/5 border border-primary/10 shadow-inner space-y-3"
                                        >
                                            <div className="flex items-center justify-between">
                                                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold flex items-center gap-1.5">
                                                    <Clock className="w-3 h-3" /> 
                                                    {formData.employment_status === 'Flexible Part-Time' ? 'Annual Guaranteed Hours' : 'Contracted Weekly Hours'}
                                                </Label>
                                                <span className="text-[10px] font-mono text-primary/40 italic">
                                                    {formData.employment_status === 'Full-Time' ? 'EA Standard: 38h' : 
                                                     formData.employment_status === 'Flexible Part-Time' ? 'EA Standard: 624h' : 'EA Standard: 20h+'}
                                                </span>
                                            </div>
                                            <div className="relative group">
                                                <Input
                                                    type="number"
                                                    value={formData.employment_status === 'Flexible Part-Time' ? formData.annual_guaranteed_hours : formData.contracted_weekly_hours}
                                                    onChange={(e) => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        if (formData.employment_status === 'Flexible Part-Time') {
                                                            updateField('annual_guaranteed_hours', val);
                                                        } else {
                                                            updateField('contracted_weekly_hours', val);
                                                        }
                                                    }}
                                                    className="bg-muted/40 border-primary/20 focus:border-primary/50 text-lg font-bold text-primary pl-4 h-12 rounded-xl transition-all"
                                                />
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/40 font-medium">
                                                    {formData.employment_status === 'Flexible Part-Time' ? 'hours / year' : 'hours / week'}
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Right Column: Special Configurations */}
                    <div className="flex flex-col gap-6">
                        <div className={cn(
                            "p-4 rounded-2xl border transition-all h-fit",
                            formData.is_apprentice ? "bg-indigo-500/10 border-indigo-500/30" : "bg-muted/5 border-border/40"
                        )}>
                            <div className="flex items-center justify-between group cursor-pointer" onClick={() => updateField('is_apprentice', !formData.is_apprentice)}>
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "p-2 rounded-xl transition-all",
                                        formData.is_apprentice ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "bg-muted text-muted-foreground"
                                    )}>
                                        <GraduationCap className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className={cn("text-sm font-bold", formData.is_apprentice ? "text-indigo-600 dark:text-indigo-100" : "text-foreground")}>Apprentice Mode</p>
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-tighter">Schedule 4 Wage Alignment</p>
                                    </div>
                                </div>
                                <div className={cn(
                                    "w-10 h-5 rounded-full relative transition-all duration-300",
                                    formData.is_apprentice ? "bg-indigo-500" : "bg-muted"
                                )}>
                                    <motion.div 
                                        animate={{ x: formData.is_apprentice ? 20 : 2 }}
                                        className="absolute top-1 left-0 w-3 h-3 bg-background rounded-full shadow-sm"
                                    />
                                </div>
                            </div>

                            <AnimatePresence>
                                {formData.is_apprentice && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="mt-4 space-y-6 overflow-hidden pl-2 border-l border-indigo-500/20"
                                    >
                                        {/* Apprentice Type */}
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { id: 'standard', name: 'Standard', icon: <Award className="w-4 h-4" /> },
                                                { id: 'adult', name: 'Adult (21+)', icon: <CheckCircle2 className="w-4 h-4" /> },
                                                { id: 'school_based', name: 'School-Based', icon: <School className="w-4 h-4" /> }
                                            ].map((t) => (
                                                <button
                                                    key={t.id}
                                                    onClick={() => updateField('apprentice_type', t.id)}
                                                    className={cn(
                                                        "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center",
                                                        formData.apprentice_type === t.id 
                                                            ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-700 dark:text-indigo-200 shadow-lg shadow-indigo-500/10"
                                                            : "bg-muted/20 border-transparent text-muted-foreground hover:bg-muted/30"
                                                    )}
                                                >
                                                    {t.icon}
                                                    <span className="text-[10px] font-bold">{t.name}</span>
                                                </button>
                                            ))}
                                        </div>

                                        {/* Year and Yr 12 */}
                                        <div className="flex gap-4">
                                            <div className="flex-1 space-y-2">
                                                <Label className="text-[10px] uppercase tracking-widest text-indigo-500/50 font-bold ml-1">Apprenticeship Year</Label>
                                                <div className="flex bg-muted/20 rounded-xl p-1 border border-indigo-500/10">
                                                    {[1, 2, 3, 4].map((y) => (
                                                        <button
                                                            key={y}
                                                            onClick={() => updateField('apprentice_year', y)}
                                                            className={cn(
                                                                "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                                                                formData.apprentice_year === y 
                                                                    ? "bg-indigo-500 text-white shadow-md shadow-indigo-500/20"
                                                                    : "text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-200"
                                                            )}
                                                        >
                                                            Yr {y}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {formData.apprentice_type === 'standard' && (
                                                <div className="space-y-2">
                                                    <Label className="text-[10px] uppercase tracking-widest text-indigo-500/50 font-bold ml-1">Year 12 Completion</Label>
                                                    <button
                                                        onClick={() => updateField('has_completed_year_12', !formData.has_completed_year_12)}
                                                        className={cn(
                                                            "w-full px-4 py-3 rounded-xl border flex items-center justify-between gap-4 transition-all h-[42px]",
                                                            formData.has_completed_year_12
                                                                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-200"
                                                                : "bg-muted/20 border-transparent text-muted-foreground"
                                                        )}
                                                    >
                                                        <span className="text-xs font-bold">Graduated?</span>
                                                        {formData.has_completed_year_12 ? <CheckCircle2 className="w-4 h-4" /> : <div className="w-4 h-4 rounded-full border border-current opacity-20" />}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/10 flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                                            <p className="text-[10px] text-indigo-600/70 dark:text-indigo-200/70 font-medium italic">
                                                {formData.apprentice_type === 'adult' 
                                                    ? "Adult rate: 80% of L4 in Yr 1, Min Adult rate thereafter."
                                                    : formData.apprentice_type === 'school_based'
                                                    ? "SBA: Standard % + 25% loading for training time."
                                                    : "Standard: Base % applied to ICC Sydney Level 4."}
                                            </p>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Trainee Configuration */}
                        <div className={cn(
                            "p-4 rounded-2xl border transition-all h-fit",
                            formData.is_trainee ? "bg-amber-500/10 border-amber-500/30" : "bg-muted/5 border-border/40"
                        )}>
                            <div className="flex items-center justify-between group cursor-pointer" onClick={() => updateField('is_trainee', !formData.is_trainee)}>
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "p-2 rounded-xl transition-all",
                                        formData.is_trainee ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20" : "bg-muted text-muted-foreground"
                                    )}>
                                        <BookOpen className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className={cn("text-sm font-bold", formData.is_trainee ? "text-amber-600 dark:text-amber-100" : "text-foreground")}>Trainee Mode</p>
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-tighter">Schedule 5 Wage Matrix</p>
                                    </div>
                                </div>
                                <div className={cn(
                                    "w-10 h-5 rounded-full relative transition-all duration-300",
                                    formData.is_trainee ? "bg-amber-500" : "bg-muted"
                                )}>
                                    <motion.div 
                                        animate={{ x: formData.is_trainee ? 20 : 2 }}
                                        className="absolute top-1 left-0 w-3 h-3 bg-background rounded-full shadow-sm"
                                    />
                                </div>
                            </div>

                            <AnimatePresence>
                                {formData.is_trainee && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="mt-4 space-y-6 overflow-hidden pl-2 border-l border-amber-500/20"
                                    >
                                        {/* Wage Level A vs B */}
                                        <div className="flex bg-muted/20 rounded-xl p-1 border border-amber-500/10">
                                            <button
                                                onClick={() => updateField('trainee_level', 'A')}
                                                className={cn(
                                                    "flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2",
                                                    formData.trainee_level === 'A' ? "bg-amber-500 text-white shadow-md" : "text-muted-foreground hover:text-amber-600 dark:hover:text-amber-200"
                                                )}
                                            >
                                                Wage Level A
                                                {formData.trainee_level === 'A' && <Trophy className="w-3 h-3" />}
                                            </button>
                                            <button
                                                onClick={() => updateField('trainee_level', 'B')}
                                                className={cn(
                                                    "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                                                    formData.trainee_level === 'B' ? "bg-amber-500 text-white shadow-md" : "text-muted-foreground hover:text-amber-600 dark:hover:text-amber-200"
                                                )}
                                            >
                                                Wage Level B
                                            </button>
                                        </div>

                                        {/* Category Selector */}
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { id: 'junior', name: 'Junior', icon: <GraduationCap className="w-4 h-4" /> },
                                                { id: 'adult', name: 'Adult', icon: <CheckCircle2 className="w-4 h-4" /> },
                                                { id: 'school_based', name: 'SBA', icon: <School className="w-4 h-4" /> }
                                            ].map((c) => (
                                                <button
                                                    key={c.id}
                                                    onClick={() => updateField('trainee_category', c.id)}
                                                    className={cn(
                                                        "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all",
                                                        formData.trainee_category === c.id 
                                                            ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-200"
                                                            : "bg-muted/20 border-transparent text-muted-foreground hover:bg-muted/30"
                                                    )}
                                                >
                                                    {c.icon}
                                                    <span className="text-[10px] font-bold">{c.name}</span>
                                                </button>
                                            ))}
                                        </div>

                                        {/* School Exit Year (Junior) */}
                                        {formData.trainee_category === 'junior' && (
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label className="text-[10px] uppercase tracking-widest text-amber-500/50 font-bold ml-1">Left School At</Label>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {[10, 11, 12].map(y => (
                                                            <button
                                                                key={y}
                                                                onClick={() => updateField('trainee_exit_year', y)}
                                                                className={cn(
                                                                    "py-2 rounded-lg border text-xs font-bold transition-all",
                                                                    formData.trainee_exit_year === y ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-200" : "bg-muted/20 border-transparent text-muted-foreground"
                                                                )}
                                                            >
                                                                Year {y}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between items-center px-1">
                                                        <Label className="text-[10px] uppercase tracking-widest text-amber-500/50 font-bold">Years Since Graduation</Label>
                                                        <span className="text-[10px] font-bold text-amber-500">{formData.trainee_years_out} years</span>
                                                    </div>
                                                    <input 
                                                        type="range" min="0" max="5" step="1" 
                                                        value={formData.trainee_years_out}
                                                        onChange={(e) => updateField('trainee_years_out', parseInt(e.target.value))}
                                                        className="w-full h-1.5 bg-muted/40 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* Adult Years */}
                                        {formData.trainee_category === 'adult' && (
                                            <div className="space-y-2">
                                                <Label className="text-[10px] uppercase tracking-widest text-amber-500/50 font-bold ml-1">Traineeship Year</Label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {[1, 2].map(y => (
                                                        <button
                                                            key={y}
                                                            onClick={() => updateField('trainee_year', y)}
                                                            className={cn(
                                                                "py-2 rounded-lg border text-xs font-bold transition-all",
                                                                formData.trainee_year === y ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-200" : "bg-muted/20 border-transparent text-muted-foreground"
                                                            )}
                                                        >
                                                            {y === 1 ? '1st Year' : '2nd+ Year'}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* AQF Level Selector */}
                                        <div className="space-y-2">
                                            <Label className="text-[10px] uppercase tracking-widest text-amber-500/50 font-bold ml-1">AQF Certificate Level</Label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => updateField('trainee_aqf_level', 3)}
                                                    className={cn(
                                                        "py-2 rounded-lg border text-xs font-bold transition-all",
                                                        formData.trainee_aqf_level === 3 ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-200" : "bg-muted/20 border-transparent text-muted-foreground"
                                                    )}
                                                >
                                                    Level I / II / III
                                                </button>
                                                <button
                                                    onClick={() => updateField('trainee_aqf_level', 4)}
                                                    className={cn(
                                                        "py-2 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-2",
                                                        formData.trainee_aqf_level === 4 ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-200" : "bg-muted/20 border-transparent text-muted-foreground"
                                                    )}
                                                >
                                                    Level IV (+3.8%)
                                                    <Sparkles className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-center gap-3">
                                            <Info className="w-4 h-4 text-amber-400/60" />
                                            <p className="text-[10px] text-amber-600/70 dark:text-amber-200/70 font-medium italic">
                                                {formData.trainee_category === 'junior' 
                                                    ? `Junior Level ${formData.trainee_level}: Rates scaled based on years out of school.`
                                                    : formData.trainee_category === 'school_based'
                                                    ? "SBA: Fixed hourly rate based on current school year (11/12)."
                                                    : "Adult Trainee: First year floor rate applied based on Wage Level."}
                                            </p>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* SWS Configuration */}
                        <div className={cn(
                            "p-4 rounded-2xl border transition-all h-fit",
                            formData.is_sws ? "bg-emerald-500/10 border-emerald-500/30" : "bg-muted/5 border-border/40"
                        )}>
                            <div className="flex items-center justify-between group cursor-pointer" onClick={() => updateField('is_sws', !formData.is_sws)}>
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "p-2 rounded-xl transition-all",
                                        formData.is_sws ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-muted text-muted-foreground"
                                    )}>
                                        <Accessibility className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className={cn("text-sm font-bold", formData.is_sws ? "text-emerald-600 dark:text-emerald-100" : "text-foreground")}>Supported Wage (SWS)</p>
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-tighter">Schedule 6 Compliance</p>
                                    </div>
                                </div>
                                <div className={cn(
                                    "w-10 h-5 rounded-full relative transition-all duration-300",
                                    formData.is_sws ? "bg-emerald-500" : "bg-muted"
                                )}>
                                    <motion.div 
                                        animate={{ x: formData.is_sws ? 20 : 2 }}
                                        className="absolute top-1 left-0 w-3 h-3 bg-background rounded-full shadow-sm"
                                    />
                                </div>
                            </div>

                            <AnimatePresence>
                                {formData.is_sws && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="mt-4 space-y-6 overflow-hidden pl-2 border-l border-emerald-500/20"
                                    >
                                        {/* Capacity Slider */}
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center px-1">
                                                <div className="flex items-center gap-2">
                                                    <Scale className="w-4 h-4 text-emerald-400/60" />
                                                    <Label className="text-[10px] uppercase tracking-widest text-emerald-500/50 font-bold">Assessed Capacity</Label>
                                                </div>
                                                <span className="text-lg font-black text-emerald-400">{formData.sws_capacity_percentage}%</span>
                                            </div>
                                            <div className="relative pt-2">
                                                <input 
                                                    type="range" min="10" max="90" step="10" 
                                                    value={formData.sws_capacity_percentage}
                                                    onChange={(e) => updateField('sws_capacity_percentage', parseInt(e.target.value))}
                                                    className="w-full h-2 bg-muted/40 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                />
                                                <div className="flex justify-between mt-2 px-1 text-[8px] font-bold text-emerald-500/30">
                                                    <span>10%</span>
                                                    <span>30%</span>
                                                    <span>50%</span>
                                                    <span>70%</span>
                                                    <span>90%</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Trial Period */}
                                        <div className="flex gap-4">
                                            <div className="flex-1 space-y-2">
                                                <Label className="text-[10px] uppercase tracking-widest text-emerald-500/50 font-bold ml-1">Trial Period</Label>
                                                <button
                                                    onClick={() => updateField('is_sws_trial', !formData.is_sws_trial)}
                                                    className={cn(
                                                        "w-full px-4 py-3 rounded-xl border flex items-center justify-between gap-4 transition-all h-[48px]",
                                                        formData.is_sws_trial
                                                            ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-200"
                                                            : "bg-muted/20 border-transparent text-muted-foreground"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <CalendarClock className="w-4 h-4" />
                                                        <span className="text-xs font-bold">Trial Active</span>
                                                    </div>
                                                    <div className={cn(
                                                        "w-2 h-2 rounded-full transition-all",
                                                        formData.is_sws_trial ? "bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-muted-foreground/20"
                                                    )} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Info className="w-3 h-3 text-emerald-400" />
                                                <p className="text-[10px] text-emerald-700 dark:text-emerald-100 font-bold uppercase tracking-tight">SWS Wage Guarantee</p>
                                            </div>
                                            <p className="text-[10px] text-emerald-600/60 dark:text-emerald-200/60 font-medium italic leading-relaxed">
                                                Point 24: Absolute minimum payable must not be less than **$90 per week**. 
                                                {formData.is_sws_trial && " Trial period is capped at 12 weeks."}
                                            </p>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                    </div>
                </div>

                <div className="p-8 pt-4 bg-muted/20 border-t border-border/20 flex-shrink-0">
                    <DialogFooter className="gap-3 sm:gap-0">
                        <Button 
                            variant="ghost" 
                            onClick={() => setOpen(false)}
                            className="rounded-xl hover:bg-muted/50 transition-all duration-300"
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleSubmit} 
                            disabled={isSubmitting || isLoadingRefs || !isRoleSelected}
                            className={cn(
                                "rounded-xl px-8 transition-all duration-500 font-bold shadow-lg shadow-primary/20",
                                isRoleSelected ? "bg-primary hover:bg-primary/90 scale-100" : "bg-muted-foreground/20 scale-95 opacity-50"
                            )}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Synchronizing...
                                </>
                            ) : (
                                <span className="flex items-center gap-2">
                                    {isEditMode ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                    {isEditMode ? 'Update Contract' : 'Add Contract'}
                                </span>
                            )}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
};
