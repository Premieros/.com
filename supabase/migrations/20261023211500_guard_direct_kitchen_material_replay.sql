-- Prevent double consumption when the private kitchen stock writer is invoked directly.
CREATE OR REPLACE FUNCTION private.consume_kitchen_raw_without_fifo_v1(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_event_id uuid, p_reference_number text, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_before numeric;v_after numeric;v_branch_total numeric;
 v_cost numeric;v_ledger bigint;v_batch uuid;
BEGIN
 IF p_qty IS NULL OR p_qty<=0 OR p_event_id IS NULL THEN
   RETURN jsonb_build_object('success',false,'error','INVALID_KITCHEN_CONSUMPTION');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses w WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active) THEN
  RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.raw_materials m WHERE m.id=p_raw_material_id AND m.branch_id=p_branch_id AND m.is_active) THEN
  RETURN jsonb_build_object('success',false,'error','RAW_MATERIAL_BRANCH_MISMATCH');
 END IF;
 -- Match the legacy stock writer's lock key while other workflows still use it.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
 -- Protect direct callers too, after obtaining the same per-material transaction lock.
 IF EXISTS (
   SELECT 1 FROM public.inventory_ledger il
   WHERE il.raw_material_id=p_raw_material_id AND il.branch_id=p_branch_id
     AND il.warehouse_id=p_warehouse_id
     AND il.reference_type='kitchen_send' AND il.reference_id=p_event_id
     AND il.entry_type='kitchen_send'
 ) THEN
   RETURN jsonb_build_object('success',false,'error','KITCHEN_MATERIAL_EVENT_ALREADY_DEDUCTED');
 END IF;
 SELECT COALESCE(SUM(quantity),0) INTO v_before FROM public.raw_material_batches
 WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
 v_after:=v_before-p_qty;
 v_cost:=COALESCE((private.raw_published_unit_cost_at_v2(p_raw_material_id,p_branch_id,pg_catalog.statement_timestamp())->>'unit_cost')::numeric,0);
 INSERT INTO public.raw_material_batches(
 raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,source_id
 ) VALUES(
 p_raw_material_id,p_branch_id,p_warehouse_id,'NF-'||pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,22),
 -p_qty,v_cost,'kitchen_send_non_fifo',p_event_id
 ) RETURNING id INTO v_batch;
 INSERT INTO public.inventory_ledger(
 raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,
 entry_type,reference_type,reference_id,reference_number,created_by
 ) SELECT p_raw_material_id,p_branch_id,p_warehouse_id,batch_number,
 -p_qty,v_cost,pg_catalog.round(-p_qty*v_cost,6),v_before,v_after,
 'kitchen_send','kitchen_send',p_event_id,p_reference_number,p_created_by
 FROM public.raw_material_batches WHERE id=v_batch RETURNING id INTO v_ledger;
 SELECT COALESCE(SUM(quantity),0) INTO v_branch_total FROM public.raw_material_batches
 WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
 INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
 VALUES(p_raw_material_id,p_branch_id,v_branch_total,v_cost)
 ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=pg_catalog.now();
 RETURN jsonb_build_object('success',true,'removed',p_qty,'shortage',0,
 'oversold',GREATEST(p_qty-GREATEST(v_before,0),0),
 'total_cost',pg_catalog.round(p_qty*v_cost,6),'avg_cost',v_cost,
 'warehouse_id',p_warehouse_id,'ledger_id',v_ledger);
END;
$function$
;
REVOKE ALL ON FUNCTION private.consume_kitchen_raw_without_fifo_v1(uuid,uuid,uuid,numeric,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.consume_kitchen_raw_without_fifo_v1(uuid,uuid,uuid,numeric,uuid,text,uuid) TO service_role;
