import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Label } from '@/modules/core/ui/primitives/label';
import { Plus, Building2, Users, ChevronRight, Shield, Loader2, AlertTriangle, User, UserCheck, Crown, Globe, Pencil, Lock, Zap, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { CommandSelector } from './CommandSelector';
import { AccessLevel, CertificateType } from '@/platform/auth/types';
import { useReferenceData } from '../hooks/useReferenceData';
import { supabase } from '@/platform/supabase/client';

interface AccessCertificateDialogProps {
    employeeId: string;
    employeeName: string;
    existingCertificates: { id: string; access_level: string; certificate_type?: string; is_active?: boolean }[];
    certificateToEdit?: {
        id: string;
        access_level: string;
        certificate_type?: string | null;
        organization_id?: string | null;
        department_id?: string | null;
        sub_department_id?: string | null;
    } | null;
    trigger?: React.ReactNode;
    onSuccess?: () => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

// =============================================
// Access Level Configs (grouped by certificate type)
// =============================================

const TYPE_X_LEVELS: { level: AccessLevel; label: string; description: string; icon: React.ReactNode }[] = [
    {
        level: 'alpha',
        label: 'Alpha (Employee)',
        description: 'View own data only',
        icon: <User className="w-4 h-4 text-muted-foreground" />,
    },
    {
        level: 'beta',
        label: 'Beta (Team Lead)',
        description: 'View timesheets & basic team data',
        icon: <UserCheck className="w-4 h-4 text-blue-400" />,
    },
];

const TYPE_Y_LEVELS: { level: AccessLevel; label: string; description: string; icon: React.ReactNode }[] = [
    {
        level: 'gamma',
        label: 'Gamma (Sub-Dept Manager)',
        description: 'Manage specific sub-department operations',
        icon: <Building2 className="w-4 h-4 text-purple-400" />,
    },
    {
        level: 'delta',
        label: 'Delta (Dept Manager)',
        description: 'Full department oversight',
        icon: <Crown className="w-4 h-4 text-amber-400" />,
    },
    {
        level: 'epsilon',
        label: 'Epsilon (Org Admin)',
        description: 'Full organization access',
        icon: <Globe className="w-4 h-4 text-emerald-400" />,
    },
    {
        level: 'zeta',
        label: 'Zeta (Super Admin)',
        description: 'Unrestricted global access across all organizations',
        icon: <Zap className="w-4 h-4 text-rose-400" />,
    },
];

// Combined for backward compat lookup
const ACCESS_LEVEL_CONFIG: Record<AccessLevel, { label: string; description: string; icon: React.ReactNode }> = {
    alpha: TYPE_X_LEVELS[0],
    beta: TYPE_X_LEVELS[1],
    gamma: TYPE_Y_LEVELS[0],
    delta: TYPE_Y_LEVELS[1],
    epsilon: TYPE_Y_LEVELS[2],
    zeta: TYPE_Y_LEVELS[3],
};

export const AccessCertificateDialog: React.FC<AccessCertificateDialogProps> = ({
    employeeId,
    employeeName,
    existingCertificates,
    certificateToEdit,
    trigger,
    onSuccess,
    open: controlledOpen,
    onOpenChange: setControlledOpen
}) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = isControlled ? setControlledOpen! : setInternalOpen;

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Determines if we are in Edit Mode
    const isEditMode = !!certificateToEdit;

    // Local Form State
    const [certificateType, setCertificateType] = useState<CertificateType>('X');
    const [accessLevel, setAccessLevel] = useState<AccessLevel>('alpha');
    const [organizationId, setOrganizationId] = useState<string>('');
    const [departmentId, setDepartmentId] = useState<string>('');
    const [subDepartmentId, setSubDepartmentId] = useState<string>('');

    // Check if user already has an active Type Y certificate
    const hasExistingTypeY = useMemo(() => {
        return existingCertificates.some(c =>
            (c.certificate_type === 'Y' || ['gamma', 'delta', 'epsilon', 'zeta'].includes(c.access_level)) &&
            c.is_active !== false &&
            c.id !== certificateToEdit?.id
        );
    }, [existingCertificates, certificateToEdit]);

    // Pre-fill form on open/change of certificateToEdit
    useEffect(() => {
        if (open && certificateToEdit) {
            const certType = certificateToEdit.certificate_type as CertificateType ||
                (['alpha', 'beta'].includes(certificateToEdit.access_level) ? 'X' : 'Y');
            setCertificateType(certType);
            setAccessLevel(certificateToEdit.access_level as AccessLevel);
            setOrganizationId(certificateToEdit.organization_id || '');
            setDepartmentId(certificateToEdit.department_id || '');
            setSubDepartmentId(certificateToEdit.sub_department_id || '');
        } else if (open && !certificateToEdit) {
            setCertificateType('X');
            setAccessLevel('alpha');
            setOrganizationId('');
            setDepartmentId('');
            setSubDepartmentId('');
        }
    }, [open, certificateToEdit]);

    // Reset access level when type changes
    useEffect(() => {
        if (certificateType === 'X' && !['alpha', 'beta'].includes(accessLevel)) {
            setAccessLevel('alpha');
        } else if (certificateType === 'Y' && !['gamma', 'delta', 'epsilon', 'zeta'].includes(accessLevel)) {
            setAccessLevel('gamma');
        }
    }, [certificateType]);

    // Hooks
    const {
        organizations, departments, subDepartments,
        isLoading: isLoadingRefs, loadReferenceData
    } = useReferenceData(open);

    useEffect(() => {
        if (open) loadReferenceData();
    }, [open]);

    // Filtered options based on form selection
    const filteredDepartments = departments.filter(d => d.organization_id === organizationId);
    const filteredSubDepartments = subDepartments.filter(sd => sd.department_id === departmentId);

    // Reset subordinate fields when parent changes
    const updateOrganization = (val: string) => {
        setOrganizationId(val);
        setDepartmentId('');
        setSubDepartmentId('');
    };

    const updateDepartment = (val: string) => {
        setDepartmentId(val);
        setSubDepartmentId('');
    };

    // Scope requirements per level (per PRD §5.3)
    // Zeta → org, dept, subdept must be null (all global)
    // Epsilon → org required, dept/subdept null (all depts/subdepts)
    // Delta → org+dept required, subdept null (all subdepts)
    // Gamma, Alpha, Beta → all required
    const needsOrganization = accessLevel !== 'zeta';
    const needsDepartment = ['alpha', 'beta', 'gamma', 'delta'].includes(accessLevel);
    const needsSubDepartment = ['alpha', 'beta', 'gamma'].includes(accessLevel);

    // Available levels based on certificate type
    const availableLevels = certificateType === 'X' ? TYPE_X_LEVELS : TYPE_Y_LEVELS;

    const handleSubmit = async () => {
        // 1. Type Y uniqueness
        if (certificateType === 'Y' && hasExistingTypeY) {
            setError('User already has an active Type Y (Managerial) certificate. Only one is allowed.');
            return;
        }

        // 2. Required fields
        if (needsOrganization && !organizationId) {
            setError('Organization is required.');
            return;
        }
        if (needsDepartment && !departmentId) {
            setError('Department is required for this access level.');
            return;
        }
        if (needsSubDepartment && !subDepartmentId) {
            setError('Sub-Department is required for this access level.');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const payload = {
                user_id: employeeId,
                certificate_type: certificateType,
                access_level: accessLevel,
                organization_id: needsOrganization ? organizationId : null,
                department_id: needsDepartment ? departmentId : null,
                sub_department_id: needsSubDepartment ? subDepartmentId : null,
            };

            let errorResult;

            if (isEditMode && certificateToEdit) {
                const { error } = await supabase
                    .from('app_access_certificates')
                    .update(payload)
                    .eq('id', certificateToEdit.id);
                errorResult = error;
            } else {
                const { error } = await supabase
                    .from('app_access_certificates')
                    .insert(payload);
                errorResult = error;
            }

            if (errorResult) throw errorResult;

            setOpen(false);
            if (onSuccess) onSuccess();
        } catch (err: any) {
            console.error('Failed to save certificate:', err);
            setError(err.message || 'Failed to save certificate');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => loadReferenceData()} 
                        className="bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/20 text-emerald-500 transition-all duration-300"
                    >
                        <Shield className="w-4 h-4 mr-2" />
                        Add Certificate
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-xl bg-[#0b0e14]/95 border-border/40 text-foreground shadow-2xl backdrop-blur-2xl rounded-[2rem] overflow-hidden p-0">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
                
                <div className="p-8 pb-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
                    <DialogHeader className="mb-6">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 shadow-inner">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-bold tracking-tight">
                                    {isEditMode ? 'Edit Access Certificate' : 'Add Access Certificate'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground/60">
                                    {isEditMode ? 'Update' : 'Grant'} system permissions for {employeeName}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="flex flex-col gap-6 py-2 relative">
                        {/* Progress Line */}
                        <div className="absolute left-6 top-8 bottom-8 w-[1px] bg-gradient-to-b from-emerald-500/50 via-emerald-500/20 to-transparent opacity-20 pointer-events-none" />

                        {/* 1. Certificate Type */}
                        <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-3"
                        >
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold ml-1">
                                Certificate Type
                            </Label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setCertificateType('X')}
                                    className={cn(
                                        "group p-4 rounded-2xl border text-left transition-all duration-300 relative overflow-hidden",
                                        certificateType === 'X'
                                            ? "border-blue-500/40 bg-blue-500/10 shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)]"
                                            : "border-border/40 bg-muted/5 hover:bg-muted/10 hover:border-border/60"
                                    )}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className={cn(
                                            "p-1.5 rounded-lg transition-colors",
                                            certificateType === 'X' ? "bg-blue-500/20 text-blue-400" : "bg-muted/50 text-muted-foreground"
                                        )}>
                                            <User className="w-4 h-4" />
                                        </div>
                                        <span className="font-bold text-sm">Type X</span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground/60 font-medium">Individual access to own data</p>
                                    {certificateType === 'X' && (
                                        <motion.div layoutId="cert-glow" className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
                                    )}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => (!hasExistingTypeY || isEditMode) && setCertificateType('Y')}
                                    disabled={hasExistingTypeY && !isEditMode}
                                    className={cn(
                                        "group p-4 rounded-2xl border text-left transition-all duration-300 relative overflow-hidden",
                                        certificateType === 'Y'
                                            ? "border-purple-500/40 bg-purple-500/10 shadow-[0_0_20px_-5px_rgba(168,85,247,0.3)]"
                                            : hasExistingTypeY && !isEditMode
                                                ? "opacity-40 cursor-not-allowed border-dashed grayscale"
                                                : "border-border/40 bg-muted/5 hover:bg-muted/10 hover:border-border/60"
                                    )}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className={cn(
                                            "p-1.5 rounded-lg transition-colors",
                                            certificateType === 'Y' ? "bg-purple-500/20 text-purple-400" : "bg-muted/50 text-muted-foreground"
                                        )}>
                                            <Crown className="w-4 h-4" />
                                        </div>
                                        <span className="font-bold text-sm">Type Y</span>
                                        {hasExistingTypeY && !isEditMode && <Lock className="w-3 h-3 text-amber-500/60 ml-auto" />}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground/60 font-medium">
                                        {hasExistingTypeY && !isEditMode ? 'Already assigned' : 'Administrative data scope'}
                                    </p>
                                    {certificateType === 'Y' && (
                                        <motion.div layoutId="cert-glow" className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />
                                    )}
                                </button>
                            </div>
                        </motion.div>

                        {/* 2. Access Level */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                        >
                            <div className="space-y-2">
                                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold ml-1">
                                    Access Level
                                </Label>
                                <Select value={accessLevel} onValueChange={(val) => setAccessLevel(val as AccessLevel)}>
                                    <SelectTrigger className="h-14 bg-muted/10 border-border/40 rounded-2xl hover:bg-muted/20 hover:border-emerald-500/30 transition-all duration-300">
                                        <div className="flex items-center gap-3">
                                            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                                                {ACCESS_LEVEL_CONFIG[accessLevel]?.icon}
                                            </div>
                                            <div className="flex flex-col text-left">
                                                <span className="font-bold text-sm">{ACCESS_LEVEL_CONFIG[accessLevel]?.label}</span>
                                                <span className="text-[10px] text-muted-foreground/60">{ACCESS_LEVEL_CONFIG[accessLevel]?.description}</span>
                                            </div>
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#0b0e14] border-border/40 rounded-2xl p-1 backdrop-blur-xl">
                                        {availableLevels.map(({ level, label, description, icon }) => (
                                            <SelectItem 
                                                key={level} 
                                                value={level} 
                                                className="rounded-xl py-3 focus:bg-emerald-500/10 focus:text-emerald-400 transition-all cursor-pointer"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="p-1.5 rounded-lg bg-muted/50">{icon}</div>
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-sm">{label}</span>
                                                        <span className="text-[10px] opacity-60">{description}</span>
                                                    </div>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </motion.div>

                        {/* 3. Organization */}
                        <AnimatePresence mode="wait">
                            {needsOrganization ? (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, y: 10 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    exit={{ opacity: 0, height: 0, y: 10 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <CommandSelector
                                        label="Organization"
                                        placeholder="Select organization"
                                        value={organizationId}
                                        options={organizations}
                                        onValueChange={updateOrganization}
                                        icon={<Building2 className="w-5 h-5" />}
                                    />
                                </motion.div>
                            ) : (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 flex items-center gap-3"
                                >
                                    <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                                        <Globe className="w-4 h-4" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] uppercase font-black tracking-widest text-emerald-500/60">Global Scope</span>
                                        <span className="text-sm font-bold text-emerald-400">Unrestricted Access (All Organizations)</span>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 4. Department */}
                        <AnimatePresence>
                            {needsDepartment && organizationId && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, y: 10 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    exit={{ opacity: 0, height: 0, y: 10 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <CommandSelector
                                        label="Department"
                                        placeholder="Select department"
                                        value={departmentId}
                                        options={filteredDepartments}
                                        onValueChange={updateDepartment}
                                        icon={<Users className="w-5 h-5" />}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 5. Sub-Department */}
                        <AnimatePresence>
                            {needsSubDepartment && departmentId && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, y: 10 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    exit={{ opacity: 0, height: 0, y: 10 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <CommandSelector
                                        label="Sub-Department"
                                        placeholder="Select sub-department"
                                        value={subDepartmentId}
                                        options={filteredSubDepartments}
                                        onValueChange={setSubDepartmentId}
                                        icon={<ChevronRight className="w-5 h-5" />}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {error && (
                            <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-400 text-sm font-medium"
                            >
                                <AlertTriangle className="w-5 h-5 shrink-0" />
                                {error}
                            </motion.div>
                        )}
                    </div>
                </div>

                <div className="p-8 pt-4 bg-muted/20 border-t border-border/20">
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
                            disabled={isSubmitting || isLoadingRefs}
                            className={cn(
                                "rounded-xl px-8 transition-all duration-500 font-bold shadow-lg shadow-emerald-500/20",
                                isSubmitting ? "bg-muted-foreground/20" : "bg-emerald-600 hover:bg-emerald-500 active:scale-95"
                            )}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Synchronizing...
                                </>
                            ) : (
                                <span className="flex items-center gap-2">
                                    {isEditMode ? <Pencil className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                                    {isEditMode ? 'Update Access' : 'Grant Access'}
                                </span>
                            )}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
};
