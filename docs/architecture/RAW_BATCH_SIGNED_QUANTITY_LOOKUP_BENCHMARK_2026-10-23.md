# All-sign raw batch quantity lookup optimization — 2026-10-23

Scope: Premieros/.com and Supabase project hvqlkapynjfjikqithvd only.

Applied migration index_all_raw_batches_warehouse_quantity_reconciliation: CREATE INDEX IF NOT EXISTS idx_raw_batches_branch_warehouse_material_quantity_all ON public.raw_material_batches (branch_id,warehouse_id,raw_material_id) INCLUDE (quantity). This covers negative and positive quantities; existing positive-only index could not answer the signed SUM used by new engine drift guard.

Single representative EXPLAIN ANALYZE of signed SUM(quantity), same branch warehouse material: before 164.493 ms using bitmap heap scan with 167 buffer hits; after 5.656 ms using index-only scan (1164 heap fetches). Around 96.6% lower on these two samples; not statistically rigorous or representative of production throughput. No balance, accounting or FIFO data mutated.

Remaining 9 active SQL FIFO callers. Inspected adjust_raw_stock: it has accounting side effects, and its API lacks warehouse ID, so it cannot safely be reconnected without a contract change. Do NOT drop this operational RPC casually. Full cutover, accounting journal reconciliation, frontend callers audit, concurrency and load tests remain mandatory.