-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073305; name: premier_purchase_history_permission_gate_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchases' AND policyname='financial_visibility_purchases' AND permissive='RESTRICTIVE') THEN RAISE EXCEPTION 'PURCHASES_VISIBILITY_BASELINE_DRIFT'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_items' AND policyname='financial_visibility_purchase_items' AND permissive='RESTRICTIVE') THEN RAISE EXCEPTION 'PURCHASE_ITEMS_VISIBILITY_BASELINE_DRIFT'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname IN ('premier_purchases_financial_select_gate','premier_purchase_items_financial_select_gate')) THEN RAISE EXCEPTION 'PURCHASES_GATE_ALREADY_EXISTS'; END IF;
END $guard$;
CREATE POLICY premier_purchases_financial_select_gate ON public.purchases AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.is_platform_admin() OR (public.can_permission('purchases.view') AND private.financial_row_visible(id,branch_id,created_at)));
CREATE POLICY premier_purchase_items_financial_select_gate ON public.purchase_items AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.is_platform_admin() OR (public.can_permission('purchases.view') AND private.purchase_read_visible_by_id(purchase_id)));
COMMIT;
