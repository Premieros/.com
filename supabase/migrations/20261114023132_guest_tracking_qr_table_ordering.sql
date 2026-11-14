BEGIN;
ALTER TABLE qr_private.requests ADD COLUMN guest_hash text;
CREATE INDEX qr_requests_guest ON qr_private.requests(generation,guest_hash,created_at) WHERE guest_hash IS NOT NULL;
CREATE TABLE qr_private.service_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 generation uuid NOT NULL, guest_hash text NOT NULL, request_key uuid NOT NULL,
 table_id uuid NOT NULL REFERENCES public.dining_tables(id) ON DELETE CASCADE, requested_table_id uuid,
 order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('service','check')), note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','done')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), handled_by uuid,
 UNIQUE(generation,guest_hash,request_key)
);
CREATE INDEX qr_calls_inbox ON qr_private.service_calls(branch_id,created_at) WHERE status<>'done';
CREATE INDEX qr_calls_guest ON qr_private.service_calls(generation,guest_hash,created_at);
CREATE INDEX qr_calls_table_rate ON qr_private.service_calls(table_id,created_at);
ALTER TABLE qr_private.service_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_private.service_calls FROM PUBLIC,anon,authenticated;

CREATE FUNCTION qr_private.guest_scope(p_token text,p_session text) RETURNS qr_private.table_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;
BEGIN
 IF p_token IS NULL OR length(p_token)<>64 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
 SELECT q.* INTO l FROM qr_private.table_links q JOIN public.dining_tables d ON d.id=q.table_id AND d.branch_id=q.branch_id
 JOIN public.branches b ON b.id=q.branch_id WHERE q.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') AND q.enabled AND d.is_active AND b.is_active;
 IF l.table_id IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
 RETURN l;
END $$;

CREATE FUNCTION qr_private.place(p_token text,p_session text,p_key uuid,p_items jsonb,p_table uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links; h text; existing qr_private.requests; result jsonb;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session); h:=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 -- Same table locks as submit_selected/rotate, and no adoption of legacy or another device's keys.
 PERFORM 1 FROM public.dining_tables WHERE id IN(l.table_id,p_table) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM qr_private.requests WHERE generation=l.generation AND guest_hash=h AND created_at<now()-interval '24 hours') THEN RAISE EXCEPTION 'QR_SESSION_EXPIRED'; END IF;
 SELECT * INTO existing FROM qr_private.requests WHERE generation=l.generation AND request_key=p_key;
 IF existing.id IS NOT NULL AND existing.guest_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'QR_SESSION_CONFLICT'; END IF;
 result:=qr_private.submit_selected(p_token,p_key,p_items,p_table);
 UPDATE qr_private.requests SET guest_hash=h WHERE id=(result->>'id')::uuid AND (guest_hash IS NULL OR guest_hash=h);
 RETURN result;
END $$;

