import { AccessLevel } from './types';
import { User, Users, Building2, Crown, Globe } from 'lucide-react';
import React from 'react';

export const ACCESS_LEVEL_CONFIG: Record<AccessLevel, {
    label: string;
    description: string;
    roleName: string;
    icon: React.ElementType;
    color: string;
}> = {
    alpha: {
        label: 'Alpha',
        description: 'Employee - View own data only',
        roleName: 'Employee',
        icon: User,
        color: 'text-slate-400'
    },
    beta: {
        label: 'Beta',
        description: 'Team Lead - View timesheets & basic team data',
        roleName: 'Team Lead',
        icon: Users,
        color: 'text-blue-400'
    },
    gamma: {
        label: 'Gamma',
        description: 'Sub-Dept Manager - Manage specific sub-department operations',
        roleName: 'Sub-Dept Manager',
        icon: Building2,
        color: 'text-purple-400'
    },
    delta: {
        label: 'Delta',
        description: 'Dept Manager - Full department oversight',
        roleName: 'Dept Manager',
        icon: Crown,
        color: 'text-amber-400'
    },
    epsilon: {
        label: 'Epsilon',
        description: 'Global Admin - Full organization access',
        roleName: 'Global Admin',
        icon: Globe,
        color: 'text-emerald-400'
    },
    zeta: {
        label: 'Zeta',
        description: 'System Admin - Full system access',
        roleName: 'System Admin',
        icon: Crown,
        color: 'text-rose-400'
    },
};
