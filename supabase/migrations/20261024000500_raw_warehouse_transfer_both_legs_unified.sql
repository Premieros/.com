-- Retain transfer approval permissions and product stock handling; process raw source and destination together via the unified engine.
CREATE OR REPLACE FUNCTION public.approve_warehouse_transfer(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_transfer record;
  v_item record;
  v_avail numeric(14,4);
  v_res jsonb;
  v_add jsonb;
  v_short numeric(14,4);
  v_cost numeric(14,4);
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.approve') THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED'); END IF;

  SELECT wt.* INTO v_transfer
  FROM public.warehouse_transfers wt
  WHERE wt.id = p_transfer_id
    AND public.user_may_access_branch(wt.branch_id)
    AND public.user_may_access_branch(COALESCE(wt.to_branch_id, wt.branch_id))
  FOR UPDATE;
  IF v_transfer.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND'); END IF;
  IF v_transfer.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_transfer.status); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_transfer.from_warehouse_id AND branch_id = v_transfer.branch_id)
     OR NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_transfer.to_warehouse_id AND branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  -- Preflight all lines before moving any stock.
  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_avail FROM public.inventory_batches
      WHERE product_id = v_item.product_id AND warehouse_id = v_transfer.from_warehouse_id AND branch_id = v_transfer.branch_id;
      IF v_avail < v_item.quantity THEN RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'product_id', v_item.product_id, 'required', v_item.quantity, 'available', v_avail); END IF;
    ELSE
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        SELECT COALESCE(quantity, 0) INTO v_avail FROM public.raw_material_warehouse_inventory
        WHERE raw_material_id = v_item.raw_material_id AND branch_id = v_transfer.branch_id AND warehouse_id = v_transfer.from_warehouse_id;
      ELSE
        SELECT COALESCE(quantity, 0) INTO v_avail FROM public.raw_material_inventory WHERE raw_material_id = v_item.raw_material_id AND branch_id = v_transfer.branch_id;
      END IF;
      v_avail := COALESCE(v_avail, 0);
      IF v_avail < v_item.quantity THEN RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_RAW_STOCK', 'raw_material_id', v_item.raw_material_id, 'required', v_item.quantity, 'available', v_avail); END IF;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id ORDER BY id LOOP
    IF v_item.product_id IS NOT NULL THEN
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) AND v_item.destination_product_id = v_item.product_id THEN
        v_res := public._product_inv_move(v_item.product_id, v_transfer.from_warehouse_id, v_transfer.to_warehouse_id, v_transfer.branch_id, v_item.quantity, 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
        IF COALESCE((v_res->>'success')::boolean, true) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_MOVE_FAILED product=% detail=%', v_item.product_id, v_res::text; END IF;
        v_short := COALESCE((v_res->>'shortage')::numeric, 0);
        IF v_short > 0 THEN RAISE EXCEPTION 'TRANSFER_STOCK_RACE product=% shortage=%', v_item.product_id, v_short; END IF;
      ELSE
        v_res := public._product_inv_remove_fifo(v_item.product_id, v_transfer.from_warehouse_id, v_transfer.branch_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
        IF COALESCE((v_res->>'success')::boolean, true) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_REMOVE_FAILED product=% detail=%', v_item.product_id, v_res::text; END IF;
        v_short := COALESCE((v_res->>'shortage')::numeric, 0);
        IF v_short > 0 THEN RAISE EXCEPTION 'TRANSFER_STOCK_RACE product=% shortage=%', v_item.product_id, v_short; END IF;
        v_cost := COALESCE((v_res->>'avg_cost')::numeric, v_item.unit_cost, 0);
        v_add := public._product_inv_add(v_item.destination_product_id, v_transfer.to_warehouse_id, v_transfer.to_branch_id, v_item.quantity, v_cost, NULL, NULL, NULL, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
        IF COALESCE((v_add->>'success')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_DESTINATION_ADD_FAILED product=% detail=%', v_item.destination_product_id, v_add::text; END IF;
      END IF;
    ELSE
      -- Both legs use the unified engine and the same transaction as approval.
      v_res := private.apply_unified_raw_movement_v1(
        gen_random_uuid(),v_transfer.branch_id,v_transfer.from_warehouse_id,
        v_item.raw_material_id,-v_item.quantity,'transfer','warehouse_transfer',
        v_transfer.id,v_transfer.transfer_number,auth.uid(),false
      );
      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        RAISE EXCEPTION 'TRANSFER_RAW_REMOVE_FAILED raw=% detail=%',v_item.raw_material_id,v_res;
      END IF;
      v_cost := COALESCE((v_res->>'unit_cost')::numeric,0);
      v_add := private.apply_unified_raw_movement_v1(
        gen_random_uuid(),COALESCE(v_transfer.to_branch_id,v_transfer.branch_id),
        v_transfer.to_warehouse_id,
        CASE WHEN v_transfer.branch_id=COALESCE(v_transfer.to_branch_id,v_transfer.branch_id)
          THEN v_item.raw_material_id ELSE v_item.destination_raw_material_id END,
        v_item.quantity,'transfer','warehouse_transfer',v_transfer.id,
        v_transfer.transfer_number,auth.uid(),true
      );
      IF COALESCE((v_add->>'success')::boolean,false) IS NOT TRUE THEN
        RAISE EXCEPTION 'TRANSFER_DESTINATION_RAW_ADD_FAILED raw=% detail=%',
          v_item.destination_raw_material_id,v_add;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.warehouse_transfers SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = p_transfer_id;
  RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id, 'transfer_number', v_transfer.transfer_number);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$
;
