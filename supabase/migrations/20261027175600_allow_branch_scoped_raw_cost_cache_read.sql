GRANT SELECT ON public.raw_material_current_costs TO authenticated;
CREATE POLICY raw_current_costs_authorized_branch_read
ON public.raw_material_current_costs FOR SELECT TO authenticated
USING (public.user_may_access_branch(branch_id));
