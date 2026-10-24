-- ============================================================================
-- Migration: 20261023225000_replace_production_and_sale_fifo.sql
-- Description: Replace production and sale FIFO functions with unified non-FIFO engine.
-- Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd ONLY.
-- ============================================================================

-- 1. _produce_inventory_unit_internal
CREATE OR REPLACE FUNCTION public._produce_inventory_unit_internal(
    p_inventory_unit_id uuid,
    p_quantity numeric,
    p_branch_id uuid,
    p_warehouse_id uuid,
    p_reference_number text,
    p_is_reversal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_comp record;
    v_multiplier numeric := CASE WHEN p_is_reversal THEN -1 ELSE 1 END;
    v_user_id uuid := auth.uid();
    v_res jsonb;
    v_total_cost numeric(18,6) := 0;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
    END IF;

    FOR v_comp IN
        SELECT c.raw_material_id, c.quantity * p_quantity * v_multiplier as qty
        FROM public.inventory_unit_components c
        WHERE c.inventory_unit_id = p_inventory_unit_id
          AND c.raw_material_id IS NOT NULL
    LOOP
        v_res := private.apply_unified_raw_movement_v1(
            gen_random_uuid(),
            p_branch_id,
            p_warehouse_id,
            v_comp.raw_material_id,
            -v_comp.qty, -- consumption is negative delta
            'production',
            'inventory_unit',
            p_inventory_unit_id,
            p_reference_number,
            v_user_id,
            true
        );

        IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'PRODUCTION_COMPONENT_CONSUMPTION_FAILED material=%', v_comp.raw_material_id;
        END IF;

        v_total_cost := v_total_cost + COALESCE((v_res->>'total_cost')::numeric, 0);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'total_cost', v_total_cost
    );
END;
$$;

-- 2. complete_production_order
CREATE OR REPLACE FUNCTION public.complete_production_order(
    p_order_id uuid,
    p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_ord record;
    v_user_id uuid := auth.uid();
    v_res jsonb;
BEGIN
    SELECT * INTO v_ord
    FROM public.production_orders
    WHERE id = p_order_id AND status != 'completed';

    IF v_ord.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCTION_ORDER_NOT_FOUND_OR_ALREADY_COMPLETED');
    END IF;

    v_res := public._produce_inventory_unit_internal(
        v_ord.inventory_unit_id,
        v_ord.quantity,
        v_ord.branch_id,
        v_ord.warehouse_id,
        v_ord.reference_number,
        false
    );

    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
        RETURN v_res;
    END IF;

    UPDATE public.production_orders
    SET status = 'completed', completed_at = clock_timestamp(), completed_by = v_user_id
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'production_order_id', p_order_id, 'total_cost', v_res->>'total_cost');
END;
$$;

-- 3. deduct_sale_unit_inventory
CREATE OR REPLACE FUNCTION public.deduct_sale_unit_inventory(
    p_sale_id uuid,
    p_branch_id uuid,
    p_items jsonb,
    p_warehouse_id uuid,
    p_reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_item record;
    v_comp record;
    v_user_id uuid := auth.uid();
    v_res jsonb;
    v_total_cost numeric(18,6) := 0;
BEGIN
    FOR v_item IN
        SELECT
            (elem->>'product_id')::uuid as product_id,
            (elem->>'quantity')::numeric as quantity
        FROM jsonb_array_elements(p_items) elem
    LOOP
        IF v_item.product_id IS NOT NULL AND v_item.quantity > 0 THEN
            FOR v_comp IN
                SELECT raw_material_id, quantity_per_sale * v_item.quantity as req_qty
                FROM public.resolve_kitchen_item_raw_components(v_item.product_id, p_branch_id, '[]'::jsonb)
                WHERE raw_material_id IS NOT NULL
            LOOP
                v_res := private.apply_unified_raw_movement_v1(
                    gen_random_uuid(),
                    p_branch_id,
                    p_warehouse_id,
                    v_comp.raw_material_id,
                    -v_comp.req_qty,
                    'sale',
                    'sale',
                    p_sale_id,
                    p_reference_number,
                    v_user_id,
                    true
                );

                IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
                    RAISE EXCEPTION 'SALE_DEDUCTION_FAILED material=%', v_comp.raw_material_id;
                END IF;

                v_total_cost := v_total_cost + COALESCE((v_res->>'total_cost')::numeric, 0);
            END LOOP;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'total_cost', v_total_cost);
END;
$$;

-- 4. _deduct_sale_inventory_with_modifiers_core
CREATE OR REPLACE FUNCTION public._deduct_sale_inventory_with_modifiers_core(
    p_sale_id uuid,
    p_branch_id uuid,
    p_sale_items jsonb,
    p_warehouse_id uuid,
    p_reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    RETURN public.deduct_sale_unit_inventory(p_sale_id, p_branch_id, p_sale_items, p_warehouse_id, p_reference_number);
END;
$$;
