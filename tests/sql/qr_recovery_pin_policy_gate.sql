-- Run after CI-only canonical migration replay, not on production.
DO $gate$
DECLARE
  v_default text;
  v_lookup text;
  v_resume text;
  v_saver text;
BEGIN
  SELECT column_default INTO v_default FROM information_schema.columns
  WHERE table_schema='qr_private' AND table_name='branch_settings'
    AND column_name='recovery_pin_enabled';
  IF v_default IS NULL OR v_default NOT LIKE '%false%' THEN
    RAISE EXCEPTION 'Recovery PIN must default disabled';
  END IF;

  SELECT pg_get_functiondef('qr_private.lookup(text,text,text)'::regprocedure)
    INTO v_lookup;
  IF position('recovery_unavailable' IN v_lookup)=0
     OR position('v_has_request AND COALESCE(v_recovery_enabled,false)' IN v_lookup)=0
  THEN
    RAISE EXCEPTION 'Customer lookup must honor recovery policy';
  END IF;

  SELECT pg_get_functiondef('public.qr_guest_resume(text,text,text,text)'::regprocedure)
    INTO v_resume;
  IF position('QR_RECOVERY_DISABLED' IN v_resume)=0
     OR position('qr_private.resume_visit' IN v_resume)=0
  THEN
    RAISE EXCEPTION 'Guest resume must be server gated';
  END IF;

  SELECT pg_get_functiondef(
      'public.qr_save_customer_settings_with_recovery(uuid,boolean,jsonb,text[],boolean,boolean)'::regprocedure
    ) INTO v_saver;
  IF position('qr_private.save_customer_settings' IN v_saver)=0
     OR position('recovery_pin_enabled=p_recovery' IN v_saver)=0
  THEN
    RAISE EXCEPTION 'Guest settings and recovery toggle must save atomically';
  END IF;
  IF has_function_privilege('anon',
      'public.qr_save_customer_settings_with_recovery(uuid,boolean,jsonb,text[],boolean,boolean)',
      'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous visitor may not change recovery setting';
  END IF;
END;
$gate$;
