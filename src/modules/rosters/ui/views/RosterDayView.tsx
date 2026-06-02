import React, { useState } from 'react';
import { Roster } from '@/modules/core/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ShiftChip } from '../components/ShiftChip';
import { cn } from '@/modules/core/lib/utils';

type DepartmentName = string;
type DepartmentColor = string;

export interface RosterDayViewProps {
  date: Date;
  roster: Roster | null;
  readOnly?: boolean;
  onAddGroup?: (group: { name: DepartmentName; color: DepartmentColor }) => void;
  onShiftClick?: (shiftId: string, groupId: number, subGroupId: number) => void;
}

export const RosterDayView: React.FC<RosterDayViewProps> = ({
  date,
  roster,
  readOnly = false,
  onAddGroup,
  onShiftClick
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [expandedSubGroups, setExpandedSubGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupId: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleSubGroup = (groupId: number, subGroupId: number) => {
    const key = `${groupId}-${subGroupId}`;
    setExpandedSubGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getColorClass = (color: string) => {
    const colors: Record<string, string> = {
      blue: 'border-blue-500/30 bg-blue-500/5',
      green: 'border-green-500/30 bg-green-500/5',
      red: 'border-red-500/30 bg-red-500/5',
      purple: 'border-purple-500/30 bg-purple-500/5',
      sky: 'border-sky-500/30 bg-sky-500/5',
      orange: 'border-orange-500/30 bg-orange-500/5',
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="space-y-4">
      {roster && (roster as any).groups && (roster as any).groups.map((group: any) => {
        const isGroupExpanded = expandedGroups.has(group.id);

        return (
          <div key={group.id} className={cn(
            "border rounded-lg overflow-hidden",
            getColorClass(group.color)
          )}>
            <button
              onClick={() => toggleGroup(group.id)}
              className="w-full px-4 py-3 flex items-center justify-between bg-black/20 hover:bg-black/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isGroupExpanded ? (
                  <ChevronDown className="w-5 h-5 text-white/70" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-white/70" />
                )}
                <h3 className="text-lg font-semibold text-white">{group.name}</h3>
                <span className="text-sm text-white/60">
                  {group.subGroups.reduce((sum, sg) => sum + sg.shifts.length, 0)} shifts
                </span>
              </div>
            </button>

            {isGroupExpanded && (
              <div className="p-4 space-y-4">
                {group.subGroups.map(subGroup => {
                  const subKey = `${group.id}-${subGroup.id}`;
                  const isSubGroupExpanded = expandedSubGroups.has(subKey);

                  return (
                    <div key={subGroup.id} className="border border-white/10 rounded-lg overflow-hidden bg-black/10">
                      <button
                        onClick={() => toggleSubGroup(group.id, subGroup.id)}
                        className="w-full px-4 py-2 flex items-center justify-between hover:bg-black/20 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {isSubGroupExpanded ? (
                            <ChevronDown className="w-4 h-4 text-white/60" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-white/60" />
                          )}
                          <h4 className="text-base font-medium text-white/90">{subGroup.name}</h4>
                          <span className="text-xs text-white/50">
                            {subGroup.shifts.length} shifts
                          </span>
                        </div>
                      </button>

                      {isSubGroupExpanded && (
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                          {subGroup.shifts.map(shift => (
                            <ShiftChip
                              key={shift.id}
                              shift={shift}
                              groupColor={group.color}
                              size="md"
                              onClick={() => onShiftClick?.(shift.id, group.id, subGroup.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {!roster && (
        <div className="text-center py-10 text-white/60">
          No roster found for this date. Click "Apply Template" to create one.
        </div>
      )}
    </div>
  );
};

export default RosterDayView;
