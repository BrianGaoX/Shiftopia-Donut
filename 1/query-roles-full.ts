import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
);

interface RoleRow {
  id: string;
  name: string;
  department_id: string | null;
  sub_department_id: string | null;
  forecasting_bucket: string | null;
  supervision_ratio_min: number | null;
  supervision_ratio_max: number | null;
  is_baseline_eligible: boolean | null;
}

async function main() {
  const { data: depts } = await supabase
    .from('departments')
    .select('id, name')
    .order('name');
  const deptMap = new Map((depts ?? []).map((d: any) => [d.id, d.name]));

  const { data: subs } = await supabase
    .from('sub_departments')
    .select('id, name, department_id')
    .order('name');
  const subMap = new Map((subs ?? []).map((s: any) => [s.id, { name: s.name, deptId: s.department_id }]));

  const { data: roles, error } = await supabase
    .from('roles')
    .select('id, name, department_id, sub_department_id, forecasting_bucket, supervision_ratio_min, supervision_ratio_max, is_baseline_eligible')
    .order('name');

  if (error) {
    console.error('ERROR fetching roles:', error.message);
    process.exit(1);
  }

  const grouped = new Map<string, RoleRow[]>();
  for (const r of (roles ?? []) as RoleRow[]) {
    const sub = r.sub_department_id ? subMap.get(r.sub_department_id) : null;
    const deptName = (sub?.deptId ? deptMap.get(sub.deptId) : null) ?? (r.department_id ? deptMap.get(r.department_id) : null) ?? '(no dept)';
    const subName = sub?.name ?? '(no sub)';
    const key = `${deptName} >> ${subName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const sorted = [...grouped.keys()].sort();
  console.log(`# Total roles: ${(roles ?? []).length}`);
  console.log(`# Total dept/sub-dept buckets: ${sorted.length}\n`);

  for (const key of sorted) {
    const list = grouped.get(key)!;
    console.log(`\n## ${key} (${list.length})`);
    for (const r of list) {
      const bucket = r.forecasting_bucket ?? '(null)';
      const baseline = r.is_baseline_eligible === null ? '(null)' : r.is_baseline_eligible ? 'YES' : 'no';
      const rmin = r.supervision_ratio_min ?? '-';
      const rmax = r.supervision_ratio_max ?? '-';
      console.log(`   ${r.name.padEnd(40)}  bucket=${bucket.padEnd(13)}  baseline=${String(baseline).padEnd(5)}  ratio=${rmin}/${rmax}`);
    }
  }
}

main();
