// src/components/templates/CreateTemplateDialog.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { cn } from '@/modules/core/lib/utils';
import { useAuth } from '@/platform/auth/useAuth';
import { Plus, FileText, Loader2, AlertCircle, Building2, Factory, Network, ArrowRight } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { validateTemplateName, sanitizeTemplateName } from '@/modules/templates/model/templates.types';
import { format, addMonths, startOfMonth } from 'date-fns';
import { shiftsApi as enhancedShiftService } from '@/modules/rosters';
import { supabase } from '@/platform/supabase/client';

interface CreateTemplateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTemplate: (input: {
    name: string;
    description: string;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
  }) => Promise<void>;
  initialScope?: { organizationId?: string; departmentId?: string; subDepartmentId?: string };
}

const CreateTemplateDialog: React.FC<CreateTemplateDialogProps> = ({
  isOpen,
  onOpenChange,
  onCreateTemplate,
  initialScope,
}) => {
  const [name, setName] = useState('New Template');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');

  // Organization/Department/SubDepartment state
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [subDepartments, setSubDepartments] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [selectedSubDeptId, setSelectedSubDeptId] = useState<string>('');
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
  const [isLoadingDepts, setIsLoadingDepts] = useState(false);
  const [isLoadingSubDepts, setIsLoadingSubDepts] = useState(false);

  // DEBUG: Track Render State (Placed after initialization)
  console.log('[CreateTemplateDialog] RENDER:', { isOpen, selectedOrgId, selectedDeptId, selectedSubDeptId, orgsCount: organizations.length });

  // Generation options (Current month + 24 future months)
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return [currentYear, currentYear + 1, currentYear + 2];
  }, []);

  const { activeContract, user } = useAuth();

  // Check permissions based on certificates (preferred) or active contract (fallback)
  const effectiveScope = useMemo(() => {
    if (!user) return null;

    // 1. Check for High-Level Certificates first
    const epsilonCert = user.certificates?.find(c => c.accessLevel === 'epsilon');
    if (epsilonCert) return { type: 'epsilon', scope: null }; // Global Access

    const deltaCert = user.certificates?.find(c => c.accessLevel === 'delta');
    if (deltaCert) {
      return {
        type: 'delta',
        scope: {
          organizationId: deltaCert.organizationId,
          departmentId: deltaCert.departmentId,
          subDepartmentId: null // Explicitly null to indicate unlocked
        }
      };
    }

    const gammaCert = user.certificates?.find(c => c.accessLevel === 'gamma');
    if (gammaCert) {
      return {
        type: 'gamma',
        scope: {
          organizationId: gammaCert.organizationId,
          departmentId: gammaCert.departmentId,
          subDepartmentId: gammaCert.subDepartmentId
        }
      };
    }

    // 2. Fallback to Active Contract (Legacy/Low Level)
    if (activeContract) {
      // Treating Admin contract as Epsilon equivalent for legacy support
      if (activeContract.userId === 'admin') return { type: 'epsilon', scope: null };
      // Treat Delta contract
      if (activeContract.accessLevel === 'delta') {
        return {
          type: 'delta',
          scope: {
            organizationId: activeContract.organizationId,
            departmentId: activeContract.departmentId,
            subDepartmentId: null
          }
        };
      }
      // Determine other contract levels if needed, but usually they don't create templates?
      // Actually Gamma contracts CAN create templates.
      if (activeContract.accessLevel === 'gamma') {
        return {
          type: 'gamma',
          scope: {
            organizationId: activeContract.organizationId,
            departmentId: activeContract.departmentId,
            subDepartmentId: activeContract.subDepartmentId
          }
        }
      }
    }

    return null;
  }, [user, activeContract]);

  const lockedScope = useMemo(() => {
    // User priority binding: If a complete initialScope is provided, use it to permanently lock down form
    if (initialScope) {
      return {
        organizationId: initialScope.organizationId || '',
        departmentId: initialScope.departmentId || '',
        subDepartmentId: initialScope.subDepartmentId || ''
      };
    }

    // Fallback to strict certification checks
    if (!effectiveScope || effectiveScope.type === 'epsilon') return null;
    return {
      organizationId: effectiveScope.scope?.organizationId || '',
      departmentId: effectiveScope.scope?.departmentId || '',
      subDepartmentId: effectiveScope.scope?.subDepartmentId || ''
    };
  }, [effectiveScope, initialScope?.organizationId, initialScope?.departmentId, initialScope?.subDepartmentId]);

  // Reset state when dialog opens - SAFE MODE
  // Only resets form fields. Does NOT touch IDs or Lists to prevent race conditions with Unified Loader.
  useEffect(() => {
    if (isOpen) {
      if (!name || name === 'New Template') setName('New Template');
      if (!description) setDescription('');
      setError('');
      setNameError('');
      setIsCreating(false);
    }
  }, [isOpen]);

  // 1. Initial Load: Organizations & Locked Scope Initialization
  useEffect(() => {
    if (!isOpen) return;

    const initializeData = async () => {
      console.log('[CreateTemplateDialog] 🚀 Initializing Data...', { lockedScope });
      setIsLoadingOrgs(true);

      try {
        // Fetch Orgs
        let orgs = await enhancedShiftService.getOrganizations();

        // Handle Locked Org missing from list (RLS)
        if (lockedScope && !orgs.find(o => o.id === lockedScope.organizationId)) {
          console.log('[CreateTemplateDialog] Locked Org missing, fetching directly...');
          const { data: specificOrg } = await supabase
            .from('organizations')
            .select('id, name')
            .eq('id', lockedScope.organizationId)
            .single();
          if (specificOrg) orgs = [...orgs, specificOrg as any];
        }

        setOrganizations(orgs);

        // If locked, initialize the whole hierarchy at once
        if (lockedScope) {
          console.log('[CreateTemplateDialog] Phase 1: Applying Locked Scope');
          setSelectedOrgId(lockedScope.organizationId);

          setIsLoadingDepts(true);
          const depts = await enhancedShiftService.getDepartments(lockedScope.organizationId);
          setDepartments(depts);
          setSelectedDeptId(lockedScope.departmentId);

          setIsLoadingSubDepts(true);
          const subDepts = await enhancedShiftService.getSubDepartments(lockedScope.departmentId);
          setSubDepartments(subDepts);
          setSelectedSubDeptId(lockedScope.subDepartmentId);
        } else if (orgs.length > 0 && !selectedOrgId) {
          setSelectedOrgId(orgs[0].id);
        }
      } catch (err) {
        console.error('[CreateTemplateDialog] Initialization failed:', err);
      } finally {
        setIsLoadingOrgs(false);
        setIsLoadingDepts(false);
        setIsLoadingSubDepts(false);
      }
    };

    initializeData();
  }, [isOpen]); // Only run once on mount/open

  // 2. Cascading Load: Departments (Only for Non-Locked users)
  useEffect(() => {
    if (!isOpen || !!lockedScope || !selectedOrgId) return;

    const loadDepts = async () => {
      console.log('[CreateTemplateDialog] 🌳 Loading Departments for Org:', selectedOrgId);
      setIsLoadingDepts(true);
      try {
        const depts = await enhancedShiftService.getDepartments(selectedOrgId);
        setDepartments(depts);
        if (depts.length > 0) setSelectedDeptId(depts[0].id);
        else setSelectedDeptId('');
      } catch (err) {
        console.error('Failed to load departments:', err);
      } finally {
        setIsLoadingDepts(false);
      }
    };
    loadDepts();
  }, [selectedOrgId, isOpen, lockedScope]); // lockedScope is in dependencies via the guard

  // 3. Cascading Load: Sub-Departments (Only for Non-Locked users)
  useEffect(() => {
    if (!isOpen || !!lockedScope || !selectedDeptId) return;

    const loadSubDepts = async () => {
      console.log('[CreateTemplateDialog] 🌿 Loading Sub-Departments for Dept:', selectedDeptId);
      setIsLoadingSubDepts(true);
      try {
        const subDepts = await enhancedShiftService.getSubDepartments(selectedDeptId);
        setSubDepartments(subDepts);
        if (subDepts.length > 0) setSelectedSubDeptId(subDepts[0].id);
        else setSelectedSubDeptId('');
      } catch (err) {
        console.error('Failed to load sub-departments:', err);
      } finally {
        setIsLoadingSubDepts(false);
      }
    };
    loadSubDepts();
  }, [selectedDeptId, isOpen, lockedScope]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const sanitizedName = sanitizeTemplateName(name);

    // Validate
    // Local Format Validation
    const formatValidation = validateTemplateName(sanitizedName);
    if (!formatValidation.valid) {
      setNameError(formatValidation.errors[0]);
      return;
    }

    // Verify IDs are present (double check)
    if (!selectedOrgId || !selectedDeptId || !selectedSubDeptId) {
      const missing: string[] = [];
      if (!selectedOrgId) missing.push('Organization');
      if (!selectedDeptId) missing.push('Department');
      if (!selectedSubDeptId) missing.push('Sub-Department');

      console.warn('Validation Missing Fields:', { selectedOrgId, selectedDeptId, selectedSubDeptId, organizations });
      setError(`Please select: ${missing.join(', ')}`);
      return;
    }

    // Backend Uniqueness Validation
    try {
      console.log('[CreateTemplateDialog] Validating name...', { name: sanitizedName, org: selectedOrgId });
      const { data: rpcData, error: rpcError } = await supabase.rpc('validate_template_name', {
        p_name: sanitizedName,
        p_organization_id: selectedOrgId,
        p_department_id: selectedDeptId,
        p_sub_department_id: selectedSubDeptId,
        p_exclude_id: null
      } as any);

      if (rpcError) {
        console.error("Validation RPC error:", rpcError);
        if (rpcError.code !== 'PGRST202') { // Ignore function not found for robustness
          // Warn but don't block? Or block?
        }
      } else {
        const result = rpcData as any;
        if (result && !result.valid) {
          setNameError(result.message || "Template name already exists in this sub-department.");
          return;
        }
      }
    } catch (e) {
      console.error("Validation error:", e);
    }

    setIsCreating(true);

    try {
      await onCreateTemplate({
        name: sanitizedName,
        description: description.trim(),
        organizationId: selectedOrgId,
        departmentId: selectedDeptId,
        subDepartmentId: selectedSubDeptId,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to create template');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      onOpenChange(false);
    }
  };

  const canSubmit = name.trim().length >= 3 && !nameError && !isCreating && !!selectedSubDeptId;

  // Helper to get name from ID in list
  const getOrgName = () => organizations.find(o => o.id === selectedOrgId)?.name || '...';
  const getDeptName = () => departments.find(d => d.id === selectedDeptId)?.name || '...';
  const getSubDeptName = () => subDepartments.find(sd => sd.id === selectedSubDeptId)?.name || '...';

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleClose} dialogClassName="bg-card border-border p-0 overflow-hidden sm:max-w-[760px] shadow-2xl">
      <ResponsiveDialog.Body className="overflow-y-auto max-h-[85dvh] p-0">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr]">
          {/* Left Column: Hierarchy (Locked) */}
          <div className="relative overflow-hidden bg-muted/30 p-8 flex flex-col justify-between border-r border-border">
            {/* Background Decoration */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col h-full">
              <div className="mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-bold text-primary uppercase tracking-widest mb-4">
                  Scope Context
                </div>
                <h3 className="text-2xl font-bold text-foreground tracking-tight">Hierarchy</h3>
                <p className="text-muted-foreground text-sm mt-1">This template will be bound to the selected context.</p>
              </div>

              <div className="space-y-4 flex-1">
                {[
                  { label: 'Organization', value: getOrgName(), icon: Building2, color: 'text-blue-400', bg: 'bg-blue-400/10' },
                  { label: 'Department', value: getDeptName(), icon: Factory, color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
                  { label: 'Sub-Department', value: getSubDeptName(), icon: Network, color: 'text-violet-400', bg: 'bg-violet-400/10' },
                ].map((item, i) => (
                  <div key={item.label} className="relative group">
                    <div className="flex items-center gap-4 p-4 rounded-2xl bg-background/50 border border-border backdrop-blur-sm group-hover:bg-muted/50 transition-all duration-300">
                      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", item.bg)}>
                        <item.icon className={cn("h-6 w-6", item.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-0.5">
                          {item.label}
                        </Label>
                        <div className="text-sm font-semibold text-foreground truncate pr-2">
                          {item.value}
                        </div>
                      </div>
                    </div>
                    {i < 2 && (
                      <div className="ml-10 h-6 w-px bg-gradient-to-b from-slate-700/50 to-transparent my-1" />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-8 flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                Prefilled from Global Scope
              </div>
            </div>
          </div>

          {/* Right Column: Form Inputs */}
          <div className="p-8 bg-card flex flex-col justify-between">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-xl font-bold text-foreground tracking-tight">Template Details</h3>
                  <p className="text-muted-foreground text-sm mt-1">Configure your new template skeleton.</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  className="rounded-full text-muted-foreground hover:text-foreground hover:bg-muted -mt-8 -mr-4"
                >
                  <Plus className="h-5 w-5 rotate-45" />
                </Button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Template Name <span className="text-primary font-black">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., January Performance Spike"
                    autoFocus
                    className={cn(
                      "bg-background border-border text-foreground h-12 px-4 rounded-xl focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all placeholder:text-muted-foreground/50 font-medium",
                      nameError && "border-destructive/50 focus:ring-destructive/20 focus:border-destructive"
                    )}
                  />
                  {nameError ? (
                    <p className="text-[11px] text-destructive flex items-center gap-1.5 font-medium">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {nameError}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
                      Must be unique within the sub-department. Min 3 characters.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description" className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Description <span className="text-muted-foreground/50">(optional)</span>
                  </Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Identify the specific peaks and roles this template addresses..."
                    className="bg-background border-border text-foreground min-h-[120px] p-4 rounded-xl focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all resize-none placeholder:text-muted-foreground/50 font-medium text-sm leading-relaxed"
                  />
                </div>

                <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 group overflow-hidden relative">
                  <div className="absolute top-0 right-0 -mr-4 -mt-4 w-16 h-16 bg-primary/10 rounded-full blur-xl animate-pulse" />
                  <div className="flex gap-4 relative z-10">
                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-primary uppercase tracking-widest block">
                        Auto-Seeding
                      </Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Created with core shifts for <span className="text-foreground">Convention</span>, <span className="text-foreground">Exhibition</span>, and <span className="text-foreground">Theatre</span>.
                      </p>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-[13px] text-destructive font-medium text-center">
                    {error}
                  </div>
                )}
              </form>
            </div>

            <div className="mt-8 pt-6 border-t border-border flex gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={isCreating}
                className="flex-1 h-12 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted font-bold tracking-wide"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-[1.5] h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-black tracking-widest shadow-lg shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 uppercase text-xs"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Forging...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create!
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </ResponsiveDialog.Body>
    </ResponsiveDialog>
  );
};

export default CreateTemplateDialog;
