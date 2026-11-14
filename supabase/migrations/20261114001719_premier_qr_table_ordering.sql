-- Review-only migration. Never apply to the hosted database before approval.
-- Capability tokens permit only menu reads and bounded pending submissions.
BEGIN;
CREATE SCHEMA IF NOT EXISTS qr_private;
REVOKE ALL ON SCHEMA qr_private FROM PUBLIC;
GRANT USAGE ON SCHEMA qr_private TO anon, authenticated;

CREATE TABLE qr_private.table_links (
  table_id uuid PRIMARY KEY REFERENCES public.dining_tables(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  token_hash text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  generation uuid NOT NULL DEFAULT gen_random_uuid()
);
CREATE TABLE qr_private.menu_products (
  product_id uuid PRIMARY KEY REFERENCES public.products(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id)
);
CREATE TABLE qr_private.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.dining_tables(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  generation uuid NOT NULL,
  request_key uuid NOT NULL,
  payload jsonb NOT NULL,
  items jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  order_id uuid REFERENCES public.orders(id),
  target_order_id uuid REFERENCES public.orders(id),
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE(table_id, generation, request_key)
);
CREATE INDEX qr_requests_inbox ON qr_private.requests(branch_id, created_at) WHERE status='pending';
CREATE INDEX qr_requests_rate ON qr_private.requests(table_id, created_at);
ALTER TABLE public.orders ADD COLUMN qr_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE qr_private.table_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_private.menu_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_private.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA qr_private FROM PUBLIC, anon, authenticated;

-- Private definers, public invoker wrappers. No table privileges for API roles.
CREATE FUNCTION qr_private.require_staff(p_branch uuid, p_permission text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.user_may_access_branch(p_branch),false)
     OR NOT COALESCE(public.can_permission(p_permission),false)
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'QR_PERMISSION_DENIED' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION qr_private.menu(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.dining_tables; result jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  SELECT d.* INTO t FROM public.dining_tables d
    JOIN qr_private.table_links l ON l.table_id=d.id
    JOIN public.branches b ON b.id=d.branch_id
    WHERE l.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
      AND l.enabled AND l.branch_id=d.branch_id AND d.is_active AND b.is_active;
  IF t.id IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
    'price',round(p.sale_price,2)) ORDER BY p.name),'[]') INTO result
    FROM public.products p JOIN qr_private.menu_products m ON m.product_id=p.id AND m.branch_id=p.branch_id
    WHERE p.branch_id=t.branch_id AND p.is_active AND p.sale_price>=0
      AND NOT EXISTS(SELECT 1 FROM public.product_modifier_group_products gp JOIN public.product_modifier_groups g ON g.id=gp.group_id
        WHERE gp.product_id=p.id AND gp.branch_id=t.branch_id AND g.branch_id=t.branch_id AND g.is_active AND g.min_selections>0);
  RETURN jsonb_build_object('table_name',t.name,'products',result);
END $$;

