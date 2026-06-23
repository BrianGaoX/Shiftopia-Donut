# 00 — Canonical Contracts & Conventions (BINDING)

**Status:** Authoritative. Every implementation document (01–04) and every agent MUST use the exact names, signatures, enums, and decisions below. Do not invent alternative table/function/route names. If something here is wrong, fix it *here* first, then propagate.

This file exists so parallel workstreams stay consistent. It is grounded in code that exists today (verified 2026-06-23).

---

## 1. Final architecture decisions (opinionated — do not re-litigate)

### D1 — Single source of truth for assignment writes
**All shift assignment/swap state mutations go through the existing `sm_apply_shift_op` gateway.** It already provides optimistic concurrency (version-CAS), the canonical FSM legality guard, and event sourcing. The thin `sm_select_bid_winner` RPC is **deprecated** and will be removed from the write path. No code may write `shifts.assigned_employee_id` directly except the gateway's internal `_apply_shift_op_write`.

### D2 — Auto-Assign Bids engine: MERGE, run server-side
Neither existing engine is kept as-is:
- Take the **decision model** of `runBidSelection()` (global greedy + composite scoring + fairness + `finalValidate` safety pass) — it is correct but unwired and pure.
- Take the **real data wiring** of `handleAutoAssign()` (live rosters, fairness ledger, visa flag) — correct inputs but wrong place and unsafe commit.
- Result: a **server-side Supabase Edge Function `auto-assign-bids`** (Deno, runs under service role so RLS cannot blind compliance) that runs the ported decision model and commits each winner via `sm_apply_shift_op('select_winner', expected_version)`. The client `handleAutoAssign` decision loop is **deleted**; the button becomes a thin call to `POST /functions/v1/auto-assign-bids`.
- **Why an Edge Function, not a PG function:** the compliance engine (`runV8Orchestrator`, `runBidSelection`) is TypeScript and cannot execute inside PostgreSQL. The Edge Function reuses it unchanged. PostgreSQL owns only the transactional commit + audit (via the gateway and the `sm_assignment_run_*` RPCs).
- **Why not a long-lived queue worker for v1:** manager-triggered, bounded by scope; synchronous Edge invocation with a resumable `assignment_runs` cursor is sufficient. Queue/`pg_cron` fan-out is a P2 scale lever, behind the same run model.

### D3 — Auto-Approve Swaps: event-driven Edge worker, shadow-first
DB trigger on `shift_swaps` entering `MANAGER_PENDING` enqueues a row into `swap_review_queue`. Edge Function `auto-approve-swaps` consumes it, runs `runSwapGuards` + `swapEvaluator.evaluate` + the configurable eligibility engine, then commits via `sm_apply_shift_op('approve_trade' | 'reject_trade')` or routes to manual review. **Ships in `shadow_mode` first** (decide + log, never act).

### D4 — Idempotency everywhere
Every automated decision is keyed. Re-delivery/re-click is a no-op via a `UNIQUE` idempotency key (formats in §5).

### D5 — Fail closed
Any engine/guard exception ⇒ never auto-approve / never auto-assign that item; route to manual (swaps) or skip+record (bids). Errors are recorded, not swallowed.

---

## 2. Existing primitives to REUSE (do not reimplement)

