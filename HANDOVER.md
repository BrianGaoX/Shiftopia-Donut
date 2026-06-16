# Handover — Autoscheduler Enterprise Upgrades (C2 / F1 / F3)

_Last updated: 2026-06-16. Context for a fresh Claude session. Read this first._

## What this work stream is
An audit of the employee-rostering **autoscheduler** (OR-Tools CP-SAT) led to a set of
enterprise upgrades. Three feature lines are in flight:

- **C2 — Probabilistic demand / service-level targets** (coverage confidence buffering)
- **F1 — Longitudinal fairness ledger** (cross-roster weekend/night/PH/hours debt)
- **F3 — Preference-satisfaction equity** (bias bid winners toward employees previously denied)

## TL;DR status

| Feature | Status | Notes |
|---|---|---|
| **C2** | ✅ Done & live | Engine `demand-uncertainty.ts`; integrated in `templateBuilder` (empirical) + `finalizeDemand` (model buffer) + `mlClient` (σ from ML quantiles); UI "Coverage Confidence" slider on the Forecasting page; `demand_tensor` columns applied + in generated types. ML quantile training (`reg:quantileerror`) ready (needs retrain; backward-compatible with point models). |
| **F1** | ✅ Functional + hardened (2026-06-16) | Reads debts → solver SC-11 (now incl. **SC-11b hours-fairness** from `total_hours`/`overtime_minutes`); writes back incrementally on commit **and rebuilds org-wide post-publish** (`usePublishRoster`); table now has **org-scoped RLS** (cert-based). |
| **F3** | ✅ Now wired in the LIVE path | The user's original F3 was in a **dead module** (see below). Re-implemented in the live bid auto-pick loop (`OpenBidsView`): orders bidders by `denied_preferences` debt before "first compliance-clear wins". |

**Gates (all green):** `tsc` 0 · vitest **529** · optimizer pytest **69** · ml pytest **60** · `npm run build` ✓
_(optimizer 57 → 69: +3 SC-11b hours-fairness, +2 lexicographic, +2 pillar/rationale, +1 Pareto, +4 role-set distribution.)_

## Role-set eligibility (2026-06-16) — replaces numeric level hierarchy
The autoscheduler's eligibility was a numeric **level hierarchy** (`emp_level >= shift_level` → any higher-level person could take lower-level shifts) **and the level/role data was never even plumbed**, so role eligibility was effectively OFF. Now it's **role-set membership**, matching the manual/bulk R10 rule (`eligibility.service.ts` / `incremental-validator.ts`):
- **Eligibility = the shift's `role_id` ∈ the employee's active contracted role_ids** (`user_contracts`), gated by `enforce_role_match` (default true). No level gate; remuneration level is a pay attribute, not eligibility. Multi-contract staff (e.g. holds TL+TM) are eligible for *all* held roles; a TM-only person only for TM. Distribution across shared roles is handled by lexicographic coverage(T1)+fairness(T2) — the overqual penalty was **removed** (it fought this).
- **New wire field `contracted_role_ids: string[]`** on `EmployeeInput`/`EmployeeReq`/TS `OptimizerEmployee` + snapshot. Populated by `EligibilityService.getEligibleEmployees` (already returns it) → `useEmployees` → `RostersPlannerPage` → modal → controller `?? []`.
- **Greedy fallback** (`auto-scheduler.controller.ts`) was using the OLD level gate (two-engine divergence) — fixed to the same role-set check + dropped its alignment penalty.
- Audit endpoint emits **`ROLE_MISMATCH`** (not the retired `LEVEL_TOO_LOW`).
- **UI:** the Min-Rest-Hours input and Relax-Blockers toggle were removed (rest is always the 10h EBA default; relax not exposed). Solver keeps hard defaults (600m rest, no relax).

