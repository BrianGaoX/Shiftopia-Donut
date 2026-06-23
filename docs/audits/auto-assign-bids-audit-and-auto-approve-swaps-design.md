# Auto-Assign Bids — Product & Logic Audit + Auto-Approve Swap Requests Design

**Date:** 2026-06-23
**Scope:** `src/modules/planning/bidding`, `src/modules/compliance/v8/orchestrator/bidding`, `src/modules/planning/swapping`, `supabase/migrations`
**Reviewer roles:** PM / Staff Eng / QA Lead / Systems Architect
**Posture:** Adversarial. Nothing is assumed correct.

> All findings are grounded in code that exists today. File\:line references are given so each claim is verifiable.

---

## 1. Executive Summary

The single most important finding is that **two different "Auto-Assign Bids" engines exist, and the one running in production is the weaker of the two.**

1. **The "designed" engine** — `runBidSelection()` at [src/modules/compliance/v8/orchestrator/bidding/index.ts](../../src/modules/compliance/v8/orchestrator/bidding/index.ts). A deterministic, global, greedy optimizer with composite scoring (compliance + priority + fairness + recency), a structural pre-filter, a final whole-schedule validation pass, and an optional batch executor. It is well-structured and stateless — **and it is not wired to any UI or server path.** `grep` for `runBidSelection` across the app finds zero call sites outside the engine's own re-export.

2. **The production engine** — `handleAutoAssign()` at [OpenBidsView/index.tsx:794](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L794). A client-side, per-shift sequential loop that picks the **first compliance-clear bidder** and commits each assignment with a direct `sm_select_bid_winner` RPC call. This is the "Auto-Assign Safe Bids" button on the Manager Bids page.

This divergence is the root of most risk: the careful guarantees of engine #1 (global optimality, fairness ledger integration, final-validation safety net, deterministic tie-breaks) **do not apply to what users actually run.** It mirrors the existing "two shift-FSM lineages" problem already recorded in project memory.

Beneath that, the production path has **server-side integrity gaps that are independently severe**:

- `sm_select_bid_winner` has **no FSM/state guard, no row-existence check, and no winner-bid validation** ([baseline](../../supabase/migrations/20251015000000_baseline_schema.sql)). It will blindly stamp `assigned_employee_id` onto an already-assigned, cancelled, deleted, or non-existent shift, and will flip a *withdrawn* bid back to `accepted`.
- The documented **4-hour bidding-window lock is not enforced server-side**; it lives only in the client `updateBidStatus` path, which auto-assign **bypasses**. The RPC computes `v_tts` and then ignores it for gating.
- **Qualifications/certifications are bypassed in auto-assign** — `required_qualifications: []` is hardcoded into the compliance input ([index.tsx:937,952](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L937)). The manual assign path enforces them (bucket D `systemFails`); auto-assign does not. The two paths apply *different* compliance criteria.
- **Warnings are silently accepted** by auto-assign (only `h.blocking` gates), while the manual path forces an explicit override acknowledgment.
- The whole loop is a **read→evaluate→write TOCTOU with no transaction**, racing concurrent managers, manual assigns, employee withdrawals, and shift edits.

**Risk verdict: HIGH.** The feature can (a) double-assign shifts, (b) assign unqualified staff, (c) assign inside the locked window, (d) silently override warnings, and (e) produce no audit reasoning. None of these require malice — ordinary concurrent use triggers them.

**Top 7 recommendations (detail in §12):**

| # | Recommendation | Why it matters |
|---|---|---|
| R1 | Make `sm_select_bid_winner` defensive: `FOUND` check, FSM-state guard (must be S5/on-bidding & unassigned), validate winner actually has a `pending` bid, enforce TTS lock. | Closes double-assignment, ghost-assignment, withdrawn-revival, and window-lock bypass in one place. |
| R2 | Converge on **one** engine. Either wire `runBidSelection` to a server function, or delete it and harden the UI loop. | Eliminates the two-lineages drift; restores fairness/optimality guarantees. |
| R3 | Move auto-assign to a **server-side transactional batch** (SQL function or edge function), not a client loop. | Removes TOCTOU, N×M round-trips, and client-trust issues. |
| R4 | Pass real `required_qualifications` + role match into auto-assign compliance. | Stops unqualified assignment. |
| R5 | Emit a per-decision **audit/event record** (winner, runners-up, reason, rules hit). | Transparency, disputes, fairness defense. |
| R6 | Make warning-handling explicit and configurable in auto-assign. | Governance parity with manual path. |
| R7 | Add idempotency + run-level locking so re-runs and concurrent runs are safe. | Prevents duplicate processing at scale. |

---

## 2. Current Feature Audit (Part 1)

### 2.1 Two implementations, side by side

| Aspect | Engine #1 — `runBidSelection` (NOT in prod) | Engine #2 — `handleAutoAssign` (PRODUCTION) |
|---|---|---|
| Location | `compliance/v8/orchestrator/bidding/*` | `OpenBidsView/index.tsx:794-990` |
| Trigger | None (no call site) | "Auto-Assign Safe Bids" button, Manager Bids page |
| Scope | All shifts + all bids in one global pass | Per-shift loop, current scope filter only |
| Selection | Global greedy by composite score | First compliance-clear bidder per shift |
| Scoring | compliance 0.40 / priority 0.30 / fairness 0.20 / recency 0.10 | None — FIFO + optional F3 debt reorder |
| Tie-break | `bid_time` ascending (FCFS) | DB `created_at` ascending |
| Fairness | Static (bulk-bidder penalty) + dynamic win penalty | F3 denied-preference debt reorder (best-effort) |
| Final safety pass | Yes (`finalValidate`, whole-schedule recheck) | No |
| Qualifications | Whatever compliance input carries | **Hardcoded empty** → not enforced |
| Warnings | Configurable `accept_warnings` (default accept) | Silently accepted (blocking-only gate) |
| Commit | `executeBatch` (simulated/transactional model) | Direct `sm_select_bid_winner` RPC per shift |
| Determinism | Guaranteed (pure function) | No — depends on live DB reads, timing, network |
| State guard | N/A (pure) | None at DB layer |

