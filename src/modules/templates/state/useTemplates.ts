// src/hooks/useTemplates.ts
// Production-ready Templates hook with atomic operations, validation, and security

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
  Template,
  Group,
  SubGroup,
  TemplateShift,
  TemplateConflict,
  CreateTemplateInput,
  SaveTemplateResult,
  PublishTemplateResult,
  VersionCheckResult,
  NameValidationResult,
  ValidationResult,
  dbTemplateToFrontend,
  frontendToDbGroups,
  validateTemplateName,
  validateShift,
  validateDateRange,
  validateTemplateForPublish,
  sanitizeString,
  sanitizeTemplateName,
  deepClone,
  generateTempId,
  isTempId,
  formatDateForDb,
} from '@/modules/templates/model/templates.types';
import { SYDNEY_TZ, getTodayInTimezone, getNowInTimezone } from '@/modules/core/lib/date.utils';
import { parse, isSameMonth, startOfMonth, endOfMonth, format as formatCb } from 'date-fns';

/* ============================================================
   CONSTANTS
   ============================================================ */

const LOG_PREFIX = '[Templates]';
const IS_DEV = process.env.NODE_ENV === 'development';

const DEFAULT_GROUPS = [
  { name: 'Convention Centre', color: '#3b82f6', icon: 'building' },
  { name: 'Exhibition Centre', color: '#22c55e', icon: 'layout-grid' },
  { name: 'Theatre', color: '#ef4444', icon: 'theater' },
];

/* ============================================================
   LOGGING
   ============================================================ */

type LogLevel =
  | 'info'
  | 'success'
  | 'warn'
  | 'error'
  | 'network'
  | 'db'
  | 'security';

const log = (level: LogLevel, message: string, data?: any) => {
  if (!IS_DEV && level !== 'error' && level !== 'security') return;

  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  const prefix = `${timestamp} ${LOG_PREFIX}`;

  const styles: Record<LogLevel, string> = {
    info: 'color: #3b82f6',
    success: 'color: #22c55e',
    warn: 'color: #f59e0b',
    error: 'color: #ef4444',
    network: 'color: #8b5cf6',
    db: 'color: #06b6d4',
    security: 'color: #dc2626; font-weight: bold',
  };

  if (data !== undefined) {
    console.log(
      `%c${prefix} [${level.toUpperCase()}] ${message}`,
      styles[level],
      data
    );
  } else {
    console.log(
      `%c${prefix} [${level.toUpperCase()}] ${message}`,
      styles[level]
    );
  }
};

/* ============================================================
   HOOK INTERFACE
   ============================================================ */

export interface FetchTemplatesOptions {
  organizationId?: string;
  departmentId?: string;
  subDepartmentId?: string;
}

export interface UseTemplatesReturn {
  // State
  templates: Template[];
  currentTemplate: Template | null;
  localTemplate: Template | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;

  // Template CRUD
  fetchTemplates: (options?: FetchTemplatesOptions) => Promise<void>;
  fetchTemplate: (id: string) => Promise<Template | null>;
  createTemplate: (input: CreateTemplateInput) => Promise<Template | null>;
  saveTemplate: () => Promise<boolean>;
  renameTemplate: (id: string, newName: string) => Promise<boolean>;
  deleteTemplate: (id: string) => Promise<boolean>;
  duplicateTemplate: (id: string) => Promise<Template | null>;
  updateTemplateStatus: (id: string, status: string) => Promise<boolean>;

  // Local editing
  setCurrentTemplate: (template: Template | null) => void;
  updateLocalTemplate: (updates: Partial<Template>) => void;
  updateLocalGroup: (groupId: string | number, updates: Partial<Group>) => void;
  addLocalSubgroup: (groupId: string | number, name: string) => void;
  updateLocalSubgroup: (
    groupId: string | number,
    subgroupId: string | number,
    updates: Partial<SubGroup>
  ) => void;
  deleteLocalSubgroup: (
    groupId: string | number,
    subgroupId: string | number
  ) => void;
  cloneLocalSubgroup: (
    groupId: string | number,
    subgroupId: string | number
  ) => void;
  addLocalShift: (
    groupId: string | number,
    subgroupId: string | number,
    shift: Partial<TemplateShift>
  ) => void;
  updateLocalShift: (
    groupId: string | number,
    subgroupId: string | number,
    shiftId: string | number,
    updates: Partial<TemplateShift>
  ) => void;
  deleteLocalShift: (
    groupId: string | number,
    subgroupId: string | number,
    shiftId: string | number
  ) => void;
  discardChanges: () => void;

