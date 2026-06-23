# 03 — Testing Strategy (Auto-Assign Bids refactor + Auto-Approve Swaps)

**Status:** Authoritative QA plan. Binds to [00-contracts-and-conventions.md](00-contracts-and-conventions.md) (canonical names, enums §6, idempotency §5, gateway contract §2), [01-auto-assign-bids-refactor.md](01-auto-assign-bids-refactor.md) (the 10 mandatory fixes §3, fairness §4, concurrency §5, API §8, rollback §9), [02-auto-approve-swaps.md](02-auto-approve-swaps.md) (decision matrix §2, eligibility §3, abuse prevention §4, queue §1.2), and the [audit](../audits/auto-assign-bids-audit-and-auto-approve-swaps-design.md) (§3 logical audit, §4 32-row failure table, §11 existing 54 cases). This document **extends** the audit's 54 cases — it does not duplicate them verbatim.

**Scope of binding-doc corrections honoured here:** per 01 §"Binding-doc corrections", the gateway is `sm_apply_shift_op(p_shift_id, p_expected_version, p_op, p_payload, p_idempotency_key uuid)` with **no `p_actor`** (actor = `auth.uid()`), `get_shift_fsm_state` is **6-arg** (incl. `bidding_status`), `select_winner` is legal at **S5/S6 only**, and the gateway idempotency key is a **uuid** matched against `shift_events.metadata->>'idem'`. All test expectations below use those corrected forms.

**Total test cases in this document: 180** (IDs `AU-*`, `MF-*`, `SE-*`, `DM-*`, `IA-*`, `IS-*`, `CC-*`, `SEC-*`, `LS-*`, `FR-*`). Minimum-count floors per group are all exceeded.

---

## 0. Test pyramid, tooling, and harness conventions

### 0.1 Pyramid

```
            ╱╲          Load/Scale (LS-*)  + Failure-recovery (FR-*)   — 18 cases  P0/P1
           ╱  ╲         run on a dedicated Supabase test project + k6/autocannon
          ╱----╲        Security (SEC-*) + Concurrency (CC-*)          — 22 cases  P0
         ╱      ╲       integration against the test project + pgTAP for SQL races
        ╱--------╲      Integration (IA-* bids, IS-* swaps)            — 20 cases  P0/P1
       ╱          ╲     Edge Function ↔ gateway ↔ audit tables, real Postgres
      ╱------------╲    Unit (AU-*, MF-*, SE-*, DM-*)                  — 72 cases  P0
     ╱______________╲   vitest, pure functions, in-memory, deterministic, no I/O
```

The base is broad and cheap: the **decision brain is pure** by design (`runBidSelection`/`selectBids`/`scoreAllBids` are pure — [01 §1.2](01-auto-assign-bids-refactor.md); `evaluateEligibility` is "a deterministic pure function" — [02 §3](02-auto-approve-swaps.md)). Almost every fairness/scoring/eligibility/matrix guarantee is therefore a **vitest unit** with no database. Concurrency, RLS, SECURITY-DEFINER authz, and the queue need a **real Postgres** (the test Supabase project) and **pgTAP** for the SQL-level race/guard assertions. Load lives at the apex.

### 0.2 Test runners & where each layer runs

| Layer | Runner | Target | Notes |
|---|---|---|---|
| Unit (AU/MF/SE/DM) | **vitest** (`npm run test` → `vitest run`, [package.json](../../package.json)) | in-memory | Matches existing `src/modules/**/__tests__/*.test.ts` style ([shift-op-legality.test.ts](../../src/modules/rosters/domain/__tests__/shift-op-legality.test.ts), [fairness-ledger.test.ts](../../src/modules/rosters/domain/__tests__/fairness-ledger.test.ts)). `describe`/`it`/`expect`, pure imports. **ESLint is broken in this repo — gates are `tsc --noEmit` + `vitest` + `build`** (project memory). |
| Integration (IA/IS) | **vitest** + `@supabase/supabase-js` (service-role + a seeded manager JWT) | **Supabase test project** (a *branch* of prod created via `mcp__supabase__create_branch`, never prod `srfozdlphoempdattvtx`) | The Edge Functions `auto-assign-bids` / `auto-approve-swaps` are deployed to the test branch; tests invoke them with `functions.invoke` and assert on `assignment_*`/`swap_*` rows + shift `version`/state. |
| SQL guards & races (CC/SEC SQL rows) | **pgTAP** (`pgtap` extension; run with `pg_prove`) | test branch | One `.sql` file per RPC: `sm_apply_shift_op`, the hardened `sm_select_bid_winner`, `sm_assignment_run_rollback`, `sm_swap_auto_decide`, `enqueue_swap_auto_decision`. pgTAP gives transactional `SELECT throws_ok/results_eq/is` assertions and lets two sessions race inside `BEGIN` blocks. No pgTAP exists in the repo yet — this plan introduces `supabase/tests/` as the home for it. |
| Load (LS) | **k6** (HTTP, for Edge invocations) + a SQL seed script | test branch sized to prod-like volume | p95 latency, queue drain time, DLQ rate. |

### 0.3 Faking the clock for TTS (the 4h lock)

The 4h time-lock (`tts_seconds = EXTRACT(EPOCH FROM (scheduled_start - now()))`, [00 §3](00-contracts-and-conventions.md)) is tested **two ways**:

