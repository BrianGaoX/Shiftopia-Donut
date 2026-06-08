import React, { useState } from 'react';
import { 
    AlertDialog, 
    AlertDialogAction, 
    AlertDialogCancel, 
    AlertDialogContent, 
    AlertDialogDescription, 
    AlertDialogFooter, 
    AlertDialogHeader, 
    AlertDialogTitle, 
    AlertDialogTrigger 
} from '@/modules/core/ui/primitives/alert-dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { supabase } from '@/platform/supabase/client';
import { toast } from 'sonner';
import { User as UserIcon, Trash2, AlertTriangle, Loader2 } from 'lucide-react';

interface DeleteUserDialogProps {
    userId: string;
    userName: string;
    onSuccess: () => void;
}

export const DeleteUserDialog: React.FC<DeleteUserDialogProps> = ({ 
    userId, 
    userName,
    onSuccess 
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const handleDelete = async () => {
        setIsLoading(true);
        try {
            const { error } = await supabase.rpc('delete_user_entirely', {
                user_uuid: userId
            });

            if (error) throw error;

            toast.success(`User "${userName}" and all associated data have been deleted.`);
            setIsOpen(false);
            onSuccess();
        } catch (error: any) {
            console.error('[DeleteUserDialog] Deletion failed:', error);
            toast.error(error.message || 'Failed to delete user. Ensure you have Zeta access.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
            <AlertDialogTrigger asChild>
                <Button 
                    variant="destructive" 
                    className="bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-200 dark:shadow-none h-9 px-4 rounded-lg font-medium text-xs transition-all focus:ring-2 focus:ring-red-600 focus:ring-offset-2 dark:focus:ring-offset-slate-950"
                >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    Delete User
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl max-w-md">
                <AlertDialogHeader>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500" />
                        </div>
                        <AlertDialogTitle className="text-xl font-bold text-slate-900 dark:text-slate-100">
                            Confirm Deletion
                        </AlertDialogTitle>
                    </div>
                    <AlertDialogDescription asChild>
                        <div className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                            Are you sure you want to delete <span className="font-semibold text-slate-900 dark:text-slate-100">{userName}</span>? 
                            This action is <span className="font-bold underline text-red-600 dark:text-red-500 underline-offset-4">irrevocable</span> and will perform a hard delete of:
                            <ul className="list-disc list-inside mt-2 space-y-1">
                                <li>Profile and Login Credentials</li>
                                <li>Contracts and Employment History</li>
                                <li>Skills, Licenses, and Certificates</li>
                                <li>Past Performance Metrics</li>
                            </ul>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-6 gap-3">
                    <AlertDialogCancel asChild>
                        <Button 
                            variant="outline" 
                            disabled={isLoading}
                            className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            Cancel
                        </Button>
                    </AlertDialogCancel>
                    <Button 
                        variant="destructive" 
                        onClick={handleDelete}
                        disabled={isLoading}
                        className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6"
                    >
                        {isLoading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <Trash2 className="w-4 h-4 mr-2" />
                        )}
                        Delete Permanently
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
