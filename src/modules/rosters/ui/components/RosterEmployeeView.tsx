
import React, { useState } from 'react';
import { Employee, Shift, Roster } from '@/modules/core/types';
import { useEmployees } from '@/modules/users/hooks/useEmployees';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/modules/core/ui/primitives/collapsible';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { format, parseISO } from 'date-fns';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';

interface RosterEmployeeViewProps {
  roster: Roster | null;
  selectedDate: Date;
  onAssignShift?: (shiftId: string, employeeId: string) => void;
}

export const RosterEmployeeView: React.FC<RosterEmployeeViewProps> = ({ 
  roster, 
  selectedDate,
  onAssignShift 
}) => {
  const { useAllEmployees } = useEmployees();
  const { data: employees = [] } = useAllEmployees();
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);
  const [isUnassignedOpen, setIsUnassignedOpen] = useState(true);
  const { toast } = useToast();

  const unassignedShifts: Array<{ 
    shift: any, 
    groupName: string, 
    groupColor: string, 
    subGroupName: string 
  }> = [];

  const assignedShiftsByEmployee = new Map<string, Array<{
    shift: any,
    groupName: string,
    groupColor: string,
    subGroupName: string
  }>>();

  if (roster) {
    ((roster as any).groups as any[] || []).forEach((group: any) => {
      (group.subGroups || group.subgroups || []).forEach((subGroup: any) => {
        (subGroup.shifts || []).forEach((shift: any) => {
          const shiftInfo = {
            shift,
            groupName: group.name,
            groupColor: group.color,
            subGroupName: subGroup.name
          };

          if (!shift.employeeId) {
            unassignedShifts.push(shiftInfo);
          } else {
            if (!assignedShiftsByEmployee.has(shift.employeeId)) {
              assignedShiftsByEmployee.set(shift.employeeId, []);
            }
            assignedShiftsByEmployee.get(shift.employeeId)?.push(shiftInfo);
          }
        });
      });
    });
  }

  const toggleShiftSelection = (shiftId: string) => {
    setSelectedShifts(prev => 
      prev.includes(shiftId) 
        ? prev.filter(id => id !== shiftId)
        : [...prev, shiftId]
    );
  };

  const formattedDate = selectedDate ? format(selectedDate, 'EEE dd/MM/yyyy') : '';

  const handleAssignSelected = () => {
    if (selectedShifts.length === 0) {
      toast({
        title: "No shifts selected",
        description: "Please select at least one shift to assign",
        variant: "destructive"
      });
      return;
    }
    
    // You would normally open the assign dialog here
    toast({
      title: "Ready to assign shifts",
      description: `${selectedShifts.length} shifts selected for assignment`
    });
  };

  const renderShift = (shiftInfo: any) => {
    const { shift, groupName, groupColor, subGroupName } = shiftInfo;
    const startTime = shift.startTime ? format(parseISO(shift.startTime), 'HH:mm') : '';
    const endTime = shift.endTime ? format(parseISO(shift.endTime), 'HH:mm') : '';

    return (
      <div 
        key={shift.id}
        className={`relative p-2 m-1 rounded border ${selectedShifts.includes(shift.id) ? 'border-purple-500 bg-purple-200/10' : 'border-white/10'}`}
        style={{ backgroundColor: `${groupColor}20` }}
      >
        <div className="font-medium text-sm">{shift.role}</div>
        <div className="flex items-center text-xs text-white/70">
          <Clock size={12} className="mr-1" />
          {startTime} - {endTime}
        </div>
        <div className="text-xs text-white/60">{groupName} - {subGroupName}</div>
        
        {!shift.employeeId && (
          <div className="absolute top-1 right-1">
            <Checkbox 
              checked={selectedShifts.includes(shift.id)}
              onCheckedChange={() => toggleShiftSelection(shift.id)}
            />
          </div>
        )}
      </div>
    );
  };

  if (!roster) {
    return (
      <div className="p-8 text-center">
        <p className="text-white/60">No roster data available for the selected date</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[1000px] grid" style={{ gridTemplateColumns: "250px 1fr" }}>
        <div className="bg-black/30 p-3 font-medium border-b border-white/10">
          EMPLOYEE
        </div>
        <div className="bg-black/30 p-3 font-medium border-b border-white/10 text-center">
          {formattedDate}
        </div>
        
        <div className="border-b border-white/10">
          <Collapsible
            open={isUnassignedOpen}
            onOpenChange={setIsUnassignedOpen}
            className="w-full"
          >
            <CollapsibleTrigger className="flex items-center w-full p-3 hover:bg-black/20">
              {isUnassignedOpen ? (
                <ChevronDown size={16} className="mr-2 text-white/70" />
              ) : (
                <ChevronRight size={16} className="mr-2 text-white/70" />
              )}
              <span className="font-medium">Unassigned</span>
              <span className="ml-2 bg-purple-500/80 text-white px-2 py-0.5 rounded-full text-xs">
                {unassignedShifts.length}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-white/10 bg-black/10">
              <div className="p-3">
                <div className="text-white/70 text-xs mb-2">Select shifts to assign to employees</div>
                {selectedShifts.length > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mb-2"
                    onClick={handleAssignSelected}
                  >
                    Assign Selected ({selectedShifts.length})
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
        
        <div className="border-b border-white/10 bg-black/5">
          <Collapsible open={isUnassignedOpen}>
            <CollapsibleContent>
              <div className="flex flex-wrap p-2">
                {unassignedShifts.length > 0 ? (
                  unassignedShifts.map(shiftInfo => renderShift(shiftInfo))
                ) : (
                  <div className="w-full p-4 text-center text-white/60">
                    No unassigned shifts available
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
        
        {employees.map(employee => (
          <React.Fragment key={employee.id}>
            <div className="p-3 border-b border-white/10 flex items-center">
              <Avatar className="h-8 w-8 mr-3">
                <AvatarImage src={(employee as any).avatar || employee.avatarUrl} />
                <AvatarFallback>{(employee.fullName || employee.firstName || '?').charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium">{employee.fullName || `${employee.firstName} ${employee.lastName}`.trim()}</div>
                <div className="text-xs text-white/70">ID: {employee.id} | {(employee as any).tier || employee.role || ''}</div>
              </div>
            </div>
            <div className="p-2 border-b border-white/10 flex flex-wrap">
              {assignedShiftsByEmployee.get(employee.id)?.map(shiftInfo => 
                renderShift(shiftInfo)
              ) || (
                <div className="w-full p-2 text-center text-xs text-white/40">
                  No shifts assigned
                </div>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
