-- Stable, branch-wide QR. Never rotate the branch secret during reprints.
-- The private table retains the original token for authorized reprints only.
-- Legacy per-table QR codes and their hashes remain unchanged.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='45s';

CREATE TABLE IF NOT EXISTS qr_private.branch_qr_links (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  anchor_table_id uuid REFERENCES public.dining_tables(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE CHECK (token ~ '^[a-f0-9]{64}$'),
  token_hash text NOT NULL UNIQUE,
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qr_private.branch_qr_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE qr_private.branch_qr_links FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION qr_private.branch_code(p_branch uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_token text; v_table uuid;
BEGIN
  PERFORM qr_private.require_settings(p_branch);
  -- Concurrent first-generation requests get exactly the same permanent token.
  PERFORM pg_advisory_xact_lock(hashtextextended('branch_qr:'||p_branch::text,0));
  SELECT token INTO v_token FROM qr_private.branch_qr_links WHERE branch_id=p_branch;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;
  SELECT id INTO v_table FROM public.dining_tables
  WHERE branch_id=p_branch AND is_active
  ORDER BY id LIMIT 1;
  IF v_table IS NULL THEN RAISE EXCEPTION 'QR_NO_ACTIVE_TABLES'; END IF;
  v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  INSERT INTO qr_private.branch_qr_links(branch_id,anchor_table_id,token,token_hash)
    VALUES (p_branch,v_table,v_token,encode(sha256(convert_to(v_token,'UTF8')),'hex'));
  RETURN v_token;
END $fn$;
REVOKE ALL ON FUNCTION qr_private.branch_code(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.qr_branch_code(p_branch uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $fn$ SELECT qr_private.branch_code(p_branch) $fn$;
REVOKE ALL ON FUNCTION public.qr_branch_code(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qr_branch_code(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION qr_private.guest_scope(p_token text, p_session text)
 RETURNS qr_private.table_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE l qr_private.table_links;
BEGIN
 IF p_token IS NULL OR length(p_token)<>64 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
 SELECT q.* INTO l FROM qr_private.table_links q JOIN public.dining_tables d ON d.id=q.table_id AND d.branch_id=q.branch_id
 JOIN public.branches b ON b.id=q.branch_id WHERE q.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') AND q.enabled AND d.is_active AND b.is_active;
 -- A permanent branch QR resolves to a current branch table only as a
 -- technical origin; guests still choose their own table.
 IF l.table_id IS NULL THEN
   SELECT d.id, bl.branch_id, bl.token_hash, true, bl.generation INTO l
   FROM qr_private.branch_qr_links bl
   JOIN public.branches b ON b.id=bl.branch_id AND b.is_active
   JOIN LATERAL (
     SELECT id FROM public.dining_tables
     WHERE branch_id=bl.branch_id
     ORDER BY (id=bl.anchor_table_id) DESC, is_active DESC, id LIMIT 1
   ) d ON true
   WHERE bl.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 END IF;
 IF l.table_id IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
 RETURN l;
END $function$


CREATE OR REPLACE FUNCTION qr_private.menu_core(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t public.dining_tables; result jsonb; v_branch_link boolean:=false;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  SELECT d.* INTO t FROM public.dining_tables d
    JOIN qr_private.table_links l ON l.table_id=d.id
    JOIN public.branches b ON b.id=d.branch_id
    WHERE l.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
      AND l.enabled AND l.branch_id=d.branch_id AND d.is_active AND b.is_active;
  IF t.id IS NULL THEN
    SELECT d.* INTO t FROM qr_private.branch_qr_links bl
    JOIN public.branches b ON b.id=bl.branch_id AND b.is_active
    JOIN LATERAL (
      SELECT * FROM public.dining_tables
      WHERE branch_id=bl.branch_id
      ORDER BY (id=bl.anchor_table_id) DESC,is_active DESC,id LIMIT 1
    ) d ON true
    WHERE bl.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
    v_branch_link:=t.id IS NOT NULL;
  END IF;
  IF t.id IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  IF NOT COALESCE((SELECT enabled FROM qr_private.branch_settings WHERE branch_id=t.branch_id),true) THEN RAISE EXCEPTION 'QR_DISABLED'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
    'price',round(p.sale_price,2),'image_url',p.image_url,'category_id',p.category_id,'category_name',c.name) ORDER BY p.name),'[]') INTO result
    FROM public.products p JOIN qr_private.menu_products m ON m.product_id=p.id AND m.branch_id=p.branch_id
    LEFT JOIN public.categories c ON c.id=p.category_id AND c.branch_id=p.branch_id
    WHERE p.branch_id=t.branch_id AND p.is_active AND p.sale_price>=0
      AND NOT EXISTS(SELECT 1 FROM public.product_modifier_group_products gp JOIN public.product_modifier_groups g ON g.id=gp.group_id
        WHERE gp.product_id=p.id AND gp.branch_id=t.branch_id AND g.branch_id=t.branch_id AND g.is_active AND g.min_selections>0);
  RETURN jsonb_build_object('table_name',CASE WHEN v_branch_link THEN 'اختر طاولتك' ELSE t.name END,'table_id',CASE WHEN v_branch_link THEN NULL ELSE t.id END,'products',result,
    'branch_name',(SELECT name FROM public.branches WHERE id=t.branch_id),
    'appearance',COALESCE((SELECT appearance FROM qr_private.branch_settings WHERE branch_id=t.branch_id),'{}'::jsonb),
    'currency',COALESCE(NULLIF((SELECT currency FROM public.branch_settings WHERE branch_id=t.branch_id),''),'ج.م'),
    'tables',qr_private.tables(t.branch_id));
END $function$


CREATE OR REPLACE FUNCTION qr_private.submit_selected_core(p_token text, p_key uuid, p_items jsonb, p_table uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t public.dining_tables; l qr_private.table_links; r qr_private.requests;
  i jsonb; p public.products; snapshot jsonb := '[]'; canonical jsonb; origin_id uuid;
BEGIN
  IF p_key IS NULL OR p_token IS NULL OR length(p_token)<>64 THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 OR octet_length(p_items::text)>16000 THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
  SELECT table_id INTO origin_id FROM qr_private.table_links WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF origin_id IS NULL THEN
    SELECT d.id INTO origin_id FROM qr_private.branch_qr_links bl
    JOIN LATERAL (
      SELECT id FROM public.dining_tables
      WHERE branch_id=bl.branch_id
      ORDER BY (id=bl.anchor_table_id) DESC,is_active DESC,id LIMIT 1
    ) d ON true
    WHERE bl.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
    IF p_table IS NULL THEN RAISE EXCEPTION 'QR_TABLE_INVALID'; END IF;
  END IF;
  IF origin_id IS NULL THEN RAISE EXCEPTION 'QR_LINK_INVALID'; END IF;
  -- Stable lock order also serializes key reuse across different selected tables.
  PERFORM 1 FROM public.dining_tables WHERE id IN (origin_id,COALESCE(p_table,origin_id)) ORDER BY id FOR UPDATE;
  l:=qr_private.guest_scope(p_token,repeat('0',64));
  SELECT * INTO t FROM public.dining_tables WHERE id=COALESCE(p_table,origin_id);
  IF NOT l.enabled OR l.token_hash<>encode(sha256(convert_to(p_token,'UTF8')),'hex')
    OR (NOT EXISTS(SELECT 1 FROM public.dining_tables d WHERE d.id=origin_id AND d.branch_id=l.branch_id AND d.is_active)
        AND NOT EXISTS(SELECT 1 FROM qr_private.branch_qr_links bl WHERE bl.branch_id=l.branch_id AND bl.token_hash=l.token_hash))
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
END $function$;
