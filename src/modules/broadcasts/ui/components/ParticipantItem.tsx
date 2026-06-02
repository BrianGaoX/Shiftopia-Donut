import React from 'react';
import { UserMinus, Shield, Crown } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { cn } from '@/modules/core/lib/utils';
import {
    GroupParticipantWithDetails,
    BroadcastParticipantRole,
} from '../../model/broadcast.types';
import { motion } from 'framer-motion';

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
    member: { label: 'Member', icon: null, color: 'text-muted-foreground' },
    lead: { label: 'Lead', icon: <Crown className="h-3 w-3" />, color: 'text-blue-400' },
};

interface ParticipantItemProps {
    participant: GroupParticipantWithDetails;
    onRemove: () => void;
    isEditMode?: boolean;
}

export const ParticipantItem: React.FC<ParticipantItemProps> = ({
    participant,
    onRemove,
    isEditMode = false,
}) => {
    const roleConfig = ROLE_CONFIG[participant.role];

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 280, damping: 26 } }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors group"
        >
            <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/20 text-primary text-sm">
                    {participant.employee?.name
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('') || '?'}
                </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                        {participant.employee?.name || 'Unknown'}
                    </span>
                    {roleConfig.icon && (
                        <span className={roleConfig.color}>{roleConfig.icon}</span>
                    )}
                </div>
                <p className={cn('text-xs', roleConfig.color)}>{roleConfig.label}</p>
            </div>
            {isEditMode && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={onRemove}
                >
                    <UserMinus className="h-3.5 w-3.5" />
                </Button>
            )}
        </motion.div>
    );
};
