-- Premier Architecture V2 / Accounting Phase 5H
-- Read-only organization chart-of-accounts readiness, zero legacy account rewrites.
-- Existing branch-scoped chart_of_accounts remains the accounting write/source truth.
create or replace view private.organization_chart_of_accounts_v2
as
with mapped as (
  select
    b.organization_id,
    a.branch_id,
    a.id as branch_account_id,
    a.code as account_code,
    a.name as account_name,
    a.name_en as account_name_en,
    a.account_type,
    a.is_system,
    a.is_active
  from public.chart_of_accounts a
  join public.branches b on b.id=a.branch_id
), grouped as (
  select
    m.organization_id,
    m.account_code,
    min(m.account_name)::text as display_name,
    min(m.account_name_en)::text as display_name_en,
    min(m.account_type)::text as account_type,
    bool_and(m.is_active) as all_branches_active,
    bool_and(m.is_system) as all_branches_system,
    count(*)::bigint as branch_account_count,
    count(distinct m.branch_id)::bigint as mapped_branch_count,
    count(distinct m.account_name)::integer as distinct_names,
    count(distinct coalesce(m.account_name_en,''))::integer as distinct_name_en,
    count(distinct m.account_type)::integer as distinct_account_types,
    count(distinct m.is_system)::integer as distinct_system_flags,
    count(distinct m.is_active)::integer as distinct_active_flags,
    jsonb_agg(
      jsonb_build_object(
        'branch_id',m.branch_id,
        'account_id',m.branch_account_id,
        'name',m.account_name,
        'name_en',m.account_name_en,
        'account_type',m.account_type,
        'is_system',m.is_system,
        'is_active',m.is_active
      )
      order by m.branch_id,m.branch_account_id
    ) as branch_account_links
  from mapped m
  group by m.organization_id,m.account_code
), scoped as (
  select
    g.*,
    (select count(*)::bigint
     from public.branches b
     where b.organization_id=g.organization_id) as organization_branch_count
  from grouped g
)
select
  s.organization_id,
  s.account_code,
  s.display_name,
  s.display_name_en,
  s.account_type,
  s.all_branches_active,
  s.all_branches_system,
  s.branch_account_count,
  s.mapped_branch_count,
  s.organization_branch_count,
  s.distinct_names,
  s.distinct_name_en,
  s.distinct_account_types,
  s.distinct_system_flags,
  s.distinct_active_flags,
  s.branch_account_links,
  case
    when s.organization_id is null then 'MISSING_ORGANIZATION'
    when s.branch_account_count>s.mapped_branch_count then 'DUPLICATE_BRANCH_CODE'
    when s.distinct_account_types>1 then 'CONFLICT_ACCOUNT_TYPE'
    when s.distinct_names>1 then 'CONFLICT_NAME'
    when s.distinct_name_en>1 then 'CONFLICT_TRANSLATION'
    when s.distinct_system_flags>1 then 'CONFLICT_SYSTEM_FLAG'
    when s.distinct_active_flags>1 then 'CONFLICT_ACTIVE_STATUS'
    when s.mapped_branch_count<s.organization_branch_count then 'PARTIAL_BRANCH_COVERAGE'
    else 'CONSISTENT'
  end::text as readiness_status
from scoped s;

create or replace view private.organization_chart_account_conflicts_v2
as
select *
from private.organization_chart_of_accounts_v2
where readiness_status not in ('CONSISTENT','PARTIAL_BRANCH_COVERAGE');

create or replace view private.organization_chart_account_readiness_v2
as
select
  a.organization_id,
  count(*)::bigint as organization_account_codes,
  coalesce(sum(a.branch_account_count),0)::bigint as legacy_branch_account_rows,
  count(*) filter(where a.readiness_status='CONSISTENT')::bigint as consistent_codes,
  count(*) filter(where a.readiness_status='PARTIAL_BRANCH_COVERAGE')::bigint as partial_coverage_codes,
  count(*) filter(where a.readiness_status not in ('CONSISTENT','PARTIAL_BRANCH_COVERAGE'))::bigint as conflicting_codes
from private.organization_chart_of_accounts_v2 a
group by a.organization_id;

-- Internal-only readiness: it must not be exposed as a browser/API table.
revoke all on private.organization_chart_of_accounts_v2 from public,anon,authenticated,service_role;
revoke all on private.organization_chart_account_conflicts_v2 from public,anon,authenticated,service_role;
revoke all on private.organization_chart_account_readiness_v2 from public,anon,authenticated,service_role;
