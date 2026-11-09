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

## Permission-aware RLS follow-up
- Checked actual Premier role permission JSON. The relevant keys are sales.view, expenses.view, purchases.view, and inventory.view / inventory.count.*. Some active roles legitimately have none of these while holding pos.view. Branch access alone MUST NOT authorize financial/stock history queries.
- Candidate now requires both authorized branch/history and matching financial view permission for expenses, sales, sale_items, purchases and purchase_items. Stock-count reads require authorized branch AND inventory viewing/counting permission. Admin override is retained.
- Added synthetic authenticated role negative test for a branch member with NO financial/stock-view grants; positive tests retain authorized branch A, branch B and platform-admin access. **Isolated CI test run 42579067835 PASSED on commit 1197f300**.
- The synthetic history helper denies older rows for testing; the real production financial_row_visible helper uses configurable recent-days/historical sampling, which the candidate preserves without changing helper definitions.
- This does not establish effective access of every actual Premier user; SQL SECURITY DEFINER RPC routes, role exceptions, RLS SQL execution contexts, and UI workflows require an anonymized real-schema test prior to release.

## 2026-11-09 production reconciliation (subsequent authorized rollout)

**IMPORTANT STATUS UPDATE:** The above sections describe the original draft BEFORE the production rollout. New read-only verification proves **14 named Supabase migration-history versions 20261109072830–20261109074100 already ran on the Premier production project**, including the stock-count restrictive gate, financial view permission/history gates, the 10 composite FKs (all VALIDATED), and product-unit-links multi-branch policy. These migrations appeared during the day independently of PR #142; **do not apply the candidate SQL to production again**.

- Retrieved the exact applied SQL body of each of the 14 recorded migrations from `supabase_migrations.schema_migrations.statements[1]`; mirrored them into `supabase/migrations/<version>_<name>.sql` on this PR branch, preserving the SQL body, comments added only outside it. Main did not contain these versions before this reconciliation.
- All 10 expected composite foreign-key constraints are present and validated in live pg_catalog; the financial and stock count RLS policies have the expected RESTRICTIVE policy expressions and permission gates.
- Read-only `BEGIN READ ONLY; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',...,true);` role simulations on a representative **existing active user** per role (cashier, branch manager, accountant, kitchen, super_admin) were rolled back. They showed **zero** outside-grant stock counts or sales for non-platform-admin roles, cashier blocked from purchases/expenses, kitchen blocked from sale/purchase/expense/stock counts, and authorized branch manager/accountant reading their normal data. This simulates JWT role and identity at the DB layer; **not** an actual end-to-end user session, so it does not prove every RPC, WRITE privilege, or all role combinations.
- Sample stock-count data is small (1 row), therefore zero-leak results must not be generalized to all future branch data.
- Supabase security advisors also report 1 anon-executable SECURITY DEFINER registration function `public.register_trial_tenant`; this is a likely intentional public trial signup path, **not revoked** without signup-flow tests. See https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- Remaining: run actual authenticated INSERT/UPDATE/DELETE and financial RPC negative tests in a representative cloned database; run browser POS workflows and full canonical CI migration replay; review other child/parent branch links independently.
- The mirrored migrations are **already present in production**; do not run them manually, and do not confuse GitHub candidate files with authoritative applied SQL.

### Deployment state

No additional Supabase production migration was applied during this reconciliation pass. The production database changes were already present on discovery. PR #142 remains a DRAFT pending integration tests and merge, so GitHub `main` is not yet synchronized with these 14 recorded migrations.
