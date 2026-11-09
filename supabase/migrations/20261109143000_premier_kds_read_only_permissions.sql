-- Premier KDS display refresh is read-only. Viewing kitchen cards must not
-- authorize changing order status through the legacy 40-minute sweeper.
-- Retain service-role access for any independently authorized maintenance flow.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $guard$
DECLARE v_definition text;
BEGIN
  IF to_regprocedure('public.complete_stale_kitchen_orders(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREMIER_KDS_SWEEPER_MISSING';
  END IF;
  SELECT pg_get_functiondef('public.complete_stale_kitchen_orders(uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition NOT LIKE '%kitchen_auto_completed_40m%'
     OR v_definition NOT LIKE '%pos.kds_view%'
  THEN
    RAISE EXCEPTION 'PREMIER_KDS_SWEEPER_DRIFT';
  END IF;
END;
$guard$;

REVOKE EXECUTE ON FUNCTION public.complete_stale_kitchen_orders(uuid) FROM authenticated;
-- The original migration already revoked PUBLIC/anon; reaffirm that contract.
REVOKE ALL ON FUNCTION public.complete_stale_kitchen_orders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_stale_kitchen_orders(uuid) TO service_role;
COMMIT;
