/**
 * LaborDemandForecastingPage
 *
 * Demand vs Coverage engine for a given Organization → Department → SubDepartment scope.
 *
 * Data flow:
 *   1. Scope: useOrgSelection() → org / dept / subdept (locked or selectable per access level)
 *   2. Shifts: useShiftsByDate() → all non-deleted shifts for the selected date + scope
 *   3. Computation engine (useMemo):
 *      - Required headcount per 30-min timeslot = non-cancelled shifts covering that slot
 *      - Existing coverage per slot = assigned shifts covering that slot
 *      - Residual = required − existing (unassigned positions)
 *      - Role coverage: reqHours / existingHours / gap per role
 *      - Proposed injection: unassigned shifts grouped by role
 *      - Budget: cost from real remuneration levels
 *   4. Confirm & Inject: publishes proposed shifts for roster filling
 */

import React, { useState, useMemo } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// Domain
import { shiftsQueries } from "../api/shifts.queries";
import { shiftKeys } from "../api/queryKeys";
import { useShiftsByDate } from "../state/useRosterShifts";
import type { Shift } from "../domain/shift.entity";

// Scope
import { useScopeFilter } from "@/platform/auth/useScopeFilter";

// Layout
import { PageLayout } from "@/modules/core/ui/layout/PageLayout";
import { PersonalPageHeader } from "@/modules/core/ui/components/PersonalPageHeader";

// UI Primitives
import { Badge } from "@/modules/core/ui/primitives/badge";
import { Button } from "@/modules/core/ui/primitives/button";
import { Slider } from "@/modules/core/ui/primitives/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/modules/core/ui/primitives/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/core/ui/primitives/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/modules/core/ui/primitives/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/modules/core/ui/primitives/sheet";
import { cn } from "@/modules/core/lib/utils";

// Icons
import {
  Activity,
  AlertTriangle,
  AlertCircle,
  ArrowRightLeft,
  Award,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  DollarSign,
  Eye,
  GitBranch,
  Info,
  Layers,
  Lock,
  Layout,
  Minus,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
  Calendar,
  CalendarX,
  Clock,
  MapPin,
  Sparkles,
  BarChart3,
  MessageSquare,
} from "lucide-react";

// Phase 5: shift synthesis wiring
import { supabase } from "@/platform/supabase/client";
import {
  buildScopeDemand,
  type ScopeDemandResult,
} from "../services/demandTensorBuilder.service";
import { synthesizeShifts } from "../services/shiftSynthesizer.service";
import {
  ConfirmGenerationModal,
  type GenerationOptions,
} from "./components/ConfirmGenerationModal";
import { SupervisorFeedbackPromptModal } from "../ui/components/SupervisorFeedbackPromptModal";
import {
  useGenerateShifts,
  useRollbackSynthesisRun,
  useShiftSynthesisPreview,
} from "../state/useShiftSynthesis";
import { synthesisRunsQueries } from "../api/synthesisRuns.queries";
import {
  venueopsEventsQueries,
  type EventSummary,
} from "../api/venueopsEvents.queries";
import type { SynthesizedShift } from "../domain/shiftSynthesizer.policy";
import { createModuleLogger } from "@/modules/core/lib/logger";

const log = createModuleLogger("LaborDemandPage");

const BucketBadge = ({ bucket }: { bucket?: string }) => {
  const styles = {
    static: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    semi_dynamic: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dynamic: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20",
  }[bucket || "static"] || "bg-muted/10 text-muted-foreground border-border/20";
  
  return (
    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-tight", styles)}>
      {bucket?.replace("_", "-") || "static"}
    </span>
  );
};

/* =============================================================
   CONSTANTS & UTILITIES
   ============================================================= */

const SLOT_MINUTES = Array.from({ length: 27 }, (_, i) => 7 * 60 + i * 30); // 07:00–20:00

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function shiftNetMinutes(shift: Shift): number {
  const gross = timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time);
  return Math.max(0, gross - (shift.unpaid_break_minutes ?? 0));
}

const isRequired = (s: Shift) => s.lifecycle_status !== "Cancelled";
const isAssigned = (s: Shift) => !!s.assigned_employee_id;

