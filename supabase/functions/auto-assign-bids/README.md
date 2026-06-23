# `auto-assign-bids` — Supabase Edge Function

Server-side worker that drains open-for-bidding shifts in a manager-supplied
scope and commits a winner for each through the existing
`sm_apply_shift_op('select_winner', …)` gateway with version-CAS. It builds one
consistent snapshot under the service role (open shifts + their pending bids +
F3 fairness debts), then **decides each shift per-bidder by calling the deployed
`evaluate-compliance` Edge Function over HTTP** — the first bidder whose result
is not `'violated'` wins.

Implements `docs/implementation/01-auto-assign-bids-refactor.md` §2 (orchestration)
and §8 (API), bound by `docs/implementation/00-contracts-and-conventions.md`
(decisions D1–D5; idempotency §5; enums §6; routes §7).

---

## ✅ DEPLOYMENT STATUS — APPROACH A (self-contained worker)

This function was refactored to **approach A** (2026-06-24): the vendored v8 TS
compliance engine was **dropped**. The function now imports ONLY
`@supabase/supabase-js`, Deno built-ins, and `./types.ts`, so it bundles under
Deno exactly like the other deployed functions (`evaluate-compliance`,
`autoschedule-*`, `get-roster-view`): supabase-js + `fetch` + pure local TS.

### What changed

- **Removed** the `@compliance/v8/orchestrator/bidding/...` + `../types` engine
  imports, `runBidSelection`/`runV8Orchestrator`, and the whole `_vendor/` tree
  (the sentry + supabase-client shims and the `@compliance/` import-map alias).
- **Replaced** the global decision model with a per-shift, per-bidder loop that
  mirrors the hardened CLIENT path (`OpenBidsView` `handleAutoAssign`): for each
  open shift (chronological), fetch its pending bids (FIFO, with F3 fairness-debt
  owed bidders first), and for each bidder POST `evaluate-compliance` with the
  SHIFT's `shift_date` / `start_time` / `end_time` / `net_length_minutes` +
  `shift_id` (so the qualification check runs) + `employee_id = bidder`. The first
  bidder whose `status !== 'violated'` wins (`'warned'` counts as eligible unless
  `options.reject_warnings`; `'unavailable'` is fail-closed = not eligible).
- **Kept intact:** the run model (`sm_assignment_run_start` → per-winner commit
  via the `sm_apply_shift_op` gateway → `assignment_decisions` /
  `assignment_events` → `sm_assignment_run_finish`), the dry-run path
  (`committed = false`, no gateway), the resumable cursor, the per-shift
  try/catch, and the bounded CAS retry on `VERSION_CONFLICT`.

### Tradeoff (documented approach-A cost)

The decision is necessarily **per-shift, first-clear-bidder**. We no longer run
`runBidSelection`'s *global* optimization (scoring across all shifts/bidders to
maximise total coverage). That is the accepted v1 cost of self-containment;
revisit with approach B (vendor + `deno check`) later if global optimality is
needed.

### Correctness caveat — compliance rule set

`evaluate-compliance` is **not** the v8 engine. It runs four DB-RPC checks:
overlap, **weekly hours capped at 48h** (`calculate_weekly_hours`), **11h rest**
(`validate_rest_period`), and qualification (`check_shift_compliance`). The v8
bidding engine enforced a broader/different rule set (e.g. fatigue streak /
20-in-28 / spread-of-hours / student-visa 48h windows). So a bidder this worker
clears may have failed a v8-only rule, and vice-versa. The 48h weekly cap here is
the AU default, not the v8 ordinary-hours model. This is acceptable for v1
because the deployed `sm_select_bid_winner` gateway re-enforces its own P0 guards
(time-lock, winner-pending, FSM legality) at commit regardless.

> **Status:** self-contained scaffold. The draft migration that creates
> `assignment_runs` / `assignment_decisions` / `assignment_events` and the
> `sm_assignment_run_*` RPCs lives at
> `docs/implementation/migrations-draft/0001_assignment_audit_and_engine.sql`
> and must be promoted to prod **before** this function will work end-to-end.
> `evaluate-compliance` is already deployed in prod.

---

## Routes (00 §7)

| Method | Path | Action |
|---|---|---|
| `POST` | `/functions/v1/auto-assign-bids` | Start a run. `{scope, dry_run, options}` → `202 {run_id, status, summary}`, or `200` full preview when `dry_run:true`. |
| `GET`  | `/functions/v1/auto-assign-bids/run/{run_id}` | Run + its decisions. |
| `POST` | `/functions/v1/auto-assign-bids/run/{run_id}/rollback` | Undo a run via `sm_assignment_run_rollback`. |