### 2.2 Business objective

Reduce manager toil: instead of manually opening each open shift and picking a winner, the manager clicks one button and the system assigns every open-with-bids shift to a compliance-clear bidder, respecting (intended) fairness and labor rules. Goal = faster coverage of open shifts, fewer unfilled shifts, fairer distribution.

### 2.3 Actors

- **Manager** — triggers auto-assign; button gated by certificate in UI ([ManagerBids.page.tsx:45](../../src/modules/planning/bidding/ui/pages/ManagerBids.page.tsx#L45)).
- **Employee (bidder)** — placed a `pending` bid; passive recipient of the outcome.
- **Compliance engine (v8)** — `runV8Orchestrator` + `runHardValidation` evaluate each candidate.
- **Fairness ledger service** — `fairnessLedgerService.getEmployeeDebts` supplies F3 ordering.
- **Database (`sm_select_bid_winner`)** — performs the actual write + bid fan-out + FSM transition.
- **Notification triggers** — `trg_bid_outcome_notification`, `trg_emergency_assignment_notification` (per project memory) fire on the resulting row changes.

### 2.4 Inputs / Outputs / Triggers / Dependencies

**Inputs (production path):**
- The in-memory `shifts` list (already scope-filtered), filtered to `toggle !== 'resolved' && bidCount > 0`, sorted by `date` ascending ([index.tsx:799](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L799)).
- Per shift: `shift_bids` where `status='pending'` ordered by `created_at` ascending.
- Per bidder: their assigned shifts in `[shift.date − 30d, + 14d]`, `deleted_at IS NULL`, `is_cancelled=false`.
- Per bidder: `employee_licenses.has_restricted_work_limit` (visa flag).
- Org-level fairness debts (F3).

**Outputs:**
- Zero or more `shifts` rows assigned; corresponding `shift_bids` flipped to `accepted`/`rejected`.
- A summary toast: `"{assigned} assigned · {skipped} skipped · {failed} failed"`.
- React-Query invalidation of bid/shift caches.

**Triggers:** Manual button click only. No cron, no event, no webhook.

**Dependencies:** Supabase client (RLS-scoped), compliance v8, fairness ledger, `sm_select_bid_winner` RPC, notification DB triggers.

### 2.5 Decision logic (production)

```
for shift in shifts (chronological, has bids, not resolved):
    bids = pending bids for shift, FIFO
    bids = reorder by F3 denied-preference debt (best-effort, descending debt)
    winner = null
    for bid in bids:
        existing = assigned shifts of bidder in [-30d,+14d]
        visa = has_restricted_work_limit(bidder)
        hard = runHardValidation(candidate vs existing)
        blocker = !hard.passed
        if not blocker:
            blocker = runV8Orchestrator(buildBidInput(... required_qualifications:[] ...)).hits.any(blocking)
        if not blocker:
            winner = bid; break        # first compliance-clear bidder wins
    if winner == null: skipped++; continue
    rpc sm_select_bid_winner(shift, winner)   # NO state/winner/TTS guard
    on error: failed++ else assigned++
```

### 2.6 Assignment priority rules (production, as-built)

1. Shifts processed **chronologically** by date (so streak rules accumulate in order).
2. Within a shift, bidders ordered by **F3 denied-preference debt** (descending) when org + ledger data present, else **FIFO** by `created_at`.
3. **First** bidder that clears hard-validation + v8 blocking-rules **wins**. No scoring, no comparison among clear bidders.

### 2.7 Tie-breaking rules

- Production: stable sort preserves FIFO within equal debt; otherwise pure FIFO. There is no compliance-quality or priority tie-break — the earliest acceptable bidder simply wins.
- Engine #1 (unused): `composite_score` desc, then `bid_time` asc.

### 2.8 Notifications & side effects

- `shift_bids` for the winner → `accepted`; all other `pending` → `rejected` (fan-out inside the RPC).
- `shifts`: `assigned_employee_id`, `assignment_status='assigned'`, `assignment_outcome='confirmed'`, `bidding_status='not_on_bidding'`, `is_on_bidding=false`, `fulfillment_status='scheduled'`.
- DB triggers fire bid-outcome notifications to employees and (when TTS<4h) emergency-assignment notifications.
- **No** per-decision audit/event row is written by the **baseline** RPC body (it returns `{success:true}` with no log insert). The gateway `select_winner` op writes `last_modified_by`; the thin RPC used by auto-assign does not.

### 2.9 Database entities

`shifts`, `shift_bids`, `profiles`, `employee_licenses`, fairness-ledger tables, notification tables, operational-log table (written by some paths, not by the thin RPC).

### 2.10 External integrations

None beyond Supabase/Postgres + RLS + the in-app compliance engine. No payroll, no calendar, no third-party. The compliance engine is internal TypeScript executed **on the client**.

### 2.11 Flow diagram (production)

```
[Manager] --click "Auto-Assign Safe Bids"--> handleAutoAssign()
        |
        v
  filter+sort shifts (chrono, has bids)
        |
        +--> per shift -------------------------------+
        |     fetch pending bids (FIFO)               |
        |     F3 debt reorder (best-effort)           |
        |     +--> per bidder ----------------+        |
        |     |   fetch existing shifts (DB)  |        |
        |     |   fetch visa flag (DB,cached) |        |
        |     |   runHardValidation()         |        |
        |     |   runV8Orchestrator()  quals=[]|       |
        |     |   pass? -> winner; break       |       |
        |     +--------------------------------+        |
        |     winner? --no--> skipped++                 |
        |             --yes--> RPC sm_select_bid_winner |
        |                       error? failed++ : assigned++
        +-----------------------------------------------+
        |
        v
  toast summary + invalidate caches
```

### 2.12 Decision tree (per bidder)

```
                       pending bid?
                       /         \
                     no           yes
                  (excluded)       |
                              hard validation passes?
                               /            \
                             no              yes
                          (skip bidder)       |
                                    v8 blocking hits (quals=[])?
                                       /            \
                                     yes             no
                                  (skip bidder)   WIN -> assign, stop shift
```

Note what is **absent** from this tree: any check that the shift is still open, that TTS > 4h, that the bidder is role/cert-qualified, that warnings were acknowledged, or that a higher-quality clear bidder exists.

---

## 3. Logical Audit (Part 2)

### 3.1 Business logic issues

- **B1 — Incorrect ordering / non-optimality.** "First clear bidder wins" is greedy *per shift* with no global view. A bidder who is the only viable candidate for shift B may be consumed by shift A (processed earlier) because they cleared A first, leaving B unfilled. Engine #1 avoids this; production does not.
- **B2 — Priority inversion.** A high-priority/high-seniority bidder loses to a lower-priority one who simply bid earlier or has higher F3 debt, because there is no priority comparison among clear bidders — the loop short-circuits on the first pass.
- **B3 — Unfair concentration.** Early bidders (low `created_at`) are systematically favored within a shift; across shifts there is no per-run win cap. Engine #1's dynamic win penalty is not in production.
- **B4 — Starvation.** A bidder who is always "second" never wins; F3 debt only nudges ordering and is best-effort (silently skipped on error, [index.tsx:860](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L860)).
- **B5 — Rule conflict (qual bypass).** Auto-assign sets `required_qualifications: []`, so the role/cert dimension is silently disabled, conflicting with the manual path's bucket-D enforcement.
- **B6 — Invalid assumption (fresh reads serialize).** The loop assumes its own sequential awaits give it a consistent world; it ignores all *other* writers.
- **B7 — Missing rule (window lock).** The 4h lock is a documented business rule but is not enforced on this path.
- **B8 — Warning governance.** Warnings are silently accepted; the business treats warnings as "manager must acknowledge" on the manual path.

### 3.2 Edge cases

- **No eligible bids** → shift skipped (handled).
- **Multiple equally-eligible bids** → first one wins arbitrarily; no documented tie policy surfaced to the manager.
- **Simultaneous submissions** → a bid inserted mid-run is invisible (snapshot read at loop start) or, worse, visible inconsistently between the bid-list read and the existing-shift read.
- **Withdrawal during assignment** → the bid-list read filters `status='pending'`, but the RPC's winner update is **by employee_id regardless of status**, so a bid withdrawn *after* selection but *before* the RPC commit is **revived to `accepted`**.
- **Employee becomes unavailable** (deactivated, leave) → not checked; an inactive employee can win.
- **Assignment cancellation** mid-run → no compensation; partial state persists.
- **Partial assignments** → loop continues on failures; `failed` count may not reflect DB truth if invalidation races.
- **Expired bids** → there is no bid-expiry concept on `shift_bids`; stale bids from weeks ago are eligible.
- **Duplicate bids** → prevented at insert by `onConflict: 'shift_id, employee_id'` upsert ([bidding.api.ts:208](../../src/modules/planning/bidding/api/bidding.api.ts#L208)), good.
- **Reopened shift** (unassigned back to S5) → old `accepted`/`rejected` bid rows may persist depending on the unassign path, polluting the next round's "pending" filter (needs verification per shift).

### 3.3 Concurrency issues

- **C1 — Double assignment.** Two managers (or auto-assign + manual) target the same shift. `sm_select_bid_winner` has **no state guard** — both succeed; last writer wins; first winner is silently overwritten, their `accepted` bid left dangling.
- **C2 — TOCTOU.** Read pending bids → run compliance → write, with no lock on the shift across that window. Anything can change in between.
- **C3 — Lost update on withdrawal** (see edge case above).
- **C4 — Duplicate processing.** Re-clicking the button, or a double-fire, reprocesses everything; no idempotency key. Already-assigned shifts get re-stamped because the RPC doesn't reject them.
- **C5 — Stale reads.** The `shifts` array driving the loop is React-Query cached; it can be seconds-to-minutes stale, so the loop may try to assign shifts that were filled or deleted.
- **C6 — Event ordering.** Notification triggers fire per row change; an overwrite (C1) fires a *second* "you're assigned" to the new winner and no "you were unassigned" to the displaced one.

### 3.4 Data integrity risks

- **D1 — Ghost assignment.** No `FOUND` check: if the shift id is stale/deleted, `v_shift` is NULL and the function still runs its UPDATEs (0 rows) and returns `success:true`. The UI counts it as `assigned`.
- **D2 — Orphaned bid rows.** Overwrite leaves a previously-`accepted` bid with no corresponding assignment.
- **D3 — Invalid state.** Assigning a cancelled (S15) or deleted shift puts a row into an inconsistent (assigned + cancelled) state — the RPC doesn't check `is_cancelled`/`deleted_at`.
- **D4 — Missing audit trail.** Baseline RPC writes no operational-log row; the assignment reason, runner-up list, and rules-hit are not persisted anywhere. Disputes are unwinnable.
- **D5 — Transaction failure.** Each RPC is its own transaction; there is no run-level transaction, so a crash mid-loop leaves a partial, unrecorded result.

### 3.5 UX risks

- **U1 — Opaque outcomes.** Manager sees only counts. No list of which shift went to whom, why others were skipped, or which rule blocked.
- **U2 — Silent warnings.** Warning-level compliance issues are auto-accepted with no surface, unlike the manual flow.
- **U3 — Unexpected assignment.** An employee can be auto-assigned a shift inside the 4h window (emergency territory) without the emergency UX/consent.
- **U4 — No dry-run/preview.** There is no "preview what auto-assign would do" before committing — it is fire-and-commit.
- **U5 — No undo.** No batch rollback of an auto-assign run.

### 3.6 Fairness & compliance

- **F-1 — Hidden bias toward early bidders** (FIFO short-circuit).
- **F-2 — Gaming: bid-early.** Because earliest acceptable bidder wins, employees learn to bid the instant a shift opens.
- **F-3 — Gaming: thin-schedule.** A bidder who keeps their schedule empty clears compliance more often and wins more.
- **F-4 — F3 debt is bypassable/silent.** Any error in the ledger call drops fairness ordering entirely with only a `console.warn`.
- **F-5 — Qual bypass is a compliance violation**, not just unfairness — could place legally-uncertified staff (e.g., student-visa hour caps are checked, but role certifications are not).
- **F-6 — Priority manipulation** is moot in prod (priority isn't used), but that itself means a legitimate priority signal is ignored.

### 3.7 Scalability

- **S1 — O(shifts × bidders) sequential awaits**, each doing ≥3 DB round-trips (existing shifts, visa, plus 2 in-process compliance engines). 500 shifts × 10 bidders ≈ 5,000 iterations × ~3 round-trips ≈ 15,000 serialized network calls from the browser. Minutes-long runs, UI thread pressure, timeouts.
- **S2 — No batching / no server push-down.** All compliance runs on the client; the DB is hit per bidder.
- **S3 — Visa `.maybeSingle()`** throws if an employee has >1 `WorkRights` license, aborting that bidder.
- **S4 — Lock contention** isn't a current problem only because there is no locking — which is itself the bug.
- **S5 — Cache invalidation storm** at the end invalidates broad roots, refetching large lists.

---

## 4. Failure Mode Analysis (Part 3) — 32 scenarios

| # | Scenario | Expected Behaviour | Current Behaviour | Risk | Recommended Fix |
|---|---|---|---|---|---|
| 1 | Two managers auto-assign same shift concurrently | One wins, other no-ops with conflict notice | Both succeed; last overwrites first | **Critical** | FSM/state guard + version CAS in RPC (R1) |
| 2 | Auto-assign races a manual assign on same shift | First commit wins, second rejected | Overwrite, dangling accepted bid | **Critical** | R1 |
| 3 | Shift id stale/deleted at RPC time | Reject "shift not found" | `FOUND` not checked → returns success:true | **High** | Add `IF NOT FOUND` guard (R1) |
| 4 | Winner withdraws bid after selection, before RPC | Bidder excluded | Withdrawn bid flipped to accepted | **High** | RPC: only accept a currently-`pending` bid (R1) |
| 5 | Shift starts in 3h, has old pending bids | Blocked (window lock); use emergency | Auto-assigns inside locked window | **High** | Enforce TTS≥4h in RPC (R1/R7) |
| 6 | Bidder lacks required role certification | Blocked (qual fail) | quals=[] → assigned anyway | **Critical** | Pass real required_qualifications (R4) |
| 7 | Bidder is deactivated/on leave | Excluded | Not checked → can win | **High** | Add active/availability gate |
| 8 | Compliance is WARNING (e.g., near OT cap) | Manager acknowledges | Silently accepted | **Medium** | Configurable warning policy (R6) |
| 9 | Only viable bidder for shift B is consumed by shift A | B filled, A reassigned, or global optimum | B left unfilled | **Medium** | Adopt global engine (R2) |
| 10 | Re-click auto-assign (double fire) | Idempotent no-op for done shifts | Re-stamps assigned shifts | **High** | Idempotency + state guard (R1/R7) |
| 11 | 800 shifts × 12 bidders | Completes promptly server-side | Minutes-long client loop, timeouts | **High** | Server batch (R3) |
| 12 | Employee has 2 WorkRights licenses | Visa flag resolved | `.maybeSingle()` throws → bidder aborted | **Medium** | `.limit(1)`/aggregate the flag |
| 13 | Fairness ledger call errors | Fall back, log, still fair-ish | Drops F3 ordering silently | **Medium** | Surface + degrade explicitly (R5) |
| 14 | Cancelled shift (S15) targeted | Rejected | Assigned over cancelled state | **High** | Guard `is_cancelled`/`deleted_at` (R1) |
| 15 | Network drop mid-loop | Resumable / recorded | Partial state, no record | **High** | Server txn + run record (R3/R5) |
| 16 | Two overlapping shifts, same sole bidder | At most one assigned | Possible both (timing) | **Medium** | Tentative-schedule accumulation server-side (R2/R3) |
| 17 | Bid placed during run | Considered next run | Inconsistent snapshot | **Low** | Snapshot at server txn start |
| 18 | Manager lacks rights but calls RPC | Denied | Thin RPC trusts client `p_user_id` | **High** | Authorize in SECURITY DEFINER + RLS |
| 19 | Winner already assigned elsewhere same time | Overlap blocked | Depends on fresh read timing | **Medium** | Server-side recheck under lock (R3) |
| 20 | Student-visa 48h breach | Blocked when enforced | Enforced (visa flag honored) ✓ | Low | Keep; cover in tests |
| 21 | Two clear bidders, one higher priority | Higher priority wins | First-by-order wins | **Medium** | Score among clear bidders (R2) |
| 22 | Shift reopened with stale accepted bids | Clean slate | Stale rows may pollute filter | **Medium** | Reset bids on unassign |
| 23 | Compliance engine throws for one bidder | Skip bidder, continue | `catch{}` marks whole shift failed | **Medium** | Per-bidder try/catch granularity |
| 24 | Toast says "assigned" but RPC no-op'd (D1) | Accurate count | Inflated assigned count | **Medium** | RPC returns rows-affected; count truth (R1) |
| 25 | Displaced winner (overwrite) | Notified of removal | No unassign notification | **Medium** | Emit unassign event on overwrite (R5) |
| 26 | Bidder’s existing shift query crosses orgs | Org-scoped | No org filter on existing query | **Low** | Add org scope |
| 27 | Very large bidder list per shift | Bounded work | Linear DB calls per bidder | **Medium** | Batch existing-shift fetch (R3) |
| 28 | Manager closes tab mid-run | Server finishes or clean abort | Loop dies, partial commits | **High** | Server-side execution (R3) |
| 29 | Daily/weekly hours breached only in aggregate | Caught | No final whole-schedule pass in prod | **Medium** | Port `finalValidate` (R2) |
| 30 | Same employee wins many shifts in one run | Fairness-capped | No per-run cap | **Medium** | Dynamic win penalty (R2) |
| 31 | RLS hides some of bidder's existing shifts | Full schedule seen | Compliance underestimates load | **High** | Evaluate under SECURITY DEFINER server-side (R3) |
| 32 | Audit/dispute: "why did X win?" | Answerable from log | No reasoning persisted | **High** | Decision audit record (R5) |

---

## 5. State Machine Review (Part 4)

### 5.1 Two state machines are conflated

**(a) Bid lifecycle** (`shift_bids.status`): `pending → accepted | rejected | withdrawn`.
**(b) Shift assignment FSM** (canonical S-states): the relevant slice is `S5 (Published+OnBidding) → S4 (Assigned)` via winner selection; `S8` close-bidding; `S5→S1` unpublish; emergency `S8/S15→S7`.

Auto-assign drives **both** but only writes (a)'s transitions and (b)'s S5→S4 — without validating that the shift is actually *in* S5.

### 5.2 Bid state diagram

```
        place bid            select winner
 (none) --------> pending ----------------> accepted
                    |   \                      ^
         withdraw   |    \  another wins        | (BUG: revived from
                    v     \---------------> rejected   withdrawn by RPC)
                withdrawn
                    |
       (BUG) RPC accepts by employee_id regardless of status
```

Mapping the prompt's requested states to this system:
- **Draft** → not modeled (a bid is created already-`pending`; there is no draft).
- **Submitted** → `pending`.
- **Eligible** → derived at evaluation time (compliance-clear); not persisted.
- **Assigned** → `accepted` + shift S4.
- **Accepted/Rejected** → `accepted`/`rejected`.
- **Cancelled** → `withdrawn` (employee) — there is no manager-cancel of a single bid.
- **Expired** → **not modeled** (no bid TTL).

### 5.3 Invalid transitions currently reachable

- `withdrawn → accepted` (RPC by-employee_id update). **Invalid; must be blocked.**
- `accepted → accepted` for an already-assigned shift via overwrite. **Invalid (no-op expected).**
- Shift `S15/cancelled → S4/assigned`, `deleted → S4`. **Invalid; no guard.**
- `S4 → S4` re-stamp (different winner) with no S5 precondition. **Invalid.**

### 5.4 Missing transitions

- No **bid expiry** (`pending → expired`) — stale bids never age out.
- No **eligibility** persisted state — recomputed every run, never cached/auditable.
- No **auto-assign "considered but skipped"** record per bid.

### 5.5 Recovery / rollback

- **None at run level.** Each RPC commits independently. There is no batch txn, no saved run, no compensating "undo this auto-assign run." Recommend a `bid_assignment_run` record (id, actor, started/finished, per-shift outcomes) that supports a one-click rollback that re-runs `sm_unassign_shift` for each shift assigned by that run (guarded by current state).

---

## 6. Auto-Approve Swap Requests — Product Design (Part 5)

### 6.1 Business goal & current baseline

Auto-approve eligible swaps to cut manager review load. Today swaps are **fully manual**: `acceptTrade` moves a swap to `MANAGER_PENDING` and `approveSwapRequest` re-runs compliance then commits via the `approve_trade` gateway op ([swaps.api.ts:641](../../src/modules/planning/swapping/api/swaps.api.ts#L641)). The swap state machine is `OPEN → MANAGER_PENDING → APPROVED | REJECTED | CANCELLED | EXPIRED`.

Auto-approve inserts an automated decision between `MANAGER_PENDING` and the terminal states — or, for high-confidence cases, directly from offer-acceptance — using the **existing constraint solver** (`swapEvaluator.evaluate`, already simultaneous on both parties) plus the swap guards (`runSwapGuards`) that already check entity validity, concurrency, locks, and drift.

> Design principle: **reuse the swap solver and guards that already exist; do not re-implement compliance.** The auto-approver is an orchestration + policy layer, not a new rule engine.

### 6.2 End-to-end workflow

```
Offer accepted by requester (sm_accept_trade) -> swap = MANAGER_PENDING
        |
        v
[Auto-Approve Evaluator]  (server, queued, idempotent)
        |
        | 1. Load swap + both shifts + both rosters (SECURITY DEFINER)
        | 2. runSwapGuards (entity/concurrency/lock/drift)  -- fail -> EXCEPTION
        | 3. Eligibility engine (configurable predicates)   -- fail -> route
        | 4. swapEvaluator.evaluate(A_new, B_new)           -- blocking -> route
        | 5. Approval decision matrix:
        |      AUTO_APPROVE | MANUAL_REVIEW | AUTO_REJECT
        v
   +----------------+----------------------+------------------+
   | AUTO_APPROVE   | MANUAL_REVIEW        | AUTO_REJECT      |
   | approve_trade  | stay MANAGER_PENDING | reject_trade     |
   | (gateway op)   | + flag for manager   | + reason         |
   +----------------+----------------------+------------------+
        |
        v
   Audit record + notifications (both parties, + manager on review/reject)
```

### 6.3 Eligibility engine — configurable rules

All rules are **org-configurable** with a global default and per-department override. Each rule has: `enabled`, `mode ∈ {REQUIRE_EQUAL, AUTO_REJECT_IF_FAIL, ROUTE_TO_REVIEW_IF_FAIL, IGNORE}`, and optional parameters.

| Rule | Configurable? | Default | Rationale |
|---|---|---|---|
| Same role | Yes | REQUIRE_EQUAL | Coverage integrity; differing roles change skill coverage. |
| Same skill level | Yes | ROUTE_TO_REVIEW | Often acceptable ±1 band; manager judges. |
| Same location/site | Yes | REQUIRE_EQUAL | Travel/coverage; cross-site usually needs review. |
| Same shift duration | Yes | ROUTE_TO_REVIEW (tolerance ±X min) | Minor diffs fine; large diffs affect payroll/coverage. |
| Same pay rate | Yes | ROUTE_TO_REVIEW | Payroll impact — see §6.7 risks. |
| Certification requirements | Yes | AUTO_REJECT_IF_FAIL | Hard legal/safety gate; never auto-approve uncertified. |
| Compliance (solver blocking) | **No (always on)** | AUTO_REJECT_IF_FAIL | Non-negotiable labor-law gate. |
| Max swap distance (time apart of the two shifts) | Yes | IGNORE | Optional anti-abuse / coverage smoothing. |
| Availability validation | Yes | AUTO_REJECT_IF_FAIL | Can't work when unavailable. |
| Existing schedule conflicts (overlap) | **No (always on)** | AUTO_REJECT_IF_FAIL | Double-booking. |
| Overtime constraints | Yes | ROUTE_TO_REVIEW | Cost control; sometimes allowed. |
| Fatigue rules (rest gap, consecutive days) | **No (always on)** | AUTO_REJECT_IF_FAIL | Safety. |
| Team coverage requirements (min staffing post-swap) | Yes | ROUTE_TO_REVIEW | Coverage floor. |
| Time-lock (≥4h to both shifts) | **No (always on)** | AUTO_REJECT_IF_FAIL | Mirrors existing `assertNotTimeLocked`. |

**Why configurable vs fixed:** legal/safety constraints (compliance, fatigue, certification, overlap, time-lock) must never be operator-disabled — making them configurable is itself a compliance risk. Everything else is an operational-policy choice that legitimately varies by org/department, so it must be configurable to be adopted.

### 6.4 Approval logic — decision matrix

Let `G` = guards, `E` = eligibility predicates, `C` = solver result.

| Guards | Eligibility | Solver | Decision |
|---|---|---|---|
| Fail | — | — | **AUTO_REJECT** (stale/drifted/locked/concurrent) |
| Pass | Any REQUIRE_EQUAL fails | — | **AUTO_REJECT** |
| Pass | Any AUTO_REJECT_IF_FAIL rule fails | — | **AUTO_REJECT** |
| Pass | All pass, no review flags | BLOCKING | **AUTO_REJECT** |
| Pass | Any ROUTE_TO_REVIEW rule flagged | PASS/WARNING | **MANUAL_REVIEW** |
| Pass | All pass | WARNING | **MANUAL_REVIEW** (default) or AUTO_APPROVE if `auto_approve_warnings=true` |
| Pass | All pass | PASS | **AUTO_APPROVE** |

Plus a **confidence threshold** + **org kill-switch** + **rate limit** (max N auto-approvals/employee/period) gating any AUTO_APPROVE.

### 6.5 Exception handling

- Guard failure (drift, concurrency, lock) → AUTO_REJECT with machine-readable reason; both parties notified; swap returns to a safe state.
- Solver/engine throw → fail **closed**: route to MANUAL_REVIEW, never auto-approve on error.
- Data load failure → retry with backoff (queue); after max retries → MANUAL_REVIEW.
- Partial/multi-offer swaps → only the *selected* offer (after `sm_accept_trade`) is auto-evaluated; other offers already rejected by that RPC.

### 6.6 Audit, notifications, overrides, rollback

- **Audit:** one immutable `swap_auto_decision` row per evaluation (inputs snapshot, guard results, eligibility results, solver verdict, decision, config-version, engine-version, idempotency key, actor=`system`).
- **Notifications:** approve → both parties; review → manager + both parties ("pending review"); reject → both parties with reason.
- **Admin overrides:** (a) global + per-dept kill-switch; (b) per-rule config; (c) "shadow mode" (decide + log, don't act) for rollout; (d) manual override of any auto-decision while shift not yet started.
- **Rollback:** because approval routes through the existing `approve_trade` gateway op (version-CAS + reversible reassignment), an admin "revert swap" performs the inverse reassignment guarded by current state; the auto-decision row records enough to drive it. Time-locked once any involved shift is <4h or started.

### 6.7 Risk analysis

- **Operational:** auto-approving a coverage-degrading swap (both qualified, but team left short). → team-coverage rule + shadow mode.
- **Compliance:** auto-approving a fatigue/cert breach. → those rules are always-on, fail-closed.
- **Payroll:** swap changes pay rate / creates OT silently. → pay-rate + OT rules default to review; emit payroll-delta in audit.
- **Scheduling:** drift between evaluation and commit. → `runSwapGuards` drift check + version-CAS in gateway (already present).
- **Security:** forged auto-approve, or employee gaming auto-approve to dodge manager scrutiny. → server-only, SECURITY DEFINER, rate limits, anomaly alerts, full audit.
- **Abuse vectors:** collusive swap rings to engineer favorable schedules / avoid unpopular shifts; "swap to a friend then swap back" laundering. → max-swaps-per-period, cycle detection, manager spot-review sampling even on auto-approved.

### 6.8 Edge cases

- Simultaneous swap requests touching a shared shift → guard/concurrency + per-shift advisory lock; first commit wins, others re-evaluated/rejected.
- Multi-person chains (A→B→C) → **out of scope for v1** (engine is two-way only); detect and route to review.
- Withdrawn request mid-evaluation → idempotency + state check: if no longer MANAGER_PENDING, no-op.
- User deactivation mid-flow → eligibility availability check fails → reject/review.
- Schedule change during review → drift guard catches at commit; re-evaluate.
- Expired swap → `EXPIRED` terminal; auto-approver skips.
- Conflicting swaps → advisory lock + post-commit re-validation of the loser.
- Partial approvals → not allowed; a swap is atomic (both legs or none).
- Emergency override → admin can force approve/reject bypassing auto policy, fully audited.

---

## 7. System Architecture (Part 5 cont.)

```
            offer accepted (sm_accept_trade) → status MANAGER_PENDING
                              │  (DB trigger / outbox)
                              ▼
                      [Auto-Approve Queue]   (durable, at-least-once)
                              │  worker pulls job {swap_id, idempotency_key}
                              ▼
   ┌───────────────────────── Auto-Approve Worker (server) ─────────────────────────┐
   │ load swap+shifts+rosters (SECURITY DEFINER)                                     │
   │ runSwapGuards ──▶ swapEvaluator.evaluate ──▶ eligibility ──▶ decision matrix    │
   │ within one DB txn: write audit row, then dispatch terminal op                   │
   │   AUTO_APPROVE → applyShiftOp(approve_trade, version-CAS)                        │
   │   AUTO_REJECT  → applyShiftOp(reject_trade)                                      │
   │   MANUAL_REVIEW→ set review_flag, leave MANAGER_PENDING                          │
   └────────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  notifications + metrics + (shadow vs live)
```

- **Transaction boundaries:** guards+eval are read-only; the *decision commit* (audit row + gateway op) is one transaction with the requester shift row locked (version-CAS already does optimistic locking). Eligibility/solver run outside the lock; the gateway op re-checks version on commit, so a drift between eval and commit fails the CAS and re-queues.
- **Idempotency:** `idempotency_key = hash(swap_id, requester_shift_version, offered_shift_version, config_version)`. Worker upserts the audit row on this key; duplicate delivery → no-op.
- **Queue:** at-least-once with idempotency; DLQ after max retries → forces MANUAL_REVIEW.

---

## 8. State Diagrams (Part 5 cont.)

```
Swap request (extended with auto-approve):

 OPEN ──accept offer──▶ MANAGER_PENDING ──▶ [AUTO-APPROVE EVALUATOR]
   │                          │                     │
 cancel                   manual approve            ├─ AUTO_APPROVE ─▶ APPROVED
   ▼                          ▼                     ├─ AUTO_REJECT  ─▶ REJECTED
 CANCELLED                 APPROVED                 └─ MANUAL_REVIEW ─▶ (stays MANAGER_PENDING, review_flag=true)
                                                                          │
                                            expiry ──────────────────────┴────▶ EXPIRED
```

Decision sub-states (audit only, not persisted on swap): `EVALUATING → DECIDED(approve|reject|review) → COMMITTED | CAS_RETRY | DLQ_REVIEW`.

---

## 9. Database Design (Part 5 cont.)

```sql
-- Org/department policy
create table swap_auto_policy (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  department_id   uuid null references departments(id),       -- null = org default
  enabled         boolean not null default false,             -- live vs off
  shadow_mode     boolean not null default true,              -- decide+log, don't act
  auto_approve_warnings boolean not null default false,
  confidence_min  numeric not null default 1.0,
  max_auto_per_employee_per_week int not null default 3,
  rules           jsonb not null default '{}'::jsonb,         -- per-rule {enabled,mode,params}
  version         int not null default 1,
  updated_by      uuid, updated_at timestamptz default now(),
  unique (organization_id, department_id)
);

-- Immutable decision audit (one per evaluation)
create table swap_auto_decision (
  id               uuid primary key default gen_random_uuid(),
  swap_id          uuid not null references shift_swaps(id),
  idempotency_key  text not null unique,
  decision         text not null check (decision in ('AUTO_APPROVE','AUTO_REJECT','MANUAL_REVIEW')),
  guard_result     jsonb not null,
  eligibility_result jsonb not null,
  solver_result    jsonb not null,
  reason           text,
  policy_version   int not null,
  engine_version   text not null,
  requester_shift_version int,
  offered_shift_version  int,
  committed        boolean not null default false,
  created_at       timestamptz not null default now()
);
create index on swap_auto_decision (swap_id);

-- Optional run grouping for rollback/analytics
alter table shift_swaps add column review_flag boolean default false;
alter table shift_swaps add column auto_decision_id uuid references swap_auto_decision(id);
```

Mirror for bidding (R5): a `bid_assignment_run` + `bid_assignment_decision` pair to give auto-assign the audit + rollback it currently lacks.

---

## 10. API Design (Part 5 cont.)

| Endpoint / RPC | Purpose | Notes |
|---|---|---|
| `POST /swaps/auto-evaluate` (or `enqueue_swap_auto_decision(swap_id)` trigger) | Enqueue a MANAGER_PENDING swap for auto decision | Idempotent on key |
| `sm_swap_auto_decide(p_swap_id, p_idempotency_key)` SECURITY DEFINER | Worker entry: guards+eligibility+solver+commit | Single txn for audit+gateway op |
| `applyShiftOp(approve_trade \| reject_trade)` (existing) | Terminal commit | version-CAS reused |
| `GET /swaps/:id/auto-decision` | Fetch decision + reasoning for UI | Powers transparency panel |
| `PUT /org/:id/swap-auto-policy` | Admin config (rules, kill-switch, shadow) | RBAC: org admin only |
| `POST /swaps/:id/override` | Admin force approve/reject | Audited, time-lock guarded |
| `POST /swaps/auto-decision/:id/revert` | Rollback an auto-approval | Guarded by current state + time-lock |

Bidding parity: `sm_auto_assign_bids(p_scope, p_idempotency_key)` SECURITY DEFINER server function replacing the client loop (R3).

---

## 11. QA Test Matrix (Part 5 cont.) — 54 cases

**Unit — eligibility engine (1–12)**
1. Same-role REQUIRE_EQUAL pass. 2. Same-role fail → AUTO_REJECT. 3. Skill ±1 → REVIEW. 4. Location mismatch → REJECT (configured). 5. Duration within tolerance → pass. 6. Duration over tolerance → REVIEW. 7. Pay-rate diff → REVIEW + payroll delta in audit. 8. Missing cert → AUTO_REJECT (always-on). 9. Max-distance exceeded → behavior per config. 10. Availability fail → REJECT. 11. Overtime → REVIEW. 12. Rule disabled → IGNORE has no effect.

**Unit — decision matrix (13–20)**
13. Guards fail ⇒ REJECT regardless. 14. Solver BLOCKING ⇒ REJECT. 15. Solver WARNING + auto_approve_warnings=false ⇒ REVIEW. 16. Solver WARNING + true ⇒ APPROVE. 17. All pass + PASS ⇒ APPROVE. 18. Confidence below min ⇒ REVIEW. 19. Rate limit hit ⇒ REVIEW. 20. Kill-switch off ⇒ no auto action (shadow logs only).

**Unit — fail-closed (21–24)**
21. Solver throws ⇒ REVIEW. 22. Roster load error ⇒ retry then REVIEW. 23. Null offered shift ⇒ REVIEW/REJECT, never APPROVE. 24. Policy row missing ⇒ treat as disabled.

**Integration (25–34)**
25. MANAGER_PENDING → APPROVE commits via approve_trade. 26. → REJECT via reject_trade reverts both shifts to NoTrade. 27. → REVIEW leaves MANAGER_PENDING + review_flag. 28. Audit row written exactly once per key. 29. Notifications fire to both parties on each terminal decision. 30. Shadow mode: decision logged, no shift change. 31. Override approve bypasses policy, audited. 32. Revert restores prior assignment. 33. Per-dept override beats org default. 34. Engine/policy version stamped on audit.

**Concurrency (35–42)**
35. Duplicate queue delivery ⇒ single commit (idempotency). 36. Two swaps sharing a shift ⇒ one commits, other CAS-fails → re-eval. 37. Drift between eval and commit ⇒ CAS fail ⇒ re-queue. 38. Withdrawn mid-eval ⇒ no-op. 39. Concurrent manual approve + auto ⇒ one wins, audit consistent. 40. Deactivation mid-eval ⇒ REVIEW/REJECT. 41. Shift edit mid-eval ⇒ drift guard catches. 42. Expiry during queue wait ⇒ skipped as EXPIRED.

**Load (43–46)**
43. 5,000 MANAGER_PENDING swaps drain within SLA. 44. Worker horizontal scale, no double-commit. 45. DLQ routes to REVIEW after max retries. 46. p95 decision latency under threshold.

**Failure recovery (47–50)**
47. Worker crash mid-txn ⇒ no partial commit (audit+op atomic). 48. Queue redelivery after crash ⇒ idempotent. 49. DB failover mid-run ⇒ resume from queue. 50. Config change mid-flight ⇒ in-flight uses snapshotted policy_version.

**Bidding-parity regression (51–54)** — guard against the audited prod bugs reappearing:
51. `sm_select_bid_winner` rejects already-assigned shift. 52. Rejects shift with TTS<4h. 53. Rejects winner without a `pending` bid (no withdrawn revival). 54. Auto-assign enforces required_qualifications (unqualified bidder skipped).

---

## 12. Recommended Implementation Roadmap

Each item: **Why / Problem solved / Complexity / Risk if skipped.**

### Phase 0 — Stop the bleeding (auto-assign integrity) — ~1 sprint
- **R1 — Harden `sm_select_bid_winner`** (FOUND check, FSM-state guard = must be S5/unassigned/not cancelled/not deleted, validate winner has a `pending` bid, enforce TTS≥4h, return rows-affected).
  *Why:* it is the single chokepoint for every auto + manual assignment. *Problem solved:* double-assignment, ghost-assignment, withdrawn-revival, window-lock bypass, inflated counts. *Complexity:* Low (one PL/pgSQL function + tests). *Risk if skipped:* Critical data-integrity and compliance defects remain in production.
- **R4 — Real qualifications in auto-assign compliance input.**
  *Why:* prevents unqualified/uncertified assignment. *Problem solved:* auto vs manual criteria divergence. *Complexity:* Low–Med (thread role/quals into `buildBidInput`). *Risk:* legal/safety exposure.
- **R6 — Explicit warning policy in auto-assign.**
  *Why:* governance parity. *Complexity:* Low. *Risk:* silent risky assignments.

### Phase 1 — Server-side + audit — ~1–2 sprints
- **R3 — Move auto-assign to a SECURITY DEFINER server function / edge worker** with snapshot + per-shift state-guarded commit.
  *Why:* removes TOCTOU, N×M client round-trips, RLS-blind compliance, client-trust. *Complexity:* Med–High. *Risk:* scalability + race failures persist.
- **R5 — Decision audit + rollback records** for both bidding and swaps.
  *Why:* transparency, disputes, fairness defense, undo. *Complexity:* Med. *Risk:* unanswerable audits, no recovery.

### Phase 2 — Converge engines — ~2 sprints
- **R2 — Adopt the global `runBidSelection` engine** behind the server function (or formally retire it).
  *Why:* restores global optimality, fairness ledger, final-validation safety net, deterministic tie-breaks. *Complexity:* Med (wire + port to server). *Risk:* two-lineages drift keeps growing (it already mirrors the recorded shift-FSM split).

### Phase 3 — Auto-Approve Swaps — ~3–4 sprints
- Ship behind **shadow mode** first (decide+log only), then per-dept enable, then org enable.
  *Why:* swaps already have the solver + guards + reversible gateway op — the missing pieces are policy, queue, audit, and rollout safety. *Complexity:* Med–High. *Risk if skipped:* manual review load remains; but shipping without shadow mode risks silent bad approvals — so shadow-first is mandatory.

---

## 13. Verification notes

- Production auto-assign confirmed at [OpenBidsView/index.tsx:794-990](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L794); button wiring at [ManagerBids.page.tsx:84-120](../../src/modules/planning/bidding/ui/pages/ManagerBids.page.tsx#L84).
- `runBidSelection` engine confirmed present and **unreferenced** outside its module ([index.ts](../../src/modules/compliance/v8/orchestrator/bidding/index.ts)).
- `sm_select_bid_winner` baseline body inspected in [20251015000000_baseline_schema.sql](../../supabase/migrations/20251015000000_baseline_schema.sql): `FOR UPDATE` present, but no FOUND/FSM/winner-bid/TTS gates.
- Swap manual path + solver + guards confirmed at [swaps.api.ts:45-101,641-738](../../src/modules/planning/swapping/api/swaps.api.ts#L45).
- This document is an audit/design artifact only; no application code was modified.
