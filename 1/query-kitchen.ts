import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const ML_KNOWN_ROLES = ['Usher', 'Security', 'Food Staff', 'Supervisor'] as const;
type MLKnownRole = typeof ML_KNOWN_ROLES[number];

function resolveMLRole(roleName: string): MLKnownRole | null {
  const n = roleName.toLowerCase();
  if (/supervisor|\bmanager\b|team\s*lead|coordinator|director|\bhead\b|\bchief\b|\bceo\b|duty/.test(n)) return 'Supervisor';
  if (/usher|greeter|ticketing/.test(n)) return 'Usher';
  if (/food|catering|f&b|beverage|\bbar\b|chef|cook|\bcafe\b|kitchen|waiter|waitress|\bserver\b/.test(n)) return 'Food Staff';
  if (/security|guard|\brisk\b|safety/.test(n)) return 'Security';
  return null;
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.VITE_SUPABASE_ANON_KEY || '',
);

async function main() {
  // Find every role with "kitchen" in the name
  const { data } = await supabase
    .from('roles')
    .select('id, name, department_id, sub_department_id')
    .ilike('name', '%kitchen%');

  console.log('=== Roles with "kitchen" in name ===');
  for (const r of data ?? []) {
    console.log(`  ${r.name}  →  ${resolveMLRole(r.name) ?? 'UNMAPPED'}`);
    console.log(`      sub_department_id: ${r.sub_department_id}`);
  }

  // Find the Kitchen sub-dept(s)
  const { data: subs } = await supabase
    .from('sub_departments')
    .select('id, name, department_id')
    .ilike('name', '%kitchen%');
  console.log('\n=== Sub-departments with "kitchen" in name ===');
  for (const s of subs ?? []) {
    const { data: roles } = await supabase
      .from('roles')
      .select('name')
      .eq('sub_department_id', s.id);
    console.log(`\n  ${s.name}  (${s.id})`);
    for (const r of roles ?? []) {
      console.log(`    - ${r.name}  →  ${resolveMLRole(r.name) ?? 'UNMAPPED'}`);
    }
  }
}

main();
