-- Fix production-order raw consumption to use the order warehouse explicitly.
CREATE OR REPLACE FUNCTION public.complete_production_order(
  p_order_id uuid,
  p_waste jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order record;
  v_recipe_id uuid;
  v_recipe_yield numeric(14,4);
  v_factor numeric(14,4);
  v_item record;
  v_waste_item jsonb;
  v_req numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
  v_cost numeric(14,2) := 0;
  v_unit_cost numeric(12,2) := 0;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT * INTO v_order
    FROM public.production_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    IF v_order.status NOT IN ('planned', 'in_progress') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_order.status);
    END IF;

    IF v_order.warehouse_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WAREHOUSE_REQUIRED',
        'detail', 'Assign an output warehouse to the production order before completing it.'
      );
    END IF;

    SELECT id, yield_quantity
    INTO v_recipe_id, v_recipe_yield
    FROM public.recipes
    WHERE product_id = v_order.product_id
      AND branch_id = v_order.branch_id
      AND is_active
    ORDER BY updated_at DESC
    LIMIT 1;

    IF v_recipe_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_RECIPE', 'product_id', v_order.product_id);
    END IF;

    v_recipe_yield := COALESCE(v_recipe_yield, 1);
    v_factor := v_order.quantity / v_recipe_yield;

    FOR v_item IN
      SELECT *
      FROM public.recipe_items
      WHERE recipe_id = v_recipe_id
    LOOP
      v_req := COALESCE(v_item.quantity, 0) * v_factor;
      IF v_req <= 0 THEN
        CONTINUE;
      END IF;

      v_res := public._raw_remove_fifo(
        v_item.raw_material_id,
        v_order.branch_id,
        v_order.warehouse_id,
        v_req,
        'production',
        'production_order',
        v_order.id,
        v_order.order_number,
        auth.uid(),
        false
      );

      IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
        RETURN v_res;
      END IF;

      v_short := COALESCE((v_res->>'shortage')::numeric, 0);
      IF v_short > 0 THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_RAW',
          'raw_material_id', v_item.raw_material_id,
          'required', v_req,
          'available', v_req - v_short,
          'detail', 'Not enough raw material to complete production. The order was not completed.'
        );
      END IF;

      v_cost := v_cost + COALESCE((v_res->>'total_cost')::numeric, 0);
    END LOOP;

    IF p_waste IS NOT NULL AND jsonb_array_length(p_waste) > 0 THEN
      FOR v_waste_item IN
        SELECT *
        FROM jsonb_array_elements(p_waste)
      LOOP
        v_req := COALESCE((v_waste_item->>'quantity')::numeric, 0);
        IF v_req <= 0 THEN
          CONTINUE;
        END IF;

        v_res := public._raw_remove_fifo(
          (v_waste_item->>'raw_material_id')::uuid,
          v_order.branch_id,
          v_order.warehouse_id,
          v_req,
          'waste',
          'production_order',
          v_order.id,
          v_order.order_number,
          auth.uid(),
          false
        );

        IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
          RETURN v_res;
        END IF;

        v_cost := v_cost + COALESCE((v_res->>'total_cost')::numeric, 0);

        INSERT INTO public.production_waste(
          order_id, branch_id, raw_material_id, quantity, reason
        ) VALUES (
          v_order.id,
          v_order.branch_id,
          (v_waste_item->>'raw_material_id')::uuid,
          v_req,
          COALESCE(v_waste_item->>'reason', 'إنتاج')
        );
      END LOOP;
    END IF;

    v_unit_cost := CASE
      WHEN v_order.quantity > 0 THEN round(v_cost / v_order.quantity, 2)
      ELSE 0
    END;

    v_res := public._product_inv_add(
      v_order.product_id,
      v_order.warehouse_id,
      v_order.branch_id,
      v_order.quantity,
      v_unit_cost,
      v_order.batch_number,
      CURRENT_DATE,
      NULL,
      'production',
      'production_order',
      v_order.id,
      v_order.order_number,
      auth.uid()
    );

    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_res;
    END IF;

    UPDATE public.production_orders
    SET status = 'completed',
        total_cost = v_cost,
        completed_at = now()
    WHERE id = v_order.id;

    IF v_cost > 0 THEN
      v_lines := v_lines
        || jsonb_build_object('account_key','wip','debit',v_cost,'credit',0,'note',v_order.order_number)
        || jsonb_build_object('account_key','inventory_rm','debit',0,'credit',v_cost,'note',v_order.order_number)
        || jsonb_build_object('account_key','inventory_fg','debit',v_cost,'credit',0,'note',v_order.order_number)
        || jsonb_build_object('account_key','wip','debit',0,'credit',v_cost,'note',v_order.order_number);

      PERFORM public._post_journal_entry(
        v_order.branch_id,
        'production',
        v_order.id,
        v_order.order_number,
        'إنتاج ' || v_order.order_number,
        v_lines
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'total_cost', v_cost,
      'unit_cost', v_unit_cost
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TRANSACTION_FAILED',
      'detail', SQLERRM
    );
  END;
END;
$function$;
