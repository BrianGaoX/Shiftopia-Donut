
import React from 'react';
import { Edit, Trash, Clock, User, Award } from 'lucide-react';
import { Employee } from '@/modules/core/types';
type ShiftStatus = 'unassigned' | 'assigned' | 'confirmed' | 'completed' | 'cancelled' | string;

interface ShiftProps {
  id: string;
  role: string;
  startTime: string;
  endTime: string;
  breakDuration: string;
  remunerationLevel: string;
  employeeId?: string;
  employee?: Employee;
  status?: ShiftStatus;
  actualStartTime?: string;
  actualEndTime?: string;
  notes?: string;
}

const ShiftItem: React.FC<ShiftProps> = ({
  id,
  role,
  startTime,
  endTime,
  breakDuration,
  remunerationLevel,
  employee,
  status
}) => {
  return (
    <div className="p-3 bg-muted/50 dark:bg-black/20 rounded-lg border border-border hover:border-border/80 transition-all duration-300 hover:shadow-md hover:bg-muted dark:hover:bg-black/30 group">
      <div className="flex justify-between items-center">
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <User size={14} className="text-muted-foreground group-hover:text-foreground transition-colors duration-300" />
            <span className="font-medium group-hover:text-foreground transition-colors duration-300">{role}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200 border border-blue-500/20 group-hover:bg-blue-500/20 dark:group-hover:bg-blue-500/30 transition-colors duration-300">Level {remunerationLevel}</span>
            {status && (
              <span className={`text-xs px-2 py-0.5 rounded ${status === 'Assigned' ? 'bg-green-500/10 dark:bg-green-500/20 text-green-700 dark:text-green-200' :
                  status === 'Completed' ? 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200' :
                    status === 'Cancelled' ? 'bg-red-500/10 dark:bg-red-500/20 text-red-700 dark:text-red-200' :
                      status === 'Swapped' ? 'bg-purple-500/10 dark:bg-purple-500/20 text-purple-700 dark:text-purple-200' :
                        status === 'No-Show' ? 'bg-yellow-500/10 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-200' :
                          'bg-gray-500/10 dark:bg-gray-500/20 text-gray-700 dark:text-gray-200'
                }`}>
                {status}
              </span>
            )}
          </div>
          <div className="mt-1 text-muted-foreground group-hover:text-foreground text-sm flex items-center space-x-4 transition-colors duration-300">
            <div className="flex items-center space-x-1">
              <Clock size={12} />
              <span>{startTime} - {endTime}</span>
            </div>
            <span className="text-muted-foreground/50">|</span>
            <span className="flex items-center space-x-1">
              <Award size={12} />
              <span>Break: {breakDuration}</span>
            </span>
          </div>
          {employee && (
            <div className="mt-1 text-muted-foreground group-hover:text-foreground text-sm">
              <span>Assigned to: {(employee as any).fullName ?? (employee as any).name ?? ''}</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2 opacity-70 group-hover:opacity-100 transition-opacity duration-300">
          <button className="p-1.5 rounded-lg bg-black/5 dark:bg-black/20 hover:bg-black/10 dark:hover:bg-black/40 text-blue-600 dark:text-blue-400 transition-all duration-200 hover:scale-110">
            <Edit size={14} />
          </button>
          <button className="p-1.5 rounded-lg bg-black/5 dark:bg-black/20 hover:bg-black/10 dark:hover:bg-black/40 text-red-600 dark:text-red-400 transition-all duration-200 hover:scale-110">
            <Trash size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShiftItem;
