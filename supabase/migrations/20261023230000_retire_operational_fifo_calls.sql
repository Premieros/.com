-- ============================================================================
-- Migration: 20261023230000_retire_operational_fifo_calls.sql
-- Description: Deprecate or neutralize legacy _raw_remove_fifo to ensure no operational callers remain.
-- Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd ONLY.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
    p_raw_material_id uuid,
    p_branch_id uuid,
    p_warehouse_id uuid,
    p_qty numeric,
    p_entry_type text,
    p_reference_type text,
    p_reference_id uuid,
    p_reference_number text,
    p_created_by uuid,
    p_allow_negative boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_res jsonb;
BEGIN
    -- Redirect directly to unified non-FIFO movement engine
    v_res := private.apply_unified_raw_movement_v1(
        gen_random_uuid(),
        p_branch_id,
        p_warehouse_id,
        p_raw_material_id,
        -p_qty, -- removal is negative delta
        p_entry_type,
        p_reference_type,
        p_reference_id,
        p_reference_number,
        p_created_by,
        p_allow_negative
    );

    IF COALESCE((v_res->>'success')::boolean, false) IS TRUE THEN
        RETURN jsonb_build_object(
            'success', true,
            'removed', p_qty,
            'shortage', 0,
            'oversold', 0,
            'total_cost', COALESCE((v_res->>'total_cost')::numeric, 0),
            'avg_cost', COALESCE((v_res->>'unit_cost')::numeric, 0)
        );
    ELSE
        RETURN v_res;
    END IF;
END;
$$;
