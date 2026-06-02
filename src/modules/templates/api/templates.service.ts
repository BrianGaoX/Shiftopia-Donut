import { supabase } from '@/platform/realtime/client';
import { Group, SubGroup, Template } from '../model/templates.types';
import type { Shift } from '@/modules/rosters/model/shift.types';
import type { CaptureTemplateInput, CaptureTemplateResult } from '../model/templates.types';

/* ============================================================
   TYPES
   ============================================================ */

export interface PublishResult {
  success: boolean;
  template_id?: string;
  version?: number;
  start_date?: string;
  end_date?: string;
  snapshot_id?: string;
  roster_result?: {
    success: boolean;
    days_created: number;
    groups_created: number;
    subgroups_created: number;
    shifts_created: number;
  };
  error?: string;
}

/* ============================================================
   DB → APP MAPPER
   ============================================================ */

const dbToAppTemplate = (db: any): Template => {
  let groups: Group[] = [];

  if (db.groups) {
    try {
      groups =
        typeof db.groups === 'string' ? JSON.parse(db.groups) : db.groups;
    } catch {
      groups = [];
    }
  }

  return {
    id: db.id, // UUID string
    name: db.name,
    description: db.description || '',
    groups,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    departmentId: db.department_id,
    subDepartmentId: db.sub_department_id,
    organizationId: db.organization_id ?? '',
    appliedCount: db.applied_count ?? 0,
    startDate: db.start_date,
    endDate: db.end_date,
    status: db.status === 'published' ? 'published' : 'draft',
    version: db.version ?? 1,
  } as Template;
};

/* ============================================================
   SERVICE
   ============================================================ */

