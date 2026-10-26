-- Manufactured inventory units use the published catalog cost at transaction time, not historical batch cost. Preserve debt and negative stock policy.
CREATE OR REPLACE FUNCTION public._deduct_inventory_unit_stock_policy(p_unit_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_reference_id uuid, p_reference_number text, p_allow_negative boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_available numeric(18,6):=0;
  v_running numeric(18,6):=0;
  v_need numeric(18,6);
  v_take numeric(18,6);
  v_total_cost numeric(18,6):=0;
  v_removed numeric(18,6):=0;
  v_oversold numeric(18,6):=0;
  v_batch record;
  v_debt_batch text;
  v_debt_batch_id uuid;
  v_catalog_cost numeric(18,6);
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN
    RETURN jsonb_build_object('success',true,'removed',0,'oversold',0,'total_cost',0);
  END IF;

  IF p_warehouse_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('unit-stock:'||p_unit_id::text||':'||p_warehouse_id::text,0)
  );

  SELECT COALESCE(cost_price,0) INTO v_catalog_cost FROM public.inventory_units WHERE id=p_unit_id AND branch_id=p_branch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','UNIT_NOT_FOUND'); END IF;

  SELECT COALESCE(SUM(quantity),0)
  INTO v_available
  FROM public.inventory_unit_batches
  WHERE unit_id=p_unit_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  IF NOT COALESCE(p_allow_negative,false) AND v_available<p_qty THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','INSUFFICIENT_UNIT_STOCK',
      'unit_id',p_unit_id,
      'required',p_qty,
      'available',v_available
    );
  END IF;

  v_running:=v_available;
  v_need:=p_qty;

  FOR v_batch IN
    SELECT id,quantity,unit_cost,batch_number
    FROM public.inventory_unit_batches
    WHERE unit_id=p_unit_id
      AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id
      AND quantity>0
    ORDER BY quantity DESC,id
    FOR UPDATE
  LOOP
    EXIT WHEN v_need<=0;
    v_take:=LEAST(v_need,v_batch.quantity);

    UPDATE public.inventory_unit_batches
    SET quantity=quantity-v_take
    WHERE id=v_batch.id;

    INSERT INTO public.inventory_unit_entries(
      unit_id,branch_id,warehouse_id,quantity,unit_cost,
      entry_type,reference_type,reference_id,reference_number,batch_number,created_by
    ) VALUES (
      p_unit_id,p_branch_id,p_warehouse_id,-v_take,v_catalog_cost,
      'sale','sale',p_reference_id,p_reference_number,v_batch.batch_number,auth.uid()
    );

    v_running:=v_running-v_take;
    v_need:=v_need-v_take;
    v_removed:=v_removed+v_take;
    v_total_cost:=v_total_cost+v_take*v_catalog_cost;
  END LOOP;

  IF v_need>0 THEN
    IF NOT COALESCE(p_allow_negative,false) THEN
      RAISE EXCEPTION 'INSUFFICIENT_UNIT_STOCK unit=% required=% available=%',
        p_unit_id,p_qty,v_available;
    END IF;

    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    INSERT INTO public.inventory_unit_batches(
      unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost
    ) VALUES (
      p_unit_id,p_branch_id,p_warehouse_id,v_debt_batch,-v_need,0
    )
    RETURNING id INTO v_debt_batch_id;

    INSERT INTO public.inventory_unit_entries(
      unit_id,branch_id,warehouse_id,quantity,unit_cost,
      entry_type,reference_type,reference_id,reference_number,batch_number,created_by
    ) VALUES (
      p_unit_id,p_branch_id,p_warehouse_id,-v_need,0,
      'sale','sale',p_reference_id,p_reference_number,v_debt_batch,auth.uid()
    );

    INSERT INTO public.inventory_unit_stock_debts(
      unit_id,branch_id,warehouse_id,sale_id,reference_number,
      oversold_batch_id,debt_quantity
    ) VALUES (
      p_unit_id,p_branch_id,p_warehouse_id,p_reference_id,p_reference_number,
      v_debt_batch_id,v_need
    );

    v_running:=v_running-v_need;
    v_oversold:=v_need;
    v_need:=0;
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'removed',v_removed,
    'oversold',v_oversold,
    'total_cost',v_total_cost,
    'after_qty',v_running
  );
END;
$function$
;
