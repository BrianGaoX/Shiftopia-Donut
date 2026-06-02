import React from 'react';
import { Roster } from '@/modules/core/types';
import { addDays, format } from 'date-fns';
import { Clock } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';

interface RosterThreeDayViewProps {
  roster: Roster | null;
  selectedDate: Date;
  readOnly?: boolean;
}

export const RosterThreeDayView: React.FC<RosterThreeDayViewProps> = ({ 
  roster, 
  selectedDate,
  readOnly
}) => {
  // We would need to fetch rosters for 3 days here
  // For demonstration, we'll display the current roster with tabs for 3 days
  
  const renderShiftCount = (roster: Roster | null) => {
    if (!roster) return 0;

    let count = 0;
    ((roster as any).groups as any[] || []).forEach((group: any) => {
      (group.subGroups || group.subgroups || []).forEach((subGroup: any) => {
        count += (subGroup.shifts || []).length;
      });
    });

    return count;
  };
  
  return (
    <div className="space-y-4">
      <Tabs defaultValue="day1">
        <TabsList className="w-full">
          <TabsTrigger value="day1" className="flex-1">
            {format(selectedDate, 'EEE, MMM d')}
          </TabsTrigger>
          <TabsTrigger value="day2" className="flex-1">
            {format(addDays(selectedDate, 1), 'EEE, MMM d')}
          </TabsTrigger>
          <TabsTrigger value="day3" className="flex-1">
            {format(addDays(selectedDate, 2), 'EEE, MMM d')}
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="day1">
          <div className="p-4 bg-black/20 rounded-lg border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</h3>
              <Badge className="bg-blue-500/30 hover:bg-blue-500/40">
                <Clock size={12} className="mr-1" />
                {renderShiftCount(roster)} shifts
              </Badge>
            </div>
            
            <div className="space-y-2">
              {((roster as any)?.groups as any[] || []).map((group: any) => (
                <div key={group.id} className="p-3 rounded-lg bg-black/20 border border-white/10">
                  <h4 className="font-medium">{group.name}</h4>
                  <div className="text-sm text-white/70 mt-1">
                    {(group.subGroups || group.subgroups || []).reduce((total: number, subGroup: any) => total + (subGroup.shifts || []).length, 0)} shifts
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="day2">
          <div className="p-8 bg-black/20 rounded-lg border border-white/10 text-center">
            <p className="text-white/60">Data for {format(addDays(selectedDate, 1), 'MMMM d, yyyy')} would be shown here</p>
          </div>
        </TabsContent>
        
        <TabsContent value="day3">
          <div className="p-8 bg-black/20 rounded-lg border border-white/10 text-center">
            <p className="text-white/60">Data for {format(addDays(selectedDate, 2), 'MMMM d, yyyy')} would be shown here</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RosterThreeDayView;
