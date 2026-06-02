import React from 'react';
import { ShieldAlert, XCircle, AlertTriangle } from 'lucide-react';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/modules/core/ui/primitives/alert-dialog';
import type { ComplianceResult } from '@/modules/rosters/services/compliance.service';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    result: ComplianceResult | null;
    onCancel: () => void;
    onConfirm: () => void;
}

export const BidConfirmComplianceDialog: React.FC<Props> = ({
    open, onOpenChange, result, onCancel, onConfirm,
}) => {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="bg-background border-border text-foreground rounded-[24px]" aria-describedby={undefined}>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
                        <ShieldAlert className="h-6 w-6 text-amber-500" />
                        {result?.status === 'violated' ? 'Compliance Issue' : 'Advisory Notice'}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-base font-medium">
                        {result?.status === 'violated'
                            ? 'This shift has a blocking compliance issue. You cannot bid on this shift.'
                            : 'This shift has a compliance warning. You may still proceed, but your bid may be reviewed.'}
                    </AlertDialogDescription>
                    <div className="space-y-1 mt-2">
                        {result?.violations.map((v, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm text-red-500 font-bold bg-red-500/5 p-2 rounded-lg border border-red-500/10">
                                <XCircle className="h-4 w-4 shrink-0" /> {v}
                            </div>
                        ))}
                        {result?.warnings.map((w, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm text-amber-500 font-bold bg-amber-500/5 p-2 rounded-lg border border-amber-500/10">
                                <AlertTriangle className="h-4 w-4 shrink-0" /> {w}
                            </div>
                        ))}
                    </div>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-4 gap-2">
                    <AlertDialogCancel onClick={onCancel} className="rounded-xl border-border/50 font-black uppercase tracking-widest text-[10px]">Cancel</AlertDialogCancel>
                    {result?.status !== 'violated' && (
                        <AlertDialogAction onClick={onConfirm} className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black uppercase tracking-widest text-[10px]">
                            Proceed Anyway
                        </AlertDialogAction>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