export const templatesService = {
  /* -----------------------------
     READ
  ----------------------------- */

  async getAllTemplates(): Promise<Template[]> {
    const { data, error } = await supabase
      .from('roster_templates')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map(dbToAppTemplate);
  },

  async getTemplateById(id: string): Promise<Template> {
    const { data, error } = await supabase
      .from('roster_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return dbToAppTemplate(data);
  },

  /* -----------------------------
     CREATE
  ----------------------------- */

  async createTemplate(
    template: Omit<Template, 'id' | 'createdAt' | 'updatedAt' | 'version'>
  ): Promise<Template> {
    const { data, error } = await supabase
      .from('roster_templates')
      .insert({
        name: template.name,
        description: template.description,
        department_id: template.departmentId,
        sub_department_id: template.subDepartmentId,
        status: 'draft',
        version: 1,
        groups: JSON.stringify(template.groups ?? []),
      } as any)
      .select('*')
      .single();

    if (error) throw error;
    return dbToAppTemplate(data);
  },

  /* -----------------------------
     UPDATE (draft only)
  ----------------------------- */

  async updateTemplate(
    id: string,
    updates: Partial<Template>
  ): Promise<Template> {
    const dbUpdates: any = {};

    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined)
      dbUpdates.description = updates.description;
    if (updates.groups !== undefined)
      dbUpdates.groups = JSON.stringify(updates.groups);
    if (updates.departmentId !== undefined)
      dbUpdates.department_id = updates.departmentId;
    if (updates.subDepartmentId !== undefined)
      dbUpdates.sub_department_id = updates.subDepartmentId;

    const { data, error } = await supabase
      .from('roster_templates')
      .update(dbUpdates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return dbToAppTemplate(data);
  },

  /* -----------------------------
     DELETE (cascade - removes child shifts first)
  ----------------------------- */

  async deleteTemplate(id: string): Promise<void> {
    // First, delete all child shifts using the cascade RPC
    const { data: cascadeResult, error: cascadeError } = await supabase
      .rpc('delete_template_shifts_cascade', { p_template_id: id });

    if (cascadeError) {
      console.error('[Template Delete] Failed to cascade delete shifts:', cascadeError);
      // Continue anyway - the template should still be deletable
    } else {
      console.log(`[Template Delete] Cascaded ${cascadeResult} shifts for template ${id}`);
    }

    // Now delete the template itself
    const { error } = await supabase
      .from('roster_templates')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  /* ============================================================
     PUBLISH (RPC)
     THIS IS THE ONLY VALID PUBLISH PATH
  ============================================================ */

  async publishTemplateRange(
    templateId: string,
    startDate: string,
    endDate: string,
    forceOverride = false
  ): Promise<PublishResult> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase.rpc('publish_template_range', {
      p_template_id: templateId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_user_id: auth.user.id,
      p_force_override: forceOverride,
    });

    if (error) {
      console.error('[Publish RPC error]', error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: 'No response from publish operation' };
    }

    return data as unknown as PublishResult;
  },

  /* ============================================================
     GROUP / SUBGROUP / SHIFT HELPERS
     (Frontend-managed JSON structure)
  ============================================================ */

  async addGroup(templateId: string, group: Omit<Group, 'id'>) {
    const template = await this.getTemplateById(templateId);
    const nextId = Math.max(0, ...template.groups.map((g) => g.id)) + 1;

    template.groups.push({
      ...group,
      id: nextId,
      subGroups: group.subGroups ?? [],
    });

    return this.updateTemplate(templateId, { groups: template.groups });
  },

  async addSubGroup(
    templateId: string,
    groupId: number,
    subGroup: Omit<SubGroup, 'id'>
  ) {
    const template = await this.getTemplateById(templateId);
    const group = template.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Group not found');

    const nextId = Math.max(0, ...group.subGroups.map((sg) => sg.id)) + 1;
    group.subGroups.push({
      ...subGroup,
      id: nextId,
      shifts: subGroup.shifts ?? [],
    });

    return this.updateTemplate(templateId, { groups: template.groups });
  },

  async addShift(
    templateId: string,
    groupId: number,
    subGroupId: number,
    shift: Omit<Shift, 'id'>
  ) {
    const template = await this.getTemplateById(templateId);
    const group = template.groups.find((g) => g.id === groupId);
    const subGroup = group?.subGroups.find((sg) => sg.id === subGroupId);
    if (!subGroup) throw new Error('Subgroup not found');

    subGroup.shifts.push({
      ...shift,
      id: crypto.randomUUID(),
    });

    return this.updateTemplate(templateId, { groups: template.groups });
  },
};

export async function captureRosterAsTemplate(
  input: CaptureTemplateInput
): Promise<CaptureTemplateResult> {
  const { data, error } = await supabase.rpc('capture_roster_as_template', {
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_sub_department_id: input.subDepartmentId,
    p_template_name: input.templateName,
  });

  if (error) {
    console.error('[captureRosterAsTemplate] Error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    
    const msg = error.message ?? '';
    if (msg.includes('UNAUTHORIZED'))
      throw new Error('You do not have permission to access this subdepartment.');
    if (msg.includes('INVALID_DATE_RANGE'))
      throw new Error('End date must be on or after start date.');
    if (msg.includes('INVALID_NAME'))
      throw new Error('Template name must be between 3 and 100 characters.');
    if (msg.includes('DUPLICATE_TEMPLATE_NAME'))
      throw new Error('A template with this name already exists in this subdepartment.');
    if (msg.includes('NO_SHIFTS_IN_RANGE'))
      throw new Error('No shifts found in the selected date range.');
    if (msg.includes('DATE_RANGE_TOO_LARGE'))
      throw new Error('Date range cannot exceed 35 days.');
    if (msg.includes('ORG_DEPT_MISSING_IN_SHIFTS'))
      throw new Error('The captured shifts are missing required organization or department information.');
    
    throw new Error('Failed to capture template. Please check the console for details.');
  }

  if (!data) {
    throw new Error('No response from capture_roster_as_template RPC');
  }

  // Handle both snake_case and camelCase to be safe
  const d = data as any;
  return {
    templateId: d.templateId || d.template_id,
    shiftsCaptured: d.shiftsCaptured ?? d.shifts_captured,
  };
}
