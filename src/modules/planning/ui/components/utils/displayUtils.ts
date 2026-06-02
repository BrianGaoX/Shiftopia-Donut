
import { format } from 'date-fns';

// Format time to "8:00 AM – 4:00 PM" format
export const formatTimeRange = (startTime: string, endTime: string): string => {
  try {
    // Parse time strings like "09:00", "14:30", etc.
    const formatTime = (timeStr: string) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      const date = new Date();
      date.setHours(hours);
      date.setMinutes(minutes);
      return format(date, 'h:mm a');
    };

    return `${formatTime(startTime)} – ${formatTime(endTime)}`;
  } catch (error) {
    console.error('Error formatting time range:', error);
    return `${startTime} - ${endTime}`;
  }
};

// Get status color for shift
export const getShiftStatusColor = (status: string): string => {
  status = status.toLowerCase();
  switch (status) {
    case 'open':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'offered':
      return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
    case 'filled':
    case 'assigned':
      return 'bg-green-500/20 text-green-300 border-green-500/30';
    case 'completed':
      return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
    case 'cancelled':
      return 'bg-red-500/20 text-red-300 border-red-500/30';
    case 'inactive':
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    default:
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  }
};

// Get remuneration level display
export const getRemunerationDisplay = (level: string | number): string => {
  if (typeof level === 'number') {
    return level.toString();
  }
  return level;
};

// Generate applicant tags based on various criteria
export const generateApplicantTags = (bid: any, allBids: any[]): { text: string; color: string; tooltip?: string }[] => {
  const tags: { text: string; color: string; tooltip?: string }[] = [];
  
  // First to apply tag
  if (isFirstApplicant(bid, allBids)) {
    tags.push({
      text: 'First to Apply',
      color: 'bg-blue-600',
      tooltip: 'This employee was the first to apply for this shift'
    });
  }
  
  // High qualification tag based on tier
  if (bid.employee?.tier >= 4) {
    tags.push({
      text: 'Highly Qualified',
      color: 'bg-purple-600',
      tooltip: `Tier ${bid.employee.tier} employee with strong qualifications`
    });
  }
  
  // Check for conflicts
  if (hasSchedulingConflict(bid, allBids)) {
    tags.push({
      text: 'Conflict',
      color: 'bg-red-600',
      tooltip: 'This employee has a scheduling conflict with another shift'
    });
  }
  
  // Check if offered elsewhere
  if (isOfferedOtherShift(bid, allBids)) {
    tags.push({
      text: 'Offered Elsewhere',
      color: 'bg-amber-600',
      tooltip: 'This employee has been offered another shift'
    });
  }
  
  return tags;
};

// Helper functions for tags
const isFirstApplicant = (bid: any, allBids: any[]): boolean => {
  const shiftBids = allBids.filter(b => b.shiftId === bid.shiftId);
  return shiftBids.length > 0 && 
    new Date(bid.createdAt).getTime() <= new Date(shiftBids[0].createdAt).getTime();
};

const hasSchedulingConflict = (bid: any, allBids: any[]): boolean => {
  // Simple implementation - in real app would check actual time overlaps
  return false;
};

const isOfferedOtherShift = (bid: any, allBids: any[]): boolean => {
  const employeeBids = allBids.filter(b => 
    b.employeeId === bid.employeeId && 
    b.id !== bid.id &&
    b.status === 'Approved'
  );
  return employeeBids.length > 0;
};
