-- Branch-scoped manufacturing catalogs are visible only to authorized branch users.
-- Align RLS with the application's active-branch authorization rather than home branch alone.
ALTER POLICY inventory_units_branch_read ON public.inventory_units
USING (branch_id IS NULL OR public.user_may_access_branch(branch_id));
ALTER POLICY iup_branch_read ON public.inventory_unit_productions
USING (public.user_may_access_branch(branch_id));