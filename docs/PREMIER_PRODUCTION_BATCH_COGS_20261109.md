# Premier OS — Production batch-accurate COGS deployment

Date: 2026-11-09. Scope: web POS / inventory valuation. Production Supabase project `hvqlkapynjfjikqithvd`.

## Change applied

- Explicit owner approval was received to apply the finished-product batch COGS fix after successful isolated integration, browser and build checks (main Verify run 42592388776, deployment 42592388784).
- Reviewed candidate `scripts/db/candidates/premier_ready_product_batch_cogs_NOT_FOR_PRODUCTION.sql` had been tested on disposable CI PostgreSQL. Production baseline `public._deduct_ready_product_stock_policy` matched the reviewed candidate **exactly**, except for the five intended replacements (variable declaration, per-batch unit-cost selection, ledger unit/total costs, stock transactions unit cost, and total COGS).
- Before deployment, production `md5(pg_get_functiondef(...)) = 5594a335f3d6ec3b7afcf496e712e902`. The production migration adds an exact-source preflight guard to abort on drift and a post-creation function check.
- Supabase tracked migration **`20261109094032_premier_ready_product_actual_batch_cogs_20261109`** succeeded. Its exact SQL body was copied to `supabase/migrations/20261109094032_premier_ready_product_actual_batch_cogs_20261109.sql` so GitHub can reproduce production.
- Post-deployment read-only check: function hash `3e227eb3855d0af53bcbc98161c43568`, remains owned by `postgres`, remains SECURITY DEFINER, direct authenticated EXECUTE remains false. SQL now uses `v_batch.unit_cost` (with catalog fallback only on zero-cost legacy batches), passes unit cost to inventory ledger and stock transactions, and sums the actual batch cost into sale COGS.
- Emergency original-function rollback is stored in `scripts/db/rollback/premier_ready_product_batch_cogs_emergency_rollback.sql`; rollback must only be run with review and would restore the old costing behavior.

## Safety and limitations

- This migration updates a **function definition only**. It does not backdate/modify any existing sales, inventory rows, journal entries, or invoice totals. Existing sales with incorrect historical COGS are a separate audited reconciliation project requiring approval.
- Post-deployment aggregates: 1,248 sales, 0 currently populated `inventory_batches` rows, 21,847 inventory ledger entries, and 2,249 journal entries. **Therefore the newly deployed batch-cost path could not be exercised with existing production batches in this read-only audit.** Correctness for future manufactured batches is grounded in isolated CI tests, not a live test transaction.
- The 10 validated tenant FKs and the stock-count-items restrictive RLS gate remained present after deployment.
- Next validation gate: perform a controlled *staging* or approved live end-to-end production batch lifecycle with actual production inputs, test FIFO/cost journal and ensure no mismatched stock cost before claiming full live acceptance. Never automatically fabricate sales or raw-material batches on a live restaurant.
