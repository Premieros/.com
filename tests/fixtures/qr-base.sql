-- Minimal isolated ERP dependency fixture, never used with a hosted database.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
CREATE TABLE public.branches(id uuid PRIMARY KEY,name text,is_active boolean DEFAULT true);
CREATE TABLE public.users(id uuid PRIMARY KEY,branch_id uuid,is_active boolean DEFAULT true,permissions text[] DEFAULT '{}');
CREATE TABLE public.dining_tables(id uuid PRIMARY KEY,branch_id uuid,name text,is_active boolean DEFAULT true,status text DEFAULT 'vacant',updated_at timestamptz DEFAULT now());
CREATE TABLE public.products(id uuid PRIMARY KEY,branch_id uuid,name text,description text,sale_price numeric,is_active boolean DEFAULT true);
CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_number text,branch_id uuid,
  table_id uuid,order_type text DEFAULT 'dine_in',status text DEFAULT 'open',cashier_id uuid,customer_id uuid,
  guest_count integer,notes text,subtotal numeric DEFAULT 0,discount_amount numeric DEFAULT 0,discount_type text DEFAULT 'amount',
  tax_amount numeric DEFAULT 0,total numeric DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
  kitchen_status text DEFAULT 'pending',kitchen_sent_at timestamptz,kitchen_ready_at timestamptz,station text DEFAULT 'main',
  print_status text DEFAULT 'pending',printed_at timestamptz,payment_status text DEFAULT 'unpaid',payment_at timestamptz);
CREATE TABLE public.order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES public.orders(id),
  product_id uuid,unit_name text DEFAULT 'piece',quantity numeric,unit_price numeric,discount_amount numeric DEFAULT 0,
  bonus_quantity numeric DEFAULT 0,total numeric DEFAULT 0,notes text,modifier_option_ids uuid[] DEFAULT '{}',
  modifiers_snapshot jsonb DEFAULT '[]',created_at timestamptz DEFAULT now());
CREATE TABLE public.order_kitchen_sends(order_id uuid,order_item_id uuid,sent_quantity numeric DEFAULT 0);
CREATE TABLE public.order_kitchen_served_quantities(order_id uuid,order_item_id uuid,served_quantity numeric);
CREATE TABLE public.order_kitchen_inventory_events(order_id uuid,order_item_id uuid,sent_quantity numeric,voided_quantity numeric);
CREATE TABLE public.product_modifier_groups(id uuid PRIMARY KEY,branch_id uuid,is_active boolean,min_selections integer);
CREATE TABLE public.product_modifier_group_products(group_id uuid,product_id uuid,branch_id uuid);
CREATE FUNCTION public.can_permission(p text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((SELECT p=ANY(permissions) FROM public.users WHERE id=auth.uid() AND is_active),false) $$;
CREATE FUNCTION public.user_may_access_branch(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND branch_id=p AND is_active) $$;
CREATE FUNCTION public.can_manage_other_pos_orders() RETURNS boolean LANGUAGE sql AS $$ SELECT public.can_permission('users.manage') $$;
CREATE FUNCTION public.is_pos_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.next_document_number(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('success',true,'number',gen_random_uuid()::text) $$;
CREATE FUNCTION public.resolve_product_modifiers(p uuid,b uuid,o jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('success',NOT EXISTS(SELECT 1 FROM public.product_modifier_group_products gp JOIN public.product_modifier_groups g ON g.id=gp.group_id WHERE gp.product_id=p AND g.is_active AND g.min_selections>0),'price_delta',0,'snapshot','[]'::jsonb)
$$;
CREATE FUNCTION public._effective_branch_tax(p uuid) RETURNS TABLE(tax_enabled boolean,tax_rate numeric) LANGUAGE sql AS $$ SELECT true,14::numeric $$;
CREATE FUNCTION public._pos_partial_transfer_context(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT null::jsonb $$;
CREATE FUNCTION public._sent_item_void_context_matches(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public._pos_action_context_matches(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;

INSERT INTO public.branches VALUES('10000000-0000-4000-8000-000000000001','Branch A',true),('10000000-0000-4000-8000-000000000002','Branch B',true);
INSERT INTO public.users VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true,ARRAY['pos.view','pos.order.create','pos.order.edit','floor_plan.manage','pos.hold','pos.void']),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',true,ARRAY['pos.view','pos.order.create','pos.order.edit','floor_plan.manage']),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',true,ARRAY['pos.view','pos.order.create','pos.order.edit']);
INSERT INTO public.dining_tables(id,branch_id,name) VALUES('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Table A');
INSERT INTO public.products(id,branch_id,name,sale_price) VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Tea',25),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Private B',40);
