-- STAGING CANDIDATE ONLY; run in disposable CI PG first.
-- Scope: close stock_counts authenticated INSERT/UPDATE RLS bypass.
-- The application uses SECURITY DEFINER create_stock_count/approve/apply RPCs.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
  AND tablename='stock_counts' AND policyname='auth_stock_counts_insert'
  AND with_check='true') THEN
  RAISE EXCEPTION 'STOCK_COUNTS_INSERT_POLICY_DRIFT';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
  AND tablename='stock_counts' AND policyname='auth_stock_counts_update'
  AND qual='true' AND with_check='true') THEN
  RAISE EXCEPTION 'STOCK_COUNTS_UPDATE_POLICY_DRIFT';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
  AND policyname IN ('premier_stock_counts_insert_scope_gate','premier_stock_counts_update_scope_gate')) THEN
  RAISE EXCEPTION 'STOCK_COUNTS_WRITE_GATES_ALREADY_EXIST';
 END IF;
END $preflight$;
CREATE POLICY premier_stock_counts_insert_scope_gate
 ON public.stock_counts AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (public.user_may_access_branch(branch_id)
  AND (public.is_platform_admin() OR public.can_permission('inventory.count.create')));
CREATE POLICY premier_stock_counts_update_scope_gate
 ON public.stock_counts AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (public.user_may_access_branch(branch_id)
  AND (public.is_platform_admin()
   OR public.can_permission('inventory.count.create')
   OR public.can_permission('inventory.count.approve')
   OR public.can_permission('inventory.count.apply')
   OR public.can_permission('inventory.count.reject')))
 WITH CHECK (public.user_may_access_branch(branch_id)
  AND (public.is_platform_admin()
   OR public.can_permission('inventory.count.create')
   OR public.can_permission('inventory.count.approve')
   OR public.can_permission('inventory.count.apply')
   OR public.can_permission('inventory.count.reject')));
COMMIT;