CREATE FUNCTION qr_private.track(p_token text,p_session text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links; h text; requests jsonb; bills jsonb; calls jsonb;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session); h:=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') INTO requests FROM (
  SELECT r.id,r.status,r.items,r.created_at,d.name requested_table,a.name assigned_table
  FROM qr_private.requests r LEFT JOIN public.dining_tables d ON d.id=r.requested_table_id LEFT JOIN public.dining_tables a ON a.id=r.assigned_table_id
  WHERE r.branch_id=l.branch_id AND r.generation=l.generation AND r.guest_hash=h AND r.created_at>now()-interval '24 hours'
  ORDER BY r.created_at DESC LIMIT 50
 ) x;
 -- Follow immutable accepted order IDs, never whichever bill occupies a table next.
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]') INTO bills FROM (
  SELECT o.id,o.order_number,o.status,o.kitchen_status,o.payment_status,o.created_at,d.id table_id,d.name table_name,
   EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>COALESCE((SELECT sum(s.sent_quantity) FROM public.order_kitchen_sends s WHERE s.order_item_id=oi.id),0)) has_unsent,
   o.subtotal,o.discount_amount,o.discount_type,o.tax_amount,o.total,
   LEAST(GREATEST(COALESCE(pay.paid,0),0),GREATEST(o.total,0)) paid_amount,
   COALESCE(pay.refunded,0) refunded_amount,
   CASE WHEN o.status='cancelled' THEN 0 ELSE GREATEST(o.total-COALESCE(pay.refunded,0)-GREATEST(COALESCE(pay.paid,0),0),0) END balance,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.name,'quantity',oi.quantity,'unit_price',oi.unit_price,'total',oi.total) ORDER BY oi.created_at)
     FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id WHERE oi.order_id=o.id AND oi.quantity>0),'[]') items
  FROM public.orders o LEFT JOIN public.dining_tables d ON d.id=o.table_id AND d.branch_id=o.branch_id
  LEFT JOIN LATERAL(SELECT sum(s.paid_amount-COALESCE(s.refunded_amount,0)) paid,sum(COALESCE(s.refunded_amount,0)) refunded FROM public.sales s
   WHERE s.branch_id=o.branch_id AND (s.source_order_id=o.id OR s.id IN(SELECT e.settled_sale_id FROM public.order_kitchen_inventory_events e WHERE e.order_id=o.id AND e.settled_sale_id IS NOT NULL))) pay ON true
  WHERE o.branch_id=l.branch_id AND EXISTS(SELECT 1 FROM qr_private.requests r WHERE r.order_id=o.id AND r.status='accepted'
    AND r.generation=l.generation AND r.guest_hash=h AND r.branch_id=l.branch_id AND r.created_at>now()-interval '24 hours')
 ) x;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') INTO calls FROM (
  SELECT c.id,c.kind,c.note,c.status,c.created_at,d.name table_name FROM qr_private.service_calls c JOIN public.dining_tables d ON d.id=c.table_id
  WHERE c.branch_id=l.branch_id AND c.generation=l.generation AND c.guest_hash=h AND c.created_at>now()-interval '24 hours' ORDER BY c.created_at DESC LIMIT 30
 ) x;
 RETURN jsonb_build_object('requests',requests,'bills',bills,'calls',calls);
END $$;

CREATE FUNCTION qr_private.call_service(p_token text,p_session text,p_key uuid,p_table uuid,p_kind text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links; h text; target uuid; owned public.orders; c qr_private.service_calls;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session); h:=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 IF p_key IS NULL OR p_kind IS NULL OR p_kind NOT IN('service','check') OR p_note IS NULL OR length(p_note)>300 THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
 SELECT * INTO c FROM qr_private.service_calls WHERE generation=l.generation AND guest_hash=h AND request_key=p_key;
 IF c.id IS NOT NULL THEN
  IF c.kind<>p_kind OR c.note<>p_note OR c.requested_table_id IS DISTINCT FROM p_table THEN RAISE EXCEPTION 'QR_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('id',c.id,'status',c.status);
 END IF;
 IF NOT COALESCE((SELECT enabled FROM qr_private.branch_settings WHERE branch_id=l.branch_id),true) THEN RAISE EXCEPTION 'QR_DISABLED'; END IF;
 IF EXISTS(SELECT 1 FROM qr_private.requests WHERE generation=l.generation AND guest_hash=h AND created_at<now()-interval '24 hours') THEN RAISE EXCEPTION 'QR_SESSION_EXPIRED'; END IF;
 SELECT o.* INTO owned FROM public.orders o WHERE o.branch_id=l.branch_id AND o.status IN('open','held') AND EXISTS(
  SELECT 1 FROM qr_private.requests r WHERE r.order_id=o.id AND r.generation=l.generation AND r.guest_hash=h AND r.status='accepted' AND r.created_at>now()-interval '24 hours')
  ORDER BY o.created_at DESC LIMIT 1;
 IF p_kind='check' AND owned.id IS NULL THEN RAISE EXCEPTION 'QR_NO_ACTIVE_BILL'; END IF;
 target:=COALESCE(owned.table_id,p_table);
 -- Ordered table locks serialize per-table rates across different printed links too.
 PERFORM 1 FROM public.dining_tables WHERE id IN(l.table_id,target) ORDER BY id FOR UPDATE;
 l:=qr_private.guest_scope(p_token,p_session);
 SELECT * INTO c FROM qr_private.service_calls WHERE generation=l.generation AND guest_hash=h AND request_key=p_key;
 IF c.id IS NOT NULL THEN
  IF c.kind<>p_kind OR c.note<>p_note OR c.requested_table_id IS DISTINCT FROM p_table THEN RAISE EXCEPTION 'QR_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('id',c.id,'status',c.status);
 END IF;
 IF owned.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.orders WHERE id=owned.id AND table_id=target AND status IN('open','held')) THEN RAISE EXCEPTION 'QR_TABLE_SESSION_CHANGED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.dining_tables WHERE id=target AND branch_id=l.branch_id AND is_active) THEN RAISE EXCEPTION 'QR_TABLE_INVALID'; END IF;
 SELECT * INTO c FROM qr_private.service_calls WHERE generation=l.generation AND guest_hash=h AND table_id=target AND kind=p_kind AND status<>'done' ORDER BY created_at LIMIT 1;
 IF c.id IS NOT NULL THEN RETURN jsonb_build_object('id',c.id,'status',c.status); END IF;
 IF (SELECT count(*) FROM qr_private.service_calls WHERE generation=l.generation AND guest_hash=h AND created_at>now()-interval '1 minute')>=5
 OR (SELECT count(*) FROM qr_private.service_calls WHERE table_id=target AND created_at>now()-interval '1 minute')>=10
 OR (SELECT count(*) FROM qr_private.service_calls WHERE table_id=target AND status<>'done')>=20 THEN RAISE EXCEPTION 'QR_RATE_LIMITED'; END IF;
 INSERT INTO qr_private.service_calls(branch_id,generation,guest_hash,request_key,table_id,requested_table_id,order_id,kind,note)
 VALUES(l.branch_id,l.generation,h,p_key,target,p_table,owned.id,p_kind,p_note) RETURNING * INTO c;
 RETURN jsonb_build_object('id',c.id,'status',c.status);
