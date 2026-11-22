ALTER TABLE qr_private.visits ADD COLUMN parent_visit_id uuid REFERENCES qr_private.visits(id) ON DELETE SET NULL;
CREATE INDEX qr_visits_parent ON qr_private.visits(parent_visit_id) WHERE parent_visit_id IS NOT NULL;
DROP INDEX qr_private.qr_one_live_visit;
CREATE INDEX qr_live_visits_by_profile ON qr_private.visits(profile_id,created_at DESC) WHERE status IN ('pending','active');

CREATE OR REPLACE FUNCTION qr_private.lookup(p_token text,p_session text,p_phone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l qr_private.table_links;p qr_private.customer_profiles;v qr_private.visits;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session); SELECT * INTO p FROM qr_private.customer_profiles WHERE branch_id=l.branch_id AND phone=qr_private.phone(p_phone);
 SELECT * INTO v FROM qr_private.visits WHERE profile_id=p.id AND status IN('pending','active') AND expires_at>now()
 ORDER BY (guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex')) DESC,
   EXISTS(SELECT 1 FROM qr_private.requests r WHERE r.visit_id=visits.id) DESC, created_at DESC, id DESC LIMIT 1;
 IF v.guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND v.generation=l.generation THEN RETURN jsonb_build_object('registered',true,'visit',qr_private.visit_view(v)); END IF;
 RETURN jsonb_build_object('registered',p.id IS NOT NULL,'needs_pin',v.id IS NOT NULL AND EXISTS(SELECT 1 FROM qr_private.requests WHERE visit_id=v.id),'pin_set',v.pin_hash IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION qr_private.resume_visit(p_token text, p_session text, p_phone text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE l qr_private.table_links;v qr_private.visits;h text;locked_table uuid; v_pin text;v_branch_qr boolean;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session);h:=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 v_pin:=translate(COALESCE(p_pin,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
 v_branch_qr:=EXISTS(SELECT 1 FROM qr_private.branch_qr_links WHERE branch_id=l.branch_id AND token_hash=l.token_hash);
 SELECT x.* INTO v FROM qr_private.visits x JOIN qr_private.customer_profiles p ON p.id=x.profile_id
 WHERE p.branch_id=l.branch_id AND p.phone=qr_private.phone(p_phone) AND x.status IN('pending','active') AND x.expires_at>now() AND (x.generation=l.generation OR v_branch_qr)
 ORDER BY (x.guest_hash=h) DESC, EXISTS(SELECT 1 FROM qr_private.requests r WHERE r.visit_id=x.id) DESC,
   x.created_at DESC, x.id DESC LIMIT 1;
 IF v.id IS NOT NULL THEN
  locked_table:=v.table_id;PERFORM 1 FROM public.dining_tables WHERE id IN(v.origin_table_id,v.table_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v FROM qr_private.visits WHERE id=v.id FOR UPDATE;
  IF v.table_id IS DISTINCT FROM locked_table THEN RETURN jsonb_build_object('success',false,'error','QR_RETRY');END IF;
 END IF;
 IF v.id IS NULL OR v.status='closed' OR v.expires_at<=now() OR (v.generation<>l.generation AND NOT v_branch_qr) THEN RETURN jsonb_build_object('success',false,'error','QR_PIN_INVALID'); END IF;
 IF v.guest_hash=h THEN
   IF v_branch_qr AND v.generation<>l.generation THEN
     UPDATE qr_private.visits SET generation=l.generation,origin_table_id=l.table_id
     WHERE id=v.id RETURNING * INTO v;
   END IF;
   RETURN jsonb_build_object('success',true,'visit',qr_private.visit_view(v));
 END IF;
 IF v.pin_failures>=3 THEN RETURN jsonb_build_object('success',false,'error','QR_PIN_LOCKED'); END IF;
 IF v_pin !~ '^[0-9]{2}$' OR v.pin_hash IS NULL OR encode(sha256(convert_to(v.pin_salt||v_pin,'UTF8')),'hex')<>v.pin_hash THEN
  UPDATE qr_private.visits SET pin_failures=pin_failures+1 WHERE id=v.id;
  RETURN jsonb_build_object('success',false,'error',CASE WHEN v.pin_failures>=2 THEN 'QR_PIN_LOCKED' ELSE 'QR_PIN_INVALID' END);
 END IF;
 IF EXISTS(SELECT 1 FROM qr_private.visits WHERE guest_hash=h AND id<>v.id) THEN RETURN jsonb_build_object('success',false,'error','QR_SESSION_CONFLICT'); END IF;
 -- Transfer the private capability to the new device; the former device loses access.
 UPDATE qr_private.visits SET guest_hash=h,pin_failures=0,
     generation=CASE WHEN v_branch_qr THEN l.generation ELSE generation END,
     origin_table_id=CASE WHEN v_branch_qr THEN l.table_id ELSE origin_table_id END
   WHERE id=v.id RETURNING * INTO v;
 UPDATE qr_private.requests SET guest_hash=h WHERE visit_id=v.id;UPDATE qr_private.service_calls SET guest_hash=h WHERE visit_id=v.id;
 RETURN jsonb_build_object('success',true,'visit',qr_private.visit_view(v));
END $function$;

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
 SELECT * INTO v FROM qr_private.visits WHERE profile_id=p.id AND status IN('pending','active')
 ORDER BY EXISTS(SELECT 1 FROM qr_private.requests r WHERE r.visit_id=visits.id) DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF v.status='pending' AND NOT EXISTS(SELECT 1 FROM qr_private.requests WHERE visit_id=v.id) THEN
  UPDATE qr_private.visits SET status='closed',closed_at=now(),photo_data=NULL WHERE id=v.id;
 END IF;
 IF EXISTS(SELECT 1 FROM qr_private.visits WHERE profile_id=p.id AND status IN('pending','active')) THEN RAISE EXCEPTION 'QR_PIN_REQUIRED'; END IF;
 IF (SELECT count(*) FROM qr_private.visits WHERE branch_id=l.branch_id AND created_at>now()-interval '1 minute')>=30 THEN RAISE EXCEPTION 'QR_RATE_LIMITED';END IF;
 INSERT INTO qr_private.visits(branch_id,generation,profile_id,guest_hash,origin_table_id,order_type,table_id,address,photo_data)
 VALUES(l.branch_id,l.generation,p.id,h,l.table_id,p_type,CASE WHEN p_type='dine_in' THEN p_table END,CASE WHEN p_type='delivery' THEN trim(p_address) END,CASE WHEN p_type='dine_in' THEN p_photo END) RETURNING * INTO v;
 RETURN qr_private.visit_view(v);
END $$;

-- Starting an independent order requires the capability of an already
-- submitted order. A phone number alone never authorizes another visit.
CREATE FUNCTION qr_private.start_next_order(p_token text,p_session text,p_next_session text,p_type text,p_table uuid,p_photo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source qr_private.visits; next_visit qr_private.visits; next_hash text; scope qr_private.table_links;
BEGIN
 IF p_type IS NULL OR p_type NOT IN ('dine_in','delivery','pickup') THEN RAISE EXCEPTION 'QR_INVALID_ITEMS'; END IF;
 scope:=qr_private.guest_scope(p_token,p_next_session);
 source:=qr_private.visit(p_token,p_session);
 IF NOT EXISTS(SELECT 1 FROM qr_private.branch_settings WHERE branch_id=source.branch_id AND enabled AND checkin_enabled) THEN
   RAISE EXCEPTION 'QR_DISABLED';
 END IF;
 IF source.branch_id<>scope.branch_id OR source.generation<>scope.generation THEN RAISE EXCEPTION 'QR_SESSION_CONFLICT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('qr_checkin:'||source.branch_id::text,0));
 PERFORM 1 FROM public.dining_tables WHERE branch_id=source.branch_id AND id IN (source.origin_table_id,source.table_id,p_table) ORDER BY id FOR UPDATE;
 SELECT * INTO source FROM qr_private.visits WHERE id=source.id FOR UPDATE;
 IF source.guest_hash IS DISTINCT FROM encode(sha256(convert_to(p_session,'UTF8')),'hex')
   OR source.status='closed' OR source.expires_at<=now() THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED'; END IF;
 IF p_type=source.order_type OR NOT EXISTS(SELECT 1 FROM qr_private.requests WHERE visit_id=source.id) THEN
   RAISE EXCEPTION 'QR_FULFILLMENT_LOCKED';
 END IF;
 next_hash:=encode(sha256(convert_to(p_next_session,'UTF8')),'hex');
 SELECT * INTO next_visit FROM qr_private.visits WHERE guest_hash=next_hash;
 IF next_visit.id IS NOT NULL THEN
   IF next_visit.parent_visit_id IS DISTINCT FROM source.id OR next_visit.order_type<>p_type
     OR next_visit.table_id IS DISTINCT FROM p_table OR next_visit.status<>'pending'
     OR next_visit.expires_at<=now() THEN RAISE EXCEPTION 'QR_SESSION_CONFLICT'; END IF;
   RETURN qr_private.visit_view(next_visit);
 END IF;
 IF p_type='dine_in' THEN
   IF NOT EXISTS(SELECT 1 FROM public.dining_tables WHERE id=p_table AND branch_id=source.branch_id AND is_active) THEN
     RAISE EXCEPTION 'QR_TABLE_INVALID';
   END IF;
   IF p_photo IS NULL OR length(p_photo) NOT BETWEEN 40 AND 180000 OR p_photo !~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+$' THEN
     RAISE EXCEPTION 'QR_PHOTO_REQUIRED';
   END IF;
 ELSIF p_table IS NOT NULL OR p_photo IS NOT NULL THEN RAISE EXCEPTION 'QR_TABLE_LOCKED'; END IF;
 IF (SELECT count(*) FROM qr_private.visits WHERE profile_id=source.profile_id AND status IN ('pending','active') AND expires_at>now())>=5
   OR (SELECT count(*) FROM qr_private.visits WHERE branch_id=source.branch_id AND created_at>now()-interval '1 minute')>=30 THEN
   RAISE EXCEPTION 'QR_RATE_LIMITED';
 END IF;
 INSERT INTO qr_private.visits(branch_id,generation,profile_id,guest_hash,origin_table_id,order_type,table_id,photo_data,parent_visit_id)
 VALUES(source.branch_id,source.generation,source.profile_id,next_hash,source.origin_table_id,p_type,p_table,p_photo,source.id)
 RETURNING * INTO next_visit;
 RETURN qr_private.visit_view(next_visit);
END $$;

CREATE FUNCTION public.qr_guest_start_next_order(p_token text,p_session text,p_next_session text,p_type text,p_table uuid,p_photo text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT qr_private.start_next_order(p_token,p_session,p_next_session,p_type,p_table,p_photo)
$$;
REVOKE ALL ON FUNCTION public.qr_guest_start_next_order(text,text,text,text,uuid,text),qr_private.start_next_order(text,text,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qr_guest_start_next_order(text,text,text,text,uuid,text),qr_private.start_next_order(text,text,text,text,uuid,text) TO anon,authenticated;

