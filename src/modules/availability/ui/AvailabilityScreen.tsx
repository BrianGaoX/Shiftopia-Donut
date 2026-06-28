/**
 * Availability Screen - Main Orchestrator Component
 *
 * This is the ROOT component for the Availability Management UI.
 * It orchestrates the three-pane layout and manages all state.
 *
 * RESPONSIBILITIES:
 * - Coordinate data fetching via useAvailability
 * - Coordinate edit state via useAvailabilityEditing
 * - Manage month navigation
 * - Manage lock state
 * - Pass data down to panes
 * - Handle responsive layout switching
 *
 * MUST NOT:
 * - Render form fields directly
 * - Make API calls directly
 * - Perform slot expansion
 */

import React, { useState, useCallback } from 'react';
import { addMonths, subMonths, format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { itemVariants, tabTransition } from '@/modules/core/ui/motion/presets';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Calendar,
  ClipboardList,
  Settings,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { CalendarDays } from 'lucide-react';

import { useAssignedShiftsForAvailability } from '../state/useAssignedShiftsForAvailability';
import { AvailabilityRule, AvailabilityFormPayload } from '../model/availability.types';

import { CalendarPane } from './panes/CalendarPane';
import { LogsPane } from './panes/LogsPane';
import { ConfigurePane } from './panes/ConfigurePane';

// ============================================================================
// TYPES
// ============================================================================

import { UseAvailabilityResult } from '../state/useAvailability';
import { UseAvailabilityEditingResult } from '../state/useAvailabilityEditing';

export interface AvailabilityScreenProps {
  /**
   * Layout mode for responsive design
   * - 'desktop': Three panes side-by-side
   * - 'tablet': Calendar top, Logs/Configure tabbed below
   * - 'mobile': Single pane with tab navigation
   */
  layout: 'desktop' | 'tablet' | 'mobile';
  currentMonth?: Date;
  availabilityData?: UseAvailabilityResult;
  editingData?: UseAvailabilityEditingResult;
}

type TabType = 'calendar' | 'logs' | 'configure';

// ============================================================================
// COMPONENT
// ============================================================================

export function AvailabilityScreen({ 
  layout, 
  currentMonth, 
  availabilityData, 
  editingData 
}: AvailabilityScreenProps) {
  // ========================================
  // STATE
  // ========================================

  const [activeTab, setActiveTab] = useState<TabType>('calendar');
  const [bottomTab, setBottomTab] = useState<'logs' | 'configure'>('logs');
  const { isDark } = useTheme();

  const { toast } = useToast();

  if (!currentMonth || !availabilityData || !editingData) return null;

  // ========================================
  // DATA DESTRUCTURING
  // ========================================

  const {
    rules,
    slots,
    isLoadingRules,
    isLoadingSlots,
    deleteRule,
    refreshRules,
    refreshSlots,
  } = availabilityData;

  const {
    editState,
    startCreate,
    startEdit,
    cancelEdit,
    submitEdit,
  } = editingData;

  // Fetch assigned shifts for current month (locked intervals shown as purple overlay)
  const { assignedShifts } = useAssignedShiftsForAvailability('current-user', currentMonth);

  // ========================================
  // HANDLERS
  // ========================================

  // Handlers for internal state navigation
  
  // Auto-switch tabs when entering edit mode (create or edit)
  React.useEffect(() => {
    if (editState.mode) {
      if (layout === 'mobile') {
        setActiveTab('configure');
      } else if (layout === 'tablet') {
        setBottomTab('configure');
      }
    }
  }, [editState.mode, layout]);

  const handleEditRule = useCallback(
    (rule: AvailabilityRule) => {
      startEdit(rule);
    },
    [startEdit]
  );

  const handleDeleteRule = useCallback(
    async (ruleId: string) => {
      try {
        await deleteRule(ruleId);
      } catch (error) {
        // Error toast handled by the hook
      }
    },
    [deleteRule]
  );

  const handleSubmit = useCallback(
    async (payload: AvailabilityFormPayload) => {
      const result = await submitEdit('current-user', payload);
      if (result.success) {
        toast({
          title: 'Saved',
          description:
            editState.mode === 'edit'
              ? 'Availability rule updated.'
              : 'Availability rule created.',
        });
        // Refresh data
        await Promise.all([refreshRules(), refreshSlots()]);
        // Return to logs view on tablet/mobile
        if (layout === 'mobile') {
          setActiveTab('logs');
        } else if (layout === 'tablet') {
          setBottomTab('logs');
        }
      } else if (result.errors) {
        toast({
          title: 'Error',
          description: result.errors.join(', '),
          variant: 'destructive',
        });
      }
    },
    [submitEdit, editState.mode, refreshRules, refreshSlots, layout, toast]
  );

  const handleCancel = useCallback(() => {
    cancelEdit();
    // Return to logs view on tablet/mobile
    if (layout === 'mobile') {
      setActiveTab('logs');
    } else if (layout === 'tablet') {
      setBottomTab('logs');
    }
  }, [cancelEdit, layout]);

  // ========================================
  // RENDER: SUB-COMPONENTS
  // ========================================




  // ========================================
  // RENDER: DESKTOP LAYOUT
  // ========================================

  if (layout === 'desktop') {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="flex flex-col h-full w-full overflow-hidden"
      >


        <div className="flex-1 min-h-0 overflow-hidden px-6 pb-6">
          <div className={cn(
              "h-full flex overflow-hidden rounded-[24px] border border-border/50 bg-card/30"
          )}>
          {/* LEFT: Calendar */}
          <motion.div variants={itemVariants} className="flex-[2] min-w-[400px] border-r border-border overflow-hidden">
            <CalendarPane
              slots={slots}
              assignedShifts={assignedShifts}
              currentMonth={currentMonth}
              isLoading={isLoadingSlots}
            />
          </motion.div>

          {/* MIDDLE: Logs */}
          <motion.div variants={itemVariants} className="flex-[1.5] min-w-[280px] border-r border-border overflow-hidden">
            <LogsPane
              rules={rules}
              isLoading={isLoadingRules}
              onEditRule={handleEditRule}
              onDeleteRule={handleDeleteRule}
            />
          </motion.div>

          {/* RIGHT: Configure */}
          <motion.div variants={itemVariants} className="flex-[1.5] min-w-[320px] overflow-hidden">
            <ConfigurePane
              mode={editState.mode}
              ruleBeingEdited={editState.ruleBeingEdited}
              isSubmitting={editState.isSubmitting}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

  // ========================================
  // RENDER: TABLET LAYOUT
  // ========================================

  if (layout === 'tablet') {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="flex flex-col h-full w-full overflow-hidden bg-background"
      >


        {/* TOP: Calendar */}
        <motion.div variants={itemVariants} className="h-[45%] border-b border-border overflow-hidden">
          <CalendarPane
            slots={slots}
            currentMonth={currentMonth}
            isLoading={isLoadingSlots}
          />
        </motion.div>

        {/* BOTTOM: Tabs for Logs/Configure */}
        <motion.div variants={itemVariants} className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Headers */}
          <div className="flex border-b border-border bg-muted/30 flex-shrink-0">
            <button
              onClick={() => setBottomTab('logs')}
              className={cn(
                'flex-1 py-3 px-4 text-sm font-bold transition-colors',
                bottomTab === 'logs'
                  ? 'border-b-2 border-primary text-primary bg-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Rules ({rules.length})
            </button>
            <button
              onClick={() => setBottomTab('configure')}
              className={cn(
                'flex-1 py-3 px-4 text-sm font-bold transition-colors',
                bottomTab === 'configure'
                  ? 'border-b-2 border-primary text-primary bg-background'
                  : 'text-muted-foreground hover:text-foreground',
                editState.mode && 'animate-pulse'
              )}
            >
              Configure
              {editState.mode && ' *'}
            </button>
          </div>

          {/* Tab Content */}
          <AnimatePresence mode="wait">
            <motion.div key={bottomTab} {...tabTransition} className="flex-1 overflow-hidden">
              {bottomTab === 'logs' ? (
                <LogsPane
                  rules={rules}
                  isLoading={isLoadingRules}
                  onEditRule={handleEditRule}
                  onDeleteRule={handleDeleteRule}
                />
              ) : (
                <ConfigurePane
                  mode={editState.mode}
                  ruleBeingEdited={editState.ruleBeingEdited}
                  isSubmitting={editState.isSubmitting}
                  onSubmit={handleSubmit}
                  onCancel={handleCancel}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </motion.div>
    );
  }

  // ========================================
  // RENDER: MOBILE LAYOUT
  // ========================================

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
      className="flex flex-col h-full w-full overflow-hidden bg-background"
    >


      {/* Sub-navigation Tabs at the Top - Text Only Toggle */}
      <motion.div 
        variants={itemVariants}
        className="flex-shrink-0 px-4 py-3 bg-background border-b border-border/50 z-10"
      >
        <div className="flex bg-muted/60 p-1.5 rounded-[16px] max-w-sm mx-auto">
          <button
            onClick={() => setActiveTab('calendar')}
            className={cn(
              'flex flex-1 items-center justify-center py-2.5 rounded-xl transition-all duration-300',
              activeTab === 'calendar'
                ? 'bg-background shadow-md text-foreground scale-[1.02]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="text-[12px] font-black uppercase tracking-widest font-heading">Calendar</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={cn(
              'flex flex-1 items-center justify-center py-2.5 rounded-xl transition-all duration-300',
              activeTab === 'logs' 
                ? 'bg-background shadow-md text-foreground scale-[1.02]' 
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="text-[12px] font-black uppercase tracking-widest font-heading">Rules</span>
          </button>
          <button
            onClick={() => setActiveTab('configure')}
            className={cn(
              'flex flex-1 items-center justify-center py-2.5 rounded-xl transition-all duration-300',
              activeTab === 'configure'
                ? 'bg-background shadow-md text-foreground scale-[1.02]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="text-[12px] font-black uppercase tracking-widest font-heading">
              Config{editState.mode && <span className="text-primary ml-1">*</span>}
            </span>
          </button>
        </div>
      </motion.div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab} {...tabTransition} className="flex-1 overflow-hidden">
          {activeTab === 'calendar' && (
            <CalendarPane
              slots={slots}
              currentMonth={currentMonth}
              isLoading={isLoadingSlots}
            />
          )}
          {activeTab === 'logs' && (
            <LogsPane
              rules={rules}
              isLoading={isLoadingRules}
              onEditRule={handleEditRule}
              onDeleteRule={handleDeleteRule}
            />
          )}
          {activeTab === 'configure' && (
            <ConfigurePane
              mode={editState.mode}
              ruleBeingEdited={editState.ruleBeingEdited}
              isSubmitting={editState.isSubmitting}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Floating Action Button (Mobile Only) */}
      <AnimatePresence>
        {!editState.mode && (
          <motion.div
            key="availability-create-fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            className="fixed bottom-[calc(max(0.375rem,calc(env(safe-area-inset-bottom,0px)-1.25rem))+84px)] right-6 z-50 md:hidden"
          >
            <Button
              onClick={startCreate}
              size="icon"
              className="h-16 w-16 rounded-full shadow-2xl bg-primary text-primary-foreground hover:scale-110 active:scale-95 transition-all duration-300"
            >
              <Plus className="h-8 w-8 stroke-[3]" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default AvailabilityScreen;
