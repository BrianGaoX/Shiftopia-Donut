import React, { useState, useEffect } from 'react';
import { Roster } from '@/modules/core/types';
import type { RosterDay } from '@/modules/rosters/model/roster.types';

type DepartmentName = string;
type DepartmentColor = string;
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isToday } from 'date-fns';
import { RosterDayView } from '../views/RosterDayView';
import { RosterThreeDayView } from '../views/RosterThreeDayView';
import { RosterWeekView } from '../views/RosterWeekView';
import { RosterMonthView } from '../views/RosterMonthView';
import { RosterListView } from '../views/RosterListView';
import { RosterEmployeeView } from './RosterEmployeeView';
import { RosterFilter } from './RosterFilter';
import { AssignShiftDialog } from './AssignShiftDialog';
import AddGroupDialog from '../dialogs/AddGroupDialog';
import { Clock, Filter, Plus, Calendar as CalendarIcon, List, Grid2X2, Users } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { FilterCategory } from '@/modules/rosters/model/roster.types';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useDrop } from 'react-dnd';
import { CalendarView } from '@/modules/rosters/hooks/useRosterView';

interface RosterCalendarProps {
  selectedDate: Date;
  readOnly?: boolean;
  roster?: Roster;
  isLoading?: boolean;
  onAssignEmployee?: (shiftId: string, employeeId: string) => void;
  onAddGroup?: (group: { name: DepartmentName; color: DepartmentColor }) => void;
  view: CalendarView;
  dateRange: { from: Date; to: Date };
}

export const RosterCalendar: React.FC<RosterCalendarProps> = ({ 
  selectedDate, 
  readOnly,
  roster,
  isLoading,
  onAssignEmployee,
  onAddGroup,
  view,
  dateRange
}) => {
  const [viewMode, setViewMode] = useState<'day' | '3day' | 'week' | 'month' | 'list' | 'employee'>(view);
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const { toast } = useToast();

  // Update viewMode when view prop changes
  useEffect(() => {
    setViewMode(view);
  }, [view]);

  const [{ isOver }, drop] = useDrop(() => ({
    accept: 'EMPLOYEE',
    drop: (item: { id: string, name: string }, monitor) => {
      toast({
        title: "Employee Dropped",
        description: `Employee ${item.name} was dropped onto the roster.`,
      });
    },
    collect: monitor => ({
      isOver: !!monitor.isOver(),
    }),
  }));

  const allShifts: Array<{ 
    shift: any, 
    groupName: string, 
    groupColor: string, 
    subGroupName: string 
  }> = [];

  if (roster) {
    ((roster as any).groups as any[] || []).forEach((group: any) => {
      (group.subGroups || group.subgroups || []).forEach((subGroup: any) => {
        (subGroup.shifts || []).forEach((shift: any) => {
          allShifts.push({
            shift,
            groupName: group.name,
            groupColor: group.color,
            subGroupName: subGroup.name
          });
        });
      });
    });
  }

  const handleFilterChange = (filters: Record<string, string[]>) => {
    setActiveFilters(filters);
    
    console.log('Filters applied:', filters);
    
    const totalFilters = Object.values(filters).reduce((sum, arr) => sum + arr.length, 0);
    if (totalFilters > 0) {
      toast({
        title: "Filters Applied",
        description: `${totalFilters} filter${totalFilters > 1 ? 's' : ''} applied to roster view.`,
      });
    }
  };

  const handleAssignShifts = (assignments: Array<{ shiftId: string, employeeId: string }>) => {
    assignments.forEach(({ shiftId, employeeId }) => {
      if (onAssignEmployee) {
        onAssignEmployee(shiftId, employeeId);
      }
    });
    
    setSelectedShifts([]);
    
    toast({
      title: "Shifts Assigned",
      description: `Successfully assigned ${assignments.length} shift${assignments.length > 1 ? 's' : ''}.`,
    });
  };

  const handleAddGroup = (group: { name: DepartmentName; color: DepartmentColor }) => {
    if (onAddGroup) {
      onAddGroup(group);
    } else {
      toast({
        title: "Department Added",
        description: `${group.name} department would be added to the roster.`,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center mb-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" ref={drop}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
        <div className="flex items-center text-white/80 text-sm">
          <Clock size={14} className="mr-2 text-blue-400" />
          <span>
            {view === 'day' && `Showing roster for ${format(selectedDate, 'EEEE, MMMM d, yyyy')}`}
            {view === '3day' && `Showing roster for ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`}
            {view === 'week' && `Showing roster for week of ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`}
            {view === 'month' && `Showing roster for ${format(selectedDate, 'MMMM yyyy')}`}
          </span>
          
          {!readOnly && (
            <AddGroupDialog
              onAddGroup={handleAddGroup}
              trigger={
                <Button variant="outline" size="sm" className="ml-4">
                  <Plus size={14} className="mr-1" />
                  Add Department
                </Button>
              }
            />
          )}
        </div>
        
        <div className="flex flex-wrap gap-2">
          <RosterFilter onFilterChange={handleFilterChange} />
          
          {viewMode === 'employee' && selectedShifts.length > 0 && (
            <AssignShiftDialog
              selectedShifts={selectedShifts}
              allShifts={allShifts}
              onAssign={handleAssignShifts}
              trigger={
                <Button variant="outline" size="sm">
                  Assign Selected ({selectedShifts.length})
                </Button>
              }
            />
          )}
        </div>
      </div>

      {/* Day View */}
      {viewMode === 'day' && (
        <RosterDayView 
          date={selectedDate}
          roster={roster || null} 
          readOnly={readOnly}
          onAddGroup={onAddGroup}
        />
      )}
      
      {/* 3-Day View */}
      {viewMode === '3day' && (
        <RosterThreeDayView 
          roster={roster || null} 
          selectedDate={selectedDate}
          readOnly={readOnly}
        />
      )}
      
      {/* Week View */}
      {viewMode === 'week' && (
        <RosterWeekView
          roster={(roster as unknown as RosterDay) || null}
          selectedDate={selectedDate}
          readOnly={readOnly}
        />
      )}
      
      {/* Month View */}
      {viewMode === 'month' && (
        <RosterMonthView 
          roster={roster || null} 
          selectedDate={selectedDate}
          readOnly={readOnly}
        />
      )}
      
      {/* Employee View */}
      {viewMode === 'employee' && (
        <RosterEmployeeView 
          roster={roster || null} 
          selectedDate={selectedDate}
          onAssignShift={onAssignEmployee}
        />
      )}
      
      {/* List View */}
      {viewMode === 'list' && (
        <RosterListView 
          roster={roster || null} 
          selectedDate={selectedDate}
          readOnly={readOnly}
        />
      )}
    </div>
  );
};
