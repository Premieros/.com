-- Replace mutable collection-debit rewrites with append-only, balanced
-- reclassification journals. Production immutable org journal evidence from
-- phase5l forbids DELETE on public.journal_entry_lines.
-- Both RPC signatures, authorizations, stock posting and legacy return contracts
-- stay unchanged. This patch is first validated on disposable CI PostgreSQL.
CREATE OR REPLACE FUNCTION public.process_sale_split(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_payments jsonb, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway'::text, p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment jsonb;
  v_method text;
  v_amount numeric(14,2);
  v_requested_total numeric(14,2) := 0;
  v_method_count integer := 0;
  v_core jsonb;
  v_sale_id uuid;
  v_sale_total numeric(14,2);
  v_non_cash_total numeric(14,2) := 0;
  v_reclass_id uuid;
  v_sale_entry uuid;
  v_cash_account uuid;
  v_bank_account uuid;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_price numeric;
  v_mod jsonb;
  v_line_discount numeric;
  v_server_subtotal numeric(14,2) := 0;
  v_header_discount numeric(14,2);
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_due numeric(14,2);
  v_req_id uuid;
  v_email text;
  v_order_owner uuid;
BEGIN
  BEGIN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('pos.payment.take') THEN
      RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.payment.take');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    END IF;

    -- Cross-day open/held order settlement requires an explicit OPEN shift
    -- for every role (including admins), not only standard register operators.
    -- The row lock prevents a concurrent shift closure before sale commit.
    IF p_order_id IS NOT NULL THEN
      IF p_shift_id IS NULL THEN
        RETURN jsonb_build_object('success',false,'error','NO_OPEN_SHIFT',
          'detail','Open a new branch shift before collecting a carried order.');
      END IF;
      PERFORM 1 FROM public.shifts s
      WHERE s.id=p_shift_id AND s.branch_id=p_branch_id AND s.status='open'
      FOR SHARE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success',false,'error','NO_OPEN_SHIFT',
          'detail','Cannot settle an order into a closed or foreign-branch shift.');
      END IF;
    END IF;
    IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) < 2 THEN
      RETURN jsonb_build_object('success', false, 'error', 'SPLIT_REQUIRES_MULTIPLE_PAYMENTS');
    END IF;

    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      v_method := lower(trim(COALESCE(v_payment->>'payment_method', '')));
      v_amount := round(COALESCE((v_payment->>'amount')::numeric, 0), 2);
      IF v_method NOT IN ('cash', 'card', 'transfer') THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SPLIT_PAYMENT_METHOD', 'payment_method', v_method);
      END IF;
      IF v_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SPLIT_PAYMENT_AMOUNT', 'payment_method', v_method);
      END IF;
      v_requested_total := v_requested_total + v_amount;
    END LOOP;

    SELECT count(DISTINCT lower(trim(value->>'payment_method')))
      INTO v_method_count
    FROM jsonb_array_elements(p_payments);
    IF v_method_count < 2 THEN
      RETURN jsonb_build_object('success', false, 'error', 'SPLIT_REQUIRES_MULTIPLE_METHODS');
    END IF;

    -- Match normal checkout discount authorization before any financial write.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := NULLIF(v_item->>'product_id','')::uuid;
      v_qty := COALESCE((v_item->>'quantity')::numeric,0);
      IF v_product_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','INVALID_PRODUCT'); END IF;
      IF v_qty <= 0 THEN RETURN jsonb_build_object('success',false,'error','INVALID_QUANTITY'); END IF;
      SELECT sale_price INTO v_price FROM public.products WHERE id=v_product_id AND branch_id=p_branch_id AND is_active=true;
      IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','PRODUCT_NOT_IN_BRANCH','product_id',v_product_id); END IF;
      v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
      IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;
      v_price := GREATEST(COALESCE(v_price,0)+COALESCE((v_mod->>'price_delta')::numeric,0),0);
      v_line_discount := ROUND(LEAST(GREATEST(COALESCE((v_item->>'discount_amount')::numeric,0),0),v_qty*v_price),2);
      IF v_line_discount > 0 AND NOT public.can_permission('pos.discount') THEN
        RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED','action','discount','scope','line');
      END IF;
      v_server_subtotal := v_server_subtotal + ROUND(v_qty*v_price-v_line_discount,2);
    END LOOP;
    v_server_subtotal := ROUND(v_server_subtotal,2);
    v_header_discount := LEAST(GREATEST(COALESCE(p_discount_amount,0),0),v_server_subtotal);
    IF COALESCE(p_discount_amount,0)>0 AND NOT public.can_permission('pos.discount') THEN
      SELECT id INTO v_req_id FROM public.approval_requests
      WHERE requester_id=auth.uid() AND branch_id=p_branch_id AND action_type='discount'
        AND status='approved' AND expires_at>now()
        AND (entity_id IS NULL OR entity_id IS NOT DISTINCT FROM p_order_id)
        AND COALESCE(payload->>'discount_type','amount')=COALESCE(p_discount_type,'amount')
        AND abs(COALESCE((payload->>'discount_amount')::numeric,-1)-p_discount_amount)<0.0001
        AND abs(COALESCE((payload->>'subtotal')::numeric,-1)-v_server_subtotal)<0.0001
      ORDER BY decided_at DESC NULLS LAST,created_at DESC LIMIT 1 FOR UPDATE;
      IF v_req_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED','action','discount'); END IF;
      UPDATE public.approval_requests SET status='consumed',consumed_at=now() WHERE id=v_req_id;
      SELECT email INTO v_email FROM public.users WHERE id=auth.uid();
      INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)
      VALUES(auth.uid(),v_email,'APPROVAL_CONSUMED','approval_request',v_req_id,
        jsonb_build_object('action_type','discount','discount_amount',p_discount_amount,'discount_type',p_discount_type,
          'server_subtotal',v_server_subtotal,'order_id',p_order_id),p_branch_id);
    END IF;
    SELECT t.tax_enabled,t.tax_rate INTO v_tax_enabled,v_tax_rate FROM public._effective_branch_tax(p_branch_id) t;
    v_due := ROUND(v_server_subtotal-v_header_discount+CASE WHEN COALESCE(v_tax_enabled,false) THEN ROUND((v_server_subtotal-v_header_discount)*COALESCE(v_tax_rate,0)/100,2) ELSE 0 END,2);
    IF ROUND(v_requested_total,2) <> v_due THEN
      RETURN jsonb_build_object('success',false,'error','SPLIT_PAYMENT_TOTAL_MISMATCH','total_due',v_due,'paid_amount',ROUND(v_requested_total,2));
    END IF;

    -- The existing sale core remains the single stock/write boundary.
    -- Use a temporary cash collection, then replace only the collection-side accounting below.
    IF p_order_id IS NOT NULL THEN
      SELECT o.cashier_id INTO v_order_owner
      FROM public.orders o
      WHERE o.id=p_order_id AND o.branch_id=p_branch_id AND o.status IN ('open','held');
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
      END IF;
      IF v_order_owner IS DISTINCT FROM auth.uid() THEN
        PERFORM set_config('app.pos_action_authorized','1',true);
        PERFORM set_config('app.pos_action_actor_id',auth.uid()::text,true);
        PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
        PERFORM set_config('app.pos_action_permission','pos.payment.take',true);
      END IF;
      v_core := public._prepare_kitchen_sale_settlement(p_order_id,p_branch_id,p_warehouse_id,p_items);
      IF COALESCE((v_core->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_core; END IF;
    END IF;

    v_core := public._process_sale_core(
      p_invoice_number,
      p_branch_id,
      p_warehouse_id,
      p_customer_id,
      CASE WHEN p_order_id IS NOT NULL THEN v_order_owner ELSE auth.uid() END,
      p_subtotal,
      p_discount_amount,
      p_discount_type,
      p_tax_amount,
      p_bonus_amount,
      p_total,
      v_requested_total,
      'cash',
      p_status,
      p_items,
      p_shift_id,
      p_order_type,
      p_table_id,
      p_order_id,
      p_guest_count
    );

    IF p_order_id IS NOT NULL THEN
      PERFORM set_config('app.kitchen_inventory_settlement','off',true);
      IF COALESCE((v_core->>'success')::boolean,false) IS TRUE THEN
        v_core := v_core || public._finalize_kitchen_sale_settlement(NULLIF(v_core->>'sale_id','')::uuid);
      END IF;
    END IF;

    IF COALESCE((v_core->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_core;
    END IF;

    v_sale_id := (v_core->>'sale_id')::uuid;
    SELECT total INTO v_sale_total FROM public.sales WHERE id = v_sale_id FOR UPDATE;

    IF round(COALESCE(v_sale_total, 0), 2) <> round(v_requested_total, 2) THEN
      RAISE EXCEPTION 'SPLIT_PAYMENT_TOTAL_MISMATCH: expected %, got %', v_sale_total, v_requested_total;
    END IF;

    INSERT INTO public.sale_payments(sale_id, branch_id, payment_method, amount, created_by)
    SELECT
      v_sale_id,
      p_branch_id,
      lower(trim(value->>'payment_method')),
      round((value->>'amount')::numeric, 2),
      auth.uid()
    FROM jsonb_array_elements(p_payments);

    UPDATE public.sales
    SET payment_method = 'split', paid_amount = v_sale_total
    WHERE id = v_sale_id;

    -- Replace the one temporary shift collection with one row per tender.
    IF p_shift_id IS NOT NULL THEN
      DELETE FROM public.shift_operations
      WHERE shift_id = p_shift_id
        AND operation_type = 'sale'
        AND reference_type = 'sale'
        AND reference_id = v_sale_id;

      INSERT INTO public.shift_operations(
        shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by
      )
      SELECT
        p_shift_id,
        'sale',
        round((value->>'amount')::numeric, 2),
        lower(trim(value->>'payment_method')),
        'sale',
        v_sale_id,
        auth.uid()
      FROM jsonb_array_elements(p_payments);
    END IF;

    -- The core sale journal has an immutable cash debit for the whole payment.
    -- Never delete/rewrite its protected journal lines. Reclassify only the
    -- card/transfer portion into bank using a new balanced, append-only journal.
    SELECT ROUND(COALESCE(SUM(amount),0),2)
    INTO v_non_cash_total
    FROM public.sale_payments
    WHERE sale_id=v_sale_id AND payment_method <> 'cash';

    IF v_non_cash_total > 0 THEN
      v_reclass_id := public._post_journal_entry(
        p_branch_id,
        'sale_split_tender_reclass',
        v_sale_id,
        p_invoice_number,
        'Split tender bank allocation for sale ' || p_invoice_number,
        jsonb_build_array(
          jsonb_build_object(
            'account_key','bank','debit',v_non_cash_total,'credit',0,
            'note','Noncash share of split sale ' || p_invoice_number
          ),
          jsonb_build_object(
            'account_key','cash','debit',0,'credit',v_non_cash_total,
            'note','Noncash share of split sale ' || p_invoice_number
          )
        )
      );
      IF v_reclass_id IS NULL THEN RAISE EXCEPTION 'SPLIT_TENDER_RECLASS_JOURNAL_MISSING'; END IF;
    END IF;

    RETURN v_core || jsonb_build_object(
      'split', true,
      'payment_count', jsonb_array_length(p_payments),
      'paid_amount', v_sale_total
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;


CREATE OR REPLACE FUNCTION public.process_refund(p_sale_id uuid, p_items jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_split boolean := false;
  v_result jsonb;
  v_refund_total numeric(14,2);
  v_sale record;
  v_refund_entry uuid;
  v_non_cash_total numeric(14,2) := 0;
  v_reclass_id uuid;
  v_cash_account uuid;
  v_bank_account uuid;
  v_remaining_total numeric(14,2);
  v_allocated numeric(14,2) := 0;
  v_left numeric(14,2);
  v_row record;
  v_part numeric(14,2);
  v_last_payment uuid;
  v_shift_id uuid;
BEGIN
  BEGIN
    IF p_sale_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SALE');
    END IF;

    SELECT EXISTS(SELECT 1 FROM public.sale_payments WHERE sale_id = p_sale_id)
      INTO v_has_split;

    IF NOT v_has_split THEN
      RETURN public._process_refund_single_core(p_sale_id, p_items, p_reason);
    END IF;

    SELECT id, branch_id, invoice_number
      INTO v_sale
    FROM public.sales
    WHERE id = p_sale_id
    FOR UPDATE;
    IF v_sale.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
    END IF;

    -- Run the exact existing refund core first. It owns approval, exact inventory restoration,
    -- sale-item refund state, and the non-collection reversal lines.
    v_result := public._process_refund_single_core(p_sale_id, p_items, p_reason);
    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_result;
    END IF;

    v_refund_total := round(COALESCE((v_result->>'refunded_amount')::numeric, 0), 2);
    IF v_refund_total <= 0 THEN
      RETURN v_result;
    END IF;

    -- Lock the tender rows before computing their remaining refundable balance.
    PERFORM 1
    FROM public.sale_payments
    WHERE sale_id = p_sale_id
    FOR UPDATE;

    SELECT round(COALESCE(sum(amount - refunded_amount), 0), 2)
      INTO v_remaining_total
    FROM public.sale_payments
    WHERE sale_id = p_sale_id;

    IF v_refund_total > v_remaining_total THEN
      RAISE EXCEPTION 'SPLIT_REFUND_EXCEEDS_REMAINING_TENDERS: refund %, remaining %', v_refund_total, v_remaining_total;
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS pg_temp.split_refund_alloc(
      payment_id uuid PRIMARY KEY,
      payment_method text NOT NULL,
      amount numeric(14,2) NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.split_refund_alloc;

    -- Pro-rate the refund across remaining tenders; the final tender absorbs rounding cents.
    SELECT id INTO v_last_payment
    FROM public.sale_payments
    WHERE sale_id = p_sale_id AND amount > refunded_amount
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    FOR v_row IN
      SELECT id, payment_method, amount - refunded_amount AS remaining
      FROM public.sale_payments
      WHERE sale_id = p_sale_id AND amount > refunded_amount
      ORDER BY created_at, id
    LOOP
      IF v_row.id = v_last_payment THEN CONTINUE; END IF;
      v_part := LEAST(
        round(v_refund_total * v_row.remaining / NULLIF(v_remaining_total, 0), 2),
        v_row.remaining,
        v_refund_total - v_allocated
      );
      IF v_part > 0 THEN
        INSERT INTO pg_temp.split_refund_alloc(payment_id, payment_method, amount)
        VALUES (v_row.id, v_row.payment_method, v_part);
        v_allocated := v_allocated + v_part;
      END IF;
    END LOOP;

    v_left := round(v_refund_total - v_allocated, 2);
    IF v_left > 0 THEN
      SELECT id, payment_method, amount - refunded_amount AS remaining
        INTO v_row
      FROM public.sale_payments
      WHERE id = v_last_payment;
      IF v_row.id IS NULL OR v_left > v_row.remaining THEN
        RAISE EXCEPTION 'SPLIT_REFUND_ALLOCATION_FAILED';
      END IF;
      INSERT INTO pg_temp.split_refund_alloc(payment_id, payment_method, amount)
      VALUES (v_row.id, v_row.payment_method, v_left)
      ON CONFLICT (payment_id) DO UPDATE SET amount = pg_temp.split_refund_alloc.amount + EXCLUDED.amount;
    END IF;

    UPDATE public.sale_payments sp
    SET refunded_amount = sp.refunded_amount + a.amount
    FROM pg_temp.split_refund_alloc a
    WHERE sp.id = a.payment_id;

    -- Replace the core's single refund drawer row with exact tender rows.
    SELECT id INTO v_shift_id
    FROM public.shifts
    WHERE branch_id = v_sale.branch_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;

    IF v_shift_id IS NOT NULL THEN
      DELETE FROM public.shift_operations
      WHERE shift_id = v_shift_id
        AND operation_type = 'refund'
        AND reference_type = 'refund'
        AND reference_id = p_sale_id;

      INSERT INTO public.shift_operations(
        shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by
      )
      SELECT v_shift_id, 'refund', amount, payment_method, 'refund', p_sale_id, auth.uid()
      FROM pg_temp.split_refund_alloc;
    END IF;

    -- The refund core already posted a balanced immutable cash refund entry.
    -- Keep its journal lines and adjust the noncash allocation in a separate,
    -- append-only journal keyed to this exact refund journal (not the sale).
    SELECT id INTO v_refund_entry
    FROM public.journal_entries
    WHERE branch_id = v_sale.branch_id
      AND reference_type = 'refund'
      AND reference_number = v_sale.invoice_number
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF v_refund_entry IS NULL THEN
      RAISE EXCEPTION 'SPLIT_REFUND_JOURNAL_NOT_FOUND';
    END IF;

    SELECT ROUND(COALESCE(SUM(amount),0),2)
    INTO v_non_cash_total
    FROM pg_temp.split_refund_alloc
    WHERE payment_method <> 'cash';

    IF v_non_cash_total > 0 THEN
      v_reclass_id := public._post_journal_entry(
        v_sale.branch_id,
        'refund_split_tender_reclass',
        v_refund_entry,
        v_sale.invoice_number,
        'Split refund noncash allocation for sale ' || v_sale.invoice_number,
        jsonb_build_array(
          jsonb_build_object(
            'account_key','cash','debit',v_non_cash_total,'credit',0,
            'note','Split refund cash correction ' || v_sale.invoice_number
          ),
          jsonb_build_object(
            'account_key','bank','debit',0,'credit',v_non_cash_total,
            'note','Split refund bank payout ' || v_sale.invoice_number
          )
        )
      );
      IF v_reclass_id IS NULL THEN RAISE EXCEPTION 'SPLIT_REFUND_RECLASS_JOURNAL_MISSING'; END IF;
    END IF;

    RETURN v_result || jsonb_build_object('split_refund', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

