# 01 — Auto-Assign Bids: Target-State Implementation Plan

**Status:** Target-state design. Binds against [00-contracts-and-conventions.md](00-contracts-and-conventions.md) (decisions D1–D5, §4 names, §5 idempotency, §6 enums, §7 routes, §8 conventions) and the [audit](../audits/auto-assign-bids-audit-and-auto-approve-swaps-design.md) (§3 issues, §4 failure table, §5 state machine, §12 roadmap). The audit is assumed correct; this document designs and implements the fixes, it does not re-audit.

**Owned objects (contracts §4):** tables `assignment_runs`, `assignment_decisions`, `assignment_events`; RPCs `sm_assignment_run_start`, `sm_assignment_run_finish`, `sm_assignment_run_rollback`; Edge Function `auto-assign-bids`; deprecate `sm_select_bid_winner`. The runnable DDL/PL-pgSQL lives in [0001_assignment_audit_and_engine.sql](migrations-draft/0001_assignment_audit_and_engine.sql) (file B).

### Binding-doc corrections (fix here first, per the preamble of 00)

Grounded in the **current** authoritative gateway, [20260623000100_shift_unassign_op.sql:390](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L390) (supersedes [20260621100200](../../supabase/migrations/20260621100200_sm_apply_shift_op.sql)):

1. **Gateway signature.** The real signature is `sm_apply_shift_op(p_shift_id uuid, p_expected_version integer, p_op text, p_payload jsonb DEFAULT '{}', p_idempotency_key uuid DEFAULT NULL)`. There is **no `p_actor` parameter** — the actor is `auth.uid()` inside the function. Contracts §2's `…, p_actor uuid)` is wrong; everywhere below the engine passes the actor by authenticating as a real manager JWT (or relies on the service-role NULL-caller path), **not** as an argument.
2. **Idempotency token type.** The gateway's idempotency key is a **`uuid`** matched against `shift_events.metadata->>'idem'` ([…unassign_op.sql:438](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L438)). Contracts §5's per-decision key `run_id || ':' || shift_id` is a **string** and cannot be passed as the gateway's `p_idempotency_key uuid`. **Resolution:** the engine derives a deterministic UUIDv5 `idem_uuid = extensions.uuid_generate_v5(ns, run_id||':'||shift_id)` and passes *that* to the gateway, while `assignment_decisions.idempotency_key text` stores the human-readable `run_id||':'||shift_id` form. Both are recorded; they are 1:1. (uuid-ossp is installed in the **`extensions`** schema, not `public` — the SQL qualifies it explicitly. The transitional `sm_select_bid_winner` has no run context, so it keys its gateway idem on `shift_id||':'||version||':'||winner_id` instead — still deterministic, still a no-op on replay.)
3. **`get_shift_fsm_state` is 6-arg** `(lifecycle, assignment_status, assignment_outcome, trading_status, is_cancelled, bidding_status)` — contracts §2 omits the 6th arg. An open-for-bidding shift is **S5** (`on_bidding`) or **S6** (`on_bidding_urgent`); `select_winner` is legal at **S5/S6 only** ([fsm_op_is_legal](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L16)).

---

## 0. Priority index (contracts §8: P0 = safety blocker · P1 = SSoT/audit/scale · P2 = optimization)

| Item | Section | Priority |
|---|---|---|
| (1) FSM state validation | §3.1 | **P0** |
| (2) TTS/4h lock enforcement | §3.2 | **P0** |
| (3) Winner-bid validation (no withdrawn revival) | §3.3 | **P0** |
| (4) Qualification validation | §3.4 | **P0** |
| (5) Role validation | §3.5 | **P0** |
| (6) Shift ownership / org-scope validation | §3.6 | **P0** |
| (7) Concurrency protection (version-CAS) | §3.7 | **P0** |
| (8) Idempotency | §3.8 | **P1** |
| (9) Audit logging | §3.9 | **P1** |
| (10) Notification generation | §3.10 | **P1** |
| Single source of truth (D2 merge) | §1 | **P1** |
| Server-side engine (Edge Function) | §2 | **P1** |
| Fairness engine | §4 | **P2** |
| Run cursor / resumability / queue fan-out | §2, §5 | **P2** |
| Rollback of a run | §9 | **P1** |

P0 items also have a **transitional defense** (the hardened `sm_select_bid_winner` in file B), so they protect production the instant the migration lands — *before* the Edge Function or UI rewrite ships. That is the audit's "Phase 0 — stop the bleeding".

---

## 1. Single Source of Truth (decision D2)

### 1.1 The decision

**D2 (restated): MERGE the two engines, run the merged engine server-side, and commit every winner through `sm_apply_shift_op('select_winner', …)`.** Concretely:

