-- Premier: enforce branch ownership for inventory batches and production orders.
-- Verified preflight (2026-11-15): zero branch mismatches on these four paths.
-- Preserve existing ON DELETE semantics; no data modification.
-- NOT VALID avoids an initial full-table scan; VALIDATE checks historic rows.

ALTER TABLE public.inventory_batches
  ADD CONSTRAINT premier_inventory_batches_product_branch_fk
    FOREIGN KEY (product_id, branch_id)
    REFERENCES public.products (id, branch_id)
    ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT premier_inventory_batches_warehouse_branch_fk
    FOREIGN KEY (warehouse_id, branch_id)
    REFERENCES public.warehouses (id, branch_id)
    ON DELETE CASCADE NOT VALID;

ALTER TABLE public.production_orders
  ADD CONSTRAINT premier_production_orders_product_branch_fk
    FOREIGN KEY (product_id, branch_id)
    REFERENCES public.products (id, branch_id)
    NOT VALID,
  ADD CONSTRAINT premier_production_orders_warehouse_branch_fk
    FOREIGN KEY (warehouse_id, branch_id)
    REFERENCES public.warehouses (id, branch_id)
    NOT VALID;

ALTER TABLE public.inventory_batches VALIDATE CONSTRAINT premier_inventory_batches_product_branch_fk;
ALTER TABLE public.inventory_batches VALIDATE CONSTRAINT premier_inventory_batches_warehouse_branch_fk;
ALTER TABLE public.production_orders VALIDATE CONSTRAINT premier_production_orders_product_branch_fk;
ALTER TABLE public.production_orders VALIDATE CONSTRAINT premier_production_orders_warehouse_branch_fk;
