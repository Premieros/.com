BEGIN;
-- Branch-owned settings and immutable customer choice; assignment is audited separately.
CREATE TABLE qr_private.branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  appearance jsonb NOT NULL DEFAULT '{}',
  reviewer_roles text[] NOT NULL DEFAULT '{}',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qr_private.branch_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_private.branch_settings FROM PUBLIC,anon,authenticated;
ALTER TABLE qr_private.requests ADD COLUMN requested_table_id uuid REFERENCES public.dining_tables(id) ON DELETE CASCADE,
  ADD COLUMN assigned_table_id uuid REFERENCES public.dining_tables(id) ON DELETE SET NULL;
UPDATE qr_private.requests SET requested_table_id=table_id,
  assigned_table_id=CASE WHEN status='accepted' THEN table_id END;
ALTER TABLE qr_private.requests ALTER COLUMN requested_table_id SET NOT NULL;
CREATE UNIQUE INDEX qr_request_generation_key ON qr_private.requests(generation,request_key);

CREATE FUNCTION qr_private.require_settings(p_branch uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF COALESCE(public.can_permission('settings.manage'),false) THEN
    PERFORM qr_private.require_staff(p_branch,'settings.manage');
  ELSE
    PERFORM qr_private.require_staff(p_branch,'floor_plan.manage');
  END IF;
END $$;

-- Availability is advisory for guests; review checks it again under table locks.
CREATE FUNCTION qr_private.tables(p_branch uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'busy',
    d.status::text<>'vacant' OR EXISTS(SELECT 1 FROM public.orders o WHERE o.table_id=d.id AND o.status IN ('open','held')
      AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0))) ORDER BY d.name),'[]')
  FROM public.dining_tables d WHERE d.branch_id=p_branch AND d.is_active
$$;

