-- Correct split sale journal creation at the only accounting write boundary.
-- Never delete/replace lines with immutable organization evidence.
-- _process_sale_core is not callable by anon/authenticated directly.
-- Existing single-tender accounting and stock logic remain unchanged.
CREATE OR REPLACE FUNCTION public._process_sale_core(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway'::text, p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_user_branch uuid;
  v_role text;
  v_shift_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_unit_price numeric(12,2);
  v_discount_amount numeric(14,2);
  v_bonus_quantity numeric(14,4);
  v_item_total numeric(14,2);
  v_warehouse_ids uuid[];
  v_available numeric(14,4);
  v_res jsonb;
  v_mod jsonb;
  v_short numeric(14,4);
  v_cogs_total numeric(14,2) := 0;
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2) := 0;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
  v_order_table uuid;
  v_effective_operator uuid;
  v_split_tenders jsonb;
  v_split_payment jsonb;
  v_split_method text;
  v_split_amount numeric(14,2);
  v_split_total numeric(14,2) := 0;
  v_split_distinct_methods integer := 0;
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    -- Subscription gate: only super_admin may sell on an expired / non-active
    -- subscription. Owners manage plans from the console but do not bypass.
    IF NOT EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'
    ) AND public.subscription_expired(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SUBSCRIPTION_EXPIRED',
        'subscription', public.subscription_status(p_branch_id));
    END IF;

    SELECT role, branch_id INTO v_role, v_user_branch FROM public.users WHERE id = auth.uid();

    -- Branch isolation (mirror of RLS on sales)
    IF NOT is_pos_admin() THEN
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Origin table must belong to the sale branch
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;

    -- Shift enforcement for register operators
    IF public.can_permission('pos.payment.take') AND NOT public.can_permission('shifts.manage') AND NOT public.is_pos_admin() THEN
      IF p_shift_id IS NULL THEN
        SELECT id INTO v_shift_id
        FROM shifts
        WHERE branch_id = p_branch_id AND status = 'open'
        ORDER BY opened_at DESC LIMIT 1;
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM shifts
          WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'open'
        ) THEN
          RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT',
            'detail', 'Open a shift before selling. The sale was not created.');
        END IF;
        v_shift_id := p_shift_id;
      END IF;

      IF v_shift_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT',
          'detail', 'Open a shift before selling. The sale was not created.');
      END IF;
    END IF;

    -- ===== VALIDATE the linked order BEFORE any writes =====
    -- FOUND (not the table value) is what matters: a held takeaway/delivery
    -- order legitimately has table_id = NULL and must still be payable. Any
    -- RETURN here is safe because nothing has been written yet.
    IF p_order_id IS NOT NULL THEN
      SELECT table_id INTO v_order_table
      FROM public.orders
      WHERE id = p_order_id AND branch_id = p_branch_id AND status IN ('open', 'held');

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND',
          'detail', 'The order must exist, belong to this branch, and be open or held. No sale was created.');
      END IF;
    END IF;

    -- Stock deduction scope: all active warehouses of the branch
    SELECT array_agg(id) INTO v_warehouse_ids
    FROM warehouses WHERE branch_id = p_branch_id AND is_active = true;

    -- ===== VALIDATION PHASE: check every item BEFORE writing anything =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;

      -- Branch ownership: the product must belong to the sale branch
      IF NOT EXISTS (
        SELECT 1 FROM products WHERE id = v_product_id AND branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH',
          'product_id', v_product_id, 'branch_id', p_branch_id);
      END IF;


      -- Accumulate the authoritative subtotal (catalog price, clamped discount)
      SELECT COALESCE(sale_price, 0) INTO v_unit_price FROM products WHERE id = v_product_id;
      v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
      IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;
      v_unit_price := GREATEST(v_unit_price+COALESCE((v_mod->>'price_delta')::numeric,0),0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price - v_discount_amount, 2);
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS (computed from authoritative prices) =====
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
    SELECT t.tax_enabled, t.tax_rate INTO v_tax_enabled, v_tax_rate
    FROM public._effective_branch_tax(p_branch_id) t;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
    END IF;
    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);
    v_paid := ROUND(LEAST(GREATEST(COALESCE(p_paid_amount, 0), 0), v_total), 2);
    v_ar := ROUND(GREATEST(v_total - v_paid, 0), 2);

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    v_effective_operator := COALESCE(p_salesperson_id, auth.uid());
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status, order_type, table_id, guest_count)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, v_effective_operator, v_effective_operator,
      v_subtotal, v_discount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, v_paid, p_payment_method, p_status, COALESCE(p_order_type, 'takeaway'), p_table_id, p_guest_count)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);

      SELECT sale_price INTO v_unit_price FROM products WHERE id = v_product_id;
      v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
      IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;
      v_unit_price := GREATEST(COALESCE(v_unit_price,0)+COALESCE((v_mod->>'price_delta')::numeric,0),0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := ROUND(v_quantity * v_unit_price - v_discount_amount, 2);

      INSERT INTO sale_items (sale_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total, modifier_option_ids, modifiers_snapshot)
      VALUES (v_sale_id, v_product_id, COALESCE(v_item->>'unit_name', 'piece'),
        v_quantity, v_unit_price, v_discount_amount, v_bonus_quantity, v_item_total,
        ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids','[]'::jsonb))),
        COALESCE(v_mod->'snapshot','[]'::jsonb)) RETURNING id INTO v_sale_item_id;

      v_res := public.deduct_sale_inventory_with_modifiers(
        p_branch_id,
        p_warehouse_id,
        jsonb_build_array(v_item),
        v_sale_id,
        p_invoice_number
      );
      IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'UNIT_SALE_DEDUCTION_FAILED: %', COALESCE(v_res->>'detail', v_res->>'error', 'unknown');
      END IF;
      INSERT INTO public.sale_item_inventory_effects(
        sale_item_id, sale_id, branch_id, warehouse_id, target_type, target_id, quantity
      )
      SELECT v_sale_item_id, v_sale_id, p_branch_id, p_warehouse_id,
             'inventory_unit', (e->>'unit_id')::uuid, (e->>'quantity')::numeric
      FROM jsonb_array_elements(COALESCE(v_res->'units_deducted', '[]'::jsonb)) e
      WHERE COALESCE((e->>'quantity')::numeric, 0) > 0
      ON CONFLICT (sale_item_id, target_type, target_id)
      DO UPDATE SET quantity = public.sale_item_inventory_effects.quantity + EXCLUDED.quantity;

      INSERT INTO public.sale_item_inventory_effects(
        sale_item_id, sale_id, branch_id, warehouse_id, target_type, target_id, quantity
      )
      SELECT v_sale_item_id, v_sale_id, p_branch_id, p_warehouse_id,
             'raw_material', (e->>'raw_material_id')::uuid, (e->>'quantity')::numeric
      FROM jsonb_array_elements(COALESCE(v_res->'raw_materials_deducted', '[]'::jsonb)) e
      WHERE COALESCE((e->>'quantity')::numeric, 0) > 0
      ON CONFLICT (sale_item_id, target_type, target_id)
      DO UPDATE SET quantity = public.sale_item_inventory_effects.quantity + EXCLUDED.quantity;

      INSERT INTO public.sale_item_inventory_effects(
        sale_item_id, sale_id, branch_id, warehouse_id, target_type, target_id, quantity
      )
      SELECT v_sale_item_id, v_sale_id, p_branch_id, p_warehouse_id,
             'product', (e->>'product_id')::uuid, (e->>'quantity')::numeric
      FROM jsonb_array_elements(COALESCE(v_res->'ready_products_deducted', '[]'::jsonb)) e
      WHERE COALESCE((e->>'quantity')::numeric, 0) > 0
      ON CONFLICT (sale_item_id, target_type, target_id)
      DO UPDATE SET quantity = public.sale_item_inventory_effects.quantity + EXCLUDED.quantity;

      IF NULLIF(v_res->>'source_order_item_id','') IS NOT NULL THEN
        UPDATE public.sale_items
        SET source_order_item_id = NULLIF(v_res->>'source_order_item_id','')::uuid
        WHERE id=v_sale_item_id;
      ELSE
        UPDATE public.inventory_unit_entries
        SET source_sale_item_id=v_sale_item_id
        WHERE reference_type='sale'
          AND reference_id=v_sale_id
          AND source_sale_item_id IS NULL;
      END IF;

      v_cogs_total := v_cogs_total + COALESCE((v_res->>'total_cost')::numeric, 0);
    END LOOP;

    -- ===== WRITE PHASE 2b: settle the linked order + free tables atomically =====
    -- H4: only free a table when NO other open/held order still references it.
    -- H3: a direct dine-in sale (no linked order) frees its origin table here,
    --     inside the sale transaction, instead of client-side afterwards.
    IF p_order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = p_order_id;
      -- NULL table (held takeaway/delivery) has no table to free.
      IF v_order_table IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE table_id = v_order_table AND status IN ('open', 'held') AND id <> p_order_id
      ) THEN
        UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
        WHERE id = v_order_table;
      END IF;
    ELSIF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = p_table_id AND status IN ('open', 'held')
    ) THEN
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
      WHERE id = p_table_id;
    END IF;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', v_paid, p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
    IF p_payment_method = 'split' THEN
      -- Split tenders MUST be posted by the core atomically, before journal
      -- evidence/immutability FKs are generated. Never rewrite posted lines.
      v_split_tenders := NULLIF(current_setting('app.pos_split_tenders',true),'')::jsonb;
      IF v_split_tenders IS NULL OR jsonb_typeof(v_split_tenders) <> 'array'
         OR jsonb_array_length(v_split_tenders) < 2 THEN
        RAISE EXCEPTION 'SPLIT_TENDER_CONTEXT_REQUIRED';
      END IF;
      SELECT count(DISTINCT lower(btrim(value->>'payment_method')))
        INTO v_split_distinct_methods FROM jsonb_array_elements(v_split_tenders);
      IF v_split_distinct_methods < 2 THEN
        RAISE EXCEPTION 'SPLIT_TENDER_METHODS_REQUIRED';
      END IF;
      FOR v_split_payment IN SELECT value FROM jsonb_array_elements(v_split_tenders)
      LOOP
        v_split_method := lower(btrim(coalesce(v_split_payment->>'payment_method','')));
        v_split_amount := round((v_split_payment->>'amount')::numeric,2);
        IF v_split_method NOT IN ('cash','card','transfer')
           OR v_split_amount IS NULL OR v_split_amount <= 0 THEN
          RAISE EXCEPTION 'INVALID_SPLIT_TENDER_CORE';
        END IF;
        v_balance_account := CASE WHEN v_split_method='cash' THEN 'cash' ELSE 'bank' END;
        v_lines := v_lines || jsonb_build_object(
          'account_key', v_balance_account,
          'debit', v_split_amount,'credit',0,
          'note', p_invoice_number || ' · ' || v_split_method
        );
        v_split_total := v_split_total + v_split_amount;
      END LOOP;
      IF round(v_split_total,2) <> v_paid OR v_paid <> v_total THEN
        RAISE EXCEPTION 'SPLIT_TENDER_TOTAL_MISMATCH';
      END IF;
      v_dr := v_dr + v_split_total;
    ELSIF v_paid > 0 THEN
      v_balance_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END;
      v_lines := v_lines || jsonb_build_object('account_key', v_balance_account,
        'debit', v_paid, 'credit', 0, 'note', p_invoice_number);
      v_dr := v_dr + v_paid;
    END IF;
    IF v_ar > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'ar',
        'debit', v_ar, 'credit', 0, 'customer_id', p_customer_id, 'note', p_invoice_number);
      v_dr := v_dr + v_ar;
    END IF;
    IF v_discount > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', v_discount, 'credit', 0);
      v_dr := v_dr + v_discount;
    END IF;
    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;
    END IF;
    IF v_tax > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', v_tax);
      v_cr := v_cr + v_tax;
    END IF;
    IF v_cogs_total > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'cogs', 'debit', v_cogs_total, 'credit', 0);
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', 0, 'credit', v_cogs_total);
      v_dr := v_dr + v_cogs_total;
      v_cr := v_cr + v_cogs_total;
    END IF;

    -- Balance any rounding/frontend discrepancy on the discount account so a
    -- posted entry is always balanced (normally the difference is zero).
    v_diff := round(v_dr - v_cr, 2);
    IF v_diff <> 0 THEN
      IF v_diff > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_diff);
      ELSE
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', -v_diff, 'credit', 0);
      END IF;
    END IF;

    PERFORM public._post_journal_entry(p_branch_id, 'sale', v_sale_id, p_invoice_number,
      'فاتورة مبيعات ' || p_invoice_number, v_lines);

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', p_invoice_number,
      'cogs', v_cogs_total);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'detail', SQLERRM);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$
;
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

    PERFORM set_config('app.pos_split_tenders',p_payments::text,true);
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
      'split',
      p_status,
      p_items,
      p_shift_id,
      p_order_type,
      p_table_id,
      p_order_id,
      p_guest_count
    );
    PERFORM set_config('app.pos_split_tenders','',true);

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

    -- Collection debit lines were posted by _process_sale_core before
    -- immutable journal evidence was created. No DELETE or UPDATE here.
    RETURN v_core || jsonb_build_object(
      'split', true,
      'payment_count', jsonb_array_length(p_payments),
      'paid_amount', v_sale_total
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$
;
