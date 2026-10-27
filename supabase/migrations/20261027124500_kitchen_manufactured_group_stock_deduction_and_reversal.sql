-- Atomic manufactured component consumption at kitchen send, with effect rows and reversal.
-- No retroactive mutation of already-sent orders.
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

CREATE OR REPLACE FUNCTION public._send_to_kitchen_core_20260914(p_order_id uuid, p_sent_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_id uuid;
  v_status text;
  v_order_number text;
  v_table_id uuid;
  v_table_name text;
  v_order_type text;
  v_guest_count integer;
  v_warehouse_id uuid;
  v_sent_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_all_sent boolean := false;
  v_row record;
  v_inventory jsonb;
  v_failure_product uuid;
  v_failure_name text;
  v_failure_error text;
  v_failure_detail text;
  v_first_sent_at timestamptz;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_effective_sent_by uuid;
  v_snapshot jsonb;
BEGIN
  BEGIN
    IF NOT v_is_service_role AND auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    SELECT branch_id, status, order_number, table_id, order_type, guest_count, inventory_warehouse_id
    INTO v_branch_id, v_status, v_order_number, v_table_id, v_order_type, v_guest_count, v_warehouse_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    IF NOT v_is_service_role THEN
      IF NOT public.user_may_access_branch(v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      IF NOT (public.is_platform_admin() OR public.can_permission('pos.send_kitchen')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'detail', 'pos.send_kitchen');
      END IF;
    END IF;

    IF v_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE');
    END IF;

    IF v_warehouse_id IS NULL THEN
      SELECT w.id INTO v_warehouse_id
      FROM public.warehouses w
      WHERE w.branch_id = v_branch_id
        AND w.is_active = true
      ORDER BY COALESCE(w.is_default, false) DESC, w.created_at, w.id
      LIMIT 1;

      IF v_warehouse_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_FOUND');
      END IF;

      UPDATE public.orders
      SET inventory_warehouse_id = v_warehouse_id
      WHERE id = p_order_id;
    END IF;

    IF v_table_id IS NOT NULL THEN
      SELECT name INTO v_table_name
      FROM public.dining_tables
      WHERE id = v_table_id
        AND branch_id = v_branch_id;
    END IF;

    v_effective_sent_by := CASE
      WHEN v_is_service_role THEN COALESCE(p_sent_by, auth.uid())
      ELSE auth.uid()
    END;

    CREATE TEMP TABLE IF NOT EXISTS pg_temp.kns_delta (
      order_item_id uuid PRIMARY KEY,
      send_id uuid,
      event_id uuid,
      delta_quantity numeric(14,4) NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.kns_delta;

    INSERT INTO pg_temp.kns_delta(order_item_id, event_id, delta_quantity)
    SELECT oi.id, gen_random_uuid(), oi.quantity - COALESCE(s.sent_quantity, 0)
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.quantity > COALESCE(s.sent_quantity, 0);

    IF EXISTS (
      SELECT 1
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.categories c ON c.id = p.category_id AND c.branch_id = v_branch_id
      LEFT JOIN public.kitchen_stations ks ON ks.id = c.kitchen_station_id AND ks.is_active = true
      WHERE (
        p.category_id IS NOT NULL
        AND (
          c.id IS NULL
          OR ks.id IS NULL
          OR ks.branch_id IS DISTINCT FROM v_branch_id
          OR lower(btrim(ks.code)) = 'cashier'
        )
      )
      OR (
        p.category_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.kitchen_stations default_ks
          WHERE default_ks.branch_id = v_branch_id
            AND lower(btrim(default_ks.code)) = 'main'
            AND default_ks.is_active = true
        )
      )
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'KITCHEN_STATION_NOT_CONFIGURED'
      );
    END IF;

    FOR v_row IN
      SELECT
        d.order_item_id,
        d.event_id,
        d.delta_quantity,
        oi.product_id,
        oi.modifier_option_ids,
        p.name AS product_name
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      ORDER BY oi.created_at, oi.id
    LOOP
      v_failure_product := v_row.product_id;
      v_failure_name := v_row.product_name;
      v_failure_error := NULL;
      v_failure_detail := NULL;

      v_inventory := public._deduct_kitchen_raw_components(
        v_row.product_id,
        v_branch_id,
        v_warehouse_id,
        v_row.delta_quantity,
        to_jsonb(COALESCE(v_row.modifier_option_ids, '{}'::uuid[])),
        v_row.event_id,
        v_order_number,
        v_effective_sent_by
      );

      IF COALESCE((v_inventory->>'success')::boolean, false) IS NOT TRUE THEN
        v_failure_error := COALESCE(
          NULLIF(v_inventory->>'error', ''),
          'KITCHEN_RAW_DEDUCTION_FAILED'
        );
        v_failure_detail := COALESCE(
          NULLIF(v_inventory->>'detail', ''),
          v_failure_error
        );
        RAISE EXCEPTION 'KITCHEN_RAW_DEDUCTION_FAILED';
      END IF;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'raw_material_id', e->>'raw_material_id',
            'raw_name', e->>'raw_name',
            'quantity', (e->>'quantity')::numeric
          )
          ORDER BY e->>'raw_material_id'
        ),
        '[]'::jsonb
      )
      INTO v_snapshot
      FROM jsonb_array_elements(
        COALESCE(v_inventory->'raw_materials_deducted', '[]'::jsonb)
      ) e;

      INSERT INTO public.order_kitchen_inventory_events(
        id,
        branch_id,
        warehouse_id,
        order_id,
        order_item_id,
        sent_quantity,
        total_cost,
        created_by,
        component_snapshot,
        snapshot_version
      ) VALUES (
        v_row.event_id,
        v_branch_id,
        v_warehouse_id,
        p_order_id,
        v_row.order_item_id,
        v_row.delta_quantity,
        COALESCE((v_inventory->>'total_cost')::numeric, 0),
        v_effective_sent_by,
        v_snapshot,
        2
      );

      INSERT INTO public.order_kitchen_inventory_effects(
        event_id,
        branch_id,
        warehouse_id,
        target_type,
        target_id,
        quantity,
        total_cost
      )
      SELECT
        v_row.event_id,
        v_branch_id,
        v_warehouse_id,
        'raw_material',
        (e->>'raw_material_id')::uuid,
        (e->>'quantity')::numeric,
        COALESCE((e->>'total_cost')::numeric, 0)
      FROM jsonb_array_elements(
        COALESCE(v_inventory->'raw_materials_deducted', '[]'::jsonb)
      ) e
      WHERE COALESCE((e->>'quantity')::numeric, 0) > 0;

      INSERT INTO public.order_kitchen_inventory_effects(event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost)
      SELECT v_row.event_id,v_branch_id,v_warehouse_id,'inventory_unit',(e->>'unit_id')::uuid,(e->>'quantity')::numeric,COALESCE((e->>'total_cost')::numeric,0)
      FROM jsonb_array_elements(COALESCE(v_inventory->'units_deducted','[]'::jsonb)) e;
      v_failure_product := NULL;
      v_failure_name := NULL;
      v_failure_error := NULL;
      v_failure_detail := NULL;
    END LOOP;

    WITH candidates AS (
      SELECT d.order_item_id, d.delta_quantity, oi.quantity AS target_quantity
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
    ),
    upserted AS (
      INSERT INTO public.order_kitchen_sends(
        branch_id,
        order_id,
        order_item_id,
        sent_at,
        sent_by,
        sent_quantity
      )
      SELECT
        v_branch_id,
        p_order_id,
        c.order_item_id,
        now(),
        v_effective_sent_by,
        c.target_quantity
      FROM candidates c
      ON CONFLICT (order_item_id) DO UPDATE
      SET sent_quantity = EXCLUDED.sent_quantity,
          sent_at = now(),
          sent_by = EXCLUDED.sent_by
      WHERE public.order_kitchen_sends.sent_quantity < EXCLUDED.sent_quantity
      RETURNING id, order_item_id
    )
    UPDATE pg_temp.kns_delta d
    SET send_id = u.id
    FROM upserted u
    WHERE u.order_item_id = d.order_item_id;

    UPDATE public.order_kitchen_inventory_events e
    SET kitchen_send_id = d.send_id
    FROM pg_temp.kns_delta d
    WHERE e.id = d.event_id;

    SELECT count(*) INTO v_count
    FROM pg_temp.kns_delta;

    IF v_count > 0 THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'send_id', d.send_id,
            'order_item_id', d.order_item_id,
            'product_id', oi.product_id,
            'product_name', p.name,
            'unit_name', oi.unit_name,
            'station_code', CASE
              WHEN p.category_id IS NULL THEN 'main'
              ELSE ks.code
            END,
            'quantity', d.delta_quantity,
            'current_quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'discount_amount', oi.discount_amount,
            'bonus_quantity', oi.bonus_quantity,
            'total', oi.total,
            'notes', oi.notes,
            'modifiers', COALESCE(oi.modifiers_snapshot, '[]'::jsonb)
          )
          ORDER BY oi.created_at
        ),
        '[]'::jsonb
      )
      INTO v_sent_items
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      LEFT JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.categories c
        ON c.id = p.category_id
       AND c.branch_id = v_branch_id
      LEFT JOIN public.kitchen_stations ks
        ON ks.id = c.kitchen_station_id
       AND ks.is_active = true;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      LEFT JOIN public.order_kitchen_sends s
        ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND oi.quantity > COALESCE(s.sent_quantity, 0)
    )
    INTO v_all_sent;

    SELECT min(s.sent_at)
    INTO v_first_sent_at
    FROM public.order_kitchen_sends s
    WHERE s.order_id = p_order_id;

    IF v_first_sent_at IS NOT NULL THEN
      UPDATE public.orders
      SET kitchen_status = CASE
            WHEN kitchen_status = 'pending' THEN 'sent'
            ELSE kitchen_status
          END,
          kitchen_sent_at = COALESCE(kitchen_sent_at, v_first_sent_at)
      WHERE id = p_order_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', p_order_id,
      'order_number', v_order_number,
      'table_name', v_table_name,
      'order_type', v_order_type,
      'guest_count', v_guest_count,
      'warehouse_id', v_warehouse_id,
      'sent', v_sent_items,
      'items_sent_count', v_count,
      'all_sent', v_all_sent,
      'inventory_deducted', v_count > 0
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_failure_error, 'TRANSACTION_FAILED'),
      'product_id', v_failure_product,
      'product_name', v_failure_name,
      'detail', COALESCE(v_failure_detail, SQLERRM)
    );
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public._restore_kitchen_snapshot_raws(p_event_id uuid, p_sent_quantity numeric, p_entry_type text, p_reference_type text, p_reference_id uuid, p_reference_number text, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.order_kitchen_inventory_events%ROWTYPE;
  v_item jsonb;
  v_raw_id uuid;
  v_snapshot_qty numeric(18,6);
  v_restore_qty numeric(18,6);
  v_effect_qty numeric(18,6);
  v_effect_cost numeric(18,6);
  v_unit_cost numeric(18,6);
  v_batch text;
  v_res jsonb;
  v_raws_restored numeric(18,6):=0;
  v_unit record; v_unit_restore jsonb; v_unit_qty numeric(18,6);
BEGIN
  SELECT *
  INTO v_event
  FROM public.order_kitchen_inventory_events
  WHERE id=p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','KITCHEN_EVENT_NOT_FOUND');
  END IF;

  IF COALESCE(v_event.snapshot_version,1) < 2
     OR jsonb_typeof(v_event.component_snapshot) <> 'array'
     OR jsonb_array_length(v_event.component_snapshot)=0 THEN
    RETURN jsonb_build_object('success',false,'error','KITCHEN_SNAPSHOT_NOT_AVAILABLE');
  END IF;

  IF p_sent_quantity IS NULL
     OR p_sent_quantity<=0
     OR p_sent_quantity>v_event.sent_quantity+0.000001 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_SNAPSHOT_RESTORE_QUANTITY');
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_event.component_snapshot)
  LOOP
    v_raw_id:=NULLIF(v_item->>'raw_material_id','')::uuid;
    v_snapshot_qty:=COALESCE((v_item->>'quantity')::numeric,0);

    IF v_raw_id IS NULL OR v_snapshot_qty<=0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','INVALID_KITCHEN_COMPONENT_SNAPSHOT',
        'event_id',v_event.id
      );
    END IF;

    v_restore_qty:=ROUND(v_snapshot_qty*p_sent_quantity/v_event.sent_quantity,6);
    IF v_restore_qty<=0 THEN CONTINUE; END IF;

    SELECT quantity,total_cost
    INTO v_effect_qty,v_effect_cost
    FROM public.order_kitchen_inventory_effects
    WHERE event_id=v_event.id
      AND target_type='raw_material'
      AND target_id=v_raw_id
    ORDER BY id
    LIMIT 1;

    v_unit_cost:=CASE
      WHEN COALESCE(v_effect_qty,0)>0
        THEN COALESCE(v_effect_cost,0)/v_effect_qty
      ELSE 0
    END;

    v_batch:=
      CASE WHEN p_entry_type='refund' THEN 'RF-' ELSE 'KV-' END
      ||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    v_res:=public._raw_add(
      v_raw_id,
      v_event.branch_id,
      v_event.warehouse_id,
      v_restore_qty,
      v_unit_cost,
      v_batch,
      CURRENT_DATE,
      NULL,
      p_entry_type,
      p_reference_type,
      p_reference_id,
      p_reference_number,
      p_created_by
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','SNAPSHOT_RAW_RESTORE_FAILED',
        'event_id',v_event.id,
        'raw_material_id',v_raw_id,
        'detail',v_res
      );
    END IF;

    v_raws_restored:=v_raws_restored+v_restore_qty;
  END LOOP;

  FOR v_unit IN SELECT target_id,quantity FROM public.order_kitchen_inventory_effects WHERE event_id=p_event_id AND target_type='inventory_unit' ORDER BY target_id LOOP
    v_unit_qty:=round(v_unit.quantity*p_sent_quantity/v_event.sent_quantity,6);
    IF v_unit_qty<=0 THEN CONTINUE; END IF;
    v_unit_restore:=public._restore_inventory_unit_consumption_source('kitchen_send',p_event_id,v_unit.target_id,v_event.branch_id,v_event.warehouse_id,v_unit_qty,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,NULL);
    IF COALESCE((v_unit_restore->>'success')::boolean,false) IS NOT TRUE OR COALESCE((v_unit_restore->>'restored_quantity')::numeric,0)+0.000001<v_unit_qty THEN RAISE EXCEPTION 'MANUFACTURED_RESTORE_FAILED %',v_unit_restore; END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'success',true,
    'snapshot_restored',true,
    'raw_materials_restored',v_raws_restored,
    'event_id',v_event.id
  );
END;
$function$;