CREATE FUNCTION qr_private.settings(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM qr_private.require_settings(p_branch);
  SELECT jsonb_build_object('enabled',enabled,'appearance',appearance,'reviewer_roles',reviewer_roles)
    INTO result FROM qr_private.branch_settings WHERE branch_id=p_branch;
  RETURN COALESCE(result,'{"enabled":true,"appearance":{},"reviewer_roles":[]}'::jsonb);
END $$;

CREATE FUNCTION qr_private.save_settings(p_branch uuid,p_enabled boolean,p_appearance jsonb,p_roles text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE clean jsonb;
BEGIN
  PERFORM qr_private.require_settings(p_branch);
  PERFORM 1 FROM public.branches WHERE id=p_branch FOR UPDATE;
  IF p_enabled IS NULL OR jsonb_typeof(p_appearance) IS DISTINCT FROM 'object' OR octet_length(p_appearance::text)>8000
    OR p_roles IS NULL OR cardinality(p_roles)>40 OR EXISTS(SELECT 1 FROM unnest(p_roles) x WHERE x IS NULL OR length(x)>100)
  THEN RAISE EXCEPTION 'QR_SETTINGS_INVALID'; END IF;
  -- Only presentational fields are public; no arbitrary configuration can leak.
  SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO clean FROM jsonb_each(p_appearance)
    WHERE key IN ('brand_name','subtitle','logo_url','banner_image_url','banner_text') AND jsonb_typeof(value)='string';
  IF EXISTS(SELECT 1 FROM jsonb_each_text(clean) WHERE (key LIKE '%url' AND value<>'' AND value !~ '^https://') OR length(value)>1500)
    THEN RAISE EXCEPTION 'QR_SETTINGS_INVALID'; END IF;
  INSERT INTO qr_private.branch_settings(branch_id,enabled,appearance,reviewer_roles,updated_by)
    VALUES(p_branch,p_enabled,clean,p_roles,auth.uid())
    ON CONFLICT(branch_id) DO UPDATE SET enabled=excluded.enabled,appearance=excluded.appearance,
      reviewer_roles=excluded.reviewer_roles,updated_by=excluded.updated_by,updated_at=now();
END $$;

CREATE FUNCTION qr_private.may_review(p_branch uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE(public.can_permission('pos.order.edit'),false) AND EXISTS(
    SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.is_active AND
      (u.role::text='super_admin' OR COALESCE(cardinality((SELECT reviewer_roles FROM qr_private.branch_settings WHERE branch_id=p_branch)),0)=0
        OR u.role::text=ANY((SELECT reviewer_roles FROM qr_private.branch_settings WHERE branch_id=p_branch)::text[])))
$$;

CREATE FUNCTION qr_private.routing(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM qr_private.require_staff(p_branch,'pos.view');
  RETURN jsonb_build_object('tables',qr_private.tables(p_branch),'can_review',qr_private.may_review(p_branch));
END $$;

CREATE FUNCTION qr_private.review(p_id uuid,p_accept boolean,p_table uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r qr_private.requests; target uuid; result jsonb;
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
    IF EXISTS(SELECT 1 FROM public.dining_tables WHERE id=target AND status::text<>'vacant')
      OR EXISTS(SELECT 1 FROM public.orders o WHERE o.table_id=target AND o.status IN ('open','held')
        AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0)) THEN RAISE EXCEPTION 'QR_TABLE_BUSY'; END IF;
    -- Keep the original requested table for audit. Never append to an unrelated bill.
    UPDATE qr_private.requests SET table_id=target,target_order_id=NULL,assigned_table_id=target WHERE id=p_id;
  END IF;
  result:=qr_private.decide(p_id,p_accept);
  RETURN result;
END $$;

CREATE FUNCTION qr_private.submit_selected(p_token text, p_key uuid, p_items jsonb, p_table uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.dining_tables; l qr_private.table_links; r qr_private.requests;
  i jsonb; p public.products; snapshot jsonb := '[]'; canonical jsonb; origin_id uuid;
BEGIN
  IF p_key IS NULL OR p_token IS NULL OR length(p_token)<>64 THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 OR octet_length(p_items::text)>16000 THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
  SELECT table_id INTO origin_id FROM qr_private.table_links WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF origin_id IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  -- Stable lock order also serializes key reuse across different selected tables.
  PERFORM 1 FROM public.dining_tables WHERE id IN (origin_id,COALESCE(p_table,origin_id)) ORDER BY id FOR UPDATE;
  SELECT * INTO l FROM qr_private.table_links WHERE table_id=origin_id;
  SELECT * INTO t FROM public.dining_tables WHERE id=COALESCE(p_table,origin_id);
  IF NOT l.enabled OR l.token_hash<>encode(sha256(convert_to(p_token,'UTF8')),'hex')
    OR NOT EXISTS(SELECT 1 FROM public.dining_tables d WHERE d.id=origin_id AND d.branch_id=l.branch_id AND d.is_active)
    OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=l.branch_id AND is_active) THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  IF t.id IS NULL OR t.branch_id<>l.branch_id OR NOT t.is_active THEN RAISE EXCEPTION 'QR_TABLE_INVALID'; END IF;
  IF NOT COALESCE((SELECT enabled FROM qr_private.branch_settings WHERE branch_id=l.branch_id),true) THEN RAISE EXCEPTION 'QR_DISABLED'; END IF;
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
  SELECT * INTO r FROM qr_private.requests WHERE generation=l.generation AND request_key=p_key;
  IF r.id IS NOT NULL THEN
    IF r.payload<>canonical OR r.requested_table_id<>t.id THEN RAISE EXCEPTION 'QR_IDEMPOTENCY_CONFLICT'; END IF;
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
  INSERT INTO qr_private.requests(table_id,requested_table_id,branch_id,generation,request_key,payload,items,target_order_id)
    VALUES(t.id,t.id,t.branch_id,l.generation,p_key,canonical,snapshot,
      (SELECT o.id FROM public.orders o WHERE o.table_id=t.id AND o.status IN ('open','held')
        AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0))) RETURNING * INTO r;
  RETURN jsonb_build_object('id',r.id,'status',r.status);
END $$;

CREATE OR REPLACE FUNCTION qr_private.menu(p_token text)
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
  IF NOT COALESCE((SELECT enabled FROM qr_private.branch_settings WHERE branch_id=t.branch_id),true) THEN RAISE EXCEPTION 'QR_DISABLED'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
    'price',round(p.sale_price,2),'image_url',p.image_url,'category_id',p.category_id,'category_name',c.name) ORDER BY p.name),'[]') INTO result
    FROM public.products p JOIN qr_private.menu_products m ON m.product_id=p.id AND m.branch_id=p.branch_id
    LEFT JOIN public.categories c ON c.id=p.category_id AND c.branch_id=p.branch_id
    WHERE p.branch_id=t.branch_id AND p.is_active AND p.sale_price>=0
      AND NOT EXISTS(SELECT 1 FROM public.product_modifier_group_products gp JOIN public.product_modifier_groups g ON g.id=gp.group_id
        WHERE gp.product_id=p.id AND gp.branch_id=t.branch_id AND g.branch_id=t.branch_id AND g.is_active AND g.min_selections>0);
  RETURN jsonb_build_object('table_name',t.name,'table_id',t.id,'products',result,
    'branch_name',(SELECT name FROM public.branches WHERE id=t.branch_id),
    'appearance',COALESCE((SELECT appearance FROM qr_private.branch_settings WHERE branch_id=t.branch_id),'{}'::jsonb),
    'currency',COALESCE(NULLIF((SELECT currency FROM public.branch_settings WHERE branch_id=t.branch_id),''),'ج.م'),
    'tables',qr_private.tables(t.branch_id));
