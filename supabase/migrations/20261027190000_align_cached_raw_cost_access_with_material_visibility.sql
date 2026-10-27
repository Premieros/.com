DROP POLICY IF EXISTS raw_current_costs_authorized_branch_read ON public.raw_material_current_costs;
CREATE POLICY raw_current_costs_authorized_branch_read
ON public.raw_material_current_costs FOR SELECT TO authenticated
USING (public.is_platform_admin() OR public.user_may_access_branch(branch_id));
