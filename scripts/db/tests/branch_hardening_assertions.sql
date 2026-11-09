-- Execute only on isolated disposable PG fixture after candidate DDL.
\set ON_ERROR_STOP on
-- All new constraints must be present and enforce immediately (NOT VALID
-- allows existing rows before a separate VALIDATE phase).
DO $checks$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_constraint
 WHERE connamespace='public'::regnamespace
   AND conname IN (
    'premier_orders_warehouse_branch_fk','premier_sales_warehouse_branch_fk',
    'premier_inventory_warehouse_branch_fk','premier_inventory_product_branch_fk',
    'premier_purchases_warehouse_branch_fk','premier_stock_counts_warehouse_branch_fk',
    'premier_recipes_product_branch_fk','premier_sale_payments_sale_branch_fk',
    'premier_kitchen_send_order_branch_fk','premier_kitchen_send_item_order_fk');
 IF n<>10 THEN RAISE EXCEPTION 'Expected 10 protected composite FKs, found %',n; END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname LIKE 'premier_%_fk' AND convalidated) THEN
   RAISE EXCEPTION 'New FKs are expected NOT VALID until separate validation'; END IF;
END $checks$;

-- Good same-branch purchase, payment and inventory data must be accepted.
INSERT INTO public.inventory VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021');
INSERT INTO public.sale_payments VALUES
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000041',
  '00000000-0000-0000-0000-000000000001');
INSERT INTO public.order_kitchen_sends VALUES
 ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000051');

-- Malicious cross-branch INSERT and UPDATE must violate composite FKs,
-- even if an RPC is SECURITY DEFINER or RLS is not involved.
DO $negative_fks$
BEGIN
 BEGIN
  INSERT INTO public.inventory VALUES
    ('00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000021');
  RAISE EXCEPTION 'CROSS_BRANCH_INVENTORY_WAREHOUSE_ALLOWED';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.inventory VALUES
    ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022');
  RAISE EXCEPTION 'CROSS_BRANCH_INVENTORY_PRODUCT_ALLOWED';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.sale_payments VALUES
    ('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000043',
    '00000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'CROSS_BRANCH_SALE_PAYMENT_ALLOWED';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.order_kitchen_sends VALUES
    ('00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000000031',
    '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000052');
  RAISE EXCEPTION 'CROSS_ORDER_KITCHEN_ITEM_ALLOWED';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  UPDATE public.warehouses SET branch_id='00000000-0000-0000-0000-000000000002'
    WHERE id='00000000-0000-0000-0000-000000000011';
  RAISE EXCEPTION 'PARENT_BRANCH_UPDATE_ALLOWED';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $negative_fks$;

-- Simulate actual DB role for SELECT tests. This does not assume a real
-- customer's JWT. The helper functions read an explicit test-only context.
SET ROLE authenticated;
SET app.allowed_branch = '00000000-0000-0000-0000-000000000001';
SET app.test_admin = 'no';

DO $rls_negative$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.expenses;
  IF n<>1 THEN RAISE EXCEPTION 'EXPENSE_RLS_HISTORY_OR_BRANCH_BYPASS: %',n; END IF;
  SELECT count(*) INTO n FROM public.sales;
  IF n<>1 THEN RAISE EXCEPTION 'SALES_RLS_HISTORY_OR_BRANCH_BYPASS: %',n; END IF;
  SELECT count(*) INTO n FROM public.sale_items;
  IF n<>1 THEN RAISE EXCEPTION 'SALE_ITEMS_RLS_HISTORY_OR_BRANCH_BYPASS: %',n; END IF;
  SELECT count(*) INTO n FROM public.purchases;
  IF n<>1 THEN RAISE EXCEPTION 'PURCHASES_RLS_HISTORY_OR_BRANCH_BYPASS: %',n; END IF;
  SELECT count(*) INTO n FROM public.purchase_items;
  IF n<>1 THEN RAISE EXCEPTION 'PURCHASE_ITEMS_RLS_HISTORY_OR_BRANCH_BYPASS: %',n; END IF;
  SELECT count(*) INTO n FROM public.stock_counts;
  IF n<>1 THEN RAISE EXCEPTION 'STOCK_COUNTS_RLS_BRANCH_BYPASS: %',n; END IF;
  SELECT count(*) INTO n FROM public.product_unit_links;
  IF n<>1 THEN RAISE EXCEPTION 'PRODUCT_UNIT_LINKS_BRANCH_BYPASS: %',n; END IF;
END $rls_negative$;
-- Legitimate branch B user can read its own *recent* information.
SET app.allowed_branch = '00000000-0000-0000-0000-000000000002';
DO $legitimate_branch$
BEGIN
  IF (SELECT count(*) FROM public.sales) <> 1
     OR (SELECT count(*) FROM public.purchases) <> 1
     OR (SELECT count(*) FROM public.stock_counts) <> 1
     OR (SELECT count(*) FROM public.product_unit_links) <> 1 THEN
    RAISE EXCEPTION 'LEGITIMATE_BRANCH_B_READ_BROKEN';
  END IF;
END $legitimate_branch$;

-- Platform admin must retain visibility across both branches/history.
SET app.test_admin = 'yes';
DO $legitimate_admin$
BEGIN
  IF (SELECT count(*) FROM public.sales) <> 3
     OR (SELECT count(*) FROM public.purchases) <> 3
     OR (SELECT count(*) FROM public.expenses) <> 3
     OR (SELECT count(*) FROM public.stock_counts) <> 2
     OR (SELECT count(*) FROM public.product_unit_links) <> 2 THEN
    RAISE EXCEPTION 'LEGITIMATE_ADMIN_READ_BROKEN';
  END IF;
END $legitimate_admin$;
RESET ROLE;
SELECT 'TENANT_FK_RLS_NEGATIVE_AND_AUTHORIZED_POSITIVE_TESTS_PASSED' AS result;
