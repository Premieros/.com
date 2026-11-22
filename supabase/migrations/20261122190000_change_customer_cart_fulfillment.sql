-- An unsent cart can change fulfillment without creating a new customer visit.
CREATE FUNCTION qr_private.change_guest_fulfillment(p_token text,p_session text,p_type text,p_table uuid,p_photo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v qr_private.visits;
BEGIN
 IF p_type IS NULL OR p_type NOT IN ('dine_in','delivery','pickup') THEN
   RAISE EXCEPTION 'QR_INVALID_ITEMS';
 END IF;
 v:=qr_private.visit(p_token,p_session);
 IF NOT EXISTS (SELECT 1 FROM qr_private.branch_settings WHERE branch_id=v.branch_id AND enabled AND checkin_enabled) THEN
   RAISE EXCEPTION 'QR_DISABLED';
 END IF;
 PERFORM 1 FROM public.dining_tables WHERE branch_id=v.branch_id AND id IN (v.origin_table_id,v.table_id,p_table) ORDER BY id FOR UPDATE;
 SELECT * INTO v FROM qr_private.visits WHERE id=v.id FOR UPDATE;
 IF v.guest_hash IS DISTINCT FROM encode(sha256(convert_to(p_session,'UTF8')),'hex') THEN
   RAISE EXCEPTION 'QR_CHECKIN_REQUIRED';
 END IF;
 IF v.status<>'pending' OR v.expires_at<=now() OR EXISTS(SELECT 1 FROM qr_private.requests WHERE visit_id=v.id) THEN
   RAISE EXCEPTION 'QR_FULFILLMENT_LOCKED';
 END IF;
 IF p_type='dine_in' THEN
   IF NOT EXISTS(SELECT 1 FROM public.dining_tables WHERE id=p_table AND branch_id=v.branch_id AND is_active) THEN
     RAISE EXCEPTION 'QR_TABLE_INVALID';
   END IF;
   IF p_photo IS NULL OR length(p_photo) NOT BETWEEN 40 AND 180000 OR p_photo !~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+$' THEN
     RAISE EXCEPTION 'QR_PHOTO_REQUIRED';
   END IF;
 ELSIF p_table IS NOT NULL OR p_photo IS NOT NULL THEN
   RAISE EXCEPTION 'QR_TABLE_LOCKED';
 END IF;

 UPDATE qr_private.visits SET order_type=p_type,table_id=p_table,photo_data=p_photo,
   address=NULL,photo_verified_at=NULL,photo_verified_by=NULL WHERE id=v.id RETURNING * INTO v;
 RETURN qr_private.visit_view(v);
END $$;
CREATE FUNCTION public.qr_guest_change_fulfillment(p_token text,p_session text,p_type text,p_table uuid,p_photo text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT qr_private.change_guest_fulfillment(p_token,p_session,p_type,p_table,p_photo)
$$;
REVOKE ALL ON FUNCTION public.qr_guest_change_fulfillment(text,text,text,uuid,text),
 qr_private.change_guest_fulfillment(text,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qr_guest_change_fulfillment(text,text,text,uuid,text),
 qr_private.change_guest_fulfillment(text,text,text,uuid,text) TO anon,authenticated;
