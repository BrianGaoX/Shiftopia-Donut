import React, { useEffect, useRef, useState } from 'react';
import { format, isToday } from 'date-fns';
import { getSydneyNow, isSydneyToday } from '@/modules/core/lib/date.utils';
import { cn } from '@/modules/core/lib/utils';

export const HOUR_HEIGHT = 48;
export const TIME_LABEL_WIDTH = 56;
export const HEADER_HEIGHT = 64;

interface TimeGridProps {
  days: Date[];
  renderShifts: (day: Date) => React.ReactNode;
}

const TimeGrid: React.FC<TimeGridProps> = ({ days, renderShifts }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(getSydneyNow());

  // Update time every minute
  useEffect(() => {
    const id = setInterval(() => setNow(getSydneyNow()), 60000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (!scrollRef.current) return;
    const scrollTo =
      (now.getHours() + now.getMinutes() / 60) * HOUR_HEIGHT - 100;
    scrollRef.current.scrollTop = Math.max(0, scrollTo);
  }, []);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const hasToday = days.some(isSydneyToday);
  const nowTop = (now.getHours() + now.getMinutes() / 60) * HOUR_HEIGHT;

  const formatHour = (h: number) => {
    if (h === 0) return '12 AM';
    if (h < 12) return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
  };

  return (
    <div className="h-full flex flex-col bg-card rounded-lg overflow-hidden border border-border">
      {/* ===== STICKY HEADER WITH DATES ===== */}
      <div
        className="flex-shrink-0 border-b border-border bg-muted"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="h-full flex">
          {/* Time column spacer */}
          <div
            className="flex-shrink-0 border-r border-border"
            style={{ width: TIME_LABEL_WIDTH }}
          />

          {/* Day headers */}
          {days.map((day, index) => {
            const isTodayCol = isSydneyToday(day);
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center border-r border-border last:border-r-0',
                  isTodayCol && 'bg-primary/10'
                )}
              >
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  {format(day, 'EEE')}
                </div>
                <div
                  className={cn(
                    'text-lg font-bold mt-0.5',
                    isTodayCol ? 'text-primary' : 'text-foreground'
                  )}
                >
                  {format(day, 'd')}
                </div>
                {isTodayCol && (
                  <span className="text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full mt-0.5">
                    Today
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== SCROLLABLE GRID AREA ===== */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto pb-24 scrollbar-none">
        <div className="relative" style={{ height: HOUR_HEIGHT * 24 }}>
          {/* Background grid with hour rows */}
          <div className="absolute inset-0 flex">
            {/* Time labels column */}
            <div
              className="flex-shrink-0 border-r border-border"
              style={{ width: TIME_LABEL_WIDTH }}
            >
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="border-b border-border/50 flex items-start justify-end pr-2 pt-1"
                  style={{ height: HOUR_HEIGHT }}
                >
                  <span className="text-[10px] text-muted-foreground">
                    {formatHour(hour)}
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns with grid cells */}
            {days.map((day) => {
              const isTodayCol = isSydneyToday(day);
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    'flex-1 border-r border-border last:border-r-0',
                    isTodayCol && 'bg-primary/[0.02]'
                  )}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="border-b border-border/50"
                      style={{ height: HOUR_HEIGHT }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* ===== SHIFTS OVERLAY (ABSOLUTE POSITIONED) ===== */}
          <div
            className="absolute top-0 bottom-0 flex"
            style={{ left: TIME_LABEL_WIDTH, right: 0 }}
          >
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className="flex-1 relative border-r border-transparent last:border-r-0"
              >
                {renderShifts(day)}
              </div>
            ))}
          </div>

          {/* ===== NOW INDICATOR ===== */}
          {hasToday && (
            <div
              className="absolute left-0 right-0 z-30 pointer-events-none flex"
              style={{ top: nowTop }}
            >
              {/* Time label */}
              <div
                className="flex-shrink-0 flex items-center justify-end pr-1"
                style={{ width: TIME_LABEL_WIDTH }}
              >
                <span className="text-[9px] font-bold text-red-500 bg-card px-1 rounded">
                  {format(now, 'h:mm')}
                </span>
              </div>

              {/* Red line across day columns */}
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className="flex-1 flex items-center"
                >
                  {isSydneyToday(day) ? (
                    <>
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1 shadow-lg shadow-red-500/50" />
                      <div className="flex-1 h-0.5 bg-red-500 shadow-sm shadow-red-500/50" />
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TimeGrid;
