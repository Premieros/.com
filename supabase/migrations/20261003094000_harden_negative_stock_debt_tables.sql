-- Harden negative-stock debt tables for Supabase advisor cleanliness and FK performance.

CREATE INDEX IF NOT EXISTS idx_product_stock_debts_branch_id
  ON public.product_stock_debts(branch_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_debts_warehouse_id
  ON public.product_stock_debts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_debts_sale_id
  ON public.product_stock_debts(sale_id)
  WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_stock_debts_oversold_batch_id
  ON public.product_stock_debts(oversold_batch_id)
  WHERE oversold_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_unit_stock_debts_branch_id
  ON public.inventory_unit_stock_debts(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_stock_debts_warehouse_id
  ON public.inventory_unit_stock_debts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_stock_debts_sale_id
  ON public.inventory_unit_stock_debts(sale_id)
  WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_unit_stock_debts_oversold_batch_id
  ON public.inventory_unit_stock_debts(oversold_batch_id)
  WHERE oversold_batch_id IS NOT NULL;

DROP POLICY IF EXISTS product_stock_debts_deny_client ON public.product_stock_debts;
CREATE POLICY product_stock_debts_deny_client
ON public.product_stock_debts
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS inventory_unit_stock_debts_deny_client ON public.inventory_unit_stock_debts;
CREATE POLICY inventory_unit_stock_debts_deny_client
ON public.inventory_unit_stock_debts
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
