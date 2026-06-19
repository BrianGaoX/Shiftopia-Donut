import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) throw new Error('[FATAL] Missing SUPABASE_URL');
if (!supabaseServiceKey) throw new Error('[FATAL] Missing SUPABASE_SERVICE_ROLE_KEY');

interface ShiftRow {
  id: string;
  lifecycle_status: string;
  assignment_status: string;
  assignment_outcome: string | null;
  bidding_status: string;
  start_at: string | null;
  shift_date: string | null;
  start_time: string | null;
  final_call_sent_at: string | null;
}

/**
 * Resolve a shift's real start time.
 * Priority: start_at (ISO) → shift_date + start_time (local, assumed Sydney/UTC+11).
 * Returns null if neither field is usable.
 */
function resolveStartTime(s: Pick<ShiftRow, 'start_at'>): Date | null {
  if (s.start_at) {
    const d = new Date(s.start_at);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    const logs: string[] = [];

    // Fetch all columns needed to calculate TTS from either source.
    const { data: shifts, error: fetchError } = await supabase
      .from('shifts')
      .select('id, lifecycle_status, assignment_status, assignment_outcome, bidding_status, start_at, shift_date, start_time, final_call_sent_at')
      .eq('lifecycle_status', 'Published')
      .neq('is_cancelled', true);

    if (fetchError) throw fetchError;

    const allShifts: ShiftRow[] = (shifts ?? []) as ShiftRow[];

    // Pre-compute TTS (ms) for every shift once — reused across all passes.
    const ttsMap = new Map<string, number>();
    for (const s of allShifts) {
      const start = resolveStartTime(s);
      ttsMap.set(s.id, start ? start.getTime() - now.getTime() : Infinity);
    }

    const FOUR_H_MS = 4 * 60 * 60 * 1000;
    const FIVE_H_MS = 5 * 60 * 60 * 1000;

    // ── Pass 0: Final Call (TTS in (4h, 5h]) ────────────────────────────────────
    const finalCallIds = allShifts
      .filter(s => {
        const tts = ttsMap.get(s.id)!;
        return s.final_call_sent_at === null && tts > FOUR_H_MS && tts <= FIVE_H_MS;
      })
      .map(s => s.id);

    if (finalCallIds.length > 0) {
      const { error } = await supabase
        .from('shifts')
        .update({ final_call_sent_at: now.toISOString() })
        .in('id', finalCallIds);
      if (error) {
        logs.push(`[WARN] Final call update error: ${error.message}`);
      } else {
        logs.push(`[INFO] Sent final call for ${finalCallIds.length} shift(s) (5h mark)`);
      }
    }

    // ── Pass 2: Offer expiry (S3 → S2) at TTS ≤ 4h ─────────────────────────────
    // Reverts to Draft-Assigned (S2), preserving the employee so the manager can
    // use direct assignment (publish → S4) without losing who was offered the shift.
    const offerExpiredIds = allShifts
      .filter(s => {
        const tts = ttsMap.get(s.id)!;
        return (
          s.assignment_status === 'assigned' &&
          s.assignment_outcome == null &&
          tts <= FOUR_H_MS
        );
      })
      .map(s => s.id);

    if (offerExpiredIds.length > 0) {
      const { data: offersExpired, error } = await supabase
        .from('shifts')
        .update({
          lifecycle_status:   'Draft',
          // is_draft / is_published / is_on_bidding are generated columns — omitted.
          assignment_outcome: null,
          // assignment_status stays 'assigned' — employee ID preserved (S2, not S1)
          bidding_status:     'not_on_bidding',
          updated_at:         now.toISOString(),
        })
        .in('id', offerExpiredIds)
        .select('id');
      if (error) {
        logs.push(`[WARN] Offer expiry error: ${error.message}`);
      } else {
        const count = offersExpired?.length ?? 0;
        if (count > 0) logs.push(`[INFO] Expired ${count} offer(s) → Draft+Assigned (S3 → S2)`);
      }
    }

    // ── Pass 3: Bidding expiry (S5 → S1) at TTS ≤ 4h ───────────────────────────
    // Targets: Published + unassigned + active bidding status.
    // Invalidates all pending bids after resetting shift to Draft.
    const ACTIVE_BIDDING = ['on_bidding', 'on_bidding_normal', 'on_bidding_urgent'];
    const biddingExpiredIds = allShifts
      .filter(s => {
        const tts = ttsMap.get(s.id)!;
        return (
          s.assignment_status === 'unassigned' &&
          ACTIVE_BIDDING.includes(s.bidding_status) &&
          tts <= FOUR_H_MS
        );
      })
      .map(s => s.id);

    if (biddingExpiredIds.length > 0) {
      const { data: biddingExpired, error } = await supabase
        .from('shifts')
        .update({
          lifecycle_status:  'Draft',
          // is_draft / is_published are generated columns — omitted.
          is_on_bidding:     false,
          bidding_status:    'not_on_bidding',
          assignment_status: 'unassigned',
          updated_at:        now.toISOString(),
        })
        .in('id', biddingExpiredIds)
        .select('id');

      if (error) {
        logs.push(`[WARN] Bidding expiry error: ${error.message}`);
      } else {
        const count = biddingExpired?.length ?? 0;
        if (count > 0) {
          logs.push(`[INFO] Expired ${count} bidding shift(s) → Draft (S5 → S1)`);

          // Invalidate all pending bids for expired shifts
          const { error: bidsError } = await supabase
            .from('shift_bids')
            .update({ status: 'rejected', updated_at: now.toISOString() })
            .in('shift_id', biddingExpiredIds)
            .eq('status', 'pending');

          if (bidsError) {
            logs.push(`[WARN] Bid invalidation error: ${bidsError.message}`);
          } else {
            logs.push(`[INFO] Invalidated pending bids for ${count} expired shift(s)`);
          }
        }
      }
    }

    // ── Pass 4: Swap expiry at TTS ≤ 4h ────────────────────────────────────────
    const { data: expiredSwaps, error: swapExpireError } = await supabase
      .rpc('expire_locked_swaps') as any;

    if (swapExpireError) {
      logs.push(`[WARN] Swap expiry error: ${swapExpireError.message}`);
    } else {
      const count = (expiredSwaps as any[])?.length ?? 0;
      if (count > 0) logs.push(`[INFO] Expired ${count} swap request(s) → EXPIRED (TTS ≤ 4h)`);
    }

    const summary = {
      success: true,
      timestamp: now.toISOString(),
      finalCalls: finalCallIds.length,
      expiredOffers: offerExpiredIds.length,
      expiredBidding: biddingExpiredIds.length,
      expiredSwaps: (expiredSwaps as any[])?.length ?? 0,
      logs,
    };

    console.log(JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('shift-state-processor error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
