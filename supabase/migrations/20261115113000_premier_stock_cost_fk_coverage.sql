-- Premier stock / costing foreign-key coverage, 2026-11-15.
-- Non-destructive indexes for branch-aware inventory and costing lookup paths.
-- Existing indexes use different leading columns / omit branch_id.
-- Avoid touching production rows, RLS policies, journal entries or tenant data.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

CREATE INDEX IF NOT EXISTS idx_premier_batches_product_branch
  ON public.inventory_batches (product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_premier_batches_warehouse_branch
  ON public.inventory_batches (warehouse_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_premier_ledger_product_branch
  ON public.inventory_ledger (product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_premier_ledger_raw_branch
  ON public.inventory_ledger (raw_material_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_premier_ledger_warehouse_branch
  ON public.inventory_ledger (warehouse_id, branch_id);
