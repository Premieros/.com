-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109074100; name: premier_product_unit_links_multibranch_permission_gate_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_unit_links' AND policyname='pul_branch_read') THEN RAISE EXCEPTION 'PRODUCT_UNIT_LINKS_BASELINE_DRIFT'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_unit_links' AND policyname IN ('premier_product_unit_links_branch_gate','premier_product_unit_links_multibranch_read')) THEN RAISE EXCEPTION 'PRODUCT_UNIT_LINKS_GATE_ALREADY_EXISTS'; END IF;
 IF EXISTS (SELECT 1 FROM public.product_unit_links pul JOIN public.products p ON p.id=pul.product_id JOIN public.inventory_units u ON u.id=pul.unit_id WHERE p.branch_id IS DISTINCT FROM u.branch_id) THEN RAISE EXCEPTION 'PRODUCT_UNIT_LINK_BRANCH_MISMATCH'; END IF;
END $guard$;
CREATE POLICY premier_product_unit_links_branch_gate
 ON public.product_unit_links AS RESTRICTIVE FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_unit_links.product_id AND public.user_may_access_branch(p.branch_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_unit_links.product_id AND public.user_may_access_branch(p.branch_id)));
CREATE POLICY premier_product_unit_links_multibranch_read
 ON public.product_unit_links AS PERMISSIVE FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_unit_links.product_id AND public.user_may_access_branch(p.branch_id)));
COMMIT;
