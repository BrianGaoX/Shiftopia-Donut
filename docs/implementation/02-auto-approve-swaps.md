# 02 — Auto-Approve Swap Requests (Implementation Plan)

**Status:** Production implementation plan. Binds to [00-contracts-and-conventions.md](00-contracts-and-conventions.md) (D3/D4/D5, idempotency §5, enums §6, claim map §4) and extends [the audit/design §6](../audits/auto-assign-bids-audit-and-auto-approve-swaps-design.md). The cross-feature master backlog lives in doc 04 — this doc owns the **swap-specific** slice only.

**Non-negotiables (from contracts):**
- Reuse [`runSwapGuards`](../../src/modules/compliance/v8/swap-engine/guards.ts) + [`swapEvaluator.evaluate`](../../src/modules/compliance/v8/swap-engine/swap-evaluator.ts) + the [`sm_apply_shift_op`](../../supabase/migrations/20260621100200_sm_apply_shift_op.sql) gateway. **Do not build a new rule engine.** The auto-approver is orchestration + policy only.
- **Fail closed** (D5): any guard/solver/data exception ⇒ `MANUAL_REVIEW`, never `AUTO_APPROVE`.
- **Single architecture, no menus.** One event-driven Edge worker, shadow-first.
- Decision enum (00 §6): `AUTO_APPROVE | MANUAL_REVIEW | AUTO_REJECT`.

DDL for the four tables + trigger + RPCs lives in [`migrations-draft/0002_swap_auto_approve.sql`](migrations-draft/0002_swap_auto_approve.sql) and is summarized in §5.

---

## 1. Architecture

### 1.1 Trigger points & event flow

