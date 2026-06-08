import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Label } from '@/modules/core/ui/primitives/label';
import { useEmployeeLicenses, useRemoveEmployeeLicense } from '@/modules/users/hooks/useEmployeeLicenses';
import { Shield, CheckCircle, XCircle, AlertTriangle, AlertOctagon, Loader2, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AddLicenseDialog } from './AddLicenseDialog';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';

interface WorkRightsSectionProps {
    employeeId: string;
    employeeName?: string;
}

const WorkRightsSection: React.FC<WorkRightsSectionProps> = ({ employeeId, employeeName = 'User' }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isToggling, setIsToggling] = useState(false);

    const { data: workRights, isLoading } = useEmployeeLicenses(employeeId, {
        filter: { license_type: 'WorkRights' }
    });
    const { mutate: removeLicense } = useRemoveEmployeeLicense();

    const workRight = workRights?.[0]; // Assuming one work rights entry per employee
    const isStudentVisa = workRight?.license?.name?.includes('Subclass 500');

    const handleToggleWorkLimit = async (checked: boolean) => {
        if (!workRight) return;

        setIsToggling(true);
        try {
            const { error } = await supabase
                .from('employee_licenses')
                .update({ has_restricted_work_limit: checked })
                .eq('id', workRight.id);

            if (error) throw error;

            queryClient.invalidateQueries({ queryKey: ['employee_licenses', employeeId] });
            toast({
                title: checked ? 'Restrictions Applied' : 'Restrictions Removed',
                description: checked ? 'Work hours limited to 48h per fortnight.' : 'Work hour restrictions removed.'
            });
        } catch (error) {
            console.error('Error updating work limit:', error);
            toast({ title: 'Error', description: 'Failed to update work limit settings', variant: 'destructive' });
        } finally {
            setIsToggling(false);
        }
    };

    const handleDelete = async () => {
        if (!workRight || !confirm('Are you sure you want to remove this work right record?')) return;
        removeLicense({ id: workRight.id, employeeId });
    };

    const getVerificationBadge = () => {
        if (!workRight) return null;

        switch (workRight.verification_status) {
            case 'Verified':
                return (
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                        <CheckCircle className="w-5 h-5" />
                        <div>
                            <p className="font-medium">VEVO Verified</p>
                            {workRight.last_checked_at && (
                                <p className="text-xs text-muted-foreground">
                                    Last checked: {format(parseISO(workRight.last_checked_at), 'MMM d, yyyy HH:mm')}
                                </p>
                            )}
                        </div>
                    </div>
                );
            case 'Failed':
                return (
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                        <XCircle className="w-5 h-5" />
                        <p className="font-medium">Verification Failed</p>
                    </div>
                );
            case 'Expired':
                return (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-5 h-5" />
                        <p className="font-medium">Verification Expired</p>
                    </div>
                );
            default:
                return (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <AlertTriangle className="w-5 h-5" />
                        <p className="font-medium">Not Verified</p>
                    </div>
                );
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900 flex items-center justify-between">
                <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-slate-500" />
                        Work Rights
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium pl-6 uppercase tracking-wider">
                        Visa status and employment eligibility
                    </p>
                </div>
                {!workRight && (
                    <AddLicenseDialog
                        employeeId={employeeId}
                        employeeName={employeeName}
                        type="WorkRights"
                        existingLicenseIds={workRights?.map(l => l.license_id) || []}
                    />
                )}
            </div>
            <div className="p-5 flex-1">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full py-8">
                        <p className="text-slate-400 text-sm animate-pulse">Loading work rights...</p>
                    </div>
                ) : !workRight ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center text-slate-400">
                        <Shield className="w-8 h-8 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No work rights recorded</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all group p-4">
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                    <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{workRight.license?.name || 'Work Rights'}</h4>
                                    {workRight.license?.description && (
                                        <p className="text-[11px] text-slate-500 mt-1">{workRight.license.description}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    <Badge className={
                                        workRight.status === 'Active'
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                            : 'bg-destructive/10 text-destructive border border-destructive/20'
                                    }>
                                        {workRight.status}
                                    </Badge>
                                    <button
                                        onClick={handleDelete}
                                        className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-all p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                        title="Remove Work Rights"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-4 text-[10px] text-slate-400 uppercase tracking-widest font-semibold mt-3">
                                {workRight.issue_date && (
                                    <span>Issued: {format(parseISO(workRight.issue_date), 'MMM d, yyyy')}</span>
                                )}
                                {workRight.expiration_date && (
                                    <span>Expires: {format(parseISO(workRight.expiration_date), 'MMM d, yyyy')}</span>
                                )}
                            </div>
                            <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                {getVerificationBadge()}
                            </div>
                        </div>

                        {/* Student Visa Restrictions Toggle */}
                        {isStudentVisa && (
                            <div className="bg-amber-500/5 p-4 rounded-lg border border-amber-500/20">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="space-y-0.5">
                                        <Label className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-2">
                                            <AlertOctagon className="w-4 h-4" />
                                            Student Visa Restrictions (Subclass 500)
                                        </Label>
                                        <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                                            Limit work hours during study sessions
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isToggling && <Loader2 className="w-3 h-3 animate-spin text-amber-600 dark:text-amber-400" />}
                                        <Switch
                                            checked={workRight.has_restricted_work_limit || false}
                                            onCheckedChange={handleToggleWorkLimit}
                                            disabled={isToggling}
                                            className="data-[state=checked]:bg-amber-500"
                                        />
                                    </div>
                                </div>

                                {workRight.has_restricted_work_limit && (
                                    <div className="mt-3 p-3 bg-amber-500/10 rounded border border-amber-500/20 text-amber-700 dark:text-amber-300 text-sm">
                                        <strong>Restriction Active:</strong> Cannot work more than 48 hours a fortnight when course of study or training is in session.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkRightsSection;
