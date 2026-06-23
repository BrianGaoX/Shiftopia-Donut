# `auto-assign-bids` — Supabase Edge Function

Server-side host for the **pure v8 bidding brain** (`runBidSelection`). It takes a
manager-supplied scope, builds one consistent snapshot under the service role
(RLS-blind, so compliance sees every bidder's full schedule), runs the
deterministic decision model, and commits each selected winner through the
existing `sm_apply_shift_op('select_winner', …)` gateway with version-CAS.

Implements `docs/implementation/01-auto-assign-bids-refactor.md` §2 (orchestration)
and §8 (API), bound by `docs/implementation/00-contracts-and-conventions.md`
(decisions D1–D5; idempotency §5; enums §6; routes §7).

> **Status:** scaffold. Not deployed in this environment. The draft migration
> that creates `assignment_runs` / `assignment_decisions` / `assignment_events`
> and the `sm_assignment_run_*` RPCs lives at
> `docs/implementation/migrations-draft/0001_assignment_audit_and_engine.sql`
> and must be promoted to prod **before** this function will work end-to-end.

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

## Bundling — IMPORTANT (the one thing a reviewer must understand)

The v8 compliance engine under `src/modules/compliance/v8/**` is **browser/Node
TypeScript**, authored for Vite. It cannot be imported into Deno as-is. The exact
incompatible surface that the bidding pipeline transitively reaches:

```
bidding/index.ts        (runBidSelection — PURE, fine)
  → bidding/evaluator.ts
      → ../index.ts  (runV8Orchestrator)   ← imports `@sentry/react`
                                            ← reads `import.meta.env.VITE_*`
                                            ← imports ./audit.ts
                                                 → `@/platform/supabase/client`
                                                 → `@sentry/react`
                                                 → `import.meta.env.VITE_*`
```

`runBidSelection` itself is pure, but it pulls `runV8Orchestrator` for the
per-bid compliance simulation, which drags in those three browser-only deps.
None of `@sentry/react`, the Vite alias `@/…`, or `import.meta.env` exist under
Deno. (`windows.ts` is **fine** — an earlier grep flagged it only because it
contains the substring `window`; it has no browser import.)

### Approach chosen: **VENDOR + import-map shim** (not `npm:` and not a path alias to `src/`)

We do **not** point Deno at `src/` directly (it would try to resolve the Vite
alias and Sentry against the browser build) and we do **not** publish the engine
to npm. Instead:

1. **Vendor** the compliance engine into `./_vendor/compliance/v8/**` — a copy of
   `src/modules/compliance/v8/**`, unchanged source. The function-local import map
   aliases `@compliance/` → `./_vendor/compliance/`, and `index.ts` imports **only**
   `runBidSelection` (+ types) from it. *(This directory is intentionally not
   created by the scaffold — see "Vendoring step" — to avoid duplicating ~40
   engine files into the repo before the human deploy step. The import map and
   shims that make it work ARE committed.)*

2. **Shim the three browser-only leaves** through the same import map
   (already committed):

   | Original specifier | Deno replacement | Why it's safe |
   |---|---|---|
   | `@/platform/supabase/client` | `./_vendor/_shims/supabase-client.ts` | Only `audit.ts` uses it, for a *fire-and-forget* `compliance_rejections` insert + `auth.getUser()`. The shim is a no-op client. The run's own `assignment_decisions`/`assignment_events` are the audit of record (01 §3.9), so we deliberately do **not** want the per-candidate simulation writing its own rows here. |
   | `@sentry/react` | `./_vendor/_shims/sentry.ts` | The engine calls only `getClient()` / `addBreadcrumb()`. No-ops. |
   | `import.meta.env.VITE_*` | **needs adaptation** (see below) | `import.meta.env` is undefined in Deno → a bare read throws `TypeError`. |

3. **`import.meta.env`** cannot be fixed by an import map (it's a syntax-level
   global, not a module). Two of the vendored files read it:
   - `v8/orchestrator/index.ts:32` — `import.meta.env.VITE_COMPLIANCE_BLOCKING_ENABLED`
   - `v8/orchestrator/audit.ts:17` — `import.meta.env.VITE_COMPLIANCE_REJECTION_PERSIST`

   During the vendoring step, replace those two reads with a Deno-safe helper, e.g.
   `Deno.env.get('VITE_COMPLIANCE_BLOCKING_ENABLED')`, or hard-pin the flag (the
   engine defaults both to "enabled unless the value is exactly `'false'`", which
   is the behaviour we want server-side anyway). This is the **single source edit**
   the vendoring needs; everything else copies verbatim.

### Vendoring step (run once before deploy, or wire into CI)

```bash
# Copy the engine into the function (kept out of git history until the human
# deploy step decides how to vendor — submodule, copy, or build artifact).
mkdir -p supabase/functions/auto-assign-bids/_vendor/compliance
cp -R src/modules/compliance/v8 \
      supabase/functions/auto-assign-bids/_vendor/compliance/v8

# Apply the single import.meta.env adaptation (2 files) — see step 3 above.
# (A codemod/sed in CI is preferable to a manual edit so re-vendoring is reproducible.)
```

> **Why a copy and not a Deno symlink to `src/`:** `supabase functions deploy`
> bundles only what lives under the function directory; a symlink out to `src/`
> is not portable to the deployed runtime. A vendored copy (or a CI build step
> that produces it) is the robust option. If drift between `src/` and `_vendor/`
> is a concern, add a CI check that re-vendors and `git diff --exit-code`s.

Once `_vendor/compliance/v8/**` exists and the two `import.meta.env` reads are
adapted, `supabase functions deploy auto-assign-bids` bundles cleanly:
`runBidSelection` runs unchanged, the two shims satisfy its browser deps.

---

## Behaviour notes

- **Fail-closed (D5).** Every per-shift error is *recorded* (`outcome:'ERROR'`),
  never thrown. The top-level handler catch aborts the run (`status:'ABORTED'`)
  and still returns structured JSON. A run is never left `RUNNING` on a throw.
- **Idempotency (D4, 00 §5).** Two layers: the gateway dedups on a deterministic
  UUIDv5 of `run_id:shift_id` (matched against `shift_events.metadata->>'idem'`),
  and `assignment_decisions` has `UNIQUE(run_id, shift_id)` with
  `ON CONFLICT DO NOTHING`. A resumed run never double-commits.
- **Concurrency (00 D1, 01 §5).** Winners commit in `shift_id ASC` order
  (consistent lock ordering) with bounded CAS retry (`MAX_CAS_ATTEMPTS=3`,
  50/100/200 ms backoff + jitter). On `VERSION_CONFLICT` the engine re-reads the
  envelope's `current_state`; if the shift is no longer `S5`/`S6` it records
  `SKIPPED_BLOCKED` instead of retrying.
- **Dry run.** Computes + persists decisions with `version_after=null` and never
  calls the gateway. Returns the full `preview[]` (01 §8.1).
- **Resumability (01 §2.5).** `assignment_runs.cursor = {last_shift_id}` advances
  after each decision; a re-invoke with the same `run_id` resumes after it.
