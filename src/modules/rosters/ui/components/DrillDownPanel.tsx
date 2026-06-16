import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  useShiftsByDateRange,
  useDeleteShift,
  usePublishShift,
  useUnpublishShift,
  useCreateShift,
  useBulkPublishShifts,
  useBulkUnpublishShifts,
  useBulkDeleteShifts,
} from '@/modules/rosters/state/useRosterShifts';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { format } from 'date-fns';
import { X, Loader2, MoreHorizontal, Edit2, CopyPlus, Trash2, Send, Undo2, Lock } from 'lucide-react';
import { isSydneyPast, isSydneyStarted } from '@/modules/core/lib/date.utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { SmartShiftCard } from './SmartShiftCard';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { Shift } from '@/modules/rosters/domain/shift.entity';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';

interface DrillDownPanelProps {
  isOpen: boolean;
  onClose: () => void;
  date: string; // yyyy-MM-dd
  groupType: string;
  subGroupName?: string; // Optional, to filter down to a single cell instead of the whole group
  organizationId?: string;
  departmentId?: string;
  subDepartmentId?: string;
  groupName: string;
  rosterId?: string;
}

export const DrillDownPanel: React.FC<DrillDownPanelProps> = ({
  isOpen,
  onClose,
  date,
  groupType,
  subGroupName,
  organizationId,
  departmentId,
  subDepartmentId,
  groupName,
  rosterId,
}) => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const isPastDate = useMemo(() => {
    if (!date) return false;
    try {
      return isSydneyPast(new Date(date + 'T00:00:00'));
    } catch {
      return false;
    }
  }, [date]);
  
  // State for Delete Dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);

  // Mutations
  const deleteMutation = useDeleteShift();
  const publishMutation = usePublishShift();
  const unpublishMutation = useUnpublishShift();
  const createShiftMutation = useCreateShift();

  // Fetch only when panel is open
  const queryOrgId = isOpen ? organizationId || null : null;
  const { data: shifts = [], isLoading } = useShiftsByDateRange(
    queryOrgId,
    date,
    date,
    {
      departmentIds: departmentId ? [departmentId] : undefined,
      subDepartmentIds: subDepartmentId ? [subDepartmentId] : undefined,
    }
  );

  // Filter shifts
  const filteredShifts = shifts.filter(s => {
    if (s.group_type !== groupType) return false;
    if (subGroupName && s.sub_group_name !== subGroupName) return false;
    return true;
  });

  // Bulk Mode Store selectors & actions
  const bulkModeActive = useRosterStore((s) => s.bulkModeActive);
  const selectedV8ShiftIds = useRosterStore((s) => s.selectedV8ShiftIds);
  const toggleShiftSelection = useRosterStore((s) => s.toggleShiftSelection);
  const selectMultiple = useRosterStore((s) => s.selectMultiple);
  const setSelectedV8ShiftIds = useRosterStore((s) => s.setSelectedV8ShiftIds);
  const clearSelection = useRosterStore((s) => s.clearSelection);

  // Clear selection when drawer opens, closes, or changes date
  useEffect(() => {
    clearSelection();
    return () => {
      clearSelection();
    };
  }, [isOpen, date, clearSelection]);

  const selectableShifts = useMemo(() => {
    return filteredShifts.filter(s => {
      const startTimeStr = s.start_time || s.startTime || s.start || '00:00';
      const hasStarted = isSydneyStarted(s.shift_date, startTimeStr);
      return !isPastDate && !hasStarted;
    });
  }, [filteredShifts, isPastDate]);

  const allSelected = useMemo(() => {
    if (selectableShifts.length === 0) return false;
    return selectableShifts.every(s => selectedV8ShiftIds.has(s.id));
  }, [selectableShifts, selectedV8ShiftIds]);

  const handleSelectAllToggle = () => {
    const selectableIds = selectableShifts.map(s => s.id);
    if (selectableIds.length === 0) return;
    
    if (allSelected) {
      const nextSet = new Set(selectedV8ShiftIds);
      selectableIds.forEach(id => nextSet.delete(id));
      setSelectedV8ShiftIds(nextSet);
    } else {
      selectMultiple(selectableIds);
    }
  };

  // Local bulk action states & mutations
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const bulkPublish = useBulkPublishShifts();
  const bulkUnpublish = useBulkUnpublishShifts();
  const bulkDelete = useBulkDeleteShifts();

  const selectedInDrawerCount = useMemo(() => filteredShifts.filter(s => selectedV8ShiftIds.has(s.id)).length, [filteredShifts, selectedV8ShiftIds]);
  const selectedDrawerShiftIds = useMemo(() => filteredShifts.filter(s => selectedV8ShiftIds.has(s.id)).map(s => s.id), [filteredShifts, selectedV8ShiftIds]);

  const draftSelectedCount = useMemo(() => {
    return filteredShifts.filter(s => selectedV8ShiftIds.has(s.id) && s.lifecycle_status === 'Draft').length;
  }, [filteredShifts, selectedV8ShiftIds]);

  const publishedSelectedCount = useMemo(() => {
    return filteredShifts.filter(s => selectedV8ShiftIds.has(s.id) && s.lifecycle_status === 'Published').length;
  }, [filteredShifts, selectedV8ShiftIds]);

  const isPublishing = bulkPublish.isPending;
  const isUnpublishing = bulkUnpublish.isPending;
  const isDeleting = bulkDelete.isPending;
  const isProcessing = isPublishing || isUnpublishing || isDeleting;

  const hasDraftSelected = draftSelectedCount > 0;
  const hasPublishedSelected = publishedSelectedCount > 0;

  const handleBulkPublish = async () => {
    const draftIds = filteredShifts
      .filter(s => selectedV8ShiftIds.has(s.id) && s.lifecycle_status === 'Draft')
      .map(s => s.id);
    if (draftIds.length === 0) return;
    try {
      await bulkPublish.mutateAsync(draftIds);
      toast({ title: 'Shifts Published', description: `Successfully published ${draftIds.length} shifts.` });
      clearSelection();
    } catch (e: any) {
      toast({ title: 'Publish Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleBulkUnpublish = async () => {
    const publishedIds = filteredShifts
      .filter(s => selectedV8ShiftIds.has(s.id) && s.lifecycle_status === 'Published')
      .map(s => s.id);
    if (publishedIds.length === 0) return;
    try {
      await bulkUnpublish.mutateAsync(publishedIds);
      toast({ title: 'Shifts Unpublished', description: `Successfully reverted ${publishedIds.length} shifts to Draft.` });
      clearSelection();
    } catch (e: any) {
      toast({ title: 'Unpublish Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDrawerShiftIds.length === 0) return;
    try {
      await bulkDelete.mutateAsync(selectedDrawerShiftIds);
      toast({ title: 'Shifts Deleted', description: `Successfully deleted ${selectedDrawerShiftIds.length} shifts.` });
      clearSelection();
      setBulkDeleteConfirmOpen(false);
    } catch (e: any) {
      toast({ title: 'Delete Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const displayDate = date ? format(new Date(date), 'EEEE, MMMM d, yyyy') : '';

  // Handlers
  const handlePublishShift = async (shift: Shift) => {
    try {
      await publishMutation.mutateAsync(shift.id);
      toast({ title: 'Shift Published', description: 'The shift is now visible to staff.' });
    } catch (e: any) {
      toast({ title: 'Publish Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleUnpublishShift = async (shift: Shift) => {
    try {
      await unpublishMutation.mutateAsync({ shiftId: shift.id });
      toast({ title: 'Shift Unpublished', description: 'The shift has been moved back to Draft.' });
    } catch (e: any) {
      toast({ title: 'Unpublish Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const confirmDeleteShift = async () => {
    if (!shiftToDelete) return;
    try {
      await deleteMutation.mutateAsync(shiftToDelete.id);
      toast({ title: 'Shift Deleted', description: 'The shift was removed successfully.' });
      setDeleteDialogOpen(false);
      setShiftToDelete(null);
    } catch (e: any) {
      toast({ title: 'Delete Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleCloneShift = async (shift: Shift) => {
    try {
      const cloneData: any = {
        roster_id: shift.roster_id,
        department_id: shift.department_id,
        sub_department_id: shift.sub_department_id,
        shift_date: shift.shift_date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        organization_id: shift.organization_id,
        group_type: shift.group_type,
        sub_group_name: shift.sub_group_name,
        shift_group_id: (shift as any).shift_group_id,
        shift_subgroup_id: (shift as any).shift_subgroup_id || (shift as any).roster_subgroup_id,
        role_id: shift.role_id,
        remuneration_level_id: shift.remuneration_level_id,
        paid_break_minutes: shift.paid_break_minutes,
        unpaid_break_minutes: shift.unpaid_break_minutes,
        timezone: shift.timezone,
        required_skills: shift.required_skills || [],
        required_licenses: shift.required_licenses || [],
        event_ids: shift.event_ids || [],
        tags: shift.tags || [],
        notes: shift.notes,
        is_training: shift.is_training,
      };

      await createShiftMutation.mutateAsync(cloneData);
      toast({ title: 'Shift Cloned', description: 'A new draft replica has been created (unassigned).' });
    } catch (e: any) {
      toast({ title: 'Clone Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const activeRosterId = rosterId || filteredShifts[0]?.roster_id;

  // Navigate to the dedicated full-page Add/Edit Shift route. No modal/Dialog,
  // so the form's nested dropdowns work without pointer-events conflicts.
  const openShiftForm = (shift: Shift | null) => {
    if (!organizationId || !departmentId) {
      toast({
        title: 'Missing context',
        description: 'Cannot open the shift form without an organization and department.',
        variant: 'destructive',
      });
      return;
    }
    navigate('/rosters/shift/new', {
      state: {
        editMode: !!shift,
        existingShift: shift,
        isTemplateMode: false,
        context: {
          mode: 'group',
          launchSource: shift ? 'edit' : 'grid',
          date,
          organizationId,
          departmentId,
          subDepartmentId,
          group_type: groupType,
          groupName,
          sub_group_name: subGroupName,
          subGroupName,
          rosterId: activeRosterId,
        },
      },
    });
  };

  return (
    <>
      <div 
        className={`fixed inset-y-0 right-0 w-full md:w-[480px] bg-slate-50 dark:bg-[#090d16] border-l border-slate-200 dark:border-white/10 shadow-2xl z-50 flex flex-col transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10 bg-slate-100/50 dark:bg-[#111726]/50">
          <div>
            <h2 className="text-lg font-bold">{groupName} {subGroupName ? ` - ${subGroupName}` : ''}</h2>
            <p className="text-sm text-muted-foreground">{displayDate}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-[#0c101c]/50">
          <div className="text-sm font-medium">
            {filteredShifts.length} Shift{filteredShifts.length !== 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold"
              disabled={selectableShifts.length === 0}
              onClick={handleSelectAllToggle}
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </Button>
            {!isPastDate && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8"
                onClick={() => openShiftForm(null)}
              >
                Add Shift
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 p-4 bg-slate-100/30 dark:bg-[#080c14]/40">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p>Loading full shift details...</p>
            </div>
          ) : filteredShifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-center">
              <p>No shifts scheduled for this day.</p>
            </div>
          ) : (
            <div className="space-y-3 pb-8">
              {filteredShifts.map((shift, idx) => {
                const startTimeStr = shift.start_time || shift.startTime || shift.start || '00:00';
                const hasStarted = isSydneyStarted(shift.shift_date, startTimeStr);
                const isPast = isPastDate || hasStarted;
                const isDraft = shift.lifecycle_status === 'Draft';
                const isPublished = shift.lifecycle_status === 'Published';
                
                const menu = (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full bg-white/10 hover:bg-white/30 text-white border-0 shadow-none hover:text-white pointer-events-auto">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-popover/95 backdrop-blur-xl border-border/50 shadow-2xl z-[100]">
                      {isDraft && (
                        hasStarted ? (
                          <DropdownMenuItem disabled className="text-muted-foreground/50 cursor-not-allowed">
                            <Lock className="h-4 w-4 mr-2" />
                            Edit Shift (Locked)
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => openShiftForm(shift)}
                            className="text-popover-foreground hover:bg-accent cursor-pointer"
                          >
                            <Edit2 className="h-4 w-4 mr-2" />
                            Edit Shift
                          </DropdownMenuItem>
                        )
                      )}
                      
                      <DropdownMenuItem
                        onClick={() => handleCloneShift(shift)}
                        className="text-popover-foreground hover:bg-accent cursor-pointer"
                      >
                        <CopyPlus className="h-4 w-4 mr-2 text-blue-500" />
                        Clone to Draft
                      </DropdownMenuItem>
              
                      <DropdownMenuSeparator className="bg-border" />
              
                      {isDraft && !isPublished && (
                        hasStarted ? (
                          <DropdownMenuItem disabled className="text-muted-foreground/50 cursor-not-allowed">
                            <Lock className="h-4 w-4 mr-2" />
                            Publish (Locked)
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handlePublishShift(shift)}
                            className="text-popover-foreground hover:bg-accent cursor-pointer"
                          >
                            <Send className="h-4 w-4 mr-2" />
                            Publish Shift
                          </DropdownMenuItem>
                        )
                      )}
              
                      {isPublished && !hasStarted && (
                        <DropdownMenuItem
                          onClick={() => handleUnpublishShift(shift)}
                          className="text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
                        >
                          <Undo2 className="h-4 w-4 mr-2" />
                          Unpublish Shift
                        </DropdownMenuItem>
                      )}
              
                      <DropdownMenuSeparator className="bg-border" />
              
                      <DropdownMenuItem
                        onClick={() => { setShiftToDelete(shift); setDeleteDialogOpen(true); }}
                        className="text-destructive hover:bg-destructive/10 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Shift
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
                
                const isSelected = selectedV8ShiftIds.has(shift.id);
                return (
                  <div key={shift.id} className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${idx * 30}ms` }}>
                    <Checkbox
                      checked={isSelected}
                      disabled={isPast}
                      onCheckedChange={() => toggleShiftSelection(shift.id)}
                      className="border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                    <div className="flex-1 min-w-0">
                      <SmartShiftCard
                        shift={shift}
                        variant="compact"
                        groupColor={groupType}
                        isLocked={isPast}
                        isPast={isPast}
                        isDnDActive={false}
                        isSelected={isSelected}
                        onClick={bulkModeActive ? () => toggleShiftSelection(shift.id) : undefined}
                        headerAction={bulkModeActive ? undefined : menu}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Local Drawer Bulk Actions Toolbar */}
        {selectedInDrawerCount > 0 && (
          <div className="border-t border-slate-200 dark:border-white/10 bg-slate-100/80 dark:bg-[#0c101c]/80 p-4 space-y-3 animate-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                {selectedInDrawerCount} of {filteredShifts.length} Shift{filteredShifts.length !== 1 ? 's' : ''} Selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearSelection()}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleBulkPublish}
                disabled={isProcessing || !hasDraftSelected || isPastDate}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs gap-1"
              >
                {isPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Publish ({draftSelectedCount})
              </Button>
              
              <Button
                size="sm"
                onClick={handleBulkUnpublish}
                disabled={isProcessing || !hasPublishedSelected || isPastDate}
                className="flex-1 border border-amber-500/20 text-amber-500 hover:bg-amber-500/10 font-medium text-xs gap-1 bg-transparent"
              >
                {isUnpublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Unpublish ({publishedSelectedCount})
              </Button>
              
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setBulkDeleteConfirmOpen(true)}
                disabled={isProcessing}
                className="font-medium text-xs gap-1 px-3"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Delete Dialog */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete {selectedInDrawerCount} Shifts?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This action cannot be undone. All {selectedInDrawerCount} selected shifts will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={isDeleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Shift?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This action cannot be undone. The shift will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={deleteMutation.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteShift}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
};
