-- Draft for disposable CI. Do not apply to production without release approval.
-- A requester must never be able to insert an already-approved row via
-- PostgREST; the RPCs run as their owner and retain their write privileges.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.approval_requests FROM PUBLIC, anon, authenticated;
-- Also close the RLS insert path (including any residual column-level grants).
DROP POLICY IF EXISTS approval_requests_insert ON public.approval_requests;
CREATE POLICY approval_requests_insert ON public.approval_requests
  FOR INSERT TO authenticated WITH CHECK (false);

-- Both normal and split settlement currently accept a NULL approval target as
-- a wildcard. A persisted order must instead have its own explicit approval.
-- Walk-in sales without a persisted order still match NULL to NULL.
-- This intentionally invalidates old unbound approvals for persisted orders.
DO $migration$
DECLARE
  target regprocedure;
  definition text;
  old_predicate constant text := '(entity_id IS NULL OR entity_id IS NOT DISTINCT FROM p_order_id)';
  new_predicate constant text := '(entity_id IS NOT DISTINCT FROM p_order_id)';
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure,
    'public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(target);
    IF position(old_predicate IN definition) = 0 THEN
      RAISE EXCEPTION 'Expected discount scope predicate not found in %', target;
    END IF;
    EXECUTE replace(definition, old_predicate, new_predicate);
  END LOOP;
END;
$migration$;