- The **decision model** of [`runBidSelection()`](../../src/modules/compliance/v8/orchestrator/bidding/index.ts#L147) (global greedy + composite scoring + fairness + `finalValidate` safety pass) is the brain.
- The **real data wiring** of [`handleAutoAssign()`](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L794) (live rosters, fairness ledger F3, visa flag) is the I/O.
- They are fused into a single **Supabase Edge Function `auto-assign-bids`** (Deno, service role) that hosts `runBidSelection` unchanged and commits each selected winner via the gateway with version-CAS. The thin `sm_select_bid_winner` RPC leaves the write path (D1).

### 1.2 Why not "keep `runBidSelection` only"

`runBidSelection` is **pure and unwired** — `grep` finds zero call sites outside its own re-export (audit §13). It has no data source (no rosters, no fairness ledger, no visa flag), and critically **no commit path**: its only "executor" is the in-memory simulated [`executeBatch`](../../src/modules/compliance/v8/orchestrator/index.ts#L43), which never touches the database. Shipping it as-is would compute a perfect plan and then drop it on the floor. It also inherits the audit's R4 gap unless its inputs are fixed: the bidding input it consumes only enforces quals if the caller populates `V8OrchestratorShift.required_qualifications` / `role_id`, which today's call sites zero out.

### 1.3 Why not "keep `handleAutoAssign` only"

`handleAutoAssign` is the production path and is structurally unsafe (audit §3.3–§3.4, §4 rows 1–6, 10, 14, 18, 31):

- **No SSoT** — it calls `sm_select_bid_winner` directly, which has no FOUND/FSM/winner/TTS guard ([baseline:12942](../../supabase/migrations/20251015000000_baseline_schema.sql#L12942)), bypassing the gateway's CAS + FSM legality entirely (violates D1).
- **TOCTOU + N×M client round-trips** — read→evaluate→write per bidder with no lock; 800×12 ≈ thousands of serialized browser calls (audit §3.7 S1).
- **Greedy per-shift, first-clear-wins** — no global optimality, no scoring, no per-run win cap, no `finalValidate` whole-schedule pass (audit B1–B4, §4 rows 9, 21, 29, 30).
- **Hardcoded `required_qualifications: []`** at [index.tsx:937,952](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L937) and empty `role_id` for existing shifts — silently disables the qual/role dimension (audit B5, F5, §4 row 6).
- **RLS-blind** — the client only sees shifts RLS exposes, so compliance underestimates a bidder's true load (audit §4 row 31).

Merging gets the global optimizer's guarantees **and** real server-side data under one transactional commit chokepoint.

### 1.4 What code is DELETED, and what it becomes

**Deleted** from [OpenBidsView/index.tsx](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx):

- The entire `handleAutoAssign` decision loop, [index.tsx:794–990](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L794) — the per-shift loop, the per-bidder `runHardValidation` / `runV8Orchestrator` calls, the visa-flag cache, the inline F3 reorder, and the per-shift `sm_select_bid_winner` RPC. ~196 lines of client compliance logic go away.

**Becomes** a thin POST that hands scope to the server and renders the run result:

```ts
// OpenBidsView/index.tsx — handleAutoAssign shrinks from ~196 lines to ~25
const handleAutoAssign = useCallback(async () => {
  if (isAutoAssigning) return;
  setIsAutoAssigning(true);
  try {
    const { data, error } = await supabase.functions.invoke('auto-assign-bids', {
      body: {
        scope: {
          organization_id: organizationId,
          department_id:   departmentId ?? null,
          sub_department_id: subDepartmentId ?? null,
          start_date: startDate ? format(startDate, 'yyyy-MM-dd') : null,
          end_date:   endDate   ? format(endDate,   'yyyy-MM-dd') : null,
        },
        dry_run: false,
        options: { accept_warnings: false, max_wins_per_employee: 3 },
      },
    });
    if (error) throw error;
    // data = { run_id, status, summary: { assigned, skipped, blocked, locked, conflict, error } }
    toast({
      title: 'Auto-Assign Complete',
      description: `${data.summary.assigned} assigned · ${data.summary.skipped} skipped · ${data.summary.error} failed`,
    });
    queryClient.invalidateQueries({ queryKey: shiftKeys.managerBidShiftsRoot });
    setLastRunId(data.run_id); // enables the per-run "Undo" + "View decisions" affordances (§9, §8)
  } catch (err: any) {
    toast({ title: 'Auto-Assign Failed', description: err.message, variant: 'destructive' });
  } finally {
    setIsAutoAssigning(false);
  }
}, [organizationId, departmentId, subDepartmentId, startDate, endDate, isAutoAssigning, toast, queryClient]);
```

The button JSX at [index.tsx:1046](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L1046) is unchanged. The `onAutoAssignReady` contract to the parent header is unchanged.

### 1.5 Affected files

| File | Change |
|---|---|
| [OpenBidsView/index.tsx](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L794) | DELETE `handleAutoAssign` loop → thin `functions.invoke` POST; add `lastRunId` state + undo affordance. **`handleAssign`** (manual, [L764](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L764)) re-pointed at the gateway (§3, item 7). |
| [bidding.api.ts](../../src/modules/planning/bidding/api/bidding.api.ts#L243) | `updateBidStatus` stops calling `sm_select_bid_winner` directly; routes through `selectBidWinnerViaGateway` (already present, [L339](../../src/modules/planning/bidding/api/bidding.api.ts#L339)) which calls `applyShiftOp('select_winner')`. |
| **NEW** `supabase/functions/auto-assign-bids/index.ts` | The merged server engine (§2). |
| **NEW** `supabase/functions/auto-assign-bids/engine.ts` | Port wiring: snapshot → `runBidSelection` → per-shift gateway commit (§2.4). Re-uses `@/modules/compliance/v8/orchestrator/bidding` source unchanged. |
| [input-builder.ts](../../src/modules/planning/unified/compliance/input-builder.ts#L74) | No signature change — it already passes `candidateShift.required_qualifications` through. The **fix is at the snapshot layer** that populates those fields (§3.4–§3.5). |
| **NEW** [0001_assignment_audit_and_engine.sql](migrations-draft/0001_assignment_audit_and_engine.sql) | Audit tables + `sm_assignment_run_*` + hardened transitional `sm_select_bid_winner` (file B). |

---

## 2. Server-Side Assignment Engine

### 2.1 Confirmed decision

- **Brain:** `runBidSelection()` hosted **inside an Edge Function** (`auto-assign-bids`, Deno, runs as service role so RLS cannot blind compliance — audit §4 row 31).
- **Commit:** every winner via `sm_apply_shift_op('select_winner', expected_version, {winner_id}, idem_uuid)`.
- **Audit txn:** `sm_assignment_run_start` opens the run, the engine writes one `assignment_decisions` row per shift, `sm_assignment_run_finish` closes it. Each commit appends a `shift_events` row inside the gateway *and* an `assignment_events` row for run-scoped lineage.

### 2.2 Why an Edge Function (and not the alternatives)

| Option | Can host the TS compliance engine? | Commit safety | Long-run / resumable | Verdict |
|---|---|---|---|---|
| **Edge Function (Deno)** | **Yes** — imports `runBidSelection`/`runV8Orchestrator` unchanged | Calls `sm_apply_shift_op` (CAS+FSM) per shift | Synchronous w/ `assignment_runs.cursor` for resume | **CHOSEN** |
| PG function (PL/pgSQL) | **No** — the engine is TypeScript; it cannot execute inside PostgreSQL. Would force a full rule re-implementation in SQL (a *third* lineage — exactly the drift the audit warns about) | Native txn, best commit | Hard | Rejected: re-impl risk |
| Queue worker (durable) | Yes | Same gateway | Yes (best at scale) | **P2 lever** — same run/decision model, just a different trigger; overkill for a manager-triggered, scope-bounded v1 (contracts D2) |
| Background job / `pg_cron` | Partly (cron can *kick* the Edge Function) | Same gateway | Yes | **P2** — used only to drain a backlog of runs; not the v1 trigger |

**The deciding fact:** the compliance engine (`runV8Orchestrator`, `runBidSelection`, `finalValidate`) is TypeScript with no SQL equivalent. PostgreSQL owns *only* the transactional commit and audit (the gateway + `sm_assignment_run_*`); the Edge Function owns the brain. This is the same split the contracts already mandate (D2).

### 2.3 Snapshot scope

The function reads a **single consistent snapshot at run start** under the service role (RLS-blind, so the full schedule of every bidder is visible — fixes audit row 31):

- **Open shifts in scope:** `shifts` where `bidding_status IN (on_bidding, on_bidding_urgent, on_bidding_normal)`, `assignment_status='unassigned'`, `is_cancelled=false`, `deleted_at IS NULL`, scoped by `organization_id` (+ optional `department_id`/`sub_department_id`/date range). Each carries `version` (the CAS token), `role_id`, `required_skills`/`required_licenses` (→ `required_qualifications`), `scheduled_start`.
- **Pending bids:** `shift_bids` where `shift_id IN (scope)`, `status='pending'`, ordered `created_at ASC` (FCFS recency baseline). Includes `created_at` → `bid_time`.
- **Bidder existing shifts:** for every distinct bidder, their assigned shifts in `[min(scope.shift_date)−30d, max(scope.shift_date)+14d]`, `deleted_at IS NULL`, `is_cancelled=false`, **org-scoped** (fixes audit row 26). Service role => full visibility.
- **Employee context:** contracted `role_id`s, qualifications, contracts, and the **student-visa `has_restricted_work_limit`** flag — same shape `fetchV8EmployeeContext` builds, but fetched server-side in one batched pass per employee (fixes audit S3: aggregate the WorkRights flag with `bool_or`, never `.maybeSingle()`).
- **Fairness debts (F3):** `fairnessLedgerService.getEmployeeDebts(orgId, empIds)` → `denied_preferences` metric, injected as `priority_score` boosts (§4).

### 2.4 Orchestration (TypeScript pseudocode)

```ts
// supabase/functions/auto-assign-bids/index.ts (orchestration)
import { runBidSelection } from '@compliance/v8/orchestrator/bidding';        // brain, unchanged
import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

const ENGINE_VERSION = 'auto-assign@1.0.0';            // stamped on every decision (contracts §8)
const POLICY_VERSION = 1;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors();
  const { scope, dry_run = false, options = {} } = await req.json();

  // (A) Authn/authz: forward the manager JWT to a *user-scoped* client for the authz
  //     check, but do the snapshot reads with the *service-role* client (RLS-blind).
  const authClient    = createClient(URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization')! } } });
  const serviceClient = createClient(URL, SERVICE_ROLE);
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !(await isManagerForScope(serviceClient, user.id, scope))) return json(403, { error: 'FORBIDDEN' });

  // (B) Open the run (PENDING→RUNNING). Returns run_id + a UUID namespace for idem keys.
  const { data: run } = await serviceClient.rpc('sm_assignment_run_start', {
    p_scope: scope, p_actor: user.id, p_engine_version: ENGINE_VERSION,
    p_policy_version: POLICY_VERSION, p_options: options, p_dry_run: dry_run,
  });
  const runId = run.run_id;

  try {
    // (C) ONE consistent snapshot (service role => full schedules). §2.3.
    const snap = await loadSnapshot(serviceClient, scope);            // shifts, bids, contexts, existing, debts

    // (D) Build BiddingInput. THIS is where R4/R5 (quals + role) are fixed:
    //     required_qualifications/role_id are populated from real shift columns,
    //     NOT hardcoded []. See §3.4–§3.5.
    const input = buildBiddingInput(snap, {
      accept_warnings: options.accept_warnings ?? false,             // R6: explicit, default OFF
      max_wins_per_employee: options.max_wins_per_employee ?? 3,     // per-run win cap (§4)
      compliance_weight: 0.40, priority_weight: 0.30,
      fairness_weight: 0.20, recency_weight: 0.10,                   // runBidSelection weights
      auto_assign: false,                                            // we commit via the gateway, NOT executeBatch
    });

    // (E) Run the deterministic brain (global greedy + finalValidate). No DB writes here.
    const plan = runBidSelection(input);     // { selected_bids[], rejected_bids[], unfilled_shifts[] }

    // (F) DRY RUN: persist decisions with committed=false, never touch shifts. Return preview.
    if (dry_run) {
      await persistDecisions(serviceClient, runId, plan, snap, { committed: false });
      await serviceClient.rpc('sm_assignment_run_finish', { p_run_id: runId, p_status: 'COMPLETED' });
      return json(200, previewResponse(runId, plan, snap));          // §8 dry_run example
    }

    // (G) COMMIT each winner through the gateway, in a deterministic order (shift_id ASC
    //     for consistent lock ordering — §5 deadlock prevention), with bounded CAS retry.
    const summary = { assigned:0, skipped:0, blocked:0, locked:0, conflict:0, error:0 };
    const ordered = [...plan.selected_bids].sort((a,b) => a.shift_id.localeCompare(b.shift_id));

    for (const sel of ordered) {
      const shift = snap.shiftById.get(sel.shift_id)!;
      const outcome = await commitWinnerWithRetry(serviceClient, {
        runId, shift, winnerId: sel.employee_id, snap, plan,
      });
      summary[outcomeBucket(outcome)]++;                              // contracts §6 enum
    }
    // Shifts with bids but no winner → SKIPPED_NO_ELIGIBLE / SKIPPED_BLOCKED decision rows.
    await recordUnfilled(serviceClient, runId, plan, snap, summary);

    const status = summary.error || summary.conflict ? 'PARTIALLY_FAILED' : 'COMPLETED';
    await serviceClient.rpc('sm_assignment_run_finish', { p_run_id: runId, p_status: status, p_summary: summary });
    return json(202, { run_id: runId, status, summary });

  } catch (e) {
    // D5 fail-closed: record + abort the run, never leave it RUNNING.
    await serviceClient.rpc('sm_assignment_run_finish', { p_run_id: runId, p_status: 'ABORTED', p_error: String(e) });
    return json(500, { run_id: runId, status: 'ABORTED', error: String(e) });
  }
});
```

```ts
// commitWinnerWithRetry — per-shift commit with version-CAS retry, re-read, re-decide. §5.
async function commitWinnerWithRetry(client, { runId, shift, winnerId, snap, plan }) {
  let expectedVersion = shift.version;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {     // MAX_CAS_ATTEMPTS = 3
    const idemUuid = uuidv5(`${runId}:${shift.id}`, ASSIGN_NS);      // contracts §5, deterministic
    const { data: r } = await client.rpc('sm_apply_shift_op', {
      p_shift_id: shift.id, p_expected_version: expectedVersion,
      p_op: 'select_winner', p_payload: { winner_id: winnerId },
      p_idempotency_key: idemUuid,
    });

    if (r.ok && (r.code === 'APPLIED' || r.code === 'IDEMPOTENT_REPLAY')) {
      await writeDecision(client, runId, shift.id, winnerId, plan, 'ASSIGNED',
        { version_before: expectedVersion, version_after: r.version, idem: idemUuid });
      return 'ASSIGNED';
    }
    if (r.code === 'WRITE_REJECTED' && r.note === 'WINNER_NOT_PENDING')  return record(client, runId, shift, 'SKIPPED_NO_ELIGIBLE');
    if (r.code === 'WRITE_REJECTED' && r.note === 'SHIFT_TIME_LOCKED')   return record(client, runId, shift, 'SKIPPED_LOCKED');
    if (r.code === 'ILLEGAL_TRANSITION' || r.code === 'GONE')            return record(client, runId, shift, 'SKIPPED_BLOCKED');

    if (r.code === 'VERSION_CONFLICT') {
      await sleep(backoff(attempt));                                 // bounded exp backoff: 50·2^a ± jitter
      expectedVersion = r.current_version;                           // re-read from the envelope
      // Re-decide: if the shift is no longer S5/S6 unassigned, it was filled by someone else → skip.
      if (!isStillOpenForBidding(r.current_state)) return record(client, runId, shift, 'SKIPPED_BLOCKED');
      continue;                                                      // else retry the CAS at the new version
    }
    return record(client, runId, shift, 'ERROR', { code: r.code });  // D5 fail-closed: record, never throw
  }
  return record(client, runId, shift, 'CONFLICT_RETRY');             // exhausted retries
}
```

### 2.5 Run cursor (resumability / scale — P2)

`assignment_runs.cursor jsonb` stores `{ last_shift_id }`. The commit loop processes shifts in `shift_id ASC` and advances the cursor after each decision row. On crash/timeout the run stays `RUNNING`; a re-invoke with the same `run_id` (or a `pg_cron` drain — P2) resumes after `cursor.last_shift_id`. Because each decision is idempotent on `idem_uuid` (gateway) **and** on `UNIQUE(run_id, shift_id)` (decisions table), resuming never double-commits. This is the contracts D2 "resumable cursor" that makes a queue worker unnecessary for v1.

---

## 3. Mandatory Fixes (1–10)

Each fix names: **why**, **affected file(s)**, **example change**. For (1)(2)(3)(7) the enforcement is server-side in the gateway `select_winner` path **and** mirrored in the hardened transitional `sm_select_bid_winner` so legacy callers are safe the moment the migration lands.

### 3.1 (1) FSM state validation — **P0**

**Why.** `sm_select_bid_winner` blindly stamps `assigned_employee_id` onto already-assigned (S4), cancelled (S15), or non-existent shifts (audit §3.4 D1/D3, §4 rows 1, 3, 14). The gateway already enforces this via `fsm_op_is_legal(state, 'select_winner') ⇒ state ∈ {S5,S6}` ([fsm_op_is_legal:23](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L23)), and the FOR-UPDATE lock filters `deleted_at IS NULL`.

**Affected:** the engine commits through the gateway (already guarded); the **transitional** `sm_select_bid_winner` is hardened (file B) so even the legacy `updateBidStatus`/`approveSwap` paths get the same guard before they are re-pointed.

**Change (transitional RPC, file B):**

```sql
-- inside the hardened sm_select_bid_winner, after FOR UPDATE:
IF NOT FOUND OR v_shift.is_cancelled OR v_shift.deleted_at IS NOT NULL THEN
  RETURN jsonb_build_object('success', false, 'error', 'SHIFT_GONE');
END IF;
v_state := public.get_shift_fsm_state(
  v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome,
  v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
IF NOT public.fsm_op_is_legal(v_state, 'select_winner') THEN     -- S5/S6 only
  RETURN jsonb_build_object('success', false, 'error', 'ILLEGAL_STATE', 'state', v_state);
END IF;
```

### 3.2 (2) TTS / 4h lock enforcement — **P0**

**Why.** The documented 4h window-lock is enforced only client-side in [updateBidStatus](../../src/modules/planning/bidding/api/bidding.api.ts#L260); auto-assign bypasses it entirely. `sm_select_bid_winner` computes `v_tts` and then ignores it for gating (audit §3.1 B7, §4 row 5, baseline:12951). The gateway's `select_winner` write branch **also** does not check TTS (only `publish` does). **Both must enforce it.**

**Affected:** (a) the gateway `select_winner` branch in `_apply_shift_op_write` gains a TTS guard; (b) the transitional `sm_select_bid_winner` gains the same. File B ships (b) and a comment block specifying (a) as the gateway patch (gateway lives in `supabase/migrations/`, which agents must not edit — the human promoter applies the documented diff).

**Change (select_winner write branch — applies in both places):**

```sql
-- TTS lock: reject winner selection inside the 4h window (use emergency assign instead).
IF EXTRACT(EPOCH FROM (v_cur.scheduled_start - NOW())) < 4 * 3600 THEN
  RETURN jsonb_build_object('applied', false, 'note', 'SHIFT_TIME_LOCKED');
END IF;
```

The engine maps `WRITE_REJECTED / SHIFT_TIME_LOCKED ⇒ SKIPPED_LOCKED` (§2.4, contracts §6).

### 3.3 (3) Winner-bid validation (no withdrawn revival) — **P0**

**Why.** `sm_select_bid_winner` (and the gateway `select_winner` branch) accept the winner **by `employee_id` regardless of bid status** ([baseline:12953](../../supabase/migrations/20251015000000_baseline_schema.sql#L12953), [gateway:240](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L240)). A bid withdrawn *after* selection but *before* commit is **revived to `accepted`** (audit §3.2, §4 row 4, §5.3 invalid transition `withdrawn→accepted`). The winner must hold a **currently-`pending`** bid.

**Affected:** gateway `select_winner` write branch + transitional `sm_select_bid_winner`.

**Change:**

```sql
-- Winner must currently hold a PENDING bid on this shift. No revival of withdrawn/rejected.
IF NOT EXISTS (
  SELECT 1 FROM public.shift_bids
  WHERE shift_id = p_shift_id AND employee_id = v_winner AND status = 'pending'
) THEN
  RETURN jsonb_build_object('applied', false, 'note', 'WINNER_NOT_PENDING');
END IF;
```

The engine maps `WINNER_NOT_PENDING ⇒ SKIPPED_NO_ELIGIBLE` and, on the next snapshot/run, retries the shift with the next-ranked bidder.

### 3.4 (4) Qualification validation — **P0**

**Why.** Auto-assign hardcodes `required_qualifications: []` into the compliance input at [index.tsx:937 (existing) and :952 (candidate)](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L937), silently disabling the qual/cert dimension that the manual path enforces as bucket-D `systemFails` (audit B5, F5, §4 row 6). `buildBidInput` is a faithful passthrough ([input-builder.ts:88](../../src/modules/planning/unified/compliance/input-builder.ts#L88)) — it copies `candidateShift.required_qualifications` straight through — so the bug is the **caller zeroing the field**, not the builder.

**Affected:** the new snapshot/`buildBiddingInput` in the Edge Function. The client call sites are deleted with `handleAutoAssign` (§1.4).

**Change (snapshot → V8OrchestratorShift, server-side):**

```ts
// loadSnapshot: hydrate required_qualifications from the shift's real eligibility columns.
function toV8Shift(row: ShiftRow): V8OrchestratorShift {
  return {
    id: row.id, date: row.shift_date,
    start_time: hhmm(row.start_time), end_time: hhmm(row.end_time),
    role_id: row.role_id ?? '',                                   // R5 — real role, see §3.5
    required_qualifications: [                                    // R4 — NOT []
      ...(row.required_licenses ?? []),                           // jsonb[] of license codes
      ...(row.required_skills   ?? []),                           // jsonb[] of skill codes
    ],
    organization_id: row.organization_id,
    department_id: row.department_id, sub_department_id: row.sub_department_id,
    is_ordinary_hours: true,
    unpaid_break_minutes: row.unpaid_break_minutes ?? 0,
  };
}
```

`runV8Orchestrator` then evaluates `V8_QUALIFICATIONS` against `employee_context.qualifications` (which `fetchV8EmployeeContext` already populates from `employee_skills` + `employee_licenses` — [employee-context.ts:123](../../src/modules/compliance/employee-context.ts#L123)). An unqualified bidder now produces a `BLOCKING` hit and is excluded — matching the manual path.

### 3.5 (5) Role validation — **P0**

**Why.** The same call sites pass empty `role_id` for the bidder's existing shifts ([index.tsx:936](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L936)) and rely on the candidate's `roleId` only when present, so the engine cannot check "is this employee contracted for the shift's role?" — the manual path's contract/role check (bucket-D, `validateCompliance`) is skipped. The audit flags this with R4 ("role match") and §4 row 6.

**Affected:** same snapshot layer.

**Change:** populate `role_id` on **both** the candidate shift (from `shifts.role_id`) and the bidder's existing shifts (from each existing shift's `role_id`), and ensure `employee_context.assigned_role_ids` is hydrated (already done by `fetchV8EmployeeContext` from contracts — [employee-context.ts:147](../../src/modules/compliance/employee-context.ts#L147)). The engine's role-eligibility rule then fires: a bidder whose `assigned_role_ids` excludes the candidate's `role_id` is `BLOCKING`.

```ts
// existing shifts must carry their real role_id too, so cross-shift role rules can fire:
existing.map(s => ({ ...toV8Shift(s), role_id: s.role_id ?? '' }))
```

### 3.6 (6) Shift ownership / org-scope validation — **P0**

**Why.** Two gaps: (a) the thin RPC trusts the client-supplied `p_user_id` for the actor with no authz (audit §4 row 18); (b) the existing-shift query has **no org filter** (audit §4 row 26), so a bidder's load is mis-measured across orgs.

**Affected:** the Edge Function (authz) + the snapshot (org scope) + the gateway (already authorizes via cert).

**Change.** (a) **Authz:** the Edge Function authenticates the manager via JWT and checks `app_access_certificates` (`access_level IN gamma/delta/epsilon/zeta`, `is_active=true`, `user_id = caller`) for the requested org/dept scope **before** opening the run; the gateway re-checks the same on every `select_winner` ([gateway:411](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L411)). `sm_select_bid_winner` is hardened to authorize via cert too (file B), dropping reliance on `p_user_id`. (b) **Org scope:** every snapshot query is `.eq('organization_id', scope.organization_id)`, and the existing-shift query is additionally org-filtered:

```ts
.from('shifts').select('…')
  .eq('assigned_employee_id', empId)
  .eq('organization_id', scope.organization_id)   // R: org scope (audit row 26)
  .gte('shift_date', lo).lte('shift_date', hi)
  .is('deleted_at', null).eq('is_cancelled', false);
```

### 3.7 (7) Concurrency protection — **P0**

**Why.** The production loop is a lock-free TOCTOU: two managers, or auto+manual, race the same shift and both succeed; last writer wins, first winner's `accepted` bid dangles (audit §3.3 C1/C2, §4 rows 1, 2, 19). The gateway already solves this with `FOR UPDATE` + version-CAS ([gateway:424–461](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L424)).

**Affected:** engine commit (already CAS via gateway); **manual** `handleAssign` re-pointed at the gateway.

**Change (manual assign, [OpenBidsView/index.tsx:774](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L774)):**

```ts
// was: supabase.rpc('sm_select_bid_winner', { p_shift_id, p_winner_id, p_user_id })
const ux = await biddingApi.selectBidWinnerViaGateway({
  shiftId: expandedV8ShiftId,
  shiftVersion: expandedShift!.version,     // optimistic guard
  winnerId: selectedBid.employeeId,
});
if (ux.kind === 'conflict') { /* re-read shift, re-open compliance panel, prompt manager */ }
```

`selectBidWinnerViaGateway` already exists ([bidding.api.ts:339](../../src/modules/planning/bidding/api/bidding.api.ts#L339)) and routes through `applyShiftOp('select_winner', { winner_id })` → `mapShiftOpResultToUx`. The engine's automated path uses the bounded-retry wrapper in §2.4.

### 3.8 (8) Idempotency — **P1**

**Why.** Re-clicking the button (or a double-fire) reprocesses everything; already-assigned shifts get re-stamped because the RPC doesn't reject them (audit §3.3 C4, §4 row 10).

**Affected:** engine + gateway + decisions table.

**Change.** Two layers: (a) the gateway is idempotent on `p_idempotency_key uuid` matched against `shift_events.metadata->>'idem'` — a replay returns `IDEMPOTENT_REPLAY` and no second write ([gateway:438](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L438)); the engine passes `idem_uuid = uuid_v5(run_id||':'||shift_id)` (contracts §5). (b) `assignment_decisions` has `UNIQUE(run_id, shift_id)` so a shift is decided **at most once per run**; `persistDecisions` uses `ON CONFLICT (run_id, shift_id) DO NOTHING`. A resumed run (§2.5) therefore never double-commits.

### 3.9 (9) Audit logging — **P1**

**Why.** The baseline RPC writes no decision reasoning; "why did X win?" is unanswerable (audit §3.4 D4, §4 row 32, §5.5). 

**Affected:** new `assignment_runs` / `assignment_decisions` / `assignment_events` (§7, file B). Every decision records winner, ordered runners-up, reason, rule hits, composite score, outcome enum, engine/policy version, and version before/after.

**Change (engine `writeDecision`):**

```ts
await client.from('assignment_decisions').upsert({
  run_id: runId, shift_id: shift.id,
  winner_employee_id: winnerId,
  runners_up: rankedRunnersUp(plan, shift.id),     // ordered jsonb: [{employee_id, composite_score, status}]
  reason: 'Global greedy: highest composite score, compliance-clear vs tentative schedule.',
  rule_hits: plan.ruleHitsFor(shift.id, winnerId), // jsonb V8Hit[]
  composite_score: plan.scoreFor(shift.id, winnerId),
  outcome: 'ASSIGNED',                             // contracts §6 enum
  engine_version: ENGINE_VERSION, policy_version: POLICY_VERSION,
  version_before: expectedVersion, version_after: r.version,
  idempotency_key: `${runId}:${shift.id}`,
}, { onConflict: 'run_id, shift_id' });
```

The gateway independently appends a `shift_events` row (`event_type='ASSIGNED'`, `metadata.op='select_winner'`, version delta, idem) — so the lineage is double-anchored.

### 3.10 (10) Notification generation — **P1**

**Why.** On overwrite (the C1 bug, now prevented), the displaced winner got no "unassigned" notice and a *second* "you're assigned" fired (audit §3.3 C6, §4 row 25). With the FSM guard, overwrite can no longer happen — but we must still ensure the *legitimate* notifications fire and that emergency-window assignments surface.

**Affected:** existing DB triggers fire on the resulting row changes — no new trigger needed. The bid-outcome trigger `trg_bid_outcome_notification` fires when `shift_bids.status` flips to `accepted`/`rejected` (per project memory); `trg_emergency_assignment_notification` fires when `assigned_employee_id` NULL→non-null with TTS<4h. Because (2) now blocks TTS<4h auto-assigns, the emergency notification can only originate from the explicit emergency path — which is correct (audit U3 resolved: auto-assign never silently assigns inside the lock).

**Change.** None to triggers. The engine adds a **run-level summary notification** to the triggering manager (`notify_user(manager, type='auto_assign_complete', {run_id, assigned, skipped})`) via `sm_assignment_run_finish`, so the manager has a durable record + a deep link to the run's decisions (§8 `GET …/run/{id}`).

---

## 4. Fairness Engine

Deterministic and auditable: every score component is a pure function of the snapshot, and `assignment_decisions.composite_score` + `rule_hits` records the exact value used.

### 4.1 Composite score (the `runBidSelection` weights — [scorer.ts:123](../../src/modules/compliance/v8/orchestrator/bidding/scorer.ts#L123))

```
composite_score = 100 × (
    0.40 · compliance_score      // PASS=1.0, WARNING=0.5, BLOCKING=0.0
  + 0.30 · priority_score        // (bid.priority_score ?? 50) / 100, after F3 boost (4.2)
  + 0.20 · fairness_score        // static bulk-bidder penalty (4.3)
  + 0.10 · recency_score         // earliest bid_time = 1.0, latest = 0.0 (FCFS)
)
```

Weights sum to 1.0 (`DEFAULT_BIDDING_CONFIG`, [types.ts:95](../../src/modules/compliance/v8/orchestrator/bidding/types.ts#L95)). They are config, overridable per run via `options`, recorded in `assignment_runs.options` for replay.

### 4.2 F3 debt integration (`denied_preferences`)

The audit's F3 ordering (best-effort, silently dropped on error — audit F4) becomes a **first-class, recorded** input. For each bidder, fetch `denied_preferences` debt; map it into a bounded priority boost so an "owed" employee ranks higher among compliance-clear bidders **without** overriding compliance:

```
debt_norm        = clamp(debt / DEBT_SATURATION, 0, 1)            // DEBT_SATURATION = 5 denied prefs
priority_score'  = clamp( (base_priority/100) + F3_GAIN · debt_norm, 0, 1 )   // F3_GAIN = 0.25
```

`base_priority` is the caller's `priority_score` (default 50). The boost is recorded per decision (`rule_hits` carries `{f3_debt, debt_norm, priority_boost}`). If the ledger call fails, the engine records `f3_degraded=true` on the run and falls back to `base_priority` — **explicit degradation, not silent** (fixes F4).

### 4.3 Static fairness (bulk-bidder penalty — already in [scorer.ts:111](../../src/modules/compliance/v8/orchestrator/bidding/scorer.ts#L111))

```
fairness_score = 1 − (emp_bid_count − min_count) / max(1, max_count − min_count)
```

An employee who bid on 1 shift → 1.0; the most prolific bidder → 0.0. Counters anti-gaming vector "spray bids everywhere" (audit F2).

### 4.4 Tie-breakers (deterministic, in [selection-engine.ts:97](../../src/modules/compliance/v8/orchestrator/bidding/selection-engine.ts#L97))

1. `composite_score` descending.
2. `bid_time` ascending (FCFS).
3. `bid_id` ascending (total order — guarantees identical input ⇒ identical output even when (1)(2) tie).

### 4.5 Per-run win cap (dynamic win penalty — anti-concentration, audit B3/§4 row 30)

The greedy loop applies a dynamic penalty so one employee cannot sweep a run. After `w` wins by an employee in the current run, their remaining bids are penalized:

```
win_penalty(w) = WIN_PENALTY_GAIN · max(0, w − SOFT_CAP)         // SOFT_CAP=1, WIN_PENALTY_GAIN=15 points
effective_score = composite_score − win_penalty(wins_so_far[emp])
```

`options.max_wins_per_employee` (default 3) is a **hard** cap: once reached, the employee's remaining bids are excluded entirely for this run (de-prioritized to the queue tail per [selection-engine.ts:30](../../src/modules/compliance/v8/orchestrator/bidding/selection-engine.ts#L30) design note). Both soft penalty and hard cap are recorded.

### 4.6 Anti-gaming summary

| Vector | Counter | Recorded |
|---|---|---|
| **Bid-early** (FCFS short-circuit, audit F2) | recency is only 0.10 weight + global scoring, not first-clear-wins | recency_score |
| **Thin-schedule** (empty roster clears compliance more, audit F3) | F3 debt boost + win cap balance load; compliance is per-rule, not a "fewer shifts = better" signal | f3_debt, win_penalty |
| **Spray-bidding** (audit B3) | static bulk-bidder fairness penalty (4.3) | fairness_score |
| **Win concentration** (audit row 30) | dynamic win penalty + hard cap (4.5) | wins_so_far, capped |

---

## 5. Concurrency Strategy

### 5.1 Transaction boundaries

- **Snapshot (read):** one consistent read at run start; no lock held across the run (the brain is pure). Drift between snapshot and commit is caught by CAS.
- **Per-shift commit (write):** the gateway's `sm_apply_shift_op` is **one transaction** — `FOR UPDATE` lock → CAS → FSM guard → write → `shift_events` append, atomic. The engine writes its `assignment_decisions` row *after* the gateway returns (its own statement). A crash between the two is reconciled on resume: the `shift_events` idem row already exists, so a replay returns `IDEMPOTENT_REPLAY` and the decision row is back-filled.
- **Run lifecycle:** `sm_assignment_run_start` (its own txn) and `sm_assignment_run_finish` (its own txn) bracket the loop. The run is the durable unit of recovery, the per-shift gateway call is the durable unit of correctness.

### 5.2 Optimistic (version-CAS) vs pessimistic

**Optimistic, via version-CAS, is the chosen model** — it is what the gateway already implements ([gateway:449](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L449)). Pessimistic locking across the whole run would hold hundreds of row locks for the engine's duration (seconds), blocking all other managers and the realtime UI. CAS holds a lock only for the microseconds of a single `select_winner` write. The engine *reads* optimistically, *decides* lock-free, and *commits* under a single-row `FOR UPDATE`; a stale decision simply fails CAS and is re-decided.

### 5.3 Retry strategy on `VERSION_CONFLICT`

Bounded exponential backoff with re-read and re-decide (§2.4 `commitWinnerWithRetry`):

- `MAX_CAS_ATTEMPTS = 3`. Backoff `50·2^attempt ms ± jitter` (50/100/200 ms).
- On conflict, take `current_version` + `current_state` straight from the gateway's `VERSION_CONFLICT` envelope ([gateway:449–460](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L449)) — no extra round-trip.
- **Re-decide:** if `current_state` is no longer S5/S6-unassigned, the shift was filled by another writer → record `SKIPPED_BLOCKED`, do not retry. Else retry the CAS at the new version.
- Exhausting attempts ⇒ `CONFLICT_RETRY` outcome (contracts §6); the shift is left open and picked up by the next run.

### 5.4 Deadlock prevention

- **Single-row locks only.** Each `select_winner` locks exactly one `shifts` row. There is no multi-row lock in the assign path.
- **Consistent lock ordering by `shift_id ASC`** (§2.4 step G). Even when two runs overlap, both acquire locks in the same global order, so no lock cycle can form.
- The run's decision rows are append-only and keyed `(run_id, shift_id)` — no cross-run contention on the audit tables.

### 5.5 Sequence diagram (a) — happy path, single shift

```
Manager        EdgeFn(auto-assign)        Gateway sm_apply_shift_op        shifts row (v=7, S5)
  |  POST /auto-assign-bids   |                      |                              |
  |-------------------------->|                      |                              |
  |                           | run_start → run_id   |                              |
  |                           | loadSnapshot (svc)   |--- read v=7, S5, bids ------>|
  |                           | runBidSelection()    |   (pure, in-memory)          |
  |                           | select winner=E1     |                              |
  |                           | select_winner, exp=7 |                              |
  |                           |--------------------->| FOR UPDATE ----------------->| (lock v=7)
  |                           |                      | CAS 7==7 ✓                    |
  |                           |                      | fsm_op_is_legal(S5,sw) ✓      |
  |                           |                      | winner has pending bid ✓ (3.3)|
  |                           |                      | TTS ≥ 4h ✓ (3.2)              |
  |                           |                      | write: assign E1, bids fanout |--> v=8, S4
  |                           |                      | append shift_events(idem)     |
  |                           |  {ok, APPLIED, v=8}  |<-----------------------------|
  |                           |<---------------------|                              |
  |                           | writeDecision(ASSIGNED, 7→8)                        |
  |                           | run_finish(COMPLETED)|                              |
  |  202 {run_id, summary}    |                      |                              |
  |<--------------------------|                      |                              |
```

### 5.6 Sequence diagram (b) — two writers race the same shift, resolved by CAS

```
                         shifts row (v=7, S5)
ManagerA/auto  Gateway        |        Gateway  ManagerB/manual
   | select_winner exp=7      |             exp=7 select_winner |
   |------------------------->|<----------------------------- |   (both arrive ~same time)
   |        FOR UPDATE (A wins the lock first; B blocks)       |
   |   CAS 7==7 ✓                                              |
   |   write assign E1 ───────> v=8, S4                        |
   |   append events(idemA)                                    |
   |  {ok, APPLIED, v=8}      |                                |
   |<------------------------ |    (A releases lock)           |
   |                          | FOR UPDATE (B now proceeds)    |
   |                          | CAS 7 ≠ 8  ✗                   |
   |                          | {ok:false, VERSION_CONFLICT,   |
   |                          |   current_version=8,           |
   |                          |   current_state=S4}            |
   |                          |------------------------------->|
   |                          |   B re-decides: S4 ≠ S5/S6     |
   |                          |   ⇒ shift already filled        |
   |                          |   ⇒ UX 'conflict' / SKIP_BLOCKED|
```

First commit wins; the second is rejected cleanly by CAS — no overwrite, no dangling `accepted` bid, no double "assigned" notification. This is the audit's §4 rows 1/2/19 resolved structurally.

---

## 6. Database Changes (narrative — DDL in file B)

The migration is **expand/contract, additive-only** (contracts §8). It adds three tables and three RPCs and hardens one legacy function; it drops nothing in this deploy.

- **`assignment_runs`** — one row per auto-assign invocation. Captures actor, scope (jsonb), `dry_run`, `status` (run-status enum), engine/policy version, options (the scoring weights + caps used), a `cursor jsonb` for resumability, `summary jsonb`, timestamps, and an `error text`. Indexed by `(organization_id, created_at desc)` for the manager's run history.
- **`assignment_decisions`** — one row per shift considered in a run. The audit core (§7). `UNIQUE(run_id, shift_id)` enforces "decided once per run" (idempotency layer 2). FK to `assignment_runs(id) ON DELETE CASCADE` and to `shifts(id)`. Indexed by `run_id` and by `(shift_id, created_at desc)` so "what runs touched this shift?" is fast (drives rollback eligibility, §9).
- **`assignment_events`** — append-only run lineage (run started/finished/rolled-back, and per-shift commit/skip/conflict), distinct from the global `shift_events` (which the gateway writes). Lets the run timeline be reconstructed without scanning `shift_events`. FK to `assignment_runs`.
- **Constraints/checks:** `outcome` and `status` columns are `CHECK`ed against the contracts §6 enum value lists (as `text` + CHECK, not native enums, to stay expand/contract-safe — a new outcome value is a one-line CHECK edit, not an `ALTER TYPE ADD VALUE` that must be a separate committed txn per project memory). `version_before <= version_after` check. `composite_score BETWEEN 0 AND 100`.
- **RLS:** all three tables are org-scoped read for managers via `app_access_certificates`; writes only via the `SECURITY DEFINER` RPCs (no direct client INSERT).

Full DDL, indexes, and the three PL/pgSQL functions are in [0001_assignment_audit_and_engine.sql](migrations-draft/0001_assignment_audit_and_engine.sql).

---

## 7. Audit Trail (schemas)

### 7.1 `assignment_runs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organization_id` | uuid NOT NULL | FK `organizations(id)`; RLS scope |
| `department_id` | uuid NULL | FK; optional scope |
| `sub_department_id` | uuid NULL | FK; optional scope |
| `actor_id` | uuid NOT NULL | manager who triggered (FK `profiles`/auth) |
| `scope` | jsonb NOT NULL | full scope echo (date range etc.) |
| `dry_run` | boolean NOT NULL default false | preview vs commit |
| `status` | text NOT NULL | CHECK ∈ `PENDING/RUNNING/COMPLETED/PARTIALLY_FAILED/ROLLED_BACK/ABORTED` (§6) |
| `engine_version` | text NOT NULL | e.g. `auto-assign@1.0.0` |
| `policy_version` | int NOT NULL default 1 | |
| `options` | jsonb NOT NULL default `{}` | weights, caps, accept_warnings |
| `cursor` | jsonb NOT NULL default `{}` | `{last_shift_id}` resumability |
| `summary` | jsonb NULL | per-outcome counts |
| `error` | text NULL | set on ABORTED |
| `created_at` / `started_at` / `finished_at` | timestamptz | lifecycle |

Index: `(organization_id, created_at desc)`.

### 7.2 `assignment_decisions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `run_id` | uuid NOT NULL | FK `assignment_runs(id) ON DELETE CASCADE` |
| `shift_id` | uuid NOT NULL | FK `shifts(id)` |
| `winner_employee_id` | uuid NULL | NULL when skipped/unfilled |
| `runners_up` | jsonb NOT NULL default `[]` | **ordered** `[{employee_id, composite_score, compliance_status}]` |
| `reason` | text NOT NULL | human-readable decision rationale |
| `rule_hits` | jsonb NOT NULL default `[]` | `V8Hit[]` for the winner + F3/win-penalty trace |
| `composite_score` | numeric NULL | CHECK 0..100; winner's score |
| `outcome` | text NOT NULL | CHECK ∈ `ASSIGNED/SKIPPED_NO_ELIGIBLE/SKIPPED_BLOCKED/SKIPPED_LOCKED/CONFLICT_RETRY/ERROR` (§6) |
| `engine_version` | text NOT NULL | |
| `policy_version` | int NOT NULL | |
| `version_before` | int NULL | shift version pre-commit (CAS token) |
| `version_after` | int NULL | shift version post-commit |
| `idempotency_key` | text NOT NULL | `run_id||':'||shift_id` (contracts §5) |
| `created_at` | timestamptz NOT NULL default now() | |

Constraints: `UNIQUE(run_id, shift_id)`; `CHECK(version_before IS NULL OR version_after IS NULL OR version_before <= version_after)`. Indexes: `(run_id)`, `(shift_id, created_at desc)`, `(idempotency_key)`.

### 7.3 `assignment_events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `run_id` | uuid NOT NULL | FK `assignment_runs(id) ON DELETE CASCADE` |
| `shift_id` | uuid NULL | NULL for run-level events |
| `event_type` | text NOT NULL | CHECK ∈ `RUN_STARTED/RUN_FINISHED/RUN_ROLLED_BACK/SHIFT_ASSIGNED/SHIFT_SKIPPED/SHIFT_CONFLICT/SHIFT_ROLLBACK` |
| `actor_id` | uuid NULL | manager or NULL=system |
| `metadata` | jsonb NOT NULL default `{}` | version delta, idem, code |
| `created_at` | timestamptz NOT NULL default now() | |

Index: `(run_id, created_at)`.

---

## 8. API Design (contracts §7)

### 8.1 `POST /functions/v1/auto-assign-bids`

**Request**
```json
{
  "scope": {
    "organization_id": "org-uuid",
    "department_id": "dept-uuid",
    "sub_department_id": null,
    "start_date": "2026-06-23",
    "end_date": "2026-06-30"
  },
  "dry_run": false,
  "options": { "accept_warnings": false, "max_wins_per_employee": 3 }
}
```

**Response (202 — committed run)**
```json
{
  "run_id": "run-uuid",
  "status": "COMPLETED",
  "summary": { "assigned": 12, "skipped": 3, "blocked": 1, "locked": 2, "conflict": 0, "error": 0 }
}
```

**Response (200 — `dry_run: true` preview)** — persists decisions with `committed=false`, never mutates `shifts`:
```json
{
  "run_id": "run-uuid",
  "status": "COMPLETED",
  "dry_run": true,
  "preview": [
    {
      "shift_id": "shift-A",
      "outcome": "ASSIGNED",
      "winner": { "employee_id": "E1", "name": "Asha R.", "composite_score": 87.4 },
      "runners_up": [
        { "employee_id": "E2", "composite_score": 81.0, "compliance_status": "PASS" },
        { "employee_id": "E3", "composite_score": 64.2, "compliance_status": "WARNING" }
      ],
      "reason": "Highest composite score; compliance-clear vs tentative schedule.",
      "rule_hits": [],
      "f3_debt": 2
    },
    {
      "shift_id": "shift-B",
      "outcome": "SKIPPED_LOCKED",
      "winner": null,
      "reason": "All bids inside the 4h time-lock; use emergency assignment."
    }
  ],
  "summary": { "assigned": 1, "skipped": 0, "blocked": 0, "locked": 1, "conflict": 0, "error": 0 }
}
```

**VERSION_CONFLICT handling.** A conflict on a single shift is *not* an HTTP error — the engine retries (bounded backoff, §5.3) then, if still conflicting, records `outcome: "CONFLICT_RETRY"` for that shift and continues. The run completes `PARTIALLY_FAILED` if any shift ended `CONFLICT_RETRY`/`ERROR`:
```json
{ "run_id": "run-uuid", "status": "PARTIALLY_FAILED",
  "summary": { "assigned": 10, "skipped": 1, "blocked": 0, "locked": 0, "conflict": 1, "error": 0 } }
```

### 8.2 `GET /functions/v1/auto-assign-bids/run/{run_id}`

Returns the run + all decisions (powers the manager's "what did it do, and why?" panel — fixes audit U1).
```json
{
  "run": { "id": "run-uuid", "status": "COMPLETED", "actor_id": "mgr-uuid",
           "engine_version": "auto-assign@1.0.0", "summary": { "assigned": 12, "...": "..." } },
  "decisions": [
    { "shift_id": "shift-A", "outcome": "ASSIGNED", "winner_employee_id": "E1",
      "composite_score": 87.4, "runners_up": [ ... ], "reason": "...",
      "version_before": 7, "version_after": 8 }
  ]
}
```

### 8.3 `POST /functions/v1/auto-assign-bids/run/{run_id}/rollback`

Body `{}`. Calls `sm_assignment_run_rollback(run_id)` (§9). Returns:
```json
{
  "run_id": "run-uuid",
  "status": "ROLLED_BACK",
  "reverted": [ { "shift_id": "shift-A", "version_after_rollback": 9 } ],
  "skipped":  [ { "shift_id": "shift-B", "reason": "TTS_LOCKED" },
                { "shift_id": "shift-C", "reason": "EDITED_SINCE" } ]
}
```

---

## 9. Rollback Design

**Goal:** a manager undoes an entire run with one click (fixes audit U5, §5.5). Rollback is **partial-safe** and **audit-preserving**.

### 9.1 Safe rollback rules — a shift is revertible **only if all hold**:

1. It was **ASSIGNED by this run** (an `assignment_decisions` row with `outcome='ASSIGNED'`, `version_after` set).
2. It is **still in S4 (Published+assigned+confirmed)** AND its current `version` **equals** the run's recorded `version_after` (i.e. **nothing has changed it since** — no edit, no trade, no manual reassign). Any drift ⇒ `EDITED_SINCE`, skip.
3. **TTS ≥ 4h** — never unwind a shift inside the time-lock (it may be live-emergency territory). Else ⇒ `TTS_LOCKED`, skip.
4. It has **not since been traded** (`trading_status = 'NoTrade'`).

### 9.2 The revert operation

Rollback unwinds S4→S5 by re-opening the shift for bidding and restoring the winner's bid to `pending`. It does this **through the gateway** with the recorded `version_after` as the CAS token, so a concurrent change loses the race and the shift is skipped (rule 2 enforced by CAS, not just a read-check). The unwind uses a dedicated `unassign_winner` semantics inside `sm_assignment_run_rollback` (it cannot reuse `unassign`, which is S2-only). Each revert appends a fresh `shift_events` + `assignment_events('SHIFT_ROLLBACK')` row.

### 9.3 Audit preservation

Rollback **never deletes** `assignment_decisions` or `assignment_runs`. It:
- sets `assignment_runs.status = 'ROLLED_BACK'`,
- appends `assignment_events('RUN_ROLLED_BACK')` + per-shift `SHIFT_ROLLBACK`,
- leaves every original decision row intact (the history of "what it decided" is immutable; the rollback is a *new* layer of events).

### 9.4 `sm_assignment_run_rollback` logic (full PL/pgSQL in file B)

```
sm_assignment_run_rollback(p_run_id):
  authorize caller (cert for the run's org)              -- §3.6
  load run; assert status IN (COMPLETED, PARTIALLY_FAILED)
  for each decision d in run where d.outcome='ASSIGNED' and d.version_after is not null,
      ordered by d.shift_id:                              -- consistent lock order (§5.4)
    lock shift FOR UPDATE
    if shift.version <> d.version_after        -> skip 'EDITED_SINCE'
    if shift.is_cancelled or deleted_at        -> skip 'GONE'
    if shift.trading_status <> 'NoTrade'        -> skip 'TRADED_SINCE'
    if scheduled_start - now() < 4h             -> skip 'TTS_LOCKED'
    -- revert: S4 -> S5 (re-open bidding), winner bid pending, others stay rejected
    update shifts: unassign, bidding_status=on_bidding, is_on_bidding=true,
                   fulfillment=bidding, lifecycle stays Published
    update shift_bids: set winner back to 'pending'
    append shift_events('UNASSIGNED', op='run_rollback', idem=uuid_v5(run||':rb:'||shift))
    insert assignment_events('SHIFT_ROLLBACK', metadata{version_before, version_after})
    collect into reverted[]
  set run.status='ROLLED_BACK'; insert assignment_events('RUN_ROLLED_BACK')
  return { reverted[], skipped[] }
```

---

## 10. Priority ranking (consolidated)

See §0 for the per-fix table. **P0 (ship first, behind the migration's transitional `sm_select_bid_winner` so prod is protected immediately):** fixes (1)(2)(3)(4)(5)(6)(7). **P1 (SSoT/audit/scale):** D2 merge + Edge Function, (8) idempotency, (9) audit, (10) notifications, (9) rollback. **P2 (optimization):** the fairness engine (§4), the run cursor / queue fan-out (§2.5). This mirrors the audit's Phase 0 → Phase 1 → Phase 2 roadmap (§12) exactly.

---

### Appendix — claim-to-code grounding map

| Claim | Evidence |
|---|---|
| Two engines; prod is the weaker | [handleAutoAssign:794](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L794) vs [runBidSelection:147](../../src/modules/compliance/v8/orchestrator/bidding/index.ts#L147) |
| `required_qualifications: []` hardcoded | [index.tsx:937](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L937), [:952](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L952) |
| Thin RPC has no FOUND/FSM/winner/TTS guard | [baseline:12942](../../supabase/migrations/20251015000000_baseline_schema.sql#L12942) |
| Gateway CAS + FSM guard | [unassign_op.sql:449](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L449), [fsm_op_is_legal:23](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L23) |
| `select_winner` revives by employee_id only | [unassign_op.sql:240](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L240) |
| Gateway idempotency on `metadata->>'idem'` | [unassign_op.sql:438](../../supabase/migrations/20260623000100_shift_unassign_op.sql#L438) |
| Scoring weights .40/.30/.20/.10 | [scorer.ts:123](../../src/modules/compliance/v8/orchestrator/bidding/scorer.ts#L123), [types.ts:95](../../src/modules/compliance/v8/orchestrator/bidding/types.ts#L95) |
| Reference gateway wiring already present | [bidding.api.ts:339](../../src/modules/planning/bidding/api/bidding.api.ts#L339) |
| `buildBidInput` is a faithful passthrough | [input-builder.ts:74](../../src/modules/planning/unified/compliance/input-builder.ts#L74) |
</content>
</invoke>
