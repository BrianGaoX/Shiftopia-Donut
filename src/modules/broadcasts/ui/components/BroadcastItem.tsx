import React from 'react';
import DOMPurify from 'dompurify';
import {
    Pin,
    AlertTriangle,
    Bell,
    MessageSquare,
    MoreVertical,
    Eye,
    BellRing,
    FileText,
    Image,
    FileSpreadsheet,
    File,
    Download,
    CheckCircle2,
    Shield,
    Crown,
    Trash2,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { Progress } from '@/modules/core/ui/primitives/progress';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import {
    BroadcastWithDetails,
    BroadcastPriority,
    BroadcastParticipantRole,
} from '../../model/broadcast.types';

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

const ROLE_CONFIG: Record<
    BroadcastParticipantRole,
    { label: string; icon: React.ReactNode; color: string }
> = {
    admin: {
        label: 'Admin',
        icon: <Shield className="h-3 w-3" />,
        color: 'text-red-400',
    },
    broadcaster: {
        label: 'Broadcaster',
        icon: <Crown className="h-3 w-3" />,
        color: 'text-amber-400',
    },
    lead: {
        label: 'Lead',
        icon: <Shield className="h-3 w-3 text-blue-400" />,
        color: 'text-blue-400',
    },
    member: { label: 'Member', icon: null, color: 'text-muted-foreground' },
};

const FILE_ICONS: Record<string, React.ReactNode> = {
    pdf: <FileText className="h-4 w-4 text-red-400" />,
    image: <Image className="h-4 w-4 text-green-400" />,
    document: <FileText className="h-4 w-4 text-blue-400" />,
    spreadsheet: <FileSpreadsheet className="h-4 w-4 text-emerald-400" />,
    other: <File className="h-4 w-4 text-gray-400" />,
};

const formatFileSizeLocal = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface BroadcastItemProps {
    broadcast: BroadcastWithDetails;
    onTogglePin: () => void;
    onDelete: () => void;
}

export const BroadcastItem: React.FC<BroadcastItemProps> = ({
    broadcast,
    onTogglePin,
    onDelete,
}) => {
    const priorityConfig = PRIORITY_CONFIG[broadcast.priority];

    return (
        <div
            className={cn(
                'rounded-2xl border-2 transition-all duration-200',
                broadcast.isPinned
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-card/60 border-border/50',
                broadcast.priority === 'urgent' &&
                !broadcast.isPinned &&
                'border-red-500/40 bg-red-500/5'
            )}
        >
            {broadcast.isPinned && (
                <div className="px-5 py-2 border-b border-amber-500/20 flex items-center gap-2 text-amber-400 text-sm">
                    <Pin className="h-4 w-4" />
                    <span className="font-semibold">Pinned</span>
                </div>
            )}

            <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                            <AvatarFallback className="bg-primary/20 text-primary">
                                {broadcast.author?.name
                                    ?.split(' ')
                                    .map((n) => n[0])
                                    .join('') || '?'}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-foreground">
                                    {broadcast.author?.name || 'Unknown'}
                                </span>
                                <span
                                    className={cn(
                                        'text-xs',
                                        ROLE_CONFIG[broadcast.authorRole]?.color
                                    )}
                                >
                                    {ROLE_CONFIG[broadcast.authorRole]?.label}
                                </span>
                                <Badge
                                    className={cn(
                                        'text-xs',
                                        priorityConfig.bg,
                                        priorityConfig.color
                                    )}
                                >
                                    {priorityConfig.icon}
                                    <span className="ml-1">{priorityConfig.label}</span>
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {format(
                                    new Date(broadcast.createdAt),
                                    "MMM d, yyyy 'at' h:mm a"
                                )}
                            </p>
                        </div>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={onTogglePin}>
                                <Pin className="h-4 w-4 mr-2" />
                                {broadcast.isPinned ? 'Unpin' : 'Pin'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={onDelete}
                                className="text-destructive focus:text-destructive"
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {broadcast.subject && (
                    <h4 className="font-semibold text-foreground mb-2">
                        {broadcast.subject}
                    </h4>
                )}

                <div
                    className="text-foreground/80 text-sm leading-relaxed mb-4 prose prose-sm prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(broadcast.content) }}
                />

                {broadcast.attachments && broadcast.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {broadcast.attachments.map((att) => (
                            <div
                                key={att.id}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm cursor-pointer hover:bg-muted transition-colors"
                                onClick={() => window.open(att.fileUrl, '_blank')}
                            >
                                {FILE_ICONS[att.fileType] || FILE_ICONS.other}
                                <span className="truncate max-w-[120px]">{att.fileName}</span>
                                <span className="text-muted-foreground text-xs">
                                    {formatFileSizeLocal(att.fileSize ?? 0)}
                                </span>
                                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                        ))}
                    </div>
                )}

                {/* Acknowledgement stats removed */}

                {/* No acknowledgement required text removed */}
            </div>
        </div>
    );
};
