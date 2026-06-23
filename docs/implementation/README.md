# Auto-Assign Bids Refactor + Auto-Approve Swaps — Implementation Plan (Index)

**Date:** 2026-06-23 · **Mode:** Implementation architecture (the audit is in [../audits/auto-assign-bids-audit-and-auto-approve-swaps-design.md](../audits/auto-assign-bids-audit-and-auto-approve-swaps-design.md); this set moves from findings to a buildable plan).

This is a multi-document plan. Read [00-contracts-and-conventions.md](00-contracts-and-conventions.md) first — it is **binding** (canonical names, the gateway contract, idempotency formats, enums, P0/P1/P2 convention) and the other docs depend on it.

## Documents

| # | Doc | Owns | Size |
|---|---|---|---|
| 00 | [00-contracts-and-conventions.md](00-contracts-and-conventions.md) | Architecture decisions D1–D5, reused primitives, canonical names, idempotency, API routes | binding spec |
| 01 | [01-auto-assign-bids-refactor.md](01-auto-assign-bids-refactor.md) | SSoT decision, server engine, 10 mandatory fixes, fairness engine, concurrency, audit, API, rollback | Part 1 |
| 02 | [02-auto-approve-swaps.md](02-auto-approve-swaps.md) | Architecture, decision matrix, eligibility algorithms, abuse prevention, swap DB, swap backlog/deploy | Part 2 |
| 03 | [03-testing-strategy.md](03-testing-strategy.md) | 180 test cases (unit/integration/concurrency/security/load/recovery) + coverage matrix | Testing |
| 04 | [04-backlog-rollout-deployment.md](04-backlog-rollout-deployment.md) | Master backlog (E1–E10), effort estimates, migration strategy, feature flags, deployment, risk register | Delivery |
| — | [migrations-draft/0001_assignment_audit_and_engine.sql](migrations-draft/0001_assignment_audit_and_engine.sql) | `assignment_runs/decisions/events` + `sm_assignment_run_*` + hardened transitional `sm_select_bid_winner` | draft SQL |
| — | [migrations-draft/0002_swap_auto_approve.sql](migrations-draft/0002_swap_auto_approve.sql) | `swap_approval_rules/decisions/audit_log/review_queue` + enqueue trigger + `sm_swap_auto_decide/revert` | draft SQL |

> **Draft migrations are NOT in `supabase/migrations/`.** Prod is live; a human promotes drafts via the expand/contract sequence in [04 §3](04-backlog-rollout-deployment.md). The draft SQL passed a structural lint (balanced dollar-quotes, tables/functions/triggers/policies present) but has **not** been executed against a database.

## The architecture in one paragraph

**One write path, one decision brain per feature, server-side, fail-closed.** Every assignment/swap mutation goes through the already-hardened `sm_apply_shift_op` gateway (optimistic version-CAS + canonical `get_shift_fsm_state`/`fsm_op_is_legal` guard + `shift_events` sourcing). Auto-Assign's two divergent engines collapse into a single server-side Edge Function (`auto-assign-bids`) that hosts the pure `runBidSelection` decision model and commits each winner through the gateway's `select_winner` op; the client decision loop is deleted. Auto-Approve Swaps is a new event-driven Edge worker (`auto-approve-swaps`) that reuses the existing `runSwapGuards` + `swapEvaluator` and commits via the gateway's `approve_trade`/`reject_trade` ops, shipping in shadow mode first. Both record an immutable, idempotent decision + audit row and support admin rollback/revert.

## Requested output-format → where it lives

| Requested deliverable | Location |
|---|---|
| 1. Target Architecture | 00 §1, 01 §1–§2, 02 §1, this README |
| 2. Migration Strategy | 04 §3 (expand/contract M1–M8) |
| 3. Database Changes | 01 §6–§7 + 0001.sql; 02 §5 + 0002.sql |
| 4. API Contracts | 00 §7, 01 §8 (bids), 02 §1 + RPCs |
| 5. Service Design | 01 §2 (engine), 02 §1 (worker), §3 (eligibility) |
| 6. Concurrency Design | 01 §5 (CAS, retry, deadlock, sequence diagrams), 02 §1 (queue/SKIP LOCKED) |
| 7. Rollback Design | 01 §9 (`sm_assignment_run_rollback`), 02 (`sm_swap_auto_revert`) |
| 8. Engineering Backlog | 04 §1–§2 (E1–E10, estimates), 02 §6 (swap slice) |
| 9. Testing Strategy | 03 (180 cases + coverage matrix) |
| 10. Deployment Plan | 04 §5 + §6; 02 §7 (swap rollout) |

## Final opinionated decisions (no alternatives)

- **D1** All assignment/swap writes route through `sm_apply_shift_op`. `sm_select_bid_winner` is hardened transitionally, then dropped (04 M8).
- **D2** Auto-Assign = **merge** both engines into one **Edge Function** running the ported `runBidSelection` brain; client loop deleted. (Edge, not PG function, because the TS compliance engine cannot run in Postgres.)
- **D3** Auto-Approve Swaps = event-driven Edge worker, **shadow-first**, reusing the existing solver + guards + gateway. No new rule engine.
- **D4** Idempotency on every automated decision (formats in 00 §5). **D5** Fail closed on any engine/guard error.

## Execution order (from 04 §6)

- **Sprint 1 — P0 safety floor:** harden the write path (E1) + assignment audit tables (E3) before any automated commit is trusted. This alone closes the audit's Critical/High data-integrity findings (double-assign, ghost-assign, withdrawn-revival, window-lock bypass, qual bypass).
- **Sprint 2–3 — P1:** server-side Auto-Assign engine (E2) + fairness (E4) + swap policy/queue/worker in shadow (E5/E6).
- **Sprint 4–5 — P1/P2:** abuse prevention (E7), observability (E8), admin UI (E9), staged rollout + contract migration (E10).

Total estimate (04 §2): **~178.5 dev-days**, ~5 two-week sprints with 2 BE / 1 FE / 1 DB-leaning BE / 1 QA; critical path is the Auto-Assign Edge engine chain (E2 → cutover → rollback → contract-drop).

## Open items for the human reviewer

1. Promote draft migrations only after executing them against a Supabase **branch/test** project (they are unrun). Honor the `ALTER TYPE ADD VALUE` split rule (04 §3).
2. Confirm `app_access_certificates.organization_id` exists for the swap policy RLS (02 assumption); else join through `profiles`.
3. Confirm `sm_approve_peer_swap` is symmetric for the swap-revert inverse reassignment (02 assumption).
4. The compliance engine is currently client-side TypeScript; the Edge Function must bundle it (Deno) — verify the v8 orchestrator has no browser-only deps.
