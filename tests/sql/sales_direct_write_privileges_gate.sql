-- Read-only verification after staging the sales least-privilege migration.
-- Run in disposable CI database, never as a production DML smoke test.
DO $test$
DECLARE
  col text;
  privileged text[] := ARRAY[
    'subtotal', 'discount_amount', 'discount_type', 'tax_amount',
    'bonus_amount', 'total', 'paid_amount', 'refunded_amount',
    'payment_method', 'status', 'branch_id', 'warehouse_id',
    'invoice_number', 'source_order_id', 'is_archived'
  ];
BEGIN
  FOREACH col IN ARRAY privileged LOOP
    IF has_column_privilege('authenticated', 'public.sales', col, 'UPDATE') THEN
      RAISE EXCEPTION 'Authenticated role can directly update protected sales field %', col;
    END IF;
  END LOOP;
  IF NOT has_column_privilege('authenticated', 'public.sales', 'customer_id', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.sales', 'notes', 'UPDATE') THEN
    RAISE EXCEPTION 'Expected nonfinancial sales metadata UPDATE permission missing';
  END IF;
  IF has_table_privilege('authenticated', 'public.sales', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Authenticated role must not TRUNCATE financial sales';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.sync_sale_source_order_from_kitchen_event()'::regprocedure
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Sale source-order sync trigger must execute as its owner';
  END IF;
END;
$test$;
