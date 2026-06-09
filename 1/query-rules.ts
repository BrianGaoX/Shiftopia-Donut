import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.VITE_SUPABASE_ANON_KEY || '');

async function main() {
  const { data: sup } = await supabase.from('work_rules').select('*').eq('rule_name', 'supervisory_ratio');
  const { data: min } = await supabase.from('work_rules').select('*').eq('rule_name', 'minimum_staff_per_function');
  console.log(`supervisory_ratio rows: ${sup?.length ?? 0}`);
  if (sup?.length) console.log(JSON.stringify(sup, null, 2));
  console.log(`\nminimum_staff_per_function rows: ${min?.length ?? 0}`);
  if (min?.length) console.log(JSON.stringify(min.slice(0, 5), null, 2));
}
main();
