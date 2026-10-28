-- CI-only supporting schema. Business sale/stock/journal routines themselves are exact live snapshots in source.sql.
CREATE SCHEMA private;
CREATE TABLE public.users(id uuid PRIMARY KEY,role text,branch_id uuid,email text);
INSERT INTO public.users VALUES('33333333-3333-4333-8333-333333333333','super_admin',NULL,'test@example.test');
CREATE TABLE public.warehouses(id uuid PRIMARY KEY,branch_id uuid REFERENCES branches(id),name text,is_active boolean DEFAULT true,warehouse_type text DEFAULT 'finished');
CREATE TABLE public.products(id uuid PRIMARY KEY,branch_id uuid REFERENCES branches(id),name text,is_active boolean DEFAULT true,product_type text DEFAULT 'ready',sale_price numeric,cost_price numeric);
CREATE TABLE public.product_units(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid REFERENCES products(id),unit_name text,is_base boolean,conversion_factor numeric);
CREATE TABLE public.sales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invoice_number text UNIQUE,branch_id uuid REFERENCES branches(id),warehouse_id uuid,customer_id uuid,cashier_id uuid,salesperson_id uuid,subtotal numeric,discount_amount numeric,discount_type text,tax_amount numeric,bonus_amount numeric,total numeric,paid_amount numeric,payment_method text,status text,order_type text,table_id uuid,guest_count integer,created_at timestamptz DEFAULT now());
CREATE TABLE public.sale_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sale_id uuid REFERENCES sales(id),product_id uuid,unit_name text,quantity numeric,unit_price numeric,discount_amount numeric,bonus_quantity numeric,total numeric,modifier_option_ids uuid[],modifiers_snapshot jsonb,source_order_item_id uuid);
CREATE TABLE public.sale_item_inventory_effects(sale_item_id uuid,sale_id uuid,branch_id uuid,warehouse_id uuid,target_type text,target_id uuid,quantity numeric,UNIQUE(sale_item_id,target_type,target_id));
CREATE TABLE public.inventory_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid,branch_id uuid,warehouse_id uuid,batch_number text,quantity numeric,unit_cost numeric,source_type text,source_id uuid);
CREATE TABLE public.inventory(product_id uuid,warehouse_id uuid,branch_id uuid,quantity numeric,updated_at timestamptz,PRIMARY KEY(product_id,warehouse_id));
CREATE TABLE public.inventory_ledger(id bigserial PRIMARY KEY,product_id uuid,branch_id uuid,warehouse_id uuid,batch_number text,quantity numeric,unit_cost numeric,total_cost numeric,before_qty numeric,after_qty numeric,entry_type text,reference_type text,reference_id uuid,reference_number text,created_by uuid);
CREATE TABLE public.stock_transactions(id bigserial PRIMARY KEY,product_id uuid,warehouse_id uuid,branch_id uuid,transaction_type text,component_flow boolean,reference_type text,reference_id uuid,quantity numeric,before_quantity numeric,after_quantity numeric,unit_cost numeric,created_by uuid);
CREATE TABLE public.product_stock_debts(product_id uuid,branch_id uuid,warehouse_id uuid,sale_id uuid,reference_number text,oversold_batch_id uuid,debt_quantity numeric);
CREATE TABLE public.inventory_unit_entries(reference_type text,reference_id uuid,source_sale_item_id uuid);
CREATE TABLE public.product_modifier_options(id uuid,group_id uuid,branch_id uuid,is_active boolean,price_delta numeric);
CREATE TABLE public.product_modifier_groups(id uuid,is_active boolean,branch_id uuid);
CREATE TABLE public.product_modifier_group_products(group_id uuid,product_id uuid,branch_id uuid);
CREATE TABLE public.product_modifier_inventory_effects(option_id uuid,branch_id uuid,target_type text,raw_material_id uuid,inventory_unit_id uuid,quantity_delta numeric);
CREATE TABLE public.raw_materials(id uuid,name text,branch_id uuid,is_active boolean);
CREATE TABLE public.inventory_units(id uuid,name text,unit_type text,branch_id uuid,is_active boolean);
CREATE TABLE public.chart_of_accounts(id uuid PRIMARY KEY,branch_id uuid,code text);
CREATE TABLE public.account_mappings(branch_id uuid,semantic_key text,account_id uuid);
CREATE TABLE public.journal_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entry_number text,branch_id uuid,entry_date date,reference_type text,reference_id uuid,reference_number text,description text,created_by uuid,posting_status text DEFAULT 'POSTED');
CREATE TABLE public.journal_entry_lines(id bigserial PRIMARY KEY,journal_entry_id uuid REFERENCES journal_entries(id),account_id uuid,debit numeric,credit numeric,customer_id uuid,supplier_id uuid,note text);
CREATE TABLE public.test_audit(id bigserial PRIMARY KEY,reference_id uuid,details jsonb);
CREATE TABLE private.pos_sale_idempotency(branch_id uuid,operation_key text,operation_kind text,request_hash text,sale_id uuid,response jsonb,created_by uuid,PRIMARY KEY(branch_id,operation_key));
CREATE SEQUENCE public.test_document_number;
CREATE FUNCTION public.next_document_number(p_type text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('number',nextval('public.test_document_number')::text)$$;
CREATE FUNCTION public.is_pos_admin() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT public.can_permission('branches.manage')$$;
CREATE FUNCTION public.subscription_expired(p_branch_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE FUNCTION public.subscription_status(p_branch_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.effective_allow_negative_stock(p_branch_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE FUNCTION public._effective_branch_tax(p_branch_id uuid) RETURNS TABLE(tax_enabled boolean,tax_rate numeric) LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('hub_test.tax',true),'false')='true',14::numeric$$;
CREATE FUNCTION public.resolve_product_modifiers(p_product uuid,p_branch uuid,p_options jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT jsonb_build_object('success',true,'price_delta',0,'snapshot','[]'::jsonb)$$;
CREATE FUNCTION public.log_audit_action(p_branch uuid,p_action text,p_entity text,p_id uuid,p_details jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF current_setting('hub_test.fail_after_stock',true)='true' THEN RAISE EXCEPTION 'INJECTED_AFTER_STOCK'; END IF;
 INSERT INTO public.test_audit(reference_id,details) VALUES(p_id,p_details);
END$$;
-- Relevant visibility is branch-scoped, as with production RLS. No UPDATE/DELETE permission on canonical financial rows.
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['products','warehouses','sales','journal_entries'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY test_read ON public.%I FOR SELECT TO authenticated USING(public.user_may_access_branch(branch_id))',t);
 END LOOP;
END$$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT UPDATE ON public.products,public.warehouses TO authenticated;
INSERT INTO public.warehouses(id,branch_id,name) VALUES('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','Finished A'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888','Other branch');
INSERT INTO public.products(id,branch_id,name,sale_price,cost_price) VALUES('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','Ready A',2.50,1.00);
INSERT INTO public.product_units(product_id,unit_name,is_base,conversion_factor) VALUES('66666666-6666-4666-8666-666666666666','piece',true,1);
INSERT INTO public.inventory_batches(product_id,branch_id,warehouse_id,batch_number,quantity,unit_cost) VALUES('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555','legacy-cheap-batch',20,0.10);
INSERT INTO public.chart_of_accounts(id,branch_id,code) VALUES
 ('a1111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','CASH'),
 ('a2222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','REVENUE'),
 ('a3333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','COGS'),
 ('a4444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','INVENTORY');
INSERT INTO public.account_mappings(branch_id,semantic_key,account_id) SELECT branch_id,CASE code WHEN 'CASH' THEN 'cash' WHEN 'REVENUE' THEN 'revenue' WHEN 'COGS' THEN 'cogs' ELSE 'inventory_fg' END,id FROM public.chart_of_accounts;
