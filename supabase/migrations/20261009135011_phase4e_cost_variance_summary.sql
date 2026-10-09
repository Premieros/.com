create or replace function public.get_cost_variance_summary_v2(
  p_branch_id uuid,
  p_from date default null,
  p_to date default null
)
returns table(
  sales_count bigint,
  comparable_sales_count bigint,
  immutable_snapshot_sales bigint,
  current_reference_sales bigint,
  incomplete_theoretical_sales bigint,
  total_net_sales numeric,
  total_actual_cogs numeric,
  comparable_net_sales numeric,
  comparable_actual_cogs numeric,
  comparable_theoretical_cost numeric,
  actual_vs_theoretical_variance numeric,
  actual_food_cost_pct numeric,
  theoretical_food_cost_pct numeric,
  standard_comparable_sales_count bigint,
  actual_vs_standard_variance numeric,
  purchase_groups bigint,
  purchase_reference_groups bigint,
  purchase_reference_variance numeric,
  purchase_standard_groups bigint,
  purchase_standard_variance numeric,
  missing_purchase_ledger_groups bigint,
  snapshot_failures bigint,
  missing_snapshot_without_failure bigint
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.user_may_access_branch(p_branch_id) then
    raise exception 'BRANCH_MISMATCH';
  end if;
  if not public.can_permission('reports.costing') then
    raise exception 'PERMISSION_DENIED: reports.costing';
  end if;

  return query
  with sale_scope as (
    select v.*
    from private.canonical_sale_cost_variance_v2 v
    where v.branch_id=p_branch_id
      and (p_from is null or (v.sale_created_at at time zone 'Africa/Cairo')::date>=p_from)
      and (p_to is null or (v.sale_created_at at time zone 'Africa/Cairo')::date<=p_to)
  ),
  comparable as (
    select *
    from sale_scope
    where actual_cogs is not null
      and theoretical_cost is not null
      and theoretical_coverage_status='COMPLETE'
  ),
  purchase_scope as (
    select v.*
    from private.canonical_purchase_cost_variance v
    where v.branch_id=p_branch_id
      and (p_from is null or (v.purchase_created_at at time zone 'Africa/Cairo')::date>=p_from)
      and (p_to is null or (v.purchase_created_at at time zone 'Africa/Cairo')::date<=p_to)
  ),
  sale_agg as (
    select
      count(*)::bigint as sales_count,
      count(*) filter(
        where actual_cogs is not null
          and theoretical_cost is not null
          and theoretical_coverage_status='COMPLETE'
      )::bigint as comparable_sales_count,
      count(*) filter(where theoretical_basis='IMMUTABLE_SALE_SNAPSHOT_V1')::bigint as immutable_snapshot_sales,
      count(*) filter(where theoretical_basis='CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL')::bigint as current_reference_sales,
      count(*) filter(where theoretical_coverage_status<>'COMPLETE')::bigint as incomplete_theoretical_sales,
      coalesce(sum(net_sales),0)::numeric as total_net_sales,
      coalesce(sum(actual_cogs),0)::numeric as total_actual_cogs,
      count(*) filter(where actual_vs_standard_variance is not null)::bigint as standard_comparable_sales_count,
      coalesce(sum(actual_vs_standard_variance) filter(where actual_vs_standard_variance is not null),0)::numeric as actual_vs_standard_variance
    from sale_scope
  ),
  comparable_agg as (
    select
      coalesce(sum(net_sales),0)::numeric as comparable_net_sales,
      coalesce(sum(actual_cogs),0)::numeric as comparable_actual_cogs,
      coalesce(sum(theoretical_cost),0)::numeric as comparable_theoretical_cost
    from comparable
  ),
  purchase_agg as (
    select
      count(*)::bigint as purchase_groups,
      count(*) filter(where actual_vs_reference_total_variance is not null)::bigint as purchase_reference_groups,
      coalesce(sum(actual_vs_reference_total_variance) filter(where actual_vs_reference_total_variance is not null),0)::numeric as purchase_reference_variance,
      count(*) filter(where actual_vs_standard_total_variance is not null)::bigint as purchase_standard_groups,
      coalesce(sum(actual_vs_standard_total_variance) filter(where actual_vs_standard_total_variance is not null),0)::numeric as purchase_standard_variance,
      count(*) filter(where actual_cost_status='MISSING_LEDGER')::bigint as missing_purchase_ledger_groups
    from purchase_scope
  ),
  health as (
    select
      coalesce(sum(snapshot_failures),0)::bigint as snapshot_failures,
      coalesce(sum(missing_snapshot_without_failure),0)::bigint as missing_snapshot_without_failure
    from private.sale_item_cost_snapshot_health
    where branch_id=p_branch_id
  )
  select
    s.sales_count,
    s.comparable_sales_count,
    s.immutable_snapshot_sales,
    s.current_reference_sales,
    s.incomplete_theoretical_sales,
    s.total_net_sales,
    s.total_actual_cogs,
    c.comparable_net_sales,
    c.comparable_actual_cogs,
    c.comparable_theoretical_cost,
    (c.comparable_actual_cogs-c.comparable_theoretical_cost)::numeric as actual_vs_theoretical_variance,
    case when c.comparable_net_sales>0
      then round(c.comparable_actual_cogs*100.0/c.comparable_net_sales,2)
      else null end::numeric as actual_food_cost_pct,
    case when c.comparable_net_sales>0
      then round(c.comparable_theoretical_cost*100.0/c.comparable_net_sales,2)
      else null end::numeric as theoretical_food_cost_pct,
    s.standard_comparable_sales_count,
    s.actual_vs_standard_variance,
    p.purchase_groups,
    p.purchase_reference_groups,
    p.purchase_reference_variance,
    p.purchase_standard_groups,
    p.purchase_standard_variance,
    p.missing_purchase_ledger_groups,
    h.snapshot_failures,
    h.missing_snapshot_without_failure
  from sale_agg s
  cross join comparable_agg c
  cross join purchase_agg p
  cross join health h;
end;
$$;

revoke execute on function public.get_cost_variance_summary_v2(uuid,date,date)
  from public,anon;
grant execute on function public.get_cost_variance_summary_v2(uuid,date,date)
  to authenticated,service_role;
