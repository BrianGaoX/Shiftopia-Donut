# Optimizer Schema — Source of Truth & Drift Prevention

## The problem this solves

Until Phase 2, the AutoScheduler had **three independent definitions** of every input shape:

1. **Pydantic models** in `ortools_runner.py` — validate the HTTP boundary.
2. **Dataclass models** in `model_builder.py` — fed to the CP-SAT solver.
3. **TypeScript interfaces** in `src/modules/scheduling/types.ts` — built by the controller, sent over the wire.

Adding a single field (e.g. `availability_slots`) required synchronized edits to all three. Forgetting one meant silent drift: the wire payload would carry the field, pydantic would accept it, and either the dataclass would discard it or the TS controller would never set it.

We've already shipped bugs from this — `unpaid_break_minutes` on `ExistingShiftInput` was pydantic-only for months, silently dropped before reaching the fatigue calculator.

## The contract

Pydantic and the dataclass are **field-name-equivalent**, with a small allowlist of solver-internal fields. The TS interface is **field-name-equivalent** to pydantic, with a small allowlist of browser-only fields.

This is enforced by two test suites:

### Python side
```
optimizer-service/tests/test_schema_contract.py
```
Asserts every pydantic model in `ortools_runner.py` has the same field names as its corresponding dataclass in `model_builder.py`.

Solver-internal exceptions (e.g. `initial_fatigue_score` on the dataclass) are listed in `SOLVER_ONLY_FIELDS` with a comment explaining why.

Run: `docker exec superman-optimizer python -m pytest tests/test_schema_contract.py -v`

### TS side
```
src/modules/scheduling/__tests__/schema-contract.test.ts
```
Loads `optimizer-service/schema-snapshot.json` (a JSON dump of pydantic field names) and compares against the TS interface fields, surfaced via a `Required<T>` sample object.

Browser-only exceptions (e.g. `contract_type`, `demand_source`) are listed in `BROWSER_ONLY_FIELDS`.

Run: `npx vitest run src/modules/scheduling/__tests__/schema-contract.test.ts`

## Workflow when you add a new field

1. **Add to the pydantic model** in `ortools_runner.py`.
2. **Add to the dataclass** in `model_builder.py` (with a sensible default).
3. **Add to the TypeScript interface** in `src/modules/scheduling/types.ts`.
4. **Refresh the snapshot:**
   ```bash
   cd optimizer-service
   python scripts/dump_schema.py
   ```
   This rewrites `schema-snapshot.json`. Commit it.
5. **Update the TS test sample** at the top of `schema-contract.test.ts` to include the new field.
6. **Run both test suites** to confirm the contract still holds.

If you want a field on **only one side** (e.g. solver-internal computed value), add it to:
- `SOLVER_ONLY_FIELDS` in `tests/test_schema_contract.py` (if dataclass-only)
- `BROWSER_ONLY_FIELDS` in `__tests__/schema-contract.test.ts` (if TS-only)

Each entry **must** include a comment explaining the asymmetry. PR review should challenge any new entry.

## Long-term direction

The contract-test approach catches drift at test time. A more rigorous solution is full code generation:

- FastAPI already produces an OpenAPI spec from the pydantic models.
- `openapi-typescript` (npm) can generate TS types from that spec.
- A `npm run gen:types` script would fetch the spec from the running optimizer and produce a generated types file.

This is **Phase 4 work**. Until then, the contract tests are the line of defense.

## Why not just have one source?

The pydantic model and the dataclass exist for legitimate reasons:

- **Pydantic** validates the HTTP boundary, produces useful 400 error messages, generates the OpenAPI spec. Doesn't fit well as a solver-internal type because of the validation overhead and the immutability friction.
- **Dataclass** is the solver's internal representation. Fast access, simple semantics, no validation.

You could merge them by using pydantic with `model_config = ConfigDict(frozen=False, extra='ignore')` everywhere, but the migration is non-trivial (every usage in `model_builder.py` would need updating) and the contract-test approach gets us 90% of the safety at 10% of the cost.