- **Unit / TS side** — mock `Date.now` exactly as the existing suites do ([bidding-urgency.test.ts:23](../../src/modules/rosters/domain/__tests__/bidding-urgency.test.ts)): `vi.spyOn(Date, 'now').mockReturnValue(...)` then `vi.restoreAllMocks()` in `afterEach`. Engine-side TTS checks (the eligibility 4h rule §3, the engine's `SKIPPED_LOCKED` mapping) are unit-tested by constructing shift `scheduled_start` relative to a frozen `Date.now`.
- **SQL / gateway side** — the gateway/RPC reads `NOW()`, which a unit cannot mock. Instead **seed `scheduled_start` relative to real `now()`**: a shift "3h out" is `create_test_shift('S5', 0, …)` with the row's `scheduled_start` `UPDATE`d to `now() + interval '3 hours'`; a shift "safely out" uses `now() + interval '30 hours'`. pgTAP asserts the RPC returns `SHIFT_TIME_LOCKED` / proceeds accordingly. (Do **not** mutate the DB clock; relative-to-`now()` seeding is deterministic and parallel-safe.)

### 0.4 Seeding FSM states with the existing baseline helper

The baseline ships `public.create_test_shift(p_state text, p_days_ahead int, p_employee_id uuid DEFAULT NULL)` ([baseline:5203](../../supabase/migrations/20251015000000_baseline_schema.sql#L5203)) which inserts a shift directly in a canonical S-state into the `__TEST_STATE_MACHINE__` roster, and `cleanup_test_shifts()` ([baseline:4386](../../supabase/migrations/20251015000000_baseline_schema.sql#L4386)) to tear down. **Supported states: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S15** (verified in the `CASE`). Conventions for this plan:

- **Open-for-bidding** shifts = `create_test_shift('S5', d)` (`on_bidding_normal`) and `create_test_shift('S6', d)` (`on_bidding_urgent`) — the only two states where `select_winner` is legal.
- The helper does **not** insert `shift_bids` — each test inserts its own pending bids against the returned `shift_id` so the winner-pending rule (Fix 3 / §3.3) and qual/role data are controllable.
- Already-assigned = `S4`, cancelled = `S15`, bidding-closed = `S8` — these drive the FSM-illegal negative cases (Fix 1 / §3.1).
- TTS variants: take the helper's shift_id then `UPDATE shifts SET scheduled_start = now() + interval '<n> hours'` (see §0.3).
- For swaps: build two `S4` shifts assigned to two different employees, insert a `shift_swaps` row, then drive it to `MANAGER_PENDING` via `sm_accept_trade` ([swaps.api.ts:853](../../src/modules/planning/swapping/api/swaps.api.ts#L853)) so the enqueue trigger fires for real (IS-/CC- integration cases).
- Every integration/pgTAP test wraps its body so `cleanup_test_shifts()` (and explicit `DELETE` of seeded `shift_bids`/`shift_swaps`/`assignment_*`/`swap_*`) runs in teardown; pgTAP tests run inside a `BEGIN; … ROLLBACK;` where isolation allows.

### 0.5 Determinism contract (applies to every unit case)

Per [01 §4.4](01-auto-assign-bids-refactor.md) the brain is a pure function with a total tie-break order (`composite_score` desc → `bid_time` asc → `bid_id` asc). **Every unit test asserting selection runs the engine twice on the same input and asserts byte-identical output** (`expect(run()).toEqual(run())`) in addition to its value assertion. This is the structural guard against the "two lineages" drift the audit warns about (§1).

### 0.6 Priority tags

P0 = correctness/safety blocker (must pass before any auto action is trusted in prod). P1 = SSoT/audit/scale. P2 = optimization/fancy fairness/queue fan-out. Tags are per-group in each section header and per-row where a row diverges from its group.

---

## 1. Unit — Auto-Assign fairness / scoring / tie-break / win-cap / anti-gaming  (`AU-*`)  **[P0–P2]**

Targets the pure brain: [scorer.ts:139 `scoreAllBids`](../../src/modules/compliance/v8/orchestrator/bidding/scorer.ts#L139), [selection-engine.ts:119 `selectBids`](../../src/modules/compliance/v8/orchestrator/bidding/selection-engine.ts#L119), [bidding/index.ts:147 `runBidSelection`](../../src/modules/compliance/v8/orchestrator/bidding/index.ts#L147). Weights are the binding `.40/.30/.20/.10` ([01 §4.1](01-auto-assign-bids-refactor.md), [types.ts:95](../../src/modules/compliance/v8/orchestrator/bidding/types.ts#L95)). No DB.

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| AU-01 | Composite weight formula | 1 shift, 1 bidder, compliance=PASS(1.0), priority=50, fairness=1.0, recency=1.0 | `scoreAllBids` | `composite_score == 100·(0.40·1 + 0.30·0.5 + 0.20·1 + 0.10·1) == 85.0` | 01 §4.1 / contract weights |
| AU-02 | Compliance dominates over recency | bidder A: PASS but latest bid; bidder B: WARNING but earliest | `selectBids` | A wins (0.40·1 > 0.40·0.5 + 0.10 recency edge) | 01 §4.1 / audit B1 |
| AU-03 | WARNING scores 0.5 not 0 | bidder with one WARNING hit, no blocking | `scoreAllBids` | compliance component = 0.5, bidder still selectable | 01 §4.1 |
| AU-04 | BLOCKING excludes bidder | bidder with a BLOCKING hit | `selectBids` | bidder never selected; compliance_score 0.0; shift may go unfilled | 01 §4.1 / Fix 4 |
| AU-05 | Priority after F3 boost | base_priority 50, F3 debt 5 (saturation) | `scoreAllBids` with F3 | `priority' = clamp(0.5 + 0.25·1, 0,1) = 0.75`; recorded `priority_boost` | 01 §4.2 |
| AU-06 | F3 debt normalisation clamp | debt 12 (> DEBT_SATURATION 5) | apply F3 | `debt_norm == 1.0` (clamped), not >1 | 01 §4.2 |
| AU-07 | F3 ledger failure → explicit degrade | ledger throws | run engine | falls back to base_priority, sets `f3_degraded=true` on run, does not crash | 01 §4.2 / audit F4 / failure #13 |
| AU-08 | Static bulk-bidder penalty | emp X bid on 1 shift (min), emp Y bid on 10 (max) | `scoreAllBids` | X fairness=1.0, Y fairness=0.0 | 01 §4.3 / audit F2 |
| AU-09 | Tie-break 1: composite desc | two bidders, scores 87.4 vs 81.0 | `selectBids` | 87.4 wins | 01 §4.4(1) |
| AU-10 | Tie-break 2: equal score → earlier bid_time | identical composite, bid_time A<B | `selectBids` | A wins (FCFS) | 01 §4.4(2) |
| AU-11 | Tie-break 3: equal score & time → lower bid_id | identical composite & bid_time | `selectBids` | lower `bid_id` wins; total order guarantees determinism | 01 §4.4(3) |
| AU-12 | Determinism: identical input → identical output | any non-trivial bid set | run `runBidSelection` twice | `toEqual` byte-identical (selected, rejected, unfilled) | 01 §4.4 / §0.5 |
| AU-13 | Soft win penalty after SOFT_CAP | emp already won 2 this run (SOFT_CAP=1) | score next bid | `effective_score -= 15·(2−1) = 15`; recorded `win_penalty` | 01 §4.5 |
| AU-14 | Hard win cap excludes further bids | emp at `max_wins_per_employee=3` | `selectBids` | further bids of that emp excluded entirely; `capped=true` recorded | 01 §4.5 / audit row 30 |
| AU-15 | Global optimum beats per-shift greedy | sole viable bidder for shift B also clears shift A (earlier) | `runBidSelection` | B filled (engine does not let A consume B's only candidate) | 01 §1.2 / audit B1 / failure #9 |
| AU-16 | Anti-gaming: bid-early does not auto-win | early bidder lower composite than late bidder | `selectBids` | late higher-composite bidder wins; recency only 0.10 | 01 §4.6 / audit F-1/F-2 |
| AU-17 | Anti-gaming: spray-bidding penalised | one emp sprays bids on all shifts | `runBidSelection` | bulk-bidder fairness penalty lowers their per-shift score | 01 §4.6 / audit B3 |
| AU-18 | `accept_warnings=false` default | WARNING-only winner candidate, default options | `runBidSelection` | (engine still scores 0.5) — assert the run's `options.accept_warnings===false` is recorded | 01 §3 Fix(R6) / §2.4(D) |
| AU-19 | Weights sum to 1.0 invariant | `DEFAULT_BIDDING_CONFIG` | inspect config | `0.40+0.30+0.20+0.10 === 1.0` | 01 §4.1 / types.ts:95 |
| AU-20 | `finalValidate` whole-schedule pass catches aggregate breach | two singly-OK picks that jointly breach weekly hours | `runBidSelection` | one pick demoted to unfilled/skip by final pass | 01 §1.2 / audit #29 |

---

## 2. Unit — Auto-Assign mandatory fixes 1–10  (`MF-*`)  **[P0–P1]**

Each fix from [01 §3](01-auto-assign-bids-refactor.md). FSM/TTS/winner-pending/qual/role/scope/concurrency/idempotency rows that are SQL-enforced are asserted at the **pure decision layer** here (the engine's mapping of gateway result-codes to outcome enums per [01 §2.4 `commitWinnerWithRetry`](01-auto-assign-bids-refactor.md)) and re-asserted end-to-end in §5 (IA) / §7 (CC) / pgTAP.

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| MF-01 | Fix1 FSM: S5/S6 only are select_winner-legal | engine result mapper sees `ILLEGAL_TRANSITION` | map result | outcome `SKIPPED_BLOCKED` | Fix 1 (§3.1) / 00 §2 |
| MF-02 | Fix1 FSM: gone shift → SKIPPED_BLOCKED | gateway returns `GONE` (deleted/cancelled) | map result | `SKIPPED_BLOCKED`, no crash | Fix 1 / audit #3,#14 |
| MF-03 | Fix1 FSM: S4 already-assigned not re-stamped | candidate shift state S4 in snapshot | engine pre-filter | shift excluded from open set | Fix 1 / audit row 1 |
| MF-04 | Fix2 TTS: <4h → SKIPPED_LOCKED | gateway returns `WRITE_REJECTED / SHIFT_TIME_LOCKED` | map result | outcome `SKIPPED_LOCKED` | Fix 2 (§3.2) / audit #5 |
| MF-05 | Fix2 TTS: exactly 4h boundary allowed | `scheduled_start - now()` == 4h00m00s | TTS predicate | not locked (`<` strict) | Fix 2 / 00 §3 |
| MF-06 | Fix2 TTS: 3h59m → locked | TTS = 3h59m | TTS predicate | locked | Fix 2 |
| MF-07 | Fix3 winner-pending: withdrawn not revived | gateway returns `WRITE_REJECTED / WINNER_NOT_PENDING` | map result | `SKIPPED_NO_ELIGIBLE`; no `withdrawn→accepted` | Fix 3 (§3.3) / audit #4 / FSM 5.3 |
| MF-08 | Fix3 winner-pending: next-ranked retried next run | winner not pending | engine | shift left for next snapshot with next bidder | Fix 3 / §3.3 |
| MF-09 | Fix4 qual: required_qualifications populated, not [] | shift has `required_licenses`/`required_skills` | `toV8Shift` | `required_qualifications` non-empty (union of both) | Fix 4 (§3.4) / audit #6 / failure-table |
| MF-10 | Fix4 qual: unqualified bidder is BLOCKING | bidder missing a required cert | `runV8Orchestrator` via input | bidder excluded (BLOCKING), matches manual path | Fix 4 / audit B5/F5 |
| MF-11 | Fix5 role: candidate role_id threaded | shift `role_id` present | `toV8Shift` | `role_id` set (not '') | Fix 5 (§3.5) |
| MF-12 | Fix5 role: bidder not contracted for role → BLOCKING | bidder `assigned_role_ids` excludes shift role | engine | bidder excluded | Fix 5 / audit row 6 |
| MF-13 | Fix5 role: existing shifts carry real role_id | bidder existing shifts mapped | snapshot map | each existing shift `role_id` populated (cross-shift role rules can fire) | Fix 5 / §3.5 |
| MF-14 | Fix6 scope: existing-shift query org-filtered | bidder has shifts in another org | snapshot builder | cross-org shifts excluded; load measured correctly | Fix 6 (§3.6) / audit row 26 |
| MF-15 | Fix6 scope: visa flag aggregated, not maybeSingle | bidder has 2 WorkRights licenses | context build | `bool_or` aggregates; no throw | Fix 6 / audit S3 / failure #12 |
| MF-16 | Fix7 concurrency: VERSION_CONFLICT re-decide on still-open | conflict, current_state still S5 | retry wrapper | retries CAS at new version | Fix 7 (§3.7) / 01 §5.3 |
| MF-17 | Fix7 concurrency: VERSION_CONFLICT on now-filled → skip | conflict, current_state S4 | retry wrapper | `SKIPPED_BLOCKED`, no retry | Fix 7 / 01 §5.3 / audit row 1/2/19 |
| MF-18 | Fix7 concurrency: retries bounded to MAX=3 | persistent conflict | retry wrapper | after 3 → `CONFLICT_RETRY`, shift left open | Fix 7 / 01 §5.3 |
| MF-19 | Fix7 backoff schedule | attempts 0/1/2 | backoff fn | ≈50/100/200 ms ± jitter, monotonic | Fix 7 / 01 §5.3 |
| MF-20 | Fix8 idempotency key derivation | run_id, shift_id | `uuidv5(run:shift, NS)` | deterministic; same inputs → same uuid | Fix 8 (§3.8) / 00 §5 |
| MF-21 | Fix8 idempotency: human key stored too | decision row | persist | `idempotency_key text == run_id||':'||shift_id`, 1:1 with uuid | Fix 8 / 00 §5 |
| MF-22 | Fix8 idempotency: replay → IDEMPOTENT_REPLAY counts as ASSIGNED | gateway returns `IDEMPOTENT_REPLAY` | map result | outcome `ASSIGNED`, no double write | Fix 8 / audit #10 |
| MF-23 | Fix9 audit: decision row shape complete | a committed winner | `writeDecision` | row has winner, ordered runners_up, reason, rule_hits, composite_score, outcome, engine/policy version, version_before/after | Fix 9 (§3.9) / audit #32 |
| MF-24 | Fix9 audit: runners_up ordered desc | 3 bidders | `rankedRunnersUp` | ordered by composite_score desc | Fix 9 / 01 §7.2 |
| MF-25 | Fix10 notify: run-level summary to manager | run finishes | `sm_assignment_run_finish` | `notify_user(manager,'auto_assign_complete',{run_id,...})` enqueued | Fix 10 (§3.10) |
| MF-26 | Fix10 notify: no emergency notif because TTS blocked | all winners ≥4h | run | no `emergency_assignment` notif from auto path | Fix 10 / audit U3 |
| MF-27 | Outcome enum closed set | any mapped result | mapper | outcome ∈ {ASSIGNED, SKIPPED_NO_ELIGIBLE, SKIPPED_BLOCKED, SKIPPED_LOCKED, CONFLICT_RETRY, ERROR} | 00 §6 |
| MF-28 | Fail-closed: unexpected gateway code → ERROR recorded not thrown | gateway returns unknown code | mapper | `ERROR` recorded, loop continues | D5 / 01 §2.4 |

---

## 3. Unit — Swap eligibility engine, per-rule × modes  (`SE-*`)  **[P0–P1]**

Targets `evaluateEligibility(ctx, policy)` ([02 §3](02-auto-approve-swaps.md)) — a deterministic pure function. Each row asserts a rule's `status` and the `mode→vote` mapping (REQUIRE_EQUAL/AUTO_REJECT_IF_FAIL→rejectVote; ROUTE_TO_REVIEW_IF_FAIL→reviewVote; IGNORE→none). Always-on rules force `AUTO_REJECT_IF_FAIL` and cannot be configured away.

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| SE-01 | Role REQUIRE_EQUAL pass | `Rs.role_id === Os.role_id` | evaluate | `same_role` pass, no vote | §3.1 / matrix / audit#1 |
| SE-02 | Role REQUIRE_EQUAL fail → rejectVote | roles differ, mode REQUIRE_EQUAL | evaluate | rejectVote, decision path AUTO_REJECT | §3.1 / 02 §2.2 / audit#2 |
| SE-03 | Role ROUTE_TO_REVIEW mode | roles differ, mode ROUTE_TO_REVIEW_IF_FAIL | evaluate | reviewVote (not reject) | §3.1 mode variant |
| SE-04 | Role IGNORE mode | roles differ, mode IGNORE | evaluate | no vote, no effect | §3.1 / audit#12 |
| SE-05 | Cert always-on: requester missing cert → reject | `Ra` lacks a cert required by `Os` | evaluate | `certification` fail, AUTO_REJECT_IF_FAIL, missing listed | §3.2 (always-on) / audit#8 / F-5 |
| SE-06 | Cert always-on: offerer missing cert → reject | `Ob` lacks a cert required by `Rs` | evaluate | fail, reject vote, `missing_offerer` populated | §3.2 |
| SE-07 | Cert always-on cannot be disabled | policy sets cert `enabled=false` | evaluate | engine forces AUTO_REJECT_IF_FAIL anyway | §3.2 / §3.12 / 02 §"why configurable" |
| SE-08 | Location REQUIRE_EQUAL pass (sub_department) | same `sub_department_id` | evaluate | pass | §3.3 |
| SE-09 | Location grain=department | different sub-dept, same dept, grain='department' | evaluate | pass | §3.3 param |
| SE-10 | Location fail → rejectVote | different sub-dept, REQUIRE_EQUAL | evaluate | rejectVote | §3.3 / audit#4 |
| SE-11 | Pay-rate within tolerance → pass + delta recorded | `|rate(Rs)-rate(Os)| <= tol` | evaluate | pass; `payrollDelta` still computed | §3.4 / audit#7 |
| SE-12 | Pay-rate over tolerance → reviewVote | diff > tol, ROUTE_TO_REVIEW | evaluate | reviewVote; per-hour + estCostDelta in output | §3.4 / audit §6.7 |
| SE-13 | Payroll delta on duration diff is non-zero | shifts differ in paid hours | evaluate | `estCostDelta != 0` | §3.4 |
| SE-14 | Duration within ±tol → pass | `|paidMin(Rs)-paidMin(Os)| <= tol_min` | evaluate | pass | §3.5 / audit#5 |
| SE-15 | Duration over tol → reviewVote | diff > tol_min | evaluate | reviewVote | §3.5 / audit#6 |
| SE-16 | Fatigue always-on: blocking solver hit → reject | solver returns blocking fatigue violation | evaluate (reads solver) | `fatigue` fail, AUTO_REJECT_IF_FAIL | §3.6 (delegated, always-on) |
| SE-17 | Fatigue: no fatigue hit → pass | solver clean of fatigue rules | evaluate | pass | §3.6 |
| SE-18 | Overtime warning → reviewVote | solver OT warning, mode ROUTE_TO_REVIEW | evaluate | reviewVote | §3.7 / audit#11 |
| SE-19 | Overtime blocking handled by solver, not engine | solver OT blocking | matrix | reject via solver BLOCKING (not the OT rule) | §3.7 / §2.2 |
| SE-20 | Overlap always-on: requester clash → reject | `rosterMinus(Ra,Rs)` overlaps `Os` | evaluate | `overlap` fail, AUTO_REJECT_IF_FAIL, `reqClash=true` | §3.8 (always-on) / audit#10 (overlap) |
| SE-21 | Overlap always-on: offerer clash → reject | `Ob` post-swap overlaps `Rs` | evaluate | fail, `offClash=true` | §3.8 |
| SE-22 | Overlap: no clash → pass | neither post-swap schedule overlaps | evaluate | pass | §3.8 |
| SE-23 | Team-coverage below floor → reviewVote | role-changing swap drops slot below floor | evaluate | `team_coverage` fail, reviewVote | §3.9 |
| SE-24 | Team-coverage: pure 1:1 same-role neutral | same role/location swap | evaluate | coverage pass (neutral) | §3.9 |
| SE-25 | Team-coverage: giveaway (target NULL) flagged | `target_shift` NULL giveaway under floor | evaluate | reviewVote | §3.9 |
| SE-26 | Availability AUTO_REJECT_IF_FAIL: incoming unavailable → reject | `Ra` not available for `Os` window | evaluate | `availability` fail, rejectVote | §3.10 / audit#7(swap) / failure#40 |
| SE-27 | Availability: inactive employee → reject | `isActive(Ob)` false | evaluate | fail | §3.10 / audit#7 |
| SE-28 | Availability ROUTE mode variant | unavailable, mode overridden to ROUTE | evaluate | reviewVote instead of reject | §3.10 mode |
| SE-29 | Max-swap-distance default IGNORE | shifts far apart, rule default | evaluate | no vote | §3.12 / audit#9 |
| SE-30 | Max-swap-distance enabled → reviewVote | rule enabled, distance exceeded | evaluate | reviewVote | §3.12 param |
| SE-31 | Confidence: −0.15 per ROUTE flag | 2 ROUTE failures, 0 warnings | evaluate | `confidence == 1.0 − 0.30 == 0.70` | §3.11 |
| SE-32 | Confidence: −0.25 per solver WARNING, floored at 0 | 5 warnings | evaluate | `confidence == 0` (floor) | §3.11 |
| SE-33 | Eligibility purity/determinism | any ctx | evaluate twice | identical `EligibilityResult` | 02 §3 (pure) / §0.5 |
| SE-34 | Vote aggregation reject>review>approve | 1 rejectVote + 2 reviewVotes | resolve | AUTO_REJECT wins | 02 §2.2 |

---

## 4. Unit — Swap decision matrix cells incl. kill-switch / shadow / confidence / rate-limit  (`DM-*`)  **[P0–P1]**

Targets the matrix resolver + pre/post gates ([02 §2](02-auto-approve-swaps.md)). One row per matrix cell + each gate; extends audit cases 13–24.

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| DM-01 | Pre-gate P1 kill-switch: policy missing | no `swap_approval_rules` row | decide | no auto action, audit `KILLSWITCH_OFF`, stays MANAGER_PENDING | §2.1 P1 / audit#20,#24 |
| DM-02 | Pre-gate P1 kill-switch: enabled=false | policy `enabled=false` | decide | no auto action, `KILLSWITCH_OFF` | §2.1 P1 / audit#20 |
| DM-03 | Pre-gate P2 shadow_mode | `shadow_mode=true`, would-be APPROVE | decide | `swap_decisions(shadow=true,committed=false)`, no shift change, audit `SHADOW_SUPPRESSED` | §2.1 P2 / audit#30 |
| DM-04 | Pre-gate P3 not pending | swap no longer MANAGER_PENDING | decide | no-op, audit `SKIPPED_NOT_PENDING` | §2.1 P3 / audit#42 |
| DM-05 | Matrix: guards fail → AUTO_REJECT | any GuardViolation | decide | AUTO_REJECT, reason=guard codes | §2.2 row1 / audit#13 |
| DM-06 | Matrix: always-on rule fail → AUTO_REJECT | cert/overlap/fatigue/time-lock fail | decide | AUTO_REJECT | §2.2 row2 |
| DM-07 | Matrix: REQUIRE_EQUAL fail → AUTO_REJECT | role/location REQUIRE_EQUAL fail | decide | AUTO_REJECT | §2.2 row3 |
| DM-08 | Matrix: availability AUTO_REJECT_IF_FAIL → AUTO_REJECT | availability fail | decide | AUTO_REJECT | §2.2 row4 |
| DM-09 | Matrix: ROUTE rule fail, solver PASS → MANUAL_REVIEW | skill/duration/pay/OT/coverage ROUTE fail | decide | MANUAL_REVIEW | §2.2 row5 |
| DM-10 | Matrix: solver BLOCKING, all rules pass → AUTO_REJECT | solver BLOCKING | decide | AUTO_REJECT | §2.2 row6 / audit#14 |
| DM-11 | Matrix: solver WARNING + auto_approve_warnings=false → MANUAL_REVIEW | WARNING, flag off | decide | MANUAL_REVIEW | §2.2 row7 / audit#15 |
| DM-12 | Matrix: solver WARNING + auto_approve_warnings=true → AUTO_APPROVE(candidate) | WARNING, flag on | decide | AUTO_APPROVE candidate (then gates) | §2.2 row8 / audit#16 |
| DM-13 | Matrix: all pass + solver PASS → AUTO_APPROVE(candidate) | clean | decide | AUTO_APPROVE candidate | §2.2 row9 / audit#17 |
| DM-14 | Post-gate G1 confidence below min → downgrade | candidate, `confidence < confidence_min` | gate | downgrade AUTO_APPROVE→MANUAL_REVIEW | §2.3 G1 / audit#18 |
| DM-15 | Post-gate G1 confidence at min → stays approve | `confidence == confidence_min` | gate | remains AUTO_APPROVE | §2.3 G1 boundary |
| DM-16 | Post-gate G2 rate-limit hit → downgrade | party at `max_auto_per_employee_per_week` | gate | downgrade→MANUAL_REVIEW | §2.3 G2 / audit#19 / §4.1 |
| DM-17 | Post-gate G3 mutual-favoritism → downgrade | pairwise count ≥ pairwise_max | gate | downgrade→MANUAL_REVIEW | §2.3 G3 / §4.2 |
| DM-18 | Post-gate G3 ≥3-cycle laundering → AUTO_REJECT | cycle ≥3 returns ownership | gate | AUTO_REJECT reason `CIRCULAR_SWAP` | §2.3 G3 / §4.5 |
| DM-19 | Fail-closed: solver throws → MANUAL_REVIEW | solver exception | decide | MANUAL_REVIEW, never approve | §1.3 / D5 / audit#21 |
| DM-20 | Fail-closed: null offered shift → never APPROVE | offered shift missing | decide | MANUAL_REVIEW/REJECT, not APPROVE | audit#23 |
| DM-21 | Decision enum closed set | any decision | resolve | ∈ {AUTO_APPROVE, MANUAL_REVIEW, AUTO_REJECT} | 00 §6 |
| DM-22 | Only path to committed APPROVE survives P1–P3 + matrix + G1–G3 | clean + confident + under limits + no abuse | decide | AUTO_APPROVE committed | §2.3 closing rule |

---

## 5. Integration — Auto-Assign run end-to-end via gateway, dry-run, rollback  (`IA-*`)  **[P0–P1]**

Runs against the Supabase **test branch**. Seeds via `create_test_shift` + bid inserts; invokes `auto-assign-bids`; asserts on `shifts.version`/state, `assignment_runs`/`assignment_decisions`/`assignment_events`, `shift_events`, `shift_bids`.

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| IA-01 | Happy path single shift commit via gateway | 1 `S5` shift (TTS 30h), 2 pending bids | POST `auto-assign-bids` | winner ASSIGNED via `sm_apply_shift_op('select_winner')`; shift v 7→8, S4; loser bid `rejected`; `assignment_decisions` row; `shift_events` idem row | 01 §2.4 / §5.5 / Fix 1,3,7,9 |
| IA-02 | Multi-shift run summary correct | 3 `S5` shifts, mixed eligibility | POST | `summary{assigned,skipped,...}` matches DB truth (no inflated count) | 01 §8.1 / audit#24 |
| IA-03 | Dry-run persists decisions, never mutates shifts | `S5` shift with bids | POST `dry_run:true` | decisions `committed=false`, preview returned, shift `version`/state unchanged | 01 §2.4(F) / §8.1 / audit U4 |
| IA-04 | Qual enforced end-to-end | bidder missing required cert | POST | unqualified bidder not winner; `SKIPPED_NO_ELIGIBLE`/next-ranked | Fix 4 / audit#6 |
| IA-05 | TTS-locked shift skipped | `S5` shift `scheduled_start = now()+3h` | POST | outcome `SKIPPED_LOCKED`; not assigned | Fix 2 / audit#5 |
| IA-06 | Cancelled shift in scope skipped | `S15` shift mixed into scope | POST | excluded; never assigned over cancelled | Fix 1 / audit#14 |
| IA-07 | Winner withdrew before commit | pending bid withdrawn between snapshot and commit | POST | gateway `WINNER_NOT_PENDING`; `SKIPPED_NO_ELIGIBLE`; no `withdrawn→accepted` | Fix 3 / audit#4 |
| IA-08 | Run lineage double-anchored | any commit | POST | both `shift_events` (gateway) and `assignment_events` rows exist for the commit | 01 §2.1 / §7.3 |
| IA-09 | Rollback reverts run-assigned shift (safe) | run assigned shift, still S4, TTS≥4h, version unchanged | POST `/rollback` | shift S4→S5 re-opened, winner bid → pending, `assignment_events('SHIFT_ROLLBACK')`, run `ROLLED_BACK` | 01 §9 / audit U5 |
| IA-10 | Rollback skips edited-since shift | shift `version != recorded version_after` | POST `/rollback` | skipped `EDITED_SINCE`; decision rows preserved | 01 §9.1(2) / §9.3 |
| IA-11 | Rollback skips TTS-locked shift | run-assigned shift now <4h | POST `/rollback` | skipped `TTS_LOCKED` | 01 §9.1(3) |
| IA-12 | Rollback preserves audit (no deletes) | rolled-back run | inspect | `assignment_decisions`/`assignment_runs` intact; new event layer only | 01 §9.3 / audit#32 |
| IA-13 | PARTIALLY_FAILED status on conflict/error | one shift ends CONFLICT_RETRY | POST | run status `PARTIALLY_FAILED`, summary reflects it | 01 §8.1 / 00 §6 |
| IA-14 | Resumable cursor: re-invoke does not double-commit | run interrupted after cursor advance | re-POST same run_id | resumes after `cursor.last_shift_id`; no double commit (idem) | 01 §2.5 / §3.8 |

---

## 6. Integration — Auto-Approve queue → decide → commit, shadow, override, revert  (`IS-*`)  **[P0–P1]**

Seeds two `S4` shifts + a `shift_swaps` row driven to `MANAGER_PENDING` via `sm_accept_trade` (fires `trg_enqueue_swap_auto_decision` for real). Invokes `auto-approve-swaps`; asserts on `swap_review_queue`, `swap_decisions`, `swap_audit_log`, shift state, notifications.

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| IS-01 | Enqueue on MANAGER_PENDING (transactional outbox) | offer accepted | `sm_accept_trade` | exactly one `swap_review_queue` row (PENDING) per version-tuple; `swap_audit_log 'ENQUEUED'` | 02 §1.1 / §2.1 S2.1 |
| IS-02 | AUTO_APPROVE commits via approve_trade | clean swap, `shadow_mode=false`, `enabled=true` | worker tick | `sm_apply_shift_op('approve_trade')` runs; swap APPROVED; `committed=true`; queue DONE | 02 §1.4 / audit#25 |
| IS-03 | AUTO_REJECT reverts both shifts to NoTrade | always-on rule fail | worker tick | `reject_trade` runs; both shifts `trading_status=NoTrade`; swap REJECTED | 02 §2.2 / audit#26 |
| IS-04 | MANUAL_REVIEW sets review_flag, stays pending | ROUTE rule failed | worker tick | `review_flag=true`, swap stays MANAGER_PENDING, no shift change | 02 §2.2 / audit#27 |
| IS-05 | Shadow mode: decide + log, no shift change | `shadow_mode=true`, would-be APPROVE | worker tick | `swap_decisions(shadow=true,committed=false)`; shift unchanged; queue DONE | 02 §2.1 P2 / audit#30 |
| IS-06 | Audit row written exactly once per key | duplicate enqueue same versions | two ticks | one `swap_decisions` row (UNIQUE key); second = IDEMPOTENT_REPLAY | 02 §1.2 / audit#28,#35 |
| IS-07 | Notifications on each terminal decision | approve / reject | worker tick | `trg_swap_outcome_notification` fires to both parties (+ manager on review) | 02 §1.4 / audit#29 |
| IS-08 | Per-dept override beats org default | dept policy + org policy differ | worker tick | dept policy applied (mode/flags) | 02 §5 / audit#33 |
| IS-09 | Engine/policy version stamped | any decision | inspect | `swap_decisions.policy_version`/`engine_version` set | 02 §5 / audit#34 / 00 §8 |
| IS-10 | Admin override force-decide, audited | admin forces approve bypassing policy | override action | committed, fully audited, time-lock guarded | 02 §"safety levers" / audit#31 |
| IS-11 | Revert restores prior assignment | committed AUTO_APPROVE, both shifts ≥4h | `sm_swap_auto_revert` | inverse reassignment; `reverted_at`/`reverted_by` set; audited | 02 §5 S5.2 / audit#32 |
| IS-12 | Revert blocked inside time-lock | involved shift now <4h | `sm_swap_auto_revert` | refused; audit reason time-lock | 02 §5 (time-lock guarded) |

---

## 7. Concurrency — version-CAS races, two managers, auto+manual, withdrawal, dup delivery, SKIP LOCKED, deadlock  (`CC-*`)  **[P0]**

Real Postgres; two sessions race inside pgTAP / two parallel `functions.invoke`. These are the structural correctness gates.

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| CC-01 | Two managers auto-assign same shift | two runs target one `S5` shift v=7 | concurrent `select_winner` exp=7 | first APPLIED v=8; second `VERSION_CONFLICT`; no overwrite | 01 §5.6 / audit#1 |
| CC-02 | Auto vs manual assign race | auto run + manual `selectBidWinnerViaGateway` same shift | concurrent | one wins, other CAS-fails; no dangling accepted bid | Fix 7 / audit#2 |
| CC-03 | Withdrawal mid-flight | bid withdrawn between snapshot read and gateway commit | run | gateway `WINNER_NOT_PENDING`; no revival | Fix 3 / audit#4 / FSM 5.3 |
| CC-04 | Duplicate auto-assign delivery (double-click) | same run, same shift, two invocations | re-invoke | idem uuid → one write, IDEMPOTENT_REPLAY; `UNIQUE(run_id,shift_id)` blocks 2nd decision | Fix 8 / audit#10,#35 |
| CC-05 | Duplicate swap queue delivery | same `idempotency_key` delivered twice | two ticks | single commit; second IDEMPOTENT_REPLAY | 02 §1.2 / audit#35 |
| CC-06 | Two swaps share a shift | swapX and swapY both touch shift Z | concurrent decide | one commits, other CAS-fails → re-queue/re-eval | 02 §6.8 / audit#36 |
| CC-07 | Drift between eval and commit (swap) | offered shift version changes after eval | worker commit | gateway `VERSION_CONFLICT`; requeue; new key → clean re-eval | 02 §1.3 / audit#37 |
| CC-08 | SKIP LOCKED claim isolation | 2 workers, N PENDING queue rows | concurrent claim | each row claimed by exactly one worker (no double-claim) | 02 §1.1 (`FOR UPDATE SKIP LOCKED`) / audit#44 |
| CC-09 | Stale-claim lease reclaim | worker claims then "crashes" (no DONE) past lease | second worker | row reclaimable after lease timeout; eventually processed | 02 §1.2 (locked_by/locked_at) / audit#48,#49 |
| CC-10 | Deadlock-free lock ordering (bids) | two overlapping runs, multiple shifts | concurrent commits | both lock in `shift_id ASC` order → no cycle, no deadlock | 01 §5.4 |
| CC-11 | Single-row lock only (no multi-row hold) | a `select_winner` commit | inspect locks | exactly one `shifts` row `FOR UPDATE`; lock held microseconds | 01 §5.2/§5.4 |
| CC-12 | Concurrent manual approve + auto (swap) | manager approves while worker decides same swap | concurrent | one wins; audit consistent; no double approve | audit#39 |
| CC-13 | VERSION_CONFLICT envelope used without extra round-trip | conflict | retry wrapper (live) | `current_version`/`current_state` read from envelope; retry uses them | 01 §5.3 |
| CC-14 | Run-level recovery after worker crash mid-loop | crash after some commits | resume run | resumes from cursor; committed shifts not redone; no partial corruption | 01 §2.5/§5.1 / audit#28(swap),#15 |

---

## 8. Security — authz, RLS, forged actor, SECURITY DEFINER boundary, abuse  (`SEC-*`)  **[P0]**

Cert-based authz (`app_access_certificates`, `access_level ∈ gamma/delta/epsilon/zeta`, `is_active=true`, manager col `user_id` — `is_manager_or_above()` is BROKEN, [00 §8](00-contracts-and-conventions.md)).

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| SEC-01 | Non-manager cannot trigger auto-assign | JWT without cert for scope | POST `auto-assign-bids` | 403 FORBIDDEN before run opens | Fix 6 / 01 §2.4(A) / audit#18 |
| SEC-02 | Manager scoped to other org rejected | cert for org B, scope org A | POST | 403; no run row | Fix 6 / audit#18,#26 |
| SEC-03 | Gateway re-checks authz per select_winner | service path but bad actor context | commit | gateway authorizes via cert each op | Fix 6 / 01 §3.6 |
| SEC-04 | Hardened sm_select_bid_winner ignores client p_user_id | legacy caller passes forged p_user_id | call | authz via cert, not the param | Fix 6 / audit#18 |
| SEC-05 | RLS: manager reads only own-org assignment_runs | manager org A queries runs | SELECT | only org-A runs visible | 01 §6 RLS / §7 |
| SEC-06 | RLS: no direct client INSERT into assignment_decisions | client tries INSERT | INSERT | denied; writes only via SECURITY DEFINER RPC | 01 §6 |
| SEC-07 | RLS: swap_approval_rules org-admin-only write | non-admin PUT | `PUT swap_approval_rules` | denied by RLS | 02 §5 / §6 S1.2 / audit (policy RBAC) |
| SEC-08 | RLS: swap_review_queue has no client policy | client SELECT queue | SELECT | denied (service-role only) | 02 §5 |
| SEC-09 | swap_audit_log immutable | UPDATE/DELETE audit row | mutate | `trg_swap_audit_no_update` raises | 02 §5 / §6 S1.1 |
| SEC-10 | SECURITY DEFINER search_path pinned | inspect RPCs | DDL check | all new RPCs `SET search_path=public,pg_catalog` | 00 §8 |
| SEC-11 | Forged actor in event metadata rejected | attempt to set actor_id ≠ auth.uid() | gateway | actor derived from `auth.uid()`, not payload | 00 §2 / 01 corrections |
| SEC-12 | Abuse: swap farming rate-limit | party at weekly cap | decide | downgrade→MANUAL_REVIEW | §4.1 / audit#19 |
| SEC-13 | Abuse: mutual favoritism pairwise | pair over `pairwise_max`/30d | decide | downgrade→MANUAL_REVIEW | §4.2 |
| SEC-14 | Abuse: circular 2-cycle (swap-back) | A↔B swap-back detected | decide | downgrade→MANUAL_REVIEW | §4.5 (2-cycle) |
| SEC-15 | Abuse: circular ≥3-cycle laundering | A→B→C→A returns ownership | decide | AUTO_REJECT `CIRCULAR_SWAP` | §4.5 |
| SEC-16 | Abuse: approval-manipulation drift-gaming | ≥3 re-evals (edited shift) in 1h | decide | MANUAL_REVIEW + lock further auto-eval | §4.4 |

---

## 9. Load / Scale  (`LS-*`)  **[P1–P2]**

Test branch sized to prod-like volume; k6 for HTTP, SQL seed for queue.

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| LS-01 | 5k-shift auto-assign run completes | 5,000 `S5` shifts + bids in scope | one run | completes server-side promptly (no client loop); no timeout | 01 §2 / audit#11 |
| LS-02 | 5k MANAGER_PENDING swaps drain within SLA | 5,000 queued swaps | workers tick | queue drains within SLA | 02 §6 S2.2 / audit#43 |
| LS-03 | p95 decision latency under threshold (swaps) | steady queue load | measure | p95 < 2s/swap | 02 §6 S2.2 AC / audit#46 |
| LS-04 | Horizontal worker scale, no double-commit | N parallel workers | drain | SKIP LOCKED → no row processed twice | 02 §1.2 / audit#44 |
| LS-05 | Resumable cursor mid-large-run | 5k run interrupted | re-invoke | resumes from cursor; bounded redo | 01 §2.5 / audit#28(bids) |
| LS-06 | DLQ after max_attempts → MANUAL_REVIEW | swap fails `max_attempts` times | drain | row→DLQ, `MANUAL_REVIEW` decision, `review_flag=true` | 02 §1.2 / audit#45 |
| LS-07 | DLQ rate stays < 1% under load | prod-like mix | drain | DLQ rate < 1% (shadow gate metric) | 02 §7 stage 0 |
| LS-08 | Batched existing-shift fetch (no per-bidder N round-trips) | many bidders per shift | snapshot | one batched pass per employee server-side | Fix 6 / audit#27,#31,S1/S2 |

---

## 10. Failure recovery / Rollback  (`FR-*`)  **[P0–P1]**

| ID | Title | Given / Precondition | Action | Expected | Maps-to |
|---|---|---|---|---|---|
| FR-01 | Worker crash mid-txn (swap) → no partial commit | crash during `sm_swap_auto_decide` | recover | RPC is one txn (audit↔gateway atomic); nothing half-written | 02 §1.3 / audit#47 |
| FR-02 | Queue redelivery after crash → idempotent | crashed swap redelivered | re-tick | idempotent commit (UNIQUE key) | 02 §1.2 / audit#48 |
| FR-03 | DB failover mid-run → resume from queue | failover during drain | recover | resume from durable queue; no loss | 02 §1.2 / audit#49 |
| FR-04 | Config change mid-flight uses snapshotted policy_version | policy edited while swap in flight | decide | in-flight decision uses the `policy_version` it started with | 02 §1.2 / audit#50 |
| FR-05 | Fail-closed: data load error (swap) → requeue then MANUAL_REVIEW | roster load throws | drain | requeue w/ backoff; after max → DLQ → MANUAL_REVIEW | 02 §1.3 / audit#22 |
| FR-06 | Fail-closed: guard exception (swap) → never AUTO_APPROVE | guard throws unexpectedly | decide | MANUAL_REVIEW (or AUTO_REJECT for hard invalidity) | 02 §1.3 / D5 |
| FR-07 | Auto-assign engine exception → skip+record, run not left RUNNING | engine throws mid-run | run | run `ABORTED`, error recorded; D5 fail-closed | 01 §2.4 catch / D5 |
| FR-08 | Partial run recorded, resumable (bids) | network drop mid-loop | recover | partial decisions persisted; run resumable; counts truthful | 01 §2.5 / audit#15,#28 |
| FR-09 | Rollback safety rule set enforced (4 conditions) | run-assigned shifts in mixed states | `sm_assignment_run_rollback` | only revert if ASSIGNED-by-run ∧ still-S4-same-version ∧ TTS≥4h ∧ NoTrade; else skip-with-reason | 01 §9.1 |
| FR-10 | Rollback CAS enforces no-drift via gateway | concurrent change during rollback | rollback | recorded `version_after` as CAS token; drift loses race, shift skipped | 01 §9.2 |
| FR-11 | Audit preserved across rollback | rolled-back run | inspect | decisions/runs never deleted; only event layer added; status `ROLLED_BACK` | 01 §9.3 / audit#32 |
| FR-12 | Swap revert audit-preserving & time-locked | committed approval reverted | `sm_swap_auto_revert` | inverse reassignment, audited, refused if <4h | 02 §5 / audit#32 |

---

## 11. Coverage matrix (nothing untested)

### 11.1 Audit §4 — 32 failure scenarios → ≥1 test ID

| # | Scenario (short) | Test IDs |
|---|---|---|
| 1 | Two managers same shift | CC-01, MF-17, MF-03 |
| 2 | Auto races manual | CC-02 |
| 3 | Stale/deleted shift id | MF-02, IA-06 |
| 4 | Withdraw after selection | MF-07, IA-07, CC-03 |
| 5 | Shift in 3h, old bids | MF-04, MF-06, IA-05 |
| 6 | Lacks role cert | MF-09, MF-10, MF-12, IA-04 |
| 7 | Deactivated/on leave (swap availability) | SE-26, SE-27 |
| 8 | WARNING near OT | AU-03, AU-18, SE-18, DM-11 |
| 9 | Sole bidder for B consumed by A | AU-15 |
| 10 | Re-click double-fire | MF-22, CC-04 |
| 11 | 800×12 scale | LS-01 |
| 12 | 2 WorkRights licenses | MF-15 |
| 13 | Fairness ledger errors | AU-07 |
| 14 | Cancelled S15 targeted | MF-02, IA-06 |
| 15 | Network drop mid-loop | FR-08, CC-14 |
| 16 | Two overlapping shifts, sole bidder | AU-15, AU-20 |
| 17 | Bid placed during run | IA-14, IA-03 (snapshot) |
| 18 | Manager lacks rights | SEC-01, SEC-02, SEC-04 |
| 19 | Winner already assigned same time | CC-01, MF-17 |
| 20 | Student-visa 48h breach | MF-10 (qual/visa path), MF-15 |
| 21 | Two clear bidders, one higher priority | AU-02, AU-05, AU-09 |
| 22 | Reopened shift stale bids | IA-09 (re-open path), MF-08 |
| 23 | Engine throws for one bidder | MF-28, FR-07 |
| 24 | Toast says assigned but no-op | IA-02 (truthful counts) |
| 25 | Displaced winner notification | MF-26 (overwrite prevented), IS-07 |
| 26 | Existing query crosses orgs | MF-14, SEC-02 |
| 27 | Very large bidder list | LS-08 |
| 28 | Manager closes tab mid-run | FR-08, CC-14, LS-05 |
| 29 | Aggregate hours breach | AU-20 |
| 30 | One employee wins many | AU-13, AU-14 |
| 31 | RLS hides bidder shifts | LS-08, IA-01 (service-role snapshot) |
| 32 | Audit "why did X win?" | MF-23, MF-24, IA-12 |

### 11.2 Auto-Assign 10 mandatory fixes → ≥1 test ID

| Fix | Name | Test IDs |
|---|---|---|
| 1 | FSM state validation | MF-01, MF-02, MF-03, IA-06, CC-01 |
| 2 | TTS / 4h lock | MF-04, MF-05, MF-06, IA-05 |
| 3 | Winner-bid (no withdrawn revival) | MF-07, MF-08, IA-07, CC-03 |
| 4 | Qualification | MF-09, MF-10, IA-04 |
| 5 | Role | MF-11, MF-12, MF-13 |
| 6 | Ownership / org-scope | MF-14, MF-15, SEC-01–SEC-04, LS-08 |
| 7 | Concurrency (CAS) | MF-16, MF-17, MF-18, MF-19, CC-01, CC-02, CC-10, CC-13 |
| 8 | Idempotency | MF-20, MF-21, MF-22, CC-04, IA-14 |
| 9 | Audit logging | MF-23, MF-24, IA-08, IA-12 |
| 10 | Notification | MF-25, MF-26, IS-07 |

### 11.3 Swap decision-matrix outcomes & gates → ≥1 test ID

| Matrix cell / gate ([02 §2](02-auto-approve-swaps.md)) | Test IDs |
|---|---|
| P1 kill-switch (missing / disabled) | DM-01, DM-02 |
| P2 shadow_mode | DM-03, IS-05 |
| P3 not-pending | DM-04 |
| Guards fail → AUTO_REJECT | DM-05, CC-07 |
| Always-on rule fail → AUTO_REJECT | DM-06, SE-05, SE-16, SE-20 |
| REQUIRE_EQUAL fail → AUTO_REJECT | DM-07, SE-02, SE-10 |
| AUTO_REJECT_IF_FAIL (availability) → AUTO_REJECT | DM-08, SE-26 |
| ROUTE fail + PASS → MANUAL_REVIEW | DM-09, SE-12, SE-15, SE-18, SE-23 |
| Solver BLOCKING → AUTO_REJECT | DM-10 |
| WARNING + flag=false → MANUAL_REVIEW | DM-11 |
| WARNING + flag=true → AUTO_APPROVE | DM-12 |
| All pass + PASS → AUTO_APPROVE | DM-13, IS-02 |
| G1 confidence | DM-14, DM-15, SE-31, SE-32 |
| G2 rate-limit | DM-16, SEC-12 |
| G3 mutual-favoritism / cycle | DM-17, DM-18, SEC-13, SEC-14, SEC-15 |
| Committed-approve only via full path | DM-22, IS-02 |
| Fail-closed (solver/null/data) | DM-19, DM-20, FR-05, FR-06 |

### 11.4 Audit §11 existing 54 cases — extension confirmation

The 54 audit cases are **subsumed and extended**: eligibility 1–12 → `SE-*` (34 cases, per-mode); matrix 13–20 → `DM-*` (22 cases, incl. all gates); fail-closed 21–24 → `DM-19/20`, `FR-05/06`; integration 25–34 → `IS-*`; concurrency 35–42 → `CC-*`; load 43–46 → `LS-*`; recovery 47–50 → `FR-*`; bidding-parity 51–54 → `MF-01/04/07/09` + `IA-04/05/07`. Every original number is referenced in a `Maps-to` cell above.

---

## 12. Six concrete example test bodies

> Patterns only — file paths are the intended homes. The TS examples follow the repo's existing vitest style ([shift-op-legality.test.ts](../../src/modules/rosters/domain/__tests__/shift-op-legality.test.ts), [bidding-urgency.test.ts](../../src/modules/rosters/domain/__tests__/bidding-urgency.test.ts)); the pgTAP example introduces `supabase/tests/`.

### 12.1 CAS race test (CC-01) — pgTAP, two sessions race one shift

```sql
-- supabase/tests/cc01_cas_race_select_winner.sql
BEGIN;
SELECT plan(3);

-- seed: one open-for-bidding shift (S5) + two pending bids
SELECT create_test_shift('S5', 5) AS shift_id \gset
INSERT INTO shift_bids (shift_id, employee_id, status)
SELECT :'shift_id', id, 'pending' FROM profiles ORDER BY id LIMIT 2;

-- capture starting version (CAS token)
SELECT version FROM shifts WHERE id = :'shift_id' \gset

-- writer A commits at expected_version = v  → APPLIED
SELECT is(
  (sm_apply_shift_op(:'shift_id', :version, 'select_winner',
     jsonb_build_object('winner_id', (SELECT employee_id FROM shift_bids WHERE shift_id=:'shift_id' LIMIT 1)),
     extensions.uuid_generate_v5('00000000-0000-0000-0000-000000000001'::uuid, :'shift_id'||':A')
   ) ->> 'ok')::boolean, true, 'A: first commit APPLIED');

-- writer B commits at the SAME stale expected_version  → VERSION_CONFLICT
WITH r AS (
  SELECT sm_apply_shift_op(:'shift_id', :version, 'select_winner',
     jsonb_build_object('winner_id', (SELECT employee_id FROM shift_bids WHERE shift_id=:'shift_id' OFFSET 1 LIMIT 1)),
     extensions.uuid_generate_v5('00000000-0000-0000-0000-000000000001'::uuid, :'shift_id'||':B')) AS j
)
SELECT is((SELECT j->>'code' FROM r), 'VERSION_CONFLICT', 'B: stale version rejected by CAS');

-- exactly one assignment survived; no overwrite
SELECT is((SELECT count(*) FROM shift_bids WHERE shift_id=:'shift_id' AND status='accepted'), 1::bigint,
          'exactly one accepted bid — no double assignment');

SELECT * FROM finish();
ROLLBACK;
```

### 12.2 Idempotency test (CC-04 / MF-22) — vitest, replay is a no-op

```ts
// supabase/functions/auto-assign-bids/__tests__/idempotency.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { svc, seedOpenShiftWithBids, getShift } from './_helpers'; // service-role client + seeders

describe('auto-assign idempotent replay (CC-04)', () => {
  let shiftId: string, runId: string;
  beforeAll(async () => { ({ shiftId } = await seedOpenShiftWithBids({ state: 'S5', ttsHours: 30, bids: 2 })); });

  it('a re-delivered select_winner does not double-commit', async () => {
    const r1 = await svc.functions.invoke('auto-assign-bids', {
      body: { scope: { organization_id: ORG }, dry_run: false, options: { max_wins_per_employee: 3 } },
    });
    runId = r1.data.run_id;
    const afterFirst = await getShift(shiftId);          // version bumped once, S4
    expect(afterFirst.assignment_status).toBe('assigned');

    // Re-invoke the SAME run_id (double-click / redelivery)
    const r2 = await svc.functions.invoke('auto-assign-bids', { body: { resume_run_id: runId } });
    const afterReplay = await getShift(shiftId);

    expect(afterReplay.version).toBe(afterFirst.version); // NO second write
    // exactly one decision row for (run, shift) — UNIQUE(run_id, shift_id)
    const { count } = await svc.from('assignment_decisions')
      .select('*', { count: 'exact', head: true }).eq('run_id', runId).eq('shift_id', shiftId);
    expect(count).toBe(1);
  });
});
```

### 12.3 Fail-closed test (DM-19 / FR-06) — vitest, solver throw → MANUAL_REVIEW

```ts
// supabase/functions/auto-approve-swaps/__tests__/fail-closed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { decideSwap } from '../engine';                  // pure orchestration entry
import * as solver from '@/modules/compliance/v8/swap-engine/swap-evaluator';

describe('fail-closed (DM-19)', () => {
  it('routes to MANUAL_REVIEW when the solver throws — never AUTO_APPROVE', async () => {
    vi.spyOn(solver.swapEvaluator, 'evaluate').mockImplementation(() => { throw new Error('solver boom'); });
    const ctx = makeCleanSwapCtx();                       // guards pass, eligibility clean
    const out = await decideSwap(ctx, makeEnabledPolicy());
    expect(out.decision).toBe('MANUAL_REVIEW');
    expect(out.decision).not.toBe('AUTO_APPROVE');
    expect(out.committed).toBe(false);
    vi.restoreAllMocks();
  });
});
```

### 12.4 Fairness determinism test (AU-12) — vitest, identical input → identical output

```ts
// src/modules/compliance/v8/orchestrator/bidding/__tests__/determinism.test.ts
import { describe, it, expect } from 'vitest';
import { runBidSelection } from '../index';
import { makeBiddingInput } from './_fixtures';           // builds a fixed BiddingInput

describe('runBidSelection determinism (AU-12)', () => {
  it('produces byte-identical output across runs (pure, total tie-break)', () => {
    const input = makeBiddingInput({
      shifts: 4, bidders: 6,
      tie: true,                                           // force equal composite + bid_time on two bids
    });
    const a = runBidSelection(structuredClone(input));
    const b = runBidSelection(structuredClone(input));
    expect(a).toEqual(b);                                  // total order via bid_id breaks every tie
    // and the lower bid_id wins the tie (AU-11)
    expect(a.selected_bids[0].bid_id <= a.selected_bids[1].bid_id).toBe(true);
  });
});
```

### 12.5 Eligibility always-on test (SE-07) — vitest, cert cannot be disabled

```ts
// supabase/functions/auto-approve-swaps/__tests__/eligibility-always-on.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from '../eligibility';

describe('certification is always-on (SE-07)', () => {
  it('forces AUTO_REJECT_IF_FAIL even when policy tries to disable it', () => {
    const ctx = makeCtxWhereRequesterLacksCert();          // Ra missing a cert required by Os
    const policy = makePolicy({ rules: { certification: { enabled: false, mode: 'IGNORE' } } });
    const res = evaluateEligibility(ctx, policy);
    const cert = res.outcomes.find(o => o.ruleId === 'certification')!;
    expect(cert.status).toBe('fail');
    expect(cert.mode).toBe('AUTO_REJECT_IF_FAIL');          // engine overrode the policy
    expect(res.rejectVotes.some(v => v.ruleId === 'certification')).toBe(true);
  });
});
```

### 12.6 Rollback-safety test (FR-09 / IA-10) — vitest integration, edited-since is skipped

```ts
// supabase/functions/auto-assign-bids/__tests__/rollback-safety.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { svc, runAutoAssign, bumpShiftVersion, getShift } from './_helpers';

describe('rollback safety rules (FR-09)', () => {
  let runId: string, cleanShift: string, editedShift: string;

  beforeAll(async () => {
    ({ runId, assigned: [cleanShift, editedShift] } = await runAutoAssign({ shifts: 2, ttsHours: 30 }));
    // simulate a manual edit on one assigned shift AFTER the run → version drift
    await bumpShiftVersion(editedShift);                    // version != recorded version_after
  });

  it('reverts the untouched shift but skips the edited-since shift', async () => {
    const { data } = await svc.functions.invoke(`auto-assign-bids/run/${runId}/rollback`, { body: {} });

    expect(data.reverted.map((r: any) => r.shift_id)).toContain(cleanShift);
    expect(data.skipped.find((s: any) => s.shift_id === editedShift)?.reason).toBe('EDITED_SINCE');

    const reverted = await getShift(cleanShift);
    expect(reverted.bidding_status).toMatch(/on_bidding/); // S4 → S5 re-opened
    const kept = await getShift(editedShift);
    expect(kept.assignment_status).toBe('assigned');       // drift protected by CAS, not unwound

    // audit preserved (FR-11): decisions still present, run flagged ROLLED_BACK
    const { count } = await svc.from('assignment_decisions')
      .select('*', { count: 'exact', head: true }).eq('run_id', runId);
    expect(count).toBe(2);
  });
});
```

---

## 13. Execution & gating

- **CI gate (every PR touching these workstreams):** `npm run type-check` (`tsc --noEmit`, 0 errors) + `npm run test` (all `AU/MF/SE/DM` unit cases) + `npm run build`. ESLint is intentionally excluded (broken — project memory). This mirrors the existing `"verify"` script ([package.json](../../package.json)).
- **Pre-merge integration gate:** `IA/IS/CC/SEC` against an ephemeral Supabase **branch** (created/torn down per CI run via `create_branch`/`delete_branch`), with the two Edge Functions deployed to it. pgTAP via `pg_prove supabase/tests/*.sql`.
- **Nightly / pre-release:** `LS/FR` against a prod-sized branch; capture p95, drain time, DLQ rate as the [02 §7](02-auto-approve-swaps.md) shadow-promotion gate evidence.
- **Promotion blockers (must be green before `shadow_mode=false`):** all P0 (`AU`, `MF`, `SE`, `DM`, `CC`, `SEC`) green; LS-03 (p95<2s), LS-07 (DLQ<1%), FR-01/02/06 green; shadow-vs-human agreement ≥95% (a separate analytics check, not a unit test).

---

## 14. Group → priority → count summary

| Group | IDs | Count | Priority | Min required |
|---|---|---|---|---|
| Unit — AA fairness/scoring/tie-break/win-cap/anti-gaming | AU-01…20 | 20 | P0–P2 | ≥12 ✓ |
| Unit — AA mandatory fixes 1–10 | MF-01…28 | 28 | P0–P1 | ≥14 ✓ |
| Unit — Swap eligibility per-rule × modes | SE-01…34 | 34 | P0–P1 | ≥16 ✓ |
| Unit — Swap decision matrix + gates | DM-01…22 | 22 | P0–P1 | ≥10 ✓ |
| Integration — AA end-to-end / dry-run / rollback | IA-01…14 | 14 | P0–P1 | ≥10 ✓ |
| Integration — Swap queue→decide→commit / shadow / override / revert | IS-01…12 | 12 | P0–P1 | ≥10 ✓ |
| Concurrency | CC-01…14 | 14 | P0 | ≥12 ✓ |
| Security | SEC-01…16 | 16 | P0 | ≥10 ✓ |
| Load / Scale | LS-01…08 | 8 | P1–P2 | ≥8 ✓ |
| Failure recovery / Rollback | FR-01…12 | 12 | P0–P1 | ≥10 ✓ |
| **Total** | | **180** | | **≥100 ✓** |
