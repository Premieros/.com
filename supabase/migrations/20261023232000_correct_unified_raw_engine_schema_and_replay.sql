-- Correct real movement schema, signed ledger valuation, and replay parameter conflict.
-- ============================================================================
-- Migration: 20261023223000_unified_non_fifo_inventory_engine.sql
-- Description: Unified non-FIFO atomic inventory movement engine using 
--              published as-of cost and branch/warehouse isolation.
-- Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd ONLY.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.apply_unified_raw_movement_v1(
    p_operation_id uuid,
    p_branch_id uuid,
    p_warehouse_id uuid,
    p_raw_material_id uuid,
    p_delta numeric,
    p_entry_type text,
    p_reference_type text,
    p_reference_id uuid,
    p_reference_number text,
    p_created_by uuid,
    p_allow_negative boolean DEFAULT true,
    p_at timestamp with time zone DEFAULT statement_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_before numeric(18,4);
    v_after numeric(18,4);
    v_branch_total numeric(18,4);
    v_unit_cost numeric(18,6);
    v_total_cost numeric(18,6);
    v_ledger_id bigint;
    v_batch_id uuid;
    v_existing_movement_id uuid;
    v_existing_ledger_id bigint;
BEGIN
    IF p_operation_id IS NULL OR p_branch_id IS NULL OR p_warehouse_id IS NULL OR p_raw_material_id IS NULL THEN
        return jsonb_build_object('success', false, 'error', 'INVALID_MOVEMENT_CONTEXT');
    END IF;

    IF p_delta IS NULL OR p_delta = 0 THEN
        return jsonb_build_object('success', false, 'error', 'INVALID_DELTA');
    END IF;

    IF p_delta <> round(p_delta, 4) THEN
        return jsonb_build_object('success', false, 'error', 'STOCK_QUANTITY_PRECISION_EXCEEDED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.warehouses w
        WHERE w.id = p_warehouse_id AND w.branch_id = p_branch_id AND w.is_active = true
    ) THEN
        return jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.raw_materials rm
        WHERE rm.id = p_raw_material_id AND rm.branch_id = p_branch_id AND rm.is_active = true
    ) THEN
        return jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_BRANCH_MISMATCH');
    END IF;

    -- Per material and branch advisory lock to serialize concurrent stock mutations
    PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text || ':' || p_branch_id::text, 0));

    -- Idempotency check on operation_id
    SELECT m.operation_id, m.ledger_id INTO v_existing_movement_id, v_existing_ledger_id
    FROM private.raw_warehouse_movements_v2 m
    WHERE m.operation_id = p_operation_id;

    IF v_existing_movement_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM private.raw_warehouse_movements_v2 m
            WHERE m.operation_id=p_operation_id
              AND m.branch_id=p_branch_id AND m.warehouse_id=p_warehouse_id
              AND m.raw_material_id=p_raw_material_id AND m.quantity_delta=p_delta
              AND m.entry_type IS NOT DISTINCT FROM p_entry_type
              AND m.source_reference_type IS NOT DISTINCT FROM p_reference_type
              AND m.source_reference_id IS NOT DISTINCT FROM p_reference_id
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'OPERATION_ID_CONFLICT');
        END IF;
        -- Same movement, safe replay
        RETURN jsonb_build_object(
            'success', true,
            'replayed', true,
            'operation_id', p_operation_id,
            'ledger_id', v_existing_ledger_id
        );
    END IF;

    -- Get current warehouse stock from batches (signed sum)
    SELECT COALESCE(SUM(b.quantity), 0) INTO v_before
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = p_raw_material_id
      AND b.branch_id = p_branch_id
      AND b.warehouse_id = p_warehouse_id;

    v_after := v_before + p_delta;

    IF v_after < 0 AND NOT p_allow_negative THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INSUFFICIENT_STOCK',
            'before_qty', v_before,
            'requested_delta', p_delta
        );
    END IF;

    -- Get unit cost from published price as of event time, or zero
    v_unit_cost := COALESCE(
        (private.raw_published_unit_cost_at_v2(p_raw_material_id, p_branch_id, p_at)->>'unit_cost')::numeric,
        0
    );
    v_total_cost := round(p_delta * v_unit_cost, 6);

    -- Insert signed batch record (using 'non_fifo' source type)
    INSERT INTO public.raw_material_batches(
        raw_material_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, source_type, source_id
    ) VALUES (
        p_raw_material_id, p_branch_id, p_warehouse_id,
        'UNIFIED-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
        p_delta, v_unit_cost, p_entry_type, COALESCE(p_reference_id, p_operation_id)
    ) RETURNING id INTO v_batch_id;

    -- Insert into public inventory_ledger
    INSERT INTO public.inventory_ledger(
        raw_material_id, branch_id, warehouse_id, batch_number,
        quantity, unit_cost, total_cost, before_qty, after_qty,
        entry_type, reference_type, reference_id, reference_number, created_by
    ) SELECT
        p_raw_material_id, p_branch_id, p_warehouse_id, batch_number,
        p_delta, v_unit_cost, v_total_cost, v_before, v_after,
        p_entry_type, p_reference_type, p_reference_id, p_reference_number, p_created_by
    FROM public.raw_material_batches
    WHERE id = v_batch_id
    RETURNING id INTO v_ledger_id;

    -- Update or insert warehouse balance v2
    INSERT INTO private.raw_warehouse_balances_v2(branch_id, warehouse_id, raw_material_id, quantity, updated_at)
    VALUES (p_branch_id, p_warehouse_id, p_raw_material_id, v_after, clock_timestamp())
    ON CONFLICT(branch_id, warehouse_id, raw_material_id) DO UPDATE
    SET quantity = EXCLUDED.quantity, updated_at = EXCLUDED.updated_at;

    -- Update legacy raw_material_inventory aggregate
    SELECT COALESCE(SUM(b.quantity), 0) INTO v_branch_total
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = p_raw_material_id AND b.branch_id = p_branch_id;

    INSERT INTO public.raw_material_inventory(raw_material_id, branch_id, quantity, avg_cost)
    VALUES (p_raw_material_id, p_branch_id, v_branch_total, v_unit_cost)
    ON CONFLICT(raw_material_id, branch_id) DO UPDATE
    SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost, updated_at = clock_timestamp();

    -- Record in private movement audit table
    INSERT INTO private.raw_warehouse_movements_v2(
        operation_id, branch_id, warehouse_id, raw_material_id,
        quantity_delta, before_qty, after_qty, unit_cost, total_cost,
        entry_type, source_reference_type, source_reference_id, ledger_id, created_at
    ) VALUES (
        p_operation_id, p_branch_id, p_warehouse_id, p_raw_material_id,
        p_delta, v_before, v_after, v_unit_cost, v_total_cost,
        p_entry_type, p_reference_type, p_reference_id, v_ledger_id, clock_timestamp()
    );

    RETURN jsonb_build_object(
        'success', true,
        'replayed', false,
        'operation_id', p_operation_id,
        'ledger_id', v_ledger_id,
        'batch_id', v_batch_id,
        'before_qty', v_before,
        'after_qty', v_after,
        'delta', p_delta,
        'unit_cost', v_unit_cost,
        'total_cost', v_total_cost
    );
END;
$$;

REVOKE ALL ON FUNCTION private.apply_unified_raw_movement_v1(uuid,uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_unified_raw_movement_v1(uuid,uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean,timestamptz) TO service_role;
