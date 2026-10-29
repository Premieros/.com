-- Isolated CI database ONLY. Never apply fixture roles/tables to a Supabase project.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.branches(id uuid PRIMARY KEY,organization_id uuid REFERENCES public.organizations(id),name text,is_active boolean DEFAULT true);
CREATE FUNCTION public.can_permission(p_permission text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('hub_test.admin',true)='true' $$;
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.user_may_access_branch(p_branch_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p_branch_id::text=current_setting('hub_test.branch',true) $$;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branches_test_read ON public.branches FOR SELECT TO authenticated USING(public.user_may_access_branch(id));
GRANT SELECT ON public.branches,public.organizations TO authenticated;
INSERT INTO public.organizations VALUES('11111111-1111-4111-8111-111111111111'),('99999999-9999-4999-8999-999999999999');
INSERT INTO public.branches(id,organization_id,name) VALUES
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Branch A'),
 ('88888888-8888-4888-8888-888888888888','99999999-9999-4999-8999-999999999999','Branch B');