CREATE FUNCTION qr_private.submit(p_token text, p_key uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.dining_tables; l qr_private.table_links; r qr_private.requests;
  i jsonb; p public.products; snapshot jsonb := '[]'; canonical jsonb;
BEGIN
  IF p_key IS NULL OR p_token IS NULL OR length(p_token)<>64 THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 OR octet_length(p_items::text)>16000 THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
  SELECT d.* INTO t FROM public.dining_tables d JOIN qr_private.table_links q ON q.table_id=d.id
    WHERE q.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE OF d;
  IF t.id IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  SELECT * INTO l FROM qr_private.table_links WHERE table_id=t.id;
  IF NOT l.enabled OR l.branch_id<>t.branch_id OR l.token_hash<>encode(sha256(convert_to(p_token,'UTF8')),'hex') OR NOT t.is_active
     OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=t.branch_id AND is_active) THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  -- The only client fields used: product, whole quantity, quoted price, plain text note.
  FOR i IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(i)<>'object' OR i->>'product_id' IS NULL
      OR jsonb_typeof(i->'quantity') IS DISTINCT FROM 'number'
      OR (i->>'quantity')::numeric NOT BETWEEN 1 AND 99
      OR trunc((i->>'quantity')::numeric)<>(i->>'quantity')::numeric
      OR jsonb_typeof(i->'price') IS DISTINCT FROM 'number'
      OR (i->>'price')::numeric < 0
      OR (i ? 'notes' AND jsonb_typeof(i->'notes')<>'string')
      OR length(COALESCE(i->>'notes',''))>300 THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'product_id') FROM jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'QR_DUPLICATE_PRODUCT'; END IF;
  SELECT jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,
    'quantity',(value->>'quantity')::integer,'price',(value->>'price')::numeric,
    'notes',COALESCE(value->>'notes','')) ORDER BY value->>'product_id') INTO canonical FROM jsonb_array_elements(p_items);
  SELECT * INTO r FROM qr_private.requests WHERE table_id=t.id AND generation=l.generation AND request_key=p_key;
  IF r.id IS NOT NULL THEN
    IF r.payload<>canonical THEN RAISE EXCEPTION 'QR_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('id',r.id,'status',r.status);
  END IF;
  IF (SELECT count(*) FROM qr_private.requests WHERE table_id=t.id AND created_at>now()-interval '1 minute')>=10
    OR (SELECT count(*) FROM qr_private.requests WHERE table_id=t.id AND status='pending')>=20 THEN RAISE EXCEPTION 'QR_RATE_LIMITED'; END IF;
  FOR i IN SELECT value FROM jsonb_array_elements(canonical) ORDER BY value->>'product_id' LOOP
    SELECT x.* INTO p FROM public.products x JOIN qr_private.menu_products m ON m.product_id=x.id AND m.branch_id=x.branch_id
      WHERE x.id=(i->>'product_id')::uuid AND x.branch_id=t.branch_id AND x.is_active FOR SHARE OF x;
    IF p.id IS NULL OR EXISTS(SELECT 1 FROM public.product_modifier_group_products gp JOIN public.product_modifier_groups g ON g.id=gp.group_id
      WHERE gp.product_id=p.id AND gp.branch_id=t.branch_id AND g.branch_id=t.branch_id AND g.is_active AND g.min_selections>0) THEN RAISE EXCEPTION 'QR_PRODUCT_UNAVAILABLE'; END IF;
    IF round(p.sale_price,2)<>(i->>'price')::numeric THEN RAISE EXCEPTION 'QR_PRICE_CHANGED'; END IF;
    snapshot:=snapshot||jsonb_build_array(i||jsonb_build_object('name',p.name));
  END LOOP;
  IF (SELECT count(*) FROM public.orders o WHERE o.table_id=t.id AND o.status IN ('open','held')
    AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0))>1 THEN RAISE EXCEPTION 'QR_AMBIGUOUS_TABLE'; END IF;
  INSERT INTO qr_private.requests(table_id,branch_id,generation,request_key,payload,items,target_order_id)
    VALUES(t.id,t.branch_id,l.generation,p_key,canonical,snapshot,
      (SELECT o.id FROM public.orders o WHERE o.table_id=t.id AND o.status IN ('open','held')
        AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0))) RETURNING * INTO r;
  RETURN jsonb_build_object('id',r.id,'status',r.status);
END $$;

CREATE FUNCTION qr_private.configure(p_branch uuid, p_products uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM qr_private.require_staff(p_branch,'floor_plan.manage');
  PERFORM 1 FROM public.branches WHERE id=p_branch FOR UPDATE;
  IF p_products IS NULL OR cardinality(p_products)>1000 OR EXISTS(
    SELECT 1 FROM unnest(p_products) id WHERE NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=id AND p.branch_id=p_branch AND p.is_active)
  ) THEN RAISE EXCEPTION 'QR_PRODUCT_UNAVAILABLE'; END IF;
  DELETE FROM qr_private.menu_products WHERE branch_id=p_branch;
  INSERT INTO qr_private.menu_products SELECT DISTINCT id,p_branch FROM unnest(p_products) id;
END $$;