Request/response shapes are in [`types.ts`](./types.ts) and mirror 01 §8.

---

## Deploy

```bash
# from the repo root
supabase functions deploy auto-assign-bids
```

The function ships with its own [`import_map.json`](./import_map.json) (see
**Bundling** below). The supabase CLI picks it up automatically because it sits
beside `index.ts`. If your CLI version requires it to be explicit:

```bash
supabase functions deploy auto-assign-bids \
  --import-map supabase/functions/auto-assign-bids/import_map.json
```

JWT verification is performed **inside** the handler (we need the user id for the
cert check), and the snapshot/commit run under the service role. Deploy with the
default gateway JWT check **on**; the function additionally authorizes the caller
against `app_access_certificates`.

### Required env vars (set on the project, not committed)

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL. Auto-injected by the platform. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role for RLS-blind snapshot + gateway RPCs. Auto-injected. |
| `SUPABASE_ANON_KEY` | Used to build the *user-scoped* client that resolves the caller from the forwarded `Authorization` JWT. Auto-injected. |

No other secrets are required. `ENGINE_VERSION` / `POLICY_VERSION` are compile-time
constants stamped on every decision (00 §8).

---

## Bundling — self-contained (APPROACH A)

There is **nothing to vendor**. `index.ts` imports only:

- `@supabase/supabase-js` (pinned in `import_map.json` to `npm:@supabase/supabase-js@2.50.0`),
- Deno built-ins (`Deno.serve`, `Deno.env`, `fetch`, `crypto.subtle`, `TextEncoder`),
- `./types.ts` (pure local wire types).

No `@compliance`, no `_vendor/`, no shims, no `import.meta.env`. The function
bundles under Deno like `evaluate-compliance` / `autoschedule-*`. The only mapped
specifier in `import_map.json` is the supabase-js pin.

### How compliance is called

For each `(shift, bidder)` the worker POSTs to the deployed function:

```
POST ${SUPABASE_URL}/functions/v1/evaluate-compliance
  headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
             apikey: ${SERVICE_ROLE_KEY},
             'Content-Type': 'application/json' }
  body: { employee_id: <bidder>,
          shift_date, start_time:'HH:mm:ss', end_time:'HH:mm:ss',
          net_length_minutes: <gross − unpaid break>,
          shift_id: <shift.id>,                 // enables the qualification check
          override_role_id, override_skill_ids, override_license_ids }
```

Response `status`: `'violated'` = blocking (bidder out), `'warned'` = warning
(eligible unless `options.reject_warnings`), `'passed'` = clear, `'unavailable'`
= checks couldn't run (**fail-closed** ⇒ treated as not eligible). The first
bidder that is not blocked wins the shift. A `fetch`/HTTP failure is mapped to
`'unavailable'` so a transport blip never silently passes an ineligible bidder.

---

## Behaviour notes

- **Fail-closed (D5).** Every per-shift error is *recorded* (`outcome:'ERROR'`),
  never thrown. A compliance `'unavailable'`/`fetch` failure blocks that bidder
  (it does not auto-pass). The top-level handler catch aborts the run
  (`status:'ABORTED'`) and still returns structured JSON. A run is never left
  `RUNNING` on a throw.
- **Idempotency (D4, 00 §5).** Two layers: the gateway dedups on a deterministic
  UUIDv5 of `run_id:shift_id` (matched against `shift_events.metadata->>'idem'`),
  and `assignment_decisions` has `UNIQUE(run_id, shift_id)` with
  `ON CONFLICT DO NOTHING`. A resumed run never double-commits.
- **Ordering & concurrency (00 D1, 01 §5).** Shifts are decided + committed in
  `shift_date` order (then `shift_id` as tiebreak) so streak/window-style checks
  accumulate chronologically — matching the client loop. Within a shift, bidders
  are tried FIFO with F3 fairness-debt-owed bidders first. Each commit uses a
  bounded CAS retry (`MAX_CAS_ATTEMPTS=3`, 50/100/200 ms backoff + jitter); on
  `VERSION_CONFLICT` the worker re-reads the envelope's `current_state` and, if
  the shift is no longer `S5`/`S6`, records `SKIPPED_BLOCKED` instead of retrying.
- **Dry run.** Decides each shift (same per-bidder compliance calls) and persists
  decisions with `version_after=null`; never calls the gateway. Returns the full
  `preview[]` (01 §8.1).
- **Resumability (01 §2.5).** `assignment_runs.cursor = {last_shift_id}` advances
  after each decision; a re-invoke with the same `run_id` resumes after it.
