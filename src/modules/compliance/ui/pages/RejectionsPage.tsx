/**
 * Compliance Rejections — Admin Audit Page
 *
 * Reads `public.compliance_rejections` (populated by the orchestrator on
 * every BLOCKING result) and gives managers a filterable view of why
 * compliance has blocked actions in the last 24h / 7d / 30d.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { Card } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { format, parseISO } from 'date-fns';

type Window = '24h' | '7d' | '30d';

interface Rejection {
  id: string;
  created_at: string;
  user_id: string | null;
  employee_id: string;
  operation_type: string;
  mode: string;
  stage: string | null;
  rule_id: string;
  rule_status: string;
  summary: string;
  details: string | null;
  affected_shifts: string[];
  calculation: Record<string, unknown> | null;
  bypassed: boolean;
}

function windowToDate(w: Window): Date {
  const now = Date.now();
  switch (w) {
    case '24h': return new Date(now - 24 * 60 * 60 * 1000);
    case '7d':  return new Date(now - 7  * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }
}

export default function RejectionsPage() {
  const [window, setWindow] = useState<Window>('7d');
  const [opTypeFilter, setOpTypeFilter] = useState<string>('all');
  const [bypassedOnly, setBypassedOnly] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['compliance-rejections', window, opTypeFilter, bypassedOnly],
    queryFn: async (): Promise<Rejection[]> => {
      let q = (supabase as any)
        .from('compliance_rejections')
        .select('*')
        .gte('created_at', windowToDate(window).toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (opTypeFilter !== 'all') q = q.eq('operation_type', opTypeFilter);
      if (bypassedOnly) q = q.eq('bypassed', true);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Rejection[];
    },
    staleTime: 30 * 1000,
  });

  const ruleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data ?? []) m.set(r.rule_id, (m.get(r.rule_id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [data]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Compliance Rejections</h1>
          <p className="text-sm text-muted-foreground">
            Every BLOCKING result emitted by the V8 engine in the selected window.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={window} onValueChange={(v) => setWindow(v as Window)}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </SelectContent>
        </Select>

        <Select value={opTypeFilter} onValueChange={setOpTypeFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All operations</SelectItem>
            <SelectItem value="ASSIGN">Assign</SelectItem>
            <SelectItem value="BID">Bid</SelectItem>
            <SelectItem value="SWAP">Swap</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={bypassedOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setBypassedOnly(b => !b)}
        >
          {bypassedOnly ? 'Showing bypassed only' : 'Show bypassed only'}
        </Button>
      </div>

      {/* Top rules */}
      {ruleCounts.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">
            Top rules in this window
          </div>
          <div className="flex flex-wrap gap-2">
            {ruleCounts.map(([rule, count]) => (
              <Badge key={rule} variant="secondary">
                {rule} · {count}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-6 text-sm text-rose-500">
            Failed to load rejections. The compliance_rejections table may not yet be migrated.
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No compliance rejections recorded in this window.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Employee</th>
                <th className="px-4 py-2 text-left">Rule</th>
                <th className="px-4 py-2 text-left">Op</th>
                <th className="px-4 py-2 text-left">Stage</th>
                <th className="px-4 py-2 text-left">Summary</th>
                <th className="px-4 py-2 text-left">Bypassed</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map(r => (
                <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {format(parseISO(r.created_at), 'dd MMM HH:mm')}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.employee_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">{r.rule_id}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">{r.operation_type}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.stage ?? '—'}</td>
                  <td className="px-4 py-2 max-w-[420px] truncate" title={r.summary}>
                    {r.summary}
                  </td>
                  <td className="px-4 py-2">
                    {r.bypassed ? (
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                        bypassed
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
