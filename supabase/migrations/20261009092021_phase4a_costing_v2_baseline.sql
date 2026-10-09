create table if not exists public.item_standard_costs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  standard_cost numeric(18,6) not null check (standard_cost >= 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  unique(item_id, branch_id, effective_from)
);

create index if not exists item_standard_costs_lookup_idx
  on public.item_standard_costs(item_id, branch_id, effective_from desc);

alter table public.item_standard_costs enable row level security;

drop policy if exists item_standard_costs_select_accessible_branch on public.item_standard_costs;
create policy item_standard_costs_select_accessible_branch
on public.item_standard_costs
for select
to authenticated
using (
  public.user_may_access_branch(branch_id)
  and exists (
    select 1
    from public.items i
    join public.branches b on b.id = item_standard_costs.branch_id
    where i.id = item_standard_costs.item_id
      and i.organization_id = b.organization_id
  )
);

revoke all on table public.item_standard_costs from anon, authenticated;
grant select on table public.item_standard_costs to authenticated;
grant all on table public.item_standard_costs to service_role;

create or replace view private.canonical_item_costs
as
with base as (
  select
    c.item_id,
    c.organization_id,
    c.branch_id,
    c.item_type,
    c.name,
    c.code,
    l.source_table,
    l.source_id
  from public.canonical_item_catalog c
  join private.item_legacy_links l on l.item_id = c.item_id
)
select
  b.item_id,
  b.organization_id,
  b.branch_id,
  b.item_type,
  b.name,
  b.code,
  case
    when b.source_table='raw_materials' then nullif(rmi.avg_cost,0)
    when b.source_table='inventory_units' then nullif(iu.cost_price,0)
    when b.source_table='products' and p.product_type='ready' then nullif(p.cost_price,0)
    else null
  end::numeric as inventory_cost,
  case
    when b.source_table='raw_materials'
      then public._raw_cost_for_costing(b.source_id,b.branch_id)
    else null
  end::numeric as costing_reference_cost,
  case
    when b.source_table='raw_materials'
      then public._raw_cost_for_costing(b.source_id,b.branch_id)
    when b.source_table='inventory_units'
      then public._inventory_unit_recipe_cost(b.source_id,b.branch_id)
    when b.source_table='products' and p.product_type='manufactured'
      then public._product_recipe_cost(b.source_id,b.branch_id)
    when b.source_table='products'
      then nullif(p.cost_price,0)
    else null
  end::numeric as theoretical_cost,
  sc.standard_cost,
  sc.effective_from as standard_effective_from,
  sc.effective_to as standard_effective_to,
  case
    when b.source_table='products' and p.product_type='manufactured' then 'BOM_THEORETICAL'
    when b.source_table='inventory_units' then 'BOM_THEORETICAL'
    when b.source_table='raw_materials' then 'RAW_REFERENCE'
    when b.source_table='products' then 'STORED_REFERENCE'
    else 'UNKNOWN'
  end::text as theoretical_cost_basis,
  case
    when coalesce(
      case
        when b.source_table='raw_materials' then public._raw_cost_for_costing(b.source_id,b.branch_id)
        when b.source_table='inventory_units' then public._inventory_unit_recipe_cost(b.source_id,b.branch_id)
        when b.source_table='products' and p.product_type='manufactured' then public._product_recipe_cost(b.source_id,b.branch_id)
        when b.source_table='products' then nullif(p.cost_price,0)
        else null
      end,
      0
    ) > 0 then 'AVAILABLE'
    else 'MISSING_INPUT'
  end::text as theoretical_cost_status
from base b
left join public.raw_materials rm
  on b.source_table='raw_materials'
 and rm.id=b.source_id
left join public.raw_material_inventory rmi
  on b.source_table='raw_materials'
 and rmi.raw_material_id=b.source_id
 and rmi.branch_id=b.branch_id
left join public.inventory_units iu
  on b.source_table='inventory_units'
 and iu.id=b.source_id
left join public.products p
  on b.source_table='products'
 and p.id=b.source_id
left join lateral (
  select
    s.standard_cost,
    s.effective_from,
    s.effective_to
  from public.item_standard_costs s
  where s.item_id=b.item_id
    and s.branch_id=b.branch_id
    and s.effective_from <= now()
    and (s.effective_to is null or s.effective_to > now())
  order by s.effective_from desc
  limit 1
) sc on true;

revoke all on table private.canonical_item_costs from public, anon, authenticated;
grant select on table private.canonical_item_costs to postgres, service_role;