The swap already transitions to `MANAGER_PENDING` inside [`sm_accept_trade`](../../src/modules/planning/swapping/api/swaps.api.ts#L853) (called from [`acceptTrade`](../../src/modules/planning/swapping/api/swaps.api.ts#L806)). We hook **that DB state change**, not the client:

- **DB trigger** `trg_enqueue_swap_auto_decision` (`AFTER INSERT OR UPDATE OF status ON shift_swaps`) fires when a row enters `MANAGER_PENDING`. Its function [`enqueue_swap_auto_decision()`](migrations-draft/0002_swap_auto_approve.sql) reads both shift `version`s + the resolved `policy_version`, computes the idempotency key (00 §5), and inserts one row into `swap_review_queue` (`ON CONFLICT (swap_id, idempotency_key) DO NOTHING`). This is the **outbox** — it is transactional with the `MANAGER_PENDING` write, so a swap can never become pending without being enqueued.
- **Edge Function** [`auto-approve-swaps`](00-contracts-and-conventions.md) (Deno, service role — RLS cannot blind compliance) is the worker. It is invoked on a `pg_cron` tick **and** can be manually kicked via `POST /functions/v1/auto-approve-swaps` (00 §7). It claims queue rows with `FOR UPDATE SKIP LOCKED`, runs the TS pipeline (guards → solver → eligibility → decision matrix), then calls `sm_swap_auto_decide(swap_id, idempotency_key, payload)` to commit transactionally.
- **Why Edge, not pure PG:** `runSwapGuards`/`swapEvaluator` are TypeScript and cannot execute inside PostgreSQL (mirrors D2 for bids). PG owns only the transactional commit + audit via the RPC + gateway.

### 1.2 Queue processing — at-least-once + idempotency + DLQ

- **At-least-once:** the queue guarantees delivery; correctness comes from idempotency, not exactly-once delivery.
- **Idempotency:** `idempotency_key = sha256(swap_id : requester_shift_version : offered_shift_version : policy_version)` (00 §5). `sm_swap_auto_decide` upserts `swap_decisions` on this `UNIQUE` key — a duplicate delivery with identical versions is a no-op (`IDEMPOTENT_REPLAY`). A version drift on either shift changes the key ⇒ a legitimate fresh evaluation.
- **Backoff:** `attempts`, `max_attempts` (default 5), `next_attempt_at` drive exponential backoff. `locked_by`/`locked_at` make a stale claim (crashed worker) reclaimable after a lease timeout.
- **DLQ → manual review:** after `max_attempts`, the worker flips the queue row to `DLQ` **and** writes a `MANUAL_REVIEW` decision + sets `shift_swaps.review_flag = true`. A swap that the system cannot decide is never silently dropped — it lands on a manager.

### 1.3 Failure recovery (fail-closed)

| Failure | Recovery |
|---|---|
| Guard throws / `SwapGuardError` | Decision = `AUTO_REJECT` if the guard is a hard invalidity (cancelled/locked/drift); otherwise the worker treats an unexpected throw as fail-closed → `MANUAL_REVIEW`. |
| Solver throws | Fail closed → `MANUAL_REVIEW`. Never approve on a solver exception. |
| Roster/data load error | Requeue with backoff; after `max_attempts` → DLQ → `MANUAL_REVIEW`. |
| Gateway `VERSION_CONFLICT` (drift between eval & commit) | Not committed; requeue. The next claim recomputes versions ⇒ new key ⇒ clean re-eval. |
| Gateway `ILLEGAL_TRANSITION` (swap no longer `MANAGER_PENDING`) | No-op; audit `SKIPPED_NOT_PENDING`. |
| Worker crash mid-RPC | The RPC is one txn (audit ↔ gateway op atomic) — no partial commit. Queue redelivery is idempotent. |
| Policy row missing / `enabled=false` (kill-switch) | `DISABLED` — no auto action; shadow logging only if a row exists with `shadow_mode`. |

### 1.4 End-to-end diagram (ASCII)

```
 employee accepts offer
        │  swaps.api.acceptTrade ─► RPC sm_accept_trade
        ▼
 shift_swaps.status = MANAGER_PENDING ───────────────┐  (same txn)
        │                                            │
        ▼  trg_enqueue_swap_auto_decision (AFTER)     │
 enqueue_swap_auto_decision():                        │
   key = sha256(swap:reqVer:offVer:polVer)            │  outbox is
   INSERT swap_review_queue (PENDING)  ◄──────────────┘  transactional
   INSERT swap_audit_log 'ENQUEUED'
        │
        ▼  pg_cron tick  /  POST /functions/v1/auto-approve-swaps
 ┌──────────────── Edge worker  auto-approve-swaps (service role) ───────────────┐
 │ claim:  UPDATE swap_review_queue SET status=CLAIMED, locked_by=…              │
 │         WHERE status=PENDING AND next_attempt_at<=now() … FOR UPDATE SKIP LOCKED│
 │ load:   swap + both shifts + both rosters (SECURITY DEFINER reads)            │
 │ guards: runSwapGuards({shiftIds, employeeIds, currentSwapId, shiftSnapshot})  │
 │ solver: swapEvaluator.evaluate({partyA, partyB}) ─► SolverResult              │
 │ rules:  eligibility engine (configurable predicates, §3)                     │
 │ matrix: AUTO_APPROVE | MANUAL_REVIEW | AUTO_REJECT  (§2)                      │
 │ commit: sm_swap_auto_decide(swap_id, key, payload)  ── ONE txn ──┐           │
 │           upsert swap_decisions (UNIQUE key)                      │           │
 │           respect enabled(kill-switch)+shadow_mode               │           │
 │           AUTO_APPROVE → sm_apply_shift_op(approve_trade,CAS)    │           │
 │           AUTO_REJECT  → sm_apply_shift_op(reject_trade)         │           │
 │           MANUAL_REVIEW→ review_flag=true (stay MANAGER_PENDING) │           │
 │           write swap_audit_log                                   │           │
 │ on ok → queue DONE; on conflict → requeue; >max → DLQ+MANUAL ◄───┘           │
 └──────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
 notifications (existing trg_swap_outcome_notification) + metrics
```

### 1.5 Swap state machine, extended with the auto-decision branch (ASCII)

```
 OPEN ──accept offer (sm_accept_trade)──► MANAGER_PENDING
   │                                            │
 cancel                          ┌──────────────┴───────────────┐
   ▼                             │                              │
 CANCELLED          manual approve/reject          [AUTO-DECISION BRANCH]
                             │                              │
                             ▼              ┌───────────────┼───────────────┐
                       APPROVED/REJECTED    │               │               │
                                       AUTO_APPROVE    MANUAL_REVIEW    AUTO_REJECT
                                            │               │               │
                       sm_apply_shift_op(   │     review_flag=true     sm_apply_shift_op(
                        approve_trade,CAS)  │   stays MANAGER_PENDING    reject_trade)
                                            ▼          (manager acts)        ▼
                                        APPROVED         │                REJECTED
                                                         ▼
                            shadow_mode: decide+log, NO transition (stays MANAGER_PENDING)

 expiry (expires_at) ───────────────────────────────────────────────► EXPIRED
   (auto-approver skips a non-MANAGER_PENDING swap: SKIPPED_NOT_PENDING)
```

Decision sub-states (audit only, never persisted on the swap row):
`ENQUEUED → CLAIMED → {GUARDS_FAILED|ELIGIBILITY_*|SOLVER_*} → DECIDED_{APPROVE|REJECT|REVIEW} → {COMMITTED|GATEWAY_REFUSED|SHADOW_SUPPRESSED|DLQ|REVERTED}`.

---

## 2. Decision Matrix (complete)

`G` = `runSwapGuards` result, `E` = eligibility predicates (each rule has a `mode`), `C` = `swapEvaluator` solver verdict (`PASS` / `WARNING` / `BLOCKING`). Gating rows (kill-switch, shadow, confidence, rate-limit) are evaluated **around** the core matrix.

### 2.1 Pre-gates (evaluated first, short-circuit)

| # | Condition | Outcome |
|---|---|---|
| P1 | Policy row missing OR `enabled=false` (kill-switch) | **No auto action.** Audit `KILLSWITCH_OFF`. Swap stays `MANAGER_PENDING` for a human. |
| P2 | `shadow_mode = true` | Compute the would-be decision, write `swap_decisions(shadow=true, committed=false)`, audit `SHADOW_SUPPRESSED`. **No shift change.** |
| P3 | Swap no longer `MANAGER_PENDING` (withdrawn/expired/already decided) | No-op, audit `SKIPPED_NOT_PENDING`. |

### 2.2 Core matrix (per eligibility rule × guard × solver)

For each configurable rule in §3, the rule's **mode** maps a rule *failure* to a contribution: `REQUIRE_EQUAL`/`AUTO_REJECT_IF_FAIL` → reject-vote; `ROUTE_TO_REVIEW_IF_FAIL` → review-vote; `IGNORE` → no contribution. Always-on rules behave as `AUTO_REJECT_IF_FAIL`. The aggregate is resolved **reject > review > approve**.

| Guards `G` | Eligibility `E` | Solver `C` | Decision | Rationale |
|---|---|---|---|---|
| Fail (any `GuardViolation`) | — | — | **AUTO_REJECT** | Stale/drifted/locked/cancelled/concurrent (00-audit §6.5). Reason = guard codes. |
| Pass | Any always-on rule fails (compliance/fatigue/overlap/time-lock/cert) | — | **AUTO_REJECT** | Legal/safety gate; never operator-disabled. |
| Pass | Any `REQUIRE_EQUAL` rule fails (role/location) | — | **AUTO_REJECT** | Coverage integrity. |
| Pass | Any `AUTO_REJECT_IF_FAIL` rule fails (availability) | — | **AUTO_REJECT** | Cannot work when unavailable. |
| Pass | No reject-vote; ≥1 `ROUTE_TO_REVIEW_IF_FAIL` rule fails (skill/duration/pay/OT/coverage) | `PASS`/`WARNING` | **MANUAL_REVIEW** | Operational judgement; manager decides. |
| Pass | All rules pass / `IGNORE` | `BLOCKING` | **AUTO_REJECT** | Solver blocking = labor-law breach. |
| Pass | All rules pass | `WARNING` + `auto_approve_warnings=false` | **MANUAL_REVIEW** | Default-safe. |
| Pass | All rules pass | `WARNING` + `auto_approve_warnings=true` | **AUTO_APPROVE** *(then confidence/rate gates)* | Org opted in to warnings. |
| Pass | All rules pass | `PASS` | **AUTO_APPROVE** *(then confidence/rate gates)* | Clean. |

### 2.3 Post-gates (only an `AUTO_APPROVE` candidate is subject to these)

| # | Condition | Outcome |
|---|---|---|
| G1 (confidence) | `confidence < confidence_min` | Downgrade **AUTO_APPROVE → MANUAL_REVIEW**. Confidence = `1.0` on clean PASS, reduced per ROUTE-flagged/WARNING signal (see §3.10). |
| G2 (rate-limit) | Either party's committed `AUTO_APPROVE` count in the rolling week ≥ `max_auto_per_employee_per_week` | Downgrade **→ MANUAL_REVIEW**. Abuse brake (§4). |
| G3 (abuse: mutual-favoritism / cycle) | Pairwise frequency or cycle detection fires (§4) | Downgrade **→ MANUAL_REVIEW** (or `AUTO_REJECT` for a detected laundering cycle). |

A candidate that survives P1–P3, the core matrix, and G1–G3 is the only path to a committed `AUTO_APPROVE`.

---

## 3. Eligibility Engine — algorithms

The engine is a **deterministic pure function** `evaluateEligibility(ctx, policy) → EligibilityResult` run in the Edge worker. It does **not** re-implement compliance/fatigue — those are delegated to `swapEvaluator`. It only encodes the operational/policy predicates and the payroll delta. Each rule returns `{ ruleId, status: 'pass'|'fail', mode, detail }`.

```ts
type RuleMode = 'REQUIRE_EQUAL' | 'AUTO_REJECT_IF_FAIL' | 'ROUTE_TO_REVIEW_IF_FAIL' | 'IGNORE';
interface RuleOutcome { ruleId: string; status: 'pass'|'fail'; mode: RuleMode; detail: Record<string,unknown>; }
interface EligibilityResult {
  outcomes: RuleOutcome[];
  rejectVotes: RuleOutcome[];   // REQUIRE_EQUAL/AUTO_REJECT_IF_FAIL failures
  reviewVotes: RuleOutcome[];   // ROUTE_TO_REVIEW_IF_FAIL failures
  payrollDelta: { requesterDeltaPerHour: number; offererDeltaPerHour: number; estCostDelta: number };
  confidence: number;           // 1.0 → 0.0
}
```

Inputs available in `ctx`: requester shift `Rs`, offered shift `Os`, requester `Ra`, offerer `Ob`, both rosters (already loaded for the solver), org/dept catalogs (role, remuneration level, sub-department/location), and the merged `policy.rules`.

**Always-on (cannot be configured away; engine forces `AUTO_REJECT_IF_FAIL`):** compliance (solver blocking), fatigue (rest gap / consecutive days — delegated to `swapEvaluator`), schedule overlap, 4h time-lock, certification.

### 3.1 Role matching — default `REQUIRE_EQUAL`
- **Inputs:** `Rs.role_id`, `Os.role_id`.
- **Logic:** `pass ⇔ Rs.role_id === Os.role_id`.
- **Modes:** `REQUIRE_EQUAL` (fail→reject), `ROUTE_TO_REVIEW_IF_FAIL`, `IGNORE`.
```ts
const sameRole = Rs.role_id === Os.role_id;
emit('same_role', sameRole ? 'pass' : 'fail', mode, { rs: Rs.role_id, os: Os.role_id });
```

### 3.2 Qualification / certification matching — **always-on**, `AUTO_REJECT_IF_FAIL`
- **Inputs:** each shift's `required_skills`/`required_licenses` (jsonb), the *incoming* employee's held certs.
- **Logic:** after the swap, `Ra` works `Os` and `Ob` works `Rs`. Each incoming worker must hold **every** required cert of the shift they pick up.
```ts
const reqOk = requiredCerts(Os).every(c => heldCerts(Ra).has(c));
const offOk = requiredCerts(Rs).every(c => heldCerts(Ob).has(c));
emit('certification', reqOk && offOk ? 'pass' : 'fail', 'AUTO_REJECT_IF_FAIL',
     { missing_requester: diff(requiredCerts(Os), heldCerts(Ra)), missing_offerer: diff(requiredCerts(Rs), heldCerts(Ob)) });
```
Never auto-approve an uncertified pickup — closes audit gap F-5 / R4.

### 3.3 Location / site validation — default `REQUIRE_EQUAL`
- **Inputs:** `Rs.sub_department_id` (site/location proxy), `Os.sub_department_id`.
- **Logic:** `pass ⇔ same sub_department_id` (or same `department_id` if policy param `location_grain='department'`).
```ts
const grain = policy.rules.same_location?.params?.grain ?? 'sub_department';
const sameLoc = grain === 'department' ? Rs.department_id === Os.department_id : Rs.sub_department_id === Os.sub_department_id;
emit('same_location', sameLoc ? 'pass' : 'fail', mode, { grain });
```

### 3.4 Pay-rate validation + payroll delta — default `ROUTE_TO_REVIEW_IF_FAIL`
- **Inputs:** each shift's `remuneration_levels.hourly_rate_min`, paid minutes.
- **Logic:** `pass ⇔ |rate(Rs) - rate(Os)| <= tolerance`. **Always** compute the delta (even on pass) for the audit.
```ts
const rRs = rate(Rs), rOs = rate(Os);
const tol = policy.rules.same_pay_rate?.params?.tolerance ?? 0;
const pass = Math.abs(rRs - rOs) <= tol;
// After swap: requester earns Os rate on Os hours; offerer earns Rs rate on Rs hours.
const requesterDeltaPerHour = rOs - rRs;
const offererDeltaPerHour   = rRs - rOs;
const estCostDelta = (rOs * paidHours(Os) + rRs * paidHours(Rs)) - (rRs * paidHours(Rs) + rOs * paidHours(Os)); // org-cost neutral on pure swap; nonzero on duration diff
emit('same_pay_rate', pass ? 'pass' : 'fail', mode, { rRs, rOs, tol });
result.payrollDelta = { requesterDeltaPerHour, offererDeltaPerHour, estCostDelta };
```
Surfacing `payrollDelta` in the audit closes audit risk §6.7 *Payroll*.

### 3.5 Shift-duration tolerance — default `ROUTE_TO_REVIEW_IF_FAIL` (±X min)
```ts
const tol = policy.rules.same_duration?.params?.tolerance_min ?? 30;
const pass = Math.abs(paidMinutes(Rs) - paidMinutes(Os)) <= tol;
emit('same_duration', pass ? 'pass' : 'fail', mode, { rs: paidMinutes(Rs), os: paidMinutes(Os), tol });
```

### 3.6 Fatigue compliance (rest gap / consecutive days) — **always-on**, delegated
- **Do not re-implement.** Read the relevant `ConstraintViolation`s out of the `swapEvaluator` `SolverResult` (rest-gap and consecutive-days constraints already run there). A `blocking` fatigue violation ⇒ `AUTO_REJECT` via the core matrix.
```ts
const fatigueHits = solver.violations.filter(v => isFatigueRule(v.constraint_id) && v.blocking);
emit('fatigue', fatigueHits.length === 0 ? 'pass' : 'fail', 'AUTO_REJECT_IF_FAIL', { hits: fatigueHits.map(h => h.constraint_id) });
```

### 3.7 Overtime compliance — default `ROUTE_TO_REVIEW_IF_FAIL`
- **Logic:** read the solver's weekly/daily-hours constraint outcomes. A non-blocking OT *warning* routes to review by default; a blocking OT breach is a solver `BLOCKING` → reject.
```ts
const otWarn = solver.warnings.some(v => isOvertimeRule(v.constraint_id));
emit('overtime', otWarn ? 'fail' : 'pass', mode, { ot: otWarn });
```

### 3.8 Schedule-conflict / overlap detection — **always-on**, `AUTO_REJECT_IF_FAIL`
- **Inputs:** incoming worker's existing roster vs the picked-up shift's `[start_at, end_at]`.
- **Logic:** classic interval overlap on each party's *post-swap* schedule.
```ts
const overlaps = (a, b) => a.start_at < b.end_at && b.start_at < a.end_at;
const reqClash = rosterMinus(Ra, Rs).some(s => overlaps(s, Os));
const offClash = rosterMinus(Ob, Os).some(s => overlaps(s, Rs));
emit('overlap', reqClash || offClash ? 'fail' : 'pass', 'AUTO_REJECT_IF_FAIL', { reqClash, offClash });
```
(The solver also checks overlap; this is the always-on engine-side belt-and-braces.)

### 3.9 Team-coverage protection (min-staffing post-swap) — default `ROUTE_TO_REVIEW_IF_FAIL`
- **Inputs:** for the donor shift's slot (date × sub-department × role × time-band), the count of assigned staff *after* the swap vs the configured floor.
- **Logic:** a pure 1:1 swap is coverage-neutral *unless* role/location differs — covered by §3.1/§3.3. The real risk is a **giveaway** (target_shift NULL) or a role-changing swap dropping a slot below floor.
```ts
const floor = minStaffing(Rs.date, Rs.sub_department_id, Rs.role_id, policy);
const after = staffCount(slotOf(Rs)) - (Rs.role_id !== Os.role_id ? 1 : 0);
emit('team_coverage', after >= floor ? 'pass' : 'fail', mode, { floor, after });
```

### 3.10 Availability validation — default `AUTO_REJECT_IF_FAIL`
- **Inputs:** incoming worker's `availabilities` + active status for the picked-up shift's window.
```ts
const reqAvail = isAvailable(Ra, Os) && isActive(Ra);
const offAvail = isAvailable(Ob, Rs) && isActive(Ob);
emit('availability', reqAvail && offAvail ? 'pass' : 'fail', mode, { reqAvail, offAvail });
```

### 3.11 Confidence
`confidence = 1.0` then `−0.15` per `ROUTE_TO_REVIEW_IF_FAIL` flag and `−0.25` per solver WARNING, floored at 0. Compared to `policy.confidence_min` in post-gate G1.

### 3.12 Always-on summary
| Rule | Always-on? | Forced mode |
|---|---|---|
| Compliance (solver blocking) | yes | AUTO_REJECT_IF_FAIL |
| Fatigue (rest/consecutive) | yes | AUTO_REJECT_IF_FAIL (delegated to solver) |
| Schedule overlap | yes | AUTO_REJECT_IF_FAIL |
| 4h time-lock | yes | AUTO_REJECT_IF_FAIL (also `runSwapGuards` + gateway) |
| Certification | yes | AUTO_REJECT_IF_FAIL |
| Role / location | configurable | default REQUIRE_EQUAL |
| Skill / duration / pay / OT / coverage | configurable | default ROUTE_TO_REVIEW_IF_FAIL |
| Availability | configurable | default AUTO_REJECT_IF_FAIL |
| Max-swap-distance | configurable | default IGNORE |

---

## 4. Abuse Prevention

All detectors run in the worker as post-gates (§2.3 G2/G3) over `swap_decisions` + `shift_swaps`. Each returns a **downgrade-to-review** (default) or, for a confirmed laundering cycle, **AUTO_REJECT**. Thresholds are policy params with the defaults below.

### 4.1 Swap farming (volume) — rate limit
- **Detection:** committed `AUTO_APPROVE` count for either party in the rolling 7 days.
- **Threshold:** `>= max_auto_per_employee_per_week` (default 3).
- **Trigger:** downgrade to `MANUAL_REVIEW` (post-gate G2).
```sql
SELECT count(*) FROM swap_decisions d
JOIN shift_swaps s ON s.id = d.swap_id
WHERE d.decision='AUTO_APPROVE' AND d.committed
  AND d.created_at >= now() - interval '7 days'
  AND :emp_id IN (s.requester_id, s.target_id);
```

### 4.2 Mutual favoritism (pairwise frequency)
- **Detection:** count of swaps between the *same unordered pair* {A,B} in a rolling window.
- **Threshold:** `>= pairwise_max` (default 3 / 30 days).
- **Trigger:** downgrade to `MANUAL_REVIEW`.
```sql
SELECT count(*) FROM shift_swaps s
JOIN swap_decisions d ON d.swap_id=s.id AND d.committed
WHERE LEAST(s.requester_id,s.target_id)=LEAST(:a,:b)
  AND GREATEST(s.requester_id,s.target_id)=GREATEST(:a,:b)
  AND s.created_at >= now() - interval '30 days';
```

### 4.3 Compliance avoidance
- **Detection:** a swap whose *only* effect is to move an employee off a shift they'd otherwise breach a soft cap on, repeatedly (pattern: same employee, recurring give-away of high-load shifts).
- **Signal:** the solver returns `WARNING` (near-cap) on the *giver's* pre-swap state ≥ `avoidance_max` times in 30 days.
- **Trigger:** downgrade to `MANUAL_REVIEW` and tag `compliance_avoidance` in the audit.

### 4.4 Approval manipulation
- **Detection:** repeated `AUTO_REJECT` → re-submit with a marginally-edited shift to flip the verdict (drift-gaming). Count distinct `idempotency_key`s per `swap_id` chain (same parties/shifts) within a short window.
- **Threshold:** `>= 3` re-evaluations in 1h ⇒ `MANUAL_REVIEW` and lock further auto-eval for that swap.

### 4.5 Circular swap patterns (cycle detection over a swap graph)
- **Graph:** directed edge `A → B` for each committed swap where A gives a shift B picks up, over a rolling window (default 14 days).
- **Detection:** before committing a new `AUTO_APPROVE`, add the prospective edge and run cycle detection (DFS / `WITH RECURSIVE`) on the directed graph. A cycle ≥ length 2 that returns a participant to a previously-given shift = **laundering** (swap-to-a-friend-then-swap-back, A→B→C→A).
- **Trigger:** a 2-cycle (A↔B "swap back") → `MANUAL_REVIEW`; a ≥3-cycle returning original ownership → `AUTO_REJECT` with reason `CIRCULAR_SWAP`.
```sql
-- prospective edges = committed swaps in window ∪ {new edge}
WITH RECURSIVE edges AS (
  SELECT s.requester_id AS src, s.target_id AS dst
  FROM shift_swaps s JOIN swap_decisions d ON d.swap_id=s.id AND d.committed
  WHERE s.created_at >= now() - interval '14 days'
  UNION ALL SELECT :new_src, :new_dst
),
walk(src, dst, path, depth) AS (
  SELECT src, dst, ARRAY[src,dst], 1 FROM edges WHERE src = :new_src
  UNION ALL
  SELECT e.src, e.dst, w.path||e.dst, w.depth+1
  FROM edges e JOIN walk w ON e.src = w.dst
  WHERE NOT e.dst = ANY(w.path[2:]) AND w.depth < 6
)
SELECT max(depth) AS cycle_len FROM walk WHERE dst = :new_src;  -- non-null ⇒ cycle back to origin
```

---

## 5. Database Design (narrative — DDL in [0002_swap_auto_approve.sql](migrations-draft/0002_swap_auto_approve.sql))

Four new tables + two additive columns on `shift_swaps` (`review_flag`, `auto_decision_id`). All expand-phase (additive, nullable/defaulted), no destructive change in this deploy (00 §8).

- **`swap_approval_rules`** — policy. PK `id`; FK `organization_id → organizations`, nullable `department_id → departments` (NULL = org default; dept row overrides). Columns: `enabled` (master/kill-switch), `shadow_mode` (decide+log, default true), `auto_approve_warnings`, `confidence_min` (0–1 CHECK), `max_auto_per_employee_per_week`, `rules` jsonb (per-rule `{enabled,mode,params}`; CHECK is object), `version` (auto-bumped by `trg_bump_swap_policy_version`, stamped on every decision). Partial UNIQUE indexes pin one org-default and one row per (org,dept). RLS: **org-admin only** (cert-scoped to the row's org).
- **`swap_decisions`** — one row per idempotency key. PK `id`; FK `swap_id → shift_swaps`; `idempotency_key text UNIQUE` (the upsert pivot); `decision` enum (`swap_auto_decision_kind`); `guard_result`/`eligibility_result`/`solver_result` jsonb; `reason`; `policy_version`; `engine_version`; `requester_shift_version`/`offered_shift_version` (CAS tokens); `shadow` bool; `committed` bool (true only when a gateway op actually ran); `reverted_at`/`reverted_by`. Indexed by `swap_id`, `decision`, `created_at` (powers rate-limit/abuse queries). RLS: manager READ; writes only via SECURITY DEFINER.
- **`swap_audit_log`** — immutable, append-only. PK `id`; FK `swap_id`, nullable `decision_id`; `event_type`, `actor` (`system` or admin uuid), `detail` jsonb. `trg_swap_audit_no_update` raises on UPDATE/DELETE. The forensic / dispute record. RLS: manager READ.
- **`swap_review_queue`** — durable at-least-once queue. PK `id`; FK `swap_id`; `idempotency_key`; `status` enum (`PENDING|CLAIMED|DONE|DLQ`); `attempts`/`max_attempts`/`next_attempt_at` (backoff); `locked_by`/`locked_at` (lease, reclaimable); `last_error`. UNIQUE `(swap_id, idempotency_key)` de-dupes re-enqueues; partial index on `(status,next_attempt_at) WHERE status='PENDING'` makes claiming cheap. RLS: service-role only (no client policy).

**Trigger + RPCs** (DDL in file B): `enqueue_swap_auto_decision()` (trigger fn) → `trg_enqueue_swap_auto_decision` on `shift_swaps`; `sm_swap_auto_decide(p_swap_id, p_idempotency_key, p_payload)` (terminal commit, SECURITY DEFINER, cert authz, upsert-on-key, kill-switch/shadow respect, gateway dispatch, audit ↔ op atomic, fail-closed); `sm_swap_auto_revert(p_decision_id, p_actor)` (inverse reassignment via `sm_approve_peer_swap`, time-lock guarded).

---

## 6. Implementation Tasks (swap-specific backlog)

> Handoff: the **cross-feature master backlog** (sequencing vs Auto-Assign Bids, shared infra) is owned by **doc 04**. This section is the swap slice only. Estimates in dev-days: FE / BE / DB / QA.

### EPIC S — Auto-Approve Swap Requests

**Feature S1 — Policy & schema foundation** *(P0)*
- **Story S1.1** — Ship `0002` migration (4 tables, trigger, RPC skeletons, RLS).
  - Tasks: author DDL; partial unique indexes; immutability trigger; RLS policies; promote draft (human).
  - **AC:** tables created expand-safe; org-admin-only RLS verified; audit log rejects UPDATE/DELETE; rollback script restores clean state.
  - **Complexity:** M. **Deps:** gateway `approve_trade`/`reject_trade` (exists). **Effort:** FE 0 / BE 1 / DB 3 / QA 1.
- **Story S1.2** — Policy admin UI (`PUT /rest/v1/swap_approval_rules`): kill-switch, shadow toggle, per-rule mode editor, confidence/rate fields.
  - **AC:** org default + per-dept override editable; version bumps on save; non-admin blocked by RLS.
  - **Complexity:** M. **Deps:** S1.1. **Effort:** FE 4 / BE 1 / DB 0 / QA 1.5.

**Feature S2 — Enqueue + queue worker** *(P0/P1)*
- **Story S2.1** — Enqueue trigger wired to `MANAGER_PENDING` (transactional outbox).
  - **AC:** every `MANAGER_PENDING` transition produces exactly one queue row per version-tuple; idempotent on conflict.
  - **Complexity:** M. **Deps:** S1.1. **Effort:** FE 0 / BE 0.5 / DB 1.5 / QA 1.
- **Story S2.2** — Edge Function `auto-approve-swaps` worker: claim (`SKIP LOCKED`), load swap+shifts+rosters, run guards+solver+eligibility, call `sm_swap_auto_decide`, backoff + DLQ.
  - Tasks: claim loop; reuse `validateSwapCompliance` shape ([swaps.api.ts:45](../../src/modules/planning/swapping/api/swaps.api.ts#L45)); idempotency key recompute; lease reclaim; `pg_cron` tick.
  - **AC:** at-least-once with idempotent commit; crash mid-run = no partial; DLQ→MANUAL after max_attempts; p95 latency < 2s/swap.
  - **Complexity:** H. **Deps:** S1.1, S2.1. **Effort:** FE 0 / BE 6 / DB 1 / QA 3.

**Feature S3 — Eligibility engine** *(P0)*
- **Story S3.1** — `evaluateEligibility` pure module (§3 rules + payroll delta + confidence).
  - **AC:** each rule honours its mode; always-on rules unconfigurable; payroll delta in output; deterministic.
  - **Complexity:** M-H. **Deps:** none (pure). **Effort:** FE 0 / BE 4 / DB 0 / QA 3.
- **Story S3.2** — Decision matrix resolver (reject>review>approve) + pre/post gates (§2).
  - **AC:** every matrix row covered by a unit test (QA matrix 13–20); fail-closed on throw.
  - **Complexity:** M. **Deps:** S3.1. **Effort:** FE 0 / BE 2 / DB 0 / QA 2.

**Feature S4 — Abuse prevention** *(P1)*
- **Story S4.1** — Rate-limit + pairwise-frequency + cycle detection (§4).
  - **AC:** thresholds enforced as downgrades; cycle ≥3 → AUTO_REJECT; queries indexed.
  - **Complexity:** M-H. **Deps:** S2.2, S3.2. **Effort:** FE 0 / BE 3 / DB 1 / QA 2.

**Feature S5 — Transparency, notifications, rollback** *(P1)*
- **Story S5.1** — Decision/audit read UI on the manager swap surface ([ManagerSwaps.page.tsx](../../src/modules/planning/swapping/ui/pages/ManagerSwaps.page.tsx)); `review_flag` badge.
  - **AC:** manager sees decision, reason, rule hits, payroll delta; review-flagged swaps highlighted.
  - **Complexity:** M. **Deps:** S2.2. **Effort:** FE 3 / BE 0.5 / DB 0 / QA 1.
- **Story S5.2** — `sm_swap_auto_revert` admin action + notifications parity (reuse `trg_swap_outcome_notification`).
  - **AC:** revert restores prior assignment, time-lock guarded, fully audited; both parties + manager notified per terminal decision.
  - **Complexity:** M. **Deps:** S1.1. **Effort:** FE 1.5 / BE 2 / DB 1 / QA 1.5.

**Totals (swap slice):** ~FE 13.5 / BE 23.5 / DB 13 / QA 17.5 dev-days.

---

## 7. Deployment (swaps)

Single rollout, gated by metrics. Everything ships behind `shadow_mode=true` first (00-audit §12 Phase 3 — shadow-first is mandatory).

| Stage | Config | Gate to promote (metrics) | Priority |
|---|---|---|---|
| **0. Shadow (org-wide)** | `enabled=true, shadow_mode=true` everywhere | ≥ 2 weeks; **shadow-vs-human agreement ≥ 95%** on the AUTO_APPROVE/REJECT calls that a manager subsequently made the same way; **0** would-be approvals that a manager rejected; idempotency dup-rate 0 double-commits; p95 decision latency < 2s; DLQ rate < 1%. | **P0** |
| **1. Per-dept canary** | `shadow_mode=false` for **one** low-risk dept | ≥ 1 week live; **revert rate < 1%** of committed approvals; **0** compliance/cert/fatigue/time-lock escapes (always-on rules); no coverage-floor breach; abuse detectors firing as expected (sampled). | **P1** |
| **2. Org GA** | `shadow_mode=false` org-wide | Canary clean for 1 week; on-call runbook + kill-switch drill done; manager review-queue load **down** vs baseline. | **P1** |

**Always-available safety levers (P0):** per-dept + org `enabled` kill-switch (instant off); `shadow_mode` re-enable; `sm_swap_auto_revert` for any committed approval (time-lock permitting). **P2:** queue fan-out / horizontal worker scaling, confidence-model tuning, fancier fairness in coverage scoring.

---

## 8. Verification notes
- Gateway ops `approve_trade` (compliance-gated, delegates to `sm_approve_peer_swap`) and `reject_trade` (reverts both shifts to `NoTrade`) confirmed in [20260621100200_sm_apply_shift_op.sql:261-342](../../supabase/migrations/20260621100200_sm_apply_shift_op.sql#L261).
- Manual approval path + solver + guards confirmed in [swaps.api.ts:45-101, 641-738](../../src/modules/planning/swapping/api/swaps.api.ts#L45); `acceptTrade`→`MANAGER_PENDING` at [swaps.api.ts:806-866](../../src/modules/planning/swapping/api/swaps.api.ts#L806).
- `runSwapGuards` signature `({shiftIds, employeeIds, currentSwapId?, shiftSnapshot?}) → GuardResult{passed, violations[]}` in [guards.ts:44-279](../../src/modules/compliance/v8/swap-engine/guards.ts#L44).
- `swapEvaluator.evaluate({partyA, partyB, config?}) → SolverResult{feasible, violations[], warnings[]}` in [swap-evaluator.ts:31](../../src/modules/compliance/v8/swap-engine/swap-evaluator.ts#L31).
- `shift_swaps` schema (`requester_id`, `target_id`, `requester_shift_id`, `target_shift_id`, `status swap_request_status`, `expires_at`) and the `swap_request_status` enum (`OPEN|OFFER_SELECTED|MANAGER_PENDING|APPROVED|REJECTED|CANCELLED|EXPIRED`) confirmed in [20251015000000_baseline_schema.sql:484,17558](../../supabase/migrations/20251015000000_baseline_schema.sql#L484).
- This plan reuses the existing solver, guards, and gateway — no new rule engine, fail-closed throughout.
