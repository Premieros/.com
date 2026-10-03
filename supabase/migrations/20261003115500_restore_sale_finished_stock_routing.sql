-- Restore canonical finished-stock routing after the negative-stock policy patch.
-- If availability says ready_product, consume finished stock regardless of product_type.
-- In negative-stock mode, a ready product (or a manufactured product that already
-- has finished-stock history) may continue into explicit stock debt.
DO $patch$
DECLARE
  v_def text;
  v_next text;
BEGIN
  SELECT pg_get_functiondef(
    'public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)'::regprocedure
  ) INTO v_def;

  v_next := replace(
    v_def,
    $old$
    v_base_ready := (v_product_type = 'ready' AND EXISTS (SELECT 1 FROM public.inventory_batches ib WHERE ib.product_id=v_product_id AND ib.branch_id=p_branch_id AND ib.warehouse_id=p_warehouse_id));

    v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
$old$,
    $new$
    v_res := public.check_product_availability(
      v_product_id,
      p_branch_id,
      p_warehouse_id,
      v_quantity
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS TRUE THEN
      v_base_ready := COALESCE(v_res->>'mode','')='ready_product';
    ELSIF v_allow_negative THEN
      v_base_ready := (
        v_product_type='ready'
        OR EXISTS (
          SELECT 1
          FROM public.inventory_batches ib
          WHERE ib.product_id=v_product_id
            AND ib.branch_id=p_branch_id
            AND ib.warehouse_id=p_warehouse_id
        )
      );
    ELSE
      RETURN v_res;
    END IF;

    v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
$new$
  );

  IF v_next=v_def THEN
    IF position('public.check_product_availability' in v_def)>0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'SALE_FINISHED_STOCK_ROUTING_PATCH_DRIFT';
  END IF;

  EXECUTE v_next;
END;
$patch$;
