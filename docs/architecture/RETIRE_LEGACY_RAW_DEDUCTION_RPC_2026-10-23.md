# Legacy raw material deduction RPC retirement — 2026-10-23

Scope Premieros/.com and Supabase hvqlkapynjfjikqithvd only.

Applied migration retire_unreferenced_fifo_raw_material_deduction_rpc: DROP FUNCTION public.deduct_raw_material_inventory(uuid,numeric,uuid,uuid) RESTRICT.

This SECURITY DEFINER RPC previously called _raw_remove_fifo and had no references among PostgreSQL function bodies. GitHub default branch code search also yielded no hits but is not conclusive for dynamic clients.

Verified to_regprocedure returned null; number of other routines referencing _raw_remove_fifo fell from 10 to 9.

Caution: if unindexed application or Edge Function code calls this RPC it may fail. Restore previous definition if affected clients are discovered. No business data or journals changed.

FIFO is still active in nine SQL callers. Checkout migration and load tests remain unfinished.