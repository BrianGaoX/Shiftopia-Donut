import React, { useState } from 'react';
import { Roster, Employee } from '@/modules/core/types';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Clock, Calendar, User, MapPin, Building } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/modules/core/ui/primitives/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { Button } from '@/modules/core/ui/primitives/button';

interface RosterListViewProps {
  roster: Roster | null;
  selectedDate: Date;
  readOnly?: boolean;
}

export const RosterListView: React.FC<RosterListViewProps> = ({
  roster,
  selectedDate,
  readOnly
}) => {
  const [sortField, setSortField] = useState<string>('startTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const allShifts: Array<{
    id: string;
    role: string;
    startTime: string;
    endTime: string;
    employee?: Employee;
    employeeId?: string;
    groupName: string;
    groupColor: string;
    subGroupName: string;
    breakDuration: string;
    remunerationLevel: string;
  }> = [];

  if (roster) {
    ((roster as any).groups || []).forEach((group: any) => {
      (group.subGroups || group.subgroups || []).forEach((subGroup: any) => {
        (subGroup.shifts || []).forEach((shift: any) => {
          allShifts.push({
            ...shift,
            groupName: group.name,
            groupColor: group.color,
            subGroupName: subGroup.name,
            breakDuration: shift.breakDuration || "",
            remunerationLevel: shift.remunerationLevel ? String(shift.remunerationLevel) : ""
          });
        });
      });
    });
  }

  const sortedShifts = [...allShifts].sort((a, b) => {
    if (sortField === 'startTime') {
      const dateA = new Date(a.startTime || '');
      const dateB = new Date(b.startTime || '');
      return sortDirection === 'asc' ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
    }
    if (sortField === 'role') {
      return sortDirection === 'asc'
        ? a.role.localeCompare(b.role)
        : b.role.localeCompare(a.role);
    }
    if (sortField === 'group') {
      return sortDirection === 'asc'
        ? a.groupName.localeCompare(b.groupName)
        : b.groupName.localeCompare(a.groupName);
    }
    if (sortField === 'employee') {
      const nameA = (a.employee as any)?.name || a.employee?.fullName || 'Unassigned';
      const nameB = (b.employee as any)?.name || b.employee?.fullName || 'Unassigned';
      return sortDirection === 'asc'
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
    }
    return 0;
  });

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  if (!roster) {
    return (
      <div className="p-8 text-center">
        <p className="text-white/60">No roster data available for the selected date</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-4 flex items-center">
        <Calendar size={16} className="mr-2 text-blue-400" />
        <span className="text-sm text-white/80">
          Showing shifts for {format(selectedDate, 'EEEE, MMMM d, yyyy')}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px] cursor-pointer" onClick={() => toggleSort('role')}>
              Role {sortField === 'role' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => toggleSort('group')}>
              Department {sortField === 'group' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHead>
            <TableHead>Subgroup</TableHead>
            <TableHead className="cursor-pointer" onClick={() => toggleSort('employee')}>
              Employee {sortField === 'employee' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => toggleSort('startTime')}>
              Time {sortField === 'startTime' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHead>
            <TableHead>Level</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedShifts.length > 0 ? (
            sortedShifts.map(shift => {
              const employeeObj = shift.employee ? {
                id: shift.employee.id,
                name: (shift.employee as any).name || shift.employee.fullName || `${shift.employee.firstName || ''} ${shift.employee.lastName || ''}`.trim()
              } : shift.employeeId ? {
                id: shift.employeeId,
                name: "Unknown Employee"
              } : undefined;

              return (
                <TableRow key={shift.id}>
                  <TableCell>
                    <span className="font-medium">{shift.role}</span>
                  </TableCell>
                  <TableCell>
                    <Badge className={`bg-${shift.groupColor}-500/30`}>
                      {shift.groupName}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-white/70">{shift.subGroupName}</span>
                  </TableCell>
                  <TableCell>
                    {employeeObj ? (
                      <div className="flex items-center">
                        <span>{employeeObj.name}</span>
                      </div>
                    ) : (
                      <span className="text-white/50">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <Clock size={14} className="mr-2 text-white/60" />
                      <span>
                        {shift.startTime ? format(parseISO(shift.startTime), 'HH:mm') : '--'} -
                        {shift.endTime ? format(parseISO(shift.endTime), 'HH:mm') : '--'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span>{shift.remunerationLevel}</span>
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-4 text-white/60">
                No shifts found for this date
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default RosterListView;
