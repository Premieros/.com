# Premier OS — Remaining release-gate remediation, 2026-11-09

Scope: Web POS/ERP. Production Supabase remains unchanged by this PR.

## Confirmed main deployment and CI evidence
- Main commit `97a4e671`: GitHub Pages `Deploy to GitHub Pages` run `42585456427` succeeded (build, production-parity, deploy).
- Main `Verify main` run `42585456405`: verify phase succeeded, DB integration failed **3 of 91 tests**; browser smoke was skipped.
- Failures: (1) raw warehouse movement table absent from CI replay affected full operating cycle, (2) purchase-return FIFO shortage, and (3) BOM theoretical evidence expected 20/15/35 but returned 0 due to fixture using un-published raw default cost.
- These are **fresh disposable CI database failures**, not proof that production DB is missing the table. Production already has it and its migration recorded.

## Changes in PR #143
1. Restore two exact **already-applied production** historical migration SQL bodies to GitHub canonical migration directory, versions `20261023042826` (raw warehouse balances stage) and `20261023043004` (raw warehouse movements + cutover refusal). These are non-FIFO staging structures, not authorization to activate a new stock costing algorithm.
2. Update isolated component-cost test fixture to insert a **published raw price event** (10/unit) for the priced raw input. `_raw_cost_for_costing` reads `raw_material_current_costs` from price publication; `raw_materials.default_cost` alone is not authoritative. Unpriced input intentionally remains missing; expected base 20, modifier 15, theoretical 35.
3. Update `Fast Verify` to opt in to the **pinned CI-only** legacy migration syntax replay as `Verify main` already does. This requires `CI=true` and localhost PostgreSQL, never production.

## Gates
- Verify exact PR head `Fast Verify` and full `Verify main` DB integration tests; require full browser smoke pass before claiming end-to-end closure.
- No changes to financial production rows, no direct production test sales. Existing stock-count and branch RLS policy gates have already been applied and verified separately.
- Remaining genuine security acceptance tests: representative role INSERT/UPDATE/DELETE and SECURITY DEFINER mutation endpoints on isolated schema with role/JWT simulation; retain an auditable environment-only test report.

Status: **IN REVIEW**. Do not merge before successful CI on latest head.
