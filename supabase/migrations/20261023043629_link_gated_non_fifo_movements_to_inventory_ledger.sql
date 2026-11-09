-- Already-applied Premier production SQL restored verbatim for disposable CI replay.
-- Production migration 20261023043629; DO NOT manually reapply to production.
ALTER TABLE private.raw_warehouse_movements_v2 ADD COLUMN IF NOT EXISTS ledger_id bigint UNIQUE REFERENCES public.inventory_ledger(id);
CREATE OR REPLACE FUNCTION private.apply_raw_warehouse_delta_v2(p_operation_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_raw_material_id uuid, p_delta numeric, p_allow_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 v_old private.raw_warehouse_movements_v2%ROWTYPE;
 v_before numeric(18,4); v_after numeric(18,4); v_legacy numeric;
 v_price jsonb; v_unit_cost numeric(18,6); v_event uuid; v_ledger_id bigint;
BEGIN
 IF p_operation_id IS NULL OR p_branch_id IS NULL OR p_warehouse_id IS NULL OR
    p_raw_material_id IS NULL OR p_delta IS NULL OR p_delta=0 OR p_delta<>round(p_delta,4) THEN
  RETURN jsonb_build_object('success',false,'error','INVALID_ARGUMENTS');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses w WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active)
 OR NOT EXISTS(SELECT 1 FROM public.raw_materials r WHERE r.id=p_raw_material_id AND r.branch_id=p_branch_id) THEN
  RETURN jsonb_build_object('success',false,'error','BRANCH_OR_WAREHOUSE_MISMATCH');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
   p_branch_id::text||':'||p_warehouse_id::text||':'||p_raw_material_id::text,0));
 SELECT * INTO v_old FROM private.raw_warehouse_movements_v2 WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF v_old.branch_id<>p_branch_id OR v_old.warehouse_id<>p_warehouse_id OR
   v_old.raw_material_id<>p_raw_material_id OR v_old.quantity_delta<>p_delta THEN
   RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN jsonb_build_object('success',true,'replayed',true,'before_qty',v_old.before_qty,
     'after_qty',v_old.after_qty,'unit_cost',v_old.unit_cost,'operation_id',p_operation_id);
 END IF;
 SELECT b.quantity INTO v_before FROM private.raw_warehouse_balances_v2 b
 WHERE b.branch_id=p_branch_id AND b.warehouse_id=p_warehouse_id
 AND b.raw_material_id=p_raw_material_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','BALANCE_NOT_INITIALIZED'); END IF;
 SELECT coalesce(sum(b.quantity),0) INTO v_legacy FROM public.raw_material_batches b
 WHERE b.branch_id=p_branch_id AND b.warehouse_id=p_warehouse_id AND b.raw_material_id=p_raw_material_id;
 IF v_legacy<>v_before THEN
  RETURN jsonb_build_object('success',false,'error','LEGACY_BALANCE_DRIFT');
 END IF;
 -- Refuse real writes until legacy writers have been replaced. Transaction-local test runs can use this opt-in.
 IF coalesce(current_setting('premieros.v2_movement_test',true),'') <> 'enabled' THEN
  RETURN jsonb_build_object('success',false,'error','CUTOVER_NOT_ENABLED');
 END IF;
 v_after:=v_before+p_delta;
 IF v_after<0 AND NOT p_allow_negative THEN
  RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_STOCK','available',v_before);
 END IF;
 v_price:=private.raw_published_unit_cost_at_v2(p_raw_material_id,p_branch_id,statement_timestamp());
 IF coalesce((v_price->>'success')::boolean,false) IS NOT TRUE THEN
  RETURN jsonb_build_object('success',false,'error','PRICE_LOOKUP_FAILED');
 END IF;
 v_unit_cost:=(v_price->>'unit_cost')::numeric;
 v_event:=nullif(v_price->>'price_event_id','')::uuid;
 UPDATE private.raw_warehouse_balances_v2 SET quantity=v_after,updated_at=now()
 WHERE branch_id=p_branch_id AND warehouse_id=p_warehouse_id AND raw_material_id=p_raw_material_id;
 INSERT INTO private.raw_warehouse_movements_v2(
  operation_id,branch_id,warehouse_id,raw_material_id,quantity_delta,
  before_qty,after_qty,unit_cost,total_cost,price_event_id
 ) VALUES(p_operation_id,p_branch_id,p_warehouse_id,p_raw_material_id,p_delta,
  v_before,v_after,v_unit_cost,round(p_delta*v_unit_cost,6),v_event);
 INSERT INTO public.inventory_ledger(
  raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,
  before_qty,after_qty,entry_type,reference_type,reference_id,reference_number
 ) VALUES (
  p_raw_material_id,p_branch_id,p_warehouse_id,p_delta,v_unit_cost,
  round(p_delta*v_unit_cost,6),v_before,v_after,
  CASE WHEN p_delta<0 THEN 'production' ELSE 'adjustment' END,
  'warehouse_movement_v2',p_operation_id,p_operation_id::text
 ) RETURNING id INTO v_ledger_id;
 UPDATE private.raw_warehouse_movements_v2
 SET ledger_id=v_ledger_id WHERE operation_id=p_operation_id;
  RETURN jsonb_build_object('success',true,'replayed',false,'operation_id',p_operation_id,
  'before_qty',v_before,'after_qty',v_after,'unit_cost',v_unit_cost,
  'total_cost',round(p_delta*v_unit_cost,6));
END;
$function$

