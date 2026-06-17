
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
    '-- Target: Event Delivery -> Event Setups',
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
    '    v_org_id UUID;',
    '    v_rem_level_tm2 UUID;',
    '    v_rem_level_tm3 UUID;',
    '    v_rem_level_tl UUID;',
    '    v_skill_id UUID;',
    'BEGIN',
    '    -- 1. Get role IDs dynamically (by name + sub_dept)',
    '    SELECT id INTO v_role_tm2 FROM public.roles WHERE name = \'Team Member\' AND sub_department_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_tm3 FROM public.roles WHERE name = \'TM3\' AND sub_department_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_tl  FROM public.roles WHERE name = \'Team Leader\' AND sub_department_id = v_sub_dept_id;',
    '',
    '    -- Get remuneration levels',
    '    SELECT remuneration_level_id INTO v_rem_level_tm2 FROM public.roles WHERE id = v_role_tm2;',
    '    SELECT remuneration_level_id INTO v_rem_level_tm3 FROM public.roles WHERE id = v_role_tm3;',
    '    SELECT remuneration_level_id INTO v_rem_level_tl FROM public.roles WHERE id = v_role_tl;',
    '',
    '    -- 2. Get the first organization',
    '    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;',
    '    IF v_org_id IS NULL THEN',
    '        RAISE EXCEPTION \'No organization found.\';',
    '    END IF;',
    '',
    '    -- 3. Create the ES-GOLD skill if it doesn\'t exist',
    '    INSERT INTO public.skills (id, name, description, category, is_active, requires_expiration, default_validity_months)',
    '    VALUES (gen_random_uuid(), \'ES-GOLD\', \'Gold level Event Security skill\', \'Safety\', true, false, null)',
    '    ON CONFLICT (name) DO NOTHING;',
    '    SELECT id INTO v_skill_id FROM public.skills WHERE name = \'ES-GOLD\';',
    '',
    '    -- 4. Delete existing contracts and skills for test users before inserting to ensure exact state',
    '    DELETE FROM public.user_contracts WHERE user_id IN (SELECT id FROM public.profiles WHERE email LIKE \'test%@test.com\');',
    '    DELETE FROM public.employee_skills WHERE skill_id = v_skill_id AND employee_id IN (SELECT id FROM public.profiles WHERE email LIKE \'test%@test.com\');',
    ''
  ];

  // Randomly select 25 indices between 1 and 100 to receive the ES-GOLD skill
  const randomIndices = new Set<number>();
  while (randomIndices.size < 25) {
    randomIndices.add(Math.floor(Math.random() * 100) + 1);
  }

  for (let i = 1; i <= 100; i++) {
    const email = `test${i}@test.com`;
    const password = `test${i}`;
    const firstName = `Test`;
    const lastName = `${i}`;

    sqlLines.push(`    -- User ${i}: ${email}`);
    sqlLines.push(`    v_email := '${email}';`);
    sqlLines.push(`    v_password := '${password}';`);

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

    // Assign contracts based on requirements:
    // 15 employees get Team Leader, TM3 and Team Member contracts
    // 2 employees get TM3 and Team Member contracts
    // Rest get Team Member contracts
    if (i <= 15) {
      sqlLines.push(`    INSERT INTO public.user_contracts (user_id, organization_id, department_id, sub_department_id, access_level, status, role_id, rem_level_id, employment_status, contracted_weekly_hours)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'Active', v_role_tl, v_rem_level_tl, 'Casual', '0'),`);
      sqlLines.push(`        (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'Active', v_role_tm3, v_rem_level_tm3, 'Casual', '0'),`);
      sqlLines.push(`        (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'Active', v_role_tm2, v_rem_level_tm2, 'Casual', '0');`);
    } else if (i <= 17) {
      sqlLines.push(`    INSERT INTO public.user_contracts (user_id, organization_id, department_id, sub_department_id, access_level, status, role_id, rem_level_id, employment_status, contracted_weekly_hours)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'Active', v_role_tm3, v_rem_level_tm3, 'Casual', '0'),`);
      sqlLines.push(`        (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'Active', v_role_tm2, v_rem_level_tm2, 'Casual', '0');`);
    } else {
      sqlLines.push(`    INSERT INTO public.user_contracts (user_id, organization_id, department_id, sub_department_id, access_level, status, role_id, rem_level_id, employment_status, contracted_weekly_hours)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'Active', v_role_tm2, v_rem_level_tm2, 'Casual', '0');`);
    }
    sqlLines.push(``);

    // Give 25 random members ES-GOLD skill
    if (randomIndices.has(i)) {
      sqlLines.push(`    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)`);
      sqlLines.push(`    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');`);
      sqlLines.push(``);
    }

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

  const sqlFile = '1/onboard_users.sql';
  fs.writeFileSync(sqlFile, sqlLines.join('\n'));
  console.log(`Generated SQL script: ${sqlFile}`);
}

onboard().catch(console.error);
