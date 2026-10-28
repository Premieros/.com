-- TEST-ONLY snapshot of EXISTING .com canonical functions; NEVER apply this file to a live project.
-- Source: hvqlkapynjfjikqithvd, read-only pg_get_functiondef, 2026-10-28.
CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway'::text, p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req_id uuid;
  v_result jsonb;
  v_email text;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_price numeric;
  v_mod jsonb;
  v_line_discount numeric;
  v_server_subtotal numeric(14,2) := 0;
  v_sale_id uuid;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_due numeric(14,2);
  v_header_discount numeric(14,2);
  v_effective_items jsonb := p_items;
  v_preview jsonb;
  v_remaining_unsent numeric(14,6) := 0;
  v_remaining_unsettled numeric(14,6) := 0;
  v_order_completed boolean := false;
  v_order_table uuid;
  v_order_owner uuid;
  v_order_paid numeric(14,2) := 0;
  v_order_total numeric(14,2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.payment.take') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.payment.take');
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF p_order_id IS NOT NULL THEN
    SELECT o.cashier_id
    INTO v_order_owner
    FROM public.orders o
    WHERE o.id = p_order_id
      AND o.branch_id = p_branch_id;

    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    IF v_order_owner IS DISTINCT FROM auth.uid() THEN
      PERFORM set_config('app.pos_action_authorized','1',true);
      PERFORM set_config('app.pos_action_actor_id',auth.uid()::text,true);
      PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
      PERFORM set_config('app.pos_action_permission','pos.payment.take',true);
    END IF;
  END IF;
  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.branch_id = p_branch_id
      AND s.status = 'open'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT');
  END IF;

  IF p_order_id IS NOT NULL THEN
    v_preview := public._build_order_settlement_preview(p_order_id);
    IF COALESCE((v_preview->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_preview;
    END IF;
    IF COALESCE((v_preview->>'pending_quantity')::numeric, 0) <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FULLY_SENT');
    END IF;
    v_effective_items := COALESCE(v_preview->'items', '[]'::jsonb);
  END IF;

  IF v_effective_items IS NULL OR jsonb_array_length(v_effective_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_effective_items) LOOP
    v_product_id := NULLIF(v_item->>'product_id','')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRODUCT');
    END IF;
    IF v_qty <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
    END IF;

    SELECT sale_price INTO v_price
    FROM public.products
    WHERE id = v_product_id
      AND branch_id = p_branch_id
      AND is_active = true;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
    END IF;

    v_mod := public.resolve_product_modifiers(
      v_product_id,
      p_branch_id,
      COALESCE(v_item->'modifier_option_ids', '[]'::jsonb)
    );
    IF COALESCE((v_mod->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_mod;
    END IF;

    v_price := GREATEST(COALESCE(v_price,0) + COALESCE((v_mod->>'price_delta')::numeric,0), 0);
    v_line_discount := ROUND(LEAST(
      GREATEST(COALESCE((v_item->>'discount_amount')::numeric,0),0),
      v_qty * v_price
    ),2);
    IF v_line_discount > 0 AND NOT public.can_permission('pos.discount') THEN
      RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED','action','discount','scope','line');
    END IF;
    v_server_subtotal := v_server_subtotal + ROUND(v_qty * v_price - v_line_discount, 2);
  END LOOP;

  v_server_subtotal := ROUND(v_server_subtotal, 2);
  v_header_discount := CASE WHEN p_order_id IS NOT NULL
    THEN LEAST(GREATEST(COALESCE((v_preview->>'discount_amount')::numeric, 0), 0), v_server_subtotal)
    ELSE LEAST(GREATEST(COALESCE(p_discount_amount, 0), 0), v_server_subtotal)
  END;

  SELECT t.tax_enabled, t.tax_rate
  INTO v_tax_enabled, v_tax_rate
  FROM public._effective_branch_tax(p_branch_id) t;

  v_due := ROUND(
    v_server_subtotal - v_header_discount +
    CASE WHEN COALESCE(v_tax_enabled,false)
      THEN ROUND((v_server_subtotal-v_header_discount)*COALESCE(v_tax_rate,0)/100,2)
      ELSE 0 END,
    2
  );

  IF p_order_id IS NOT NULL
     AND COALESCE(p_payment_method, 'cash') <> 'credit'
     AND ROUND(GREATEST(COALESCE(p_paid_amount,0),0),2) < v_due THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'FULL_PAYMENT_REQUIRED_FOR_SENT_ITEMS',
      'total_due', v_due,
      'paid_amount', ROUND(GREATEST(COALESCE(p_paid_amount,0),0),2)
    );
  END IF;

  IF v_header_discount > 0 AND NOT public.can_permission('pos.discount') THEN
    SELECT id INTO v_req_id
    FROM public.approval_requests
    WHERE requester_id = auth.uid()
      AND branch_id = p_branch_id
      AND action_type = 'discount'
      AND status = 'approved'
      AND expires_at > now()
      AND (entity_id IS NULL OR entity_id IS NOT DISTINCT FROM p_order_id)
      AND abs(COALESCE((payload->>'discount_amount')::numeric,-1) - v_header_discount) < 0.0001
    ORDER BY decided_at DESC NULLS LAST, created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_req_id IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED','action','discount');
    END IF;

    UPDATE public.approval_requests
    SET status='consumed', consumed_at=now()
    WHERE id=v_req_id;

    SELECT email INTO v_email FROM public.users WHERE id=auth.uid();
    INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)
    VALUES(
      auth.uid(),v_email,'APPROVAL_CONSUMED','approval_request',v_req_id,
      jsonb_build_object('action_type','discount','discount_amount',v_header_discount,'order_id',p_order_id),
      p_branch_id
    );
  END IF;

  IF p_order_id IS NOT NULL THEN
    v_result := public._prepare_kitchen_sale_settlement(
      p_order_id,
      p_branch_id,
      p_warehouse_id,
      v_effective_items
    );
    IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_result;
    END IF;

    SELECT table_id INTO v_order_table
    FROM public.orders
    WHERE id = p_order_id;
  END IF;

  -- Do not let _process_sale_core close the linked order. The outer function
  -- decides completion only after exact kitchen events are finalized.
  v_result := public._process_sale_core(
    p_invoice_number,
    p_branch_id,
    p_warehouse_id,
    p_customer_id,
    CASE WHEN p_order_id IS NOT NULL THEN v_order_owner ELSE auth.uid() END,
    v_server_subtotal,
    v_header_discount,
    CASE WHEN p_order_id IS NOT NULL THEN 'amount' ELSE COALESCE(p_discount_type, 'amount') END,
    0,
    p_bonus_amount,
    0,
    p_paid_amount,
    p_payment_method,
    p_status,
    v_effective_items,
    p_shift_id,
    p_order_type,
    p_table_id,
    NULL,
    p_guest_count
  );

  IF COALESCE((v_result->>'success')::boolean,false) IS TRUE AND p_shift_id IS NOT NULL THEN
    v_sale_id := NULLIF(v_result->>'sale_id','')::uuid;
    INSERT INTO public.shift_operations(
      shift_id, operation_type, amount, payment_method,
      reference_type, reference_id, created_by
    )
    SELECT p_shift_id, 'sale', s.paid_amount, s.payment_method, 'sale', s.id, auth.uid()
    FROM public.sales s
    WHERE s.id = v_sale_id
      AND s.branch_id = p_branch_id
      AND NOT EXISTS (
        SELECT 1 FROM public.shift_operations so
        WHERE so.reference_type = 'sale'
          AND so.reference_id = s.id
      );
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM set_config('app.kitchen_inventory_settlement','off',true);
    IF COALESCE((v_result->>'success')::boolean,false) IS TRUE THEN
      v_sale_id := NULLIF(v_result->>'sale_id','')::uuid;
      v_result := v_result || public._finalize_kitchen_sale_settlement(v_sale_id);

      SELECT COALESCE(sum(e.sent_quantity - e.voided_quantity),0)
      INTO v_remaining_unsettled
      FROM public.order_kitchen_inventory_events e
      WHERE e.order_id = p_order_id
        AND e.settled_sale_id IS NULL
        AND e.sent_quantity > e.voided_quantity;

      SELECT COALESCE(sum(GREATEST(oi.quantity - COALESCE(s.sent_quantity,0),0)),0)
      INTO v_remaining_unsent
      FROM public.order_items oi
      LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id;

      v_order_completed := v_remaining_unsettled <= 0.000001
                           AND v_remaining_unsent <= 0.000001;

      IF v_order_completed THEN
        UPDATE public.orders
        SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = p_order_id
          AND branch_id = p_branch_id
          AND status IN ('open','held');

        IF v_order_table IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.table_id = v_order_table
            AND o.status IN ('open','held')
            AND o.id <> p_order_id
        ) THEN
          UPDATE public.dining_tables
          SET status = 'vacant', updated_at = now()
          WHERE id = v_order_table;
        END IF;
      END IF;

      SELECT
        COALESCE(sum(s.paid_amount),0),
        COALESCE(sum(s.total),0)
      INTO v_order_paid, v_order_total
      FROM public.sales s
      WHERE s.id IN (
        SELECT DISTINCT e.settled_sale_id
        FROM public.order_kitchen_inventory_events e
        WHERE e.order_id = p_order_id
          AND e.settled_sale_id IS NOT NULL
      );

      UPDATE public.orders
      SET payment_status = CASE
            WHEN v_order_total > 0 AND v_order_paid >= v_order_total THEN
              CASE WHEN v_order_completed THEN 'paid' ELSE 'partial' END
            WHEN v_order_paid > 0 THEN 'partial'
            ELSE 'unpaid'
          END,
          payment_at = CASE WHEN v_order_paid > 0 THEN now() ELSE payment_at END,
          updated_at = now()
      WHERE id = p_order_id
        AND branch_id = p_branch_id;

      v_result := v_result || jsonb_build_object(
        'order_completed', v_order_completed,
        'remaining_unsent_quantity', v_remaining_unsent,
        'remaining_unsettled_quantity', v_remaining_unsettled
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$

CREATE OR REPLACE FUNCTION public.process_sale_idempotent(p_client_operation_key text, p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid, p_order_type text, p_table_id uuid, p_order_id uuid, p_guest_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := btrim(COALESCE(p_client_operation_key,''));
  v_request_hash text;
  v_existing private.pos_sale_idempotency%ROWTYPE;
  v_result jsonb;
  v_sale_id uuid;
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role',true),'')='service_role';
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_REQUIRED');
  END IF;

  IF char_length(v_key) < 16
     OR char_length(v_key) > 128
     OR v_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_CLIENT_OPERATION_KEY');
  END IF;

  IF NOT v_is_service_role THEN
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    END IF;
    IF NOT public.can_permission('pos.payment.take') THEN
      RETURN jsonb_build_object(
        'success',false,'error','PERMISSION_DENIED','permission','pos.payment.take'
      );
    END IF;
  END IF;

  -- The invoice number is deliberately excluded. A retry after an ambiguous
  -- network response may allocate a fresh display number before it learns that
  -- the original transaction committed. The operation key, actor and financial
  -- payload are the durable identity.
  v_request_hash := md5(jsonb_build_object(
    'branch_id',p_branch_id,
    'warehouse_id',p_warehouse_id,
    'customer_id',p_customer_id,
    'salesperson_id',p_salesperson_id,
    'subtotal',p_subtotal,
    'discount_amount',p_discount_amount,
    'discount_type',p_discount_type,
    'tax_amount',p_tax_amount,
    'bonus_amount',p_bonus_amount,
    'total',p_total,
    'paid_amount',p_paid_amount,
    'payment_method',p_payment_method,
    'status',p_status,
    'items',COALESCE(p_items,'[]'::jsonb),
    'shift_id',p_shift_id,
    'order_type',p_order_type,
    'table_id',p_table_id,
    'order_id',p_order_id,
    'guest_count',p_guest_count
  )::text);

  -- Serialize the exact logical attempt before checking/creating its sale.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('pos-sale:'||p_branch_id::text||':'||v_key,0)
  );

  SELECT *
  INTO v_existing
  FROM private.pos_sale_idempotency
  WHERE branch_id=p_branch_id
    AND operation_key=v_key;

  IF FOUND THEN
    IF v_existing.operation_kind <> 'normal'
       OR v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'
      );
    END IF;

    IF NOT v_is_service_role
       AND v_existing.created_by IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','IDEMPOTENCY_KEY_OWNER_MISMATCH'
      );
    END IF;

    RETURN v_existing.response || jsonb_build_object('idempotent_replay',true);
  END IF;

  v_result := public.process_sale(
    p_invoice_number := p_invoice_number,
    p_branch_id := p_branch_id,
    p_warehouse_id := p_warehouse_id,
    p_customer_id := p_customer_id,
    p_salesperson_id := p_salesperson_id,
    p_subtotal := p_subtotal,
    p_discount_amount := p_discount_amount,
    p_discount_type := p_discount_type,
    p_tax_amount := p_tax_amount,
    p_bonus_amount := p_bonus_amount,
    p_total := p_total,
    p_paid_amount := p_paid_amount,
    p_payment_method := p_payment_method,
    p_status := p_status,
    p_items := p_items,
    p_shift_id := p_shift_id,
    p_order_type := p_order_type,
    p_table_id := p_table_id,
    p_order_id := p_order_id,
    p_guest_count := p_guest_count
  );

  IF COALESCE((v_result->>'success')::boolean,false) THEN
    v_sale_id := NULLIF(v_result->>'sale_id','')::uuid;
    IF v_sale_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.sales s
         WHERE s.id=v_sale_id AND s.branch_id=p_branch_id
       ) THEN
      RAISE EXCEPTION 'IDEMPOTENT_SALE_RESULT_MISSING_DURABLE_SALE';
    END IF;

    v_result := v_result || jsonb_build_object(
      'invoice_number',COALESCE(NULLIF(v_result->>'invoice_number',''),p_invoice_number),
      'client_operation_key',v_key,
      'idempotent_replay',false
    );

    INSERT INTO private.pos_sale_idempotency(
      branch_id,operation_key,operation_kind,request_hash,sale_id,response,created_by
    )
    VALUES (
      p_branch_id,v_key,'normal',v_request_hash,v_sale_id,v_result,v_uid
    );
  ELSE
    v_result := COALESCE(v_result,'{}'::jsonb) || jsonb_build_object(
      'client_operation_key',v_key,
      'idempotent_replay',false
    );
  END IF;

  RETURN v_result;
