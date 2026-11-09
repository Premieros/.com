-- Disposable integration fixture only. NEVER run against Premier production.
CREATE SCHEMA private;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.branches(id uuid PRIMARY KEY);
CREATE TABLE public.warehouses(id uuid PRIMARY KEY, branch_id uuid);
CREATE TABLE public.products(id uuid PRIMARY KEY, branch_id uuid NOT NULL);
CREATE TABLE public.orders(id uuid PRIMARY KEY, branch_id uuid NOT NULL, inventory_warehouse_id uuid);
CREATE TABLE public.sales(id uuid PRIMARY KEY, branch_id uuid NOT NULL, warehouse_id uuid, created_at timestamptz NOT NULL);
CREATE TABLE public.inventory(id uuid PRIMARY KEY,branch_id uuid NOT NULL,warehouse_id uuid NOT NULL,product_id uuid NOT NULL);
CREATE TABLE public.purchases(id uuid PRIMARY KEY,branch_id uuid,warehouse_id uuid,created_at timestamptz NOT NULL);
CREATE TABLE public.purchase_items(id uuid PRIMARY KEY,purchase_id uuid NOT NULL);
CREATE TABLE public.stock_counts(id uuid PRIMARY KEY,branch_id uuid NOT NULL,warehouse_id uuid NOT NULL);
CREATE TABLE public.recipes(id uuid PRIMARY KEY,branch_id uuid NOT NULL,product_id uuid NOT NULL);
CREATE TABLE public.sale_payments(id uuid PRIMARY KEY,sale_id uuid NOT NULL,branch_id uuid NOT NULL);
CREATE TABLE public.order_items(id uuid PRIMARY KEY,order_id uuid NOT NULL);
CREATE TABLE public.order_kitchen_sends(id uuid PRIMARY KEY,order_id uuid NOT NULL,branch_id uuid NOT NULL,order_item_id uuid NOT NULL);
CREATE TABLE public.expenses(id uuid PRIMARY KEY,branch_id uuid NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE public.sale_items(id uuid PRIMARY KEY,sale_id uuid NOT NULL);
CREATE TABLE public.inventory_units(id uuid PRIMARY KEY, branch_id uuid NOT NULL);
CREATE TABLE public.product_unit_links(id uuid PRIMARY KEY, product_id uuid NOT NULL, unit_id uuid NOT NULL);

-- RLS helpers model the branch/history contract, not production credentials.
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE
 AS $$ SELECT current_setting('app.test_admin',true)='yes' $$;
CREATE FUNCTION public.can_permission(p_permission text) RETURNS boolean LANGUAGE sql STABLE AS
$permission$
 SELECT public.is_platform_admin()
 OR p_permission=ANY(string_to_array(coalesce(current_setting('app.test_permissions',true),''),','))
$permission$;
CREATE FUNCTION public.user_may_access_branch(p_branch_id uuid)
 RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT public.is_platform_admin()
 OR current_setting('app.allowed_branch',true)=p_branch_id::text $$;
CREATE FUNCTION private.financial_row_visible(p_row_id uuid,p_branch_id uuid,p_created_at timestamptz)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT public.user_may_access_branch(p_branch_id)
 AND p_created_at >= now() - interval '7 days' $$;
CREATE FUNCTION private.sale_read_visible(p_sale_id uuid,p_branch_id uuid,p_created_at timestamptz)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT private.financial_row_visible(p_sale_id,p_branch_id,p_created_at) $$;
CREATE FUNCTION private.purchase_read_visible_by_id(p_purchase_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $function$
 SELECT coalesce((SELECT private.financial_row_visible(p.id,p.branch_id,p.created_at)
                  FROM public.purchases p WHERE p.id=p_purchase_id),false) $function$;
CREATE FUNCTION private.sale_read_visible_by_id(p_sale_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT coalesce((SELECT private.sale_read_visible(s.id,s.branch_id,s.created_at)
                  FROM public.sales s WHERE s.id=p_sale_id),false) $$;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_unit_links ENABLE ROW LEVEL SECURITY;

-- Intentionally permissive legacy policies: candidate RESTRICTIVE gates
-- MUST close the historical visibility / branch privilege OR-bypass.
CREATE POLICY legacy_expenses_select ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY legacy_purchases_select ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY legacy_purchase_items_select ON public.purchase_items FOR SELECT TO authenticated USING (true);
CREATE POLICY legacy_stock_counts_select ON public.stock_counts FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_stock_counts_insert ON public.stock_counts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_stock_counts_update ON public.stock_counts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY legacy_sale_items_select ON public.sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY legacy_sales_select ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY legacy_pul_select ON public.product_unit_links FOR SELECT TO authenticated USING (true);

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT,UPDATE ON public.stock_counts TO authenticated;

INSERT INTO public.branches VALUES
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.warehouses VALUES
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002');
INSERT INTO public.products VALUES
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000002');
INSERT INTO public.orders VALUES
 ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011'),
 ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012');
INSERT INTO public.sales VALUES
 ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',now()),
 ('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',now()-interval '60 days'),
 ('00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012',now());
INSERT INTO public.order_items VALUES
 ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000031'),
 ('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000032');
INSERT INTO public.expenses VALUES
 ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000001',now()),
 ('00000000-0000-0000-0000-000000000062','00000000-0000-0000-0000-000000000001',now()-interval '60 days'),
 ('00000000-0000-0000-0000-000000000063','00000000-0000-0000-0000-000000000002',now());
INSERT INTO public.sale_items VALUES
 ('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000041'),
 ('00000000-0000-0000-0000-000000000072','00000000-0000-0000-0000-000000000042'),
 ('00000000-0000-0000-0000-000000000073','00000000-0000-0000-0000-000000000043');
INSERT INTO public.inventory_units VALUES
 ('00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000002');
INSERT INTO public.product_unit_links VALUES
 ('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000081'),
 ('00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000082');

-- Add representative recent/old/other-branch history for purchase and stock-count RLS.
INSERT INTO public.purchases VALUES
 ('00000000-0000-0000-0000-000000000121','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',now()),
 ('00000000-0000-0000-0000-000000000122','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',now()-interval '60 days'),
 ('00000000-0000-0000-0000-000000000123','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012',now());
INSERT INTO public.purchase_items VALUES
 ('00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000121'),
 ('00000000-0000-0000-0000-000000000132','00000000-0000-0000-0000-000000000122'),
 ('00000000-0000-0000-0000-000000000133','00000000-0000-0000-0000-000000000123');
INSERT INTO public.stock_counts VALUES
 ('00000000-0000-0000-0000-000000000141','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011'),
 ('00000000-0000-0000-0000-000000000142','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012');
