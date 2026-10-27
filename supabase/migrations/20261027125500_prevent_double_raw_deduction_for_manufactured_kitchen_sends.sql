-- Subtract manufactured-group ingredient expansion from kitchen raw requirements; raw materials were consumed at production.
CREATE OR REPLACE FUNCTION public._deduct_kitchen_raw_components(p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_quantity numeric, p_modifier_option_ids jsonb, p_event_id uuid, p_reference_number text, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_res jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_oversold jsonb := '[]'::jsonb;
  v_total_cost numeric(18,6) := 0;
  v_component_cost numeric(18,6);
  v_unit_price numeric(18,6);
  v_written_qty numeric(18,6);
  v_count integer := 0;
  v_unit record; v_ures jsonb; v_units jsonb:='[]'::jsonb;
  v_fallback_raw_id uuid;
  v_fallback_raw_name text;
BEGIN
  IF p_product_id IS NULL OR p_branch_id IS NULL OR p_warehouse_id IS NULL OR p_event_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','KITCHEN_DOCUMENT_CONTEXT_REQUIRED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active=true
  ) THEN
    RETURN jsonb_build_object('success',false,'error','KITCHEN_WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_QUANTITY'
    );
  END IF;

  -- Serialize retries for the same kitchen event before touching inventory.
  PERFORM pg_advisory_xact_lock(hashtextextended('kitchen-send-event:' || p_event_id::text,0));
  IF EXISTS (
    SELECT 1 FROM public.inventory_ledger il
    WHERE il.reference_type='kitchen_send' AND il.reference_id=p_event_id
      AND il.entry_type='kitchen_send'
  ) THEN
    RETURN jsonb_build_object('success',false,'error','KITCHEN_EVENT_ALREADY_DEDUCTED',
      'event_id',p_event_id);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.kitchen_raw_need (
    raw_material_id uuid PRIMARY KEY,
    raw_name text,
    required_qty numeric(18,6) NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.kitchen_raw_need;

  INSERT INTO pg_temp.kitchen_raw_need(raw_material_id, raw_name, required_qty)
  SELECT
    r.raw_material_id,
    r.raw_name,
    round(r.quantity_per_sale * p_quantity, 6)
  FROM public.resolve_kitchen_item_raw_components(
    p_product_id,
    p_branch_id,
    COALESCE(p_modifier_option_ids, '[]'::jsonb)
  ) r
  ON CONFLICT(raw_material_id) DO UPDATE
  SET required_qty = pg_temp.kitchen_raw_need.required_qty + EXCLUDED.required_qty,
      raw_name = EXCLUDED.raw_name;

  -- The resolver expands product-linked manufactured groups into their raw recipe.
  -- Those ingredients were already consumed at production; subtract only their
  -- contribution here, preserving direct product/modifier raw requirements.
  WITH manufactured_raw AS (
    SELECT components.raw_material_id,
      SUM(components.quantity_per_unit * links.quantity * p_quantity)::numeric AS produced_raw
    FROM public.product_unit_links links
    JOIN public.inventory_units units ON units.id=links.unit_id
      AND units.branch_id=p_branch_id AND units.unit_type='manufactured' AND units.is_active
    CROSS JOIN LATERAL public.resolve_inventory_unit_raw_components(links.unit_id,p_branch_id) components
    WHERE links.product_id=p_product_id
    GROUP BY components.raw_material_id
  )
  UPDATE pg_temp.kitchen_raw_need needs
  SET required_qty=round(needs.required_qty-m.produced_raw,6)
  FROM manufactured_raw m WHERE needs.raw_material_id=m.raw_material_id;
  DELETE FROM pg_temp.kitchen_raw_need WHERE abs(required_qty)<=0.000001;

  SELECT count(*) INTO v_count
  FROM pg_temp.kitchen_raw_need
  WHERE abs(required_qty) > 0.000001;

  IF v_count = 0 AND NOT EXISTS (SELECT 1 FROM public.product_unit_links p JOIN public.inventory_units u ON u.id=p.unit_id WHERE p.product_id=p_product_id AND u.branch_id=p_branch_id AND u.unit_type='manufactured' AND u.is_active) THEN
    -- Business rule: an unconfigured sellable product is still valid.
    -- Materialize one branch-scoped fallback raw with the product name and
    -- consume it directly. Because FIFO allows debt, the resulting raw balance
    -- becomes negative when no stock exists.
    v_fallback_raw_id := public._ensure_pos_fallback_product_raw(
      p_product_id,
      p_branch_id
    );

    SELECT rm.name
    INTO v_fallback_raw_name
    FROM public.raw_materials rm
    WHERE rm.id = v_fallback_raw_id
      AND rm.branch_id = p_branch_id
      AND rm.is_active = true;

    IF v_fallback_raw_id IS NULL OR v_fallback_raw_name IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ORDER_ITEM_CONFIGURATION_INVALID',
        'detail', 'FALLBACK_RAW_CREATE_FAILED'
      );
    END IF;

    INSERT INTO pg_temp.kitchen_raw_need(
      raw_material_id,
      raw_name,
      required_qty
    ) VALUES (
      v_fallback_raw_id,
      v_fallback_raw_name,
      round(p_quantity, 6)
    );

    v_count := 1;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.kitchen_raw_need
    WHERE required_qty < -0.000001
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_MODIFIER_INVENTORY_EFFECT',
      'detail', 'Modifier removal exceeds the product raw component quantity.'
    );
  END IF;

  FOR v_row IN
    SELECT *
    FROM pg_temp.kitchen_raw_need
    WHERE required_qty > 0.000001
    ORDER BY raw_material_id
  LOOP
    v_unit_price := COALESCE((private.raw_published_unit_cost_at_v2(v_row.raw_material_id,p_branch_id,statement_timestamp())->>'unit_cost')::numeric,0);
    v_res := private.consume_kitchen_raw_without_fifo_v1(
      v_row.raw_material_id,p_branch_id,p_warehouse_id,v_row.required_qty,
      p_event_id,p_reference_number,p_created_by
    );

    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
      -- Raise into the enclosing EXCEPTION block: its subtransaction rolls back
      -- all earlier material deductions for this kitchen item.
      RAISE EXCEPTION 'KITCHEN_RAW_DEDUCTION_FAILED material=% reason=%',
        v_row.raw_material_id, COALESCE(v_res->>'error','UNKNOWN');
    END IF;

    -- The writer returns the exact ledger ID; avoid global MAX(id) scans and post-write updates.
    SELECT -il.quantity, -il.total_cost INTO v_written_qty, v_component_cost
      FROM public.inventory_ledger il
     WHERE il.id=(v_res->>'ledger_id')::bigint
       AND il.raw_material_id=v_row.raw_material_id
       AND il.branch_id=p_branch_id
       AND il.warehouse_id=p_warehouse_id
       AND il.entry_type='kitchen_send'
       AND il.reference_type='kitchen_send'
       AND il.reference_id=p_event_id;
    IF v_written_qty IS NULL OR abs(v_written_qty-v_row.required_qty)>0.0001
       OR v_component_cost IS NULL
       OR abs(v_component_cost-round(v_written_qty*v_unit_price,6))>0.0001 THEN
       RAISE EXCEPTION 'KITCHEN_LEDGER_INTEGRITY_MISMATCH material=%',v_row.raw_material_id;
    END IF;
    v_total_cost := v_total_cost + v_component_cost;

    v_raws := v_raws || jsonb_build_object(
      'raw_material_id', v_row.raw_material_id,
      'raw_name', v_row.raw_name,
      'quantity', v_row.required_qty,
      'total_cost', v_component_cost
    );

    IF COALESCE((v_res->>'oversold')::numeric, 0) > 0 THEN
      v_oversold := v_oversold || jsonb_build_object(
        'raw_material_id', v_row.raw_material_id,
        'raw_name', v_row.raw_name,
        'quantity', COALESCE((v_res->>'oversold')::numeric, 0),
        'total_cost', 0
      );
    END IF;
  END LOOP;

  FOR v_unit IN SELECT p.unit_id,sum(p.quantity*p_quantity) required FROM public.product_unit_links p JOIN public.inventory_units u ON u.id=p.unit_id WHERE p.product_id=p_product_id AND u.branch_id=p_branch_id AND u.unit_type='manufactured' AND u.is_active GROUP BY p.unit_id ORDER BY p.unit_id LOOP
    v_ures:=public._deduct_inventory_unit_stock_policy(v_unit.unit_id,p_branch_id,p_warehouse_id,v_unit.required,p_event_id,p_reference_number,false);
    IF COALESCE((v_ures->>'success')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'MANUFACTURED_DEDUCTION_FAILED %',v_ures; END IF;
    UPDATE public.inventory_unit_entries SET entry_type='kitchen_send',reference_type='kitchen_send' WHERE reference_id=p_event_id AND reference_type='sale' AND unit_id=v_unit.unit_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
    v_units:=v_units||jsonb_build_object('unit_id',v_unit.unit_id,'quantity',v_unit.required,'total_cost',COALESCE((v_ures->>'total_cost')::numeric,0));
    v_total_cost:=v_total_cost+COALESCE((v_ures->>'total_cost')::numeric,0);
  END LOOP;
  RETURN jsonb_build_object(
    'success', true,
    'units_deducted',v_units,
    'raw_materials_deducted', v_raws,
    'raw_oversold', v_oversold,
    'total_cost', v_total_cost,
    'errors', '[]'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'ORDER_ITEM_CONFIGURATION_INVALID',
    'detail', SQLERRM
  );
END;
$function$;