| Primitive | Location | Contract |
|---|---|---|
| `sm_apply_shift_op(p_shift_id uuid, p_expected_version integer, p_op text, p_payload jsonb DEFAULT '{}', p_idempotency_key uuid DEFAULT NULL)` | `supabase/migrations/20260621100200_sm_apply_shift_op.sql` (verified) | **Actor is derived from `auth.uid()` — there is NO `p_actor` param.** Authz → FOR UPDATE → CAS (`version <> p_expected_version` ⇒ `{ok:false, code:'VERSION_CONFLICT', current_version, current_state}`) → `fsm_op_is_legal(state, op)` guard → `_apply_shift_op_write` → append `shift_events`. Native `p_idempotency_key uuid` dedups replays. Returns `jsonb {ok, state, version, ...}`. |
| Gateway ops | same | `assign, publish, unpublish, select_winner, edit, delete, reject_trade, approve_trade`. **`select_winner` payload:** `{winner_id}` (fallback `employee_id`); legal at **S5/S6** per `fsm_op_is_legal`. **`approve_trade` payload:** `{compliance_ok:true}`. |
| `get_shift_fsm_state(p_lifecycle_status, p_assignment_status, p_assignment_outcome, p_trading_status, p_is_cancelled, p_bidding_status DEFAULT NULL)` | **canonical 6-arg override** at `20260610040949_canonical_get_shift_fsm_state.sql:16` (supersedes the 5-arg baseline at `20251015000000_baseline_schema.sql:7673`) | Canonical S-state; emits full S1–S15. `p_bidding_status` is a trailing DEFAULT NULL, so legacy 5-arg positional calls still resolve (`bidding NULL ⇒ Published+unassigned ⇒ S5`). **New code should pass the 6th `bidding_status` arg** to distinguish S5/S6 correctly. Never derive state any other way. |
| `fsm_op_is_legal(state text, op text)` | gateway migration | FSM legality. Extend here if a new op is added. |
| `shift_events(shift_id, actor_id, event_type, metadata jsonb, created_at)` | `20260621100000_shift_events_actor.sql` | Event sink. Auto-assign/auto-approve decisions also append a typed event here in addition to their own audit tables. |
| `runV8Orchestrator(input, opts)` | `src/modules/compliance/v8/orchestrator/index.ts` | Per-candidate compliance, `SIMULATED` mode. |
| `runBidSelection(BiddingInput)` | `src/modules/compliance/v8/orchestrator/bidding/index.ts` | Global greedy decision brain. **Port/host this in the Edge Function.** |
| `swapEvaluator.evaluate({partyA, partyB})` | `src/modules/compliance` (`@/modules/compliance`) | Simultaneous two-party solver → `{feasible, violations[]}`. |
| `runSwapGuards({shiftIds, employeeIds, currentSwapId, shiftSnapshot})` | `@/modules/compliance` | Entity/concurrency/lock/drift guards → `{passed, ...}`. |
| `fairnessLedgerService.getEmployeeDebts(orgId, empIds[])` | bidding UI import | Returns `[{employeeId, metric, debt}]`; metric of interest = `denied_preferences`. |
| `buildBidInput({...})` | bidding UI util | Builds v8 input. **Must be fixed to pass real `required_qualifications` + role (R4).** |

---

## 3. Shift facts (verified)

- `shifts.version int` — auto-incremented on every UPDATE by trigger. This is the CAS token.
- `shifts.scheduled_start timestamptz` — authoritative shift start (computed from `shift_date + start_time` in shift tz). Use for TTS: `tts_seconds = EXTRACT(EPOCH FROM (scheduled_start - now()))`.
- Soft-delete: `deleted_at`. Cancellation: `is_cancelled`.
- Enums: `shift_bidding_status` (`not_on_bidding, on_bidding_normal, on_bidding_urgent, on_bidding, bidding_closed_no_winner`), `shift_assignment_status` (`unassigned, assigned`), `shift_assignment_outcome` (`pending, offered, confirmed`), `shift_fulfillment_status`.
- Relevant FSM states: **S1** Draft+unassigned, **S4** Assigned, **S5** Published+OnBidding+unassigned, **S8** bidding closed, **S15** cancelled.
- An open-for-bidding shift = `S5` (`lifecycle=Published`, `assignment_status=unassigned`, `bidding_status IN on_bidding*`, `is_cancelled=false`, `deleted_at IS NULL`).
- The **4h time-lock** (TTS ≥ 4h) is a hard business rule. It must be enforced **server-side** in the gateway/engine, not only client-side.

---

## 4. Canonical NEW names (claim map — prevents collisions)

