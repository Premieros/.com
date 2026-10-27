-- Non-mutating acceptance test: completed production adds and sale consumption removes
-- manufactured-unit stock in the SAME branch and warehouse.
DO $verify$
DECLARE mismatch_count bigint; missing_view bigint; production_writer text; sale_writer text;
BEGIN
  SELECT prosrc INTO production_writer FROM pg_proc
  WHERE oid='public._produce_inventory_unit_internal(uuid,numeric,uuid,uuid,text,boolean)'::regprocedure;
  IF position('INSERT INTO public.inventory_unit_batches' IN production_writer)=0
     OR position('INSERT INTO public.inventory_unit_entries' IN production_writer)=0 THEN
    RAISE EXCEPTION 'PRODUCTION_MUST_RECORD_STOCK_AND_LEDGER';
  END IF;
  SELECT prosrc INTO sale_writer FROM pg_proc
  WHERE oid='public.deduct_sale_unit_inventory(uuid,uuid,jsonb,uuid,text)'::regprocedure;
  IF position('UPDATE public.inventory_unit_batches' IN sale_writer)=0
     OR position('INSERT INTO public.inventory_unit_entries' IN sale_writer)=0 THEN
    RAISE EXCEPTION 'SALE_MUST_DEDUCT_MANUFACTURED_STOCK_AND_RECORD_LEDGER';
  END IF;

  WITH events AS (
    SELECT unit_id,branch_id,warehouse_id,sum(quantity) qty
    FROM public.inventory_unit_entries GROUP BY 1,2,3
  ), batches AS (
    SELECT unit_id,branch_id,warehouse_id,sum(quantity) qty
    FROM public.inventory_unit_batches GROUP BY 1,2,3
  ), keys AS (
    SELECT unit_id,branch_id,warehouse_id FROM events
    UNION SELECT unit_id,branch_id,warehouse_id FROM batches
  )
  SELECT count(*) INTO mismatch_count FROM keys k
  LEFT JOIN events e USING(unit_id,branch_id,warehouse_id)
  LEFT JOIN batches b USING(unit_id,branch_id,warehouse_id)
  WHERE coalesce(e.qty,0)<>coalesce(b.qty,0);
  IF mismatch_count>0 THEN RAISE EXCEPTION 'MANUFACTURED_LEDGER_BATCH_DRIFT: %',mismatch_count; END IF;

  SELECT count(*) INTO missing_view
  FROM (SELECT unit_id,branch_id,warehouse_id,sum(quantity) qty
        FROM public.inventory_unit_batches GROUP BY 1,2,3) b
  LEFT JOIN public.v_current_stock_position v
    ON v.item_type='manufactured' AND v.item_id=b.unit_id
   AND v.branch_id=b.branch_id AND v.warehouse_id=b.warehouse_id
  WHERE v.quantity IS DISTINCT FROM b.qty;
  IF missing_view>0 THEN RAISE EXCEPTION 'MANUFACTURED_SCREEN_STOCK_DRIFT: %',missing_view; END IF;
END $verify$;