END $$;

CREATE FUNCTION qr_private.calls(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM qr_private.require_staff(p_branch,'pos.view');
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]') INTO result FROM (
  SELECT c.id,c.kind,c.note,c.status,c.created_at,c.order_id,d.name table_name FROM qr_private.service_calls c JOIN public.dining_tables d ON d.id=c.table_id
  WHERE c.branch_id=p_branch AND c.status<>'done' AND c.created_at>now()-interval '24 hours' ORDER BY c.created_at LIMIT 200
 ) x;
 RETURN result;
END $$;
CREATE FUNCTION qr_private.handle_call(p_id uuid,p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c qr_private.service_calls;
BEGIN
 SELECT * INTO c FROM qr_private.service_calls WHERE id=p_id FOR UPDATE;
 PERFORM qr_private.require_staff(c.branch_id,'pos.order.edit');
 IF NOT qr_private.may_review(c.branch_id) THEN RAISE EXCEPTION 'QR_PERMISSION_DENIED'; END IF;
 IF c.id IS NULL OR p_status IS NULL OR p_status NOT IN('acknowledged','done') THEN RAISE EXCEPTION 'QR_REQUEST_NOT_FOUND'; END IF;
 IF c.status='done' AND p_status<>'done' THEN RAISE EXCEPTION 'QR_ALREADY_DECIDED'; END IF;
 IF c.status=p_status THEN RETURN; END IF;
 UPDATE qr_private.service_calls SET status=p_status,updated_at=now(),handled_by=auth.uid() WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION qr_private.review(p_id uuid,p_accept boolean,p_table uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r qr_private.requests; target uuid; result jsonb; owned_id uuid;
BEGIN
  SELECT * INTO r FROM qr_private.requests WHERE id=p_id;
  IF r.id IS NULL OR p_accept IS NULL THEN RAISE EXCEPTION 'QR_REQUEST_NOT_FOUND'; END IF;
  PERFORM qr_private.require_staff(r.branch_id,'pos.order.edit');
  IF NOT qr_private.may_review(r.branch_id) THEN RAISE EXCEPTION 'QR_PERMISSION_DENIED'; END IF;
  target:=COALESCE(p_table,r.assigned_table_id,r.requested_table_id);
  -- Ordered locks prevent opposing reassignments deadlocking. Core decide reuses them.
  PERFORM 1 FROM public.dining_tables WHERE id IN (r.table_id,r.requested_table_id,target) ORDER BY id FOR UPDATE;
  SELECT * INTO r FROM qr_private.requests WHERE id=p_id FOR UPDATE;
  IF r.status<>'pending' THEN
    IF (r.status='accepted')<>p_accept OR (p_accept AND r.assigned_table_id IS DISTINCT FROM target) THEN RAISE EXCEPTION 'QR_ALREADY_DECIDED'; END IF;
    RETURN jsonb_build_object('status',r.status,'order_id',r.order_id);
  END IF;
  IF p_accept THEN
    IF NOT COALESCE((SELECT enabled FROM qr_private.branch_settings WHERE branch_id=r.branch_id),true) THEN RAISE EXCEPTION 'QR_DISABLED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.dining_tables WHERE id=target AND branch_id=r.branch_id AND is_active) THEN RAISE EXCEPTION 'QR_TABLE_INVALID'; END IF;
    -- Only this device's previously accepted active order may receive follow-up items.
    SELECT o.id INTO owned_id FROM public.orders o WHERE o.table_id=target AND o.branch_id=r.branch_id AND o.status IN ('open','held')
      AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0)
      AND r.guest_hash IS NOT NULL AND EXISTS(SELECT 1 FROM qr_private.requests prior WHERE prior.order_id=o.id AND prior.status='accepted'
        AND prior.branch_id=r.branch_id AND prior.generation=r.generation AND prior.guest_hash=r.guest_hash AND prior.created_at>now()-interval '24 hours')
      ORDER BY o.created_at LIMIT 1;
    IF owned_id IS NULL AND (EXISTS(SELECT 1 FROM public.dining_tables WHERE id=target AND status::text<>'vacant')
      OR EXISTS(SELECT 1 FROM public.orders o WHERE o.table_id=target AND o.status IN ('open','held')
        AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0))) THEN RAISE EXCEPTION 'QR_TABLE_BUSY'; END IF;
    UPDATE qr_private.requests SET table_id=target,target_order_id=owned_id,assigned_table_id=target WHERE id=p_id;
  END IF;
  result:=qr_private.decide(p_id,p_accept);
  RETURN result;