END;
$function$

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
    IF v_paid > 0 THEN
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

CREATE OR REPLACE FUNCTION public._post_journal_entry(p_branch_id uuid, p_reference_type text, p_reference_id uuid, p_reference_number text, p_description text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account uuid;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'JOURNAL_EMPTY_LINES';
  END IF;

  -- Idempotency: never post a second entry for the same reference.
  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM public.journal_entries
    WHERE reference_type = p_reference_type AND reference_id = p_reference_id;
    IF v_entry_id IS NOT NULL THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: debit % <> credit %',
      round(v_total_debit, 2), round(v_total_credit, 2);
  END IF;

  v_entry_no := (public.next_document_number('journal')->>'number')::text;

  INSERT INTO public.journal_entries
    (entry_number, branch_id, entry_date, reference_type, reference_id, reference_number, description, created_by)
  VALUES (v_entry_no, p_branch_id, CURRENT_DATE, p_reference_type, p_reference_id,
          p_reference_number, p_description, auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    IF v_debit <= 0 AND v_credit <= 0 THEN CONTINUE; END IF;

    IF v_line ? 'account_key' THEN
      v_account := public.resolve_account_key(p_branch_id, v_line->>'account_key', v_line->>'account_code');
    ELSE
      SELECT id INTO v_account
      FROM public.chart_of_accounts
      WHERE branch_id = p_branch_id AND code = upper(btrim((v_line->>'account_code')::text));
    END IF;
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: %', COALESCE(v_line->>'account_key', v_line->>'account_code');
    END IF;

    INSERT INTO public.journal_entry_lines
      (journal_entry_id, account_id, debit, credit, customer_id, supplier_id, note)
    VALUES (v_entry_id, v_account, v_debit, v_credit,
            (v_line->>'customer_id')::uuid, (v_line->>'supplier_id')::uuid, v_line->>'note');
  END LOOP;

  PERFORM public.log_audit_action(p_branch_id, 'journal_post', 'journal_entry', v_entry_id,
    jsonb_build_object('entry_number', v_entry_no, 'reference_type', p_reference_type,
                       'reference_number', p_reference_number,
                       'debit_total', round(v_total_debit, 2), 'credit_total', round(v_total_credit, 2)));

  RETURN v_entry_id;
END;
$function$

CREATE OR REPLACE FUNCTION public.deduct_sale_inventory_with_modifiers(p_branch_id uuid, p_warehouse_id uuid, p_items jsonb, p_reference_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.kitchen_inventory_settlement', true), '') = 'on' THEN
    RETURN public._consume_kitchen_sale_settlement(
      p_branch_id, p_warehouse_id, p_items, p_reference_id, p_reference_number
    );
  END IF;
  RETURN public._deduct_sale_inventory_with_modifiers_core(
    p_branch_id, p_warehouse_id, p_items, p_reference_id, p_reference_number
  );
END;
$function$

CREATE OR REPLACE FUNCTION public._deduct_sale_inventory_with_modifiers_core(p_branch_id uuid, p_warehouse_id uuid, p_items jsonb, p_reference_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_link record;
  v_effect record;
  v_batch record;
  v_need numeric(14,6);
  v_take numeric(14,6);
  v_available numeric(14,6);
  v_total_cost numeric(18,4) := 0;
  v_units jsonb := '[]'::jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_oversold jsonb := '[]'::jsonb;
  v_user_branch uuid;
  v_recipe_id uuid;
  v_yield numeric(14,6);
  v_res jsonb;
  v_mod jsonb;
  v_recipe_component_count integer;
  v_link_count integer;
  v_auto_raw_id uuid;
  v_product_type text;
  v_base_ready boolean := false;
  v_allow_negative boolean := false;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN
    RETURN jsonb_build_object('success',true,'units_deducted','[]'::jsonb,'raw_materials_deducted','[]'::jsonb,'ready_products_deducted','[]'::jsonb,'raw_oversold','[]'::jsonb,'errors','[]'::jsonb);
  END IF;

  SELECT branch_id INTO v_user_branch FROM public.users WHERE id=auth.uid();
  IF NOT public.is_pos_admin() AND v_user_branch IS NOT NULL AND v_user_branch<>p_branch_id THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  v_allow_negative:=public.effective_allow_negative_stock(p_branch_id);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_unit_need(unit_id uuid PRIMARY KEY,unit_name text,unit_type text,required_qty numeric(14,6) NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_raw_need(raw_material_id uuid PRIMARY KEY,raw_name text,required_qty numeric(14,6) NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_ready_need(product_id uuid PRIMARY KEY,product_name text,required_qty numeric(14,6) NOT NULL) ON COMMIT DROP;
  TRUNCATE pg_temp.sale_unit_need; TRUNCATE pg_temp.sale_raw_need; TRUNCATE pg_temp.sale_ready_need;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::numeric,0);
    IF v_quantity<=0 THEN RETURN jsonb_build_object('success',false,'error','INVALID_QUANTITY','product_id',v_product_id); END IF;
    SELECT p.product_type INTO v_product_type
    FROM public.products p
    WHERE p.id=v_product_id AND p.branch_id=p_branch_id AND p.is_active=true;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'error','PRODUCT_NOT_IN_BRANCH','product_id',v_product_id);
    END IF;
    v_res := public.check_product_availability(
      v_product_id,
      p_branch_id,
      p_warehouse_id,
      v_quantity
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS TRUE THEN
      v_base_ready := COALESCE(v_res->>'mode','')='ready_product';
    ELSIF v_allow_negative THEN
      v_base_ready := (
        v_product_type='ready'
        OR EXISTS (
          SELECT 1
          FROM public.inventory_batches ib
          WHERE ib.product_id=v_product_id
            AND ib.branch_id=p_branch_id
            AND ib.warehouse_id=p_warehouse_id
        )
      );
    ELSE
      RETURN v_res;
    END IF;

    v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
    IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;

    IF v_base_ready THEN
      INSERT INTO pg_temp.sale_ready_need(product_id,product_name,required_qty)
      SELECT p.id,p.name,v_quantity FROM public.products p WHERE p.id=v_product_id
      ON CONFLICT(product_id) DO UPDATE SET required_qty=pg_temp.sale_ready_need.required_qty+EXCLUDED.required_qty;
    ELSE
    v_link_count:=0; v_recipe_component_count:=0; v_recipe_id:=NULL; v_yield:=NULL;

    SELECT COUNT(*) INTO v_link_count
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id=pul.unit_id
    WHERE pul.product_id=v_product_id AND iu.branch_id=p_branch_id AND iu.is_active=true;

    FOR v_link IN
      SELECT pul.unit_id,pul.quantity,iu.name AS unit_name,iu.unit_type
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu ON iu.id=pul.unit_id
      WHERE pul.product_id=v_product_id AND iu.branch_id=p_branch_id AND iu.is_active=true
    LOOP
      INSERT INTO pg_temp.sale_unit_need(unit_id,unit_name,unit_type,required_qty)
      VALUES(v_link.unit_id,v_link.unit_name,v_link.unit_type,v_quantity*v_link.quantity)
      ON CONFLICT(unit_id) DO UPDATE SET required_qty=pg_temp.sale_unit_need.required_qty+EXCLUDED.required_qty;
    END LOOP;

    SELECT r.id,COALESCE(NULLIF(r.yield_quantity,0),1) INTO v_recipe_id,v_yield
    FROM public.recipes r
    WHERE r.product_id=v_product_id AND r.branch_id=p_branch_id AND COALESCE(r.is_active,true)=true
    ORDER BY COALESCE(r.version,1) DESC,r.created_at DESC LIMIT 1;

    IF v_recipe_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.recipe_items ri
      JOIN public.raw_materials rm ON rm.id=ri.raw_material_id
      WHERE ri.recipe_id=v_recipe_id AND rm.branch_id<>p_branch_id
    ) THEN
      RETURN jsonb_build_object('success',false,'error','RAW_MATERIAL_NOT_IN_BRANCH','product_id',v_product_id);
    END IF;

    IF v_recipe_id IS NOT NULL THEN
      FOR v_link IN
        SELECT ri.raw_material_id,rm.name AS raw_name,ri.quantity/v_yield AS quantity_per_sale
        FROM public.recipe_items ri
        JOIN public.raw_materials rm ON rm.id=ri.raw_material_id
        WHERE ri.recipe_id=v_recipe_id
          AND NOT EXISTS (
            SELECT 1 FROM public.product_unit_links pul
            JOIN public.inventory_units iu ON iu.id=pul.unit_id
            WHERE pul.product_id=v_product_id AND iu.branch_id=p_branch_id AND iu.is_active=true
              AND regexp_replace(lower(btrim(iu.name)),'[ .]+$','','g')=regexp_replace(lower(btrim(rm.name)),'[ .]+$','','g')
          )
      LOOP
        v_recipe_component_count:=v_recipe_component_count+1;
        INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)
        VALUES(v_link.raw_material_id,v_link.raw_name,v_quantity*v_link.quantity_per_sale)
        ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;
      END LOOP;
    END IF;

    IF v_link_count=0 AND v_recipe_component_count=0 THEN
      v_auto_raw_id:=public._ensure_pos_fallback_product_raw(v_product_id,p_branch_id);
      INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)
      SELECT rm.id,rm.name,v_quantity FROM public.raw_materials rm WHERE rm.id=v_auto_raw_id
      ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;
    END IF;
    END IF;

    FOR v_effect IN
      SELECT o.id AS option_id
      FROM public.product_modifier_options o
      JOIN public.product_modifier_groups g ON g.id=o.group_id AND g.is_active=true
      JOIN public.product_modifier_group_products gp ON gp.group_id=g.id AND gp.product_id=v_product_id AND gp.branch_id=p_branch_id
      WHERE o.branch_id=p_branch_id AND o.is_active=true AND o.price_delta>0
        AND o.id IN (SELECT NULLIF(value,'')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids','[]'::jsonb)))
    LOOP
      PERFORM public._ensure_pos_fallback_modifier_raw(v_effect.option_id,p_branch_id);
    END LOOP;

    FOR v_effect IN
      SELECT e.target_type,e.raw_material_id,e.inventory_unit_id,e.quantity_delta,rm.name AS raw_name,iu.name AS unit_name,iu.unit_type
      FROM public.product_modifier_inventory_effects e
      JOIN public.product_modifier_options o ON o.id=e.option_id AND o.is_active=true
      JOIN public.product_modifier_groups g ON g.id=o.group_id AND g.is_active=true
      JOIN public.product_modifier_group_products gp ON gp.group_id=g.id AND gp.product_id=v_product_id AND gp.branch_id=p_branch_id
      LEFT JOIN public.raw_materials rm ON rm.id=e.raw_material_id
      LEFT JOIN public.inventory_units iu ON iu.id=e.inventory_unit_id
      WHERE g.branch_id=p_branch_id AND e.branch_id=p_branch_id
        AND o.id IN (SELECT NULLIF(value,'')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids','[]'::jsonb)))
    LOOP
      IF v_effect.target_type='raw_material' THEN
        INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)
        VALUES(v_effect.raw_material_id,v_effect.raw_name,v_quantity*v_effect.quantity_delta)
        ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;
      ELSE
        INSERT INTO pg_temp.sale_unit_need(unit_id,unit_name,unit_type,required_qty)
        VALUES(v_effect.inventory_unit_id,v_effect.unit_name,v_effect.unit_type,v_quantity*v_effect.quantity_delta)
        ON CONFLICT(unit_id) DO UPDATE SET required_qty=pg_temp.sale_unit_need.required_qty+EXCLUDED.required_qty;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS(SELECT 1 FROM pg_temp.sale_unit_need WHERE required_qty<0) OR EXISTS(SELECT 1 FROM pg_temp.sale_raw_need WHERE required_qty<0) THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_MODIFIER_INVENTORY_EFFECT','detail','Modifier removal exceeds the base component quantity.');
  END IF;

  -- Strict mode validates all non-manufactured requirements before the first
  -- stock mutation so an explicit failure cannot leave a partial deduction.
  IF NOT v_allow_negative THEN
    FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty>0 ORDER BY product_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.inventory_batches
      WHERE product_id=v_link.product_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_READY_PRODUCT_STOCK','product_id',v_link.product_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;

    FOR v_link IN SELECT * FROM pg_temp.sale_raw_need WHERE required_qty>0 ORDER BY raw_material_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.raw_material_batches
      WHERE raw_material_id=v_link.raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_RAW_MATERIAL_STOCK','raw_material_id',v_link.raw_material_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;

    FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type<>'manufactured' ORDER BY unit_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.inventory_unit_batches
      WHERE unit_id=v_link.unit_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_UNIT_STOCK','unit_id',v_link.unit_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;
  END IF;

  FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty>0 ORDER BY product_id
  LOOP
    v_res:=public._deduct_ready_product_stock_policy(
      v_link.product_id,p_branch_id,p_warehouse_id,v_link.required_qty,
      p_reference_id,p_reference_number,v_allow_negative
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
    v_ready:=v_ready||jsonb_build_object(
      'product_id',v_link.product_id,
      'product_name',v_link.product_name,
      'quantity',v_link.required_qty,
      'oversold',COALESCE((v_res->>'oversold')::numeric,0)
    );
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type='manufactured' ORDER BY unit_id
  LOOP
    IF v_allow_negative THEN
      BEGIN
        PERFORM public._ensure_inventory_unit_stock(v_link.unit_id,v_link.required_qty,p_warehouse_id,p_branch_id,0);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    ELSE
      PERFORM public._ensure_inventory_unit_stock(v_link.unit_id,v_link.required_qty,p_warehouse_id,p_branch_id,0);
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 ORDER BY unit_id
  LOOP
    v_res:=public._deduct_inventory_unit_stock_policy(
      v_link.unit_id,p_branch_id,p_warehouse_id,v_link.required_qty,
      p_reference_id,p_reference_number,v_allow_negative
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
    v_units:=v_units||jsonb_build_object(
      'unit_id',v_link.unit_id,
      'unit_name',v_link.unit_name,
      'unit_type',v_link.unit_type,
      'quantity',v_link.required_qty,
      'oversold',COALESCE((v_res->>'oversold')::numeric,0)
    );
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_raw_need WHERE required_qty>0 ORDER BY raw_material_id
  LOOP
    v_res:=private.apply_unified_raw_movement_v1(
      gen_random_uuid(),p_branch_id,p_warehouse_id,v_link.raw_material_id,
      -v_link.required_qty,'sale','sale',p_reference_id,p_reference_number,
      auth.uid(),v_allow_negative
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'SALE_RAW_MOVEMENT_FAILED material=% response=%',v_link.raw_material_id,v_res;
    END IF;
    v_res:=v_res||jsonb_build_object(
      'total_cost',abs(COALESCE((v_res->>'total_cost')::numeric,0)),
      'oversold',GREATEST(v_link.required_qty-GREATEST(COALESCE((v_res->>'before_qty')::numeric,0),0),0)
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    IF COALESCE((v_res->>'shortage')::numeric,0)>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','INSUFFICIENT_RAW_MATERIAL_STOCK',
        'raw_material_id',v_link.raw_material_id,
        'required',v_link.required_qty,
        'shortage',COALESCE((v_res->>'shortage')::numeric,0)
      );
    END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
    v_raws:=v_raws||jsonb_build_object('raw_material_id',v_link.raw_material_id,'raw_name',v_link.raw_name,'quantity',v_link.required_qty,'total_cost',COALESCE((v_res->>'total_cost')::numeric,0));
    IF COALESCE((v_res->>'oversold')::numeric,0)>0 THEN
      v_oversold:=v_oversold||jsonb_build_object('raw_material_id',v_link.raw_material_id,'raw_name',v_link.raw_name,'quantity',COALESCE((v_res->>'oversold')::numeric,0),'total_cost',0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success',true,'units_deducted',v_units,'raw_materials_deducted',v_raws,'ready_products_deducted',v_ready,'raw_oversold',v_oversold,'total_cost',v_total_cost,'errors','[]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','SALE_INVENTORY_DEDUCTION_FAILED','detail',SQLERRM);
END;
$function$

CREATE OR REPLACE FUNCTION public._deduct_ready_product_stock_policy(p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_reference_id uuid, p_reference_number text, p_allow_negative boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_available numeric(18,6):=0;
  v_running numeric(18,6):=0;
  v_need numeric(18,6);
  v_take numeric(18,6);
  v_total_cost numeric(18,6):=0;
  v_removed numeric(18,6):=0;
  v_oversold numeric(18,6):=0;
  v_batch record;
  v_debt_batch text;
  v_debt_batch_id uuid;
  v_catalog_cost numeric(18,6);
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN
    RETURN jsonb_build_object('success',true,'removed',0,'oversold',0,'total_cost',0);
  END IF;

  IF p_warehouse_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('product:'||p_product_id::text||':'||p_warehouse_id::text,0)
  );

  SELECT COALESCE(cost_price,0) INTO v_catalog_cost FROM public.products WHERE id=p_product_id AND branch_id=p_branch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','PRODUCT_NOT_FOUND'); END IF;

  SELECT COALESCE(SUM(quantity),0)
  INTO v_available
  FROM public.inventory_batches
  WHERE product_id=p_product_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  IF NOT COALESCE(p_allow_negative,false) AND v_available<p_qty THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','INSUFFICIENT_READY_PRODUCT_STOCK',
      'product_id',p_product_id,
      'required',p_qty,
      'available',v_available
    );
  END IF;

  v_running:=v_available;
  v_need:=p_qty;

  FOR v_batch IN
    SELECT id,quantity,unit_cost,batch_number
    FROM public.inventory_batches
    WHERE product_id=p_product_id
      AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id
      AND quantity>0
    ORDER BY quantity DESC,id
    FOR UPDATE
  LOOP
    EXIT WHEN v_need<=0;
    v_take:=LEAST(v_need,v_batch.quantity);

    UPDATE public.inventory_batches
    SET quantity=quantity-v_take
    WHERE id=v_batch.id;

    INSERT INTO public.inventory_ledger(
      product_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_product_id,p_branch_id,p_warehouse_id,v_batch.batch_number,
      -v_take,v_catalog_cost,-v_take*v_catalog_cost,
      v_running,v_running-v_take,
      'sale','sale',p_reference_id,p_reference_number,auth.uid()
    );

    INSERT INTO public.stock_transactions(
      product_id,warehouse_id,branch_id,transaction_type,component_flow,
      reference_type,reference_id,quantity,before_quantity,after_quantity,
      unit_cost,created_by
    ) VALUES (
      p_product_id,p_warehouse_id,p_branch_id,'sale',false,
      'sale',p_reference_id,-v_take,v_running,v_running-v_take,
      v_catalog_cost,auth.uid()
    );

    v_running:=v_running-v_take;
    v_need:=v_need-v_take;
    v_removed:=v_removed+v_take;
    v_total_cost:=v_total_cost+v_take*v_catalog_cost;
  END LOOP;

  IF v_need>0 THEN
    IF NOT COALESCE(p_allow_negative,false) THEN
      RAISE EXCEPTION 'INSUFFICIENT_READY_PRODUCT_STOCK product=% required=% available=%',
        p_product_id,p_qty,v_available;
    END IF;

    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    INSERT INTO public.inventory_batches(
      product_id,warehouse_id,branch_id,batch_number,quantity,unit_cost,
      source_type,source_id
    ) VALUES (
      p_product_id,p_warehouse_id,p_branch_id,v_debt_batch,-v_need,0,
      'sale_oversold',p_reference_id
    )
    RETURNING id INTO v_debt_batch_id;

    INSERT INTO public.inventory_ledger(
      product_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_product_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_need,0,0,v_running,v_running-v_need,
      'sale','sale',p_reference_id,p_reference_number,auth.uid()
    );

    INSERT INTO public.stock_transactions(
      product_id,warehouse_id,branch_id,transaction_type,component_flow,
      reference_type,reference_id,quantity,before_quantity,after_quantity,
      unit_cost,created_by
    ) VALUES (
      p_product_id,p_warehouse_id,p_branch_id,'sale',false,
      'sale',p_reference_id,-v_need,v_running,v_running-v_need,0,auth.uid()
    );

    INSERT INTO public.product_stock_debts(
      product_id,branch_id,warehouse_id,sale_id,reference_number,
      oversold_batch_id,debt_quantity
    ) VALUES (
      p_product_id,p_branch_id,p_warehouse_id,p_reference_id,p_reference_number,
      v_debt_batch_id,v_need
    );

    v_running:=v_running-v_need;
    v_oversold:=v_need;
    v_need:=0;
  END IF;

  INSERT INTO public.inventory(
    product_id,warehouse_id,branch_id,quantity,updated_at
  ) VALUES (
    p_product_id,p_warehouse_id,p_branch_id,v_running,now()
  )
  ON CONFLICT(product_id,warehouse_id) DO UPDATE
  SET quantity=EXCLUDED.quantity,
      branch_id=EXCLUDED.branch_id,
      updated_at=now();

  RETURN jsonb_build_object(
    'success',true,
    'removed',v_removed,
    'oversold',v_oversold,
    'total_cost',v_total_cost,
    'after_qty',v_running
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.check_product_availability(p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_quantity numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_recipe_id uuid;
  v_yield numeric := 1;
  v_link_count integer := 0;
  v_direct_raw_count integer := 0;
  v_row record;
  v_delta numeric;
  v_available numeric;
  v_remaining_stock numeric;
  v_cover numeric;
  v_shortage numeric;
  v_unit_type text;
  v_iter integer := 0;
  v_ready numeric;
BEGIN
  IF COALESCE(current_setting('role', true), '') = 'authenticated' THEN
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.id = p_warehouse_id
        AND w.branch_id = p_branch_id
        AND w.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
    END IF;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.branch_id = p_branch_id
      AND p.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH');
  END IF;

  SELECT COALESCE(SUM(ib.quantity), 0)
  INTO v_ready
  FROM public.inventory_batches ib
  WHERE ib.product_id = p_product_id
    AND ib.branch_id = p_branch_id
    AND ib.warehouse_id = p_warehouse_id
    AND ib.quantity > 0;

  IF v_ready >= p_quantity THEN
    RETURN jsonb_build_object(
      'success', true,
      'required', p_quantity,
      'available', v_ready,
      'mode', 'ready_product'
    );
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.avail_raw_need(
    raw_material_id uuid PRIMARY KEY,
    required_qty numeric NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.avail_unit_need(
    unit_id uuid PRIMARY KEY,
    required_qty numeric NOT NULL DEFAULT 0,
    processed_qty numeric NOT NULL DEFAULT 0,
    stock_used numeric NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  TRUNCATE pg_temp.avail_raw_need;
  TRUNCATE pg_temp.avail_unit_need;

  INSERT INTO pg_temp.avail_unit_need(unit_id, required_qty)
  SELECT grouped.unit_id, grouped.required_qty
  FROM (
    SELECT pul.unit_id, SUM(p_quantity * pul.quantity) AS required_qty
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id = pul.unit_id
    WHERE pul.product_id = p_product_id
      AND iu.branch_id = p_branch_id
      AND iu.is_active = true
    GROUP BY pul.unit_id
  ) grouped
  ON CONFLICT(unit_id) DO UPDATE
  SET required_qty = pg_temp.avail_unit_need.required_qty + EXCLUDED.required_qty;
  GET DIAGNOSTICS v_link_count = ROW_COUNT;

  SELECT r.id, COALESCE(NULLIF(r.yield_quantity, 0), 1)
  INTO v_recipe_id, v_yield
  FROM public.recipes r
  WHERE r.product_id = p_product_id
    AND r.branch_id = p_branch_id
    AND COALESCE(r.is_active, true) = true
  ORDER BY COALESCE(r.version, 1) DESC, r.created_at DESC
  LIMIT 1;

  IF v_recipe_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.recipe_items ri
    WHERE ri.recipe_id = v_recipe_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.raw_materials rm
        WHERE rm.id = ri.raw_material_id
          AND rm.branch_id = p_branch_id
          AND rm.is_active = true
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'RAW_MATERIAL_NOT_IN_BRANCH',
      'recipe_id', v_recipe_id
    );
  END IF;

  IF v_recipe_id IS NOT NULL THEN
    INSERT INTO pg_temp.avail_raw_need(raw_material_id, required_qty)
    SELECT grouped.raw_material_id, grouped.required_qty
    FROM (
      SELECT
        ri.raw_material_id,
        SUM(p_quantity * (ri.quantity / v_yield)) AS required_qty
      FROM public.recipe_items ri
      JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = v_recipe_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.product_unit_links pul
          JOIN public.inventory_units iu ON iu.id = pul.unit_id
          WHERE pul.product_id = p_product_id
            AND iu.branch_id = p_branch_id
            AND iu.is_active = true
            AND regexp_replace(lower(btrim(iu.name)), '[ .]+$', '', 'g') =
                regexp_replace(lower(btrim(rm.name)), '[ .]+$', '', 'g')
        )
      GROUP BY ri.raw_material_id
    ) grouped
    ON CONFLICT(raw_material_id) DO UPDATE
    SET required_qty = pg_temp.avail_raw_need.required_qty + EXCLUDED.required_qty;
    GET DIAGNOSTICS v_direct_raw_count = ROW_COUNT;
  END IF;

  IF v_link_count = 0 AND v_direct_raw_count = 0 THEN
    RETURN jsonb_build_object(
      'success', v_ready >= p_quantity,
      'error', CASE WHEN v_ready >= p_quantity THEN NULL ELSE 'INSUFFICIENT_PRODUCT_STOCK' END,
      'required', p_quantity,
      'available', v_ready,
      'mode', 'ready_product'
    );
  END IF;

  LOOP
    SELECT *
    INTO v_row
    FROM pg_temp.avail_unit_need
    WHERE required_qty > processed_qty + 0.0000001
    ORDER BY unit_id
    LIMIT 1;
    EXIT WHEN NOT FOUND;

    v_iter := v_iter + 1;
    IF v_iter > 1000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNIT_RECIPE_CYCLE_OR_TOO_DEEP');
    END IF;

    v_delta := v_row.required_qty - v_row.processed_qty;

    SELECT iu.unit_type
    INTO v_unit_type
    FROM public.inventory_units iu
    WHERE iu.id = v_row.unit_id
      AND iu.branch_id = p_branch_id
      AND iu.is_active = true;

    IF v_unit_type IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INVENTORY_UNIT_NOT_AVAILABLE',
        'unit_id', v_row.unit_id
      );
    END IF;

    SELECT COALESCE(SUM(iub.quantity), 0)
    INTO v_available
    FROM public.inventory_unit_batches iub
    WHERE iub.unit_id = v_row.unit_id
      AND iub.branch_id = p_branch_id
      AND iub.warehouse_id = p_warehouse_id
      AND iub.quantity > 0;

    v_remaining_stock := GREATEST(v_available - v_row.stock_used, 0);
    v_cover := LEAST(v_delta, v_remaining_stock);
    v_shortage := GREATEST(v_delta - v_cover, 0);

    UPDATE pg_temp.avail_unit_need
    SET processed_qty = processed_qty + v_delta,
        stock_used = stock_used + v_cover
    WHERE unit_id = v_row.unit_id;

    IF v_shortage > 0 THEN
      IF v_unit_type <> 'manufactured' THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_UNIT_STOCK',
          'unit_id', v_row.unit_id,
          'required', v_row.required_qty,
          'available', v_available
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.inventory_unit_recipes WHERE unit_id = v_row.unit_id
      ) AND NOT EXISTS (
        SELECT 1 FROM public.inventory_unit_recipe_units WHERE unit_id = v_row.unit_id
      ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'MANUFACTURED_UNIT_HAS_NO_RECIPE',
          'unit_id', v_row.unit_id
        );
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.inventory_unit_recipes iur
        WHERE iur.unit_id = v_row.unit_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.raw_materials rm
            WHERE rm.id = iur.raw_material_id
              AND rm.branch_id = p_branch_id
              AND rm.is_active = true
          )
      ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'RAW_MATERIAL_NOT_IN_BRANCH',
          'unit_id', v_row.unit_id
        );
      END IF;

      INSERT INTO pg_temp.avail_raw_need(raw_material_id, required_qty)
      SELECT grouped.raw_material_id, grouped.required_qty
      FROM (
        SELECT
          iur.raw_material_id,
          SUM(v_shortage * iur.quantity * (1 + COALESCE(iur.wastage_percent, 0) / 100.0)) AS required_qty
        FROM public.inventory_unit_recipes iur
        WHERE iur.unit_id = v_row.unit_id
        GROUP BY iur.raw_material_id
      ) grouped
      ON CONFLICT(raw_material_id) DO UPDATE
      SET required_qty = pg_temp.avail_raw_need.required_qty + EXCLUDED.required_qty;

      INSERT INTO pg_temp.avail_unit_need(unit_id, required_qty)
      SELECT grouped.component_unit_id, grouped.required_qty
      FROM (
        SELECT
          iuru.component_unit_id,
          SUM(v_shortage * iuru.quantity * (1 + COALESCE(iuru.wastage_percent, 0) / 100.0)) AS required_qty
        FROM public.inventory_unit_recipe_units iuru
        WHERE iuru.unit_id = v_row.unit_id
        GROUP BY iuru.component_unit_id
      ) grouped
      ON CONFLICT(unit_id) DO UPDATE
      SET required_qty = pg_temp.avail_unit_need.required_qty + EXCLUDED.required_qty;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT * FROM pg_temp.avail_raw_need ORDER BY raw_material_id
  LOOP
    SELECT COALESCE(SUM(b.quantity), 0)
    INTO v_available
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = v_row.raw_material_id
      AND b.branch_id = p_branch_id
      AND b.warehouse_id = p_warehouse_id;
    IF v_available + 0.0000001 < v_row.required_qty THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_RAW_MATERIAL_STOCK',
        'raw_material_id', v_row.raw_material_id,
        'required', v_row.required_qty,
        'available', v_available
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'mode', 'recipe', 'quantity', p_quantity);
END;
$function$

CREATE OR REPLACE FUNCTION public.resolve_account_key(p_branch_id uuid, p_key text, p_fallback_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account uuid;
BEGIN
  IF p_key IS NOT NULL THEN
    SELECT account_id INTO v_account
    FROM public.account_mappings
    WHERE branch_id = p_branch_id AND semantic_key = btrim(p_key);
    IF v_account IS NOT NULL THEN
      RETURN v_account;
    END IF;
  END IF;

  IF p_fallback_code IS NOT NULL THEN
    SELECT id INTO v_account
    FROM public.chart_of_accounts
    WHERE branch_id = p_branch_id AND code = upper(btrim(p_fallback_code));
    IF v_account IS NOT NULL THEN
      RETURN v_account;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$