  // Validation
  validateName: (name: string, excludeId?: string) => Promise<ValidationResult>;
  checkVersion: () => Promise<VersionCheckResult | null>;
}

/* ============================================================
   HOOK IMPLEMENTATION
   ============================================================ */

export function useTemplates(): UseTemplatesReturn {
  // State
  const [templates, setTemplates] = useState<Template[]>([]);
  const [currentTemplate, setCurrentTemplateState] = useState<Template | null>(
    null
  );
  const [localTemplate, setLocalTemplate] = useState<Template | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { toast } = useToast();

  // Refs for tracking state
  const lastSavedTemplateRef = useRef<Template | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Safe state setter
  const safeSetState = useCallback(
    <T>(
      setter: React.Dispatch<React.SetStateAction<T>>,
      value: T | ((prev: T) => T)
    ) => {
      if (isMountedRef.current) {
        setter(value);
      }
    },
    []
  );

  /* ============================================================
     AUTH HELPER
     ============================================================ */

  const getAuthenticatedUser = useCallback(async () => {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      log('security', 'Authentication required');
      throw new Error('You must be logged in to perform this action');
    }
    return user;
  }, []);

  /* ============================================================
     FETCH TEMPLATES
     ============================================================ */

  const fetchTemplates = useCallback(async (options?: FetchTemplatesOptions) => {
    log('network', '📥 Fetching templates...', options);
    safeSetState(setIsLoading, true);
    safeSetState(setError, null);

    try {
      await getAuthenticatedUser();

      const startTime = performance.now();

      let query = supabase
        .from('v_template_full')
        .select('*')
        .order('updated_at', { ascending: false });

      if (options?.organizationId) {
        query = query.eq('organization_id', options.organizationId);
      }
      if (options?.departmentId) {
        query = query.eq('department_id', options.departmentId);
      }
      if (options?.subDepartmentId) {
        query = query.eq('sub_department_id', options.subDepartmentId);
      }

      const { data, error: err } = await query;
      const duration = Math.round(performance.now() - startTime);

      console.log('[Templates] Raw fetch result:', { data, error: err, options });

      if (err) {
        log('error', `Fetch failed: ${err.message}`);
        throw err;
      }

      log(
        'network',
        `📥 Fetched ${data?.length || 0} templates in ${duration}ms`
      );

      const converted = (data || []).map(dbTemplateToFrontend);
      safeSetState(setTemplates, converted);

      log('success', `✅ Loaded ${converted.length} templates`);
    } catch (err: any) {
      log('error', `Failed to load templates: ${err.message}`);
      safeSetState(setError, err.message);
      toast({
        title: 'Failed to load templates',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      safeSetState(setIsLoading, false);
    }
  }, [getAuthenticatedUser, safeSetState, toast]);

  const fetchTemplate = useCallback(
    async (id: string): Promise<Template | null> => {
      if (!id) {
        log('warn', 'No template ID provided');
        return null;
      }

      log('network', `📥 Fetching template ${id}...`);

      try {
        await getAuthenticatedUser();

        const { data, error: err } = await supabase
          .from('v_template_full')
          .select('*')
          .eq('id', id)
          .single();

        if (err) {
          if (err.code === 'PGRST116') {
            log('warn', 'Template not found');
            return null;
          }
          throw err;
        }

        const template = dbTemplateToFrontend(data);
        log(
          'success',
          `✅ Fetched template: ${template.name} (v${template.version})`
        );

        return template;
      } catch (err: any) {
        log('error', `Failed to fetch template: ${err.message}`);
        return null;
      }
    },
    [getAuthenticatedUser]
  );

  /* ============================================================
     CREATE TEMPLATE
     ============================================================ */

  const createTemplate = useCallback(
    async (input: CreateTemplateInput): Promise<Template | null> => {
      const sanitizedName = sanitizeTemplateName(input.name);

      // Validate name
      const nameValidation = validateTemplateName(sanitizedName);
      if (!nameValidation.valid) {
        toast({
          title: 'Invalid template name',
          description: nameValidation.errors.join(', '),
          variant: 'destructive',
        });
        return null;
      }

      log('network', '📤 Creating template...', { name: sanitizedName });
      safeSetState(setIsLoading, true);

      try {
        const user = await getAuthenticatedUser();

        // Validate name uniqueness via RPC
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'validate_template_name',
          {
            p_name: sanitizedName,
            p_organization_id: input.organizationId,
            p_department_id: input.departmentId,
            p_sub_department_id: input.subDepartmentId,
            p_exclude_id: undefined,
          }
        );

        if (rpcError) {
          log('error', 'Validation RPC failed', rpcError);
        }

        // RPC returns a JSONB scalar with { valid, is_valid, message, error_message }
        const validationResult = rpcData as { valid?: boolean; is_valid?: boolean; message?: string; error_message?: string } | null;
        log('info', 'Validation result:', validationResult);

        if (validationResult && (validationResult.valid === false || validationResult.is_valid === false)) {
          toast({
            title: 'Template name exists',
            description: validationResult.error_message || validationResult.message || 'A template with this name already exists',
            variant: 'destructive',
          });
          return null;
        }

        // Create template
        log('db', '1️⃣ Inserting template...');
        const { data: templateData, error: templateErr } = await supabase
          .from('roster_templates')
          .insert({
            name: sanitizedName,
            description: sanitizeString(input.description) || null,
            organization_id: input.organizationId,
            department_id: input.departmentId,
            sub_department_id: input.subDepartmentId,
            status: 'draft',
            created_by: user.id,
            last_edited_by: user.id,
            version: 1,
          })
          .select()
          .single();

        if (templateErr) {
          // Handle duplicate key constraint violations with a user-friendly message
          if (templateErr.code === '23505' || (templateErr as any).status === 409) {
            toast({
              title: 'Template name exists',
              description: 'A template with this name already exists in this sub-department. Please choose a different name.',
              variant: 'destructive',
            });
            return null;
          }
          throw templateErr;
        }

        log('success', `✅ Template created: ${templateData.id}`);

        // Fetch complete template (now auto-seeded by DB trigger)
        const fullTemplate = await fetchTemplate(templateData.id);

        if (fullTemplate) {
          safeSetState(setTemplates, (prev) => [fullTemplate, ...prev]);
          setCurrentTemplateState(fullTemplate);
          setLocalTemplate(deepClone(fullTemplate));
          lastSavedTemplateRef.current = deepClone(fullTemplate);
          setHasUnsavedChanges(false);
        }

        toast({
          title: 'Template created',
          description: `"${sanitizedName}" has been created.`,
        });

        log('success', '✅ Template creation complete');
        return fullTemplate;
      } catch (err: any) {
        log('error', `Template creation failed: ${err.message}`);
        toast({
          title: 'Failed to create template',
          description: err.message,
          variant: 'destructive',
        });
        return null;
      } finally {
        safeSetState(setIsLoading, false);
      }
    },
    [getAuthenticatedUser, fetchTemplate, safeSetState, toast]
  );

  /* ============================================================
     SET CURRENT TEMPLATE
     ============================================================ */

  const setCurrentTemplate = useCallback((template: Template | null) => {
    setCurrentTemplateState(template);

    if (template) {
      const copy = deepClone(template);
      setLocalTemplate(copy);
      lastSavedTemplateRef.current = deepClone(template);
      setHasUnsavedChanges(false);
      log('info', `Selected template: ${template.name} (v${template.version})`);
    } else {
      setLocalTemplate(null);
      lastSavedTemplateRef.current = null;
      setHasUnsavedChanges(false);
    }
  }, []);

  /* ============================================================
     LOCAL EDITING
     ============================================================ */

  const updateLocalTemplate = useCallback((updates: Partial<Template>) => {
    setLocalTemplate((prev) => {
      if (!prev) return null;

      const sanitized: Partial<Template> = { ...updates };
      if (sanitized.name) sanitized.name = sanitizeTemplateName(sanitized.name);
      if (sanitized.description)
        sanitized.description = sanitizeString(sanitized.description);

      const updated = { ...prev, ...sanitized };
      return updated;
    });
    setHasUnsavedChanges(true);
  }, []);

  const updateLocalGroup = useCallback(
    (groupId: string | number, updates: Partial<Group>) => {
      setLocalTemplate((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          groups: prev.groups.map((g) =>
            g.id === groupId ? { ...g, ...updates } : g
          ),
        };
      });
      setHasUnsavedChanges(true);
    },
    []
  );

  const addLocalSubgroup = useCallback(
    (groupId: string | number, name: string) => {
      const sanitizedName = sanitizeString(name);
      if (!sanitizedName) {
        toast({
          title: 'Invalid name',
          description: 'Subgroup name cannot be empty',
          variant: 'destructive',
        });
        return;
      }

      setLocalTemplate((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== groupId) return g;

            if (
              g.subGroups.some(
                (sg) => sg.name.toLowerCase() === sanitizedName.toLowerCase()
              )
            ) {
              toast({
                title: 'Duplicate name',
                description: `A subgroup named "${sanitizedName}" already exists`,
                variant: 'destructive',
              });
              return g;
            }

            return {
              ...g,
              subGroups: [
                ...g.subGroups,
                {
                  id: generateTempId('subgroup'),
                  name: sanitizedName,
                  shifts: [],
                  sortOrder: g.subGroups.length,
                },
              ],
            };
          }),
        };
      });
      setHasUnsavedChanges(true);
    },
    [toast]
  );

  const updateLocalSubgroup = useCallback(
    (
      groupId: string | number,
      subgroupId: string | number,
      updates: Partial<SubGroup>
    ) => {
      if (updates.name) updates.name = sanitizeString(updates.name);

      setLocalTemplate((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== groupId) return g;
            return {
              ...g,
              subGroups: g.subGroups.map((sg) =>
                sg.id === subgroupId ? { ...sg, ...updates } : sg
              ),
            };
          }),
        };
      });
      setHasUnsavedChanges(true);
    },
    []
  );

  const deleteLocalSubgroup = useCallback(
    (groupId: string | number, subgroupId: string | number) => {
      setLocalTemplate((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== groupId) return g;
            return {
              ...g,
              subGroups: g.subGroups.filter((sg) => sg.id !== subgroupId),
            };
          }),
        };
      });
      setHasUnsavedChanges(true);
    },
    []
  );

  const cloneLocalSubgroup = useCallback(
    (groupId: string | number, subgroupId: string | number) => {
      setLocalTemplate((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== groupId) return g;

            const original = g.subGroups.find((sg) => sg.id === subgroupId);
            if (!original) return g;

            const cloned: SubGroup = {
              ...deepClone(original),
              id: generateTempId('subgroup'),
              name: `${original.name} (Copy)`,
              shifts: original.shifts.map((s) => ({
                ...s,
                id: generateTempId('shift'),
              })),
              sortOrder: g.subGroups.length,
            };

            return {
              ...g,
              subGroups: [...g.subGroups, cloned],
            };
          }),
        };
      });
      setHasUnsavedChanges(true);
    },
    []
  );

  const addLocalShift = useCallback(
    (
      groupId: string | number,
      subgroupId: string | number,
      shift: Partial<TemplateShift>
    ) => {
      const validation = validateShift(shift);
      if (!validation.valid) {
        toast({
          title: 'Invalid shift',
          description: validation.errors.join(', '),
          variant: 'destructive',
        });
        return;
      }

      setLocalTemplate((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== groupId) return g;
            return {
              ...g,
              subGroups: g.subGroups.map((sg) => {
                if (sg.id !== subgroupId) return sg;
                return {
                  ...sg,
                  shifts: [
                    ...sg.shifts,
                    {
                      id: generateTempId('shift'),
                      name: sanitizeString(shift.name) || 'New Shift',
                      startTime: shift.startTime || '09:00',
                      endTime: shift.endTime || '17:00',
                      paidBreakDuration: shift.paidBreakDuration || 0,
                      unpaidBreakDuration: shift.unpaidBreakDuration || 0,
                      skills: shift.skills || [],
                      licenses: shift.licenses || [],
                      siteTags: shift.siteTags || [],
                      eventTags: shift.eventTags || [],
                      sortOrder: sg.shifts.length,
                      ...shift,
                    } as TemplateShift,
                  ],
                };
              }),
            };
          }),
        };
      });
      setHasUnsavedChanges(true);
    },
    [toast]
  );

  const updateLocalShift = useCallback(
    (
      groupId: string | number,
      subgroupId: string | number,
      shiftId: string | number,
      updates: Partial<TemplateShift>
    ) => {
      if (updates.startTime || updates.endTime) {
        const validation = validateShift(updates);
        if (!validation.valid) {
          toast({
            title: 'Invalid shift update',
            description: validation.errors.join(', '),
            variant: 'destructive',
          });
          return;
        }
      }

      setLocalTemplate((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== groupId) return g;
            return {
              ...g,
              subGroups: g.subGroups.map((sg) => {
                if (sg.id !== subgroupId) return sg;
                return {
                  ...sg,
                  shifts: sg.shifts.map((s) =>
                    s.id === shiftId ? { ...s, ...updates } : s
                  ),
                };
              }),
            };
          }),
        };
      });
      setHasUnsavedChanges(true);
    },
    [toast]
  );

  const deleteLocalShift = useCallback(
    (
      groupId: string | number,
      subgroupId: string | number,
      shiftId: string | number
    ) => {
      setLocalTemplate((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== groupId) return g;
            return {
              ...g,
              subGroups: g.subGroups.map((sg) => {
                if (sg.id !== subgroupId) return sg;
                return {
                  ...sg,
                  shifts: sg.shifts.filter((s) => s.id !== shiftId),
                };
              }),
            };
          }),
        };
      });
      setHasUnsavedChanges(true);
    },
    []
  );

  const discardChanges = useCallback(() => {
    if (lastSavedTemplateRef.current) {
      const restored = deepClone(lastSavedTemplateRef.current);
      setLocalTemplate(restored);
      setHasUnsavedChanges(false);
      log('info', 'Discarded changes, restored to last saved state');
      toast({
        title: 'Changes discarded',
        description: 'Reverted to last saved version',
      });
    } else {
      toast({
        title: 'Nothing to discard',
        description: 'No saved version to restore',
        variant: 'destructive',
      });
    }
  }, [toast]);

  /* ============================================================
     SAVE TEMPLATE (ATOMIC VIA RPC)
     ============================================================ */

  const saveTemplate = useCallback(async (): Promise<boolean> => {
    if (!localTemplate || !currentTemplate) {
      toast({
        title: 'Nothing to save',
        description: 'No template is selected',
        variant: 'destructive',
      });
      return false;
    }

    if (!hasUnsavedChanges) {
      toast({
        title: 'No changes',
        description: 'There are no unsaved changes',
      });
      return true;
    }

    // Validate name
    const nameValidation = validateTemplateName(localTemplate.name);
    if (!nameValidation.valid) {
      toast({
        title: 'Invalid template name',
        description: nameValidation.errors.join(', '),
        variant: 'destructive',
      });
      return false;
    }

    // Check if published
    if (currentTemplate.status === 'published') {
      toast({
        title: 'Cannot modify',
        description: 'Published templates cannot be edited',
        variant: 'destructive',
      });
      return false;
    }

    log('network', '📤 Saving template via RPC...');
    safeSetState(setIsSaving, true);
    safeSetState(setError, null);

    try {
      const user = await getAuthenticatedUser();
      const templateId = String(currentTemplate.id);

      // Prepare groups data for RPC
      const groupsData = frontendToDbGroups(localTemplate.groups);

      // Debug log: print shift data to verify role/employee is included
      console.log('[SaveTemplate] groupsData shifts:', groupsData.map(g => ({
        group: g.name,
        subGroups: g.subGroups.map((sg: any) => ({
          subGroup: sg.name,
          shifts: sg.shifts.map((sh: any) => ({
            name: sh.name,
            roleId: sh.roleId,
            roleName: sh.roleName,
            assignedEmployeeId: sh.assignedEmployeeId,
            assignedEmployeeName: sh.assignedEmployeeName,
          }))
        }))
      })));

      log('db', '1️⃣ Calling save_template_full RPC...', {
        templateId,
        version: currentTemplate.version,
        groupsCount: groupsData.length,
      });

      const { data, error: rpcError } = (await supabase.rpc(
        'save_template_full',
        {
          p_template_id: templateId,
          p_expected_version: currentTemplate.version,
          p_name: sanitizeTemplateName(localTemplate.name),
          p_description: sanitizeString(localTemplate.description) || '',
          p_groups: groupsData,
          p_user_id: user.id,
        }
      )) as { data: SaveTemplateResult[] | null; error: any };

      if (rpcError) {
        log('error', `RPC error: ${rpcError.message}`);
        throw rpcError;
      }

      const result = data?.[0];

      if (!result) {
        throw new Error('No response from save operation');
      }

      if (!result.success) {
        log('error', `Save failed: ${result.error_message}`);
        throw new Error(result.error_message || 'Save failed');
      }

      log(
        'success',
        `✅ Saved successfully. New version: ${result.new_version}`
      );

      // Refresh from database
      log('db', '2️⃣ Refreshing template from DB...');
      const refreshed = await fetchTemplate(templateId);

      if (refreshed) {
        setCurrentTemplateState(refreshed);
        setLocalTemplate(deepClone(refreshed));
        lastSavedTemplateRef.current = deepClone(refreshed);
        safeSetState(setTemplates, (prev) =>
          prev.map((t) => (String(t.id) === templateId ? refreshed : t))
        );
        setHasUnsavedChanges(false);

        log('db', `✅ Refreshed: ${refreshed.name} (v${refreshed.version})`);
      }

      toast({
        title: 'Template saved',
        description: `Version ${result.new_version} saved successfully`,
      });

      return true;
    } catch (err: any) {
      log('error', `Save failed: ${err.message}`);
      safeSetState(setError, err.message);
      toast({
        title: 'Failed to save',
        description: err.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      safeSetState(setIsSaving, false);
    }
  }, [
    localTemplate,
    currentTemplate,
    hasUnsavedChanges,
    getAuthenticatedUser,
    fetchTemplate,
    safeSetState,
    toast,
  ]);

  /* ============================================================
     DELETE TEMPLATE
     ============================================================ */

  const deleteTemplate = useCallback(
    async (id: string): Promise<boolean> => {
      if (!id) {
        log('warn', 'No template ID provided');
        return false;
      }

      log('network', `📤 Deleting template ${id}...`);

      try {
        await getAuthenticatedUser();

        // Check if published - get template name for toast
        const { data: template } = await supabase
          .from('roster_templates')
          .select('status, name')
          .eq('id', id)
          .single();

        // 1. SKIP CASCADE DELETE: Template deletion should ONLY remove the template structure
        // Shifts will simple be unlinked via ON DELETE SET NULL FK constraint
        log('info', 'ℹ️ Preserving associated shifts (unlinking via FK cascade)...');
        const shiftsDeleted = 0;

        // 2. Delete the template itself (will cascade to template_groups and template_subgroups via FK)
        const { error: err } = await supabase
          .from('roster_templates')
          .delete()
          .eq('id', id);

        if (err) throw err;

        // Update UI state
        safeSetState(setTemplates, (prev) =>
          prev.filter((t) => String(t.id) !== id)
        );

        if (String(currentTemplate?.id) === id) {
          setCurrentTemplateState(null);
          setLocalTemplate(null);
          lastSavedTemplateRef.current = null;
          setHasUnsavedChanges(false);
        }

        toast({
          title: 'Template deleted',
          description: `"${template?.name}" and ${shiftsDeleted} associated shifts have been deleted`,
        });

        log('success', '✅ Delete complete');
        return true;
      } catch (err: any) {
        log('error', `Delete failed: ${err.message}`);
        toast({
          title: 'Failed to delete',
          description: err.message,
          variant: 'destructive',
        });
        return false;
      }
    },
    [currentTemplate, getAuthenticatedUser, safeSetState, toast]
  );

  /* ============================================================
     DUPLICATE TEMPLATE
     ============================================================ */

  const duplicateTemplate = useCallback(
    async (id: string): Promise<Template | null> => {
      log('network', `📤 Duplicating template ${id}...`);
      safeSetState(setIsLoading, true);

      try {
        const user = await getAuthenticatedUser();

        // Fetch original
        const original = await fetchTemplate(id);
        if (!original) {
          throw new Error('Template not found');
        }

        // Generate unique name
        const baseName = original.name.replace(/\s\((Copy|v)\s?\d*\)$/i, '');
        let newName = `${baseName} (Copy)`;
        let counter = 1;

        while (templates.some((t) => t.name.toLowerCase() === newName.toLowerCase())) {
          counter++;
          newName = `${baseName} (Copy ${counter})`;
        }

        // Create template
        const { data: newTemplate, error: templateErr } = await supabase
          .from('roster_templates')
          .insert({
            name: newName,
            description: original.description,
            organization_id: original.organizationId,
            department_id: original.departmentId,
            sub_department_id: original.subDepartmentId,
            published_month: null, // Clear month on duplicate
            start_date: null,      // Clear dates on duplicate
            end_date: null,        // Clear dates on duplicate
            published_at: null,    // Clear pub info
            published_by: null,    // Clear pub info
            is_base_template: false,
            is_active: original.isActive,
            status: 'draft',
            created_by: user.id,
            last_edited_by: user.id,
            version: 1,
          })
          .select()
          .single();

        if (templateErr) throw templateErr;

        // Clone groups
        for (const group of original.groups) {
          const { data: newGroup, error: groupErr } = await supabase
            .from('template_groups')
            .insert({
              template_id: newTemplate.id,
              name: group.name,
              description: group.description,
              color: group.color,
              icon: group.icon,
              sort_order: group.sortOrder,
            })
            .select()
            .single();

          if (groupErr) throw groupErr;

          // Clone subgroups
          for (const subgroup of group.subGroups) {
            const { data: newSubgroup, error: sgErr } = await supabase
              .from('template_subgroups')
              .insert({
                group_id: newGroup.id,
                name: subgroup.name,
                description: subgroup.description,
                sort_order: subgroup.sortOrder,
              })
              .select()
              .single();

            if (sgErr) throw sgErr;

            // Clone shifts
            if (subgroup.shifts.length > 0) {
              const shiftsToInsert = subgroup.shifts.map((s, idx) => ({
                subgroup_id: newSubgroup.id,
                name: s.name,
                role_id: s.roleId || null,
                role_name: s.roleName,
                remuneration_level_id: s.remunerationLevelId || null,
                remuneration_level: s.remunerationLevel,
                start_time: s.startTime,
                end_time: s.endTime,
                paid_break_minutes: s.paidBreakDuration,
                unpaid_break_minutes: s.unpaidBreakDuration,
                required_skills: s.skills,
                required_licenses: s.licenses,
                site_tags: s.siteTags,
                event_tags: s.eventTags,
                notes: s.notes,
                sort_order: idx,
                day_of_week: s.dayOfWeek ?? 0,
                assigned_employee_id: s.assignedEmployeeId || null,
                assigned_employee_name: s.assignedEmployeeName || null,
              }));

              await supabase.from('template_shifts').insert(shiftsToInsert);
            }
          }
        }

        // Fetch complete duplicate
        const duplicated = await fetchTemplate(newTemplate.id);

        if (duplicated) {
          safeSetState(setTemplates, (prev) => [duplicated, ...prev]);
        }

        toast({
          title: 'Template duplicated',
          description: `Created "${newName}"`,
        });

        log('success', '✅ Duplicate complete');
        return duplicated;
      } catch (err: any) {
        log('error', `Duplicate failed: ${err.message}`);
        toast({
          title: 'Failed to duplicate',
          description: err.message,
          variant: 'destructive',
        });
        return null;
      } finally {
        safeSetState(setIsLoading, false);
      }
    },
    [templates, getAuthenticatedUser, fetchTemplate, safeSetState, toast]
  );

  /* ============================================================
     VALIDATION HELPERS
     ============================================================ */

  /* ============================================================
     VALIDATION HELPERS
     ============================================================ */

  const validateName = useCallback(
    async (name: string, excludeId?: string): Promise<ValidationResult> => {
      // Local validation first
      const localValidation = validateTemplateName(name);
      if (!localValidation.valid) {
        return localValidation;
      }

      // Check uniqueness via RPC
      if (currentTemplate?.organizationId && currentTemplate?.departmentId && currentTemplate?.subDepartmentId) {
        try {
          const { data } = await supabase.rpc('validate_template_name', {
            p_organization_id: currentTemplate.organizationId,
            p_department_id: currentTemplate.departmentId,
            p_sub_department_id: currentTemplate.subDepartmentId,
            p_name: name.trim(),
            p_exclude_id: excludeId,
          });

          const dataArray = data as any[];
          if (dataArray?.[0] && !dataArray[0].is_valid) {
            return {
              valid: false,
              errors: [dataArray[0].error_message || 'Name already exists'],
            };
          }
        } catch {
          // If RPC fails, proceed with local validation only
        }
      }

      return { valid: true, errors: [] };
    },
    [currentTemplate?.organizationId]
  );

  const checkVersion = useCallback(async (): Promise<VersionCheckResult | null> => {
    if (!currentTemplate) return null;

    try {
      const { data } = await supabase.rpc('check_template_version', {
        p_template_id: String(currentTemplate.id),
        p_expected_version: currentTemplate.version,
      });

      return data?.[0] || null;
    } catch {
      return null;
    }
  }, [currentTemplate]);

  const updateTemplateStatus = useCallback(
    async (id: string, status: string): Promise<boolean> => {
      log('network', `📤 Updating template ${id} status to ${status}...`);
      try {
        const { error: err } = await supabase
          .from('roster_templates')
          .update({ status: status as any })
          .eq('id', id);

        if (err) throw err;

        safeSetState(setTemplates, (prev) =>
          prev.map((t) => (String(t.id) === id ? { ...t, status: status as any } : t))
        );

        if (String(currentTemplate?.id) === id) {
          setCurrentTemplateState((prev) =>
            prev ? { ...prev, status: status as any } : null
          );
          setLocalTemplate((prev) =>
            prev ? { ...prev, status: status as any } : null
          );
        }

        toast({
          title: 'Status updated',
          description: `Template status changed to ${status}`,
        });

        return true;
      } catch (err: any) {
        log('error', `Status update failed: ${err.message}`);
        toast({
          title: 'Update failed',
          description: err.message,
          variant: 'destructive',
        });
        return false;
      }
    },
    [currentTemplate?.id, safeSetState, toast]
  );

  const renameTemplate = useCallback(
    async (id: string, newName: string): Promise<boolean> => {
      const sanitizedName = sanitizeTemplateName(newName);
      const validation = validateTemplateName(sanitizedName);
      
      if (!validation.valid) {
        toast({
          title: 'Invalid name',
          description: validation.errors[0],
          variant: 'destructive',
        });
        return false;
      }

      log('network', `📤 Renaming template ${id} to "${sanitizedName}"...`);
      try {
        const { error: err } = await supabase
          .from('roster_templates')
          .update({ name: sanitizedName })
          .eq('id', id);

        if (err) throw err;

        safeSetState(setTemplates, (prev) =>
          prev.map((t) => (String(t.id) === id ? { ...t, name: sanitizedName } : t))
        );

        if (String(currentTemplate?.id) === id) {
          setCurrentTemplateState((prev) =>
            prev ? { ...prev, name: sanitizedName } : null
          );
          setLocalTemplate((prev) =>
            prev ? { ...prev, name: sanitizedName } : null
          );
        }

        toast({
          title: 'Template renamed',
        });

        return true;
      } catch (err: any) {
        log('error', `Rename failed: ${err.message}`);
        toast({
          title: 'Rename failed',
          description: err.message,
          variant: 'destructive',
        });
        return false;
      }
    },
    [currentTemplate?.id, safeSetState, toast]
  );

  /* ============================================================
     RETURN
     ============================================================ */

  return {
    // State
    templates,
    currentTemplate,
    localTemplate,
    isLoading,
    isSaving,
    error,
    hasUnsavedChanges,

    // CRUD
    fetchTemplates,
    fetchTemplate,
    createTemplate,
    saveTemplate,
    deleteTemplate,
    duplicateTemplate,
    updateTemplateStatus,
    renameTemplate,

    // Local editing
    setCurrentTemplate,
    updateLocalTemplate,
    updateLocalGroup,
    addLocalSubgroup,
    updateLocalSubgroup,
    deleteLocalSubgroup,
    cloneLocalSubgroup,
    addLocalShift,
    updateLocalShift,
    deleteLocalShift,
    discardChanges,

    // Validation
    validateName,
    checkVersion,
  };
}

export default useTemplates;

export { useSnapRosterAsTemplate } from '../hooks/queries/useTemplateQueries';
