
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const DEPT_ID = '42cf1feb-cf01-4e22-8833-43367e6da1cd'; // Event Delivery
const SUB_DEPT_ID = '6fefad95-9cf9-468c-8724-424cc2f7b640'; // Set-up
const ROLE_ID = '2309d285-116e-4478-904d-44f627bdf82a'; // Team Member (L2)

async function onboard() {
  console.log('Generating bulk user onboarding SQL (test1 to test100)...');

  const sqlLines: string[] = [
    '-- Bulk User Onboarding: test1 to test100',
    '-- Target: Event Delivery -> Event Setups -> TM2',
    '',
    'DO $$',
    'DECLARE',
    '    v_user_id UUID;',
    '    v_email TEXT;',
    '    v_password TEXT;',
    '    v_dept_id UUID := \'42cf1feb-cf01-4e22-8833-43367e6da1cd\';',
    '    v_sub_dept_id UUID := \'6fefad95-9cf9-468c-8724-424cc2f7b640\';',
    '    v_role_tm2 UUID;',
    '    v_role_tm3 UUID;',
    '    v_role_tl UUID;',
    '    v_current_role_id UUID;',
    '    v_org_id UUID;',
    '    v_rem_level_id UUID;',
    'BEGIN',
    '    -- 1. Get role IDs dynamically (by name + sub_dept)',
    '    SELECT id INTO v_role_tm2 FROM public.roles WHERE name = \'Team Member\' AND sub_department_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_tm3 FROM public.roles WHERE name = \'TM3\' AND sub_department_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_tl  FROM public.roles WHERE name = \'Team Leader\' AND sub_department_id = v_sub_dept_id;',
    '',
    '    -- Fallback 1: Lookup by remuneration level if names mismatched',
    '    IF v_role_tm2 IS NULL THEN',
    '        SELECT r.id INTO v_role_tm2 FROM public.roles r JOIN public.remuneration_levels rl ON r.remuneration_level_id = rl.id ',
    '        WHERE r.sub_department_id = v_sub_dept_id AND rl.level_name = \'Level 2\' LIMIT 1;',
    '    END IF;',
    '    IF v_role_tm3 IS NULL THEN',
    '        SELECT r.id INTO v_role_tm3 FROM public.roles r JOIN public.remuneration_levels rl ON r.remuneration_level_id = rl.id ',
    '        WHERE r.sub_department_id = v_sub_dept_id AND rl.level_name = \'Level 3\' LIMIT 1;',
    '    END IF;',
    '    IF v_role_tl IS NULL THEN',
    '        SELECT r.id INTO v_role_tl FROM public.roles r JOIN public.remuneration_levels rl ON r.remuneration_level_id = rl.id ',
    '        WHERE r.sub_department_id = v_sub_dept_id AND rl.level_name = \'Level 4\' LIMIT 1;',
    '    END IF;',
    '',
    '    -- Fallback 2: Hardcoded defaults for TM2 if still not found',
    '    IF v_role_tm2 IS NULL THEN v_role_tm2 := \'2309d285-116e-4478-904d-44f627bdf82a\'; END IF;',
    '    IF v_role_tm3 IS NULL THEN v_role_tm3 := v_role_tm2; END IF;',
    '    IF v_role_tl IS NULL THEN v_role_tl := v_role_tm2; END IF;',
    '',
    '    -- 2. Get the first organization',
    '    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;',
    '    IF v_org_id IS NULL THEN',
    '        RAISE EXCEPTION \'No organization found.\';',
    '    END IF;',
    '',
  ];

  for (let i = 1; i <= 100; i++) {
    const email = `test${i}@test.com`;
    const password = `test${i}`;
    const firstName = `Test`;
    const lastName = `${i}`;

    // Determine role based on index
    let roleVar = 'v_role_tm2';
    if (i <= 15) roleVar = 'v_role_tl';
    else if (i <= 20) roleVar = 'v_role_tm3';

    sqlLines.push(`    -- User ${i}: ${email}`);
    sqlLines.push(`    v_email := '${email}';`);
    sqlLines.push(`    v_password := '${password}';`);
    sqlLines.push(`    v_current_role_id := ${roleVar};`);
    
    // Safety check to ensure v_current_role_id is never null
    sqlLines.push(`    IF v_current_role_id IS NULL THEN v_current_role_id := v_role_tm2; END IF;`);

    sqlLines.push(`    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN`);
    sqlLines.push(`        v_user_id := gen_random_uuid();`);
    sqlLines.push(`        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)`);
    sqlLines.push(`        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');`);
    sqlLines.push(`    ELSE`);
    sqlLines.push(`        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;`);
    sqlLines.push(`    END IF;`);
    sqlLines.push(``);
    sqlLines.push(`    INSERT INTO public.profiles (id, first_name, last_name, email)`);
    sqlLines.push(`    VALUES (v_user_id, '${firstName}', '${lastName}', v_email)`);
    sqlLines.push(`    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email;`);
    sqlLines.push(``);
    sqlLines.push(`    -- Get rem level for current role`);
    sqlLines.push(`    SELECT remuneration_level_id INTO v_rem_level_id FROM public.roles WHERE id = v_current_role_id;`);
    sqlLines.push(`    IF v_rem_level_id IS NULL THEN SELECT id INTO v_rem_level_id FROM public.remuneration_levels LIMIT 1; END IF;`);
    sqlLines.push(``);
    sqlLines.push(`    -- Assign role and sub-department`);
    sqlLines.push(`    IF NOT EXISTS (SELECT 1 FROM public.user_contracts WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id) THEN`);
    sqlLines.push(`        INSERT INTO public.user_contracts (user_id, organization_id, department_id, sub_department_id, access_level, status, role_id, rem_level_id)`);
    sqlLines.push(`        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'Active', v_current_role_id, v_rem_level_id);`);
    sqlLines.push(`    ELSE`);
    sqlLines.push(`        UPDATE public.user_contracts SET role_id = v_current_role_id, rem_level_id = v_rem_level_id, status = 'Active'`);
    sqlLines.push(`        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id;`);
    sqlLines.push(`    END IF;`);
    sqlLines.push(``);
    sqlLines.push(`    -- Assign Access Certificate (Alpha Type X)`);
    sqlLines.push(`    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN`);
    sqlLines.push(`        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)`);
    sqlLines.push(`        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);`);
    sqlLines.push(`    ELSE`);
    sqlLines.push(`        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true`);
    sqlLines.push(`        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';`);
    sqlLines.push(`    END IF;`);
    sqlLines.push(``);
  }

  sqlLines.push('END $$;');

  const sqlFile = 'scripts/onboard_users.sql';
  fs.writeFileSync(sqlFile, sqlLines.join('\n'));
  console.log(`Generated SQL script: ${sqlFile}`);
  console.log('Please execute this SQL in your Supabase Dashboard SQL Editor to create the 100 users.');
}

onboard().catch(console.error);
