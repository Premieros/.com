CREATE OR REPLACE FUNCTION qr_private.visit_view(v qr_private.visits) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',v.id,'has_delivery_address',v.address IS NOT NULL,'order_type',v.order_type,'table_id',v.table_id,'status',v.status,'pin_set',v.pin_hash IS NOT NULL,
 'has_request',EXISTS(SELECT 1 FROM qr_private.requests WHERE visit_id=v.id),'table_name',(SELECT name FROM public.dining_tables WHERE id=v.table_id),'phone',(SELECT phone FROM qr_private.customer_profiles WHERE id=v.profile_id))
$$;

CREATE OR REPLACE FUNCTION qr_private.begin_visit(p_token text,p_session text,p_phone text,p_name text,p_type text,p_table uuid,p_photo text,p_address text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;p qr_private.customer_profiles;v qr_private.visits;v_phone text;h text;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session);IF NOT qr_private.checkin_enabled(p_token) THEN RAISE EXCEPTION 'QR_DISABLED'; END IF;
 IF NOT COALESCE((SELECT enabled FROM qr_private.branch_settings WHERE branch_id=l.branch_id),true) THEN RAISE EXCEPTION 'QR_DISABLED';END IF;
 v_phone:=qr_private.phone(p_phone);h:=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 -- Serialize branch check-ins to bound image storage and concurrent phone claims.
 PERFORM pg_advisory_xact_lock(hashtextextended('qr_checkin:'||l.branch_id::text,0));
 SELECT * INTO v FROM qr_private.visits WHERE guest_hash=h;
 IF v.id IS NOT NULL THEN
  IF v.status='closed' OR v.expires_at<=now() THEN RAISE EXCEPTION 'QR_VISIT_CLOSED'; END IF;
  IF v.branch_id<>l.branch_id OR v.generation<>l.generation OR (SELECT x.phone FROM qr_private.customer_profiles x WHERE x.id=v.profile_id)<>v_phone THEN RAISE EXCEPTION 'QR_SESSION_CONFLICT'; END IF;
  RETURN qr_private.visit_view(v);
 END IF;
 IF p_type IS NULL OR p_type NOT IN('dine_in','delivery','pickup') THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
 IF p_type='dine_in' THEN
  IF NOT EXISTS(SELECT 1 FROM public.dining_tables WHERE id=p_table AND branch_id=l.branch_id AND is_active) THEN RAISE EXCEPTION 'QR_TABLE_INVALID'; END IF;
  IF p_photo IS NULL OR length(p_photo) NOT BETWEEN 40 AND 180000 OR p_photo !~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+$' THEN RAISE EXCEPTION 'QR_PHOTO_REQUIRED'; END IF;
 ELSIF p_type='delivery' THEN
  IF p_table IS NOT NULL OR (p_address IS NOT NULL AND length(trim(p_address)) NOT BETWEEN 5 AND 500) THEN RAISE EXCEPTION 'QR_ADDRESS_REQUIRED'; END IF;
 ELSIF p_table IS NOT NULL THEN
  RAISE EXCEPTION 'QR_TABLE_LOCKED';
 END IF;
 SELECT * INTO p FROM qr_private.customer_profiles WHERE branch_id=l.branch_id AND qr_private.customer_profiles.phone=v_phone FOR UPDATE;
 IF p.id IS NULL THEN
  IF length(trim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 100 OR p_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'QR_NAME_REQUIRED'; END IF;
  INSERT INTO qr_private.customer_profiles(branch_id,phone,name) VALUES(l.branch_id,v_phone,trim(p_name)) RETURNING * INTO p;
 END IF;
 UPDATE qr_private.visits SET status='closed',closed_at=now(),photo_data=NULL WHERE profile_id=p.id AND status IN('pending','active') AND expires_at<=now();
 -- An abandoned menu with no submitted request is not an active customer order.
 -- Recheck after locking the visit, so a concurrent first submission cannot be adopted.
 SELECT * INTO v FROM qr_private.visits WHERE profile_id=p.id AND status IN('pending','active') FOR UPDATE;
 IF v.status='pending' AND NOT EXISTS(SELECT 1 FROM qr_private.requests WHERE visit_id=v.id) THEN
  UPDATE qr_private.visits SET status='closed',closed_at=now(),photo_data=NULL WHERE id=v.id;
 END IF;
 IF EXISTS(SELECT 1 FROM qr_private.visits WHERE profile_id=p.id AND status IN('pending','active')) THEN RAISE EXCEPTION 'QR_PIN_REQUIRED'; END IF;
 IF (SELECT count(*) FROM qr_private.visits WHERE branch_id=l.branch_id AND created_at>now()-interval '1 minute')>=30 THEN RAISE EXCEPTION 'QR_RATE_LIMITED';END IF;
 INSERT INTO qr_private.visits(branch_id,generation,profile_id,guest_hash,origin_table_id,order_type,table_id,address,photo_data)
 VALUES(l.branch_id,l.generation,p.id,h,l.table_id,p_type,CASE WHEN p_type='dine_in' THEN p_table END,CASE WHEN p_type='delivery' THEN trim(p_address) END,CASE WHEN p_type='dine_in' THEN p_photo END) RETURNING * INTO v;
 RETURN qr_private.visit_view(v);
END $$;

CREATE OR REPLACE FUNCTION qr_private.guest_place(p_token text,p_session text,p_key uuid,p_items jsonb,p_table uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;v qr_private.visits;r qr_private.requests;i jsonb;p public.products;canonical jsonb;snapshot jsonb:='[]';result jsonb;code text;
BEGIN
 IF NOT qr_private.checkin_enabled(p_token) THEN RETURN qr_private.place_core(p_token,p_session,p_key,p_items,p_table); END IF;
 l:=qr_private.guest_scope(p_token,p_session);v:=qr_private.visit(p_token,p_session);
 IF NOT COALESCE((SELECT enabled FROM qr_private.branch_settings WHERE branch_id=l.branch_id),true) THEN RAISE EXCEPTION 'QR_DISABLED';END IF;
 PERFORM 1 FROM public.dining_tables WHERE id IN(l.table_id,v.table_id) ORDER BY id FOR UPDATE;
 SELECT * INTO v FROM qr_private.visits WHERE id=v.id FOR UPDATE;
 IF v.guest_hash<>encode(sha256(convert_to(p_session,'UTF8')),'hex') THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';END IF;
 IF v.status='closed' OR v.expires_at<=now() THEN RAISE EXCEPTION 'QR_VISIT_CLOSED';END IF;
 IF v.order_type='delivery' AND length(trim(COALESCE(v.address,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'QR_ADDRESS_REQUIRED'; END IF;
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
  VALUES(NULL,NULL,v.branch_id,l.generation,p_key,canonical,snapshot,v.guest_hash,v.id,v.order_type,v.order_id) RETURNING * INTO r;
  result:=jsonb_build_object('id',r.id,'status',r.status);
 END IF;
 IF v.pin_hash IS NULL THEN code:=qr_private.new_pin(v.id);END IF;
 RETURN result||jsonb_build_object('recovery_code',code);
END $$;

-- Save the initial address and accept the cart in the same transaction.
CREATE FUNCTION qr_private.place_delivery(p_token text,p_session text,p_key uuid,p_items jsonb,p_address text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v qr_private.visits; address_value text := trim(COALESCE(p_address,''));
BEGIN
 IF NOT qr_private.checkin_enabled(p_token) THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED'; END IF;
 v:=qr_private.visit(p_token,p_session);
 IF v.order_type<>'delivery' THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
 -- Match the lock order used by guest_place and device recovery.
 PERFORM 1 FROM public.dining_tables WHERE id=v.origin_table_id FOR UPDATE;
 SELECT * INTO v FROM qr_private.visits WHERE id=v.id FOR UPDATE;
 IF v.guest_hash<>encode(sha256(convert_to(p_session,'UTF8')),'hex') THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED'; END IF;
 IF v.address IS NULL THEN
  IF length(address_value) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'QR_ADDRESS_REQUIRED'; END IF;
  UPDATE qr_private.visits SET address=address_value WHERE id=v.id;
 ELSIF address_value<>'' AND v.address IS DISTINCT FROM address_value THEN
  RAISE EXCEPTION 'QR_IDEMPOTENCY_CONFLICT';
 END IF;
 RETURN qr_private.guest_place(p_token,p_session,p_key,p_items,NULL);
END $$;

CREATE FUNCTION public.qr_guest_place_delivery(p_token text,p_session text,p_key uuid,p_items jsonb,p_address text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT qr_private.place_delivery(p_token,p_session,p_key,p_items,p_address)
$$;
REVOKE ALL ON FUNCTION public.qr_guest_place_delivery(text,text,uuid,jsonb,text),qr_private.place_delivery(text,text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qr_guest_place_delivery(text,text,uuid,jsonb,text),qr_private.place_delivery(text,text,uuid,jsonb,text) TO anon,authenticated;
