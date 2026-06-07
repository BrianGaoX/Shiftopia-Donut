
import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Employee, Shift } from '@/modules/core/types';
import { useEmployees } from '@/modules/users/hooks/useEmployees';
import { format, parseISO } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { supabase } from '@/platform/supabase/client';
import {
  runV8LegacyBridgeNow,
  buildComplianceInput,
  ShiftTimeRange
} from '@/modules/compliance';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface ShiftGroup {
  shiftIds: string[];
  date: string;
  location: string;
  department: string;
  role: string;
  startTime: string;
  endTime: string;
  count: number;
}

interface AssignShiftDialogProps {
  selectedShifts: string[];
  allShifts: any[];
  onAssign: (assignments: Array<{ shiftId: string, employeeId: string }>) => void;
  trigger?: React.ReactNode;
}

export const AssignShiftDialog: React.FC<AssignShiftDialogProps> = ({
  selectedShifts,
  allShifts,
  onAssign,
  trigger
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [isComplianceChecking, setIsComplianceChecking] = useState(false);
  const { useAllEmployees } = useEmployees();
  const { data: employeesData = [] } = useAllEmployees();
  const employees = employeesData as Employee[];

  // Group shifts with similar properties
  const groupShifts = (): ShiftGroup[] => {
    const groups: Record<string, ShiftGroup> = {};

    selectedShifts.forEach(shiftId => {
      const shift = allShifts.find(s => s.shift.id === shiftId)?.shift;
      if (!shift) return;

      const key = `${shift.date}_${shift.location}_${shift.department}_${shift.role}_${shift.startTime}_${shift.endTime}`;

      if (!groups[key]) {
        groups[key] = {
          shiftIds: [],
          date: shift.date,
          location: shift.location || 'Unknown',
          department: shift.department || 'Unknown',
          role: shift.role || 'Unknown',
          startTime: shift.startTime || '',
          endTime: shift.endTime || '',
          count: 0
        };
      }

      groups[key].shiftIds.push(shiftId);
      groups[key].count++;
    });

    return Object.values(groups);
  };

  const shiftGroups = groupShifts();

  // Toggle employee selection for a shift group
  const toggleEmployeeForGroup = (groupIndex: number, employeeId: string) => {
    const group = shiftGroups[groupIndex];
    if (!group) return;

    const groupKey = `group_${groupIndex}`;

    setAssignments(prev => {
      const currentAssignments = prev[groupKey] || [];

      if (currentAssignments.includes(employeeId)) {
        return {
          ...prev,
          [groupKey]: currentAssignments.filter(id => id !== employeeId)
        };
      } else {
        // Check if we've already assigned enough employees for this group
        if (currentAssignments.length >= group.count) {
          return prev;
        }

        return {
          ...prev,
          [groupKey]: [...currentAssignments, employeeId]
        };
      }
    });
  };

  // Handle final assignment submission
  const handleAssign = async () => {
    const allAssignments: Array<{ shiftId: string, employeeId: string }> = [];

    Object.entries(assignments).forEach(([groupKey, employeeIds]) => {
      const groupIndex = parseInt(groupKey.split('_')[1]);
      const group = shiftGroups[groupIndex];

      if (!group) return;

      // Match employees to shifts
      employeeIds.forEach((employeeId, idx) => {
        if (idx < group.shiftIds.length) {
          allAssignments.push({
            shiftId: group.shiftIds[idx],
            employeeId
          });
        }
      });
    });

    if (allAssignments.length === 0) {
      setIsOpen(false);
      return;
    }

    setIsComplianceChecking(true);

    try {
      let blockingFailure = false;
      const results: Array<{ shiftId: string, passed: boolean }> = [];

      // Perform compliance checks for each assignment
      for (const assignment of allAssignments) {
        const fullShift = allShifts.find(s => s.shift.id === assignment.shiftId);
        const shift = fullShift?.shift;
        if (!shift) continue;

        // Fetch existing shifts for this employee on this date
        const { data: existingData } = await supabase
          .from('shifts')
          .select('id, start_time, end_time, shift_date')
          .eq('assigned_employee_id', assignment.employeeId)
          .eq('shift_date', shift.date);


        const existingShifts: ShiftTimeRange[] = (existingData || []).map(s => ({
          start_time: s.start_time,
          end_time: s.end_time,
          shift_date: s.shift_date
        }));

        const candidateShift: ShiftTimeRange = {
          start_time: shift.startTime?.includes('T') ? shift.startTime.split('T')[1].substring(0, 5) : shift.startTime,
          end_time: shift.endTime?.includes('T') ? shift.endTime.split('T')[1].substring(0, 5) : shift.endTime,
          shift_date: shift.date
        };

        const input = buildComplianceInput({
          employeeId: assignment.employeeId,
          actionType: 'assign',
          candidateShift,
          existingShifts,
          shiftId: assignment.shiftId
        });

        const checkResult = await runV8LegacyBridgeNow(input);


        if (!checkResult.passed) {
          blockingFailure = true;
          results.push({ shiftId: assignment.shiftId, passed: false });
        } else {
          results.push({ shiftId: assignment.shiftId, passed: true });
        }
      }

      if (blockingFailure) {
        toast.error("Compliance failures detected in one or more assignments. Please check the individual shifts.");
        // We still allow proceeding for now as per system behavior unless it's a hard block, 
        // but typically blocking failures should stop.
        // For bulk, we'll stop and let user fix them.
        setIsComplianceChecking(false);
        return;
      }

      onAssign(allAssignments);
      setIsOpen(false);
      setAssignments({});
    } catch (err) {
      console.error('[Compliance] Bulk check failed:', err);
      toast.error("Failed to run compliance checks. Please try again.");
    } finally {
      setIsComplianceChecking(false);
    }
  };

  // Format time for display
  const formatTime = (timeString: string) => {
    if (!timeString) return '';
    try {
      return format(parseISO(timeString), 'HH:mm');
    } catch {
      return timeString;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsOpen(true)}
            disabled={selectedShifts.length === 0}
          >
            Assign Selected ({selectedShifts.length})
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] bg-gray-900/95 backdrop-blur-xl border-gray-800">
        <DialogHeader>
          <DialogTitle>Assign Shifts</DialogTitle>
          <DialogDescription>
            Assign employees to {selectedShifts.length} selected shifts grouped by similar properties.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[500px] pr-4">
          {shiftGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="mb-6 p-4 border border-white/10 rounded-md bg-black/20">
              <div className="mb-3">
                <h4 className="font-medium">{group.role}</h4>
                <div className="text-sm text-white/70">
                  {formatTime(group.startTime)} - {formatTime(group.endTime)}
                </div>
                <div className="text-sm text-white/70">
                  {group.department} • {group.location}
                </div>
                <div className="mt-2 flex items-center">
                  <span className="text-xs bg-purple-500/80 text-white px-2 py-1 rounded">
                    {group.count} shift{group.count > 1 ? 's' : ''}
                  </span>
                  <span className="text-xs ml-2 bg-gray-700 text-white/80 px-2 py-1 rounded">
                    {assignments[`group_${groupIndex}`]?.length || 0} assigned
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {employees.map(employee => (
                  <div
                    key={employee.id}
                    className={`flex items-center p-2 rounded-md cursor-pointer transition-colors ${(assignments[`group_${groupIndex}`] || []).includes(employee.id)
                      ? 'bg-purple-500/20 border border-purple-500/50'
                      : 'hover:bg-black/30'
                      }`}
                    onClick={() => toggleEmployeeForGroup(groupIndex, employee.id)}
                  >
                    <Checkbox
                      checked={(assignments[`group_${groupIndex}`] || []).includes(employee.id)}
                      className="mr-2"
                      onCheckedChange={() => { }}
                    />
                    <Avatar className="h-6 w-6 mr-2">
                      <AvatarImage src={employee.avatarUrl} />
                      <AvatarFallback>{employee.fullName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{employee.fullName}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={isComplianceChecking}>
            {isComplianceChecking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking Compliance...
              </>
            ) : (
              'Assign Shifts'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
