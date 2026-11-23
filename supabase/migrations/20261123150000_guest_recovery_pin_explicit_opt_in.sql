-- Guest recovery PIN is an explicit per-branch opt-in, independent of
-- customer check-in. Default OFF; never transfer a live session by phone alone.
-- This migration is for disposable CI until owner approves deployment.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE qr_private.branch_settings
  ADD COLUMN IF NOT EXISTS recovery_pin_enabled boolean NOT NULL DEFAULT false;

-- Staff settings read includes the new flag; do not change the existing public
-- settings RPC signature.
CREATE OR REPLACE FUNCTION qr_private.settings(p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  RETURN qr_private.settings_core(p_branch)
    || jsonb_build_object(
      'checkin_enabled', COALESCE((SELECT checkin_enabled FROM qr_private.branch_settings WHERE branch_id=p_branch), false),
      'recovery_pin_enabled', COALESCE((SELECT recovery_pin_enabled FROM qr_private.branch_settings WHERE branch_id=p_branch), false)
    );
END;
$function$;

-- Independent save action. No direct client write to private tables.
CREATE OR REPLACE FUNCTION public.qr_save_recovery_pin_setting(
  p_branch uuid, p_enabled boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM qr_private.require_settings(p_branch);
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'QR_SETTINGS_INVALID'; END IF;
  PERFORM 1 FROM public.branches WHERE id=p_branch FOR UPDATE;
  INSERT INTO qr_private.branch_settings(branch_id, recovery_pin_enabled, updated_by)
    VALUES(p_branch, p_enabled, auth.uid())
  ON CONFLICT(branch_id) DO UPDATE SET
    recovery_pin_enabled=excluded.recovery_pin_enabled,
    updated_by=excluded.updated_by, updated_at=now();
END;
$function$;
REVOKE ALL ON FUNCTION public.qr_save_recovery_pin_setting(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_save_recovery_pin_setting(uuid, boolean)
  TO authenticated, service_role;

-- Lookup must never request a PIN when the option is off. It must also not
-- pretend that a different device owns another person's active visit.
CREATE OR REPLACE FUNCTION qr_private.lookup(p_token text, p_session text, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE l qr_private.table_links; p qr_private.customer_profiles; v qr_private.visits;
  v_has_request boolean; v_recovery_enabled boolean;
BEGIN
  l:=qr_private.guest_scope(p_token,p_session);
  SELECT * INTO p FROM qr_private.customer_profiles
    WHERE branch_id=l.branch_id AND phone=qr_private.phone(p_phone);
  SELECT * INTO v FROM qr_private.visits
    WHERE profile_id=p.id AND status IN('pending','active') AND expires_at>now()
    ORDER BY (guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex')) DESC,
      EXISTS(SELECT 1 FROM qr_private.requests r WHERE r.visit_id=visits.id) DESC,
      created_at DESC,id DESC LIMIT 1;
  IF v.guest_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex')
     AND v.generation=l.generation THEN
    RETURN jsonb_build_object('registered',true,'visit',qr_private.visit_view(v));
  END IF;
  v_has_request:=v.id IS NOT NULL AND EXISTS(
    SELECT 1 FROM qr_private.requests WHERE visit_id=v.id);
  SELECT COALESCE(recovery_pin_enabled,false) INTO v_recovery_enabled
    FROM qr_private.branch_settings WHERE branch_id=l.branch_id;
  RETURN jsonb_build_object(
    'registered',p.id IS NOT NULL,
    'needs_pin',v_has_request AND COALESCE(v_recovery_enabled,false),
    'recovery_unavailable',v_has_request AND NOT COALESCE(v_recovery_enabled,false),
    'pin_set',v.pin_hash IS NOT NULL
  );
END;
$function$;

-- Defense in depth: a forged direct resume RPC cannot bypass the branch toggle
-- or revive a takeover using a previously issued code.
CREATE OR REPLACE FUNCTION public.qr_guest_resume(
  p_token text, p_session text, p_phone text, p_pin text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_scope qr_private.table_links;
BEGIN
  v_scope:=qr_private.guest_scope(p_token,p_session);
  IF NOT COALESCE((
    SELECT recovery_pin_enabled FROM qr_private.branch_settings
    WHERE branch_id=v_scope.branch_id
  ),false) THEN
    RETURN jsonb_build_object('success',false,'error','QR_RECOVERY_DISABLED');
  END IF;
  RETURN qr_private.resume_visit(p_token,p_session,p_phone,p_pin);
END;
$function$;
REVOKE ALL ON FUNCTION public.qr_guest_resume(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_guest_resume(text,text,text,text)
  TO anon, authenticated, service_role;
