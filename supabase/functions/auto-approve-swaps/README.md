# auto-approve-swaps (Edge Function worker)

Drains `swap_review_queue` and decides each MANAGER_PENDING swap: **AUTO_APPROVE / MANUAL_REVIEW / AUTO_REJECT**. The decision *brain* runs here (TypeScript); the *commit* is owned by the DB (`sm_swap_auto_decide` → the `sm_apply_shift_op` gateway). Ships **shadow-first** and is **dormant** until an org opts in.

> Status: **NOT deployed.** Code + unit tests only. The DB side (tables, trigger, RPCs) is already live in prod (migrations `20260623140946`, `20260623143908`), but no org has an enabled policy, so the queue is empty and nothing runs.

---

## ⚠️ DEPLOYMENT STATUS — NOT deployable as-is (read before deploying)

This worker `import`s `@compliance/v8/swap-engine/...` (`runSwapGuards`,
`swapEvaluator`). **That tree is NOT vendored** — `_vendor/` holds only shims. Two
blockers, discovered 2026-06-24:

1. **Deno is not installed** in the build environment → a vendored bundle cannot be
   verified locally.
2. **No Edge Function in this project vendors the v8 TS engine.** The proven pattern is
   **DB-RPC delegation** (the deployed `evaluate-compliance` calls `check_shift_overlap`,
   `calculate_weekly_hours`, `validate_rest_period`, `check_shift_compliance`).

### Corrected approach before deploy — pick one

- **(A — recommended, deployable without Deno gymnastics)** Drop the
  `@compliance/...` imports. For a **2-way swap the constraints are per-employee** (no
  shared schedule), so call the deployed **`evaluate-compliance`** function once per
  party with that party's post-swap shift; treat `violated` → blocking, `warned` →
  WARNING. This is a sound decomposition of `swapEvaluator` for 2-way swaps and yields a
  worker shaped like the existing deployable functions (supabase-js + `fetch` + pure
  TS). Keep `eligibility.ts` + `decision-matrix.ts` unchanged.
- **(B — full fidelity, needs Deno)** Vendor `src/modules/compliance/v8/swap-engine/**`
  (+ its v8 deps) into `_vendor/compliance/`, fix extensions/aliases/`import.meta.env`,
  and `deno check`.

`eligibility.ts` + `decision-matrix.ts` (35 passing tests) are correct under either
approach. The DB layer is inert until an org enables a policy, so there is no urgency —
do it correctly. Everything else in this README (deploy command, cron, staging) applies
once the compliance integration is switched to approach A or B.

## Flow

```
shift_swaps → MANAGER_PENDING ──(enqueue trigger, only if an ENABLED policy exists)──▶ swap_review_queue
                                                                                          │
  cron POST every ~1m ─▶ this worker ─▶ sm_swap_queue_claim (SKIP LOCKED, bumps attempts)
                                          │  per claimed row (fail-closed try/catch):
                                          │   load swap + both shifts + both rosters (service role)
                                          │   recompute idempotency key (matches the trigger)
                                          │   runSwapGuards → swapEvaluator.evaluate → eligibility engine
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

1. **Compliance-engine vendoring is the gating item.** `runSwapGuards` / `swapEvaluator` are app TypeScript with browser-only deps (`@sentry/react`, `@/platform/supabase/client`, `import.meta.env`). This function reuses the `auto-assign-bids` vendor+shim pattern, but the **swap-engine subtree still needs to be vendored** into `_vendor/` (copy `src/modules/compliance/v8/swap-engine/**` + adapt `import.meta.env` → `Deno.env`). The `import_map.json` here redirects `@sentry/react` and `@/platform/supabase/client` to the shims; verify every transitive import resolves under Deno before deploy.
2. **Roster/shift column + signature assumptions** (no DB was called while building): `shifts.required_skills/required_licenses/scheduled_start/role_id`, the `ShiftTimeRange` mapping, and the exact `runSwapGuards`/`swapEvaluator.evaluate` return shapes must match the live schema and the current `swaps.api.ts` wiring.
3. **Idempotency parity.** The key is `sha256_hex(`${swap_id}:${req_ver}:${off_ver}:${policy_version}`)` (off_ver=0 for a giveaway) — it must stay byte-identical to the `enqueue_swap_auto_decision` trigger formula. If either side changes the string, dedup breaks. (Verified identical at build time.)
