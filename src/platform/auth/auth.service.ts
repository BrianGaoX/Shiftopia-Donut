import { supabase } from '@/platform/supabase/client';
import { AccessLevel, Role, User, UserContract, AccessCertificate, PermissionObject } from './types';
import { mapRole } from './access.policy';

export const authService = {
    /**
     * Fetches full user profile including contracts and certificates
     */
    async getUserProfile(userId: string): Promise<User | null> {
        try {
            // 1. Fetch Profile
            const { data: profile, error: profileErr } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (profileErr || !profile) {
                console.error('[AuthService] Profile fetch failed:', profileErr);
                throw new Error('Profile not found');
            }

            // 2. Fetch Contracts
            const { data: contractsData, error: contractsErr } = await supabase
                .from('user_contracts')
                .select(`
                    id,
                    user_id,
                    organization_id,
                    department_id,
                    sub_department_id,
                    role_id,
                    rem_level_id,
                    employment_status,
                    status,
                    access_level,
                    organizations (name),
                    departments (name),
                    sub_departments (name),
                    roles (name)
                `)
                .eq('user_id', userId)
                .eq('status', 'Active');

            if (contractsErr) console.error('[AuthService] Contracts fetch error:', contractsErr);

            const contracts: UserContract[] = (contractsData || []).map(c => ({
                id: c.id,
                userId: c.user_id,
                organizationId: c.organization_id,
                departmentId: c.department_id,
                subDepartmentId: c.sub_department_id,
                roleId: c.role_id,
                remLevelId: c.rem_level_id,
                accessLevel: (c.access_level as AccessLevel) || 'alpha',
                employmentStatus: c.employment_status,
                status: c.status,
                organizationName: c.organizations ? (c.organizations as any).name : undefined,
                departmentName: c.departments ? (c.departments as any).name : undefined,
                subDepartmentName: c.sub_departments ? (c.sub_departments as any).name : undefined,
                roleName: c.roles ? (c.roles as any).name : undefined,
            }));

            // 3. Fetch Certificates with related names (including certificate_type and is_active)
            const { data: certsData, error: certsErr } = await supabase
                .from('app_access_certificates')
                .select(`
                    *,
                    organizations (name),
                    departments (name),
                    sub_departments (name)
                `)
                .eq('user_id', userId)
                .eq('is_active', true);

            if (certsErr) console.error('[AuthService] Certificates fetch error:', certsErr);

            const certificates: AccessCertificate[] = (certsData || []).map(c => ({
                id: c.id,
                userId: c.user_id,
                certificateType: c.certificate_type as 'X' | 'Y',
                accessLevel: c.access_level as AccessLevel,
                organizationId: c.organization_id,
                departmentId: c.department_id,
                subDepartmentId: c.sub_department_id,
                isActive: c.is_active,
                organizationName: c.organizations ? (c.organizations as any).name : undefined,
                departmentName: c.department_id ? (c.departments ? (c.departments as any).name : null) : null,
                subDepartmentName: c.sub_department_id ? (c.sub_departments ? (c.sub_departments as any).name : null) : null,
            }));

            // 4. Calculate Highest Access Level (Using Certificates and Contracts)
            const levels: AccessLevel[] = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
            let highest: AccessLevel = 'alpha' as AccessLevel;

            // Gather all candidate levels
            const candidateLevels: AccessLevel[] = [
                ...certificates.map(c => c.accessLevel),
                ...contracts.map(c => c.accessLevel)
            ];

            candidateLevels.forEach(level => {
                const currentIdx = levels.indexOf(highest);
                const newIdx = levels.indexOf(level);
                if (newIdx > currentIdx) highest = level;
            });

            let derivedRole: Role = 'member';
            if (highest === 'zeta' || highest === 'epsilon') derivedRole = 'admin';
            else if (highest === 'delta') derivedRole = 'manager';
            else if (highest === 'gamma') derivedRole = 'manager';
            else if (highest === 'beta') derivedRole = 'teamlead';
            else derivedRole = 'member';

            // 5. Return Constructed User Object
            return {
                id: profile.id,
                employeeCode: profile.employee_code,
                firstName: profile.first_name || 'User',
                lastName: profile.last_name,
                fullName: profile.full_name || profile.first_name || 'User',
                name: profile.full_name || profile.first_name || 'User',
                email: profile.email,
                systemRole: derivedRole,
                role: derivedRole,
                employmentType: profile.employment_type || 'casual',
                isActive: profile.is_active ?? true,
                avatar: `https://api.dicebear.com/7.x/personas/svg?seed=${profile.email}`,
                contracts: contracts,
                certificates: certificates,
                highestAccessLevel: highest,
                preferences: profile.preferences as User['preferences'],
            };
        } catch (e: any) {
            console.error('[AuthService] getUserProfile EXCEPTION:', e.message);
            return null;
        }
    },

    /**
     * Fetches the resolved permission object for the authenticated user.
     * Calls the `resolve_user_permissions` RPC which returns:
     * - typeX: array of personal certificates
     * - typeY: single managerial certificate or null
     * - allowed_scope_tree: hierarchy tree based on certificate scope
     */
    async fetchPermissions(): Promise<PermissionObject | null> {
        try {
            const { data, error } = await supabase.rpc('resolve_user_permissions');

            if (error) {
                console.error('[AuthService] Permission fetch error:', error);
                return null;
            }

            return (data as unknown) as PermissionObject;
        } catch (e: any) {
            console.error('[AuthService] fetchPermissions EXCEPTION:', e.message);
            return null;
        }
    }
};
