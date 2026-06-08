import { supabase } from '@/platform/supabase/client';
import type { MLKnownRole } from '../services/mlClient.service';

export type RoleMLClassMap = ReadonlyMap<string, MLKnownRole>;

export async function fetchRoleMLClassMap(): Promise<RoleMLClassMap> {
  const { data, error } = await supabase
    .from('role_ml_class_map')
    .select('role_id, ml_class');

  if (error) {
    throw new Error(`Failed to load role→ML-class map: ${error.message}`);
  }

  const map = new Map<string, MLKnownRole>();
  for (const row of data ?? []) {
    map.set(row.role_id as string, row.ml_class as MLKnownRole);
  }
  return map;
}
