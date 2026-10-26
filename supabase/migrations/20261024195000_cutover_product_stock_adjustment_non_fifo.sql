CREATE OR REPLACE FUNCTION public.adjust_stock(p_inventory_id uuid, p_new_quantity numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inv record;
  v_user_branch uuid;
  v_delta numeric(14,4);
  v_res jsonb;
  v_value numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    -- Only admins, branch managers and warehouse managers may adjust stock
    IF NOT public.can_permission('inventory.adjust') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Stock adjustments require the warehouse manager or branch manager role.');
    END IF;

    SELECT i.id, i.product_id, i.warehouse_id, i.quantity, i.branch_id, p.cost_price AS cost
    INTO v_inv
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    WHERE i.id = p_inventory_id
    FOR UPDATE OF i;

    IF v_inv.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVENTORY_NOT_FOUND');
    END IF;

    -- Branch isolation
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_inv.branch_id IS NOT NULL AND v_user_branch <> v_inv.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    v_delta := p_new_quantity - v_inv.quantity;
    IF v_delta = 0 THEN
      RETURN jsonb_build_object('success', true, 'inventory_id', p_inventory_id, 'no_change', true);
    END IF;

    IF v_delta > 0 THEN
      v_res := public._product_inv_add(v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, v_delta,
        COALESCE(v_inv.cost, 0), 'ADJ', NULL, NULL,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
      v_value := round(v_delta * COALESCE(v_inv.cost, 0), 2);
    ELSE
      v_res := private.remove_product_stock_non_fifo_v1(v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, -v_delta,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
      v_value := round(COALESCE((v_res->>'total_cost')::numeric, 0), 2);
    END IF;

    IF NOT COALESCE((v_res->>'success')::boolean,false) THEN
      RAISE EXCEPTION 'PRODUCT_ADJUSTMENT_MOVEMENT_FAILED: %',v_res;
    END IF;

    -- ===== LEDGER POSTING =====
    IF v_value > 0 THEN
      IF v_delta > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_value, 'credit', 0, 'note', COALESCE(p_reason, 'جرد'));
        v_lines := v_lines || jsonb_build_object('account_key', 'stock_variance', 'debit', 0, 'credit', v_value, 'note', COALESCE(p_reason, 'جرد'));
      ELSE
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', 0, 'credit', v_value, 'note', COALESCE(p_reason, 'جرد'));
        v_lines := v_lines || jsonb_build_object('account_key', 'stock_variance', 'debit', v_value, 'credit', 0, 'note', COALESCE(p_reason, 'جرد'));
      END IF;
      PERFORM public._post_journal_entry(v_inv.branch_id, 'adjustment', NULL, NULL,
        'تسوية مخزون ' || COALESCE(p_reason, ''), v_lines);
    END IF;

    RETURN jsonb_build_object('success', true, 'inventory_id', p_inventory_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$
;
