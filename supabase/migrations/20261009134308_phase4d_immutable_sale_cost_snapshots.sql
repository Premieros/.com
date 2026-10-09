create schema if not exists private;

create table if not exists private.costing_v2_control (
  id boolean primary key default true check (id),
  sale_snapshot_started_at timestamptz not null default clock_timestamp()
);

insert into private.costing_v2_control(id,sale_snapshot_started_at)
values(true,clock_timestamp())
on conflict(id) do nothing;

create table if not exists private.sale_item_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null unique references public.sale_items(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid,
  sale_quantity numeric not null check (sale_quantity>0),
  theoretical_unit_cost numeric check (theoretical_unit_cost is null or theoretical_unit_cost>=0),
  theoretical_total_cost numeric check (theoretical_total_cost is null or theoretical_total_cost>=0),
  standard_unit_cost numeric check (standard_unit_cost is null or standard_unit_cost>=0),
  standard_total_cost numeric check (standard_total_cost is null or standard_total_cost>=0),
  theoretical_status text not null check (theoretical_status in ('AVAILABLE','MISSING_INPUT')),
  recipe_id uuid,
  recipe_version integer,
  modifier_theoretical_unit_delta numeric not null default 0,
  modifier_effect_count integer not null default 0 check (modifier_effect_count>=0),
  missing_modifier_cost_count integer not null default 0 check (missing_modifier_cost_count>=0),
  selected_modifier_option_ids uuid[] not null default '{}'::uuid[],
  costing_model_version integer not null default 1,
  basis jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default clock_timestamp()
);

create index if not exists sale_item_cost_snapshots_branch_capture_idx
  on private.sale_item_cost_snapshots(branch_id,captured_at);

create index if not exists sale_item_cost_snapshots_sale_idx
  on private.sale_item_cost_snapshots(sale_id,sale_item_id);

create table if not exists private.sale_item_cost_snapshot_failures (
  sale_item_id uuid primary key,
  sale_id uuid,
  branch_id uuid,
  product_id uuid,
  error_message text not null,
  attempted_at timestamptz not null default clock_timestamp()
);

alter table private.costing_v2_control enable row level security;
alter table private.sale_item_cost_snapshots enable row level security;
alter table private.sale_item_cost_snapshot_failures enable row level security;

revoke all on table private.costing_v2_control from public, anon, authenticated, service_role;
revoke all on table private.sale_item_cost_snapshots from public, anon, authenticated, service_role;
revoke all on table private.sale_item_cost_snapshot_failures from public, anon, authenticated, service_role;

grant select on table private.costing_v2_control to service_role;
grant select on table private.sale_item_cost_snapshots to service_role;
grant select on table private.sale_item_cost_snapshot_failures to service_role;

