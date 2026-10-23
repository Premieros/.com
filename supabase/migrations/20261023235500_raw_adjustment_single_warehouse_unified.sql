-- Branch-level adjustment supports only unambiguous single-warehouse branches; keeps original absolute quantity and journal contract.
CREATE OR REPLACE FUNCTION public.adjust_raw_stock(p_raw_material_id uuid, p_branch_id uuid, p_new_quantity numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cur numeric(14,4);
  v_delta numeric(14,4);
  v_user_branch uuid;
  v_res jsonb;
  v_cost numeric(12,2);
  v_value numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_warehouse_id uuid;
  v_warehouse_count integer;
BEGIN
  BEGIN
    IF NOT public.can_permission('inventory.adjust') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Raw material adjustments require the warehouse manager or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Legacy branch-level adjustment cannot safely pick one of multiple warehouses.
    SELECT count(*),min(id) INTO v_warehouse_count,v_warehouse_id
      FROM public.warehouses WHERE branch_id=p_branch_id AND is_active;
    IF v_warehouse_count<>1 THEN
      RETURN jsonb_build_object('success',false,'error','EXPLICIT_WAREHOUSE_REQUIRED',
        'warehouse_count',v_warehouse_count);
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
    SELECT COALESCE(quantity, 0), COALESCE(avg_cost, 0)
    INTO v_cur, v_cost
    FROM public.raw_material_inventory
    WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;
    IF v_cur IS NULL THEN v_cur := 0; END IF;

    v_delta := p_new_quantity - v_cur;
    IF v_delta = 0 THEN
      RETURN jsonb_build_object('success', true, 'raw_material_id', p_raw_material_id, 'no_change', true);
    END IF;

    v_res := private.apply_unified_raw_movement_v1(
      gen_random_uuid(),p_branch_id,v_warehouse_id,p_raw_material_id,
      v_delta,'adjustment','adjustment',NULL,p_reason,auth.uid(),true
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'RAW_ADJUST_MOVEMENT_FAILED: %',v_res;
    END IF;
    v_value := round(abs(COALESCE((v_res->>'total_cost')::numeric,0)),2);

    -- ===== LEDGER POSTING =====
    IF v_value > 0 THEN
      IF v_delta > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', v_value, 'credit', 0, 'note', COALESCE(p_reason, 'جرد'));
        v_lines := v_lines || jsonb_build_object('account_key', 'stock_variance', 'debit', 0, 'credit', v_value, 'note', COALESCE(p_reason, 'جرد'));
      ELSE
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', 0, 'credit', v_value, 'note', COALESCE(p_reason, 'جرد'));
        v_lines := v_lines || jsonb_build_object('account_key', 'stock_variance', 'debit', v_value, 'credit', 0, 'note', COALESCE(p_reason, 'جرد'));
      END IF;
      PERFORM public._post_journal_entry(p_branch_id, 'adjustment', NULL, NULL,
        'تسوية خامات ' || COALESCE(p_reason, ''), v_lines);
    END IF;

    RETURN jsonb_build_object('success', true, 'raw_material_id', p_raw_material_id, 'quantity', p_new_quantity);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$
;
