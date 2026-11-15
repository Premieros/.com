-- Premier: branch-integrity constraints for product batches and production orders.
-- Applied to the canonical Supabase database on 2026-11-15 and verified.
-- The conditional guards make this canonical repository migration safe when
-- replayed by scripts/db/apply-migration.js after Supabase MCP deployment.
-- Existing ON DELETE semantics are retained and no business rows are changed.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_batches'::regclass AND conname='premier_inventory_batches_product_branch_fk') THEN
    ALTER TABLE public.inventory_batches ADD CONSTRAINT premier_inventory_batches_product_branch_fk FOREIGN KEY (product_id, branch_id) REFERENCES public.products(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_batches'::regclass AND conname='premier_inventory_batches_warehouse_branch_fk') THEN
    ALTER TABLE public.inventory_batches ADD CONSTRAINT premier_inventory_batches_warehouse_branch_fk FOREIGN KEY (warehouse_id, branch_id) REFERENCES public.warehouses(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.production_orders'::regclass AND conname='premier_production_orders_product_branch_fk') THEN
    ALTER TABLE public.production_orders ADD CONSTRAINT premier_production_orders_product_branch_fk FOREIGN KEY (product_id, branch_id) REFERENCES public.products(id, branch_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.production_orders'::regclass AND conname='premier_production_orders_warehouse_branch_fk') THEN
    ALTER TABLE public.production_orders ADD CONSTRAINT premier_production_orders_warehouse_branch_fk FOREIGN KEY (warehouse_id, branch_id) REFERENCES public.warehouses(id, branch_id) NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.inventory_batches VALIDATE CONSTRAINT premier_inventory_batches_product_branch_fk;
ALTER TABLE public.inventory_batches VALIDATE CONSTRAINT premier_inventory_batches_warehouse_branch_fk;
ALTER TABLE public.production_orders VALIDATE CONSTRAINT premier_production_orders_product_branch_fk;
ALTER TABLE public.production_orders VALIDATE CONSTRAINT premier_production_orders_warehouse_branch_fk;
