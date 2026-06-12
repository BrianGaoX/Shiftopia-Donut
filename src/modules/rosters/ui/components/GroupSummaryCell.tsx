import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { RosterSummaryCellDTO } from '../../api/rosterSummary.queries';
import { AlertCircle, Maximize2, Plus } from 'lucide-react';

interface GroupSummaryCellProps {
  date: Date;
  groupName: string;
  summary: RosterSummaryCellDTO | undefined;
  accent: string; // 'blue' | 'emerald' | 'red' | 'gray'
  onClick: () => void;
}

export const GroupSummaryCell: React.FC<GroupSummaryCellProps> = ({
  date,
  summary,
  accent,
  onClick,
}) => {
  const colorMap: Record<string, { bg: string; text: string; bar: string; border: string; hover: string }> = {
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', bar: 'bg-blue-400', border: 'border-blue-500/20', hover: 'hover:bg-blue-500/15 hover:border-blue-500/30' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-400', border: 'border-emerald-500/20', hover: 'hover:bg-emerald-500/15 hover:border-emerald-500/30' },
    red: { bg: 'bg-red-500/10', text: 'text-red-700 dark:text-red-400', bar: 'bg-red-400', border: 'border-red-500/20', hover: 'hover:bg-red-500/15 hover:border-red-500/30' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-400', border: 'border-amber-500/20', hover: 'hover:bg-amber-500/15 hover:border-amber-500/30' },
    gray: { bg: 'bg-slate-500/10', text: 'text-slate-700 dark:text-slate-400', bar: 'bg-slate-400', border: 'border-slate-500/20', hover: 'hover:bg-slate-500/15 hover:border-slate-500/30' },
  };

  const colors = colorMap[accent] || colorMap.gray;

  if (!summary || summary.total_shifts === 0) {
    return (
      <button
        onClick={onClick}
        className="w-full h-[60px] rounded border border-dashed border-border/50 bg-muted/20 flex flex-col items-center justify-center transition-colors hover:bg-muted/40 hover:border-border/80 group"
      >
        <Plus className="w-5 h-5 text-purple-500/80 group-hover:text-purple-400 group-hover:scale-110 transition-all duration-200" />
      </button>
    );
  }

  const { total_shifts, assigned_shifts, open_shifts, published_shifts, total_net_minutes } = summary;
  const coveragePct = Math.min(100, Math.round((assigned_shifts / total_shifts) * 100));

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-md border p-2 flex flex-col gap-2 transition-all group relative",
        colors.bg,
        colors.border,
        colors.hover,
        "text-left"
      )}
    >
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Maximize2 className={cn("w-3.5 h-3.5", colors.text)} />
      </div>

      {/* Row 1: Badges */}
      <div className="flex items-start justify-between">
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-mono h-5 bg-background/50", colors.text)}>
            {total_shifts} shift{total_shifts !== 1 ? 's' : ''}
          </Badge>
          
          {open_shifts > 0 && (
            <Badge variant="destructive" className="px-1.5 py-0 text-[10px] h-5 gap-1 font-mono">
              <AlertCircle className="w-2.5 h-2.5" />
              {open_shifts} open
            </Badge>
          )}
        </div>
      </div>

      {/* Row 2: Coverage Bar */}
      <div className="space-y-1 w-full">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-mono">
          <span className={cn("font-medium", colors.text)}>Coverage</span>
          <span className="text-muted-foreground">{coveragePct}%</span>
        </div>
        <div className="h-1.5 w-full bg-background/50 rounded-full overflow-hidden">
          <div 
            className={cn("h-full rounded-full transition-all duration-500", colors.bar)} 
            style={{ width: `${coveragePct}%` }}
          />
        </div>
      </div>

      {/* Row 3: Meta */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mt-0.5">
        <span>{published_shifts}/{total_shifts} pub</span>
        <span>{(total_net_minutes / 60).toFixed(1)}h</span>
      </div>
    </button>
  );
};
