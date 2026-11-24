-- Read-only verification after staging the sales least-privilege migration.
-- Run in disposable CI database, never as a production DML smoke test.
DO $test$
DECLARE
  col text;
BEGIN
  -- Enumerate actual columns so new or omitted financial fields cannot escape the gate.
  FOR col IN SELECT attname::text FROM pg_attribute
    WHERE attrelid = 'public.sales'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname NOT IN ('customer_id', 'notes')
  LOOP
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
  IF has_table_privilege('authenticated', 'public.sales', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated role must not DELETE financial sales';
  END IF;
  IF has_table_privilege('authenticated', 'public.sale_items', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Authenticated role must not TRUNCATE financial sale items';
  END IF;
  IF has_table_privilege('anon', 'public.sales', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.sales', 'DELETE')
     OR has_table_privilege('anon', 'public.sale_items', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Anonymous role retains destructive sales privileges';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.sales'::regclass
      AND t.tgname = 'trg_sales_customer_branch_update_guard'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Cross-branch customer association guard must be active';
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
