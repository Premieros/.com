-- Premier Architecture V2 Phase 5I: organization-owned shadow CoA and stable identity links.
-- Roll-forward additive only: preserve ALL legacy branch account UUIDs, account mappings,
-- posted journal lines, period locks, FIFO and sale/purchase posting writers.
-- Phase 5H is a required readiness dependency.

do $phase5i$
begin
  if to_regclass('private.organization_chart_of_accounts_v2') is null then
    raise exception 'PHASE5I_REQUIRES_PHASE5H';
  end if;
  if exists(select 1 from private.organization_chart_account_conflicts_v2) then
    raise exception 'PHASE5I_ORGANIZATION_ACCOUNT_CONFLICTS_REQUIRE_REVIEW';
  end if;
  if exists (
    select 1 from public.chart_of_accounts a
    join public.branches b on b.id=a.branch_id
    where b.organization_id is null
  ) then
    raise exception 'PHASE5I_UNSCOPED_BRANCH_ACCOUNTS';
  end if;
end
$phase5i$;

create table private.organization_accounts_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check(code=btrim(code) and code<>'' and code=upper(code)),
  name text not null check (btrim(name)<>''),
  name_en text,
  account_type text not null check(account_type in ('asset','liability','equity','income','expense')),
  is_system boolean not null,
  is_active boolean not null,
  initial_branch_account_count bigint not null check(initial_branch_account_count>0),
  initial_readiness_status text not null
    check(initial_readiness_status in ('CONSISTENT','PARTIAL_BRANCH_COVERAGE')),
  bootstrapped_at timestamptz not null default now(),
  constraint uq_organization_accounts_v2_org_code unique(organization_id,code),
  constraint uq_organization_accounts_v2_id_org unique(id,organization_id)
);

create table private.organization_account_branch_links_v2 (
  branch_account_id uuid primary key
    references public.chart_of_accounts(id) on delete cascade,
  organization_account_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  linked_at timestamptz not null default now(),
  constraint fk_organization_account_link_org
    foreign key(organization_account_id,organization_id)
    references private.organization_accounts_v2(id,organization_id) on delete cascade,
  constraint uq_organization_account_branch_links_v2
    unique(organization_account_id,branch_id)
);

create index organization_account_branch_links_v2_org_idx
  on private.organization_account_branch_links_v2(organization_id,organization_account_id);

create index organization_account_branch_links_v2_branch_idx
  on private.organization_account_branch_links_v2(branch_id,branch_account_id);

alter table private.organization_accounts_v2 enable row level security;
alter table private.organization_account_branch_links_v2 enable row level security;
revoke all on private.organization_accounts_v2
  from public,anon,authenticated,service_role;
revoke all on private.organization_account_branch_links_v2
  from public,anon,authenticated,service_role;

-- Bootstrap only nonconflicting, explicitly identified organization/code keys.
-- Existing chart_of_accounts keeps its legacy IDs and stays the operational writer.
insert into private.organization_accounts_v2 (
  organization_id,code,name,name_en,account_type,is_system,is_active,
  initial_branch_account_count,initial_readiness_status
)
select
  r.organization_id,r.account_code,r.display_name,r.display_name_en,
  r.account_type,r.all_branches_system,r.all_branches_active,
  r.branch_account_count,r.readiness_status
from private.organization_chart_of_accounts_v2 r
where r.organization_id is not null
  and r.readiness_status in ('CONSISTENT','PARTIAL_BRANCH_COVERAGE');

insert into private.organization_account_branch_links_v2 (
  branch_account_id,organization_account_id,organization_id,branch_id
)
select a.id,oa.id,b.organization_id,b.id
from public.chart_of_accounts a
join public.branches b on b.id=a.branch_id
join private.organization_accounts_v2 oa
  on oa.organization_id=b.organization_id and oa.code=a.code;

-- A strict bootstrap reconciliation fails the migration atomically, not partially.
do $phase5i$
declare
  v_original bigint;
  v_mapped bigint;
  v_orphaned bigint;
begin
  select count(*) into v_original from public.chart_of_accounts;
  select count(*) into v_mapped from private.organization_account_branch_links_v2;
  if v_original<>v_mapped then
    raise exception 'PHASE5I_INCOMPLETE_BOOTSTRAP expected=% mapped=%',v_original,v_mapped;
  end if;
  select count(*) into v_orphaned
  from private.organization_account_branch_links_v2 m
  join public.chart_of_accounts a on a.id=m.branch_account_id
  join public.branches b on b.id=a.branch_id
  join private.organization_accounts_v2 oa on oa.id=m.organization_account_id
  where m.organization_id is distinct from b.organization_id
     or m.branch_id is distinct from a.branch_id
     or oa.code is distinct from a.code
     or oa.account_type is distinct from a.account_type;
  if v_orphaned<>0 then
    raise exception 'PHASE5I_INVALID_ORGANIZATION_ACCOUNT_LINKS count=%',v_orphaned;
  end if;
end
$phase5i$;

-- Live health checks against branch-account sources detect future drift
-- without changing legacy account writers or auto-mapping new accounts.
create view private.organization_account_link_health_v2 as
select
  a.id as branch_account_id,
  a.branch_id,
  b.organization_id as current_organization_id,
  m.organization_id as mapped_organization_id,
  m.organization_account_id,
  a.code as branch_code,
  oa.code as organization_code,
  case
    when b.organization_id is null then 'MISSING_ORGANIZATION'
    when m.branch_account_id is null then 'UNMAPPED_BRANCH_ACCOUNT'
    when m.branch_id is distinct from a.branch_id then 'BRANCH_ID_MISMATCH'
    when m.organization_id is distinct from b.organization_id then 'ORGANIZATION_ID_MISMATCH'
    when oa.id is null then 'MISSING_ORGANIZATION_ACCOUNT'
    when oa.code is distinct from a.code then 'CODE_DRIFT'
    when oa.account_type is distinct from a.account_type then 'ACCOUNT_TYPE_DRIFT'
    when oa.name is distinct from a.name then 'NAME_DRIFT'
    when oa.name_en is distinct from a.name_en then 'TRANSLATION_DRIFT'
    when oa.is_system is distinct from a.is_system then 'SYSTEM_FLAG_DRIFT'
    when oa.is_active is distinct from a.is_active then 'ACTIVE_STATUS_DRIFT'
    else 'MAPPED_OK'
  end::text as mapping_status
from public.chart_of_accounts a
join public.branches b on b.id=a.branch_id
left join private.organization_account_branch_links_v2 m on m.branch_account_id=a.id
left join private.organization_accounts_v2 oa on oa.id=m.organization_account_id;

create view private.organization_account_mapping_summary_v2 as
select
  b.organization_id,
  count(distinct oa.id)::bigint as organization_accounts,
  (select count(*)::bigint
    from private.organization_account_link_health_v2 h
    where h.current_organization_id=b.organization_id) as branch_account_rows,
  (select count(*)::bigint
    from private.organization_account_link_health_v2 h
    where h.current_organization_id=b.organization_id
      and h.mapping_status='MAPPED_OK') as matched_branch_accounts,
  (select count(*)::bigint
    from private.organization_account_link_health_v2 h
    where h.current_organization_id=b.organization_id
      and h.mapping_status<>'MAPPED_OK') as divergent_branch_accounts
from public.branches b
left join private.organization_accounts_v2 oa on oa.organization_id=b.organization_id
where b.organization_id is not null
group by b.organization_id;

revoke all on private.organization_account_link_health_v2
  from public,anon,authenticated,service_role;
revoke all on private.organization_account_mapping_summary_v2
  from public,anon,authenticated,service_role;
