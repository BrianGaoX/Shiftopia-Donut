# auto-approve-swaps (Edge Function worker)

Drains `swap_review_queue` and decides each MANAGER_PENDING swap: **AUTO_APPROVE / MANUAL_REVIEW / AUTO_REJECT**. The decision *brain* runs here (TypeScript); the *commit* is owned by the DB (`sm_swap_auto_decide` → the `sm_apply_shift_op` gateway). Ships **shadow-first** and is **dormant** until an org opts in.

> Status: **NOT deployed** (but now deployable). Code + unit tests only. The DB side (tables, trigger, RPCs) is already live in prod (migrations `20260623140946`, `20260623143908`), but no org has an enabled policy, so the queue is empty and nothing runs.

---

## ✅ COMPLIANCE STRATEGY — APPROACH A (implemented)

This worker no longer vendors the v8 TS compliance engine. It is **self-contained**
(supabase-js + `fetch` + pure local TS) and calls the already-deployed
**`evaluate-compliance`** Edge Function over HTTP, **once per swap party**:

- **Party A (requester)** RECEIVES the offered/target shift, GIVES UP their own:
  `evaluate-compliance { employee_id: requester_id, <target shift facts>,
  shift_id: target_shift_id, exclude_shift_id: requester_shift_id }`
- **Party B (offerer/target)** RECEIVES the requester shift, GIVES UP theirs:
  `evaluate-compliance { employee_id: target_id, <requester shift facts>,
  shift_id: requester_shift_id, exclude_shift_id: target_shift_id }`

For a 2-way swap the constraints are **per-employee** (no shared schedule), so the v8
`swapEvaluator` decomposes cleanly into these two independent calls. `exclude_shift_id`
removes the shift each party gives up from the overlap/hours math. For a **giveaway**
(no `target_shift_id`) only Party B is evaluated (receiving the requester shift).
`violated` on either party ⇒ solver BLOCKING; `warned` ⇒ WARNING; both `passed` ⇒ PASS.
A transport failure or `unavailable` verdict is **fail-closed** (treated as BLOCKING).

The old `runSwapGuards` entity/lock/drift checks are covered downstream: the gateway
`approve_trade` re-checks the 4h time-lock + version-CAS at commit, and loading the rows
covers existence. The worker keeps a small **inline** not-found / 4h-time-lock guard and
delegates the rest to the gateway.

> Imports are limited to: `npm:@supabase/supabase-js@2.50.0`, Deno built-ins
> (`Deno.serve`, `Deno.env`, `crypto.subtle`, `fetch`, `TextEncoder`), and the colocated
> pure modules `./eligibility.ts`, `./decision-matrix.ts`, `./types.ts`. No `@compliance`,
> no `_vendor/` engine, no browser-only shims. `import_map.json` maps only supabase-js.

**Correctness caveat:** `evaluate-compliance` runs a FIXED rule set — overlap +
weekly-hours (**48h**) + rest (**11h**) + qualification — via DB RPCs. The v8 swap solver
had a richer rule set (daily-hours, 20-in-28, streak limit, spread-of-hours, etc.). The
always-on eligibility gates (certification / fatigue / overlap) and the gateway still
apply, but auto-APPROVE under Approach A reflects only the 48h/11h/overlap/qual checks,
not the full v8 constraint catalogue. This is acceptable for the shadow-first rollout
(below); revisit before enabling live auto-approve broadly.

`eligibility.ts` + `decision-matrix.ts` (35 passing tests) are unchanged. Everything else
in this README (deploy command, cron, staging) applies as-is.

## Flow

```
shift_swaps → MANAGER_PENDING ──(enqueue trigger, only if an ENABLED policy exists)──▶ swap_review_queue
                                                                                          │
  cron POST every ~1m ─▶ this worker ─▶ sm_swap_queue_claim (SKIP LOCKED, bumps attempts)
                                          │  per claimed row (fail-closed try/catch):
                                          │   load swap + both shifts + both rosters (service role)
                                          │   recompute idempotency key (matches the trigger)
                                          │   inline guards → evaluate-compliance ×(1–2 parties) → eligibility engine
                                          │   decision-matrix → { decision, reason, confidence }
                                          │   sm_swap_auto_decide(swap_id, idemKey, payload)
                                          │     ↳ RPC owns: idempotency dedup, shadow suppression,
                                          │        kill-switch, gateway approve_trade/reject_trade,
                                          │        swap_decisions + swap_audit_log writes
                                          └─▶ sm_swap_queue_complete(id, DONE | RETRY | DLQ)
```

`sm_swap_queue_complete('RETRY')` applies exponential backoff and auto-promotes to **DLQ** at `max_attempts`. Anything the worker can't decide cleanly fails **closed** (RETRY → eventually MANUAL_REVIEW via DLQ).

## Deploy

```bash
supabase functions deploy auto-approve-swaps --no-verify-jwt   # uses X-Worker-Secret, not a user JWT
supabase secrets set WORKER_SECRET=<random-32-bytes>
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
```

Env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto), `WORKER_SECRET` (required to authorize the cron caller), `SWAP_WORKER_BATCH_SIZE` (default 10).

## Cron trigger

Invoke `POST /functions/v1/auto-approve-swaps` every ~1 minute with header `X-Worker-Secret: <WORKER_SECRET>`. Use Supabase Scheduled Functions or `pg_cron` + `net.http_post`. The handler is idempotent and safe to run concurrently (queue claiming is `SKIP LOCKED`).

## Unit tests (pure logic)

The decision matrix + eligibility engine are pure and unit-tested (the root vitest only includes `src/**`, so use the colocated config):

```bash
npx vitest run --config supabase/functions/auto-approve-swaps/vitest.config.ts   # 35 tests
```

## Turning it on (staged)

1. Deploy + schedule the cron (above). With no policy rows, the trigger still does nothing.
2. **Shadow:** insert a `swap_approval_rules` row for an org with `enabled=true, shadow_mode=true`. Now MANAGER_PENDING swaps enqueue; the worker evaluates and writes `swap_decisions` + `swap_audit_log` with `SHADOW_SUPPRESSED` — but **never acts**. Compare logged decisions against what managers actually did.
3. **Live (per dept):** when agreement is high, set `shadow_mode=false` (optionally a dept-scoped row). The worker now commits via the gateway. Kill-switch = `enabled=false`; undo a bad auto-approve = `sm_swap_auto_revert(decision_id, actor)`.

## Integration risks a human must resolve before deploy

1. **Compliance fidelity (Approach A).** `evaluate-compliance` enforces a FIXED rule set — overlap + weekly-hours (48h) + rest (11h) + qualification — which is a subset of the v8 swap solver's catalogue. See the "Correctness caveat" above. Acceptable for the shadow rollout; re-evaluate before broad live auto-approve.
2. **Roster/shift column assumptions** (no DB was called while building): `shifts.required_skills/required_licenses/role_id/unpaid_break_minutes` and the `remuneration_levels(hourly_rate_min)` join must match the live schema and the current `swaps.api.ts` wiring. The `evaluate-compliance` request body keys are validated against `compliance.service.ts` (`employee_id`, `shift_date`, `start_time`, `end_time`, `net_length_minutes`, `exclude_shift_id`, `shift_id`, `override_*`).
3. **Idempotency parity.** The key is `sha256_hex(`${swap_id}:${req_ver}:${off_ver}:${policy_version}`)` (off_ver=0 for a giveaway) — it must stay byte-identical to the `enqueue_swap_auto_decision` trigger formula. UNCHANGED by this refactor. If either side changes the string, dedup breaks. (Verified identical at build time.)
