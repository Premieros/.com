# Selective Johna's → Premier feature migration

## Scope and source protection
- Read-only source: Johna's legacy source repository (read-only) (no commits, branches, database writes or deployments).
- Target: `Premieros/.com`. Every change must be adapted to Premier's current React/TypeScript architecture, routes, Supabase schema, branch scopes, RLS, roles and reporting/costing engines.
- A file missing by path is **only a candidate**, not proof that the feature is absent.
- Migrate one cohesive feature at a time, with source comparison, runtime integration, regression tests, CI and a separate PR.
- Never replace a working Premier page with the Johna's version or copy database migrations blindly.
- No synthetic business data, no bypass of branch permissions, no stock/accounting side effects during import.

## Verified feature gap

| Feature | Johna's | Premier before migration | Selected approach |
|---|---|---|---|
| Stock-count Excel worksheet export/import | Implemented in stock-count page and validation utility | Stock count draft/approval exists but Excel controls and parser absent | Port parser and add only the Excel controls to Premier's existing draft; use Premier's scoped branch/warehouse reads; retain submit/approve/apply |
| Stock-count approval | Implemented | Already present | **Do not duplicate or replace** |
| Multi-branch visibility | Different implementation | Premier has `useBranchScope` | **Preserve Premier's branchScope** |
| Existing raw material and stock balance tables | Used by Johna's | Already integrated into Premier | Reuse existing RLS-protected read; no new table |

## Candidate clusters requiring semantic review (not automatically missing)

- **Inventory:** stock snapshots, valuation, waste, warehouse transfer and cycle count enhancements. Compare UI/service workflows and existing RPC contracts before adoption.
- **Costing & recipes:** current raw prices, historical cost estimation, recipe costing, product recipe cost panel. Check Premier's existing costing and BOM definitions to avoid competing calculations.
- **Administration:** branch activity pulse, support inbox and access workflows. Require per-role permissions and validated backend RPC availability.
- **Catalog and trade:** CRUD service boundaries, price management, supplier/customer flows. Verify overlap with Premier's current CRUD before migrating.
- **Reporting and accounting:** many different service files exist in Johna's; Premier already has an updated reporting center and financial engines. **Do not transplant legacy reporting loaders or calculations** without field-level equivalence checks.
- **POS and offline:** evaluate branch/security handling, queue behavior and concurrency against Premier before any migration.

## Acceptance criteria for each next feature
1. Confirm it is **functionally absent**, not merely relocated or renamed.
2. Check source dependencies and compatibility with Premier's schema, access controls and routes.
3. Copy only needed behavior; integrate into existing components and services.
4. Test non-regression of existing accounting, inventory, pricing, workflows and branch isolation.
5. Create a focused PR; merge only with verified checks and then verify production deployment.
6. Leave Johna's repository and deployment untouched.

## Current batch
First verified feature: Excel-assisted stock count drafts. The Excel upload prepares rows in the existing form; writing stock still requires the original Premier count workflow and permissions.
