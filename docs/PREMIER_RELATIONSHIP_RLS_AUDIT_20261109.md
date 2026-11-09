# Premier OS — Database relationships and effective permissions audit
Date: 2026-11-09. Status: DRAFT only. No production writes, migrations, RLS changes, or merge.

## Read-only production findings
- 23 critical branch-scope joins returned zero mismatches; composite branch-scoped foreign keys were absent in 24 reviewed critical tables.
- 146 negative raw-material inventory rows in two branches, both configured allow_negative_stock=true; 142 have nonpositive average cost. This needs cost-policy review, not automatic inventory correction.
- Verified policy issue: public.stock_counts has an authenticated SELECT policy USING (true), exposing cross-branch stock-count rows to principals granted SELECT.
- Expenses, sales, sale_items, purchases and purchase_items have overlapping permissive SELECT policies: broader branch reads OR-bypass financial-history visibility policies.
- product_unit_links read policy uses get_branch_id() and does not fully support authorized multi-branch access.
- One expense refers to a treasury account in another branch; its scope is organization and both branches belong to the same organization, so this is legitimate. Do not prohibit such accounts.
- Product-unit link, production order and expense account branch-join preflight counts returned zero; sample public tables have RLS enabled and no anon SELECT privilege.

## Proposed changes — UNAPPLIED SQL CANDIDATE
- Composite unique parent pairs and ten NOT VALID foreign keys for order/warehouse, sales/warehouse, inventory/warehouse+product, purchases/warehouse, stock-count/warehouse, recipes/product, payment/sale and kitchen send/order+item.
- RESTRICTIVE financial-history and stock-count branch SELECT policies; narrow multi-branch product-unit-link SELECT with restrictive branch gate.
- No production DDL or SQL applied. New uniqueness constraints can lock tables, and authorization changes require testing against real roles and all genuine RPC workflows.

## Test evidence and gates
- Synthetic isolated PostgreSQL fixture: scripts/db/tests/branch_hardening_fixture.sql.
- Negative tests: scripts/db/tests/branch_hardening_assertions.sql; assert cross-branch FK rejection plus authenticated cross-branch and old-history SELECT rejection.
- CI: .github/workflows/premier-tenant-integrity-candidates.yml. The candidate is never a canonical migration and runs only in a disposable postgres:16 service.
- Remaining: realistic full-schema clone and actual Premier roles (owner, superadmin, cashier, inventory manager, branch grants), legitimate workflows, security-definer RPCs, negative tests, and explicit production approval.
- Review account and product-unit links and journal-entry lines separately. Organization-scoped treasury accounts MUST remain usable.
