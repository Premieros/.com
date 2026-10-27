-- Read-only regression guard: manufactured groups must be consumed at kitchen send.
-- This gate fails on the legacy kitchen writer until an atomic manufactured-unit
-- deduction with idempotent reversal and event bookkeeping is implemented.
DO $gate$
DECLARE writer text; restore_writer text;
BEGIN
  SELECT prosrc INTO writer FROM pg_proc
  WHERE oid='public._deduct_kitchen_raw_components(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid)'::regprocedure;
  SELECT prosrc INTO restore_writer FROM pg_proc
  WHERE oid='public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)'::regprocedure;
  IF position('product_unit_links' IN writer)=0 OR position('inventory_unit' IN writer)=0 THEN
    RAISE EXCEPTION 'KITCHEN_SEND_MANUFACTURED_STOCK_NOT_DEDUCTED';
  END IF;
  IF position('inventory_unit' IN restore_writer)=0 THEN
    RAISE EXCEPTION 'KITCHEN_VOID_MANUFACTURED_STOCK_NOT_RESTORED';
  END IF;
END $gate$;