## Single-mode autoscheduler (2026-06-16) — the big change
The cost/fatigue/fairness **sensitivity sliders are GONE**. The solver now runs ONE
fixed **lexicographic** policy and the UI *shows* the trade-off instead of asking the
manager to tune it.
- **Solver (`model_builder.py`):** objective is no longer a single weighted `Minimize`.
  `_add_objective()` builds three tiers (`self._objective_tiers`); `_solve()` optimises
  them in order, locking each at its optimum before the next: **Tier 1 coverage+legal**
  (`coverage`,`relaxed_violations`,`other`) » **Tier 2 guardrails** (fatigue, fairness,
  balance, quality) » **Tier 3 cost**. `tier_profile` ('balanced'|'cheapest'|'fairest')
  selects the ordering — used only to generate Pareto alternatives. Convex fairness band
  added (peak-load + steeper band past 1.25× fair share); fatigue was already 2-band convex.
  Per-tier wall/det budget is `total / n_tiers`.
- **Transparency payload (B5):** `OptimizerOutput` now carries `pillars`
  (coverage/cost/fairness/fatigue scorecard from the *solution*), `binding_constraints`
  (why shifts uncovered), `tier_values`, and per-assignment `rationale` ("why this person").
- **Pareto (B4):** `solver_params.compute_alternatives` → re-solves 'cheapest'/'fairest'
  via fresh sub-builders (recursion-guarded) and returns each one's pillars as `alternatives`.
  Off by default; the modal sets it true.
- **Wire:** all of the above mirrored on `ortools_runner.py` (`SolverParamsReq`,
  `AssignmentRes.rationale`, `OptimizeRes.*`), the TS `types.ts`, and `auto-scheduler.controller.ts`
  (pins `SINGLE_MODE_STRATEGY`, threads `computeAlternatives`, maps response → `AutoSchedulerResult`).
  Schema snapshot regenerated (`scripts/dump_schema.py`); both schema-contract gates pass.
- **UI (`AutoSchedulerModal.tsx`):** sliders + presets + their localStorage removed (kept
  Min-Rest-Hours + relax-constraints as operational limits). New components:
  `AutoSchedulerInsights.tsx` (four-pillar scorecard + constraint banner + **recharts radar**
  trade-off explorer) and `WhyThisPerson.tsx` (hover-card rationale on each proposal row).
- **To revisit:** alternatives ~2-3× the solve time (acceptable; behind the flag). The pillar
  fairness/fatigue scores are heuristic 0-100 indices — tune thresholds in `_compute_pillars`
  if they read too harsh/lax. AI/LLM rationale (Phase 3 / S1) was scoped but NOT built.

## Architecture map (the non-obvious parts)

### Autoscheduler (the solver)
- **`optimizer-service/model_builder.py`** — CP-SAT model. Objective terms SC-1…SC-11. Entry `build_and_solve()`. `_term_categories` dict MUST contain every category string passed to `_t(expr, cat)` or it `KeyError`-crashes the solve (this bit F1 — see below).
- **`optimizer-service/ortools_runner.py`** — FastAPI wire boundary. **Any field the solver reads off `EmployeeInput`/`ShiftInput` MUST also be declared on the Pydantic `EmployeeReq`/`ShiftReq`** or Pydantic silently drops it (this is why F1 was a no-op even after the controller was fixed).
- **`src/modules/scheduling/auto-scheduler.controller.ts`** — TS orchestrator: builds the optimizer request, runs compliance re-validation, `commit()` writes via the atomic RPC. Live UI surface is **`AutoSchedulerModal`** (`AutoSchedulerPanel.tsx` is DEAD — never rendered).

### Demand engine (feeds shifts to the solver) — see `memory/demand-engine-pipeline.md`
rule/template/ML → **`finalizeDemand()`** (the single convergence point) → synth → solver. ML predictions are point estimates unless retrained with quantile loss.

### Compliance engine — ⚠️ TWO GENERATIONS, mind the dead code
- **Live bid-winner path = the Postgres RPC `sm_select_bid_winner`** + the auto-pick loop in `src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx`. This is what actually assigns bid winners.
- **`src/modules/compliance/v8/orchestrator/conflict-resolver/` (directory) + `bidding/index.ts` (`runBidSelection`) are UNWIRED dead code** — nothing imports/calls them. The batch/swapping `./conflict-resolver` imports resolve to their OWN sibling files (`batch/conflict-resolver.ts`, `swapping/conflict-resolver.ts`), NOT this directory. The user's F3 attempt lives in `conflict-resolver/scorer.ts` (`scoreOperations`) and never executes. **⚠️ As of 2026-06-16 `scorer.ts` has uncommitted in-progress work** that adds BOTH an F1 ledger penalty AND an F3 preference-equity bonus (new `fairness_debts` param) — i.e. this engine is being actively developed, so **do NOT delete it** (you'd destroy that work). Open question is wire-in vs leave — see open item #4.