CREATE FUNCTION qr_private.rotate(p_table uuid, p_enabled boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.dining_tables; token text;
BEGIN
  SELECT * INTO t FROM public.dining_tables WHERE id=p_table FOR UPDATE;
  PERFORM qr_private.require_staff(t.branch_id,'floor_plan.manage');
  IF t.id IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  -- Two independent random UUIDs provide >240 bits of entropy; only SHA256 stored.
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  INSERT INTO qr_private.table_links(table_id,branch_id,token_hash,enabled) VALUES(t.id,t.branch_id,encode(sha256(convert_to(token,'UTF8')),'hex'),p_enabled)
    ON CONFLICT(table_id) DO UPDATE SET branch_id=excluded.branch_id,token_hash=excluded.token_hash,enabled=excluded.enabled,generation=gen_random_uuid();
  RETURN CASE WHEN p_enabled THEN token ELSE NULL END;
END $$;

CREATE FUNCTION qr_private.inbox(p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM qr_private.require_staff(p_branch,'pos.view');
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]') INTO result FROM (
    SELECT r.id,r.table_id,d.name table_name,r.items,r.created_at FROM qr_private.requests r
      JOIN public.dining_tables d ON d.id=r.table_id WHERE r.branch_id=p_branch AND r.status='pending'
      ORDER BY r.created_at LIMIT 200
  ) x;
  RETURN result;
END $$;

