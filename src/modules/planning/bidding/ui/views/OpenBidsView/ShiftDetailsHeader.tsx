// src/modules/planning/bidding/ui/views/OpenBidsView/ShiftDetailsHeader.tsx

import React from 'react';
import { Clock, DollarSign, Building, Calendar, Coffee, Ban } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { getGroupColors, calculateTimeRemaining, formatTimeRemaining } from './utils';
import type { OpenShift } from './types';

interface ShiftDetailsHeaderProps {
  shift: OpenShift;
  onWithdraw?: () => void;
}

export const ShiftDetailsHeader: React.FC<ShiftDetailsHeaderProps> = ({
  shift,
  onWithdraw,
}) => {
  const colors = getGroupColors(shift.group as any);
  const timeRemaining = calculateTimeRemaining(shift.biddingDeadline);

  return (
    <div className="shrink-0 relative overflow-hidden border-b border-border bg-card">
      {/* Ambient Background Glow */}
      <div className={cn('absolute inset-0 opacity-[0.08] blur-[100px]', colors.bg)} />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/90" />

      <div className="relative z-10 p-6 pb-5">
        {/* Top Row: Badges + Withdraw */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cn('text-[9px] px-2.5 py-0.5 font-black uppercase tracking-widest border-none rounded-lg shadow-sm', colors.accent)}>
              {shift.groupLabel}
            </Badge>
            {shift.subDepartment && (
              <Badge className="text-[9px] px-2.5 py-0.5 font-black uppercase tracking-widest bg-muted/50 border-border/50 text-muted-foreground/60 rounded-lg">
                {shift.subDepartment}
              </Badge>
            )}
            <span className="text-primary/20 text-[11px] mx-1">•</span>
            <span className="text-muted-foreground/60 text-[11px] font-black uppercase font-mono tracking-wider">{shift.dayLabel}</span>
          </div>

          {onWithdraw && (
            <Button
              variant="outline"
              size="sm"
              onClick={onWithdraw}
              className="h-8 text-[10px] font-black uppercase tracking-widest border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all shadow-sm"
            >
              <Ban className="h-3.5 w-3.5 mr-2" />
              Withdraw Bid
            </Button>
          )}
        </div>

        {/* Role Title */}
        <h1 className="text-4xl font-black text-foreground tracking-tight leading-none mb-6">
          {shift.role}
        </h1>

        {/* Info Grid */}
        <div className="flex items-center gap-6 text-[11px] text-muted-foreground flex-wrap font-black uppercase tracking-widest font-mono">
          <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 rounded-xl border border-border/50">
            <Clock className="h-4 w-4 text-primary" />
            <span className="text-foreground">{shift.startTime} – {shift.endTime}</span>
          </div>
          <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 rounded-xl border border-border/50">
            <Calendar className="h-4 w-4 text-primary" />
            <span className="text-foreground">{shift.date}</span>
          </div>
          {shift.remunerationLevel && (
            <div className="flex items-center gap-2 bg-emerald-500/5 px-3 py-1.5 rounded-xl border border-emerald-500/10">
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-600 dark:text-emerald-400">{shift.remunerationLevel}</span>
            </div>
          )}
          <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 rounded-xl border border-border/50">
            <Building className="h-4 w-4 text-primary" />
            <span className="text-foreground">{shift.department}</span>
          </div>
          <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 rounded-xl border border-border/50">
            <Coffee className="h-4 w-4 text-orange-500/50" />
            <span className="text-foreground">Net {shift.netHours}h</span>
          </div>
        </div>

        {/* Countdown Strip */}
        <div className="mt-6 flex items-center gap-4">
          <div className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] border shadow-sm',
            timeRemaining.isExpired
              ? 'bg-muted border-border text-muted-foreground/30 shadow-none'
              : timeRemaining.hours < 4
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400 animate-pulse'
                : 'bg-amber-500/5 border-amber-500/10 text-amber-600 dark:text-amber-400'
          )}>
            <Clock className="h-4 w-4" />
            {timeRemaining.isExpired ? 'EXPIRED' : `Closes in ${formatTimeRemaining(timeRemaining)}`}
          </div>
          <span className="text-[10px] text-muted-foreground/20 font-black font-mono tracking-widest uppercase">{shift.stateId}</span>
        </div>
      </div>
    </div>
  );
};
