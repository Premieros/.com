-- Recovery fix: a permanent branch QR must accept the existing verified
-- two-digit PIN for a valid visit created with an older QR from the SAME branch.
-- A different branch remains invalid; rotated legacy QR links stay revoked.
-- PIN verification, three-strike limit and single-device transfer remain intact.
-- Normalizes Arabic-Indic/Persian numerals; preserves leading zeroes.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE OR REPLACE FUNCTION qr_private.resume_visit(p_token text, p_session text, p_phone text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE l qr_private.table_links;v qr_private.visits;h text;locked_table uuid;
 v_pin text;v_branch_qr boolean;
BEGIN
 l:=qr_private.guest_scope(p_token,p_session);h:=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 v_pin:=translate(COALESCE(p_pin,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
 v_branch_qr:=EXISTS(SELECT 1 FROM qr_private.branch_qr_links WHERE branch_id=l.branch_id AND token_hash=l.token_hash);
 SELECT x.* INTO v FROM qr_private.visits x JOIN qr_private.customer_profiles p ON p.id=x.profile_id
 WHERE p.branch_id=l.branch_id AND p.phone=qr_private.phone(p_phone) AND x.status IN('pending','active') AND x.expires_at>now();
 IF v.id IS NOT NULL THEN
  locked_table:=v.table_id;PERFORM 1 FROM public.dining_tables WHERE id IN(v.origin_table_id,v.table_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v FROM qr_private.visits WHERE id=v.id FOR UPDATE;
  IF v.table_id IS DISTINCT FROM locked_table THEN RETURN jsonb_build_object('success',false,'error','QR_RETRY');END IF;
 END IF;
 IF v.id IS NULL OR v.status='closed' OR v.expires_at<=now() OR (v.generation<>l.generation AND NOT v_branch_qr) THEN RETURN jsonb_build_object('success',false,'error','QR_PIN_INVALID'); END IF;
 IF v.guest_hash=h THEN RETURN jsonb_build_object('success',true,'visit',qr_private.visit_view(v)); END IF;
 IF v.pin_failures>=3 THEN RETURN jsonb_build_object('success',false,'error','QR_PIN_LOCKED'); END IF;
 IF v_pin !~ '^[0-9]{2} THEN
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
END $function$
 OR v.pin_hash IS NULL OR encode(sha256(convert_to(v.pin_salt||v_pin,'UTF8')),'hex')<>v.pin_hash THEN
  UPDATE qr_private.visits SET pin_failures=pin_failures+1 WHERE id=v.id;
  RETURN jsonb_build_object('success',false,'error',CASE WHEN v.pin_failures>=2 THEN 'QR_PIN_LOCKED' ELSE 'QR_PIN_INVALID' END);
 END IF;
 IF EXISTS(SELECT 1 FROM qr_private.visits WHERE guest_hash=h AND id<>v.id) THEN RETURN jsonb_build_object('success',false,'error','QR_SESSION_CONFLICT'); END IF;
 -- Transfer the private capability to the new device; the former device loses access.
 UPDATE qr_private.visits SET guest_hash=h,pin_failures=0 WHERE id=v.id RETURNING * INTO v;
 UPDATE qr_private.requests SET guest_hash=h WHERE visit_id=v.id;UPDATE qr_private.service_calls SET guest_hash=h WHERE visit_id=v.id;
 RETURN jsonb_build_object('success',true,'visit',qr_private.visit_view(v));
END $function$;