**Owned by 01 (Auto-Assign Bids):**
- Tables: `assignment_runs`, `assignment_decisions`, `assignment_events`.
- RPCs (PG, SECURITY DEFINER): `sm_assignment_run_start(...)`, `sm_assignment_run_finish(...)`, `sm_assignment_run_rollback(p_run_id uuid)`. **DEPLOYED (prod, migration `20260623134031`):** rollback is **single-arg** — actor is derived from `auth.uid()` internally (NULL under service role = system rollback; the caller must authorize first). Earlier drafts listed a `p_actor` second arg — that is NOT the deployed signature.
- Edge Function: `auto-assign-bids`.
- Deprecate: `sm_select_bid_winner` (kept as a thin wrapper that calls the gateway during transition, then dropped).
- Draft migration file: `docs/implementation/migrations-draft/0001_assignment_audit_and_engine.sql`.

**Owned by 02 (Auto-Approve Swaps):**
- Tables: `swap_approval_rules`, `swap_decisions`, `swap_audit_log`, `swap_review_queue`.
- RPCs: `sm_swap_auto_decide(p_swap_id uuid, p_idempotency_key text)`, `enqueue_swap_auto_decision()` (trigger fn), `sm_swap_auto_revert(p_decision_id uuid, p_actor uuid)`.
- Edge Function: `auto-approve-swaps`.
- Draft migration file: `docs/implementation/migrations-draft/0002_swap_auto_approve.sql`.

> 01 must NOT define swap_* objects; 02 must NOT define assignment_* objects. Cross-references by name only.

---

## 5. Idempotency key formats (binding)

- **Auto-assign per-decision:** human-readable `idempotency_key = run_id || ':' || shift_id` is stored in `assignment_decisions.idempotency_key`. The **gateway** call requires a `uuid`, so derive it deterministically: `extensions.uuid_generate_v5(run_id, shift_id::text)` (note `uuid_generate_v5` lives in the `extensions` schema, NOT `public`). A shift is decided at most once per run.
- **Auto-approve swap:** `idempotency_key = sha256(swap_id || ':' || requester_shift_version || ':' || offered_shift_version || ':' || policy_version)`. Drift (a version change) ⇒ new key ⇒ legitimate re-evaluation; duplicate delivery with same versions ⇒ no-op.

## 6. Decision enums (binding)

- Auto-assign per-shift outcome: `ASSIGNED | SKIPPED_NO_ELIGIBLE | SKIPPED_BLOCKED | SKIPPED_LOCKED | CONFLICT_RETRY | ERROR`.
- Auto-approve swap decision: `AUTO_APPROVE | MANUAL_REVIEW | AUTO_REJECT`.
- Run status: `PENDING | RUNNING | COMPLETED | PARTIALLY_FAILED | ROLLED_BACK | ABORTED`.

## 7. API surface (binding routes)

- `POST /functions/v1/auto-assign-bids` → body `{scope, dry_run, options}` → `{run_id}` (202) or full result if `dry_run`.
- `GET  /functions/v1/auto-assign-bids/run/{run_id}` → run + decisions.
- `POST /functions/v1/auto-assign-bids/run/{run_id}/rollback` → `sm_assignment_run_rollback`.
- `POST /functions/v1/auto-approve-swaps` (worker tick / manual kick) and DB-trigger enqueue.
- `PUT  /rest/v1/swap_approval_rules` (policy admin, RLS org-admin only).

## 8. Conventions

- Migrations: **expand/contract**, additive first, never destructive in the same deploy. New columns nullable or defaulted. Drafts live under `docs/implementation/migrations-draft/` and are **never** placed in `supabase/migrations/` by an agent (prod is live — humans promote drafts).
- All new RPCs are `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, and authorize the caller explicitly (cert-based; `is_manager_or_above()` is BROKEN in prod — use `app_access_certificates` with `access_level` + `is_active = true`, manager column is `user_id`).
- Priority ranks: **P0** = correctness/safety blockers (must ship before any auto action is trusted), **P1** = SSoT convergence + audit + scale, **P2** = optimization/fancy fairness/queue fan-out.
- Engine version stamping: every decision row records `engine_version` (git short sha or semver const) and `policy_version`.
