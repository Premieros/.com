-- PREMIER SECURITY CANDIDATE ONLY — DO NOT APPLY TO PRODUCTION.
-- Tested schema snapshot: Premier production read-only pg_catalog on 2026-11-09.
-- Run on fully migrated isolated PostgreSQL with role-negative tests first.
-- NOT a canonical supabase/migrations file and not automatically deployed.
--
-- Composite FKs protect tenant isolation across writes, including SECURITY
-- DEFINER RPCs and cross-branch UPDATEs. All newly introduced FKs use
-- NOT VALID so validation can be staged; they DO enforce future writes.
-- Only apply after the preflight in branch_relationships_preflight.sql returns
-- zero violations. Existing NULL references follow MATCH SIMPLE semantics.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Parent unique pairs are required by PostgreSQL for multi-column FKs.
-- Index/constraint builds lock tables: use scheduled maintenance for large DBs.
ALTER TABLE public.warehouses
  ADD CONSTRAINT premier_warehouses_id_branch_uq UNIQUE (id,branch_id);
ALTER TABLE public.products
  ADD CONSTRAINT premier_products_id_branch_uq UNIQUE (id,branch_id);
ALTER TABLE public.orders
  ADD CONSTRAINT premier_orders_id_branch_uq UNIQUE (id,branch_id);
ALTER TABLE public.sales
  ADD CONSTRAINT premier_sales_id_branch_uq UNIQUE (id,branch_id);
ALTER TABLE public.order_items
  ADD CONSTRAINT premier_order_items_id_order_uq UNIQUE (id,order_id);

-- Warehouse must belong to the same branch as its order, sale, count,
-- inventory balance and purchase; protect both the child and parent UPDATE.
ALTER TABLE public.orders
  ADD CONSTRAINT premier_orders_warehouse_branch_fk
  FOREIGN KEY (inventory_warehouse_id,branch_id)
  REFERENCES public.warehouses(id,branch_id) NOT VALID;
ALTER TABLE public.sales
  ADD CONSTRAINT premier_sales_warehouse_branch_fk
  FOREIGN KEY (warehouse_id,branch_id)
  REFERENCES public.warehouses(id,branch_id) NOT VALID;
ALTER TABLE public.inventory
  ADD CONSTRAINT premier_inventory_warehouse_branch_fk
  FOREIGN KEY (warehouse_id,branch_id)
  REFERENCES public.warehouses(id,branch_id) NOT VALID;
ALTER TABLE public.inventory
  ADD CONSTRAINT premier_inventory_product_branch_fk
  FOREIGN KEY (product_id,branch_id)
  REFERENCES public.products(id,branch_id) NOT VALID;
ALTER TABLE public.purchases
  ADD CONSTRAINT premier_purchases_warehouse_branch_fk
  FOREIGN KEY (warehouse_id,branch_id)
  REFERENCES public.warehouses(id,branch_id) NOT VALID;
ALTER TABLE public.stock_counts
  ADD CONSTRAINT premier_stock_counts_warehouse_branch_fk
  FOREIGN KEY (warehouse_id,branch_id)
  REFERENCES public.warehouses(id,branch_id) NOT VALID;
ALTER TABLE public.recipes
  ADD CONSTRAINT premier_recipes_product_branch_fk
  FOREIGN KEY (product_id,branch_id)
  REFERENCES public.products(id,branch_id) NOT VALID;

-- Payment branch must match sale branch, regardless of RLS/RPC privileges.
ALTER TABLE public.sale_payments
  ADD CONSTRAINT premier_sale_payments_sale_branch_fk
  FOREIGN KEY (sale_id,branch_id)
  REFERENCES public.sales(id,branch_id) NOT VALID;

-- Kitchen send must refer to an order in its branch and the intended
-- line belonging to that exact order (not merely a valid order_item UUID).
ALTER TABLE public.order_kitchen_sends
  ADD CONSTRAINT premier_kitchen_send_order_branch_fk
  FOREIGN KEY (order_id,branch_id)
  REFERENCES public.orders(id,branch_id) NOT VALID;
ALTER TABLE public.order_kitchen_sends
  ADD CONSTRAINT premier_kitchen_send_item_order_fk
  FOREIGN KEY (order_item_id,order_id)
  REFERENCES public.order_items(id,order_id) NOT VALID;

-- No silent widening of access: RESTRICTIVE SELECT policies are combined
-- via AND with any existing PERMISSIVE SELECT/ALL policies.
-- Historical views: existing permissive policies can otherwise OR-bypass
-- financial-history visibility filters on these tables.
CREATE POLICY premier_expenses_financial_select_gate
  ON public.expenses AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR private.financial_row_visible(id,branch_id,created_at));
CREATE POLICY premier_sale_items_financial_select_gate
  ON public.sale_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR private.sale_read_visible_by_id(sale_id));
CREATE POLICY premier_sales_financial_select_gate
  ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR private.sale_read_visible(id,branch_id,created_at));

-- Cross-branch access must use explicit branch permission, not merely
-- one primary branch stored in the users profile.
-- This restricts both the permissive SELECT and the admin ALL path.
CREATE POLICY premier_product_unit_links_branch_gate
  ON public.product_unit_links AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id=product_unit_links.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id=product_unit_links.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  );
-- The legacy permissive pul_branch_read remains scoped to get_branch_id().
-- A restrictive policy cannot widen that path: add separate narrowly scoped
-- permissive SELECT for legitimate multi-branch users.
CREATE POLICY premier_product_unit_links_multibranch_read
  ON public.product_unit_links AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id=product_unit_links.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  );

COMMIT;

-- Do not mark VALIDATED in this candidate without running a separate
-- full DB preflight, validation and application role simulation.
