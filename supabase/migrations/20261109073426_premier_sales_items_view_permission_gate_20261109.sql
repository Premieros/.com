-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073426; name: premier_sales_items_view_permission_gate_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales' AND policyname='financial_visibility_sales' AND permissive='RESTRICTIVE') THEN RAISE EXCEPTION 'SALES_HISTORY_BASELINE_DRIFT'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sale_items' AND policyname='financial_visibility_sale_items' AND permissive='RESTRICTIVE') THEN RAISE EXCEPTION 'SALE_ITEMS_HISTORY_BASELINE_DRIFT'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname IN ('premier_sales_financial_select_gate','premier_sale_items_financial_select_gate')) THEN RAISE EXCEPTION 'SALES_GATE_ALREADY_EXISTS'; END IF;
END $guard$;
CREATE POLICY premier_sales_financial_select_gate ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.is_platform_admin() OR (public.can_permission('sales.view') AND private.sale_read_visible(id,branch_id,created_at)));
CREATE POLICY premier_sale_items_financial_select_gate ON public.sale_items AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.is_platform_admin() OR (public.can_permission('sales.view') AND private.sale_read_visible_by_id(sale_id)));
COMMIT;
