-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109072830; name: premier_stock_counts_branch_permission_gate_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $preflight$
BEGIN
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='stock_counts' AND policyname='auth_stock_counts_select' AND cmd='SELECT' AND qual='true') <> 1 THEN
 RAISE EXCEPTION 'STOCK_COUNTS_BASELINE_POLICY_DRIFT';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_counts' AND policyname='premier_stock_counts_branch_select_gate') THEN
 RAISE EXCEPTION 'STOCK_COUNTS_GATE_ALREADY_EXISTS';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.stock_counts'::regclass) THEN RAISE EXCEPTION 'STOCK_COUNTS_RLS_DISABLED'; END IF;
END $preflight$;
CREATE POLICY premier_stock_counts_branch_select_gate
 ON public.stock_counts AS RESTRICTIVE FOR SELECT TO authenticated
 USING (
   public.user_may_access_branch(branch_id)
   AND (public.is_platform_admin()
       OR public.can_permission('inventory.view')
       OR public.can_permission('inventory.count.create')
       OR public.can_permission('inventory.count.approve')
       OR public.can_permission('inventory.count.apply')
       OR public.can_permission('inventory.count.reject'))
 );
DO $verify$
BEGIN
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='stock_counts' AND policyname='premier_stock_counts_branch_select_gate' AND permissive='RESTRICTIVE' AND cmd='SELECT' AND roles::text LIKE '%authenticated%' AND qual LIKE '%user_may_access_branch%')<>1 THEN
 RAISE EXCEPTION 'STOCK_COUNTS_GATE_POSTCONDITION_FAILED';
 END IF;
END $verify$;
COMMIT;
