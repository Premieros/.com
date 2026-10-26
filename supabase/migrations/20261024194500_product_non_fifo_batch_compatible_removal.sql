CREATE OR REPLACE FUNCTION private.remove_product_stock_non_fifo_v1(p_product_id uuid, p_warehouse_id uuid, p_branch_id uuid, p_qty numeric, p_entry_type text, p_reference_type text, p_reference_id uuid, p_reference_number text, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; v_remaining numeric:=p_qty; v_take numeric; v_before numeric; v_cost numeric; v_removed numeric:=0; v_total numeric:=0;
BEGIN
 IF p_qty IS NULL OR p_qty<=0 OR p_qty<>round(p_qty,4) THEN RETURN jsonb_build_object('success',false,'error','INVALID_PRODUCT_QUANTITY'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('product:'||p_product_id::text||':'||p_warehouse_id::text,0));
 SELECT quantity INTO v_before FROM public.inventory WHERE product_id=p_product_id AND warehouse_id=p_warehouse_id AND branch_id=p_branch_id FOR UPDATE;
 v_before:=coalesce(v_before,0);
 IF v_before<p_qty THEN RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_PRODUCT_STOCK','shortage',p_qty-v_before); END IF;
 IF (SELECT coalesce(sum(quantity),0) FROM public.inventory_batches WHERE product_id=p_product_id AND warehouse_id=p_warehouse_id AND branch_id=p_branch_id)<>v_before THEN
   RETURN jsonb_build_object('success',false,'error','PRODUCT_BALANCE_DRIFT');
 END IF;
 SELECT coalesce(cost_price,0) INTO v_cost FROM public.products WHERE id=p_product_id AND branch_id=p_branch_id;
 v_cost:=coalesce(v_cost,0);
 FOR r IN SELECT id,quantity,batch_number FROM public.inventory_batches
 WHERE product_id=p_product_id AND warehouse_id=p_warehouse_id AND branch_id=p_branch_id AND quantity>0
 ORDER BY quantity DESC,id FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0;
   v_take:=least(r.quantity,v_remaining);
   UPDATE public.inventory_batches SET quantity=quantity-v_take WHERE id=r.id;
   INSERT INTO public.inventory_ledger(product_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_by)
   VALUES(p_product_id,p_branch_id,p_warehouse_id,r.batch_number,-v_take,v_cost,-v_take*v_cost,v_before-v_removed,v_before-v_removed-v_take,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by);
   INSERT INTO public.stock_transactions(product_id,warehouse_id,branch_id,transaction_type,component_flow,reference_type,reference_id,quantity,before_quantity,after_quantity,unit_cost,created_by)
   VALUES(p_product_id,p_warehouse_id,p_branch_id,p_entry_type,false,coalesce(p_reference_type,p_entry_type),p_reference_id,-v_take,v_before-v_removed,v_before-v_removed-v_take,v_cost,p_created_by);
   v_remaining:=v_remaining-v_take; v_removed:=v_removed+v_take;v_total:=v_total+v_take*v_cost;
 END LOOP;
 IF v_remaining<>0 THEN RAISE EXCEPTION 'PRODUCT_BATCH_CONSUMPTION_INCOMPLETE'; END IF;
 UPDATE public.inventory SET quantity=v_before-v_removed,updated_at=now() WHERE product_id=p_product_id AND warehouse_id=p_warehouse_id AND branch_id=p_branch_id;
 RETURN jsonb_build_object('success',true,'removed',v_removed,'shortage',0,'total_cost',v_total,'avg_cost',v_cost);
END $function$
;
