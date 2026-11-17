-- A platform admin can view every branch under the existing branches RLS
-- policy (is_platform_admin). Align the catalog installation read/write
-- policies with that same platform-admin scope. Owners/admins remain subject
-- to tenant membership and branch guards. The BEFORE INSERT trigger still
-- proves branch.organization_id matches every install record; installed_by
-- must still match auth.uid(), and UPDATE remains denied.
alter policy integration_app_read on public.integration_app_installations
using (
  exists (
    select 1 from public.users u
    join public.organization_members m
      on m.user_id = u.id and m.organization_id = integration_app_installations.organization_id
    where u.id = (select auth.uid()) and u.is_active and m.is_active
      and (
        u.branch_id = integration_app_installations.branch_id
        or exists (
          select 1 from public.user_branch_access a
          where a.user_id = u.id and a.branch_id = integration_app_installations.branch_id
        )
        or (u.role = 'super_admin' and u.branch_id is null)
      )
  )
  or (select public.is_platform_admin())
);

alter policy integration_app_insert on public.integration_app_installations
with check (
  installed_by = (select auth.uid())
  and (
    exists (
      select 1 from public.users u
      join public.organization_members m
        on m.user_id = u.id and m.organization_id = integration_app_installations.organization_id
      where u.id = (select auth.uid()) and u.is_active and m.is_active
        and (u.role = 'super_admin' or m.membership_role in ('owner', 'admin'))
        and (
          u.branch_id = integration_app_installations.branch_id
          or exists (
            select 1 from public.user_branch_access a
            where a.user_id = u.id and a.branch_id = integration_app_installations.branch_id
          )
          or (u.role = 'super_admin' and u.branch_id is null)
        )
    )
    or (select public.is_platform_admin())
  )
);

alter policy integration_app_delete on public.integration_app_installations
using (
  exists (
    select 1 from public.users u
    join public.organization_members m
      on m.user_id = u.id and m.organization_id = integration_app_installations.organization_id
    where u.id = (select auth.uid()) and u.is_active and m.is_active
      and (u.role = 'super_admin' or m.membership_role in ('owner', 'admin'))
      and (
        u.branch_id = integration_app_installations.branch_id
        or exists (
          select 1 from public.user_branch_access a
          where a.user_id = u.id and a.branch_id = integration_app_installations.branch_id
        )
        or (u.role = 'super_admin' and u.branch_id is null)
      )
  )
  or (select public.is_platform_admin())
);
