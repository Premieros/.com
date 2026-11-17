-- Central, branch-scoped catalog installation registry. No provider credentials or connection state.
-- This migration is intentionally NOT a live tax/delivery integration.
create table if not exists public.integration_app_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  app_id text not null check (app_id in (
    'eta-einvoice', 'eta-ereceipt', 'zatca-clearance', 'zatca-reporting',
    'zatca-egs', 'talabat', 'hungerstation', 'jahez', 'other'
  )),
  installed_by uuid not null references public.users(id),
  installed_at timestamptz not null default now(),
  unique (organization_id, branch_id, app_id)
);

comment on table public.integration_app_installations is
  'Catalog install registry only. Installing an app never authorizes API access, starts tax issuance or activates provider connectivity.';

create index if not exists integration_app_installations_branch_idx
  on public.integration_app_installations (branch_id);

-- Check tenant consistency even for privileged insert paths. Organization membership
-- must never be inferred from browser-supplied organization_id.
create function public.integration_app_validate_branch_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.branches b
    where b.id = new.branch_id and b.organization_id = new.organization_id
  ) then
    raise exception 'INTEGRATION_BRANCH_ORGANIZATION_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger integration_app_validate_branch
before insert or update on public.integration_app_installations
for each row execute function public.integration_app_validate_branch_v1();

alter table public.integration_app_installations enable row level security;
alter table public.integration_app_installations force row level security;

-- Reading is limited to active organization members with explicit branch scope.
create policy integration_app_read on public.integration_app_installations
for select to authenticated
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
);

-- Managing shared installations is restricted to active tenant admins.
create policy integration_app_insert on public.integration_app_installations
for insert to authenticated
with check (
  installed_by = (select auth.uid())
  and exists (
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
);

create policy integration_app_delete on public.integration_app_installations
for delete to authenticated
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
);

-- No UPDATE policy. A catalog install can only be inserted or removed.
revoke all on public.integration_app_installations from public, anon, authenticated;
grant select, insert, delete on public.integration_app_installations to authenticated;
revoke all on function public.integration_app_validate_branch_v1() from public, anon, authenticated;