END $$;
CREATE FUNCTION public.qr_place(p_token text,p_session text,p_key uuid,p_items jsonb,p_table uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.place(p_token,p_session,p_key,p_items,p_table) $$;
CREATE FUNCTION public.qr_track(p_token text,p_session text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.track(p_token,p_session) $$;
CREATE FUNCTION public.qr_call_service(p_token text,p_session text,p_key uuid,p_table uuid,p_kind text,p_note text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.call_service(p_token,p_session,p_key,p_table,p_kind,p_note) $$;
CREATE FUNCTION public.qr_calls(p_branch uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.calls(p_branch) $$;
CREATE FUNCTION public.qr_handle_call(p_id uuid,p_status text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.handle_call(p_id,p_status) $$;
REVOKE ALL ON FUNCTION qr_private.guest_scope(text,text),qr_private.place(text,text,uuid,jsonb,uuid),qr_private.track(text,text),
 qr_private.call_service(text,text,uuid,uuid,text,text),qr_private.calls(uuid),qr_private.handle_call(uuid,text),
 public.qr_place(text,text,uuid,jsonb,uuid),public.qr_track(text,text),public.qr_call_service(text,text,uuid,uuid,text,text),public.qr_calls(uuid),public.qr_handle_call(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.place(text,text,uuid,jsonb,uuid),qr_private.track(text,text),qr_private.call_service(text,text,uuid,uuid,text,text),
 public.qr_place(text,text,uuid,jsonb,uuid),public.qr_track(text,text),public.qr_call_service(text,text,uuid,uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.calls(uuid),qr_private.handle_call(uuid,text),public.qr_calls(uuid),public.qr_handle_call(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION qr_private.inbox(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM qr_private.require_staff(p_branch,'pos.view');
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]') INTO result FROM (
  SELECT r.id,r.table_id,d.name table_name,r.items,r.created_at,
   (SELECT o.table_id FROM public.orders o WHERE o.branch_id=r.branch_id AND o.status IN('open','held')
    AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0)
    AND r.guest_hash IS NOT NULL AND EXISTS(SELECT 1 FROM qr_private.requests prior WHERE prior.order_id=o.id AND prior.status='accepted'
      AND prior.branch_id=r.branch_id AND prior.generation=r.generation AND prior.guest_hash=r.guest_hash AND prior.created_at>now()-interval '24 hours')
    ORDER BY o.created_at DESC LIMIT 1) own_active_table_id
  FROM qr_private.requests r JOIN public.dining_tables d ON d.id=r.table_id WHERE r.branch_id=p_branch AND r.status='pending'
  ORDER BY r.created_at LIMIT 200
 ) x;
 RETURN result;
END $$;
COMMIT;
