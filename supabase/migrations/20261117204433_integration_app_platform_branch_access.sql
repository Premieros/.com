-- Allow platform administrators only in branches explicitly granted to them.
-- Tenant owners/admins continue using the pre-existing membership policies.
-- The registry's forced RLS, tenant-matching trigger and no-UPDATE rule remain.
create policy integration_app_platform_read
on public.integration_app_installations for select to authenticated
using (
  exists (
    select 1 from public.users u
    join public.user_branch_access a on a.user_id = u.id
    where u.id = (select auth.uid())
      and u.is_active and u.role = 'super_admin'
      and a.branch_id = integration_app_installations.branch_id
  )
);

create policy integration_app_platform_insert
on public.integration_app_installations for insert to authenticated
with check (
  installed_by = (select auth.uid())
  and exists (
    select 1 from public.users u
    join public.user_branch_access a on a.user_id = u.id
    where u.id = (select auth.uid())
      and u.is_active and u.role = 'super_admin'
      and a.branch_id = integration_app_installations.branch_id
  )
);

create policy integration_app_platform_delete
on public.integration_app_installations for delete to authenticated
using (
  exists (
    select 1 from public.users u
    join public.user_branch_access a on a.user_id = u.id
    where u.id = (select auth.uid())
      and u.is_active and u.role = 'super_admin'
      and a.branch_id = integration_app_installations.branch_id
  )
);
