CREATE TABLE qr_private.delivery_fees (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  sale_id uuid UNIQUE REFERENCES public.sales(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qr_private.delivery_fees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_private.delivery_fees FROM PUBLIC, anon, authenticated;
ALTER TABLE public.sales ADD COLUMN delivery_fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee_amount >= 0);

CREATE FUNCTION qr_private.order_delivery_fee(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; f qr_private.delivery_fees;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order;
 IF o.id IS NULL OR o.order_type<>'delivery' THEN RETURN '{}'::jsonb; END IF;
 PERFORM qr_private.require_staff(o.branch_id,'pos.view');
 SELECT * INTO f FROM qr_private.delivery_fees WHERE order_id=o.id;
 RETURN jsonb_build_object('amount',f.amount,'collected',f.sale_id IS NOT NULL);
END $$;

CREATE FUNCTION qr_private.save_order_delivery_fee(p_order uuid,p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; f qr_private.delivery_fees; previous_amount numeric;
BEGIN
 IF p_amount IS NULL OR NOT (p_amount BETWEEN 0 AND 999999 AND p_amount=round(p_amount,2)) THEN
  RAISE EXCEPTION 'INVALID_DELIVERY_FEE';
 END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order AND order_type='delivery' AND status IN ('open','held') FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'DELIVERY_ORDER_UNAVAILABLE'; END IF;
 PERFORM qr_private.require_staff(o.branch_id,'pos.order.edit');
 IF o.cashier_id IS DISTINCT FROM auth.uid() AND NOT public.can_manage_other_pos_orders() THEN
  RAISE EXCEPTION 'QR_ORDER_OPERATOR_REQUIRED';
 END IF;
 SELECT * INTO f FROM qr_private.delivery_fees WHERE order_id=o.id;
 IF f.sale_id IS NOT NULL THEN RAISE EXCEPTION 'DELIVERY_FEE_ALREADY_COLLECTED'; END IF;
 previous_amount:=f.amount;
 INSERT INTO qr_private.delivery_fees(order_id,amount) VALUES(o.id,p_amount)
 ON CONFLICT(order_id) DO UPDATE SET amount=excluded.amount,updated_at=now();
 INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)
 SELECT auth.uid(),u.email,'DELIVERY_FEE_UPDATE','order',o.id,
   jsonb_build_object('previous_amount',previous_amount,'amount',p_amount),o.branch_id
 FROM public.users u WHERE u.id=auth.uid();
 RETURN jsonb_build_object('amount',p_amount,'collected',false);
END $$;

CREATE FUNCTION public.order_delivery_fee(p_order uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT qr_private.order_delivery_fee(p_order)
$$;
CREATE FUNCTION public.save_order_delivery_fee(p_order uuid,p_amount numeric)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT qr_private.save_order_delivery_fee(p_order,p_amount)
$$;
REVOKE ALL ON FUNCTION public.order_delivery_fee(uuid),public.save_order_delivery_fee(uuid,numeric),
 qr_private.order_delivery_fee(uuid),qr_private.save_order_delivery_fee(uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.order_delivery_fee(uuid),public.save_order_delivery_fee(uuid,numeric),
 qr_private.order_delivery_fee(uuid),qr_private.save_order_delivery_fee(uuid,numeric) TO authenticated;

CREATE FUNCTION qr_private.pending_delivery_fee(p_order uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE((SELECT f.amount FROM qr_private.delivery_fees f
 JOIN public.orders o ON o.id=f.order_id AND o.order_type='delivery'
 WHERE f.order_id=p_order AND f.sale_id IS NULL),0)
$$;
REVOKE ALL ON FUNCTION qr_private.pending_delivery_fee(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION qr_private.delivery_fee_required(p_order uuid,p_branch uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM public.orders o JOIN qr_private.requests r ON r.order_id=o.id
   WHERE o.id=p_order AND o.branch_id=p_branch AND o.order_type='delivery'
     AND r.branch_id=p_branch AND r.order_type='delivery' AND r.status='accepted' AND r.visit_id IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM qr_private.delivery_fees WHERE order_id=p_order)
$$;
REVOKE ALL ON FUNCTION qr_private.delivery_fee_required(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Patch the deployed settlement functions in place to preserve their existing
-- caller signatures, grants, and historical enhancements.
DO $patch$
DECLARE target regprocedure; definition text; old text; replacement text;
BEGIN
 target:='public._build_order_settlement_preview(uuid)'::regprocedure;
 definition:=pg_get_functiondef(target);
 old:='  v_total := ROUND(v_subtotal - v_discount + v_tax, 2);';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery preview validation contract changed'; END IF;
 definition:=replace(definition,old,$new$  IF qr_private.delivery_fee_required(p_order_id,v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','DELIVERY_FEE_REQUIRED');
  END IF;
$new$||old);
 old:='  v_total := ROUND(v_subtotal - v_discount + v_tax, 2);';
 replacement:='  v_total := ROUND(v_subtotal - v_discount + v_tax + qr_private.pending_delivery_fee(p_order_id), 2);';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery preview contract changed'; END IF;
 definition:=replace(definition,old,replacement);
 old:=$old$    'total', v_total,$old$;
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery preview result contract changed'; END IF;
 EXECUTE replace(definition,old,old||E'\n'||$new$    'delivery_fee_amount', qr_private.pending_delivery_fee(p_order_id),$new$);

 target:='public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure;
 definition:=pg_get_functiondef(target);
 old:='      AND o.branch_id = p_branch_id;';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery settlement lock contract changed'; END IF;
 definition:=replace(definition,old,'      AND o.branch_id = p_branch_id FOR UPDATE;');
 old:='      ELSE 0 END,';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery settlement due contract changed'; END IF;
 definition:=replace(definition,old,'      ELSE 0 END + qr_private.pending_delivery_fee(p_order_id),');
 old:='  v_result := public._process_sale_core(';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery settlement core contract changed'; END IF;
 definition:=replace(definition,old,$new$  PERFORM set_config('app.delivery_fee_order_id',COALESCE(p_order_id::text,''),true);
$new$||old);
 old:=$old$  IF COALESCE((v_result->>'success')::boolean,false) IS TRUE AND p_shift_id IS NOT NULL THEN$old$;
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery settlement result contract changed'; END IF;
 EXECUTE replace(definition,old,$new$  PERFORM set_config('app.delivery_fee_order_id','',true);

$new$||old);

 target:='public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure;
 definition:=pg_get_functiondef(target);
 old:='    v_due := ROUND(v_server_subtotal-v_header_discount+';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery split due contract changed'; END IF;
 definition:=replace(definition,old,$new$    PERFORM 1 FROM public.orders WHERE id=p_order_id AND branch_id=p_branch_id FOR UPDATE;
    IF qr_private.delivery_fee_required(p_order_id,p_branch_id) THEN
      RETURN jsonb_build_object('success',false,'error','DELIVERY_FEE_REQUIRED');
    END IF;
    v_due := ROUND(qr_private.pending_delivery_fee((SELECT id FROM public.orders WHERE id=p_order_id AND branch_id=p_branch_id))+v_server_subtotal-v_header_discount+$new$);
 old:='    v_core := public._process_sale_core(';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery split core contract changed'; END IF;
 definition:=replace(definition,old,$new$    PERFORM set_config('app.delivery_fee_order_id',COALESCE(p_order_id::text,''),true);
$new$||old);
 old:=$old$    IF p_order_id IS NOT NULL THEN
      PERFORM set_config('app.kitchen_inventory_settlement','off',true);$old$;
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery split result contract changed'; END IF;
 EXECUTE replace(definition,old,$new$    PERFORM set_config('app.delivery_fee_order_id','',true);
$new$||old);

 target:='public._process_sale_core(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure;
 definition:=pg_get_functiondef(target);
 old:='  v_total numeric(14,2);';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery sale declaration contract changed'; END IF;
 definition:=replace(definition,old,old||E'\n  v_fee numeric(14,2) := 0;\n  v_fee_order uuid;');
 old:='    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery sale total contract changed'; END IF;
 definition:=replace(definition,old,$new$    v_fee_order:=NULLIF(current_setting('app.delivery_fee_order_id',true),'')::uuid;
    SELECT COALESCE((SELECT qr_private.pending_delivery_fee(o.id) FROM public.orders o
      WHERE o.id=v_fee_order AND o.branch_id=p_branch_id),0) INTO v_fee;
    v_total := ROUND(v_subtotal - v_discount + v_tax + v_fee, 2);$new$);
 old:='    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery sale journal contract changed'; END IF;
 definition:=replace(definition,old,$new$    IF v_fee_order IS NOT NULL THEN
      UPDATE qr_private.delivery_fees SET sale_id=v_sale_id WHERE order_id=v_fee_order AND sale_id IS NULL
        AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id=v_fee_order AND o.branch_id=p_branch_id AND o.order_type='delivery');
      IF v_fee>0 THEN UPDATE public.sales SET delivery_fee_amount=v_fee WHERE id=v_sale_id; END IF;
    END IF;

$new$||old);
 old:=$old$    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;$old$;
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery sale revenue contract changed'; END IF;
 EXECUTE replace(definition,old,$new$    IF v_subtotal + v_fee > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal + v_fee);
      v_cr := v_cr + v_subtotal + v_fee;$new$);

 target:='public._process_refund_single_core(uuid,jsonb,text)'::regprocedure;
 definition:=pg_get_functiondef(target);
 old:='  v_refund_total numeric(14,2) := 0;';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery refund declaration contract changed'; END IF;
 definition:=replace(definition,old,old||E'\n  v_sale_fee numeric(14,2) := 0;\n  v_fee_refunded numeric(14,2) := 0;');
 old:=$old$    SELECT bool_and(quantity = refunded_quantity) INTO v_all_refunded
      FROM sale_items WHERE sale_id = p_sale_id;$old$;
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery refund completion contract changed'; END IF;
 definition:=replace(definition,old,old||E'\n'||$new$    SELECT delivery_fee_amount INTO v_sale_fee FROM public.sales WHERE id=p_sale_id;
    IF v_all_refunded AND v_sale_fee>0 THEN
      SELECT GREATEST(total-COALESCE(refunded_amount,0),0) INTO v_refund_total
      FROM public.sales WHERE id=p_sale_id;
      v_fee_refunded:=LEAST(v_sale_fee,v_refund_total);
    END IF;$new$);
 old:=$old$        v_ratio := round(v_refund_total / GREATEST(COALESCE(v_sale.total, 0), 1), 6);
        v_revenue_r := round(v_revenue * v_ratio, 2);$old$;
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Delivery refund ratio contract changed'; END IF;
 EXECUTE replace(definition,old,$new$        v_ratio := round((v_refund_total-v_fee_refunded) / GREATEST(COALESCE(v_sale.total, 0)-v_sale_fee, 1), 6);
        v_revenue_r := round((v_revenue-v_sale_fee) * v_ratio, 2)+v_fee_refunded;$new$);
END
$patch$;

CREATE OR REPLACE FUNCTION qr_private.guest_track(p_token text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v qr_private.visits;l qr_private.table_links;data jsonb;calls jsonb;
BEGIN
 IF NOT qr_private.checkin_enabled(p_token) THEN RETURN qr_private.track_core(p_token,p_session); END IF;
 l:=qr_private.guest_scope(p_token,p_session);
 SELECT * INTO v FROM qr_private.visits WHERE guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND generation=l.generation AND branch_id=l.branch_id;
 IF v.id IS NULL OR v.expires_at<=now() OR (v.status='closed' AND (
  v.order_type='dine_in' OR NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.id=v.order_id AND o.branch_id=v.branch_id AND o.status IN ('completed','cancelled'))
 )) THEN RETURN jsonb_build_object('requests','[]'::jsonb,'bills','[]'::jsonb,'calls','[]'::jsonb,'visit',jsonb_build_object('closed',true));END IF;
 data:=qr_private.track_core(p_token,p_session);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'note',c.note,'status',c.status,'created_at',c.created_at,'table_name',COALESCE(d.name,'توصيل')) ORDER BY c.created_at DESC),'[]') INTO calls
 FROM qr_private.service_calls c LEFT JOIN public.dining_tables d ON d.id=c.table_id WHERE c.visit_id=v.id;
 data:=data||jsonb_build_object('calls',calls,'visit',qr_private.visit_view(v)||jsonb_build_object('closed',v.status='closed'));
 IF v.order_type IN ('delivery','pickup') THEN
  data:=jsonb_set(data,'{requests}',COALESCE((SELECT jsonb_agg(value||jsonb_build_object('order_type',v.order_type,'requested_table',NULL)) FROM jsonb_array_elements(data->'requests')),'[]'));
  data:=jsonb_set(data,'{bills}',COALESCE((SELECT jsonb_agg(value||jsonb_build_object('table_name',NULL,'order_type',v.order_type,'dispatch_status',d.status,
    'delivery_fee_amount',f.amount,
    'bill_confirmed',CASE WHEN v.order_type<>'delivery' THEN true
      WHEN value->>'status'='cancelled' THEN false
      WHEN value->>'status'='completed' THEN true
      ELSE f.amount IS NOT NULL AND EXISTS(SELECT 1 FROM public.order_kitchen_sends sent
        WHERE sent.branch_id=v.branch_id AND sent.order_id=(bill.value->>'id')::uuid AND sent.sent_quantity>0) END,
    'total',(value->>'total')::numeric+COALESCE(f.amount,0),
    'paid_amount',COALESCE(paid.amount,(value->>'paid_amount')::numeric),
    'balance',CASE WHEN value->>'status'='cancelled' THEN 0 ELSE GREATEST(
      (value->>'total')::numeric+COALESCE(f.amount,0)-COALESCE(paid.amount,(value->>'paid_amount')::numeric)
      -COALESCE((value->>'refunded_amount')::numeric,0),0) END) ORDER BY bill.position)
    FROM jsonb_array_elements(data->'bills') WITH ORDINALITY bill(value,position)
    LEFT JOIN qr_private.delivery_dispatch d ON v.order_type='delivery' AND d.branch_id=v.branch_id AND d.order_id=(bill.value->>'id')::uuid
    LEFT JOIN qr_private.delivery_fees f ON v.order_type='delivery' AND f.order_id=(bill.value->>'id')::uuid
    LEFT JOIN LATERAL (
      SELECT LEAST(GREATEST(sum(s.paid_amount-s.refunded_amount),0),(value->>'total')::numeric+f.amount) amount
      FROM public.sales s WHERE f.sale_id IS NOT NULL AND s.branch_id=v.branch_id AND
        (s.id=f.sale_id OR s.source_order_id=f.order_id OR s.id IN
          (SELECT e.settled_sale_id FROM public.order_kitchen_inventory_events e WHERE e.order_id=f.order_id))
      HAVING count(*)>0
    ) paid ON true),'[]'));
 END IF;RETURN data;
END $$;
