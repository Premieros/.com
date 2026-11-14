BEGIN;
ALTER TABLE qr_private.branch_settings ADD COLUMN checkin_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE qr_private.customer_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,phone text NOT NULL,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(branch_id,phone));
CREATE TABLE qr_private.visits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 generation uuid NOT NULL,profile_id uuid NOT NULL REFERENCES qr_private.customer_profiles(id) ON DELETE CASCADE,guest_hash text NOT NULL UNIQUE,
 origin_table_id uuid NOT NULL REFERENCES public.dining_tables(id) ON DELETE CASCADE,order_type text NOT NULL CHECK(order_type IN('dine_in','delivery')),
 table_id uuid REFERENCES public.dining_tables(id) ON DELETE CASCADE,address text,photo_data text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','active','closed')),
 order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,pin_salt text,pin_hash text,pin_failures integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',closed_at timestamptz,
 CHECK((order_type='dine_in' AND table_id IS NOT NULL) OR (order_type='delivery' AND table_id IS NULL))
);
CREATE UNIQUE INDEX qr_one_live_visit ON qr_private.visits(profile_id) WHERE status IN('pending','active');
CREATE INDEX qr_visits_branch_created ON qr_private.visits(branch_id,created_at);
CREATE INDEX qr_visits_order ON qr_private.visits(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX qr_visits_origin ON qr_private.visits(origin_table_id);
CREATE INDEX qr_visits_table ON qr_private.visits(table_id) WHERE table_id IS NOT NULL;
ALTER TABLE qr_private.requests ADD COLUMN visit_id uuid REFERENCES qr_private.visits(id) ON DELETE CASCADE,ADD COLUMN order_type text NOT NULL DEFAULT 'dine_in';
ALTER TABLE qr_private.requests ALTER COLUMN table_id DROP NOT NULL,ALTER COLUMN requested_table_id DROP NOT NULL;
ALTER TABLE qr_private.service_calls ADD COLUMN visit_id uuid REFERENCES qr_private.visits(id) ON DELETE CASCADE;
ALTER TABLE qr_private.service_calls ALTER COLUMN table_id DROP NOT NULL,ALTER COLUMN requested_table_id DROP NOT NULL;
CREATE INDEX qr_requests_visit ON qr_private.requests(visit_id);
CREATE INDEX qr_calls_visit ON qr_private.service_calls(visit_id);
ALTER TABLE qr_private.customer_profiles ENABLE ROW LEVEL SECURITY;ALTER TABLE qr_private.visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_private.customer_profiles,qr_private.visits FROM PUBLIC,anon,authenticated;

CREATE FUNCTION qr_private.phone(p_phone text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE p text;
BEGIN
 p:=regexp_replace(translate(COALESCE(p_phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[[:space:]()-]','','g');
 IF p ~ '^01[0-9]{9}$' THEN p:='+20'||substring(p FROM 2); ELSIF p LIKE '00%' THEN p:='+'||substring(p FROM 3); ELSIF p ~ '^[1-9][0-9]{9,14}$' THEN p:='+'||p; END IF;
 IF p !~ '^\+[1-9][0-9]{9,14}$' THEN RAISE EXCEPTION 'QR_PHONE_INVALID'; END IF; RETURN p;
END $$;
CREATE FUNCTION qr_private.checkin_enabled(p_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;
BEGIN l:=qr_private.guest_scope(p_token,repeat('0',64));RETURN COALESCE((SELECT checkin_enabled FROM qr_private.branch_settings WHERE branch_id=l.branch_id),false);END $$;
CREATE FUNCTION qr_private.visit(p_token text,p_session text) RETURNS qr_private.visits LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links; v qr_private.visits;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session);
 SELECT * INTO v FROM qr_private.visits WHERE guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND branch_id=l.branch_id AND generation=l.generation;
 IF v.id IS NULL THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED'; END IF;
 IF v.status='closed' OR v.expires_at<=now() THEN RAISE EXCEPTION 'QR_VISIT_CLOSED'; END IF;RETURN v;
END $$;
CREATE FUNCTION qr_private.visit_view(v qr_private.visits) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',v.id,'order_type',v.order_type,'table_id',v.table_id,'status',v.status,'pin_set',v.pin_hash IS NOT NULL,
 'has_request',EXISTS(SELECT 1 FROM qr_private.requests WHERE visit_id=v.id),'table_name',(SELECT name FROM public.dining_tables WHERE id=v.table_id),'phone',(SELECT phone FROM qr_private.customer_profiles WHERE id=v.profile_id))
$$;
CREATE FUNCTION qr_private.entry(p_token text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;v qr_private.visits;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session);
 IF NOT qr_private.checkin_enabled(p_token) THEN RETURN jsonb_build_object('enabled',false); END IF;
 SELECT * INTO v FROM qr_private.visits WHERE guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND branch_id=l.branch_id AND generation=l.generation;
 RETURN jsonb_build_object('enabled',true,'branch_name',(SELECT name FROM public.branches WHERE id=l.branch_id),'tables',qr_private.tables(l.branch_id),
  'visit',CASE WHEN v.status IN('pending','active') AND v.expires_at>now() THEN qr_private.visit_view(v) END,'closed',v.id IS NOT NULL AND (v.status='closed' OR v.expires_at<=now()));
END $$;
CREATE FUNCTION qr_private.lookup(p_token text,p_session text,p_phone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;p qr_private.customer_profiles;v qr_private.visits;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session); SELECT * INTO p FROM qr_private.customer_profiles WHERE branch_id=l.branch_id AND phone=qr_private.phone(p_phone);
 SELECT * INTO v FROM qr_private.visits WHERE profile_id=p.id AND status IN('pending','active') AND expires_at>now();
 IF v.guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND v.generation=l.generation THEN RETURN jsonb_build_object('registered',true,'visit',qr_private.visit_view(v)); END IF;
 RETURN jsonb_build_object('registered',p.id IS NOT NULL,'needs_pin',v.id IS NOT NULL,'pin_set',v.pin_hash IS NOT NULL);
END $$;
CREATE FUNCTION qr_private.begin_visit(p_token text,p_session text,p_phone text,p_name text,p_type text,p_table uuid,p_photo text,p_address text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;p qr_private.customer_profiles;v qr_private.visits;v_phone text;h text;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session);IF NOT qr_private.checkin_enabled(p_token) THEN RAISE EXCEPTION 'QR_DISABLED'; END IF;
 v_phone:=qr_private.phone(p_phone);h:=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 -- Serialize branch check-ins to bound image storage and concurrent phone claims.
 PERFORM pg_advisory_xact_lock(hashtextextended('qr_checkin:'||l.branch_id::text,0));
 SELECT * INTO v FROM qr_private.visits WHERE guest_hash=h;
 IF v.id IS NOT NULL THEN
  IF v.status='closed' OR v.expires_at<=now() THEN RAISE EXCEPTION 'QR_VISIT_CLOSED'; END IF;
  IF v.branch_id<>l.branch_id OR v.generation<>l.generation OR (SELECT x.phone FROM qr_private.customer_profiles x WHERE x.id=v.profile_id)<>v_phone THEN RAISE EXCEPTION 'QR_SESSION_CONFLICT'; END IF;
  RETURN qr_private.visit_view(v);
 END IF;
 IF p_type IS NULL OR p_type NOT IN('dine_in','delivery') THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
 IF p_type='dine_in' THEN
  IF NOT EXISTS(SELECT 1 FROM public.dining_tables WHERE id=p_table AND branch_id=l.branch_id AND is_active) THEN RAISE EXCEPTION 'QR_TABLE_INVALID'; END IF;
  IF p_photo IS NULL OR length(p_photo) NOT BETWEEN 40 AND 180000 OR p_photo !~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+$' THEN RAISE EXCEPTION 'QR_PHOTO_REQUIRED'; END IF;
 ELSE
  IF p_table IS NOT NULL OR length(trim(COALESCE(p_address,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'QR_ADDRESS_REQUIRED'; END IF;
 END IF;
 SELECT * INTO p FROM qr_private.customer_profiles WHERE branch_id=l.branch_id AND qr_private.customer_profiles.phone=v_phone FOR UPDATE;
 IF p.id IS NULL THEN
  IF length(trim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 100 OR p_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'QR_NAME_REQUIRED'; END IF;
  INSERT INTO qr_private.customer_profiles(branch_id,phone,name) VALUES(l.branch_id,v_phone,trim(p_name)) RETURNING * INTO p;
 END IF;
 UPDATE qr_private.visits SET status='closed',closed_at=now(),photo_data=NULL WHERE profile_id=p.id AND status IN('pending','active') AND expires_at<=now();
 IF EXISTS(SELECT 1 FROM qr_private.visits WHERE profile_id=p.id AND status IN('pending','active')) THEN RAISE EXCEPTION 'QR_PIN_REQUIRED'; END IF;
 IF (SELECT count(*) FROM qr_private.visits WHERE branch_id=l.branch_id AND created_at>now()-interval '1 minute')>=30 THEN RAISE EXCEPTION 'QR_RATE_LIMITED';END IF;
 INSERT INTO qr_private.visits(branch_id,generation,profile_id,guest_hash,origin_table_id,order_type,table_id,address,photo_data)
 VALUES(l.branch_id,l.generation,p.id,h,l.table_id,p_type,CASE WHEN p_type='dine_in' THEN p_table END,CASE WHEN p_type='delivery' THEN trim(p_address) END,CASE WHEN p_type='dine_in' THEN p_photo END) RETURNING * INTO v;
 RETURN qr_private.visit_view(v);
END $$;
CREATE FUNCTION qr_private.resume_visit(p_token text,p_session text,p_phone text,p_pin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;v qr_private.visits;h text;locked_table uuid;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session);h:=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 SELECT x.* INTO v FROM qr_private.visits x JOIN qr_private.customer_profiles p ON p.id=x.profile_id
 WHERE p.branch_id=l.branch_id AND p.phone=qr_private.phone(p_phone) AND x.status IN('pending','active') AND x.expires_at>now();
 IF v.id IS NOT NULL THEN
  locked_table:=v.table_id;PERFORM 1 FROM public.dining_tables WHERE id IN(v.origin_table_id,v.table_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v FROM qr_private.visits WHERE id=v.id FOR UPDATE;
  IF v.table_id IS DISTINCT FROM locked_table THEN RETURN jsonb_build_object('success',false,'error','QR_RETRY');END IF;
 END IF;
 IF v.id IS NULL OR v.status='closed' OR v.expires_at<=now() OR v.generation<>l.generation THEN RETURN jsonb_build_object('success',false,'error','QR_PIN_INVALID'); END IF;
 IF v.guest_hash=h THEN RETURN jsonb_build_object('success',true,'visit',qr_private.visit_view(v)); END IF;
 IF v.pin_failures>=3 THEN RETURN jsonb_build_object('success',false,'error','QR_PIN_LOCKED'); END IF;
 IF p_pin IS NULL OR p_pin !~ '^[0-9]{2}$' OR v.pin_hash IS NULL OR encode(sha256(convert_to(v.pin_salt||p_pin,'UTF8')),'hex')<>v.pin_hash THEN
  UPDATE qr_private.visits SET pin_failures=pin_failures+1 WHERE id=v.id;
  RETURN jsonb_build_object('success',false,'error',CASE WHEN v.pin_failures>=2 THEN 'QR_PIN_LOCKED' ELSE 'QR_PIN_INVALID' END);
 END IF;
 IF EXISTS(SELECT 1 FROM qr_private.visits WHERE guest_hash=h AND id<>v.id) THEN RETURN jsonb_build_object('success',false,'error','QR_SESSION_CONFLICT'); END IF;
 -- Transfer the private capability to the new device; the former device loses access.
 UPDATE qr_private.visits SET guest_hash=h,pin_failures=0 WHERE id=v.id RETURNING * INTO v;
 UPDATE qr_private.requests SET guest_hash=h WHERE visit_id=v.id;UPDATE qr_private.service_calls SET guest_hash=h WHERE visit_id=v.id;
 RETURN jsonb_build_object('success',true,'visit',qr_private.visit_view(v));
END $$;
CREATE FUNCTION qr_private.new_pin(p_visit uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE code text;salt text;
BEGIN
 code:=lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 100)::text,2,'0');salt:=gen_random_uuid()::text;
 UPDATE qr_private.visits SET pin_salt=salt,pin_hash=encode(sha256(convert_to(salt||code,'UTF8')),'hex'),pin_failures=0 WHERE id=p_visit AND status<>'closed' AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'QR_VISIT_CLOSED'; END IF;RETURN code;
END $$;
ALTER FUNCTION qr_private.menu(text) RENAME TO menu_core;
ALTER FUNCTION qr_private.submit_selected(text,uuid,jsonb,uuid) RENAME TO submit_selected_core;
ALTER FUNCTION qr_private.place(text,text,uuid,jsonb,uuid) RENAME TO place_core;
ALTER FUNCTION qr_private.track(text,text) RENAME TO track_core;
ALTER FUNCTION qr_private.call_service(text,text,uuid,uuid,text,text) RENAME TO call_service_core;
ALTER FUNCTION qr_private.review(uuid,boolean,uuid) RENAME TO review_core;
REVOKE ALL ON FUNCTION qr_private.menu_core(text),qr_private.submit_selected_core(text,uuid,jsonb,uuid),qr_private.place_core(text,text,uuid,jsonb,uuid),qr_private.track_core(text,text),qr_private.call_service_core(text,text,uuid,uuid,text,text),qr_private.review_core(uuid,boolean,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION qr_private.menu(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF qr_private.checkin_enabled(p_token) THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';END IF;RETURN qr_private.menu_core(p_token);END $$;
CREATE FUNCTION qr_private.submit_selected(p_token text,p_key uuid,p_items jsonb,p_table uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF qr_private.checkin_enabled(p_token) THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';END IF;RETURN qr_private.submit_selected_core(p_token,p_key,p_items,p_table);END $$;
CREATE FUNCTION qr_private.place(p_token text,p_session text,p_key uuid,p_items jsonb,p_table uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF qr_private.checkin_enabled(p_token) THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';END IF;RETURN qr_private.place_core(p_token,p_session,p_key,p_items,p_table);END $$;
CREATE FUNCTION qr_private.track(p_token text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF qr_private.checkin_enabled(p_token) THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';END IF;RETURN qr_private.track_core(p_token,p_session);END $$;
CREATE FUNCTION qr_private.call_service(p_token text,p_session text,p_key uuid,p_table uuid,p_kind text,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF qr_private.checkin_enabled(p_token) THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';END IF;RETURN qr_private.call_service_core(p_token,p_session,p_key,p_table,p_kind,p_note);END $$;
CREATE FUNCTION qr_private.guest_menu(p_token text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF qr_private.checkin_enabled(p_token) THEN PERFORM qr_private.visit(p_token,p_session);END IF;RETURN qr_private.menu_core(p_token);END $$;
CREATE FUNCTION qr_private.guest_track(p_token text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v qr_private.visits;l qr_private.table_links;data jsonb;calls jsonb;
BEGIN
 IF NOT qr_private.checkin_enabled(p_token) THEN RETURN qr_private.track_core(p_token,p_session); END IF;
 l:=qr_private.guest_scope(p_token,p_session);
 SELECT * INTO v FROM qr_private.visits WHERE guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND generation=l.generation AND branch_id=l.branch_id;
 IF v.id IS NULL OR v.status='closed' OR v.expires_at<=now() THEN RETURN jsonb_build_object('requests','[]'::jsonb,'bills','[]'::jsonb,'calls','[]'::jsonb,'visit',jsonb_build_object('closed',true));END IF;
 data:=qr_private.track_core(p_token,p_session);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'note',c.note,'status',c.status,'created_at',c.created_at,'table_name',COALESCE(d.name,'توصيل')) ORDER BY c.created_at DESC),'[]') INTO calls
 FROM qr_private.service_calls c LEFT JOIN public.dining_tables d ON d.id=c.table_id WHERE c.visit_id=v.id;
 data:=data||jsonb_build_object('calls',calls,'visit',qr_private.visit_view(v));
 IF v.order_type='delivery' THEN
  data:=jsonb_set(data,'{requests}',COALESCE((SELECT jsonb_agg(value||jsonb_build_object('order_type','delivery','requested_table','توصيل')) FROM jsonb_array_elements(data->'requests')),'[]'));
  data:=jsonb_set(data,'{bills}',COALESCE((SELECT jsonb_agg(value||jsonb_build_object('table_name','طلب توصيل','order_type','delivery')) FROM jsonb_array_elements(data->'bills')),'[]'));
 END IF;RETURN data;
END $$;
CREATE FUNCTION qr_private.guest_place(p_token text,p_session text,p_key uuid,p_items jsonb,p_table uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;v qr_private.visits;r qr_private.requests;i jsonb;p public.products;canonical jsonb;snapshot jsonb:='[]';result jsonb;code text;
BEGIN
 IF NOT qr_private.checkin_enabled(p_token) THEN RETURN qr_private.place_core(p_token,p_session,p_key,p_items,p_table); END IF;
 l:=qr_private.guest_scope(p_token,p_session);v:=qr_private.visit(p_token,p_session);
 IF NOT COALESCE((SELECT enabled FROM qr_private.branch_settings WHERE branch_id=l.branch_id),true) THEN RAISE EXCEPTION 'QR_DISABLED';END IF;
 PERFORM 1 FROM public.dining_tables WHERE id IN(l.table_id,v.table_id) ORDER BY id FOR UPDATE;
 SELECT * INTO v FROM qr_private.visits WHERE id=v.id FOR UPDATE;
 IF v.guest_hash<>encode(sha256(convert_to(p_session,'UTF8')),'hex') THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';END IF;
 IF v.status='closed' OR v.expires_at<=now() THEN RAISE EXCEPTION 'QR_VISIT_CLOSED';END IF;
 IF p_table IS DISTINCT FROM v.table_id THEN RAISE EXCEPTION 'QR_TABLE_LOCKED';END IF;
 IF p_key IS NULL OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 OR octet_length(p_items::text)>16000 THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
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
  IF r.visit_id IS DISTINCT FROM v.id OR r.payload<>canonical THEN RAISE EXCEPTION 'QR_IDEMPOTENCY_CONFLICT';END IF;
  RETURN jsonb_build_object('id',r.id,'status',r.status);
 END IF;
 IF v.status='pending' AND EXISTS(SELECT 1 FROM qr_private.requests WHERE visit_id=v.id AND status='pending') THEN RAISE EXCEPTION 'QR_WAIT_FOR_APPROVAL'; END IF;
 IF (SELECT count(*) FROM qr_private.requests WHERE visit_id=v.id AND created_at>now()-interval '1 minute')>=5 OR (SELECT count(*) FROM qr_private.requests WHERE visit_id=v.id AND status='pending')>=20 THEN RAISE EXCEPTION 'QR_RATE_LIMITED';END IF;
 IF v.order_type='dine_in' THEN
  result:=qr_private.submit_selected_core(p_token,p_key,p_items,v.table_id);
  UPDATE qr_private.requests SET visit_id=v.id,guest_hash=v.guest_hash WHERE id=(result->>'id')::uuid;
 ELSE
  FOR i IN SELECT value FROM jsonb_array_elements(canonical) ORDER BY value->>'product_id' LOOP
    SELECT x.* INTO p FROM public.products x JOIN qr_private.menu_products m ON m.product_id=x.id AND m.branch_id=x.branch_id
      WHERE x.id=(i->>'product_id')::uuid AND x.branch_id=v.branch_id AND x.is_active FOR SHARE OF x;
    IF p.id IS NULL OR EXISTS(SELECT 1 FROM public.product_modifier_group_products gp JOIN public.product_modifier_groups g ON g.id=gp.group_id
      WHERE gp.product_id=p.id AND gp.branch_id=v.branch_id AND g.branch_id=v.branch_id AND g.is_active AND g.min_selections>0) THEN RAISE EXCEPTION 'QR_PRODUCT_UNAVAILABLE'; END IF;
    IF round(p.sale_price,2)<>(i->>'price')::numeric THEN RAISE EXCEPTION 'QR_PRICE_CHANGED'; END IF;
    snapshot:=snapshot||jsonb_build_array(i||jsonb_build_object('name',p.name));
  END LOOP;

  INSERT INTO qr_private.requests(table_id,requested_table_id,branch_id,generation,request_key,payload,items,guest_hash,visit_id,order_type,target_order_id)
  VALUES(NULL,NULL,v.branch_id,l.generation,p_key,canonical,snapshot,v.guest_hash,v.id,'delivery',v.order_id) RETURNING * INTO r;
  result:=jsonb_build_object('id',r.id,'status',r.status);
 END IF;
 IF v.pin_hash IS NULL THEN code:=qr_private.new_pin(v.id);END IF;
 RETURN result||jsonb_build_object('recovery_code',code);
END $$;
CREATE FUNCTION qr_private.guest_call(p_token text,p_session text,p_key uuid,p_table uuid,p_kind text,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v qr_private.visits;c qr_private.service_calls;l qr_private.table_links;
BEGIN
 IF NOT qr_private.checkin_enabled(p_token) THEN RETURN qr_private.call_service_core(p_token,p_session,p_key,p_table,p_kind,p_note);END IF;
 v:=qr_private.visit(p_token,p_session);l:=qr_private.guest_scope(p_token,p_session);
 PERFORM 1 FROM public.dining_tables WHERE id IN(l.table_id,v.table_id) ORDER BY id FOR UPDATE;
 SELECT * INTO v FROM qr_private.visits WHERE id=v.id FOR UPDATE;
 IF v.guest_hash<>encode(sha256(convert_to(p_session,'UTF8')),'hex') THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';END IF;
 IF v.status<>'active' OR v.expires_at<=now() THEN RAISE EXCEPTION 'QR_VISIT_PENDING';END IF;
 IF p_table IS DISTINCT FROM v.table_id THEN RAISE EXCEPTION 'QR_TABLE_LOCKED';END IF;
 IF p_key IS NULL OR p_kind IS NULL OR p_kind NOT IN('service','check') OR p_note IS NULL OR length(p_note)>300 THEN RAISE EXCEPTION 'QR_INVALID_ITEMS';END IF;
 SELECT * INTO c FROM qr_private.service_calls WHERE generation=v.generation AND guest_hash=v.guest_hash AND request_key=p_key;
 IF c.id IS NOT NULL THEN
  IF c.visit_id IS DISTINCT FROM v.id OR c.kind<>p_kind OR c.note<>p_note THEN RAISE EXCEPTION 'QR_IDEMPOTENCY_CONFLICT';END IF;
  RETURN jsonb_build_object('id',c.id,'status',c.status);
 END IF;
 SELECT * INTO c FROM qr_private.service_calls WHERE visit_id=v.id AND kind=p_kind AND status<>'done' ORDER BY created_at LIMIT 1;
 IF c.id IS NOT NULL THEN RETURN jsonb_build_object('id',c.id,'status',c.status);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=v.order_id AND status IN('open','held')) THEN RAISE EXCEPTION 'QR_VISIT_CLOSED';END IF;
 IF (SELECT count(*) FROM qr_private.service_calls WHERE visit_id=v.id AND created_at>now()-interval '1 minute')>=5 OR (SELECT count(*) FROM qr_private.service_calls WHERE branch_id=v.branch_id AND created_at>now()-interval '1 minute')>=30 THEN RAISE EXCEPTION 'QR_RATE_LIMITED';END IF;
 INSERT INTO qr_private.service_calls(branch_id,generation,guest_hash,request_key,table_id,requested_table_id,order_id,kind,note,visit_id)
 VALUES(v.branch_id,v.generation,v.guest_hash,p_key,v.table_id,v.table_id,v.order_id,p_kind,p_note,v.id) RETURNING * INTO c;
 RETURN jsonb_build_object('id',c.id,'status',c.status);
END $$;
ALTER TABLE qr_private.visits ADD COLUMN photo_verified_at timestamptz,ADD COLUMN photo_verified_by uuid;
CREATE FUNCTION qr_private.photo(p_visit uuid,p_verify boolean) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v qr_private.visits;
BEGIN
 SELECT * INTO v FROM qr_private.visits WHERE id=p_visit;
 PERFORM qr_private.require_staff(v.branch_id,'pos.view');
 IF v.status='closed' OR v.expires_at<=now() THEN RAISE EXCEPTION 'QR_VISIT_CLOSED';END IF;
 IF p_verify THEN
  PERFORM qr_private.require_staff(v.branch_id,'pos.order.edit');
  IF NOT qr_private.may_review(v.branch_id) OR v.photo_data IS NULL OR v.status<>'pending' THEN RAISE EXCEPTION 'QR_PHOTO_REQUIRED';END IF;
  UPDATE qr_private.visits SET photo_verified_at=now(),photo_verified_by=auth.uid() WHERE id=v.id;
 END IF;RETURN v.photo_data;
END $$;
CREATE FUNCTION qr_private.staff_visits(p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM qr_private.require_staff(p_branch,'pos.view');
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]') INTO result FROM(
  SELECT v.id,v.order_type,v.status,v.order_id,v.created_at,p.name,p.phone,COALESCE(t.name,'توصيل') table_name,v.pin_failures>=3 pin_locked
  FROM qr_private.visits v JOIN qr_private.customer_profiles p ON p.id=v.profile_id LEFT JOIN public.dining_tables t ON t.id=v.table_id
  WHERE v.branch_id=p_branch AND v.status<>'closed' AND v.expires_at>now() ORDER BY v.created_at LIMIT 200
 )x;RETURN result;
END $$;
CREATE FUNCTION qr_private.reset_pin(p_visit uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v qr_private.visits;
BEGIN
 SELECT * INTO v FROM qr_private.visits WHERE id=p_visit;PERFORM qr_private.require_staff(v.branch_id,'pos.order.edit');
 IF NOT qr_private.may_review(v.branch_id) THEN RAISE EXCEPTION 'QR_PERMISSION_DENIED';END IF;RETURN qr_private.new_pin(v.id);
END $$;
CREATE FUNCTION qr_private.end_visit(p_visit uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v qr_private.visits;
BEGIN
 SELECT * INTO v FROM qr_private.visits WHERE id=p_visit;PERFORM qr_private.require_staff(v.branch_id,'pos.order.edit');
 IF NOT qr_private.may_review(v.branch_id) THEN RAISE EXCEPTION 'QR_PERMISSION_DENIED';END IF;
 UPDATE qr_private.visits SET status='closed',closed_at=COALESCE(closed_at,now()),photo_data=NULL WHERE id=v.id;
END $$;
CREATE FUNCTION qr_private.order_visit_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE qr_private.visits SET status='closed',closed_at=now(),photo_data=NULL WHERE order_id=OLD.id AND status<>'closed';RETURN OLD;
 END IF;
 IF NEW.status IN('completed','cancelled') THEN
  UPDATE qr_private.visits SET status='closed',closed_at=now(),photo_data=NULL WHERE order_id=NEW.id AND status<>'closed';
 ELSIF NEW.table_id IS DISTINCT FROM OLD.table_id THEN
  UPDATE qr_private.visits SET table_id=NEW.table_id WHERE order_id=NEW.id AND order_type='dine_in' AND NEW.table_id IS NOT NULL AND status<>'closed';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER qr_visit_order_lifecycle AFTER UPDATE OF status,table_id ON public.orders FOR EACH ROW EXECUTE FUNCTION qr_private.order_visit_lifecycle();
CREATE TRIGGER qr_visit_order_delete BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION qr_private.order_visit_lifecycle();

CREATE FUNCTION qr_private.decide_delivery(p_id uuid, p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r qr_private.requests; t public.dining_tables; o public.orders;
  i jsonb; p public.products; result jsonb; new_items jsonb; n integer; actual_price numeric;
  matched_item uuid; item_note text; v qr_private.visits; profile qr_private.customer_profiles;
BEGIN
  SELECT * INTO r FROM qr_private.requests WHERE id=p_id;
  IF r.id IS NULL OR p_accept IS NULL THEN RAISE EXCEPTION 'QR_REQUEST_NOT_FOUND'; END IF;
  PERFORM qr_private.require_staff(r.branch_id,'pos.order.edit');
  SELECT * INTO v FROM qr_private.visits WHERE id=r.visit_id;
  SELECT * INTO profile FROM qr_private.customer_profiles WHERE id=v.profile_id;
  -- Same origin table lock as guest intake and device resume.
  SELECT * INTO t FROM public.dining_tables WHERE id=v.origin_table_id FOR UPDATE;
  SELECT * INTO r FROM qr_private.requests WHERE id=p_id FOR UPDATE;
  IF r.status<>'pending' THEN
    IF (r.status='accepted')<>p_accept THEN RAISE EXCEPTION 'QR_ALREADY_DECIDED'; END IF;
    RETURN jsonb_build_object('status',r.status,'order_id',r.order_id);
  END IF;
  IF p_accept THEN
    IF r.created_at < now()-interval '30 minutes' THEN RAISE EXCEPTION 'QR_REQUEST_EXPIRED'; END IF;
    IF v.status='closed' OR v.expires_at<=now() THEN RAISE EXCEPTION 'QR_VISIT_CLOSED'; END IF;
    FOR i IN SELECT value FROM jsonb_array_elements(r.items) ORDER BY value->>'product_id' LOOP
      SELECT x.* INTO p FROM public.products x JOIN qr_private.menu_products m ON m.product_id=x.id AND m.branch_id=x.branch_id
        WHERE x.id=(i->>'product_id')::uuid AND x.branch_id=r.branch_id AND x.is_active FOR SHARE OF x;
      IF p.id IS NULL OR NOT COALESCE((public.resolve_product_modifiers(p.id,r.branch_id,'[]')->>'success')::boolean,false) THEN RAISE EXCEPTION 'QR_PRODUCT_UNAVAILABLE'; END IF;
      IF round(p.sale_price,2)<>(i->>'price')::numeric THEN RAISE EXCEPTION 'QR_PRICE_CHANGED'; END IF;
    END LOOP;
    SELECT * INTO o FROM public.orders WHERE id=v.order_id AND branch_id=r.branch_id AND status IN('open','held') FOR UPDATE;
    IF o.id IS NOT NULL THEN
      IF o.branch_id<>r.branch_id OR o.order_type<>'delivery' OR (o.cashier_id IS DISTINCT FROM auth.uid() AND NOT public.can_manage_other_pos_orders()) THEN RAISE EXCEPTION 'QR_ORDER_OPERATOR_REQUIRED'; END IF;
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
      result:=public.create_service_order(p_branch_id=>r.branch_id,p_order_type=>'delivery',p_items=>new_items,p_service_details=>jsonb_build_object('phone',profile.phone,'address',v.address,'note','طلب عميل: '||profile.name));
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
CREATE FUNCTION qr_private.review(p_id uuid,p_accept boolean,p_table uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r qr_private.requests;v qr_private.visits;result jsonb;target uuid;actual uuid;
BEGIN
 SELECT * INTO r FROM qr_private.requests WHERE id=p_id;
 IF r.visit_id IS NULL THEN RETURN qr_private.review_core(p_id,p_accept,p_table);END IF;
 PERFORM qr_private.require_staff(r.branch_id,'pos.order.edit');IF NOT qr_private.may_review(r.branch_id) THEN RAISE EXCEPTION 'QR_PERMISSION_DENIED';END IF;
 IF p_accept IS NULL THEN RAISE EXCEPTION 'QR_REQUEST_NOT_FOUND';END IF;
 IF r.status<>'pending' THEN
  IF (r.status='accepted')<>p_accept OR (r.order_type='dine_in' AND p_accept AND p_table IS NOT NULL AND r.assigned_table_id IS DISTINCT FROM p_table) THEN RAISE EXCEPTION 'QR_ALREADY_DECIDED';END IF;
  RETURN jsonb_build_object('status',r.status,'order_id',r.order_id);
 END IF;
 SELECT * INTO v FROM qr_private.visits WHERE id=r.visit_id;
 IF p_accept AND (v.status='closed' OR v.expires_at<=now()) THEN RAISE EXCEPTION 'QR_VISIT_CLOSED';END IF;
 IF v.order_type='delivery' THEN
  IF p_table IS NOT NULL THEN RAISE EXCEPTION 'QR_TABLE_LOCKED';END IF;
  result:=qr_private.decide_delivery(p_id,p_accept);
 ELSE
  target:=COALESCE(p_table,v.table_id);
  IF p_accept AND v.status='pending' AND v.photo_verified_at IS NULL THEN RAISE EXCEPTION 'QR_PHOTO_REVIEW_REQUIRED';END IF;
  SELECT table_id INTO actual FROM public.orders WHERE id=v.order_id AND status IN('open','held');
  IF p_accept AND actual IS NOT NULL AND target IS DISTINCT FROM actual THEN RAISE EXCEPTION 'QR_TABLE_LOCKED';END IF;
  result:=qr_private.review_core(p_id,p_accept,target);
 END IF;
 IF p_accept THEN
  UPDATE qr_private.visits SET status='active',order_id=(result->>'order_id')::uuid,
   table_id=CASE WHEN order_type='delivery' THEN NULL ELSE (SELECT table_id FROM public.orders WHERE id=(result->>'order_id')::uuid) END,photo_data=NULL
  WHERE id=v.id AND status<>'closed' AND expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'QR_VISIT_CLOSED';END IF;
 END IF;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION qr_private.inbox(p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM qr_private.require_staff(p_branch,'pos.view');
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]') INTO result FROM(
 SELECT r.id,r.table_id,COALESCE(d.name,'توصيل') table_name,r.items,r.created_at,r.order_type,r.visit_id,
 p.name customer_name,p.phone customer_phone,v.address delivery_address,v.photo_data IS NOT NULL has_photo,v.photo_verified_at IS NOT NULL photo_verified,
 COALESCE(o.table_id,(SELECT old.table_id FROM public.orders old WHERE old.branch_id=r.branch_id AND old.status IN('open','held') AND EXISTS(SELECT 1 FROM qr_private.requests prev WHERE prev.order_id=old.id AND prev.status='accepted' AND prev.guest_hash=r.guest_hash AND prev.generation=r.generation AND prev.created_at>now()-interval '24 hours') ORDER BY old.created_at DESC LIMIT 1)) own_active_table_id,
 CASE WHEN o.status IN('open','held') THEN o.id END own_active_order_id
 FROM qr_private.requests r LEFT JOIN public.dining_tables d ON d.id=r.table_id LEFT JOIN qr_private.visits v ON v.id=r.visit_id
 LEFT JOIN qr_private.customer_profiles p ON p.id=v.profile_id LEFT JOIN public.orders o ON o.id=v.order_id
 WHERE r.branch_id=p_branch AND r.status='pending' AND (v.id IS NULL OR(v.status<>'closed' AND v.expires_at>now())) ORDER BY r.created_at LIMIT 200
 )x;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION qr_private.calls(p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM qr_private.require_staff(p_branch,'pos.view');
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]') INTO result FROM(
 SELECT c.id,c.kind,c.note,c.status,c.created_at,c.order_id,COALESCE(d.name,'توصيل') table_name,p.name customer_name,p.phone customer_phone
 FROM qr_private.service_calls c LEFT JOIN public.dining_tables d ON d.id=c.table_id LEFT JOIN qr_private.visits v ON v.id=c.visit_id LEFT JOIN qr_private.customer_profiles p ON p.id=v.profile_id
 WHERE c.branch_id=p_branch AND c.status<>'done' AND c.created_at>now()-interval '24 hours' AND(v.id IS NULL OR(v.status<>'closed' AND v.expires_at>now())) ORDER BY c.created_at LIMIT 200
 )x;RETURN result;
END $$;
CREATE FUNCTION qr_private.save_customer_settings(p_branch uuid,p_enabled boolean,p_appearance jsonb,p_roles text[],p_checkin boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM qr_private.save_settings(p_branch,p_enabled,p_appearance,p_roles);
 IF p_checkin IS NULL THEN RAISE EXCEPTION 'QR_SETTINGS_INVALID';END IF;
 UPDATE qr_private.branch_settings SET checkin_enabled=p_checkin WHERE branch_id=p_branch;
END $$;
ALTER FUNCTION qr_private.settings(uuid) RENAME TO settings_core;
CREATE FUNCTION qr_private.settings(p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN qr_private.settings_core(p_branch)||jsonb_build_object('checkin_enabled',COALESCE((SELECT checkin_enabled FROM qr_private.branch_settings WHERE branch_id=p_branch),false));END $$;

CREATE FUNCTION qr_private.save_service(p_revision bigint,p_payload jsonb,p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; result jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id=(p_payload->>'p_order_id')::uuid FOR UPDATE;
  PERFORM qr_private.require_staff(o.branch_id,'pos.order.edit');
  IF o.id IS NULL OR p_revision IS DISTINCT FROM o.qr_revision THEN RAISE EXCEPTION 'QR_ORDER_REFRESH_REQUIRED'; END IF;
  PERFORM set_config('app.qr_revision',o.qr_revision::text,true);
  result:=public.update_service_order(o.id,COALESCE(p_payload->>'p_order_type','dine_in'),
    (p_payload->>'p_table_id')::uuid,(p_payload->>'p_customer_id')::uuid,
    (p_payload->>'p_guest_count')::integer,p_payload->>'p_notes',p_payload->'p_items',
    COALESCE((p_payload->>'p_subtotal')::numeric,0),COALESCE((p_payload->>'p_discount_amount')::numeric,0),
    COALESCE(p_payload->>'p_discount_type','amount'),COALESCE((p_payload->>'p_tax_amount')::numeric,0),
    COALESCE((p_payload->>'p_total')::numeric,0),COALESCE(p_payload->>'p_status','held'),p_details);
  PERFORM set_config('app.qr_revision','',true);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION qr_private.settings_core(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.qr_guest_entry(p_token text,p_session text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.entry(p_token,p_session) $$;
REVOKE ALL ON FUNCTION qr_private.entry(text,text),public.qr_guest_entry(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.entry(text,text),public.qr_guest_entry(text,text) TO anon,authenticated;
CREATE FUNCTION public.qr_guest_lookup(p_token text,p_session text,p_phone text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.lookup(p_token,p_session,p_phone) $$;
REVOKE ALL ON FUNCTION qr_private.lookup(text,text,text),public.qr_guest_lookup(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.lookup(text,text,text),public.qr_guest_lookup(text,text,text) TO anon,authenticated;
CREATE FUNCTION public.qr_guest_begin(p_token text,p_session text,p_phone text,p_name text,p_type text,p_table uuid,p_photo text,p_address text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.begin_visit(p_token,p_session,p_phone,p_name,p_type,p_table,p_photo,p_address) $$;
REVOKE ALL ON FUNCTION qr_private.begin_visit(text,text,text,text,text,uuid,text,text),public.qr_guest_begin(text,text,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.begin_visit(text,text,text,text,text,uuid,text,text),public.qr_guest_begin(text,text,text,text,text,uuid,text,text) TO anon,authenticated;
CREATE FUNCTION public.qr_guest_resume(p_token text,p_session text,p_phone text,p_pin text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.resume_visit(p_token,p_session,p_phone,p_pin) $$;
REVOKE ALL ON FUNCTION qr_private.resume_visit(text,text,text,text),public.qr_guest_resume(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.resume_visit(text,text,text,text),public.qr_guest_resume(text,text,text,text) TO anon,authenticated;
CREATE FUNCTION public.qr_guest_menu(p_token text,p_session text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.guest_menu(p_token,p_session) $$;
REVOKE ALL ON FUNCTION qr_private.guest_menu(text,text),public.qr_guest_menu(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.guest_menu(text,text),public.qr_guest_menu(text,text) TO anon,authenticated;
CREATE FUNCTION public.qr_guest_track(p_token text,p_session text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.guest_track(p_token,p_session) $$;
REVOKE ALL ON FUNCTION qr_private.guest_track(text,text),public.qr_guest_track(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.guest_track(text,text),public.qr_guest_track(text,text) TO anon,authenticated;
CREATE FUNCTION public.qr_guest_place(p_token text,p_session text,p_key uuid,p_items jsonb,p_table uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.guest_place(p_token,p_session,p_key,p_items,p_table) $$;
REVOKE ALL ON FUNCTION qr_private.guest_place(text,text,uuid,jsonb,uuid),public.qr_guest_place(text,text,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.guest_place(text,text,uuid,jsonb,uuid),public.qr_guest_place(text,text,uuid,jsonb,uuid) TO anon,authenticated;
CREATE FUNCTION public.qr_guest_call(p_token text,p_session text,p_key uuid,p_table uuid,p_kind text,p_note text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.guest_call(p_token,p_session,p_key,p_table,p_kind,p_note) $$;
REVOKE ALL ON FUNCTION qr_private.guest_call(text,text,uuid,uuid,text,text),public.qr_guest_call(text,text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.guest_call(text,text,uuid,uuid,text,text),public.qr_guest_call(text,text,uuid,uuid,text,text) TO anon,authenticated;
CREATE FUNCTION public.qr_guest_visits(p_branch uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.staff_visits(p_branch) $$;
REVOKE ALL ON FUNCTION qr_private.staff_visits(uuid),public.qr_guest_visits(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.staff_visits(uuid),public.qr_guest_visits(uuid) TO authenticated;
CREATE FUNCTION public.qr_guest_photo(p_visit uuid,p_verify boolean) RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.photo(p_visit,p_verify) $$;
REVOKE ALL ON FUNCTION qr_private.photo(uuid,boolean),public.qr_guest_photo(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.photo(uuid,boolean),public.qr_guest_photo(uuid,boolean) TO authenticated;
CREATE FUNCTION public.qr_guest_reset_pin(p_visit uuid) RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.reset_pin(p_visit) $$;
REVOKE ALL ON FUNCTION qr_private.reset_pin(uuid),public.qr_guest_reset_pin(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.reset_pin(uuid),public.qr_guest_reset_pin(uuid) TO authenticated;
CREATE FUNCTION public.qr_guest_end(p_visit uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.end_visit(p_visit) $$;
REVOKE ALL ON FUNCTION qr_private.end_visit(uuid),public.qr_guest_end(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.end_visit(uuid),public.qr_guest_end(uuid) TO authenticated;
CREATE FUNCTION public.qr_save_customer_settings(p_branch uuid,p_enabled boolean,p_appearance jsonb,p_roles text[],p_checkin boolean) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.save_customer_settings(p_branch,p_enabled,p_appearance,p_roles,p_checkin) $$;
REVOKE ALL ON FUNCTION qr_private.save_customer_settings(uuid,boolean,jsonb,text[],boolean),public.qr_save_customer_settings(uuid,boolean,jsonb,text[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.save_customer_settings(uuid,boolean,jsonb,text[],boolean),public.qr_save_customer_settings(uuid,boolean,jsonb,text[],boolean) TO authenticated;
CREATE FUNCTION public.qr_save_service_order(p_revision bigint,p_payload jsonb,p_details jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT qr_private.save_service(p_revision,p_payload,p_details) $$;
REVOKE ALL ON FUNCTION qr_private.save_service(bigint,jsonb,jsonb),public.qr_save_service_order(bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.save_service(bigint,jsonb,jsonb),public.qr_save_service_order(bigint,jsonb,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION qr_private.phone(text),qr_private.checkin_enabled(text),qr_private.visit(text,text),qr_private.visit_view(qr_private.visits),qr_private.new_pin(uuid),qr_private.decide_delivery(uuid,boolean),qr_private.order_visit_lifecycle() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION qr_private.menu(text),qr_private.submit_selected(text,uuid,jsonb,uuid),qr_private.place(text,text,uuid,jsonb,uuid),qr_private.track(text,text),qr_private.call_service(text,text,uuid,uuid,text,text),qr_private.review(uuid,boolean,uuid),qr_private.settings(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.menu(text),qr_private.submit_selected(text,uuid,jsonb,uuid),qr_private.place(text,text,uuid,jsonb,uuid),qr_private.track(text,text),qr_private.call_service(text,text,uuid,uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.review(uuid,boolean,uuid),qr_private.settings(uuid) TO authenticated;
COMMIT;
