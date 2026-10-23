-- ============================================================================
-- Migration: 20261023224000_replace_fifo_operational_functions.sql
-- Description: Replace remaining FIFO operational functions with unified non-FIFO engine.
-- Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd ONLY.
-- ============================================================================

-- 1. adjust_raw_stock
CREATE OR REPLACE FUNCTION public.adjust_raw_stock(
    p_raw_material_id uuid,
    p_warehouse_id uuid,
    p_qty_delta numeric,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_branch_id uuid;
    v_user_id uuid := auth.uid();
    v_res jsonb;
BEGIN
    SELECT branch_id INTO v_branch_id
    FROM public.raw_materials
    WHERE id = p_raw_material_id AND is_active = true;

    IF v_branch_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_NOT_FOUND');
    END IF;

    v_res := private.apply_unified_raw_movement_v1(
        gen_random_uuid(),
        v_branch_id,
        p_warehouse_id,
        p_raw_material_id,
        p_qty_delta,
        'adjustment',
        'raw_adjustment',
        NULL,
        COALESCE(p_reason, 'Stock Adjustment'),
        v_user_id,
        true
    );

    RETURN v_res;
END;
$$;

-- 2. apply_stock_count
CREATE OR REPLACE FUNCTION public.apply_stock_count(
    p_stock_count_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_count record;
    v_item record;
    v_delta numeric;
    v_user_id uuid := auth.uid();
    v_res jsonb;
    v_current_qty numeric;
BEGIN
    SELECT * INTO v_count
    FROM public.stock_counts
    WHERE id = p_stock_count_id AND status = 'draft';

    IF v_count.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'STOCK_COUNT_NOT_FOUND_OR_NOT_DRAFT');
    END IF;

    FOR v_item IN
        SELECT i.id, i.raw_material_id, i.warehouse_id, i.counted_quantity
        FROM public.stock_count_items i
        WHERE i.stock_count_id = p_stock_count_id
          AND i.raw_material_id IS NOT NULL
          AND i.warehouse_id IS NOT NULL
    LOOP
        SELECT COALESCE(SUM(quantity), 0) INTO v_current_qty
        FROM public.raw_material_batches
        WHERE raw_material_id = v_item.raw_material_id
          AND branch_id = v_count.branch_id
          AND warehouse_id = v_item.warehouse_id;

        v_delta := v_item.counted_quantity - v_current_qty;

        IF v_delta <> 0 THEN
            v_res := private.apply_unified_raw_movement_v1(
                gen_random_uuid(),
                v_count.branch_id,
                v_item.warehouse_id,
                v_item.raw_material_id,
                v_delta,
                'stock_count',
                'stock_count',
                p_stock_count_id,
                v_count.reference_number,
                v_user_id,
                true
            );

            IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
                RAISE EXCEPTION 'STOCK_COUNT_ITEM_APPLY_FAILED material=% reason=%',
                    v_item.raw_material_id, COALESCE(v_res->>'error', 'UNKNOWN');
            END IF;
        END IF;
    END LOOP;

    UPDATE public.stock_counts
    SET status = 'applied', updated_at = clock_timestamp()
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object('success', true, 'stock_count_id', p_stock_count_id);
END;
$$;

-- 3. approve_warehouse_transfer
CREATE OR REPLACE FUNCTION public.approve_warehouse_transfer(
    p_transfer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_tr record;
    v_item record;
    v_user_id uuid := auth.uid();
    v_res jsonb;
BEGIN
    SELECT * INTO v_tr
    FROM public.warehouse_transfers
    WHERE id = p_transfer_id AND status = 'pending';

    IF v_tr.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND_OR_NOT_PENDING');
    END IF;

    FOR v_item IN
        SELECT i.raw_material_id, i.quantity
        FROM public.warehouse_transfer_items i
        WHERE i.transfer_id = p_transfer_id
          AND i.raw_material_id IS NOT NULL
    LOOP
        -- Deduct from source warehouse
        v_res := private.apply_unified_raw_movement_v1(
            gen_random_uuid(),
            v_tr.branch_id,
            v_tr.source_warehouse_id,
            v_item.raw_material_id,
            -v_item.quantity,
            'transfer_out',
            'warehouse_transfer',
            p_transfer_id,
            v_tr.reference_number,
            v_user_id,
            true
        );

        IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'TRANSFER_OUT_FAILED material=%', v_item.raw_material_id;
        END IF;

        -- Add to destination warehouse
        v_res := private.apply_unified_raw_movement_v1(
            gen_random_uuid(),
            v_tr.branch_id,
            v_tr.destination_warehouse_id,
            v_item.raw_material_id,
            v_item.quantity,
            'transfer_in',
            'warehouse_transfer',
            p_transfer_id,
            v_tr.reference_number,
            v_user_id,
            true
        );

        IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'TRANSFER_IN_FAILED material=%', v_item.raw_material_id;
        END IF;
    END LOOP;

    UPDATE public.warehouse_transfers
    SET status = 'approved', approved_at = clock_timestamp(), approved_by = v_user_id
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id);
END;
$$;

-- 4. process_purchase_return
CREATE OR REPLACE FUNCTION public.process_purchase_return(
    p_purchase_id uuid,
    p_return_items jsonb,
    p_reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_purchase record;
    v_item record;
    v_user_id uuid := auth.uid();
    v_res jsonb;
BEGIN
    SELECT * INTO v_purchase
    FROM public.purchases
    WHERE id = p_purchase_id;

    IF v_purchase.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;

    FOR v_item IN
        SELECT
            (elem->>'raw_material_id')::uuid as raw_material_id,
            (elem->>'warehouse_id')::uuid as warehouse_id,
            (elem->>'quantity')::numeric as quantity
        FROM jsonb_array_elements(p_return_items) elem
    LOOP
        IF v_item.raw_material_id IS NOT NULL AND v_item.quantity > 0 THEN
            v_res := private.apply_unified_raw_movement_v1(
                gen_random_uuid(),
                v_purchase.branch_id,
                v_item.warehouse_id,
                v_item.raw_material_id,
                -v_item.quantity,
                'purchase_return',
                'purchase',
                p_purchase_id,
                p_reference_number,
                v_user_id,
                true
            );

            IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
                RAISE EXCEPTION 'PURCHASE_RETURN_FAILED material=%', v_item.raw_material_id;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'purchase_id', p_purchase_id);
END;
$$;
