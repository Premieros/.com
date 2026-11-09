-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073118; name: premier_expenses_financial_permission_gate_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses' AND policyname='auth_select_expenses' AND cmd='SELECT') THEN RAISE EXCEPTION 'EXPENSES_BASELINE_DRIFT'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses' AND policyname='financial_visibility_expenses' AND cmd='SELECT') THEN RAISE EXCEPTION 'EXPENSES_FINANCIAL_POLICY_MISSING'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses' AND policyname='premier_expenses_financial_select_gate') THEN RAISE EXCEPTION 'EXPENSES_GATE_ALREADY_EXISTS'; END IF;
END $guard$;
CREATE POLICY premier_expenses_financial_select_gate
  ON public.expenses AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR (public.can_permission('expenses.view') AND private.financial_row_visible(id,branch_id,created_at)));
COMMIT;
