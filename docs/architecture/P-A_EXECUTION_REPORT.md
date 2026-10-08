# P-A — Execution Report

> Premier Architecture V2
>
> Scope: mapping and safety baseline only.
>
> No production migration or runtime behavior change.

## 1. Production snapshot inspected

Canonical Supabase project:

`hvqlkapynjfjikqithvd`

Observed public-schema baseline at review time:

- **137** public base tables.
- **137 / 137** public base tables with RLS enabled.
- **2** public views, both security-invoker.
- **366** RLS policies across 117 tables.
- **6** duplicate-permissive policy groups.
- **448** public-schema functions.
- **380** SECURITY DEFINER functions.
- **261** SECURITY DEFINER functions executable by authenticated clients.
- **3** SECURITY DEFINER helpers with effective PUBLIC execute.
- `register_trial_tenant` is the intentional anonymous onboarding RPC.

## 2. Data-integrity baseline observed

The review found no current production rows with missing core scope in:

- `branches.organization_id`
- `sales.branch_id`
- `purchases.branch_id`
- `purchases.warehouse_id`
- `raw_material_batches.warehouse_id`
- `warehouses.branch_id`
- `inventory_units.branch_id`

Existing journal integrity checks found no unbalanced journals in the inspected production state.

## 3. Main architectural conclusions

### Catalog

Current item identity is split across products, raw materials and inventory units.

Decision:

- introduce organization-level canonical item identity later;
- preserve current IDs during compatibility migration;
- branch-specific values become site configuration.

### Inventory

Decision:

- ledger/movement history is the long-term truth;
- balances are projections;
- every movement must eventually have explicit warehouse and base UOM;
- FIFO debt/repair structures remain internal implementation details.

### Costing

Decision:

- Actual, Theoretical and Standard cost are separate concepts;
- posted COGS uses actual inventory consumption;
- theoretical cost remains recipe/BOM-driven;
- standard cost becomes an optional planning/variance layer.

### Accounting

Decision:

- move toward organization-level COA with branch/cost-center dimensions;
- posted journals become immutable;
- fiscal periods and reversal-based correction are required.

### Procurement

Decision:

- Purchase Request, PO, Goods Receipt and Supplier Invoice are separate documents;
- three-way match and landed cost are target capabilities;
- payments move toward allocation model.

### API/security

Decision:

- shrink public database API surface;
- helpers become private/internal;
- client calls business commands, not low-level posting/FIFO helpers.

## 4. P-A deliverables added

- `PREMIER_ARCHITECTURE_V2_BLUEPRINT.md`
- `P-A_CANONICAL_MODEL_MAPPING.md`
- `P-A_RPC_SURFACE_CLASSIFICATION.md`
- `P-A_WRITE_PATH_BASELINE.md`
- `architecture-v2-pa-baseline.test.ts`

## 5. CI safety gate introduced

The P-A integration test guards:

- RLS enabled on all public base tables;
- security-invoker public views;
- no unexpected PUBLIC/anon SECURITY DEFINER expansion;
- duplicate permissive policies do not grow beyond baseline;
- journal balance;
- explicit branch/warehouse scope in core operational data;
- refunds/returns do not exceed source quantities.

The PUBLIC/anon helper allowlist is a temporary compatibility baseline and should shrink during Phase 1.

## 6. Phase 1 entry criteria

Phase 1 may start only after:

1. P-A documentation is merged.
2. P-A integration tests are green in CI.
3. no production migration has been introduced by P-A.
4. the current public helper exposure list is accepted as baseline only.

## 7. Phase 1 planned work

Phase 1 is **API & Security Consolidation**.

Order:

1. classify public RPCs by domain and caller.
2. prove direct frontend callers.
3. harden accidental PUBLIC helper grants.
4. move internal SECURITY DEFINER helpers behind a private boundary where safe.
5. add compatibility wrappers for any function whose public name must remain stable.
6. consolidate duplicate permissive policy groups.
7. add contract tests for critical business commands.

No Item Master migration begins until this security/API boundary is stable.