create or replace function private.compute_sale_item_cost_snapshot(
  p_product_id uuid,
  p_branch_id uuid,
  p_modifier_option_ids uuid[],
  p_sale_quantity numeric,
  p_captured_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_item_id uuid;
  v_base_cost numeric;
  v_base_status text;
  v_modifier_delta numeric := 0;
  v_modifier_effect_count integer := 0;
  v_missing_modifier_cost_count integer := 0;
  v_recipe_id uuid;
  v_recipe_version integer;
  v_standard_cost numeric;
  v_theoretical_unit numeric;
  v_theoretical_total numeric;
  v_effective_options uuid[] := coalesce(p_modifier_option_ids,'{}'::uuid[]);
begin
  if p_product_id is null
     or p_branch_id is null
     or p_sale_quantity is null
     or p_sale_quantity<=0 then
    return jsonb_build_object('status','MISSING_INPUT','reason','INVALID_INPUT');
  end if;

  select
    l.item_id,
    c.theoretical_cost,
    c.theoretical_cost_status
  into
    v_item_id,
    v_base_cost,
    v_base_status
  from private.item_legacy_links l
  join private.canonical_item_costs c
    on c.item_id=l.item_id
   and c.branch_id=p_branch_id
  where l.source_table='products'
    and l.source_id=p_product_id
  limit 1;

  select r.id,r.version
  into v_recipe_id,v_recipe_version
  from public.recipes r
  where r.product_id=p_product_id
    and r.branch_id=p_branch_id
    and coalesce(r.is_active,true)=true
  order by coalesce(r.version,1) desc,r.created_at desc
  limit 1;

  with modifier_effects as (
    select
      e.id,
      e.quantity_delta,
      case
        when e.target_type='raw_material' and e.raw_material_id is not null
          then public._raw_cost_for_costing(e.raw_material_id,p_branch_id)
        when e.target_type='inventory_unit' and e.inventory_unit_id is not null
          then public._inventory_unit_recipe_cost(e.inventory_unit_id,p_branch_id)
        else null::numeric
      end as target_unit_cost
    from public.product_modifier_inventory_effects e
    where e.branch_id=p_branch_id
      and e.option_id=any(v_effective_options)
  )
  select
    count(*)::integer,
    count(*) filter(
      where target_unit_cost is null
         or (target_unit_cost<=0 and quantity_delta<>0)
    )::integer,
    coalesce(sum(quantity_delta*coalesce(target_unit_cost,0)),0)::numeric
  into
    v_modifier_effect_count,
    v_missing_modifier_cost_count,
    v_modifier_delta
  from modifier_effects;

  select s.standard_cost
  into v_standard_cost
  from public.item_standard_costs s
  where s.item_id=v_item_id
    and s.branch_id=p_branch_id
    and s.effective_from<=p_captured_at
    and (s.effective_to is null or s.effective_to>p_captured_at)
  order by s.effective_from desc
  limit 1;

  if coalesce(v_base_status,'MISSING_INPUT')='AVAILABLE'
     and coalesce(v_base_cost,0)>0
     and v_missing_modifier_cost_count=0 then
    v_theoretical_unit:=greatest(v_base_cost+v_modifier_delta,0);
    v_theoretical_total:=v_theoretical_unit*p_sale_quantity;
  else
    v_theoretical_unit:=null;
    v_theoretical_total:=null;
  end if;

  return jsonb_build_object(
    'status',case when v_theoretical_unit is not null then 'AVAILABLE' else 'MISSING_INPUT' end,
    'item_id',v_item_id,
    'base_theoretical_unit_cost',v_base_cost,
    'modifier_theoretical_unit_delta',coalesce(v_modifier_delta,0),
    'modifier_effect_count',coalesce(v_modifier_effect_count,0),
    'missing_modifier_cost_count',coalesce(v_missing_modifier_cost_count,0),
    'theoretical_unit_cost',v_theoretical_unit,
    'theoretical_total_cost',v_theoretical_total,
    'standard_unit_cost',v_standard_cost,
    'standard_total_cost',case
      when v_standard_cost is null then null
      else v_standard_cost*p_sale_quantity
    end,
    'recipe_id',v_recipe_id,
    'recipe_version',v_recipe_version,
    'selected_modifier_option_ids',to_jsonb(v_effective_options)
  );
end;
$$;

create or replace function private.capture_sale_item_cost_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_branch_id uuid;
  v_capture_at timestamptz:=coalesce(new.created_at,clock_timestamp());
  v_snapshot jsonb;
begin
  if new.product_id is null or coalesce(new.quantity,0)<=0 then
    return new;
  end if;

  select s.branch_id
  into v_branch_id
  from public.sales s
  where s.id=new.sale_id;

  if v_branch_id is null then
    return new;
  end if;

  v_snapshot:=private.compute_sale_item_cost_snapshot(
    new.product_id,
    v_branch_id,
    coalesce(new.modifier_option_ids,'{}'::uuid[]),
    new.quantity,
    v_capture_at
  );

  insert into private.sale_item_cost_snapshots(
    sale_item_id,sale_id,branch_id,product_id,sale_quantity,
    theoretical_unit_cost,theoretical_total_cost,
    standard_unit_cost,standard_total_cost,theoretical_status,
    recipe_id,recipe_version,modifier_theoretical_unit_delta,
    modifier_effect_count,missing_modifier_cost_count,
    selected_modifier_option_ids,costing_model_version,basis,captured_at
  )
  values(
    new.id,new.sale_id,v_branch_id,new.product_id,new.quantity,
    nullif(v_snapshot->>'theoretical_unit_cost','')::numeric,
    nullif(v_snapshot->>'theoretical_total_cost','')::numeric,
    nullif(v_snapshot->>'standard_unit_cost','')::numeric,
    nullif(v_snapshot->>'standard_total_cost','')::numeric,
    coalesce(v_snapshot->>'status','MISSING_INPUT'),
    nullif(v_snapshot->>'recipe_id','')::uuid,
    nullif(v_snapshot->>'recipe_version','')::integer,
    coalesce((v_snapshot->>'modifier_theoretical_unit_delta')::numeric,0),
    coalesce((v_snapshot->>'modifier_effect_count')::integer,0),
    coalesce((v_snapshot->>'missing_modifier_cost_count')::integer,0),
    coalesce(new.modifier_option_ids,'{}'::uuid[]),
    1,v_snapshot,v_capture_at
  )
  on conflict(sale_item_id) do nothing;

  delete from private.sale_item_cost_snapshot_failures
  where sale_item_id=new.id;

  return new;
exception
  when others then
    begin
      insert into private.sale_item_cost_snapshot_failures(
        sale_item_id,sale_id,branch_id,product_id,error_message,attempted_at
      )
      values(
        new.id,new.sale_id,v_branch_id,new.product_id,sqlerrm,clock_timestamp()
      )
      on conflict(sale_item_id) do update
      set sale_id=excluded.sale_id,
          branch_id=excluded.branch_id,
          product_id=excluded.product_id,
          error_message=excluded.error_message,
          attempted_at=excluded.attempted_at;
    exception
      when others then null;
    end;
    return new;
end;
$$;

revoke execute on function private.compute_sale_item_cost_snapshot(uuid,uuid,uuid[],numeric,timestamptz)
  from public,anon,authenticated;
revoke execute on function private.capture_sale_item_cost_snapshot_trigger()
  from public,anon,authenticated;
grant execute on function private.compute_sale_item_cost_snapshot(uuid,uuid,uuid[],numeric,timestamptz)
  to postgres,service_role;
grant execute on function private.capture_sale_item_cost_snapshot_trigger()
  to postgres,service_role;

drop trigger if exists trg_capture_sale_item_cost_snapshot on public.sale_items;
create trigger trg_capture_sale_item_cost_snapshot
after insert on public.sale_items
for each row
execute function private.capture_sale_item_cost_snapshot_trigger();

create or replace view private.sale_item_cost_snapshot_health
as
with control as (
  select sale_snapshot_started_at
  from private.costing_v2_control
  where id=true
),
eligible as (
  select
    si.id,si.sale_id,s.branch_id,si.product_id,si.created_at
  from public.sale_items si
  join public.sales s on s.id=si.sale_id
  cross join control c
  where si.product_id is not null
    and coalesce(si.quantity,0)>0
    and coalesce(si.created_at,s.created_at)>=c.sale_snapshot_started_at
)
select
  e.branch_id,
  count(*) as eligible_sale_items,
  count(cs.sale_item_id) as snapshotted_sale_items,
  count(*) filter(where cs.theoretical_status='AVAILABLE') as theoretical_available,
  count(*) filter(where cs.theoretical_status='MISSING_INPUT') as theoretical_missing_input,
  count(f.sale_item_id) as snapshot_failures,
  count(*) filter(
    where cs.sale_item_id is null
      and f.sale_item_id is null
  ) as missing_snapshot_without_failure
from eligible e
left join private.sale_item_cost_snapshots cs on cs.sale_item_id=e.id
left join private.sale_item_cost_snapshot_failures f on f.sale_item_id=e.id
group by e.branch_id;

create or replace view private.canonical_sale_cost_variance_v2
as
with scoped_sales as (
  select
    s.id as sale_id,s.branch_id,s.invoice_number,s.created_at,
    private.report_operational_net_sale_amount(s.total,s.tax_amount,s.refunded_amount)::numeric as net_sales
  from public.sales s
  where coalesce(s.is_archived,false)=false
    and coalesce(s.status,'') not in ('returned','cancelled')
),
journal_costs as (
  select ss.sale_id,round(coalesce(sum(jl.debit-jl.credit),0),2)::numeric as actual_cogs
  from scoped_sales ss
  join public.journal_entries je
    on je.branch_id=ss.branch_id
   and je.reference_id=ss.sale_id
   and je.reference_type in ('sale','fifo_cogs_reconcile')
  join public.account_mappings am
    on am.branch_id=ss.branch_id and am.semantic_key='cogs'
  join public.journal_entry_lines jl
    on jl.journal_entry_id=je.id and jl.account_id=am.account_id
  group by ss.sale_id
),
kitchen_costs as (
  select
    e.settled_sale_id as sale_id,
    round(coalesce(sum(
      case
        when e.sent_quantity>0 then
          coalesce(e.total_cost,0)
          * greatest(e.sent_quantity-coalesce(e.voided_quantity,0),0)
          / e.sent_quantity
        else 0
      end
    ),0),2)::numeric as actual_cogs
  from public.order_kitchen_inventory_events e
  join scoped_sales ss on ss.sale_id=e.settled_sale_id
  where e.settled_sale_id is not null
  group by e.settled_sale_id
),
legacy_costs as (
  select il.reference_id as sale_id,greatest(coalesce(-sum(il.total_cost),0),0)::numeric as actual_cogs
  from public.inventory_ledger il
  join scoped_sales ss on ss.sale_id=il.reference_id
  where il.entry_type='sale' and il.reference_type='sale'
  group by il.reference_id
),
resolved_actual as (
  select
    ss.sale_id,
    case
      when jc.sale_id is not null then 'JOURNAL_POSTED'
      when kc.sale_id is not null then 'KITCHEN_SNAPSHOT'
      when lc.sale_id is not null then 'LEGACY_LEDGER'
      else 'MISSING'
    end::text as actual_cogs_basis,
    case
      when jc.sale_id is not null then jc.actual_cogs
      when kc.sale_id is not null then kc.actual_cogs
      when lc.sale_id is not null then lc.actual_cogs
      else null
    end::numeric as actual_cogs
  from scoped_sales ss
  left join journal_costs jc on jc.sale_id=ss.sale_id
  left join kitchen_costs kc on kc.sale_id=ss.sale_id
  left join legacy_costs lc on lc.sale_id=ss.sale_id
),
line_basis as (
  select
    si.id as sale_item_id,
    si.sale_id,
    s.branch_id,
    greatest(si.quantity-si.refunded_quantity,0)::numeric as net_quantity,
    (jsonb_array_length(coalesce(si.modifiers_snapshot,'[]'::jsonb))>0) as has_modifiers,
    l.item_id,
    cs.sale_item_id as snapshot_sale_item_id,
    cs.theoretical_unit_cost as snapshot_theoretical_unit_cost,
    cs.theoretical_status as snapshot_theoretical_status,
    cs.standard_unit_cost as snapshot_standard_unit_cost,
    cic.theoretical_cost as current_theoretical_unit_cost,
    cic.theoretical_cost_status,
    legacy_standard.standard_cost as legacy_standard_unit_cost,
    (
      ctrl.sale_snapshot_started_at is not null
      and coalesce(si.created_at,s.created_at)>=ctrl.sale_snapshot_started_at
    ) as snapshot_expected
  from public.sale_items si
  join public.sales s on s.id=si.sale_id
  left join private.item_legacy_links l
    on l.source_table='products' and l.source_id=si.product_id
  left join private.sale_item_cost_snapshots cs
    on cs.sale_item_id=si.id
  left join private.canonical_item_costs cic
    on cic.item_id=l.item_id and cic.branch_id=s.branch_id
  left join lateral (
    select isc.standard_cost
    from public.item_standard_costs isc
    where isc.item_id=l.item_id
      and isc.branch_id=s.branch_id
      and isc.effective_from<=s.created_at
      and (isc.effective_to is null or isc.effective_to>s.created_at)
    order by isc.effective_from desc
    limit 1
  ) legacy_standard on true
  left join private.costing_v2_control ctrl on ctrl.id=true
),
resolved_lines as (
  select
    lb.*,
    case
      when lb.snapshot_sale_item_id is not null
       and lb.snapshot_theoretical_status='AVAILABLE'
       and lb.snapshot_theoretical_unit_cost is not null
        then lb.snapshot_theoretical_unit_cost
      when lb.snapshot_sale_item_id is null
       and not lb.snapshot_expected
       and not lb.has_modifiers
       and lb.current_theoretical_unit_cost is not null
       and lb.theoretical_cost_status='AVAILABLE'
        then lb.current_theoretical_unit_cost
      else null
    end::numeric as resolved_theoretical_unit_cost,
    case
      when lb.snapshot_sale_item_id is not null
       and lb.snapshot_theoretical_status='AVAILABLE'
       and lb.snapshot_theoretical_unit_cost is not null
        then 'SNAPSHOT'
      when lb.snapshot_sale_item_id is null
       and not lb.snapshot_expected
       and not lb.has_modifiers
       and lb.current_theoretical_unit_cost is not null
       and lb.theoretical_cost_status='AVAILABLE'
        then 'CURRENT_REFERENCE'
      else 'MISSING'
    end::text as resolved_theoretical_basis,
    case
      when lb.snapshot_sale_item_id is not null then lb.snapshot_standard_unit_cost
      when not lb.snapshot_expected then lb.legacy_standard_unit_cost
      else null
    end::numeric as resolved_standard_unit_cost
  from line_basis lb
),
line_rollup as (
  select
    rl.sale_id,
    count(*) filter(where rl.net_quantity>0)::int as net_line_count,
    count(*) filter(where rl.net_quantity>0 and rl.item_id is not null)::int as mapped_line_count,
    count(*) filter(
      where rl.net_quantity>0
        and rl.snapshot_sale_item_id is null
        and not rl.snapshot_expected
        and rl.has_modifiers
    )::int as modifier_unmodeled_line_count,
    count(*) filter(where rl.net_quantity>0 and rl.resolved_theoretical_unit_cost is not null)::int as theoretical_line_count,
    count(*) filter(where rl.net_quantity>0 and rl.resolved_theoretical_basis='SNAPSHOT')::int as snapshot_line_count,
    count(*) filter(where rl.net_quantity>0 and rl.resolved_theoretical_basis='CURRENT_REFERENCE')::int as current_reference_line_count,
    count(*) filter(where rl.net_quantity>0 and rl.resolved_standard_unit_cost is not null)::int as standard_line_count,
    sum(case when rl.net_quantity>0 and rl.resolved_theoretical_unit_cost is not null
      then rl.net_quantity*rl.resolved_theoretical_unit_cost else 0 end)::numeric as theoretical_partial_cost,
    sum(case when rl.net_quantity>0 and rl.resolved_standard_unit_cost is not null
      then rl.net_quantity*rl.resolved_standard_unit_cost else 0 end)::numeric as standard_partial_cost
  from resolved_lines rl
  group by rl.sale_id
)
select
  ss.sale_id,ss.branch_id,ss.invoice_number,ss.created_at as sale_created_at,ss.net_sales,
  ra.actual_cogs,ra.actual_cogs_basis,
  coalesce(lr.net_line_count,0)::int as net_line_count,
  coalesce(lr.mapped_line_count,0)::int as mapped_line_count,
  coalesce(lr.modifier_unmodeled_line_count,0)::int as modifier_unmodeled_line_count,
  coalesce(lr.theoretical_line_count,0)::int as theoretical_line_count,
  coalesce(lr.snapshot_line_count,0)::int as snapshot_line_count,
  coalesce(lr.current_reference_line_count,0)::int as current_reference_line_count,
  coalesce(lr.standard_line_count,0)::int as standard_line_count,
  lr.theoretical_partial_cost,
  case
    when coalesce(lr.net_line_count,0)=0 then 'NO_NET_LINES'
    when coalesce(lr.mapped_line_count,0)<>coalesce(lr.net_line_count,0) then 'UNMAPPED_ITEM'
    when coalesce(lr.modifier_unmodeled_line_count,0)>0 then 'MODIFIER_UNMODELED'
    when coalesce(lr.theoretical_line_count,0)<>coalesce(lr.net_line_count,0) then 'MISSING_INPUT'
    else 'COMPLETE'
  end::text as theoretical_coverage_status,
  case
    when coalesce(lr.net_line_count,0)>0
     and coalesce(lr.mapped_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.modifier_unmodeled_line_count,0)=0
     and coalesce(lr.theoretical_line_count,0)=coalesce(lr.net_line_count,0)
      then lr.theoretical_partial_cost
    else null
  end::numeric as theoretical_cost,
  case
    when coalesce(lr.net_line_count,0)=0 then 'INCOMPLETE'
    when coalesce(lr.theoretical_line_count,0)<>coalesce(lr.net_line_count,0) then 'INCOMPLETE'
    when coalesce(lr.snapshot_line_count,0)=coalesce(lr.net_line_count,0) then 'IMMUTABLE_SALE_SNAPSHOT_V1'
    when coalesce(lr.current_reference_line_count,0)=coalesce(lr.net_line_count,0) then 'CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL'
    else 'MIXED_SNAPSHOT_AND_CURRENT_REFERENCE'
  end::text as theoretical_basis,
  case
    when coalesce(lr.current_reference_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.net_line_count,0)>0 then lr.theoretical_partial_cost
    else null
  end::numeric as current_theoretical_cost,
  case
    when coalesce(lr.snapshot_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.net_line_count,0)>0 then lr.theoretical_partial_cost
    else null
  end::numeric as snapshot_theoretical_cost,
  lr.standard_partial_cost,
  case
    when coalesce(lr.net_line_count,0)=0 then 'NO_NET_LINES'
    when coalesce(lr.mapped_line_count,0)<>coalesce(lr.net_line_count,0) then 'UNMAPPED_ITEM'
    when coalesce(lr.standard_line_count,0)=0 then 'NO_STANDARD_COST'
    when coalesce(lr.standard_line_count,0)<>coalesce(lr.net_line_count,0) then 'PARTIAL_STANDARD_COST'
    else 'COMPLETE'
  end::text as standard_coverage_status,
  case
    when coalesce(lr.net_line_count,0)>0
     and coalesce(lr.mapped_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.standard_line_count,0)=coalesce(lr.net_line_count,0)
      then lr.standard_partial_cost
    else null
  end::numeric as standard_cost,
  case
    when ra.actual_cogs is not null
     and coalesce(lr.net_line_count,0)>0
     and coalesce(lr.mapped_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.modifier_unmodeled_line_count,0)=0
     and coalesce(lr.theoretical_line_count,0)=coalesce(lr.net_line_count,0)
      then ra.actual_cogs-lr.theoretical_partial_cost
    else null
  end::numeric as actual_vs_theoretical_variance,
  case
    when ra.actual_cogs is not null
     and coalesce(lr.net_line_count,0)>0
     and coalesce(lr.mapped_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.standard_line_count,0)=coalesce(lr.net_line_count,0)
      then ra.actual_cogs-lr.standard_partial_cost
    else null
  end::numeric as actual_vs_standard_variance,
  case
    when coalesce(lr.net_line_count,0)>0
     and coalesce(lr.theoretical_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.standard_line_count,0)=coalesce(lr.net_line_count,0)
      then lr.theoretical_partial_cost-lr.standard_partial_cost
    else null
  end::numeric as theoretical_vs_standard_variance,
  case when ss.net_sales>0 and ra.actual_cogs is not null
    then round(ra.actual_cogs*100.0/ss.net_sales,2) else null end::numeric as actual_food_cost_pct,
  case when ss.net_sales>0
     and coalesce(lr.net_line_count,0)>0
     and coalesce(lr.theoretical_line_count,0)=coalesce(lr.net_line_count,0)
    then round(lr.theoretical_partial_cost*100.0/ss.net_sales,2) else null end::numeric as theoretical_food_cost_pct
from scoped_sales ss
left join resolved_actual ra on ra.sale_id=ss.sale_id
left join line_rollup lr on lr.sale_id=ss.sale_id;

create or replace function public.get_sale_cost_variance_v2(
  p_branch_id uuid,p_from date default null,p_to date default null,
  p_limit integer default 200,p_offset integer default 0
)
returns table(
  sale_id uuid,invoice_number text,sale_created_at timestamptz,net_sales numeric,
  actual_cogs numeric,actual_cogs_basis text,theoretical_cost numeric,theoretical_basis text,
  theoretical_coverage_status text,standard_cost numeric,standard_coverage_status text,
  actual_vs_theoretical_variance numeric,actual_vs_standard_variance numeric,
  theoretical_vs_standard_variance numeric,actual_food_cost_pct numeric,theoretical_food_cost_pct numeric
)
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.user_may_access_branch(p_branch_id) then raise exception 'BRANCH_MISMATCH'; end if;
  if not public.can_permission('reports.costing') then raise exception 'PERMISSION_DENIED: reports.costing'; end if;
  if coalesce(p_limit,200)<1 or coalesce(p_limit,200)>500 then raise exception 'INVALID_LIMIT'; end if;
  if coalesce(p_offset,0)<0 then raise exception 'INVALID_OFFSET'; end if;

  return query
  select
    v.sale_id,v.invoice_number,v.sale_created_at,v.net_sales,
    v.actual_cogs,v.actual_cogs_basis,v.theoretical_cost,v.theoretical_basis,
    v.theoretical_coverage_status,v.standard_cost,v.standard_coverage_status,
    v.actual_vs_theoretical_variance,v.actual_vs_standard_variance,
    v.theoretical_vs_standard_variance,v.actual_food_cost_pct,v.theoretical_food_cost_pct
  from private.canonical_sale_cost_variance_v2 v
  where v.branch_id=p_branch_id
    and (p_from is null or (v.sale_created_at at time zone 'Africa/Cairo')::date>=p_from)
    and (p_to is null or (v.sale_created_at at time zone 'Africa/Cairo')::date<=p_to)
  order by v.sale_created_at desc,v.sale_id
  limit coalesce(p_limit,200)
  offset coalesce(p_offset,0);
end;
$$;

create or replace function public.get_purchase_cost_variance_v2(
  p_branch_id uuid,p_from date default null,p_to date default null,
  p_limit integer default 200,p_offset integer default 0
)
returns table(
  purchase_id uuid,invoice_number text,purchase_created_at timestamptz,raw_material_id uuid,item_id uuid,
  received_base_quantity numeric,actual_base_unit_cost numeric,actual_cost_status text,
  prior_reference_unit_cost numeric,reference_cost_status text,standard_unit_cost numeric,
  standard_cost_status text,actual_vs_reference_unit_variance numeric,
  actual_vs_reference_total_variance numeric,actual_vs_standard_unit_variance numeric,
  actual_vs_standard_total_variance numeric
)
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.user_may_access_branch(p_branch_id) then raise exception 'BRANCH_MISMATCH'; end if;
  if not public.can_permission('reports.costing') then raise exception 'PERMISSION_DENIED: reports.costing'; end if;
  if coalesce(p_limit,200)<1 or coalesce(p_limit,200)>500 then raise exception 'INVALID_LIMIT'; end if;
  if coalesce(p_offset,0)<0 then raise exception 'INVALID_OFFSET'; end if;

  return query
  select
    v.purchase_id,v.invoice_number,v.purchase_created_at,v.raw_material_id,v.item_id,
    v.received_base_quantity,v.actual_base_unit_cost,v.actual_cost_status,
    v.prior_reference_unit_cost,v.reference_cost_status,v.standard_unit_cost,
    v.standard_cost_status,v.actual_vs_reference_unit_variance,
    v.actual_vs_reference_total_variance,v.actual_vs_standard_unit_variance,
    v.actual_vs_standard_total_variance
  from private.canonical_purchase_cost_variance v
  where v.branch_id=p_branch_id
    and (p_from is null or (v.purchase_created_at at time zone 'Africa/Cairo')::date>=p_from)
    and (p_to is null or (v.purchase_created_at at time zone 'Africa/Cairo')::date<=p_to)
  order by v.purchase_created_at desc,v.purchase_id,v.raw_material_id
  limit coalesce(p_limit,200)
  offset coalesce(p_offset,0);
end;
$$;

create or replace function public.get_costing_snapshot_health_v2(p_branch_id uuid)
returns table(
  snapshot_started_at timestamptz,
  eligible_sale_items bigint,
  snapshotted_sale_items bigint,
  theoretical_available bigint,
  theoretical_missing_input bigint,
  snapshot_failures bigint,
  missing_snapshot_without_failure bigint
)
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.user_may_access_branch(p_branch_id) then raise exception 'BRANCH_MISMATCH'; end if;
  if not public.can_permission('reports.costing') then raise exception 'PERMISSION_DENIED: reports.costing'; end if;

  return query
  select
    c.sale_snapshot_started_at,
    coalesce(h.eligible_sale_items,0)::bigint,
    coalesce(h.snapshotted_sale_items,0)::bigint,
    coalesce(h.theoretical_available,0)::bigint,
    coalesce(h.theoretical_missing_input,0)::bigint,
    coalesce(h.snapshot_failures,0)::bigint,
    coalesce(h.missing_snapshot_without_failure,0)::bigint
  from private.costing_v2_control c
  left join private.sale_item_cost_snapshot_health h on h.branch_id=p_branch_id
  where c.id=true;
end;
$$;

revoke execute on function public.get_sale_cost_variance_v2(uuid,date,date,integer,integer) from public,anon;
revoke execute on function public.get_purchase_cost_variance_v2(uuid,date,date,integer,integer) from public,anon;
revoke execute on function public.get_costing_snapshot_health_v2(uuid) from public,anon;

grant execute on function public.get_sale_cost_variance_v2(uuid,date,date,integer,integer) to authenticated,service_role;
grant execute on function public.get_purchase_cost_variance_v2(uuid,date,date,integer,integer) to authenticated,service_role;
grant execute on function public.get_costing_snapshot_health_v2(uuid) to authenticated,service_role;

drop trigger if exists trg_capture_sale_item_theoretical_snapshot on public.sale_items;
drop trigger if exists trg_guard_sale_item_cost_snapshot_immutable on public.sale_items;
drop function if exists private.capture_sale_item_theoretical_snapshot();
drop function if exists private.guard_sale_item_cost_snapshot_immutable();

alter table public.sale_items
  drop constraint if exists sale_items_theoretical_snapshot_status_check,
  drop column if exists theoretical_unit_cost_snapshot,
  drop column if exists theoretical_partial_unit_cost_snapshot,
  drop column if exists theoretical_component_snapshot,
  drop column if exists theoretical_snapshot_status,
  drop column if exists theoretical_snapshot_basis,
  drop column if exists theoretical_snapshot_version,
  drop column if exists theoretical_snapshot_at;
