import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { 
    Briefcase, 
    Shield, 
    Trash2, 
    Clock, 
    Building2, 
    ChevronRight, 
    CheckCircle2, 
    AlertCircle,
    User,
    Crown,
    Globe,
    Zap,
    Plus,
    Pencil
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AddContractDialog } from './AddContractDialog';
import { AccessCertificateDialog } from './AddAccessCertificateDialog';
import { useAuth } from '@/platform/auth/useAuth';
import { cn } from '@/modules/core/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface SectionProps {
    employeeId: string;
    employeeName: string;
}

// =============================================
// 1. User Contracts Section
// =============================================

export const UserContractsSection: React.FC<SectionProps> = ({ employeeId, employeeName }) => {
    const queryClient = useQueryClient();
    const { user: currentUser } = useAuth();
    const isAuthorizedAdmin = ['epsilon', 'zeta'].includes(currentUser?.highestAccessLevel || '');

    const { data: contracts, isLoading } = useQuery({
        queryKey: ['user_contracts', employeeId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('user_contracts')
                .select(`
                    *,
                    organizations(name),
                    departments(name),
                    sub_departments(name),
                    roles(name)
                `)
                .eq('user_id', employeeId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
        enabled: !!employeeId
    });

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to remove this contract?')) return;
        
        const { error } = await supabase
            .from('user_contracts')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Delete error:', error);
            return;
        }

        queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });
    };

    return (
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm shadow-xl rounded-[2rem] overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/10 pb-6">
                <div>
                    <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary shadow-inner">
                            <Briefcase className="w-5 h-5" />
                        </div>
                        Employment Contracts
                    </CardTitle>
                </div>
                {isAuthorizedAdmin && (
                    <AddContractDialog employeeId={employeeId} employeeName={employeeName} />
                )}
            </CardHeader>
            <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {isLoading ? (
                        Array.from({ length: 2 }).map((_, i) => (
                            <div key={i} className="h-32 rounded-2xl bg-muted/20 animate-pulse" />
                        ))
                    ) : contracts?.length === 0 ? (
                        <div className="col-span-full py-12 flex flex-col items-center text-muted-foreground">
                            <Briefcase className="w-12 h-12 mb-4 opacity-20" />
                            <p className="text-sm font-medium">No active contracts found</p>
                        </div>
                    ) : (
                        contracts?.map((contract) => (
                            <motion.div
                                key={contract.id}
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="group relative p-5 rounded-2xl border border-border/40 bg-card hover:border-primary/30 hover:shadow-lg transition-all duration-300"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div className="space-y-1">
                                        <h4 className="font-bold text-lg text-foreground capitalize">
                                            {contract.roles?.name || 'Unknown Role'}
                                        </h4>
                                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 rounded-lg">
                                            {contract.employment_status || 'Casual'}
                                        </Badge>
                                    </div>
                                    {isAuthorizedAdmin && (
                                        <div className="flex gap-1">
                                            <AddContractDialog 
                                                employeeId={employeeId} 
                                                employeeName={employeeName} 
                                                existingContract={contract}
                                                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] })}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDelete(contract.id)}
                                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Building2 className="w-4 h-4 text-primary/40" />
                                        <span className="font-medium">{contract.organizations?.name}</span>
                                        <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                                        <span>{contract.departments?.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black text-muted-foreground/60">
                                        <Clock className="w-3 h-3" />
                                        Created: {contract.created_at ? format(parseISO(contract.created_at), 'MMM d, yyyy') : 'N/A'}
                                    </div>
                                </div>

                                <div className="absolute top-5 right-5 flex gap-2">
                                    {contract.status === 'Active' ? (
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                    ) : (
                                        <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                                    )}
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

// =============================================
// 2. Access Certificates Section
// =============================================

export const AccessCertificatesSection: React.FC<SectionProps> = ({ employeeId, employeeName }) => {
    const queryClient = useQueryClient();
    const { user: currentUser } = useAuth();
    const isAuthorizedAdmin = ['epsilon', 'zeta'].includes(currentUser?.highestAccessLevel || '');

    const { data: certificates, isLoading } = useQuery({
        queryKey: ['access_certificates', employeeId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('app_access_certificates')
                .select(`
                    *,
                    organizations(name),
                    departments(name),
                    sub_departments(name)
                `)
                .eq('user_id', employeeId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
        enabled: !!employeeId
    });

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to revoke this certificate?')) return;
        
        const { error } = await supabase
            .from('app_access_certificates')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Revoke error:', error);
            return;
        }

        queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] });
    };

    const getIcon = (level: string) => {
        switch (level?.toLowerCase()) {
            case 'zeta': return <Zap className="w-5 h-5 text-rose-400" />;
            case 'epsilon': return <Globe className="w-5 h-5 text-emerald-400" />;
            case 'delta': return <Crown className="w-5 h-5 text-amber-400" />;
            case 'gamma': return <Building2 className="w-5 h-5 text-purple-400" />;
            case 'beta': return <Shield className="w-5 h-5 text-blue-400" />;
            default: return <User className="w-5 h-5 text-slate-400" />;
        }
    };

    return (
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm shadow-xl rounded-[2rem] overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/10 pb-6">
                <div>
                    <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 shadow-inner">
                            <Shield className="w-5 h-5" />
                        </div>
                        System Access Certificates
                    </CardTitle>
                </div>
                {isAuthorizedAdmin && (
                    <AccessCertificateDialog 
                        employeeId={employeeId} 
                        employeeName={employeeName} 
                        existingCertificates={certificates || []}
                        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] })}
                    />
                )}
            </CardHeader>
            <CardContent className="p-6">
                <div className="space-y-4">
                    {isLoading ? (
                        <div className="space-y-4">
                            <div className="h-20 rounded-2xl bg-muted/20 animate-pulse" />
                            <div className="h-20 rounded-2xl bg-muted/20 animate-pulse" />
                        </div>
                    ) : !certificates || certificates.length === 0 ? (
                        <div className="py-12 flex flex-col items-center text-muted-foreground text-center">
                            <Shield className="w-12 h-12 mb-4 opacity-10" />
                            <p className="text-sm font-medium">No access certificates issued</p>
                            <p className="text-xs max-w-xs mt-1">Access certificates determine data visibility and administrative permissions.</p>
                        </div>
                    ) : (
                        certificates.map((cert) => (
                            <motion.div
                                key={cert.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className={cn(
                                    "group p-5 rounded-2xl border transition-all duration-300 flex items-center gap-6",
                                    cert.is_active !== false 
                                        ? "border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40" 
                                        : "border-border/40 bg-muted/10 grayscale opacity-60"
                                )}
                            >
                                <div className="p-3 rounded-xl bg-card border border-border/40 shadow-sm">
                                    {getIcon(cert.access_level)}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h4 className="font-black uppercase tracking-tight text-foreground">
                                            {cert.access_level} Access
                                        </h4>
                                        <Badge variant="outline" className={cn(
                                            "rounded-lg px-2 py-0 h-5 text-[10px] font-black uppercase tracking-wider",
                                            cert.certificate_type === 'Y' 
                                                ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                                                : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                        )}>
                                            Type {cert.certificate_type}
                                        </Badge>
                                        {cert.is_active === false && (
                                            <Badge variant="destructive" className="rounded-lg h-5 text-[10px]">Inactive</Badge>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground font-medium">
                                        <div className="flex items-center gap-1.5">
                                            <Building2 className="w-3.5 h-3.5 opacity-40" />
                                            {cert.organizations?.name || 'Global'}
                                        </div>
                                        {cert.departments?.name && (
                                            <>
                                                <ChevronRight className="w-3 h-3 opacity-20" />
                                                <span>{cert.departments.name}</span>
                                            </>
                                        )}
                                        {cert.sub_departments?.name && (
                                            <>
                                                <ChevronRight className="w-3 h-3 opacity-20" />
                                                <span>{cert.sub_departments.name}</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-1">
                                    {isAuthorizedAdmin && (
                                        <>
                                            <AccessCertificateDialog 
                                                employeeId={employeeId} 
                                                employeeName={employeeName} 
                                                existingCertificates={certificates || []}
                                                certificateToEdit={cert}
                                                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] })}
                                                trigger={
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-muted-foreground hover:text-primary transition-all"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                }
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDelete(cert.id)}
                                                className="text-muted-foreground hover:text-destructive transition-all"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </>
                                    )}
                                    <div className={cn(
                                        "w-2.5 h-2.5 rounded-full ml-2",
                                        cert.is_active !== false ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-muted-foreground/30"
                                    )} />
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>

                <div className="mt-8 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex gap-4">
                    <div className="p-2 rounded-xl bg-amber-500/10 h-fit">
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-xs font-bold text-amber-500 uppercase tracking-widest">Security Protocol</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Access certificates define the organizational boundaries of user data. Type Y certificates provide managerial scope, while Type X certificates are restricted to individual employee data access.
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
