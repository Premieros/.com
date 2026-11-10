CREATE OR REPLACE FUNCTION public._process_refund_single_core(p_sale_id uuid, p_items jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale record;
  v_user_branch uuid;
  v_shift_id uuid;
  v_refund_total numeric(14,2) := 0;
  v_item record;
  v_req jsonb;
  v_item_id uuid;
  v_req_qty numeric(14,4);
  v_already numeric(14,4);
  v_ref_qty numeric(14,4);
  v_item_line_total numeric(14,2);
  v_item_ref_amt numeric(14,2);
  v_all_refunded boolean := true;
  v_remaining numeric(14,4);
  v_back numeric(14,4);
  v_ld record;
  v_res jsonb;
  v_fallback_wh uuid;
  v_last_cost numeric(12,2);
  v_sale_entry uuid;
  v_revenue numeric(14,2);
  v_discount numeric(14,2);
  v_vat numeric(14,2);
  v_cogs numeric(14,2);
  v_ratio numeric(14,6);
  v_revenue_r numeric(14,2);
  v_discount_r numeric(14,2);
  v_vat_r numeric(14,2);
  v_cogs_r numeric(14,2);
  v_cash_r numeric(14,2);
  v_ar_r numeric(14,2);
  v_paid_code text;
  v_credit_key text;
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_approval_id uuid;
  v_failure jsonb;
BEGIN
  BEGIN
    IF p_sale_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SALE');
    END IF;

    SELECT id, branch_id, warehouse_id, status, total, paid_amount, customer_id, payment_method, invoice_number
      INTO v_sale FROM public.sales WHERE id = p_sale_id;
    IF v_sale.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
    END IF;

    IF v_sale.status = 'returned' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RETURNED');
    END IF;

    -- Permission contract:
    -- sales.refund.create starts the refund/approval path.
    -- refunds.approve executes directly.
    IF NOT public.is_pos_admin()
       AND NOT public.can_permission('refunds.approve')
       AND NOT public.can_permission('sales.refund.create') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'NOT_ALLOWED',
        'permission', 'sales.refund.create'
      );
    END IF;

    IF NOT is_pos_admin() AND NOT can_permission('refunds.approve') THEN
      SELECT ar.id
        INTO v_approval_id
      FROM public.approval_requests ar
      WHERE ar.requester_id = auth.uid()
        AND ar.branch_id = v_sale.branch_id
        AND ar.action_type = 'refund'
        AND ar.entity_type = 'sale'
        AND ar.entity_id = p_sale_id
        AND ar.status = 'approved'
        AND ar.consumed_at IS NULL
        AND ar.expires_at > now()
      ORDER BY ar.decided_at DESC NULLS LAST, ar.created_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;

      IF v_approval_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'APPROVAL_REQUIRED',
          'action_type', 'refund',
          'entity_type', 'sale',
          'entity_id', p_sale_id
        );
      END IF;
    END IF;

    -- Branch isolation
    SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND v_user_branch IS NOT NULL
       AND v_sale.branch_id IS NOT NULL AND v_user_branch <> v_sale.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    -- Active shift of the refunding operator (for the drawer log, optional)
    SELECT id INTO v_shift_id FROM shifts
      WHERE branch_id = v_sale.branch_id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;

    SELECT id INTO v_fallback_wh FROM warehouses
      WHERE branch_id = v_sale.branch_id AND is_active = true ORDER BY created_at LIMIT 1;

    -- ===== VALIDATION PHASE =====
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_req IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        v_item_id := (v_req->>'sale_item_id')::uuid;
        v_req_qty := COALESCE((v_req->>'quantity')::numeric, 0);
        IF v_req_qty <= 0 THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'sale_item_id', v_item_id);
        END IF;
        SELECT id, quantity, refunded_quantity INTO v_item
          FROM sale_items WHERE id = v_item_id AND sale_id = p_sale_id;
        IF v_item.id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_FOUND', 'sale_item_id', v_item_id);
        END IF;
        v_already := COALESCE(v_item.refunded_quantity, 0);
        IF v_req_qty > v_item.quantity - v_already THEN
          RETURN jsonb_build_object('success', false, 'error', 'REFUND_EXCEEDS_QUANTITY',
            'sale_item_id', v_item_id, 'max', v_item.quantity - v_already);
        END IF;
      END LOOP;
    END IF;

    -- ===== REFUND + RESTOCK PHASE =====
    FOR v_item IN SELECT id, product_id, quantity, unit_price, discount_amount, refunded_quantity
                  FROM sale_items WHERE sale_id = p_sale_id
    LOOP
      IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        v_req_qty := 0;
        SELECT (req->>'quantity')::numeric INTO v_req_qty
        FROM jsonb_array_elements(p_items) req
        WHERE (req->>'sale_item_id')::uuid = v_item.id;
        v_req_qty := COALESCE(v_req_qty, 0);
      ELSE
        v_req_qty := v_item.quantity - COALESCE(v_item.refunded_quantity, 0);
      END IF;
      IF v_req_qty <= 0 THEN CONTINUE; END IF;

      v_item_line_total := v_item.quantity * v_item.unit_price - v_item.discount_amount;
      IF v_item.quantity > 0 THEN
        v_item_ref_amt := ROUND(v_item_line_total * v_req_qty / v_item.quantity, 2);
      ELSE
        v_item_ref_amt := 0;
      END IF;
      v_refund_total := v_refund_total + v_item_ref_amt;

      UPDATE sale_items
        SET refunded_quantity = COALESCE(refunded_quantity, 0) + v_req_qty,
            refunded_amount = COALESCE(refunded_amount, 0) + v_item_ref_amt
        WHERE id = v_item.id;

      -- Reverse the actual inventory path used by modern hybrid sales first.
      v_res := public._restore_refund_hybrid_inventory(
        v_item.id,
        p_sale_id,
        v_item.product_id,
        v_req_qty,
        v_sale.branch_id,
        COALESCE(v_sale.warehouse_id, v_fallback_wh),
        v_sale.invoice_number
      );
      IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
        v_failure := v_res;
        RAISE EXCEPTION 'PREMIER_REFUND_CORE_ABORT' USING ERRCODE = 'P0001';
      END IF;

      -- Legacy/ready-product sales are still restored from product inventory.
      -- Do not create a phantom product batch when the sale actually consumed
      -- inventory units and/or raw materials.
      IF COALESCE((v_res->>'handled')::boolean, false) IS NOT TRUE THEN
        v_remaining := v_req_qty;
        SELECT COALESCE(l.unit_cost, p.cost_price, 0) INTO v_last_cost
        FROM products p LEFT JOIN inventory_ledger l
          ON l.product_id = p.id AND l.quantity < 0 AND l.reference_type = 'sale'
             AND l.reference_id = p_sale_id
        WHERE p.id = v_item.product_id
        ORDER BY l.id DESC NULLS LAST LIMIT 1;

        FOR v_ld IN
          SELECT l.warehouse_id, l.batch_number, l.unit_cost, -l.quantity AS debited
          FROM inventory_ledger l
          WHERE l.product_id = v_item.product_id AND l.reference_type = 'sale'
            AND l.reference_id = p_sale_id AND l.quantity < 0
          ORDER BY l.id ASC
        LOOP
          IF v_remaining <= 0 THEN EXIT; END IF;
          v_back := LEAST(COALESCE(v_ld.debited, 0), v_remaining);
          IF v_back <= 0 OR v_ld.warehouse_id IS NULL THEN CONTINUE; END IF;
          v_res := public._product_inv_add(v_item.product_id, v_ld.warehouse_id, v_sale.branch_id, v_back,
            COALESCE(v_ld.unit_cost, v_last_cost),
            'R-' || COALESCE(v_ld.batch_number, 'RETURN'), NULL, NULL,
            'refund', 'refund', p_sale_id, NULL, auth.uid());
          IF NOT (v_res->>'success')::boolean THEN
            v_failure := v_res;
        RAISE EXCEPTION 'PREMIER_REFUND_CORE_ABORT' USING ERRCODE = 'P0001';
          END IF;
          v_remaining := v_remaining - v_back;
        END LOOP;

        IF v_remaining > 0 AND v_fallback_wh IS NOT NULL THEN
          v_res := public._product_inv_add(v_item.product_id, v_fallback_wh, v_sale.branch_id, v_remaining,
            v_last_cost, 'R-RETURN', NULL, NULL, 'refund', 'refund', p_sale_id, NULL, auth.uid());
          IF NOT (v_res->>'success')::boolean THEN
            v_failure := v_res;
        RAISE EXCEPTION 'PREMIER_REFUND_CORE_ABORT' USING ERRCODE = 'P0001';
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- Update header: full refund flips the status, otherwise accumulate refunded_amount
    SELECT bool_and(quantity = refunded_quantity) INTO v_all_refunded
      FROM sale_items WHERE sale_id = p_sale_id;
    UPDATE sales SET
      refunded_amount = COALESCE(refunded_amount, 0) + v_refund_total,
      status = CASE WHEN v_all_refunded THEN 'returned' ELSE status END,
      notes = CASE WHEN p_reason IS NOT NULL THEN COALESCE(notes, '') || E'\n' || p_reason ELSE notes END
      WHERE id = p_sale_id;

    -- Log the cash-out into the active shift
    IF v_shift_id IS NOT NULL AND v_refund_total > 0 THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'refund', v_refund_total, COALESCE(v_sale.payment_method, 'cash'), 'refund', p_sale_id, auth.uid());
    END IF;

    -- ===== LEDGER POSTING: prorated reversal of the original sale =====
    IF v_refund_total > 0 THEN
      SELECT id INTO v_sale_entry
      FROM public.journal_entries
      WHERE branch_id = v_sale.branch_id AND reference_type = 'sale' AND reference_id = p_sale_id;

      IF v_sale_entry IS NOT NULL THEN
        SELECT
          round(COALESCE(SUM(CASE WHEN a.id IN (m.revenue_id, m.other_income_id) THEN l.credit - l.debit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.discount_id THEN l.debit - l.credit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.vat_id THEN l.credit - l.debit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.cogs_id THEN l.debit - l.credit ELSE 0 END), 0), 2)
        INTO v_revenue, v_discount, v_vat, v_cogs
        FROM public.journal_entry_lines l
        JOIN public.chart_of_accounts a ON a.id = l.account_id
        CROSS JOIN (
          SELECT
            (SELECT public.resolve_account_key(v_sale.branch_id, 'revenue')) AS revenue_id,
            (SELECT public.resolve_account_key(v_sale.branch_id, 'other_income')) AS other_income_id,
            (SELECT public.resolve_account_key(v_sale.branch_id, 'discount_given')) AS discount_id,
            (SELECT public.resolve_account_key(v_sale.branch_id, 'vat_payable')) AS vat_id,
            (SELECT public.resolve_account_key(v_sale.branch_id, 'cogs')) AS cogs_id
        ) m
        WHERE l.journal_entry_id = v_sale_entry;

        v_ratio := round(v_refund_total / GREATEST(COALESCE(v_sale.total, 0), 1), 6);
        v_revenue_r := round(v_revenue * v_ratio, 2);
        v_discount_r := round(v_discount * v_ratio, 2);
        v_vat_r := round(v_vat * v_ratio, 2);
        v_cogs_r := round(v_cogs * v_ratio, 2);

        -- Credit the account the original collection used (cash/bank/AR)
        SELECT a.code INTO v_paid_code
        FROM public.journal_entry_lines l
        JOIN public.chart_of_accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = v_sale_entry AND l.debit > 0
          AND a.code IN ('1000', '1010', '1100')
        ORDER BY CASE a.code WHEN '1000' THEN 1 WHEN '1010' THEN 2 ELSE 3 END
        LIMIT 1;

        IF v_paid_code = '1100' THEN
          v_credit_key := 'ar';
          v_ar_r := round(v_refund_total, 2);
          v_cash_r := 0;
        ELSE
          v_credit_key := CASE WHEN v_paid_code = '1010' THEN 'bank' ELSE 'cash' END;
          v_cash_r := round(LEAST(v_refund_total, COALESCE(v_sale.paid_amount, 0)), 2);
          v_ar_r := round(v_refund_total - v_cash_r, 2);
        END IF;

        IF v_revenue_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', v_revenue_r, 'credit', 0);
          v_dr := v_dr + v_revenue_r;
        END IF;
        IF v_discount_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_discount_r);
          v_cr := v_cr + v_discount_r;
        END IF;
        IF v_vat_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', v_vat_r, 'credit', 0);
          v_dr := v_dr + v_vat_r;
        END IF;
        IF v_cogs_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_cogs_r, 'credit', 0);
          v_lines := v_lines || jsonb_build_object('account_key', 'cogs', 'debit', 0, 'credit', v_cogs_r);
          v_dr := v_dr + v_cogs_r;
          v_cr := v_cr + v_cogs_r;
        END IF;
        IF v_cash_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', v_credit_key, 'debit', 0, 'credit', v_cash_r, 'note', 'مرتجع ' || v_sale.invoice_number);
          v_cr := v_cr + v_cash_r;
        END IF;
        IF v_ar_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'ar', 'debit', 0, 'credit', v_ar_r,
            'customer_id', v_sale.customer_id, 'note', 'مرتجع ' || v_sale.invoice_number);
          v_cr := v_cr + v_ar_r;
        END IF;

        v_diff := round(v_dr - v_cr, 2);
        IF v_diff <> 0 THEN
          IF v_diff > 0 THEN
            v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_diff);
          ELSE
            v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', -v_diff, 'credit', 0);
          END IF;
        END IF;

        PERFORM public._post_journal_entry(v_sale.branch_id, 'refund', NULL, v_sale.invoice_number,
          'مرتجع فاتورة ' || v_sale.invoice_number, v_lines);
      END IF;
    END IF;

    IF v_approval_id IS NOT NULL THEN
      UPDATE public.approval_requests
      SET status = 'consumed', consumed_at = now()
      WHERE id = v_approval_id
        AND requester_id = auth.uid()
        AND action_type = 'refund'
        AND entity_type = 'sale'
        AND entity_id = p_sale_id
        AND status = 'approved'
        AND consumed_at IS NULL
        AND expires_at > now();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'REFUND_APPROVAL_CONSUME_FAILED';
      END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
      'refunded_amount', v_refund_total, 'fully_refunded', v_all_refunded);
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM = 'PREMIER_REFUND_CORE_ABORT' AND v_failure IS NOT NULL THEN
        RETURN v_failure;
      END IF;
      RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$
