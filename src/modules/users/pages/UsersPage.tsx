import React, { useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { Shield, User, Filter, Download, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/modules/core/ui/primitives/button';
import { motion } from 'framer-motion';

// Import section components
import SkillsSection from '@/modules/users/ui/components/SkillsSection';
import LicensesSection from '@/modules/users/ui/components/LicensesSection';
import WorkRightsSection from '@/modules/users/ui/components/WorkRightsSection';
import { UserContractsSection, AccessCertificatesSection } from '@/modules/users/ui/components/ContractsSection';
import { DeleteUserDialog } from '@/modules/users/ui/components/DeleteUserDialog';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { UserManagementFunctionBar } from '../ui/components/UserManagementFunctionBar';

interface Profile {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
}

const UsersPage: React.FC = () => {
    const { user: currentUser } = useAuth();
    const { isDark } = useTheme();
    const isAuthorizedAdmin = ['epsilon', 'zeta'].includes(currentUser?.highestAccessLevel || '');

    // State
    const [selectedUserId, setSelectedUserId] = useState<string>('');

    // Fetch all profiles
    const profilesResult = useQuery({
        queryKey: ['profiles', 'all'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, first_name, last_name, full_name, email')
                .order('full_name');

            if (error) {
                console.error('[UsersPage] Error fetching profiles:', error);
                throw error;
            }

            // Map the results to ensure we have a clean Profile list
            return (data || []).map(p => ({
                id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                full_name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
                email: p.email,
            })) as Profile[];
        },
    });

    const { refetch: refetchProfiles } = profilesResult;
    const profiles = profilesResult.data || [];
    const isLoading = profilesResult.isLoading;

    const selectedUser = profiles?.find(p => p.id === selectedUserId);

    return (
        <div className="h-full flex flex-col overflow-hidden space-y-4">
            {/* ── Unified Header ────────────────────────────────────────────── */}
            <div className="sticky top-0 z-30 pt-4 pb-4 lg:pb-6">
                <div className={cn(
                    "rounded-[32px] p-4 lg:p-6 transition-all border",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    {/* Row 1 & 2: Identity & Scope Filter */}
                    <PersonalPageHeader
                        title="User Management"
                        Icon={Users}
                        mode="managerial"
                        className="mb-4 lg:mb-6"
                    />

                    {/* Row 3: User Management Function Bar */}
                    <UserManagementFunctionBar
                        profiles={profiles}
                        selectedUserId={selectedUserId}
                        onUserSelect={setSelectedUserId}
                        isZeta={isAuthorizedAdmin}
                        transparent
                    />
                </div>
            </div>

            {/* ── Main Content Area ─────────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <div className={cn(
                    "h-full rounded-[32px] overflow-auto transition-all border p-6 lg:p-10 scrollbar-none",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    {!selectedUserId && !isLoading && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center py-24 text-center space-y-4"
                        >
                            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center shadow-inner">
                                <User className="w-10 h-10 text-primary/40" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-xl font-black uppercase tracking-widest text-foreground/80">No Employee Selected</h3>
                                <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                                    Select an employee from the dropdown above to view their profile, compliance, and performance metrics.
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {selectedUserId && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className="space-y-10"
                        >
                            {/* Summary Action Header for Selected User */}
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-border/10">
                                <div>
                                    <h2 className="text-3xl font-black uppercase tracking-tight text-foreground">{selectedUser?.full_name}</h2>
                                    <p className="text-muted-foreground text-sm font-medium">{selectedUser?.email}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {isAuthorizedAdmin && selectedUser && (
                                        <DeleteUserDialog 
                                            userId={selectedUserId}
                                            userName={selectedUser.full_name}
                                            onSuccess={() => {
                                                setSelectedUserId('');
                                                refetchProfiles();
                                            }}
                                        />
                                    )}
                                    <Button variant="outline" className="rounded-xl h-11 px-6 font-black uppercase tracking-widest text-[10px]">
                                        Edit Profile
                                    </Button>
                                </div>
                            </div>

                            {/* Sectioned Content */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                <SkillsSection employeeId={selectedUserId} />
                                <LicensesSection employeeId={selectedUserId} />
                                <WorkRightsSection employeeId={selectedUserId} />
                            </div>

                            <div className="space-y-8">
                                <UserContractsSection
                                    employeeId={selectedUserId}
                                    employeeName={selectedUser?.full_name || ''}
                                />
                                <AccessCertificatesSection
                                    employeeId={selectedUserId}
                                    employeeName={selectedUser?.full_name || ''}
                                />
                            </div>
                        </motion.div>
                    )}
                </div>
            </div>
        </div>
    );
};


export default UsersPage;
