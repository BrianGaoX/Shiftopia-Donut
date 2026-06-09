import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

// Inline copy of resolveMLRole (can't import mlClient.service directly — it uses import.meta.env).
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
  const { data, error } = await supabase
    .from('roles')
    .select('name')
    .order('name');

  if (error) {
    console.error('ERROR:', error);
    return;
  }

  const names = [...new Set((data ?? []).map(r => r.name))].sort();
  const buckets: Record<string, string[]> = {
    Supervisor: [],
    Security: [],
    'Food Staff': [],
    Usher: [],
    Unmapped: [],
  };

  for (const n of names) {
    const cls = resolveMLRole(n);
    buckets[cls ?? 'Unmapped'].push(n);
  }

  for (const cls of [...ML_KNOWN_ROLES, 'Unmapped']) {
    const list = buckets[cls];
    console.log(`\n== ${cls} (${list.length}) ==`);
    for (const n of list) console.log(`  ${n}`);
  }

  const mapped = names.length - buckets.Unmapped.length;
  console.log(`\nTotal: ${names.length} unique roles (${mapped} mapped, ${buckets.Unmapped.length} unmapped)`);
}

main();
