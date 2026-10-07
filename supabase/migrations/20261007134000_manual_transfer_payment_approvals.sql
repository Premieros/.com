-- Manual InstaPay / bank transfer confirmation flow for POS.
-- Transfer payment is approved before the authoritative sale is committed.

ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS manual_transfer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS instapay_handle text,
  ADD COLUMN IF NOT EXISTS bank_transfer_details text;

ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS confirmation_request_id uuid REFERENCES public.approval_requests(id),
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sale_payments_confirmation_request
  ON public.sale_payments(confirmation_request_id)
  WHERE confirmation_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.request_manual_payment_approval(
  p_branch_id uuid,
  p_method text,
  p_amount numeric,
  p_reference text,
  p_sender_name text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_method text := lower(btrim(COALESCE(p_method, '')));
  v_reference text := btrim(COALESCE(p_reference, ''));
  v_sender text := NULLIF(btrim(COALESCE(p_sender_name, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_request_id uuid;
  v_payload jsonb;
  v_enabled boolean;
  v_instapay text;
  v_bank text;
  v_user public.users%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = auth.uid() AND is_active = true;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('pos.payment.take') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.payment.take');
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_method NOT IN ('instapay', 'bank_transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYMENT_METHOD');
  END IF;

  IF p_amount IS NULL OR round(p_amount, 2) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;

  IF length(v_reference) < 3 OR length(v_reference) > 120 THEN
    RETURN jsonb_build_object('success', false, 'error', 'REFERENCE_REQUIRED');
  END IF;

  SELECT
    COALESCE(bs.manual_transfer_enabled, false),
    NULLIF(btrim(COALESCE(bs.instapay_handle, '')), ''),
    NULLIF(btrim(COALESCE(bs.bank_transfer_details, '')), '')
  INTO v_enabled, v_instapay, v_bank
  FROM public.branch_settings bs
  WHERE bs.branch_id = p_branch_id;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'MANUAL_TRANSFER_DISABLED');
  END IF;

  IF v_method = 'instapay' AND v_instapay IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSTAPAY_NOT_CONFIGURED');
  END IF;

  IF v_method = 'bank_transfer' AND v_bank IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BANK_TRANSFER_NOT_CONFIGURED');
  END IF;

  v_payload := jsonb_build_object(
    'branch_id', p_branch_id,
    'payment_method', v_method,
    'amount', round(p_amount, 2),
    'reference', v_reference,
    'sender_name', v_sender,
    'note', v_note
  );

  SELECT ar.id INTO v_request_id
  FROM public.approval_requests ar
  WHERE ar.branch_id = p_branch_id
    AND ar.requester_id = auth.uid()
    AND ar.action_type = 'confirm_manual_payment'
    AND ar.entity_type = 'payment'
    AND ar.entity_id IS NULL
    AND ar.payload = v_payload
    AND ar.status IN ('pending', 'approved')
    AND ar.expires_at > now()
  ORDER BY ar.created_at DESC
  LIMIT 1;

  IF v_request_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'request_id', v_request_id,
      'status', (
        SELECT status FROM public.approval_requests WHERE id = v_request_id
      ),
      'duplicate', true
    );
  END IF;

  INSERT INTO public.approval_requests(
    branch_id,
    requester_id,
    action_type,
    entity_type,
    entity_id,
    payload,
    reason
  )
  VALUES(
    p_branch_id,
    auth.uid(),
    'confirm_manual_payment',
    'payment',
    NULL,
    v_payload,
    CASE v_method
      WHEN 'instapay' THEN 'Confirm InstaPay payment'
      ELSE 'Confirm bank transfer payment'
    END
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.audit_log(
    user_id, user_email, action, entity, entity_id, details, branch_id
  )
  VALUES(
    auth.uid(),
    v_user.email,
    'MANUAL_PAYMENT_APPROVAL_REQUESTED',
    'approval_request',
    v_request_id,
    v_payload,
    p_branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'status', 'pending',
    'expires_in_seconds', 600
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.manual_payment_approval_status(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req public.approval_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_req
  FROM public.approval_requests
  WHERE id = p_request_id
    AND action_type = 'confirm_manual_payment'
    AND entity_type = 'payment';

  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_FOUND');
  END IF;

  IF v_req.requester_id <> auth.uid()
     AND NOT (
       public.user_may_access_branch(v_req.branch_id)
       AND public.can_permission('approvals.review')
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_req.id,
    'status', CASE
      WHEN v_req.status = 'pending' AND v_req.expires_at <= now() THEN 'expired'
      ELSE v_req.status
    END,
    'payload', v_req.payload,
    'expires_at', v_req.expires_at,
    'approver_id', v_req.approver_id,
    'decision_note', v_req.decision_note
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_sale_manual_payment(
  p_approval_request_id uuid,
  p_manual_reference text,
  p_invoice_number text,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_customer_id uuid,
  p_salesperson_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_type text,
  p_tax_amount numeric,
  p_bonus_amount numeric,
  p_total numeric,
  p_payment_method text,
  p_status text,
  p_items jsonb,
  p_shift_id uuid DEFAULT NULL,
  p_order_type text DEFAULT 'takeaway',
  p_table_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_guest_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req public.approval_requests%ROWTYPE;
  v_method text := lower(btrim(COALESCE(p_payment_method, '')));
  v_reference text := btrim(COALESCE(p_manual_reference, ''));
  v_approved_amount numeric(14,2);
  v_result jsonb;
  v_sale public.sales%ROWTYPE;
BEGIN
  BEGIN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    IF v_method NOT IN ('instapay', 'bank_transfer') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYMENT_METHOD');
    END IF;

    IF NOT public.can_permission('pos.payment.take') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.payment.take');
    END IF;

    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    SELECT * INTO v_req
    FROM public.approval_requests
    WHERE id = p_approval_request_id
    FOR UPDATE;

    IF v_req.id IS NULL
       OR v_req.action_type <> 'confirm_manual_payment'
       OR v_req.entity_type <> 'payment'
       OR v_req.requester_id <> auth.uid()
       OR v_req.branch_id <> p_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYMENT_APPROVAL');
    END IF;

    IF v_req.status <> 'approved' THEN
      RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_APPROVAL_REQUIRED', 'status', v_req.status);
    END IF;

    IF v_req.expires_at <= now() THEN
      UPDATE public.approval_requests
      SET status = 'expired', decided_at = COALESCE(decided_at, now())
      WHERE id = v_req.id;
      RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_APPROVAL_EXPIRED');
    END IF;

    IF v_req.consumed_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_APPROVAL_ALREADY_CONSUMED');
    END IF;

    v_approved_amount := round(COALESCE((v_req.payload->>'amount')::numeric, 0), 2);

    IF COALESCE(v_req.payload->>'payment_method', '') <> v_method
       OR COALESCE(v_req.payload->>'reference', '') <> v_reference
       OR v_approved_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_APPROVAL_SCOPE_MISMATCH');
    END IF;

    v_result := public.process_sale(
      p_invoice_number,
      p_branch_id,
      p_warehouse_id,
      p_customer_id,
      p_salesperson_id,
      p_subtotal,
      p_discount_amount,
      p_discount_type,
      p_tax_amount,
      p_bonus_amount,
      p_total,
      v_approved_amount,
      v_method,
      p_status,
      p_items,
      p_shift_id,
      p_order_type,
      p_table_id,
      p_order_id,
      p_guest_count
    );

    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_result;
    END IF;

    SELECT * INTO v_sale
    FROM public.sales
    WHERE id = NULLIF(v_result->>'sale_id', '')::uuid
      AND branch_id = p_branch_id
    FOR UPDATE;

    IF v_sale.id IS NULL THEN
      RAISE EXCEPTION 'MANUAL_PAYMENT_SALE_NOT_FOUND';
    END IF;

    IF abs(round(v_sale.total, 2) - v_approved_amount) > 0.01
       OR abs(round(v_sale.paid_amount, 2) - v_approved_amount) > 0.01 THEN
      RAISE EXCEPTION 'MANUAL_PAYMENT_AMOUNT_MISMATCH';
    END IF;

    INSERT INTO public.sale_payments(
      sale_id,
      branch_id,
      payment_method,
      amount,
      created_by,
      reference_number,
      confirmation_request_id,
      confirmed_by,
      confirmed_at
    )
    VALUES(
      v_sale.id,
      p_branch_id,
      v_method,
      v_approved_amount,
      auth.uid(),
      v_reference,
      v_req.id,
      v_req.approver_id,
      COALESCE(v_req.decided_at, now())
    );

    UPDATE public.approval_requests
    SET status = 'consumed',
        consumed_at = now()
    WHERE id = v_req.id;

    INSERT INTO public.audit_log(
      user_id, action, entity, entity_id, details, branch_id
    )
    VALUES(
      auth.uid(),
      'MANUAL_PAYMENT_CONFIRMED_SALE',
      'sale',
      v_sale.id,
      jsonb_build_object(
        'approval_request_id', v_req.id,
        'payment_method', v_method,
        'amount', v_approved_amount,
        'reference', v_reference,
        'confirmed_by', v_req.approver_id
      ),
      p_branch_id
    );

    RETURN v_result || jsonb_build_object(
      'manual_payment', true,
      'payment_method', v_method,
      'payment_reference', v_reference,
      'approval_request_id', v_req.id
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TRANSACTION_FAILED',
      'detail', SQLERRM
    );
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_manual_payment_approval(uuid,text,numeric,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manual_payment_approval_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale_manual_payment(
  uuid,text,text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.request_manual_payment_approval(uuid,text,numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manual_payment_approval_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale_manual_payment(
  uuid,text,text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.request_manual_payment_approval(uuid,text,numeric,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.manual_payment_approval_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_sale_manual_payment(
  uuid,text,text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer
) TO service_role;
