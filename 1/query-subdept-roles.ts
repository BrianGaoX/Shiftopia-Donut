import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.VITE_SUPABASE_ANON_KEY || '',
);

async function main() {
  // 1. List all AV sub-departments
  const { data: subdepts } = await supabase
    .from('sub_departments')
    .select('id, name, department_id')
    .eq('department_id', '00000000-0000-0002-0000-000000000002')
    .order('name');

  console.log('=== AV sub-departments ===');
  for (const sd of subdepts ?? []) {
    const { data: roles } = await supabase
      .from('roles')
      .select('name')
      .eq('sub_department_id', sd.id)
      .order('name');
    const names = (roles ?? []).map(r => r.name);
    console.log(`\n${sd.name} (${sd.id}) — ${names.length} role(s)`);
    for (const n of names) console.log(`   - ${n}`);
  }
}

main();
