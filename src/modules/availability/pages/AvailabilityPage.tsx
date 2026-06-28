import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { addMonths, subMonths } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { useAvailability } from '../state/useAvailability';
import { useAvailabilityEditing } from '../state/useAvailabilityEditing';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/modules/core/ui/primitives/button';
import { format } from 'date-fns';
import { AvailabilityScreen } from '../ui/AvailabilityScreen';
import { pageVariants } from '@/modules/core/ui/motion/presets';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';

type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  });

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setBreakpoint('mobile');
      } else if (width < 1024) {
        setBreakpoint('tablet');
      } else {
        setBreakpoint('desktop');
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return breakpoint;
}

export const AvailabilityPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');
  const { isDark } = useTheme();
  const { toast } = useToast();

  const [currentMonth, setCurrentMonth] = useState(new Date());

  const availabilityData = useAvailability({ month: currentMonth });
  const editingData = useAvailabilityEditing();

  const handlePrevMonth = () => setCurrentMonth((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentMonth((prev) => addMonths(prev, 1));

  const handleRefresh = async () => {
    await Promise.all([availabilityData.refreshRules(), availabilityData.refreshSlots()]);
    toast({
      title: 'Refreshed',
      description: 'Availability data has been refreshed.',
    });
  };

  const handleAddAvailability = () => {
    editingData.startCreate();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
      <GoldStandardHeader
        title="My Availabilities"
        Icon={CalendarDays}
        scope={scope}
        setScope={setScope}
        isGammaLocked={isGammaLocked}
        functionBar={
          <div className={cn(
            "flex flex-row items-center gap-2 w-full transition-all p-1.5 rounded-2xl overflow-hidden",
            isDark ? "bg-[#111827]/60" : "bg-slate-100"
          )}>
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
              {/* Month Navigation */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevMonth}
                  className={cn(
                    "h-9 w-9 lg:h-11 lg:w-11 rounded-xl transition-all",
                    isDark ? "bg-[#111827]/60 text-muted-foreground hover:text-white" : "bg-white shadow-sm"
                  )}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className={cn(
                  "h-9 lg:h-11 px-4 lg:px-6 rounded-xl flex items-center justify-center min-w-[120px] md:min-w-[180px]",
                  isDark ? "bg-[#111827]/60" : "bg-white shadow-sm"
                )}>
                  <span className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.2em] text-foreground">
                    {format(currentMonth, 'MMMM yyyy')}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNextMonth}
                  className={cn(
                    "h-9 w-9 lg:h-11 lg:w-11 rounded-xl transition-all",
                    isDark ? "bg-[#111827]/60 text-muted-foreground hover:text-white" : "bg-white shadow-sm"
                  )}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Add Availability Button */}
              <Button
                onClick={handleAddAvailability}
                className={cn(
                  "flex-shrink-0 gap-2 h-9 lg:h-11 px-3 lg:px-6 rounded-xl font-black uppercase text-[9px] lg:text-[10px] tracking-wider transition-all shadow-sm",
                  isDark 
                    ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20" 
                    : "bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100"
                )}
              >
                <Plus className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                <span className="hidden sm:inline">Add Availability</span>
                <span className="sm:hidden text-[8px]">Add</span>
              </Button>

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Refresh Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                className={cn(
                    "h-9 w-9 lg:h-11 lg:w-11 rounded-xl flex-shrink-0 transition-all",
                    isDark 
                        ? "bg-[#111827]/60 text-muted-foreground hover:text-white" 
                        : "bg-slate-200/50 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                )}
              >
                <RefreshCw className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              </Button>
            </div>
          </div>
        }
      />

      {/* ── BODY ── */}
      <motion.div
        variants={pageVariants}
        initial="hidden"
        animate="show"
        className={cn(
          "flex-1 min-h-0 overflow-hidden mx-4 lg:mx-6 mb-4 lg:mb-6 rounded-[32px] border transition-all",
          isDark
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}
      >
        <AvailabilityScreen 
          layout={breakpoint === 'desktop' ? 'desktop' : breakpoint === 'tablet' ? 'tablet' : 'mobile'}
          currentMonth={currentMonth}
          availabilityData={availabilityData}
          editingData={editingData}
        />
      </motion.div>

      <AnimatePresence>
        {!editingData.editState.mode && (
          <motion.div
            key="availability-create-fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            className="fixed bottom-[calc(max(0.375rem,calc(env(safe-area-inset-bottom,0px)-1.25rem))+84px)] right-5 z-40 md:hidden"
          >
            <Button
              onClick={handleAddAvailability}
              size="icon"
              className="h-14 w-14 rounded-full shadow-2xl bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-all duration-300"
            >
              <Plus className="h-7 w-7 stroke-[3]" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AvailabilityPage;