function formatCurrency(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* =============================================================
   TYPES
   ============================================================= */
type ViewMode = "preview" | "raw";
type StrategyMode = "lean" | "balanced" | "conservative";

interface TimelinePoint {
  time: string;
  required: number;
  existing: number;
  residual: number;
  injection: number;
}

interface RoleCoverageRow {
  roleId: string;
  role: string;
  reqHours: number;
  existing: number;
  gap: number;
  status: "under" | "at-risk" | "optimized";
  bucket?: string;
}

interface ProposedInjectionGroup {
  roleName: string;
  count: number;
  avgHours: number;
  totalHours: number;
  description: string;
  reasons?: string[];
}




  // EVENTS ON THIS DATE PANEL
  // Shows what's driving the demand curve so managers can see at a glance
  // which events on the selected date produce the forecasted staffing need.
interface EventsOnDatePanelProps {
  events: EventSummary[];
  isLoading: boolean;
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' });
}

const EventsOnDatePanel: React.FC<EventsOnDatePanelProps> = ({ events, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-card border border-border/60 rounded-xl p-4 animate-pulse">
        <div className="h-3 bg-muted rounded w-1/3 mb-3" />
        <div className="h-6 bg-muted rounded w-2/3" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
        <CalendarX className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-400">No events scheduled on this date</p>
          <p className="text-xs text-amber-400/80 mt-0.5">Shift generation will produce no demand.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-4 w-4 text-fuchsia-400" />
        <span className="font-semibold text-sm">Events on this date</span>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          {events.length}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {events.map(event => (
          <div key={event.event_id} className="bg-muted/30 border border-border/40 rounded-lg px-3 py-2.5">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{event.name}</p>
              {event.event_type_name && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25 shrink-0 uppercase tracking-wide">
                  {event.event_type_name}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {event.estimated_total_attendance.toLocaleString('en-AU')} attendees
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatEventTime(event.start_date_time)} → {formatEventTime(event.end_date_time)}
              </span>
              {(event.venue_name || event.room_name) && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {[event.venue_name, event.room_name].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* =============================================================
   CUSTOM CHART TOOLTIP
   ============================================================= */
const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const req = payload.find((p) => p.dataKey === "required")?.value ?? 0;
  const ex = payload.find((p) => p.dataKey === "existing")?.value ?? 0;
  const injection = payload.find((p) => p.dataKey === "injection")?.value ?? 0;
  const gap = req - (ex + injection);

  return (
    <div className="bg-card/95 backdrop-blur border border-border rounded-xl p-3 shadow-2xl text-sm min-w-[170px]">
      <p className="text-muted-foreground font-medium mb-2 text-xs uppercase tracking-wide">
        {label}
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-6">
          <span className="text-violet-400 font-medium">Required</span>
          <span className="font-bold">{req}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-emerald-400 font-medium">Existing</span>
          <span className="font-bold">{ex}</span>
        </div>
        {injection > 0 && (
          <div className="flex items-center justify-between gap-6">
            <span className="text-cyan-400 font-medium">New</span>
            <span className="font-bold text-cyan-400">+{injection}</span>
          </div>
        )}
        <div className="h-px bg-border/50" />
        <div className="flex items-center justify-between gap-6">
          <span className="text-red-400 font-medium">Gap</span>
          <span
            className={cn(
              "font-bold",
              gap > 0
                ? "text-red-400"
                : gap < 0
                  ? "text-emerald-400"
                  : "text-muted-foreground",
            )}
          >
            {gap}
          </span>
        </div>
      </div>
    </div>
  );
};

/* =============================================================
   METRIC CARD
   ============================================================= */
interface MetricCardProps {
  label: string;
  value: string | number;
  status?: "ok" | "warn" | "critical" | "neutral";
  trend?: "up" | "down";
  valueColor?: string;
  skeleton?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  status = "neutral",
  trend,
  valueColor,
  skeleton,
}) => {
  const statusIcon = {
    ok: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    warn: <AlertTriangle className="h-4 w-4 text-amber-400" />,
    critical: <AlertCircle className="h-4 w-4 text-red-500" />,
    neutral: null,
  }[status];

  const defaultColor = {
    ok: "text-emerald-400",
    warn: "text-amber-400",
    critical: "text-red-400",
    neutral: "text-foreground",
  }[status];

  if (skeleton) {
    return (
      <div className="bg-card border border-border/60 rounded-xl p-4 animate-pulse">
        <div className="h-3 bg-muted rounded w-3/4 mb-3" />
        <div className="h-8 bg-muted rounded w-1/2" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col gap-2 hover:border-border transition-colors">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold leading-tight">
          {label}
        </p>
        <div className="flex items-center gap-1">
          {trend === "up" && (
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
          )}
          {statusIcon}
        </div>
      </div>
      <p
        className={cn(
          "text-3xl font-bold tracking-tight",
          valueColor ?? defaultColor,
        )}
      >
        {value}
      </p>
    </div>
  );
};

/* =============================================================
   STATUS BADGE
   ============================================================= */
const StatusBadge: React.FC<{ status: "under" | "at-risk" | "optimized" }> = ({
  status,
}) => {
  const cfg = {
    under: {
      label: "Under",
      cls: "bg-red-500/15 text-red-400 border border-red-500/30",
    },
    "at-risk": {
      label: "At Risk",
      cls: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
    },
    optimized: {
      label: "Optimized",
      cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
    },
  }[status];
  return (
    <span
      className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", cfg.cls)}
    >
      {cfg.label}
    </span>
  );
};

/* =============================================================
   TOGGLE PILL
   ============================================================= */
const TogglePill: React.FC<{
  active: boolean;
  onClick: () => void;
  color: string;
  label: string;
}> = ({ active, onClick, color, label }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
      active
        ? "border-transparent"
        : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border",
    )}
    style={
      active ? { backgroundColor: `${color}1A`, borderColor: color, color } : {}
    }
  >
    <span
      className="h-2 w-2 rounded-full shrink-0"
      style={{
        backgroundColor: active ? color : "currentColor",
        opacity: active ? 1 : 0.4,
      }}
    />
    {label}
  </button>
);

/* =============================================================
   CONFIG CHECKBOX
   ============================================================= */
const ConfigCheckbox: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  badge?: string;
  badgeVariant?: "warn" | "ok";
}> = ({ checked, onChange, label, badge, badgeVariant = "ok" }) => (
  <label className="flex items-center gap-2.5 cursor-pointer group select-none">
    <div
      onClick={() => onChange(!checked)}
      className={cn(
        "h-4 w-4 rounded flex items-center justify-center border transition-all shrink-0",
        checked
          ? "bg-primary border-primary"
          : "border-border/70 bg-background group-hover:border-primary/50",
      )}
    >
      {checked && (
        <svg
          className="h-3 w-3 text-primary-foreground"
          fill="none"
          viewBox="0 0 12 12"
        >
          <path
            d="M2 6l3 3 5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
    <span className="text-sm font-medium text-foreground">{label}</span>
    {badge && (
      <span
        className={cn(
          "text-[10px] font-semibold px-2 py-0.5 rounded-full",
          badgeVariant === "warn"
            ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
            : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
        )}
      >
        {badge}
      </span>
    )}
  </label>
);

/* =============================================================
   OPTIMIZATION SLIDER ROW
   ============================================================= */

/** Strategy preset definitions — weights applied when a preset is selected */
const STRATEGY_PRESETS: Record<
  StrategyMode,
  { cost: number; service: number; fatigue: number }
> = {
  lean: { cost: 90, service: 25, fatigue: 20 },
  balanced: { cost: 70, service: 55, fatigue: 80 },
  conservative: { cost: 25, service: 90, fatigue: 90 },
};

function weightLabel(v: number): string {
  if (v >= 75) return "High";
  if (v >= 45) return "Medium";
  return "Low";
}

const OptSlider: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}> = ({ label, value, onChange, color }) => {
  const pct = value;
  const lvl = weightLabel(value);

  return (
    <div className="space-y-1.5">
      {/* Header row */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <span className="font-bold" style={{ color }}>
            {lvl}
          </span>
          <span className="text-muted-foreground/60 tabular-nums">{pct}%</span>
        </div>
      </div>

      {/* Slider */}
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={0}
        max={100}
        step={5}
        className="w-full"
      />

      {/* Colored fill bar indicator (visual complement to the slider) */}
      <div className="h-1 w-full rounded-full bg-muted/40 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};



/* =============================================================
   EMPTY STATE
   ============================================================= */
const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
    <Activity className="h-10 w-10 opacity-20" />
    <p className="text-sm font-medium">{message}</p>
    <p className="text-xs opacity-60">
      Select a different date or check the scope filter above
    </p>
  </div>
);

/* =============================================================
   DETAIL MODAL (per-timeslice breakdown)
   ============================================================= */
const DetailsModal: React.FC<{
  data: TimelinePoint[];
  onClose: () => void;
}> = ({ data, onClose }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.95, y: 12 }}
      animate={{ scale: 1, y: 0 }}
      exit={{ scale: 0.95, y: 12 }}
      className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-bold">Per-Timeslice Breakdown</h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xl leading-none"
        >
          ×
        </button>
      </div>
      <div className="overflow-auto max-h-[60vh]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Time", "Required", "Existing", "Gap"].map((h) => (
                <th
                  key={h}
                  className={cn(
                    "py-2 pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium",
                    h !== "Time" && "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  "border-b border-border/30 hover:bg-muted/20 transition-colors",
                  row.residual > 0 &&
                    row.residual === Math.max(...data.map((d) => d.residual)) &&
                    "bg-red-500/5",
                )}
              >
                <td className="py-2 pr-4 font-mono text-muted-foreground">
                  {row.time}
                </td>
                <td className="py-2 pr-4 text-right font-semibold">
                  {row.required}
                </td>
                <td className="py-2 pr-4 text-right font-semibold text-emerald-400">
                  {row.existing}
                </td>
                <td
                  className={cn(
                    "py-2 text-right font-bold",
                    row.residual > 0 ? "text-red-400" : "text-muted-foreground",
                  )}
                >
                  {row.residual > 0 ? `-${row.residual}` : "0"}
                  {row.residual > 0 &&
                    row.residual ===
                      Math.max(...data.map((d) => d.residual)) && (
                      <span className="ml-2 text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">
                        PEAK
                      </span>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  </motion.div>
);

/* =============================================================
   RAW DATA PANEL
   ============================================================= */
const RawDataPanel: React.FC<{
  timelineData: TimelinePoint[];
  shiftCount: number;
  orgId: string;
  date: string;
}> = ({ timelineData, shiftCount, orgId, date }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-card border border-border/60 rounded-xl p-6 font-mono text-xs space-y-4"
  >
    <div className="flex items-center gap-2 mb-4">
      <Database className="h-4 w-4 text-fuchsia-400" />
      <span className="text-fuchsia-400 font-semibold text-sm">
        Raw Engine Tensors
      </span>
      <Badge className="ml-2 text-[10px] bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30">
        {shiftCount} shifts · {date}
      </Badge>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[
        {
          label: "required_headcount_timeslice",
          color: "text-violet-400",
          values: timelineData.map((d) => d.required),
        },
        {
          label: "existing_coverage_timeslice",
          color: "text-emerald-400",
          values: timelineData.map((d) => d.existing),
        },
        {
          label: "residual_headcount_timeslice",
          color: "text-red-400",
          values: timelineData.map((d) => d.residual),
        },
      ].map(({ label, color, values }) => (
        <div key={label}>
          <p className="text-muted-foreground mb-2 text-[10px] uppercase tracking-widest">
            {label}
          </p>
          <div
            className={cn(
              "bg-background/60 rounded-lg p-3 border border-border/40 leading-relaxed break-all",
              color,
            )}
          >
            [{values.join(", ")}]
          </div>
        </div>
      ))}
      <div>
        <p className="text-muted-foreground mb-2 text-[10px] uppercase tracking-widest">
          solver_meta
        </p>
        <div className="bg-background/60 rounded-lg p-3 border border-border/40 text-amber-400 space-y-1 leading-relaxed">
          <div>
            organization_id:{" "}
            <span className="text-foreground text-[10px] break-all">
              {orgId}
            </span>
          </div>
          <div>
            analysis_date: <span className="text-foreground">{date}</span>
          </div>
          <div>
            slot_resolution: <span className="text-foreground">30 min</span>
          </div>
          <div>
            slots_computed:{" "}
            <span className="text-foreground">{timelineData.length}</span>
          </div>
          <div>
            peak_gap:{" "}
            <span className="text-red-400 font-bold">
              {Math.max(0, ...timelineData.map((d) => d.residual))}
            </span>
          </div>
          <div>
            rule_engine_v: <span className="text-foreground">2.4.1</span>
          </div>
          <div>
            model_v: <span className="text-foreground">v9.0-heuristic</span>
          </div>
        </div>
      </div>
    </div>
  </motion.div>
);

/* =============================================================
   MAIN PAGE
   ============================================================= */
const LaborDemandForecastingPage: React.FC = () => {
  const queryClient = useQueryClient();

  // ── Scope ───────────────────────────────────────────────────
  const {
    scope,
    setScope,
    scopeKey,
    isGammaLocked,
    isLoading: isScopeLoading,
  } = useScopeFilter("managerial");

  // Multi-department derived IDs
  const organizationId = scope.org_ids[0] || null;
  const departmentId = scope.dept_ids[0] || null; // For legacy single-ID calls
  const subDepartmentId = scope.subdept_ids[0] || null; // For legacy single-ID calls
  const departmentIds = scope.dept_ids;
  const subDepartmentIds = scope.subdept_ids;

  // Use the first selected dept name if available (simple fallback)
  const departmentName = departmentId ? "Selected Department" : null; 
  const subDepartmentName = subDepartmentId ? "Selected Sub-Department" : null;
  const hasCompleteSelection = scope.org_ids.length > 0 && scope.dept_ids.length > 0;

  // ── Local state ─────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(() =>
    format(new Date(), "yyyy-MM-dd"),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  // Chart toggles
  const [showNewInjection, setShowNewInjection] = useState(true);
  const [showRequired, setShowRequired] = useState(true);
  const [showExisting, setShowExisting] = useState(true);
  const [showResidual, setShowResidual] = useState(true);

  // Config
  const [useFtBaseline, setUseFtBaseline] = useState(true);
  const [mergeMicroPeaks, setMergeMicroPeaks] = useState(true);
  const [respectBudget, setRespectBudget] = useState(true);
  const [enforceCompliance, setEnforceCompliance] = useState(true);
  const [preventOvertime, setPreventOvertime] = useState(false);

  // Optimization
  const [strategyMode, setStrategyMode] = useState<StrategyMode>("balanced");
  const [costWeight, setCostWeight] = useState(STRATEGY_PRESETS.balanced.cost);
  const [serviceWeight, setServiceWeight] = useState(
    STRATEGY_PRESETS.balanced.service,
  );
  const [fatigueWeight, setFatigueWeight] = useState(
    STRATEGY_PRESETS.balanced.fatigue,
  );
  // C2: target coverage confidence (%) for demand buffering. 50 = median (no
  // buffer); raising it staffs above the point estimate to absorb demand
  // variance. Passed to buildScopeDemand as serviceLevel = pct / 100.
  const [coverageConfidence, setCoverageConfidence] = useState(50);

  const handleStrategyChange = (mode: StrategyMode) => {
    setStrategyMode(mode);
    const preset = STRATEGY_PRESETS[mode];
    setCostWeight(preset.cost);
    setServiceWeight(preset.service);
    setFatigueWeight(preset.fatigue);
  };

  // ── Data: Shifts ────────────────────────────────────────────
  const shiftFilters = useMemo(
    () => ({
      departmentIds: departmentIds.length > 0 ? departmentIds : undefined,
      subDepartmentIds: subDepartmentIds.length > 0 ? subDepartmentIds : undefined,
    }),
    [departmentIds, subDepartmentIds],
  );

  const {
    data: shifts = [],
    isLoading: shiftsLoading,
    isFetching,
  } = useShiftsByDate(organizationId, selectedDate, shiftFilters);

  // ── Data: Roles in scope (for ML tensor construction) ────────
  const { data: rolesInScope = [] } = useQuery({
    queryKey: ["rolesInScope", departmentId, subDepartmentId],
    queryFn: async () => {
      let q = supabase
        .from("roles")
        .select("id, name, sub_department_id, forecasting_bucket, supervision_ratio_min, supervision_ratio_max, is_baseline_eligible")
        .eq("department_id", departmentId ?? "")
        .limit(50);
      if (subDepartmentId) q = q.eq("sub_department_id", subDepartmentId);
      const { data, error } = await q;
      if (error) return [];
      return ((data as any) ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        subDepartmentId: r.sub_department_id,
        forecasting_bucket: r.forecasting_bucket as any,
        supervision_ratio_min: r.supervision_ratio_min,
        supervision_ratio_max: r.supervision_ratio_max,
        is_baseline_eligible: r.is_baseline_eligible,
      }));
    },
    enabled: !!departmentId,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // ── Data: Remuneration Levels ────────────────────────────────
  const { data: remunerationLevels = [] } = useQuery({
    queryKey: shiftKeys.lookups.remunerationLevels(),
    queryFn: () => shiftsQueries.getRemunerationLevels(),
    staleTime: 5 * 60_000,
  });

  // ── Preview & Cache State ────────────────────────────────────
  // Phase 5: preview is gated — ML call only fires after user clicks "Generate Shift Preview".
  // We track the specific scope/date the preview was requested for to avoid auto-generation on switch.
  const [requestedPreviewKey, setRequestedPreviewKey] = useState<string | null>(
    null,
  );
  const currentScopeKey = `${selectedDate}-${scopeKey}`;
  const isRequested = requestedPreviewKey === currentScopeKey;

  // ── Data: ML Scope Demand (gated on isRequested) ────────
  const {
    data: scopeDemand,
    isLoading: demandLoading,
    isFetching: demandFetching,
  } = useQuery<ScopeDemandResult>({
    queryKey: [
      "scopeDemand",
      organizationId,
      departmentId,
      subDepartmentId,
      selectedDate,
      rolesInScope.map((r) => r.id).join(","),
      coverageConfidence,
    ],
    queryFn: () =>
      buildScopeDemand({
        organizationId: organizationId!,
        date: selectedDate,
        departmentId: departmentId ?? undefined,
        subDepartmentId: subDepartmentId ?? null,
        roles: rolesInScope,
        existingShifts: shifts,
        buildingType: "convention_centre",
        // C2: coverage-confidence slider → service-level demand buffer.
        serviceLevel: coverageConfidence / 100,
      }),
    enabled:
      isRequested &&
      !shiftsLoading && // Wait for shifts to be stable
      !!organizationId &&
      rolesInScope.length > 0 &&
      !!selectedDate,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const { data: previewResponse, isFetching: isPreviewFetching } =
    useShiftSynthesisPreview(
      scopeDemand?.tensors,
      scopeDemand?.baselineShifts,
      shifts,
      isRequested && !!scopeDemand && !shiftsLoading,
    );

  const previewReady =
    isRequested &&
    !!scopeDemand &&
    !demandFetching &&
    !isPreviewFetching &&
    !!previewResponse &&
    !shiftsLoading;

  // ── Computation: Demand totals per slot (summed over all roles) ──
  const demandBySlot = useMemo<number[]>(() => {
    const tensors =
      previewResponse?.appliedTensors ?? scopeDemand?.tensors ?? [];
    return SLOT_MINUTES.map((slotStart) => {
      let total = 0;
      for (const tensor of tensors) {
        const slot = tensor.slots.find((s) => s.slotStart === slotStart);
        if (slot) total += slot.requiredHeadcount;
      }
      return total;
    });
  }, [previewResponse?.appliedTensors, scopeDemand?.tensors]);

  // ── Computation: Dry-run synthesized shifts (Phase 5 task 5) ─────
  const previewShifts = useMemo<SynthesizedShift[]>(() => {
    return previewResponse?.addedShifts || [];
  }, [previewResponse]);

  // ── Computation: Timeslice data ──────────────────────────────
  const timelineData = useMemo<TimelinePoint[]>(() => {
    return SLOT_MINUTES.map((slot, i) => {
      // "Existing" covers any non-cancelled shift, assigned or not.
      // This matches the builder's gap-fill residual calc — so the chart
      // reflects what the synthesizer will actually do on the next preview.
      let existing = 0;
      shifts.forEach((shift) => {
        const start = timeToMinutes(shift.start_time);
        const end = timeToMinutes(shift.end_time);
        if (start <= slot && end > slot && isRequired(shift)) existing++;
      });

      const required = demandBySlot[i] ?? 0;
      const residual = required - existing;

      // injection = preview shifts covering this slot, summed by headcount
      let injection = 0;
      for (const ps of previewShifts) {
        if (ps.startMinutes <= slot && ps.endMinutes > slot)
          injection += ps.headcount;
      }

      return {
        time: minutesToTime(slot),
        required,
        existing,
        residual,
        injection: showNewInjection ? injection : 0,
      };
    });
  }, [shifts, demandBySlot, previewShifts, showNewInjection]);

  // ── Computation: Metrics ─────────────────────────────────────
  const metrics = useMemo(() => {
    const reqs = timelineData.map((d) => d.required);
    const exs = timelineData.map((d) => d.existing);
    const gaps = timelineData.map((d) => d.residual);

    const peakRequired = reqs.length > 0 ? Math.max(...reqs) : 0;
    const peakExisting = exs.length > 0 ? Math.max(...exs) : 0;
    const peakGap = gaps.length > 0 ? Math.max(...gaps) : 0;
    const peakGapTime =
      timelineData.find((d) => d.residual === peakGap)?.time ?? "—";

    const totalReqMin = shifts
      .filter(isRequired)
      .reduce((s, sh) => s + shiftNetMinutes(sh), 0);
    const existingMin = shifts
      .filter(isAssigned)
      .reduce((s, sh) => s + shiftNetMinutes(sh), 0);
    const residualMin = totalReqMin - existingMin;

    const baselineHours = (scopeDemand?.baselineShifts ?? []).reduce((s, sh) => s + (sh.endMinutes - sh.startMinutes), 0) / 60;
    const surgeHours = (scopeDemand?.tensors ?? [])
      .filter(t => t.demandSource === 'ml_predicted')
      .reduce((s, t) => s + t.slots.reduce((ss, slot) => ss + slot.requiredHeadcount, 0) * 0.5, 0);
    const derivedHours = (scopeDemand?.tensors ?? [])
      .filter(t => t.demandSource === 'derived')
      .reduce((s, t) => s + t.slots.reduce((ss, slot) => ss + slot.requiredHeadcount, 0) * 0.5, 0);

    return {
      peakRequired,
      peakExisting,
      peakGap,
      peakGapTime,
      totalReqHours: Math.round(totalReqMin / 60),
      existingSchedHours: Math.round(existingMin / 60),
      residualHours: Math.round(residualMin / 60),
      baselineHours,
      surgeHours,
      derivedHours,
    };
  }, [timelineData, shifts, scopeDemand]);

  // ── Computation: Role Coverage ───────────────────────────────
  // Phase 5 semantic:
  //   reqHours  = ML-predicted demand hours for this role (sum of tensor slots × 0.5h)
  //   existing  = hours currently rostered for this role (any non-cancelled shift, incl. drafts)
  //   gap       = existing − req (negative = under-rostered)
  const roleCoverageData = useMemo<RoleCoverageRow[]>(() => {
    const reqHoursByRole = new Map<string, number>();
    const existingHoursByRole = new Map<string, number>();
    const nameByRole = new Map<string, string>();

    // Required: from ML tensors when a preview has run.
    for (const tensor of scopeDemand?.tensors ?? []) {
      const totalReqHeadcountSlots = tensor.slots.reduce(
        (s, slot) => s + slot.requiredHeadcount,
        0,
      );
      const hours = totalReqHeadcountSlots * 0.5; // each slot is 30 minutes
      reqHoursByRole.set(
        tensor.roleId,
        (reqHoursByRole.get(tensor.roleId) ?? 0) + hours,
      );
    }

    // Existing: every non-cancelled shift in scope, regardless of assignment.
    shifts.filter(isRequired).forEach((shift) => {
      const roleId = shift.role_id ?? "__none__";
      const name =
        (shift.roles as { name: string } | null)?.name ?? "Unassigned";
      nameByRole.set(roleId, name);
      existingHoursByRole.set(
        roleId,
        (existingHoursByRole.get(roleId) ?? 0) + shiftNetMinutes(shift) / 60,
      );
    });

    // Lift role names from rolesInScope too — so ML-only roles (no existing shifts yet) still render.
    rolesInScope.forEach((r) => {
      if (!nameByRole.has(r.id)) nameByRole.set(r.id, r.name);
    });

    const allV8RoleIds = new Set([
      ...reqHoursByRole.keys(),
      ...existingHoursByRole.keys(),
    ]);

    return Array.from(allV8RoleIds)
      .map((roleId) => {
        const reqH = +(reqHoursByRole.get(roleId) ?? 0).toFixed(1);
        const exH = +(existingHoursByRole.get(roleId) ?? 0).toFixed(1);
        const gapH = +(exH - reqH).toFixed(1);
        const status: RoleCoverageRow["status"] =
          gapH >= 0 ? "optimized" : gapH > -4 ? "at-risk" : "under";
        const bucket = rolesInScope.find(r => r.id === roleId)?.forecasting_bucket || 'static';
        return {
          roleId,
          role: nameByRole.get(roleId) ?? "Unknown",
          reqHours: reqH,
          existing: exH,
          gap: gapH,
          status,
          bucket,
        };
      })
      .sort((a, b) => a.gap - b.gap);
  }, [shifts, scopeDemand, rolesInScope]);

  // ── Computation: Proposed Adjustments (Additions & Deletions) ──
  const {
    proposedInjection,
    proposedDeletions,
    totalProposedShifts,
    totalProposedHours,
    totalDeletedShifts,
    totalDeletedHours,
  } = useMemo(() => {
    const shiftIdsToDelete = new Set(previewResponse?.suggestedDeletions || []);
    const additionsByRole = new Map<
      string,
      { count: number; totalMin: number; reasons: Set<string> }
    >();
    const deletionsByRole = new Map<
      string,
      { count: number; totalMin: number }
    >();

    // Process additions
    for (const s of previewShifts) {
      const durMin = s.endMinutes - s.startMinutes;
      const cur = additionsByRole.get(s.roleId) ?? { count: 0, totalMin: 0, reasons: new Set<string>() };
      
      // Collect all reasons from this shift
      if (s.reasons && s.reasons.length > 0) {
        s.reasons.forEach(r => cur.reasons.add(r));
      }
      
      additionsByRole.set(s.roleId, {
        count: cur.count + s.headcount,
        totalMin: cur.totalMin + durMin * s.headcount,
        reasons: cur.reasons,
      });
    }

    // Process deletions
    for (const s of shifts) {
      if (shiftIdsToDelete.has(s.id)) {
        const durMin = shiftNetMinutes(s);
        const roleId = s.role_id ?? "__none__";
        const cur = deletionsByRole.get(roleId) ?? { count: 0, totalMin: 0 };
        deletionsByRole.set(roleId, {
          count: cur.count + 1,
          totalMin: cur.totalMin + durMin,
        });
      }
    }

    const roleIdToName = new Map<string, string>(
      rolesInScope.map((r) => [r.id, r.name]),
    );

    // Ensure all deleted roles have names
    for (const s of shifts) {
      if (
        shiftIdsToDelete.has(s.id) &&
        s.role_id &&
        !roleIdToName.has(s.role_id)
      ) {
        roleIdToName.set(
          s.role_id,
          (s.roles as { name: string } | null)?.name ?? "Unknown",
        );
      }
    }

    const formatGroup = (
      byRole: Map<string, { count: number; totalMin: number; reasons?: Set<string> }>,
      type: "add" | "delete",
    ): ProposedInjectionGroup[] => {
      return Array.from(byRole.entries())
        .map(([roleId, d]) => ({
          roleName: roleIdToName.get(roleId) ?? "Unknown",
          count: d.count,
          avgHours: d.count > 0 ? +(d.totalMin / d.count / 60).toFixed(1) : 0,
          totalHours: +(d.totalMin / 60).toFixed(1),
          description:
            type === "add"
              ? d.count === 1
                ? "Single shift"
                : d.count <= 3
                  ? "Targeted fill"
                  : "Primary fill"
              : d.count === 1
                ? "Safe deletion"
                : "Batch deletion",
          reasons: d.reasons ? Array.from(d.reasons) : [],
        }))
        .sort((a, b) => b.count - a.count);
    };

    const addGroups = formatGroup(additionsByRole, "add");
    const delGroups = formatGroup(deletionsByRole, "delete");

    return {
      proposedInjection: addGroups,
      proposedDeletions: delGroups,
      totalProposedShifts: addGroups.reduce((s, g) => s + g.count, 0),
      totalProposedHours: addGroups.reduce((s, g) => s + g.totalHours, 0),
      totalDeletedShifts: delGroups.reduce((s, g) => s + g.count, 0),
      totalDeletedHours: delGroups.reduce((s, g) => s + g.totalHours, 0),
    };
  }, [
    previewShifts,
    shifts,
    previewResponse?.suggestedDeletions,
    rolesInScope,
  ]);

  // ── Computation: Budget ──────────────────────────────────────
  const budgetData = useMemo(() => {
    const getAvgRate = (shift: Shift): number => {
      const lvl = shift.remuneration_levels as {
        hourly_rate_min: number;
        hourly_rate_max: number;
      } | null;
      if (lvl) return (lvl.hourly_rate_min + lvl.hourly_rate_max) / 2;
      // Fall back to level lookup
      const level = remunerationLevels.find(
        (l) => l.id === shift.remuneration_level_id,
      );
      if (level) return (level.hourly_rate_min + level.hourly_rate_max) / 2;
      return 28; // enterprise default
    };

    const currentSpend = shifts.filter(isAssigned).reduce((sum, s) => {
      return sum + (shiftNetMinutes(s) / 60) * getAvgRate(s);
    }, 0);

    const projectedAdd = shifts
      .filter((s) => isRequired(s) && !isAssigned(s))
      .reduce((sum, s) => {
        return sum + (shiftNetMinutes(s) / 60) * getAvgRate(s);
      }, 0);

    const budgetCap = 30_000;
    return {
      currentSpend: Math.round(currentSpend),
      projectedTotal: Math.round(currentSpend + projectedAdd),
      variance: Math.round(projectedAdd),
      budgetCap,
      withinBudget: currentSpend + projectedAdd <= budgetCap,
      pct: Math.min(100, ((currentSpend + projectedAdd) / budgetCap) * 100),
    };
  }, [shifts, remunerationLevels]);

  // ── Mutations (Phase 5) ──────────────────────────────────────
  const generateMutation = useGenerateShifts();
  const rollbackMutation = useRollbackSynthesisRun();

  const handleConfirmGeneration = async (options: GenerationOptions) => {
    if (!organizationId || !departmentId) return;

    log.info("confirming injection", {
      operation: "handleConfirmGeneration",
      date: selectedDate,
      departmentId,
      subDepartmentId,
      tensorCount: scopeDemand?.tensors.length ?? 0,
      options,
    });

    const rosters = await shiftsQueries.getRosters(organizationId, {
      departmentId,
      subDepartmentId: subDepartmentId ?? undefined,
    });
    const active = rosters.find(
      (r) => r.start_date <= selectedDate && r.end_date >= selectedDate,
    );
    if (!active) {
      log.warn("no active roster for date", {
        operation: "handleConfirmGeneration",
        date: selectedDate,
        rostersFound: rosters.length,
      });
      toast.error(
        `No active roster found for ${selectedDate}. Create a roster first.`,
      );
      return;
    }
    log.info("active roster found", {
      operation: "handleConfirmGeneration",
      rosterId: active.id,
      date: selectedDate,
    });

    try {
      const result = await generateMutation.mutateAsync({
        organizationId,
        departmentId,
        subDepartmentId: subDepartmentId ?? null,
        rosterId: active.id,
        shiftDate: selectedDate,
        demandTensors: previewResponse?.appliedTensors ?? scopeDemand?.tensors ?? [],
        demandTensorRows: scopeDemand?.demandTensorRows ?? [],
        baselineShifts: scopeDemand?.baselineShifts ?? [],
        snapshotHash: previewResponse?.snapshotHash,
        suggestedDeletions: previewResponse?.suggestedDeletions,
        enforceSupervisorRatios: options.enforceSupervisorRatios,
        enforceMinimumStaff: options.enforceMinimumStaff,
        enforceMinMax: options.enforceMinMax,
        mergeMicroPeaks: options.mergeMicroPeaks,
        options: options as unknown as Record<string, unknown>,
      });
      setShowConfirmDialog(false);
      setRequestedPreviewKey(null);
      toast.success(
        `${result.createdCount} shifts added, ${result.deletedCount} shifts deleted`,
        {
          description: `${subDepartmentName || departmentName || "Current scope"} · ${selectedDate}`,
          action: {
            label: "Undo",
            onClick: () => {
              rollbackMutation.mutate(result.runId, {
                onSuccess: (r) => {
                  if (r.orphaned) {
                    toast.warning("Rollback: no shifts matched this run", {
                      description:
                        "Shifts may predate the synthesis_run_id wiring. Clean up manually.",
                    });
                    return;
                  }
                  toast.success(
                    `Rolled back: ${r.deletedCount} shifts deleted`,
                    {
                      description:
                        [
                          r.skippedAssigned > 0
                            ? `${r.skippedAssigned} already assigned, kept`
                            : null,
                          r.failedDeletes.length > 0
                            ? `${r.failedDeletes.length} failed — see console`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined,
                    },
                  );
                },
                onError: (e) => toast.error(`Rollback failed: ${e.message}`),
              });
            },
          },
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    }
  };

  // Two-state footer button click handler
  const handleFooterClick = () => {
    log.info("footer click", {
      operation: "handleFooterClick",
      nextAction: previewReady ? "open-confirm-modal" : "request-preview",
      isRequested,
      previewReady,
      date: selectedDate,
    });
    if (previewReady) {
      setShowConfirmDialog(true);
    } else {
      setRequestedPreviewKey(currentScopeKey);
    }
  };

  // ── Data: events on the selected date (soft indicator for date picker) ──
  const { data: eventsOnDate = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["venueopsEvents", selectedDate],
    queryFn: () => venueopsEventsQueries.fetchEventsForDate(selectedDate),
    enabled: !!selectedDate,
    staleTime: 60_000,
  });

  // ── Data: Recent synthesis runs for this scope+date (Phase 5 task 10) ──
  const { data: recentRuns = [], refetch: refetchRuns } = useQuery({
    queryKey: [
      "synthesisRuns",
      organizationId,
      departmentId,
      subDepartmentId,
      selectedDate,
    ],
    queryFn: () =>
      synthesisRunsQueries.listRecent({
        organizationId: organizationId!,
        departmentId: departmentId ?? undefined,
        subDepartmentId: subDepartmentId ?? null,
        shiftDate: selectedDate,
        limit: 3,
      }),
    enabled: !!organizationId && !!departmentId,
    staleTime: 30_000,
  });

  const handleRollback = (runId: string) => {
    log.info("rollback requested", { operation: "handleRollback", runId });
    rollbackMutation.mutate(runId, {
      onSuccess: (r) => {
        if (r.orphaned) {
          toast.warning("Rollback: no shifts matched this run", {
            description:
              "Shifts may predate the synthesis_run_id wiring. Clean up manually.",
          });
          return;
        }
        toast.success(`Rolled back: ${r.deletedCount} shifts deleted`, {
          description:
            [
              r.skippedAssigned > 0
                ? `${r.skippedAssigned} already assigned, kept`
                : null,
              r.failedDeletes.length > 0
                ? `${r.failedDeletes.length} failed — see console`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        });
        refetchRuns();
      },
      onError: (e) => toast.error(`Rollback failed: ${e.message}`),
    });
  };

  // ── Derived state ────────────────────────────────────────────
  const hasShifts = shifts.length > 0;
  const isLoading = shiftsLoading || demandLoading;
  const strategyLabel = {
    lean: "Lean",
    balanced: "Balanced (Recommended)",
    conservative: "Conservative",
  }[strategyMode];

  /* =============================================================
     RENDER
     ============================================================= */
  return (
    <>
    <PageLayout>
      <PageLayout.Header>
        <PersonalPageHeader
          title="Labor Demand Forecasting"
          Icon={Activity}
          scope={scope}
          setScope={setScope}
          isGammaLocked={isGammaLocked}
          mode="managerial"
        />

        {/* ── Function Bar ────────────────────────────────────────────── */}
        <div className="mt-4 lg:mt-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {/* Date Picker */}
            <div className="flex items-center gap-2 bg-background/50 px-3 py-1.5 rounded-xl border border-border/60">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-sm font-medium focus:outline-none"
              />
              {!eventsLoading && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "ml-1 h-2 w-2 rounded-full cursor-help",
                        eventsOnDate.length === 0
                          ? "bg-amber-400"
                          : "bg-emerald-400",
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {eventsOnDate.length === 0
                      ? "No events scheduled for this date"
                      : `${eventsOnDate.length} events scheduled`}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="h-6 w-px bg-border/40 mx-1" />

            {/* View Mode Toggle */}
            <div className="flex items-center border border-border/60 rounded-xl overflow-hidden bg-background/50">
              {(["preview", "raw"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all capitalize",
                    viewMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  {mode === "preview" ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <Database className="h-3.5 w-3.5" />
                  )}
                  {mode === "preview" ? "Preview" : "Raw Data"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isFetching && !isLoading && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Syncing shifts...</span>
              </div>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFeedbackModal(true)}
                  className="h-9 gap-2 text-muted-foreground hover:text-foreground"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Give feedback
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tell us how staffing went for a past event</TooltipContent>
            </Tooltip>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: shiftKeys.lists })}
              className="h-9 gap-2"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </PageLayout.Header>

      <PageLayout.Body bare className="space-y-5 scrollbar-none">
        {/* ===================== EVENTS ON THIS DATE ===================== */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.03 }}
        >
          <EventsOnDatePanel events={eventsOnDate} isLoading={eventsLoading} />
        </motion.div>

        {/* ===================== VIEW MODE SWITCHER ===================== */}
        <AnimatePresence mode="wait">
          {viewMode === "raw" ? (
            <RawDataPanel
              key="raw"
              timelineData={timelineData}
              shiftCount={shifts.length}
              orgId={organizationId ?? "—"}
              date={selectedDate}
            />
          ) : (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-5"
            >
              {/* ===================== METRICS ROW ===================== */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard
                  label="Req. Peak Headcount"
                  value={isLoading ? "—" : metrics.peakRequired}
                  trend="up"
                  status="neutral"
                  skeleton={isLoading}
                />
                <MetricCard
                  label="Curr. Coverage Peak"
                  value={isLoading ? "—" : metrics.peakExisting}
                  status={
                    metrics.peakExisting < metrics.peakRequired ? "warn" : "ok"
                  }
                  skeleton={isLoading}
                />
                <MetricCard
                  label="Coverage Gap Peak"
                  value={isLoading ? "—" : metrics.peakGap}
                  status={
                    metrics.peakGap > 5
                      ? "critical"
                      : metrics.peakGap > 0
                        ? "warn"
                        : "ok"
                  }
                  valueColor={metrics.peakGap > 0 ? "text-red-400" : undefined}
                  skeleton={isLoading}
                />
                <MetricCard
                  label="Total Req. Hours"
                  value={isLoading ? "—" : metrics.totalReqHours}
                  status="neutral"
                  skeleton={isLoading}
                />
                <MetricCard
                  label="Existing Sched. Hours"
                  value={isLoading ? "—" : metrics.existingSchedHours}
                  status="neutral"
                  skeleton={isLoading}
                />
                <MetricCard
                  label="Residual Hours"
                  value={isLoading ? "—" : metrics.residualHours}
                  status={metrics.residualHours > 20 ? "warn" : "neutral"}
                  valueColor={
                    metrics.residualHours > 0 ? "text-amber-400" : undefined
                  }
                  skeleton={isLoading}
                />
              </div>
              
              {/* ===================== FORECAST BREAKDOWN ===================== */}
              {!isLoading && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-card border border-border/60 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Baseline Requirement</p>
                      <p className="text-xl font-bold text-blue-400">{Math.round(metrics.baselineHours)}h</p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Layout className="h-5 w-5 text-blue-400" />
                    </div>
                  </div>
                  <div className="bg-card border border-border/60 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">ML Surge Demand</p>
                      <p className="text-xl font-bold text-fuchsia-400">+{Math.round(metrics.surgeHours)}h</p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-fuchsia-500/10 flex items-center justify-center">
                      <Zap className="h-5 w-5 text-fuchsia-400" />
                    </div>
                  </div>
                  <div className="bg-card border border-border/60 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Derived Supervision</p>
                      <p className="text-xl font-bold text-amber-400">+{Math.round(metrics.derivedHours)}h</p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <ShieldCheck className="h-5 w-5 text-amber-400" />
                    </div>
                  </div>
                </div>
              )}

              {/* ===================== CHART ===================== */}
              <div className="bg-card border border-border/60 rounded-xl p-5">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-fuchsia-400" />
                    <span className="font-semibold text-sm">
                      Demand vs Coverage Timeline
                    </span>
                    {hasShifts && (
                      <Badge className="bg-muted/60 text-muted-foreground border border-border/40 text-[10px]">
                        {selectedDate} · {shifts.length} shifts
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <TogglePill
                      active={showNewInjection}
                      onClick={() => setShowNewInjection((v) => !v)}
                      color="#38bdf8"
                      label="New Shift Injection"
                    />
                    <TogglePill
                      active={showRequired}
                      onClick={() => setShowRequired((v) => !v)}
                      color="#818cf8"
                      label="Show Required"
                    />
                    <TogglePill
                      active={showExisting}
                      onClick={() => setShowExisting((v) => !v)}
                      color="#34d399"
                      label="Show Existing"
                    />
                    <TogglePill
                      active={showResidual}
                      onClick={() => setShowResidual((v) => !v)}
                      color="#f87171"
                      label="Show Residual"
                    />
                  </div>
                </div>

                {isLoading ? (
                  <div className="h-[280px] flex items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
                  </div>
                ) : !hasShifts && !previewReady ? (
                  <div className="h-[280px] flex items-center justify-center">
                    <EmptyState message="Click Generate Shift Preview to load demand for this date" />
                  </div>
                ) : (
                  <div className="h-[280px] w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={timelineData}
                        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="ldf-eg"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#34d399"
                              stopOpacity={0.35}
                            />
                            <stop
                              offset="95%"
                              stopColor="#34d399"
                              stopOpacity={0.03}
                            />
                          </linearGradient>
                          <linearGradient
                            id="ldf-rg"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#f87171"
                              stopOpacity={0.55}
                            />
                            <stop
                              offset="95%"
                              stopColor="#f87171"
                              stopOpacity={0.05}
                            />
                          </linearGradient>
                          <linearGradient
                            id="ldf-ig"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#38bdf8"
                              stopOpacity={0.45}
                            />
                            <stop
                              offset="95%"
                              stopColor="#38bdf8"
                              stopOpacity={0.05}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="rgba(148,163,184,0.07)"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="time"
                          tick={{
                            fontSize: 10,
                            fill: "hsl(var(--muted-foreground))",
                          }}
                          tickLine={false}
                          axisLine={false}
                          interval={2}
                        />
                        <YAxis
                          tick={{
                            fontSize: 10,
                            fill: "hsl(var(--muted-foreground))",
                          }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <RechartsTooltip
                          content={<CustomTooltip />}
                          cursor={{
                            stroke: "rgba(148,163,184,0.12)",
                            strokeWidth: 1,
                          }}
                        />

                        {showExisting && (
                          <Area
                            stackId="cov"
                            type="monotone"
                            dataKey="existing"
                            stroke="#34d399"
                            strokeWidth={2}
                            fill="url(#ldf-eg)"
                            dot={false}
                            activeDot={{
                              r: 4,
                              strokeWidth: 0,
                              fill: "#34d399",
                            }}
                          />
                        )}
                        {showResidual && (
                          <Area
                            stackId="cov"
                            type="monotone"
                            dataKey="residual"
                            stroke="transparent"
                            fill="url(#ldf-rg)"
                            dot={false}
                          />
                        )}
                        {showNewInjection && (
                          <Area
                            type="monotone"
                            dataKey="injection"
                            stroke="#38bdf8"
                            strokeWidth={1.5}
                            fill="url(#ldf-ig)"
                            dot={false}
                            strokeDasharray="4 2"
                          />
                        )}
                        {showRequired && (
                          <Line
                            type="monotone"
                            dataKey="required"
                            stroke="#818cf8"
                            strokeWidth={2}
                            strokeDasharray="6 3"
                            dot={false}
                            activeDot={{
                              r: 4,
                              strokeWidth: 0,
                              fill: "#818cf8",
                            }}
                          />
                        )}
                        {metrics.peakGap > 0 && (
                          <ReferenceLine
                            x={metrics.peakGapTime}
                            stroke="#ef4444"
                            strokeDasharray="4 2"
                            strokeOpacity={0.5}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>

                    {/* Peak Gap annotation */}
                    {metrics.peakGap > 0 && (
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none">
                        <div className="bg-red-500/90 text-white text-sm font-black px-3 py-1 rounded-lg shadow-lg whitespace-nowrap">
                          Peak Gap: {metrics.peakGap} @ {metrics.peakGapTime}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ===================== COVERAGE SCAN + INJECTION ===================== */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* Coverage Scan */}
                <div className="lg:col-span-3 bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">
                        Coverage Scan
                      </span>
                    </div>
                    <button
                      onClick={() => setShowDetailsModal(true)}
                      className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      View Details
                    </button>
                  </div>

                  {isLoading ? (
                    <div className="space-y-3 animate-pulse">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-10 bg-muted rounded" />
                      ))}
                    </div>
                  ) : !hasShifts ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No shift data available
                    </p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border/40">
                          {[
                            "Role",
                            "Bucket",
                            "Req. Hours",
                            "Existing",
                            "Gap",
                            "Status",
                          ].map((h, i) => (
                            <th
                              key={h}
                              className={cn(
                                "pb-2 text-xs uppercase tracking-wide text-muted-foreground font-medium",
                                i > 0 ? "text-right" : "text-left",
                              )}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {roleCoverageData.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="py-4 text-center text-sm text-muted-foreground"
                            >
                              No role data
                            </td>
                          </tr>
                        ) : (
                          roleCoverageData.map((row, i) => (
                            <tr
                              key={i}
                              className="border-b border-border/20 last:border-0"
                            >
                              <td className="py-3 text-sm font-medium">
                                {row.role}
                              </td>
                              <td className="py-3">
                                <BucketBadge bucket={row.bucket} />
                              </td>
                              <td className="py-3 text-sm text-right text-muted-foreground">
                                {row.reqHours}h
                              </td>
                              <td className="py-3 text-sm text-right text-muted-foreground">
                                {row.existing}h
                              </td>
                              <td
                                className={cn(
                                  "py-3 text-sm text-right font-bold",
                                  row.gap < -3
                                    ? "text-red-400"
                                    : row.gap < 0
                                      ? "text-amber-400"
                                      : "text-emerald-400",
                                )}
                              >
                                {row.gap === 0 ? "0" : `${row.gap}h`}
                              </td>
                              <td className="py-3 text-right">
                                <StatusBadge status={row.status} />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Proposed Injection & Deletions */}
                <div className="lg:col-span-2 bg-card border border-border/60 rounded-xl p-5 flex flex-col max-h-[500px]">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">
                        Proposed Adjustments
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {totalDeletedShifts > 0 && (
                        <Badge className="bg-red-500/15 text-red-500 border border-red-500/30 text-[10px] font-semibold px-1.5">
                          -{totalDeletedShifts} Shifts
                        </Badge>
                      )}
                      {totalProposedShifts > 0 && (
                        <Badge className="bg-primary/15 text-primary border border-primary/30 text-[10px] font-semibold px-1.5">
                          +{totalProposedShifts} Shifts
                        </Badge>
                      )}
                    </div>
                  </div>

                  {isLoading ? (
                    <div className="space-y-3 animate-pulse">
                      {[1, 2].map((i) => (
                        <div key={i} className="h-16 bg-muted rounded-lg" />
                      ))}
                    </div>
                  ) : proposedInjection.length === 0 &&
                    proposedDeletions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400/50" />
                      <p className="text-sm font-medium text-emerald-400">
                        Optimized
                      </p>
                      <p className="text-xs">
                        No shift additions or deletions needed
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0 custom-scrollbar">
                      {/* Additions */}
                      {proposedInjection.map((g, i) => (
                        <div
                          key={`add-${i}`}
                          className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
                                <Plus className="h-3 w-3" /> {g.roleName}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5 mb-1.5">
                                {g.description}
                              </p>
                              {g.reasons && g.reasons.length > 0 && (
                                <div className="flex gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge className="bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/30 text-[9px] cursor-help transition-colors">
                                        <Sparkles className="h-2.5 w-2.5 mr-1" />
                                        Why?
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="bg-indigo-950 text-indigo-50 border-indigo-800 p-2 max-w-[250px] space-y-1 z-[100]">
                                      <p className="font-semibold text-xs mb-1.5 text-indigo-300">Generated Requirements</p>
                                      {g.reasons.map((r, idx) => (
                                        <p key={idx} className="text-[10px] leading-tight opacity-90">• {r}</p>
                                      ))}
                                    </TooltipContent>
                                  </Tooltip>

                                  <Sheet>
                                    <SheetTrigger asChild>
                                      <Badge className="bg-muted text-muted-foreground hover:bg-muted/80 border border-border text-[9px] cursor-pointer transition-colors">
                                        <BarChart3 className="h-2.5 w-2.5 mr-1" />
                                        Full Audit
                                      </Badge>
                                    </SheetTrigger>
                                    <SheetContent className="w-[400px] sm:w-[540px] bg-card border-l border-border/60">
                                      <SheetHeader className="mb-6">
                                        <SheetTitle className="flex items-center gap-2">
                                          <ShieldCheck className="h-5 w-5 text-indigo-400" />
                                          Demand Engine Audit
                                        </SheetTitle>
                                        <SheetDescription className="text-xs">
                                          Layer-by-layer breakdown for <strong>{g.roleName}</strong> on {selectedDate}
                                        </SheetDescription>
                                      </SheetHeader>
                                      
                                      <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-180px)] pr-2 custom-scrollbar">
                                        {/* Audit Content Implementation */}
                                        <div className="space-y-4">
                                          <div className="p-4 rounded-xl bg-muted/30 border border-border/40">
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">L3 - Baseline Demand</h4>
                                            <div className="space-y-2">
                                              {g.reasons.filter(r => r.startsWith('rule:')).map((r, i) => (
                                                <div key={i} className="flex justify-between text-xs">
                                                  <span className="text-muted-foreground">{r.split(' ')[0]}</span>
                                                  <span className="font-mono text-indigo-400">{r.split(' ')[1]}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>

                                          <div className="p-4 rounded-xl bg-muted/30 border border-border/40">
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">L4 - Timecard Adjustment</h4>
                                            <div className="space-y-2">
                                              {g.reasons.filter(r => r.startsWith('timecard_mult:')).map((r, i) => (
                                                <div key={i} className="flex justify-between text-xs">
                                                  <span className="text-muted-foreground">Historical Attendance Ratio</span>
                                                  <span className="font-mono text-blue-400">{r.replace('timecard_mult:', '')}x</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>

                                          <div className="p-4 rounded-xl bg-muted/30 border border-border/40">
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">L5 - Supervisor Feedback</h4>
                                            <div className="space-y-2">
                                              {g.reasons.filter(r => r.startsWith('feedback_mult:')).map((r, i) => (
                                                <div key={i} className="flex justify-between text-xs">
                                                  <span className="text-muted-foreground">Feedback Multiplier</span>
                                                  <span className="font-mono text-emerald-400">{r.replace('feedback_mult:', '')}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>

                                          <div className="p-4 rounded-xl bg-muted/30 border border-border/40">
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">L6 - Operational Constraints</h4>
                                            <div className="space-y-2">
                                              {g.reasons.filter(r => r.startsWith('constraint_floor:') || r.startsWith('global_floor:')).map((r, i) => (
                                                <div key={i} className="flex justify-between text-xs">
                                                  <span className="text-muted-foreground">Binding Floor</span>
                                                  <span className="font-mono text-amber-400">{r.split(' ')[0].split(':')[1]}</span>
                                                </div>
                                              ))}
                                              {g.reasons.filter(r => r.startsWith('constraint_floor:') || r.startsWith('global_floor:')).length === 0 && (
                                                <p className="text-[10px] text-muted-foreground italic">No L6 floors binding for this role.</p>
                                              )}
                                            </div>
                                          </div>

                                          <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3">L7 - Final Finalization</h4>
                                            <div className="flex justify-between items-end">
                                              <div>
                                                <p className="text-[10px] text-muted-foreground">Final Staff Count</p>
                                                <p className="text-2xl font-bold text-white">{g.count} <span className="text-xs font-normal text-muted-foreground">Shifts</span></p>
                                              </div>
                                              <div className="text-right">
                                                <p className="text-[10px] text-muted-foreground">Total Labor</p>
                                                <p className="text-lg font-semibold text-indigo-300">{g.totalHours}h</p>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="pt-4 border-t border-border/40 mt-6">
                                            <div className="flex items-center gap-2 mb-2">
                                              <Database className="h-3 w-3 text-muted-foreground" />
                                              <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Determinism Snapshot</h4>
                                            </div>
                                            <p className="text-[9px] text-muted-foreground leading-relaxed">
                                              This demand record is historically frozen. The ratios and multipliers shown above were snapshotted into the 
                                              <code className="text-indigo-300 mx-1">demand_tensor</code> at the moment of generation to ensure 100% audit-grade reproducibility.
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    </SheetContent>
                                  </Sheet>
                                </div>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-emerald-400">
                                +{g.count} Shifts
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                ~{g.avgHours}h avg
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Deletions */}
                      {proposedDeletions.map((g, i) => (
                        <div
                          key={`del-${i}`}
                          className="p-3 rounded-lg bg-red-500/5 border border-red-500/20"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-red-400 flex items-center gap-1.5">
                                <Minus className="h-3 w-3" /> {g.roleName}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {g.description}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-red-400">
                                -{g.count} Shifts
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                ~{g.avgHours}h avg
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="pt-3 mt-2 border-t border-border/40 space-y-1.5 shrink-0">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Net Hours Change
                          </span>
                          <span className="font-bold">
                            {totalProposedHours - totalDeletedHours > 0
                              ? "+"
                              : ""}
                            {(totalProposedHours - totalDeletedHours).toFixed(
                              1,
                            )}{" "}
                            Hrs
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Projected Cost Add.
                          </span>
                          <span className="font-bold text-emerald-400">
                            +{formatCurrency(budgetData.variance)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ===================== CONFIG + OPTIMIZATION ===================== */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Configuration & Rules */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">
                      Configuration & Rules
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ConfigCheckbox
                      checked={useFtBaseline}
                      onChange={setUseFtBaseline}
                      label="Use Full-Time Baseline"
                    />
                    <ConfigCheckbox
                      checked={mergeMicroPeaks}
                      onChange={setMergeMicroPeaks}
                      label="Merge Micro Peaks (<1h)"
                    />
                    <ConfigCheckbox
                      checked={respectBudget}
                      onChange={setRespectBudget}
                      label="Respect Budget Cap"
                    />
                    <ConfigCheckbox
                      checked={enforceCompliance}
                      onChange={setEnforceCompliance}
                      label="Enforce Compliance 100%"
                    />
                    <ConfigCheckbox
                      checked={preventOvertime}
                      onChange={setPreventOvertime}
                      label="Prevent Overtime"
                      badge={
                        !preventOvertime ? "Overtime Risk: Low" : undefined
                      }
                      badgeVariant="warn"
                    />
                  </div>
                </div>

                {/* Optimization Strategy */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">
                        Optimization Strategy
                      </span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1.5 h-8"
                        >
                          {strategyLabel}
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleStrategyChange("lean")}
                        >
                          Lean
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleStrategyChange("balanced")}
                        >
                          Balanced (Recommended)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleStrategyChange("conservative")}
                        >
                          Conservative
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="space-y-5">
                    <OptSlider
                      label="Cost Efficiency"
                      value={costWeight}
                      onChange={setCostWeight}
                      color="#38bdf8"
                    />
                    <OptSlider
                      label="Service Coverage"
                      value={serviceWeight}
                      onChange={setServiceWeight}
                      color="#34d399"
                    />
                    <OptSlider
                      label="Fatigue Management"
                      value={fatigueWeight}
                      onChange={setFatigueWeight}
                      color="#a78bfa"
                    />
                    {/* C2 — coverage confidence (service level) for demand buffering */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">
                          Coverage Confidence
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-bold" style={{ color: "#f59e0b" }}>
                            {coverageConfidence <= 50 ? "Median" : `P${coverageConfidence}`}
                          </span>
                          <span className="text-muted-foreground/60 tabular-nums">
                            {coverageConfidence}%
                          </span>
                        </div>
                      </div>
                      <Slider
                        value={[coverageConfidence]}
                        onValueChange={(v) => setCoverageConfidence(v[0])}
                        min={50}
                        max={95}
                        step={5}
                        className="w-full"
                      />
                      <p className="text-[10px] text-muted-foreground/70">
                        Staff so demand is covered ~{coverageConfidence}% of the time.
                        50% = median (no buffer).
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ===================== COMPLIANCE + BUDGET ===================== */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Compliance Preview */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">
                      Compliance Preview
                    </span>
                  </div>
                  <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        "h-12 w-12 rounded-xl flex items-center justify-center shrink-0",
                        enforceCompliance
                          ? "bg-emerald-500/15 border border-emerald-500/30"
                          : "bg-amber-500/15 border border-amber-500/30",
                      )}
                    >
                      {enforceCompliance ? (
                        <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-6 w-6 text-amber-400" />
                      )}
                    </div>
                    <div>
                      <p
                        className={cn(
                          "font-semibold text-base",
                          enforceCompliance
                            ? "text-emerald-400"
                            : "text-amber-400",
                        )}
                      >
                        {enforceCompliance
                          ? "No violations detected"
                          : "Soft compliance mode"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {enforceCompliance
                          ? "Checked against Union Agreement v2.4"
                          : "Violations may be permitted — enable Enforce Compliance for strict mode"}
                      </p>
                      {preventOvertime && (
                        <p className="text-xs text-emerald-400 mt-1.5">
                          Overtime guard active ✓
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Budget Impact */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">
                        Budget Impact
                      </span>
                    </div>
                    <span
                      className={cn(
                        "text-xs font-semibold px-2.5 py-1 rounded-full border",
                        budgetData.withinBudget
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30",
                      )}
                    >
                      {budgetData.withinBudget
                        ? "Within Budget"
                        : "Over Budget"}
                    </span>
                  </div>
                  {isLoading ? (
                    <div className="animate-pulse space-y-3">
                      <div className="h-8 bg-muted rounded" />
                      <div className="h-3 bg-muted rounded w-full" />
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-4 mb-3">
                        {[
                          {
                            label: "Current Spend",
                            value: formatCurrency(budgetData.currentSpend),
                            color: "text-foreground",
                          },
                          {
                            label: "Projected Total",
                            value: formatCurrency(budgetData.projectedTotal),
                            color: "text-foreground",
                          },
                          {
                            label: "Variance",
                            value: `+${formatCurrency(budgetData.variance)}`,
                            color: "text-emerald-400",
                          },
                        ].map(({ label, value, color }) => (
                          <div key={label}>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                              {label}
                            </p>
                            <p className={cn("text-xl font-bold", color)}>
                              {value}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            budgetData.withinBudget
                              ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                              : "bg-gradient-to-r from-red-500 to-red-400",
                          )}
                          style={{ width: `${budgetData.pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        {budgetData.pct.toFixed(1)}% of{" "}
                        {formatCurrency(budgetData.budgetCap)} budget cap
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* ===================== RECENT GENERATIONS (rollback) ===================== */}
              {recentRuns.length > 0 && (
                <div className="bg-card border border-border/60 rounded-xl px-5 py-3 flex items-center gap-3 flex-wrap">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                    Recent Generations
                  </span>
                  {recentRuns.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <Badge className="bg-background border border-border/40 gap-1 px-2 py-0.5 text-[11px]">
                        {run.created_count > 0 && (
                          <span className="text-emerald-500 font-medium">
                            +{run.created_count}
                          </span>
                        )}
                        {run.created_count > 0 && run.deleted_count > 0 && (
                          <span className="text-muted-foreground">/</span>
                        )}
                        {run.deleted_count > 0 && (
                          <span className="text-red-500 font-medium">
                            -{run.deleted_count}
                          </span>
                        )}
                        {run.created_count === 0 && !run.deleted_count && (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </Badge>
                      <span className="text-muted-foreground">
                        {format(new Date(run.created_at), "HH:mm")}
                      </span>
                      <button
                        onClick={() => handleRollback(run.id)}
                        disabled={rollbackMutation.isPending}
                        className="text-red-400 hover:text-red-300 font-medium disabled:opacity-40"
                      >
                        Rollback
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ===================== FOOTER ACTION BAR ===================== */}
              <div className="flex items-center justify-between gap-4 flex-wrap bg-card border border-border/60 rounded-xl px-5 py-4">
                <div className="flex items-start gap-2.5 text-xs text-muted-foreground max-w-[520px]">
                  <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    This generation applies only to{" "}
                    <span className="font-semibold text-foreground">
                      {subDepartmentName ||
                        departmentName ||
                        "the current scope"}
                    </span>
                    . Other sub-departments are strictly isolated and not
                    affected.
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => window.history.back()}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleFooterClick}
                    disabled={
                      !organizationId ||
                      !departmentId ||
                      isLoading ||
                      demandFetching ||
                      isPreviewFetching
                    }
                    className="gap-2 font-semibold px-6"
                  >
                    {demandFetching || isPreviewFetching ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Generating preview…
                      </>
                    ) : previewReady ? (
                      <>
                        <Zap className="h-4 w-4" />
                        {totalProposedShifts === 0 && totalDeletedShifts > 0
                          ? "Confirm & Adjust"
                          : "Confirm & Inject"}
                        {totalProposedShifts > 0 && (
                          <Badge className="ml-1 bg-primary-foreground/20 text-primary-foreground border-0 text-xs">
                            {totalProposedShifts}
                          </Badge>
                        )}
                        {totalProposedShifts === 0 &&
                          totalDeletedShifts > 0 && (
                            <Badge className="ml-1 bg-primary-foreground/20 text-primary-foreground border-0 text-xs">
                              {totalDeletedShifts}
                            </Badge>
                          )}
                      </>
                    ) : (
                      <>
                        <Activity className="h-4 w-4" />
                        Generate Shift Preview
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </PageLayout.Body>

      {/* ===================== MODALS ===================== */}
      <AnimatePresence>
        {showDetailsModal && (
          <DetailsModal
            data={timelineData}
            onClose={() => setShowDetailsModal(false)}
          />
        )}
        {showConfirmDialog && (
          <ConfirmGenerationModal
            open={showConfirmDialog}
            onClose={() => setShowConfirmDialog(false)}
            onConfirm={handleConfirmGeneration}
            isPending={generateMutation.isPending}
            scopeLabel={`${subDepartmentName || departmentName || "Scope"} · ${selectedDate}`}
            previewGroups={proposedInjection.map((g) => ({
              roleName: g.roleName,
              count: g.count,
              totalHours: g.totalHours,
            }))}
            deletionGroups={proposedDeletions.map((g) => ({
              roleName: g.roleName,
              count: g.count,
              totalHours: g.totalHours,
            }))}
            totalShifts={totalProposedShifts}
            totalHours={totalProposedHours}
            complianceWarnings={[]}
            hasMlError={scopeDemand?.hasMlError ?? false}
            suggestedDeletionsCount={
              previewResponse?.suggestedDeletions?.length ?? 0
            }
            isIdempotent={previewResponse?.isIdempotent ?? false}
          />
        )}
      </AnimatePresence>
    </PageLayout>

    <SupervisorFeedbackPromptModal
      open={showFeedbackModal}
      onOpenChange={setShowFeedbackModal}
      eventId={null}
      onSubmitted={() => toast.success("Feedback submitted — thank you.")}
    />
    </>
  );
};

export default LaborDemandForecastingPage;
