-- ============================================================================
-- Migration: 20261105010000_harden_login_failure_and_user_security.sql
-- Description: Strengthen login brute-force protection and account lockout
--              for both username and email-based sign-ins.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_private.record_login_failure(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user public.users%ROWTYPE;
  v_new_attempts integer;
  v_norm text;
BEGIN
  IF p_username IS NULL OR btrim(p_username) = '' THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  v_norm := lower(btrim(p_username));

  -- Match either by explicit username or by registered email address
  SELECT *
  INTO v_user
  FROM public.users
  WHERE username = v_norm OR lower(email) = v_norm
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Do not extend an already active lock window
  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until > now() THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- If lock expired, reset counter and lock status
  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until <= now() THEN
    UPDATE public.users
    SET is_locked = false,
        failed_attempts = 1,
        lock_until = NULL
    WHERE id = v_user.id;
    RETURN jsonb_build_object('success', true);
  END IF;

  v_new_attempts := COALESCE(v_user.failed_attempts, 0) + 1;
  IF v_new_attempts >= 5 THEN
    UPDATE public.users
    SET failed_attempts = v_new_attempts,
        is_locked = true,
        lock_until = now() + interval '5 minutes'
    WHERE id = v_user.id;
  ELSE
    UPDATE public.users
    SET failed_attempts = v_new_attempts
    WHERE id = v_user.id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.record_login_failure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.record_login_failure(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_login_failure(p_username text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = app_private, public, pg_temp
AS $function$
  SELECT app_private.record_login_failure(p_username);
$function$;

REVOKE ALL ON FUNCTION public.record_login_failure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_failure(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
