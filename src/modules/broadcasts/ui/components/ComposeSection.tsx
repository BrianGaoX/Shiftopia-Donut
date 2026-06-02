import React, { useState, useRef } from 'react';
import { Edit3, Pin, FileText, Upload, X, Send, Loader2, AlertTriangle, Bell, MessageSquare } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { cn } from '@/modules/core/lib/utils';
import { RichTextEditor } from './RichTextEditor';
import { BroadcastPriority, CreateBroadcastRequest } from '../../model/broadcast.types';

const PRIORITY_CONFIG: Record<
    BroadcastPriority,
    {
        label: string;
        color: string;
        bg: string;
        icon: React.ReactNode;
    }
> = {
    urgent: {
        label: 'Urgent',
        color: 'text-red-400',
        bg: 'bg-red-500/20 border-red-500/40',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
    },
    high: {
        label: 'High',
        color: 'text-orange-400',
        bg: 'bg-orange-500/20 border-orange-500/40',
        icon: <Bell className="h-3.5 w-3.5" />,
    },
    normal: {
        label: 'Normal',
        color: 'text-blue-400',
        bg: 'bg-blue-500/20 border-blue-500/40',
        icon: <MessageSquare className="h-3.5 w-3.5" />,
    },
    low: {
        label: 'Low',
        color: 'text-slate-400',
        bg: 'bg-slate-500/20 border-slate-500/40',
        icon: <MessageSquare className="h-3.5 w-3.5" />,
    },
};

const formatFileSizeLocal = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface ComposeSectionProps {
    channelId: string;
    channelName: string;
    groupName: string;
    totalRecipients: number;
    onSend: (data: Omit<CreateBroadcastRequest, 'channelId'>) => Promise<void>;
    isLoading?: boolean;
}

export const ComposeSection: React.FC<ComposeSectionProps> = ({
    channelId,
    channelName,
    groupName,
    totalRecipients,
    onSend,
    isLoading,
}) => {
    const [subject, setSubject] = useState('');
    const [content, setContent] = useState('');
    const [priority, setPriority] = useState<BroadcastPriority>('normal');
    // requiresAck removed
    const [isPinned, setIsPinned] = useState(false);
    const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const canSend = content.replace(/<[^>]*>/g, '').trim().length > 0;

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        setAttachmentFiles((prev) => [...prev, ...Array.from(files)]);
        e.target.value = '';
    };

    const removeAttachment = (index: number) => {
        setAttachmentFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleConfirmSend = async () => {
        setIsSending(true);
        try {
            await onSend({
                subject,
                content,
                priority,
                requiresAcknowledgement: false,
                isPinned,
                attachments: attachmentFiles.map((file) => ({ file, name: file.name })),
            });
            setSubject('');
            setContent('');
            setPriority('normal');
            // setRequiresAck removed
            setIsPinned(false);
            setAttachmentFiles([]);
            setShowConfirmDialog(false);
        } finally {
            setIsSending(false);
        }
    };

    return (
        <>
            <div className="bg-card/50 rounded-2xl border border-border p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <Edit3 className="h-5 w-5 text-primary" />
                        Compose Broadcast
                    </h3>
                    <div className="flex items-center gap-2">
                        <Switch id="pin" checked={isPinned} onCheckedChange={setIsPinned} />
                        <Label
                            htmlFor="pin"
                            className="text-sm text-muted-foreground flex items-center gap-1"
                        >
                            <Pin className="h-3.5 w-3.5" /> Pin
                        </Label>
                    </div>
                </div>

                <Input
                    placeholder="Subject (optional)"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mb-3 bg-muted/50 border-border"
                />

                <div className="mb-4">
                    <RichTextEditor
                        value={content}
                        onChange={setContent}
                        placeholder="Type your broadcast message here..."
                    />
                </div>

                <div className="flex items-center gap-4 mb-4">
                    <span className="text-sm text-muted-foreground">Priority:</span>
                    <div className="flex gap-2">
                        {(['low', 'normal', 'high', 'urgent'] as BroadcastPriority[]).map((p) => (
                            <Button
                                key={p}
                                variant={priority === p ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setPriority(p)}
                                className={cn(
                                    priority === p &&
                                    p === 'urgent' &&
                                    'bg-red-600 hover:bg-red-700',
                                    priority === p &&
                                    p === 'high' &&
                                    'bg-orange-600 hover:bg-orange-700',
                                    priority === p &&
                                    p === 'normal' &&
                                    'bg-blue-600 hover:bg-blue-700',
                                    priority === p &&
                                    p === 'low' &&
                                    'bg-slate-600 hover:bg-slate-700'
                                )}
                            >
                                {PRIORITY_CONFIG[p].icon}
                                <span className="ml-1 capitalize">{p}</span>
                            </Button>
                        ))}
                    </div>
                </div>

                {attachmentFiles.length > 0 && (
                    <div className="mb-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-2">
                            Attachments ({attachmentFiles.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {attachmentFiles.map((file, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm"
                                >
                                    <FileText className="h-4 w-4" />
                                    <span className="truncate max-w-[120px]">{file.name}</span>
                                    <span className="text-muted-foreground text-xs">
                                        {formatFileSizeLocal(file.size)}
                                    </span>
                                    <button
                                        onClick={() => removeAttachment(idx)}
                                        className="text-muted-foreground hover:text-red-400 transition-colors"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            multiple
                            className="hidden"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload className="h-4 w-4" />
                            Add Attachment
                        </Button>
                        {/* Require Acknowledgement removed */}
                    </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                        Visible to{' '}
                        <span className="text-foreground font-medium">
                            {totalRecipients}
                        </span>{' '}
                        channel participants
                    </p>
                    <Button
                        onClick={() => setShowConfirmDialog(true)}
                        disabled={!canSend || isLoading}
                        className="gap-2"
                    >
                        <Send className="h-4 w-4" />
                        Send Broadcast
                    </Button>
                </div>
            </div>

            <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Broadcast</AlertDialogTitle>
                        <AlertDialogDescription>
                            Please review the broadcast details before sending.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="space-y-3 py-4">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Group:</span>
                            <span className="font-medium">{groupName}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Channel:</span>
                            <span className="font-medium">{channelName}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Priority:</span>
                            <Badge
                                className={cn(
                                    'text-xs',
                                    PRIORITY_CONFIG[priority].bg,
                                    PRIORITY_CONFIG[priority].color
                                )}
                            >
                                {PRIORITY_CONFIG[priority].icon}
                                <span className="ml-1 capitalize">{priority}</span>
                            </Badge>
                        </div>
                        {/* Acknowledgement confirmation row removed */}
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Recipients:</span>
                            <span className="font-medium">
                                {totalRecipients} participants
                            </span>
                        </div>
                        {attachmentFiles.length > 0 && (
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Attachments:</span>
                                <span className="font-medium">
                                    {attachmentFiles.length} file(s)
                                </span>
                            </div>
                        )}
                    </div>

                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmSend} disabled={isSending}>
                            {isSending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4 mr-2" />
                            )}
                            {isSending ? 'Sending...' : 'Send Broadcast'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