### Fairness ledger (F1/F3 data) — see `memory/fairness-ledger-f1-f3.md`
- Domain `src/modules/rosters/domain/fairness-ledger.ts` (pure, tested), service `services/fairnessLedger.service.ts`, queries `api/fairnessLedger.queries.ts`.
- `getEmployeeDebts(orgId, empIds)` → read; `updateAfterCommit(orgId, shifts)` → incremental write (self-bootstraps via `recomputeLedger` when empty). Metrics: weekend/night/PH/overtime/total_hours/denied_preferences.

## Migrations APPLIED to prod (project `srfozdlphoempdattvtx` / Shiftopia)
- `20260613000000_harden_sm_bulk_assign.sql` — authz + lost-update guard (applied earlier turn).
- `20260613010000_atomic_bulk_assign.sql` — atomic multi-employee commit + idempotency.
- `20260614000000_demand_tensor_coverage_confidence.sql` — C2 columns.
- `20260615000000_fairness_ledger.sql` — F1 table with the original (manager-gated, non-org-scoped) RLS. **Superseded** by the migration below.
- `20260615010000_fairness_ledger_org_scoped_rls.sql` — **(applied 2026-06-16)** replaces `fairness_ledger_manager_all` with `fairness_ledger_org_scoped`: legacy admins get cross-org oversight; managers are restricted to orgs where they hold an active manager-level (`gamma`/`delta`/`epsilon`/`zeta`) `app_access_certificate`. **Deliberately cert-based, NOT gated on `is_manager_or_above()`** (which is broken in prod — see gotcha #8). Lockout-verified safe (the only current accessors — 1 legacy admin + the epsilon cert holders — all retain access; ledger table was empty at apply time).

All migration files are idempotent and match the DB. (If a 4th project/env exists, they still need applying there.)

## Critical gotchas for the next session
1. **Wire-boundary fields:** solver reads via `getattr(emp, 'x', default)`; add the field to BOTH `EmployeeInput` (dataclass) AND `EmployeeReq` (Pydantic) or it's dropped.
2. **Objective categories:** every `_t(expr, 'cat')` needs `'cat'` in `_term_categories` (else KeyError crash → 500 → greedy fallback).
3. **Two compliance engines:** confirm you're editing the LIVE path. Bid winners = `sm_select_bid_winner` RPC, not the v8 TS orchestrator.
4. **`require()` does not work in the browser/Vite ESM** — use top-level `import`.
5. **Org IDs are uuids** — never fabricate one from `shiftId.split('-')[0]`; thread the real `organizationId` or skip the feature.
6. **Python env:** repo `.venv` has no pip by default — `python -m ensurepip` first. Set `OPTIMIZER_AUTH_DISABLED=true` for the optimizer suite. XGBoost can't load locally (missing `libomp`; `brew install libomp` to enable ML training) — but predict/serve tests use stubs and pass.
7. ESLint is broken repo-wide; gates are **tsc + vitest + (python) pytest + build**.
8. **`public.is_manager_or_above()` is BROKEN in prod** — it reads `profiles.system_role`, a column that doesn't exist, so its `EXCEPTION WHEN OTHERS` handler makes it **always return FALSE**. Any RLS policy/clause relying on it is silently dead. `public.is_admin()` works (it reads `profiles.legacy_system_role IN ('admin','manager')` OR a global `zeta`/`epsilon` cert). The real role/org authority is **`app_access_certificates`** (`user_id`, `organization_id`, `is_active`, `access_level` enum `alpha`<`beta`<…<`zeta`). When writing RLS, scope via certs, not `is_manager_or_above()`. (Broad fix to that function is out of scope but affects other tables — worth a dedicated pass.)

## Verification commands
```bash
# TypeScript
npx tsc --noEmit
npx vitest run src/modules/rosters src/modules/scheduling src/modules/compliance src/modules/planning
npm run build

# Python (from optimizer-service/ and ml/ respectively)
VENV=/Users/vinayakkuanr/Documents/Superman_ULTIMATE/.venv
(cd optimizer-service && OPTIMIZER_AUTH_DISABLED=true "$VENV/bin/python" -m pytest -q)
(cd ml && "$VENV/bin/python" -m pytest tests/ -q)
```

## Worked this session (2026-06-16)
1. **✅ F1 scheduled recompute** — added a fire-and-forget org-wide `recomputeLedger(orgId, today)` to `usePublishRoster.onSuccess` (`src/modules/rosters/state/useRosterMutations.ts`). Publishing is the natural cadence at which assignments become authoritative, and it also covers the daily window roll-forward (`getEmployeeDebts` reads `window_end = today`, which only exists once a recompute has run for today). The solver's own commits are still covered by the incremental `updateAfterCommit`. Org-wide (no dept filter) so `team_average` matches the org-wide read path.
2. **✅ F1/F3 org-scoped RLS** — migration `20260615010000_fairness_ledger_org_scoped_rls.sql`, **applied to prod**. Cert-based (see migrations section + gotcha #8); admins global, managers org-scoped. Verified in place + no new security advisors on the table.
3. **✅ Solver hours-fairness (SC-11b)** — `model_builder.py` now adds a `longitudinal_fairness` term from `total_hours` / `overtime_minutes` debts across **all** (emp, shift) pairs (not just undesirable shifts), scaled by shift hours: `2.0¢` per debt-hour·shift-hour, `0.05¢` per OT-debt-minute·shift-hour, × `_strategy_mult(fairness_weight)`. Backward-compatible (empty ledger → no terms). +3 tests in `tests/test_solver_regressions.py` (`test_sc11b_*`). No new wire field needed — already carried by `fairness_debts`.
6. **✅ C2 service-level — verified, doc-corrected (no code gap).** The slider value is threaded into BOTH paths: `finalizeDemand` (Poisson σ, rule path — `demandTensorBuilder` L511) AND `buildDemandAnalysisForRoles` (ML path — L638). The ML path buffers when the model returns quantiles (`mlClient` L240). So C2 is wired across **all three modes**; it is merely **dormant in `ml_only`/`rules_shadow` until the model has quantiles** (couples to item 5), not unwired. The old handover wording ("only affects rules_primary") was imprecise.

## Open items / next steps (prioritized)
4. **Dead/in-progress v8 modules — DECISION NEEDED (do NOT delete blindly).** `conflict-resolver/` dir + `bidding/index.ts runBidSelection` are unwired, BUT `conflict-resolver/scorer.ts` has **uncommitted in-progress F1+F3 work** (see Compliance-engine note above). Options: (a) **wire the v8 engine into the live bid path** (large, risky — the live path is the `sm_select_bid_winner` RPC + `OpenBidsView`), or (b) **leave it** as an in-progress branch and keep F3 in the live `OpenBidsView` loop. **Not resolved this session** — needs the user's call. The TS `debtToObjectiveCoeff` (in `fairness-ledger.ts`) is still unused (Python re-implements the coefficients inline) — safe to keep or remove with the decision.
5. **ML quantile retrain — code READY, retrain ENV-BLOCKED.** `train_model.py` (`reg:quantileerror`, quantiles `[0.5, 0.9]`) + `predict.py` (2-D model → `quantile_source='model'`; 1-D legacy → Poisson `approx`) are correct and back-compat; 60 ml tests pass on stubs. Cannot retrain here: XGBoost won't load (no `libomp` — `brew install libomp`) and there's **no training data in the repo**. Retrain on real data to activate model-derived σ (which then lights up C2 in ML modes — item 6).
- **(stretch) Fix `is_manager_or_above()` repo-wide** — broken in prod (gotcha #8); audit every policy that depends on it.

## Memory pointers (auto-loaded each session)
`memory/MEMORY.md` indexes: `demand-engine-pipeline.md` (C2), `fairness-ledger-f1-f3.md` (F1/F3), `optimizer-service-test-env.md`, `architecture-compliance-v2.md`.
