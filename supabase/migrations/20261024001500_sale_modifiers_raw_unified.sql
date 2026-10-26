-- Preserve modifier recipe flow; replace raw FIFO with warehouse-specific atomic movement.
CREATE OR REPLACE FUNCTION public._deduct_sale_inventory_with_modifiers_core(p_branch_id uuid, p_warehouse_id uuid, p_items jsonb, p_reference_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_link record;
  v_effect record;
  v_batch record;
  v_need numeric(14,6);
  v_take numeric(14,6);
  v_available numeric(14,6);
  v_total_cost numeric(18,4) := 0;
  v_units jsonb := '[]'::jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_oversold jsonb := '[]'::jsonb;
  v_user_branch uuid;
  v_recipe_id uuid;
  v_yield numeric(14,6);
  v_res jsonb;
  v_mod jsonb;
  v_recipe_component_count integer;
  v_link_count integer;
  v_auto_raw_id uuid;
  v_product_type text;
  v_base_ready boolean := false;
  v_allow_negative boolean := false;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN
    RETURN jsonb_build_object('success',true,'units_deducted','[]'::jsonb,'raw_materials_deducted','[]'::jsonb,'ready_products_deducted','[]'::jsonb,'raw_oversold','[]'::jsonb,'errors','[]'::jsonb);
  END IF;

  SELECT branch_id INTO v_user_branch FROM public.users WHERE id=auth.uid();
  IF NOT public.is_pos_admin() AND v_user_branch IS NOT NULL AND v_user_branch<>p_branch_id THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  v_allow_negative:=public.effective_allow_negative_stock(p_branch_id);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_unit_need(unit_id uuid PRIMARY KEY,unit_name text,unit_type text,required_qty numeric(14,6) NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_raw_need(raw_material_id uuid PRIMARY KEY,raw_name text,required_qty numeric(14,6) NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_ready_need(product_id uuid PRIMARY KEY,product_name text,required_qty numeric(14,6) NOT NULL) ON COMMIT DROP;
  TRUNCATE pg_temp.sale_unit_need; TRUNCATE pg_temp.sale_raw_need; TRUNCATE pg_temp.sale_ready_need;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::numeric,0);
    IF v_quantity<=0 THEN RETURN jsonb_build_object('success',false,'error','INVALID_QUANTITY','product_id',v_product_id); END IF;
    SELECT p.product_type INTO v_product_type
    FROM public.products p
    WHERE p.id=v_product_id AND p.branch_id=p_branch_id AND p.is_active=true;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'error','PRODUCT_NOT_IN_BRANCH','product_id',v_product_id);
    END IF;
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
    IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;

    IF v_base_ready THEN
      INSERT INTO pg_temp.sale_ready_need(product_id,product_name,required_qty)
      SELECT p.id,p.name,v_quantity FROM public.products p WHERE p.id=v_product_id
      ON CONFLICT(product_id) DO UPDATE SET required_qty=pg_temp.sale_ready_need.required_qty+EXCLUDED.required_qty;
    ELSE
    v_link_count:=0; v_recipe_component_count:=0; v_recipe_id:=NULL; v_yield:=NULL;

    SELECT COUNT(*) INTO v_link_count
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id=pul.unit_id
    WHERE pul.product_id=v_product_id AND iu.branch_id=p_branch_id AND iu.is_active=true;

    FOR v_link IN
      SELECT pul.unit_id,pul.quantity,iu.name AS unit_name,iu.unit_type
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu ON iu.id=pul.unit_id
      WHERE pul.product_id=v_product_id AND iu.branch_id=p_branch_id AND iu.is_active=true
    LOOP
      INSERT INTO pg_temp.sale_unit_need(unit_id,unit_name,unit_type,required_qty)
      VALUES(v_link.unit_id,v_link.unit_name,v_link.unit_type,v_quantity*v_link.quantity)
      ON CONFLICT(unit_id) DO UPDATE SET required_qty=pg_temp.sale_unit_need.required_qty+EXCLUDED.required_qty;
    END LOOP;

    SELECT r.id,COALESCE(NULLIF(r.yield_quantity,0),1) INTO v_recipe_id,v_yield
    FROM public.recipes r
    WHERE r.product_id=v_product_id AND r.branch_id=p_branch_id AND COALESCE(r.is_active,true)=true
    ORDER BY COALESCE(r.version,1) DESC,r.created_at DESC LIMIT 1;

    IF v_recipe_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.recipe_items ri
      JOIN public.raw_materials rm ON rm.id=ri.raw_material_id
      WHERE ri.recipe_id=v_recipe_id AND rm.branch_id<>p_branch_id
    ) THEN
      RETURN jsonb_build_object('success',false,'error','RAW_MATERIAL_NOT_IN_BRANCH','product_id',v_product_id);
    END IF;

    IF v_recipe_id IS NOT NULL THEN
      FOR v_link IN
        SELECT ri.raw_material_id,rm.name AS raw_name,ri.quantity/v_yield AS quantity_per_sale
        FROM public.recipe_items ri
        JOIN public.raw_materials rm ON rm.id=ri.raw_material_id
        WHERE ri.recipe_id=v_recipe_id
          AND NOT EXISTS (
            SELECT 1 FROM public.product_unit_links pul
            JOIN public.inventory_units iu ON iu.id=pul.unit_id
            WHERE pul.product_id=v_product_id AND iu.branch_id=p_branch_id AND iu.is_active=true
              AND regexp_replace(lower(btrim(iu.name)),'[ .]+$','','g')=regexp_replace(lower(btrim(rm.name)),'[ .]+$','','g')
          )
      LOOP
        v_recipe_component_count:=v_recipe_component_count+1;
        INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)
        VALUES(v_link.raw_material_id,v_link.raw_name,v_quantity*v_link.quantity_per_sale)
        ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;
      END LOOP;
    END IF;

    IF v_link_count=0 AND v_recipe_component_count=0 THEN
      v_auto_raw_id:=public._ensure_pos_fallback_product_raw(v_product_id,p_branch_id);
      INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)
      SELECT rm.id,rm.name,v_quantity FROM public.raw_materials rm WHERE rm.id=v_auto_raw_id
      ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;
    END IF;
    END IF;

    FOR v_effect IN
      SELECT o.id AS option_id
      FROM public.product_modifier_options o
      JOIN public.product_modifier_groups g ON g.id=o.group_id AND g.is_active=true
      JOIN public.product_modifier_group_products gp ON gp.group_id=g.id AND gp.product_id=v_product_id AND gp.branch_id=p_branch_id
      WHERE o.branch_id=p_branch_id AND o.is_active=true AND o.price_delta>0
        AND o.id IN (SELECT NULLIF(value,'')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids','[]'::jsonb)))
    LOOP
      PERFORM public._ensure_pos_fallback_modifier_raw(v_effect.option_id,p_branch_id);
    END LOOP;

    FOR v_effect IN
      SELECT e.target_type,e.raw_material_id,e.inventory_unit_id,e.quantity_delta,rm.name AS raw_name,iu.name AS unit_name,iu.unit_type
      FROM public.product_modifier_inventory_effects e
      JOIN public.product_modifier_options o ON o.id=e.option_id AND o.is_active=true
      JOIN public.product_modifier_groups g ON g.id=o.group_id AND g.is_active=true
      JOIN public.product_modifier_group_products gp ON gp.group_id=g.id AND gp.product_id=v_product_id AND gp.branch_id=p_branch_id
      LEFT JOIN public.raw_materials rm ON rm.id=e.raw_material_id
      LEFT JOIN public.inventory_units iu ON iu.id=e.inventory_unit_id
      WHERE g.branch_id=p_branch_id AND e.branch_id=p_branch_id
        AND o.id IN (SELECT NULLIF(value,'')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids','[]'::jsonb)))
    LOOP
      IF v_effect.target_type='raw_material' THEN
        INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)
        VALUES(v_effect.raw_material_id,v_effect.raw_name,v_quantity*v_effect.quantity_delta)
        ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;
      ELSE
        INSERT INTO pg_temp.sale_unit_need(unit_id,unit_name,unit_type,required_qty)
        VALUES(v_effect.inventory_unit_id,v_effect.unit_name,v_effect.unit_type,v_quantity*v_effect.quantity_delta)
        ON CONFLICT(unit_id) DO UPDATE SET required_qty=pg_temp.sale_unit_need.required_qty+EXCLUDED.required_qty;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS(SELECT 1 FROM pg_temp.sale_unit_need WHERE required_qty<0) OR EXISTS(SELECT 1 FROM pg_temp.sale_raw_need WHERE required_qty<0) THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_MODIFIER_INVENTORY_EFFECT','detail','Modifier removal exceeds the base component quantity.');
  END IF;

  -- Strict mode validates all non-manufactured requirements before the first
  -- stock mutation so an explicit failure cannot leave a partial deduction.
  IF NOT v_allow_negative THEN
    FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty>0 ORDER BY product_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.inventory_batches
      WHERE product_id=v_link.product_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_READY_PRODUCT_STOCK','product_id',v_link.product_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;

    FOR v_link IN SELECT * FROM pg_temp.sale_raw_need WHERE required_qty>0 ORDER BY raw_material_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.raw_material_batches
      WHERE raw_material_id=v_link.raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_RAW_MATERIAL_STOCK','raw_material_id',v_link.raw_material_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;

    FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type<>'manufactured' ORDER BY unit_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.inventory_unit_batches
      WHERE unit_id=v_link.unit_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_UNIT_STOCK','unit_id',v_link.unit_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;
  END IF;

  FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty>0 ORDER BY product_id
  LOOP
    v_res:=public._deduct_ready_product_stock_policy(
      v_link.product_id,p_branch_id,p_warehouse_id,v_link.required_qty,
      p_reference_id,p_reference_number,v_allow_negative
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
    v_ready:=v_ready||jsonb_build_object(
      'product_id',v_link.product_id,
      'product_name',v_link.product_name,
      'quantity',v_link.required_qty,
      'oversold',COALESCE((v_res->>'oversold')::numeric,0)
    );
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type='manufactured' ORDER BY unit_id
  LOOP
    IF v_allow_negative THEN
      BEGIN
        PERFORM public._ensure_inventory_unit_stock(v_link.unit_id,v_link.required_qty,p_warehouse_id,p_branch_id,0);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    ELSE
      PERFORM public._ensure_inventory_unit_stock(v_link.unit_id,v_link.required_qty,p_warehouse_id,p_branch_id,0);
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 ORDER BY unit_id
  LOOP
    v_res:=public._deduct_inventory_unit_stock_policy(
      v_link.unit_id,p_branch_id,p_warehouse_id,v_link.required_qty,
      p_reference_id,p_reference_number,v_allow_negative
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
    v_units:=v_units||jsonb_build_object(
      'unit_id',v_link.unit_id,
      'unit_name',v_link.unit_name,
      'unit_type',v_link.unit_type,
      'quantity',v_link.required_qty,
      'oversold',COALESCE((v_res->>'oversold')::numeric,0)
    );
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_raw_need WHERE required_qty>0 ORDER BY raw_material_id
  LOOP
    v_res:=private.apply_unified_raw_movement_v1(
      gen_random_uuid(),p_branch_id,p_warehouse_id,v_link.raw_material_id,
      -v_link.required_qty,'sale','sale',p_reference_id,p_reference_number,
      auth.uid(),v_allow_negative
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'SALE_RAW_MOVEMENT_FAILED material=% response=%',v_link.raw_material_id,v_res;
    END IF;
    v_res:=v_res||jsonb_build_object(
      'total_cost',abs(COALESCE((v_res->>'total_cost')::numeric,0)),
      'oversold',GREATEST(v_link.required_qty-GREATEST(COALESCE((v_res->>'before_qty')::numeric,0),0),0)
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    IF COALESCE((v_res->>'shortage')::numeric,0)>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','INSUFFICIENT_RAW_MATERIAL_STOCK',
        'raw_material_id',v_link.raw_material_id,
        'required',v_link.required_qty,
        'shortage',COALESCE((v_res->>'shortage')::numeric,0)
      );
    END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
    v_raws:=v_raws||jsonb_build_object('raw_material_id',v_link.raw_material_id,'raw_name',v_link.raw_name,'quantity',v_link.required_qty,'total_cost',COALESCE((v_res->>'total_cost')::numeric,0));
    IF COALESCE((v_res->>'oversold')::numeric,0)>0 THEN
      v_oversold:=v_oversold||jsonb_build_object('raw_material_id',v_link.raw_material_id,'raw_name',v_link.raw_name,'quantity',COALESCE((v_res->>'oversold')::numeric,0),'total_cost',0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success',true,'units_deducted',v_units,'raw_materials_deducted',v_raws,'ready_products_deducted',v_ready,'raw_oversold',v_oversold,'total_cost',v_total_cost,'errors','[]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','SALE_INVENTORY_DEDUCTION_FAILED','detail',SQLERRM);
END;
$function$
;
