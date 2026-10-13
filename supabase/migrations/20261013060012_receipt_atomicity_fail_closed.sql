-- PROPOSED CHANGE: do NOT deploy to production without explicit owner approval.
-- Capture the exact existing function and replace ONLY its three post-GRN
-- RETURN v_res exits with exceptions that rollback the enclosing SQL block.
-- This file must run only in disposable CI PostgreSQL until approved.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_purchase_id uuid, p_receipt_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_purchase record;
  v_user_branch uuid;
  v_receipt_id uuid;
  v_number text;
  v_item jsonb;
  v_pitem record;
  v_qty numeric(14,4);
  v_res jsonb;
  v_stock numeric(14,4);
  v_stock_val numeric(14,2);
  v_new_cost numeric(12,2);
  v_fully_received boolean := true;
  v_rows integer := 0;
  v_goods_fg numeric(14,2) := 0;
  v_goods_rm numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_paid numeric(14,2);
  v_ap numeric(14,2);
BEGIN
  BEGIN
    IF p_receipt_items IS NULL OR jsonb_array_length(p_receipt_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_RECEIPT');
    END IF;
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    -- Permission-First: inspect ownership before taking a row lock.
    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id;
    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;
    IF NOT public.user_may_access_branch(v_purchase.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF v_purchase.status NOT IN ('approved', 'submitted', 'partial') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_RECEIVABLE', 'status', v_purchase.status);
    END IF;
    IF lower(btrim(COALESCE(v_purchase.payment_method, 'cash'))) NOT IN ('cash', 'credit') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TREASURY_ACCOUNT_REQUIRED',
        'detail', 'Non-cash purchase orders require an explicitly selected treasury account.'
      );
    END IF;

    SELECT * INTO v_purchase
    FROM public.purchases
    WHERE id = p_purchase_id
    FOR UPDATE;

    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;
    IF NOT public.user_may_access_branch(v_purchase.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF v_purchase.status NOT IN ('approved', 'submitted', 'partial') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_RECEIVABLE', 'status', v_purchase.status);
    END IF;

    -- Validate every line against the ordered items before writing anything.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_receipt_items)
    LOOP
      v_qty := COALESCE((v_item->>'quantity_received')::numeric, 0);
      IF v_qty <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
      END IF;
      SELECT * INTO v_pitem FROM public.purchase_items
      WHERE id = (v_item->>'purchase_item_id')::uuid;
      IF v_pitem.id IS NULL OR v_purchase.id <> (
        SELECT purchase_id FROM public.purchase_items WHERE id = (v_item->>'purchase_item_id')::uuid
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_ITEM_NOT_FOUND');
      END IF;
      IF v_qty > v_pitem.quantity - COALESCE(v_pitem.received_quantity, 0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'OVER_RECEIPT',
          'purchase_item_id', v_item->>'purchase_item_id',
          'ordered', v_pitem.quantity, 'already_received', v_pitem.received_quantity, 'receiving', v_qty);
      END IF;
    END LOOP;

    -- Preflight the canonical PO warehouse before any GRN write.  The
    -- inventory helpers already require branch-local active warehouses; doing
    -- this here keeps JSON failure responses side-effect free.
    IF v_purchase.warehouse_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WAREHOUSE_REQUIRED',
        'detail', 'Select a warehouse before receiving this purchase order.'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.id = v_purchase.warehouse_id
        AND w.branch_id = v_purchase.branch_id
        AND w.is_active
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WAREHOUSE_BRANCH_MISMATCH',
        'warehouse_id', v_purchase.warehouse_id,
        'branch_id', v_purchase.branch_id
      );
    END IF;

    v_number := (public.next_document_number('purchase_receipt')->>'number')::text;

    INSERT INTO public.purchase_receipts
      (receipt_number, purchase_id, branch_id, warehouse_id, received_by, notes)
    VALUES (v_number, p_purchase_id, v_purchase.branch_id, v_purchase.warehouse_id, auth.uid(),
            NULL)
    RETURNING id INTO v_receipt_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_receipt_items)
    LOOP
      v_qty := COALESCE((v_item->>'quantity_received')::numeric, 0);

      SELECT * INTO v_pitem FROM public.purchase_items WHERE id = (v_item->>'purchase_item_id')::uuid;

      INSERT INTO public.purchase_receipt_items (receipt_id, purchase_item_id, quantity_received, unit_cost)
      VALUES (v_receipt_id, v_pitem.id, v_qty, v_pitem.unit_cost);

      IF v_pitem.product_id IS NOT NULL THEN
        IF v_purchase.warehouse_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED',
            'detail', 'Select a warehouse to receive product items.');
        END IF;
        v_res := public._product_inv_add(v_pitem.product_id, v_purchase.warehouse_id, v_purchase.branch_id,
          v_qty, v_pitem.unit_cost, NULL, NULL, NULL,
          'purchase', 'purchase', p_purchase_id, v_purchase.invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          -- A failing helper can return after a GRN/earlier stock lines were
          -- already written. Throw into the enclosing EXCEPTION subtransaction
          -- so ALL earlier GRN, inventory, accounting and outbox changes rollback.
          RAISE EXCEPTION USING
            MESSAGE = 'PURCHASE_RECEIPT_STOCK_FAILED: ' ||
                      COALESCE(v_res->>'error', 'UNKNOWN'),
            ERRCODE = 'P0001';
        END IF;

        SELECT COALESCE(SUM(b.quantity), 0), COALESCE(SUM(b.quantity * b.unit_cost), 0)
        INTO v_stock, v_stock_val
        FROM public.inventory_batches b WHERE b.product_id = v_pitem.product_id;
        v_new_cost := CASE WHEN v_stock > 0 THEN round(v_stock_val / v_stock, 2) ELSE v_pitem.unit_cost END;
        UPDATE public.products SET cost_price = v_new_cost, updated_at = now() WHERE id = v_pitem.product_id;

        v_goods_fg := round(v_goods_fg + v_qty * v_pitem.unit_cost, 2);
      ELSE
        -- Normalize the quantity actually received, not the full ordered line.
        v_res := public._normalize_raw_purchase_uom(
          v_pitem.raw_material_id, v_qty, v_pitem.unit_cost, v_pitem.unit_name);
        IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
          -- A failing helper can return after a GRN/earlier stock lines were
          -- already written. Throw into the enclosing EXCEPTION subtransaction
          -- so ALL earlier GRN, inventory, accounting and outbox changes rollback.
          RAISE EXCEPTION USING
            MESSAGE = 'PURCHASE_RECEIPT_STOCK_FAILED: ' ||
                      COALESCE(v_res->>'error', 'UNKNOWN'),
            ERRCODE = 'P0001';
        END IF;
        v_res := public._raw_add(v_pitem.raw_material_id, v_purchase.branch_id, v_purchase.warehouse_id,
          (v_res->>'stock_quantity')::numeric, (v_res->>'stock_unit_cost')::numeric,
          NULL, NULL, NULL, 'purchase', 'purchase_receipt', v_receipt_id, v_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          -- A failing helper can return after a GRN/earlier stock lines were
          -- already written. Throw into the enclosing EXCEPTION subtransaction
          -- so ALL earlier GRN, inventory, accounting and outbox changes rollback.
          RAISE EXCEPTION USING
            MESSAGE = 'PURCHASE_RECEIPT_STOCK_FAILED: ' ||
                      COALESCE(v_res->>'error', 'UNKNOWN'),
            ERRCODE = 'P0001';
        END IF;
        v_goods_rm := round(v_goods_rm + v_qty * v_pitem.unit_cost, 2);
      END IF;

      UPDATE public.purchase_items
      SET received_quantity = COALESCE(received_quantity, 0) + v_qty
      WHERE id = v_pitem.id;

      v_rows := v_rows + 1;
    END LOOP;

    -- Any remaining ordered quantity means the PO is still on backorder.
    SELECT EXISTS (
      SELECT 1 FROM public.purchase_items
      WHERE purchase_id = p_purchase_id
        AND quantity - COALESCE(received_quantity, 0) > 0
    ) INTO v_fully_received;
    v_fully_received := NOT v_fully_received;

    -- ===== LEDGER POSTING (only when the PO is fully received) =====
    IF v_fully_received THEN
      -- Earlier partial receipts were not posted. Rebuild inventory value from
      -- the full order so the completion journal never contains only the last GRN.
      SELECT
        round(COALESCE(SUM(CASE WHEN pi.product_id IS NOT NULL THEN pi.quantity * pi.unit_cost ELSE 0 END), 0), 2),
        round(COALESCE(SUM(CASE WHEN pi.raw_material_id IS NOT NULL THEN pi.quantity * pi.unit_cost ELSE 0 END), 0), 2)
      INTO v_goods_fg, v_goods_rm
      FROM public.purchase_items pi
      WHERE pi.purchase_id = p_purchase_id;

      v_paid := CASE
        WHEN lower(btrim(COALESCE(v_purchase.payment_method, 'cash'))) = 'cash'
          THEN round(COALESCE(v_purchase.total, 0), 2)
        ELSE 0
      END;
      v_ap := round(COALESCE(v_purchase.total, 0) - v_paid, 2);

      IF v_goods_fg > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_goods_fg, 'credit', 0, 'note', v_purchase.invoice_number);
        v_dr := v_dr + v_goods_fg;
      END IF;
      IF v_goods_rm > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', v_goods_rm, 'credit', 0, 'note', v_purchase.invoice_number);
        v_dr := v_dr + v_goods_rm;
      END IF;
      IF COALESCE(v_purchase.tax_amount, 0) > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'vat_receivable', 'debit', v_purchase.tax_amount, 'credit', 0);
        v_dr := v_dr + v_purchase.tax_amount;
      END IF;
      IF COALESCE(v_purchase.discount_amount, 0) > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', 0, 'credit', v_purchase.discount_amount);
        v_cr := v_cr + v_purchase.discount_amount;
      END IF;
      IF v_paid > 0 THEN
        -- v_paid can only be positive for a canonical cash PO.
        v_lines := v_lines || jsonb_build_object(
          'account_key', 'cash',
          'debit', 0, 'credit', v_paid, 'note', v_purchase.invoice_number
        );
        v_cr := v_cr + v_paid;
      END IF;
      IF v_ap > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'ap', 'debit', 0, 'credit', v_ap,
          'supplier_id', v_purchase.supplier_id, 'note', v_purchase.invoice_number);
        v_cr := v_cr + v_ap;
      END IF;

      v_diff := round(v_dr - v_cr, 2);
      IF v_diff <> 0 THEN
        IF v_diff > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', 0, 'credit', v_diff);
        ELSE
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', -v_diff, 'credit', 0);
        END IF;
      END IF;

      PERFORM public._post_journal_entry(v_purchase.branch_id, 'purchase', p_purchase_id,
        v_purchase.invoice_number, 'فاتورة شراء ' || v_purchase.invoice_number, v_lines);
    END IF;

    UPDATE public.purchases
    SET status = CASE WHEN v_fully_received THEN 'completed' ELSE 'partial' END,
        payment_method = lower(btrim(COALESCE(v_purchase.payment_method, 'cash'))),
        paid_amount = CASE
          WHEN NOT v_fully_received THEN paid_amount
          WHEN lower(btrim(COALESCE(v_purchase.payment_method, 'cash'))) = 'cash'
            THEN round(COALESCE(total, 0), 2)
          ELSE 0
        END
    WHERE id = p_purchase_id;

    RETURN jsonb_build_object('success', true, 'receipt_id', v_receipt_id,
      'receipt_number', v_number, 'items_received', v_rows,
      'fully_received', v_fully_received, 'status', CASE WHEN v_fully_received THEN 'completed' ELSE 'partial' END);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
