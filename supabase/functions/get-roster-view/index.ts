// get-roster-view — BFF for the Rosters Planner page.
// Runs the 5 roster-page queries in parallel using the caller's auth token,
// so RLS continues to apply. Frontend caller: useRosterViewPrefetch.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL) throw new Error('[FATAL] Missing SUPABASE_URL');
if (!SUPABASE_ANON_KEY) throw new Error('[FATAL] Missing SUPABASE_ANON_KEY');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

interface RequestBody {
  organization_id?: string | null;
  department_ids?: string[];
  sub_department_ids?: string[];
  start_date?: string | null;
  end_date?: string | null;
}

const SHIFT_SELECT = `
  id,
  organization_id,
  department_id,
  sub_department_id,
  created_at,
  updated_at,
  version,
  roster_id,
  roster_date,
  shift_date,
  template_id,
  template_group,
  template_sub_group,
  is_from_template,
  template_instance_id,
  group_type,
  sub_group_name,
  display_order,
  shift_group_id,
  shift_subgroup_id,
  role_id,
  role_level,
  remuneration_level_id,
  remuneration_rate,
  actual_hourly_rate,
  currency,
  start_time,
  end_time,
  is_overnight,
  scheduled_length_minutes,
  break_minutes,
  paid_break_minutes,
  unpaid_break_minutes,
  net_length_minutes,
  total_hours,
  timezone,
  start_at,
  end_at,
  assigned_employee_id,
  assigned_at,
  lifecycle_status,
  assignment_status,
  assignment_outcome,
  fulfillment_status,
  is_draft,
  is_cancelled,
  is_on_bidding,
  is_published,
  is_locked,
  bidding_status,
  bidding_priority_text,
  trade_requested_at,
  trading_status,
  attendance_status,
  offer_expires_at,
  event_ids,
  tags,
  required_skills,
  required_licenses,
  notes,
  is_training,
  published_at,
  cancelled_at,
  deleted_at,
  last_modified_by,
  target_employment_type,
  organizations(id, name),
  departments(id, name),
  sub_departments(id, name),
  roles(id, name),
  remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
  assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
  roster_subgroup:roster_subgroups(name, roster_group:roster_groups(name)),
  timesheets(status)
`;

// Supabase caps a single response at 1000 rows; for orgs with 5k+ shifts in
// view we page through. `count: 'planned'` skips the expensive COUNT(*) — we
// stop on the first short page rather than trusting the planner estimate
// (which can be off by ~10–20%).
const PAGE_SIZE = 1000;
const MAX_PAGES = 100; // safety cap (100k rows)

async function fetchShifts(
  supa: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
  deptIds: string[],
  subDeptIds: string[],
) {
  const buildQuery = () => {
    let q = supa
      .from('shifts')
      .select(SHIFT_SELECT, { count: 'planned', head: false })
      .eq('organization_id', orgId)
      .gte('shift_date', startDate)
      .lte('shift_date', endDate)
      .is('deleted_at', null);

    if (deptIds.length) q = q.in('department_id', deptIds);
    if (subDeptIds.length) q = q.in('sub_department_id', subDeptIds);

    return q.order('shift_date').order('display_order').order('start_time');
  };

  const all: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(`shifts: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchEmployees(
  supa: SupabaseClient,
  orgId: string,
  deptIds: string[],
  subDeptIds: string[],
) {
  // Mirror EligibilityService's "employees in scope" cut. Detailed eligibility
  // (role match, qualifications) is computed in the individual hook when needed.
  let q = supa
    .from('profiles')
    .select(`
      id,
      first_name,
      last_name,
      department:departments(name),
      sub_department:sub_departments(name)
    `)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('first_name');

  if (deptIds.length) q = q.in('department_id', deptIds);
  if (subDeptIds.length) q = q.in('sub_department_id', subDeptIds);

  const { data, error } = await q;
  if (error) throw new Error(`employees: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    department_name: row.department?.name ?? undefined,
    sub_department_name: row.sub_department?.name ?? undefined,
  }));
}

async function fetchRoles(
  supa: SupabaseClient,
  deptIds: string[],
  subDeptIds: string[],
) {
  let q = supa
    .from('roles')
    .select('id, name, department_id, sub_department_id, remuneration_level_id')
    .order('name');

  // Frontend logic: roles tied to the sub-dept OR roles tied to the parent dept with null sub_dept.
  // For BFF efficiency we union both sets via .or() once a sub-dept is given.
  if (subDeptIds.length === 1 && deptIds.length === 1) {
    q = q.or(
      `sub_department_id.eq.${subDeptIds[0]},and(department_id.eq.${deptIds[0]},sub_department_id.is.null)`,
    );
  } else if (subDeptIds.length) {
    q = q.in('sub_department_id', subDeptIds);
  } else if (deptIds.length) {
    q = q.in('department_id', deptIds);
  }

  const { data, error } = await q;
  if (error) throw new Error(`roles: ${error.message}`);
  return data ?? [];
}

async function fetchRemunerationLevels(supa: SupabaseClient) {
  const { data, error } = await supa
    .from('remuneration_levels')
    .select('id, level_number, level_name, hourly_rate_min, hourly_rate_max, description')
    .order('level_number');
  if (error) throw new Error(`remuneration_levels: ${error.message}`);
  return data ?? [];
}

async function fetchEvents(supa: SupabaseClient, orgId: string) {
  const { data, error } = await supa
    .from('events')
    .select('id, name, description, event_type, venue, start_date, end_date, status')
    .eq('is_active', true)
    .eq('organization_id', orgId)
    .order('start_date', { ascending: true });
  if (error) throw new Error(`events: ${error.message}`);
  return data ?? [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const orgId = body.organization_id;
  const startDate = body.start_date;
  const endDate = body.end_date;
  if (!isUuid(orgId) || !startDate || !endDate) {
    return new Response(
      JSON.stringify({ error: 'organization_id (uuid), start_date, end_date are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const deptIds = (body.department_ids ?? []).filter(isUuid);
  const subDeptIds = (body.sub_department_ids ?? []).filter(isUuid);

  // Caller-scoped client — RLS uses the user's JWT.
  const supa = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  try {
    const [shifts, employees, roles, remunerationLevels, events] = await Promise.all([
      fetchShifts(supa, orgId, startDate, endDate, deptIds, subDeptIds),
      fetchEmployees(supa, orgId, deptIds, subDeptIds),
      fetchRoles(supa, deptIds, subDeptIds),
      fetchRemunerationLevels(supa),
      fetchEvents(supa, orgId),
    ]);

    return new Response(
      JSON.stringify({
        shifts,
        employees,
        roles,
        remuneration_levels: remunerationLevels,
        events,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[get-roster-view] error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