CREATE FUNCTION qr_private.decide(p_id uuid, p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r qr_private.requests; t public.dining_tables; o public.orders;
  i jsonb; p public.products; result jsonb; new_items jsonb; n integer; actual_price numeric;
  matched_item uuid; item_note text;
BEGIN
  SELECT * INTO r FROM qr_private.requests WHERE id=p_id;
  IF r.id IS NULL OR p_accept IS NULL THEN RAISE EXCEPTION 'QR_REQUEST_NOT_FOUND'; END IF;
  PERFORM qr_private.require_staff(r.branch_id,'pos.order.edit');
  -- Shared lock order with submit/rotate; repeated accepts serialize here.
  SELECT * INTO t FROM public.dining_tables WHERE id=r.table_id FOR UPDATE;
  SELECT * INTO r FROM qr_private.requests WHERE id=p_id FOR UPDATE;
  IF r.status<>'pending' THEN
    IF (r.status='accepted')<>p_accept THEN RAISE EXCEPTION 'QR_ALREADY_DECIDED'; END IF;
    RETURN jsonb_build_object('status',r.status,'order_id',r.order_id);
  END IF;
  IF p_accept THEN
    IF r.created_at < now()-interval '30 minutes' THEN RAISE EXCEPTION 'QR_REQUEST_EXPIRED'; END IF;
    IF NOT t.is_active OR t.branch_id<>r.branch_id OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=r.branch_id AND is_active) THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
    FOR i IN SELECT value FROM jsonb_array_elements(r.items) ORDER BY value->>'product_id' LOOP
      SELECT x.* INTO p FROM public.products x JOIN qr_private.menu_products m ON m.product_id=x.id AND m.branch_id=x.branch_id
        WHERE x.id=(i->>'product_id')::uuid AND x.branch_id=r.branch_id AND x.is_active FOR SHARE OF x;
      IF p.id IS NULL OR NOT COALESCE((public.resolve_product_modifiers(p.id,r.branch_id,'[]')->>'success')::boolean,false) THEN RAISE EXCEPTION 'QR_PRODUCT_UNAVAILABLE'; END IF;
      IF round(p.sale_price,2)<>(i->>'price')::numeric THEN RAISE EXCEPTION 'QR_PRICE_CHANGED'; END IF;
    END LOOP;
    SELECT count(*) INTO n FROM public.orders WHERE table_id=t.id AND status IN ('open','held')
      AND EXISTS(SELECT 1 FROM public.order_items WHERE order_id=orders.id AND quantity>0);
    IF n>1 THEN RAISE EXCEPTION 'QR_AMBIGUOUS_TABLE'; END IF;
    SELECT * INTO o FROM public.orders WHERE table_id=t.id AND status IN ('open','held')
      AND EXISTS(SELECT 1 FROM public.order_items WHERE order_id=orders.id AND quantity>0) FOR UPDATE;
    IF r.target_order_id IS NOT NULL AND r.target_order_id IS DISTINCT FROM o.id THEN RAISE EXCEPTION 'QR_TABLE_SESSION_CHANGED'; END IF;
    IF o.id IS NOT NULL THEN
      IF o.branch_id<>r.branch_id OR o.order_type<>'dine_in' OR (o.cashier_id IS DISTINCT FROM auth.uid() AND NOT public.can_manage_other_pos_orders()) THEN RAISE EXCEPTION 'QR_ORDER_OPERATOR_REQUIRED'; END IF;
      FOR i IN SELECT value FROM jsonb_array_elements(r.items) LOOP
        -- Match the POS cart configuration without changing sent quantities or prior discounts.
        SELECT oi.id INTO matched_item FROM public.order_items oi
          WHERE oi.order_id=o.id AND oi.product_id=(i->>'product_id')::uuid AND oi.unit_name='piece'
            AND oi.modifier_option_ids='{}'::uuid[] AND COALESCE(oi.notes,'')=COALESCE(i->>'notes','')
            AND oi.discount_amount=0 AND oi.bonus_quantity=0 AND oi.unit_price=(i->>'price')::numeric
          ORDER BY oi.created_at,oi.id LIMIT 1 FOR UPDATE;
        IF matched_item IS NOT NULL THEN
          UPDATE public.order_items SET quantity=quantity+(i->>'quantity')::numeric WHERE id=matched_item RETURNING unit_price INTO actual_price;
        ELSE
          item_note:=NULLIF(i->>'notes','');
          IF EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.product_id=(i->>'product_id')::uuid
            AND oi.modifier_option_ids='{}'::uuid[] AND COALESCE(oi.notes,'')=COALESCE(item_note,'')) THEN
            item_note:=concat_ws(E'\n',item_note,'[QR '||r.id::text||']');
          END IF;
          INSERT INTO public.order_items(order_id,product_id,unit_name,quantity,unit_price,notes)
            VALUES(o.id,(i->>'product_id')::uuid,'piece',(i->>'quantity')::numeric,(i->>'price')::numeric,item_note) RETURNING unit_price INTO actual_price;
        END IF;
        IF actual_price<>(i->>'price')::numeric THEN RAISE EXCEPTION 'QR_PRICE_CHANGED'; END IF;
      END LOOP;
    ELSE
      PERFORM qr_private.require_staff(r.branch_id,'pos.order.create');
      SELECT jsonb_agg(value||jsonb_build_object('unit_name','piece','unit_price',value->'price')) INTO new_items FROM jsonb_array_elements(r.items);
      result:=public.create_order(p_branch_id=>r.branch_id,p_order_type=>'dine_in',p_table_id=>t.id,p_items=>new_items);
      IF NOT COALESCE((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'QR_CREATE_FAILED: %',result->>'error'; END IF;
      o.id:=(result->>'order_id')::uuid;
    END IF;
    -- Existing authoritative pricing / ownership / totals triggers remain active.
    -- A changed trigger price must roll back the entire acceptance too.
    IF EXISTS(SELECT 1 FROM public.order_items oi JOIN jsonb_array_elements(r.items) line ON oi.product_id=(line.value->>'product_id')::uuid
      WHERE oi.order_id=o.id AND result IS NOT NULL AND oi.unit_price<>(line.value->>'price')::numeric) THEN RAISE EXCEPTION 'QR_PRICE_CHANGED'; END IF;
    -- Item triggers already recalculate totals including existing line discounts and branch tax.
    UPDATE public.orders SET qr_revision=qr_revision+1 WHERE id=o.id;
  END IF;
  UPDATE qr_private.requests SET status=CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
    order_id=o.id,decided_by=auth.uid(),decided_at=now() WHERE id=p_id RETURNING * INTO r;
  RETURN jsonb_build_object('status',r.status,'order_id',r.order_id);
END $$;

CREATE FUNCTION public.qr_menu(p_token text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.menu(p_token) $$;
CREATE FUNCTION public.qr_submit(p_token text,p_key uuid,p_items jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.submit(p_token,p_key,p_items) $$;
CREATE FUNCTION public.qr_configure(p_branch uuid,p_products uuid[]) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.configure(p_branch,p_products) $$;
CREATE FUNCTION public.qr_rotate(p_table uuid,p_enabled boolean) RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.rotate(p_table,p_enabled) $$;
CREATE FUNCTION public.qr_inbox(p_branch uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.inbox(p_branch) $$;
CREATE FUNCTION public.qr_decide(p_id uuid,p_accept boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.decide(p_id,p_accept) $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qr_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.qr_menu(text),public.qr_submit(text,uuid,jsonb),public.qr_configure(uuid,uuid[]),public.qr_rotate(uuid,boolean),public.qr_inbox(uuid),public.qr_decide(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.menu(text),qr_private.submit(text,uuid,jsonb),public.qr_menu(text),public.qr_submit(text,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.configure(uuid,uuid[]),qr_private.rotate(uuid,boolean),qr_private.inbox(uuid),qr_private.decide(uuid,boolean),public.qr_configure(uuid,uuid[]),public.qr_rotate(uuid,boolean),public.qr_inbox(uuid),public.qr_decide(uuid,boolean) TO authenticated;

-- Keep ordinary POS full-cart saves from silently dropping newly accepted lines.
CREATE FUNCTION qr_private.save_order(p_revision bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; result jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id=(p_payload->>'p_order_id')::uuid FOR UPDATE;
  PERFORM qr_private.require_staff(o.branch_id,'pos.order.edit');
  IF o.id IS NULL OR p_revision IS DISTINCT FROM o.qr_revision THEN RAISE EXCEPTION 'QR_ORDER_REFRESH_REQUIRED'; END IF;
  PERFORM set_config('app.qr_revision',o.qr_revision::text,true);
  result:=public.update_order(o.id,COALESCE(p_payload->>'p_order_type','dine_in'),
    (p_payload->>'p_table_id')::uuid,(p_payload->>'p_customer_id')::uuid,
    (p_payload->>'p_guest_count')::integer,p_payload->>'p_notes',p_payload->'p_items',
    COALESCE((p_payload->>'p_subtotal')::numeric,0),COALESCE((p_payload->>'p_discount_amount')::numeric,0),
    COALESCE(p_payload->>'p_discount_type','amount'),COALESCE((p_payload->>'p_tax_amount')::numeric,0),
    COALESCE((p_payload->>'p_total')::numeric,0),COALESCE(p_payload->>'p_status','held'));
  PERFORM set_config('app.qr_revision','',true);
  RETURN result;
END $$;
CREATE FUNCTION public.qr_save_order(p_revision bigint,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.save_order(p_revision,p_payload) $$;
REVOKE ALL ON FUNCTION qr_private.save_order(bigint,jsonb),public.qr_save_order(bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.save_order(bigint,jsonb),public.qr_save_order(bigint,jsonb) TO authenticated;

-- Drift-checked patches preserve the deployed permission / kitchen contracts.
DO $patch$
DECLARE def text; anchor text;
BEGIN
  SELECT pg_get_functiondef('public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)'::regprocedure) INTO def;
  anchor:=E'BEGIN\n  BEGIN\n';
  IF position(anchor IN def)=0 THEN RAISE EXCEPTION 'QR update_order drift: review required'; END IF;
  EXECUTE replace(def,anchor,anchor||$guard$
    PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND qr_revision>0
      AND qr_revision::text IS DISTINCT FROM current_setting('app.qr_revision',true)) THEN
      RETURN jsonb_build_object('success',false,'error','QR_ORDER_REFRESH_REQUIRED');
    END IF;
$guard$);
  SELECT pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure) INTO def;
  anchor:=E'    IF p_table_id IS NOT NULL AND NOT EXISTS (';
  IF position(anchor IN def)=0 THEN RAISE EXCEPTION 'QR create_order drift: review required'; END IF;
  EXECUTE replace(def,anchor,E'    PERFORM 1 FROM public.dining_tables WHERE id=p_table_id FOR UPDATE;\n'||anchor);
END $patch$;

CREATE FUNCTION qr_private.configuration(p_branch uuid)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM qr_private.require_staff(p_branch,'floor_plan.manage');
  RETURN ARRAY(SELECT product_id FROM qr_private.menu_products WHERE branch_id=p_branch);
END $$;
CREATE FUNCTION public.qr_configuration(p_branch uuid) RETURNS uuid[] LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.configuration(p_branch) $$;
REVOKE ALL ON FUNCTION qr_private.configuration(uuid),public.qr_configuration(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.configuration(uuid),public.qr_configuration(uuid) TO authenticated;
COMMIT;
