import { supabase } from '@/platform/supabase/client';
import { Shift } from '@/modules/rosters';
import { Bid, BidStatus } from '../model/bid.types';
import { computeBiddingUrgency } from '@/modules/rosters/domain/bidding-urgency';

// --- Helper Functions ---
const mapDbStatusToBidStatus = (dbStatus: string): BidStatus => {
    const map: Record<string, BidStatus> = {
        'pending': 'pending',
        'accepted': 'selected', // UI 'selected' matches DB 'accepted'
        'rejected': 'rejected',
        'withdrawn': 'withdrawn'
    };
    return map[dbStatus] || 'pending';
};

const mapBidStatusToDbStatus = (status: BidStatus): string => {
    const map: Record<BidStatus, string> = {
        'pending': 'pending',
        'selected': 'accepted',
        'accepted': 'accepted',
        'rejected': 'rejected',
        'withdrawn': 'withdrawn'
    };
    return map[status] || 'pending';
};

export const biddingApi = {
    /**
     * Fetch all bids (MANAGER VIEW dashboard)
     */
    async getAllBids(): Promise<Bid[]> {
        const { data, error } = await supabase
            .from('shift_bids')
            .select(`
                *,
                shift:shifts(*),
                employee:profiles!shift_bids_employee_id_fkey(id, first_name, last_name, email)
            `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching all bids:', error);
            throw error;
        }

        return (data || []).map((row: any) => ({
            ...row,
            employee_name: row.employee ? `${row.employee.first_name} ${row.employee.last_name}` : 'Unknown'
        })) as Bid[];
    },

    /**
     * Fetch all shifts that are currently open for bidding (EMPLOYEE VIEW)
     * Enforces Access Control: Org -> Dept -> SubDept
     */
    async getOpenBidShifts(filters?: {
        organizationId?: string;
        departmentId?: string | string[];
        subDepartmentId?: string | string[];
    }): Promise<Shift[]> {
        const toIdList = (v: string | string[] | undefined): string[] => {
            if (!v) return [];
            return Array.isArray(v) ? v.filter(Boolean) : [v];
        };
        const subDeptIds = toIdList(filters?.subDepartmentId);
        const deptIds = toIdList(filters?.departmentId);

        // Refuse unscoped queries: callers must supply at least one dept or sub-dept
        // bound. An empty-array filter previously fell through to "no scope filter",
        // returning every open bid shift in the org — a scope leak.
        if (subDeptIds.length === 0 && deptIds.length === 0) {
            return [];
        }

        let query = (supabase as any)
            .from('shifts')
            .select(`
                *,
                dropped_by_id,
                last_dropped_by,
                organizations(id, name),
                departments(id, name),
                sub_departments(id, name),
                roles(id, name),
                remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max)
            `)
            .in('bidding_status', ['on_bidding_normal', 'on_bidding_urgent', 'on_bidding'])
            .is('assigned_employee_id', null)
            .is('deleted_at', null);

        if (filters?.organizationId) {
            query = query.eq('organization_id', filters.organizationId);
        }

        if (subDeptIds.length > 0) {
            query = query.in('sub_department_id', subDeptIds);
        } else {
            query = query.in('department_id', deptIds);
        }

        const response = await query;
        const queryData = (response as any).data;
        const queryError = (response as any).error;

        if (queryError) {
            console.error('Error fetching open bid shifts:', queryError);
            throw queryError;
        }

        return (queryData || []).map((row: any) => ({
            ...row,
            is_urgent: computeBiddingUrgency(row.shift_date, row.start_time) === 'urgent'
        })) as unknown as Shift[];
    },

    /**
     * Fetch bids submitted by the current user (EMPLOYEE VIEW)
     */
    async getMyBids(userId: string): Promise<Bid[]> {
        const { data, error } = await supabase
            .from('shift_bids')
            .select(`
                *,
                shift:shifts(
                    *,
                    organizations(name),
                    departments(name),
                    sub_departments(name),
                    roles(name),
                    remuneration_levels(level_name)
                )
            `)
            .eq('employee_id', userId)
            .neq('status', 'withdrawn')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching my bids:', error);
            throw error;
        }

        // Return all non-withdrawn bids, including past accepted bids.
        // History rendering depends on seeing the winning bid from a round where
        // the employee was selected and later dropped the shift. Filtering it out
        // caused the history to show DNB instead of Accepted for that round.
        // The participation status is now derived from last_dropped_by + current
        // iteration, so stale accepted bids don't pollute the active state.
        return data as unknown as Bid[];
    },

    /**
     * Fetch all bids for a specific shift (MANAGER VIEW)
     */
    async getBidsForShift(shiftId: string): Promise<Bid[]> {
        const { data, error } = await supabase
            .from('shift_bids')
            .select(`
                *,
                employee:profiles!shift_bids_employee_id_fkey(id, first_name, last_name, email)
            `)
            .eq('shift_id', shiftId);

        if (error) {
            console.error(`Error fetching bids for shift ${shiftId}:`, error);
            throw error;
        }

        return (data || []).map((row: any) => ({
            ...row,
            employee_name: row.employee ? `${row.employee.first_name} ${row.employee.last_name}` : 'Unknown'
        })) as Bid[];
    },

    /**
     * Place a bid on a shift (EMPLOYEE ACTION)
     */
    async placeBid(shiftId: string, userId: string, notes?: string): Promise<Bid> {
        // Check for decliner exclusion: if this employee dropped or rejected the offer,
        // they are barred from re-bidding on this specific shift.
        const { data: shiftExclusion, error: shiftError } = await supabase
            .from('shifts')
            .select('last_dropped_by, last_rejected_by')
            .eq('id', shiftId)
            .single();

        if (shiftError) {
            console.error('[bidding] Error checking exclusion:', shiftError);
        }

        if (shiftExclusion) {
            const ex = shiftExclusion as any;
            if (ex.last_dropped_by === userId || ex.last_rejected_by === userId) {
                throw new Error(
                    'You dropped or rejected this shift. Re-bidding is not permitted.'
                );
            }
        }

        const { data, error } = await supabase
            .from('shift_bids')
            .upsert({
                shift_id: shiftId,
                employee_id: userId,
                status: 'pending',
                notes: notes,
                created_at: new Date().toISOString()
            } as any, { onConflict: 'shift_id, employee_id' })
            .select()
            .single();

        if (error) {
            console.error('Error placing bid:', error);
            throw error;
        }

        return data as Bid;
    },

    /**
     * Withdraw a bid (EMPLOYEE ACTION)
     */
    async withdrawBid(bidId: string): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { error } = await supabase.rpc('withdraw_bid_rpc' as any, {
            p_bid_id: bidId,
            p_employee_id: user.id
        });

        if (error) throw error;
    },

    /**
     * Update bid status (MANAGER ACTION)
     * When status = 'selected'/'accepted': assigns the winning employee to the shift (S5/S6 → S4)
     * and logs A21 (manager selects) + A22 (system finalizes).
     *
     * Final commit rule: bid acceptance is blocked if TTS ≤ 4h (bidding window closed).
     * Manager must use emergency assignment instead.
     */
    async updateBidStatus(id: string, status: BidStatus): Promise<Bid> {
        const dbStatus = mapBidStatusToDbStatus(status);

        // ── TTS guard: fetch shift before accepting ───────────────────────────
        if (status === 'selected' || status === 'accepted') {
            const { data: bidRow } = await (supabase as any)
                .from('shift_bids')
                .select('shift_id, shift:shifts(shift_date, start_time, start_at)')
                .eq('id', id)
                .single();

            if (bidRow?.shift) {
                const s = bidRow.shift as any;
                const tts = s.start_at
                    ? new Date(s.start_at).getTime() - Date.now()
                    : new Date(`${s.shift_date}T${s.start_time}`).getTime() - Date.now();

                if (tts <= 4 * 60 * 60 * 1000) {
                    throw new Error(
                        'Bidding window closed: shift starts in less than 4 hours. ' +
                        'Use emergency assignment instead.'
                    );
                }
            }
        }

        const { data, error } = await supabase
            .from('shift_bids')
            .update({ status: dbStatus } as any)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error(`Error updating bid status for ${id}:`, error);
            throw error;
        }

        if (status === 'selected' || status === 'accepted') {
            const shiftId = (data as any).shift_id;
            const employeeId = (data as any).employee_id;

            // Delegate entirely to sm_select_bid_winner RPC — it handles:
            //   - FOR UPDATE locking to prevent race conditions (RC5)
            //   - bid status updates (accept winner, reject others)
            //   - shift FSM transition (S5 → S4) with correct field values
            //   - emergency_source write-once logic
            //   - operational log entry
            const { data: rpcResult, error: rpcError } = await (supabase as any)
                .rpc('sm_select_bid_winner', {
                    p_shift_id:  shiftId,
                    p_winner_id: employeeId,
                });

            if (rpcError) {
                console.error('[bidding] sm_select_bid_winner failed:', rpcError);
                throw rpcError;
            }
            if (rpcResult && rpcResult.success === false) {
                throw new Error(rpcResult.error ?? 'sm_select_bid_winner returned failure');
            }
        }

        return data as Bid;
    },

    /**
     * Bulk update bid status (MANAGER ACTION)
     */
    async updateBulkBidStatus(ids: string[], status: BidStatus): Promise<void> {
        const dbStatus = mapBidStatusToDbStatus(status);
        const { error } = await supabase
            .from('shift_bids')
            .update({ status: dbStatus } as any)
            .in('id', ids);

        if (error) throw error;
    }
};