END $$;

CREATE OR REPLACE FUNCTION qr_private.configure(p_branch uuid, p_products uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM qr_private.require_settings(p_branch);
  PERFORM 1 FROM public.branches WHERE id=p_branch FOR UPDATE;
  IF p_products IS NULL OR cardinality(p_products)>1000 OR EXISTS(
    SELECT 1 FROM unnest(p_products) id WHERE NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=id AND p.branch_id=p_branch AND p.is_active)
  ) THEN RAISE EXCEPTION 'QR_PRODUCT_UNAVAILABLE'; END IF;
  DELETE FROM qr_private.menu_products WHERE branch_id=p_branch;
  INSERT INTO qr_private.menu_products SELECT DISTINCT id,p_branch FROM unnest(p_products) id;
END $$;

CREATE OR REPLACE FUNCTION qr_private.rotate(p_table uuid, p_enabled boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.dining_tables; token text;
BEGIN
  SELECT * INTO t FROM public.dining_tables WHERE id=p_table FOR UPDATE;
  PERFORM qr_private.require_settings(t.branch_id);
  IF t.id IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  -- Two independent random UUIDs provide >240 bits of entropy; only SHA256 stored.
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  INSERT INTO qr_private.table_links(table_id,branch_id,token_hash,enabled) VALUES(t.id,t.branch_id,encode(sha256(convert_to(token,'UTF8')),'hex'),p_enabled)
    ON CONFLICT(table_id) DO UPDATE SET branch_id=excluded.branch_id,token_hash=excluded.token_hash,enabled=excluded.enabled,generation=gen_random_uuid();
  RETURN CASE WHEN p_enabled THEN token ELSE NULL END;
END $$;

CREATE OR REPLACE FUNCTION qr_private.configuration(p_branch uuid)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM qr_private.require_settings(p_branch);
  RETURN ARRAY(SELECT product_id FROM qr_private.menu_products WHERE branch_id=p_branch);
END $$;

-- Legacy links and clients retain their default table, with the same branch controls.
CREATE OR REPLACE FUNCTION qr_private.submit(p_token text,p_key uuid,p_items jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT qr_private.submit_selected(p_token,p_key,p_items,NULL) $$;
CREATE OR REPLACE FUNCTION public.qr_decide(p_id uuid,p_accept boolean) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.review(p_id,p_accept,NULL) $$;
CREATE FUNCTION public.qr_submit_selected(p_token text,p_key uuid,p_items jsonb,p_table uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.submit_selected(p_token,p_key,p_items,p_table) $$;
CREATE FUNCTION public.qr_review(p_id uuid,p_accept boolean,p_table uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.review(p_id,p_accept,p_table) $$;
CREATE FUNCTION public.qr_routing(p_branch uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.routing(p_branch) $$;
CREATE FUNCTION public.qr_settings(p_branch uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.settings(p_branch) $$;
CREATE FUNCTION public.qr_save_settings(p_branch uuid,p_enabled boolean,p_appearance jsonb,p_roles text[]) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.save_settings(p_branch,p_enabled,p_appearance,p_roles) $$;
REVOKE ALL ON FUNCTION qr_private.require_settings(uuid),qr_private.tables(uuid),qr_private.settings(uuid),
  qr_private.save_settings(uuid,boolean,jsonb,text[]),qr_private.may_review(uuid),qr_private.routing(uuid),
  qr_private.review(uuid,boolean,uuid),qr_private.submit_selected(text,uuid,jsonb,uuid),qr_private.decide(uuid,boolean),
  public.qr_submit_selected(text,uuid,jsonb,uuid),public.qr_review(uuid,boolean,uuid),public.qr_routing(uuid),
  public.qr_settings(uuid),public.qr_save_settings(uuid,boolean,jsonb,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.submit_selected(text,uuid,jsonb,uuid),public.qr_submit_selected(text,uuid,jsonb,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.review(uuid,boolean,uuid),qr_private.routing(uuid),qr_private.settings(uuid),
  qr_private.save_settings(uuid,boolean,jsonb,text[]),public.qr_review(uuid,boolean,uuid),public.qr_routing(uuid),
  public.qr_settings(uuid),public.qr_save_settings(uuid,boolean,jsonb,text[]) TO authenticated;
COMMIT;
