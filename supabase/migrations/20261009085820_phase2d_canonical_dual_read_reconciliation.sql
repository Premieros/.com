create or replace view public.canonical_item_reconciliation
with (security_invoker = true)
as
with legacy as (
  select
    b.organization_id,
    p.branch_id,
    'PRODUCTS'::text as source_type,
    count(*)::bigint as legacy_count
  from public.products p
  join public.branches b on b.id = p.branch_id
  group by b.organization_id, p.branch_id

  union all

  select
    b.organization_id,
    r.branch_id,
    'RAW_MATERIALS'::text as source_type,
    count(*)::bigint as legacy_count
  from public.raw_materials r
  join public.branches b on b.id = r.branch_id
  group by b.organization_id, r.branch_id

  union all

  select
    b.organization_id,
    u.branch_id,
    'INVENTORY_UNITS'::text as source_type,
    count(*)::bigint as legacy_count
  from public.inventory_units u
  join public.branches b on b.id = u.branch_id
  group by b.organization_id, u.branch_id
),
canonical as (
  select
    c.organization_id,
    c.branch_id,
    case
      when c.item_type in ('FINISHED_GOOD','RETAIL_ITEM') then 'PRODUCTS'
      when c.item_type = 'RAW_MATERIAL' then 'RAW_MATERIALS'
      when c.item_type = 'SEMI_FINISHED' then 'INVENTORY_UNITS'
      else null
    end::text as source_type,
    count(*)::bigint as canonical_count
  from public.canonical_item_catalog c
  where c.item_type in ('FINISHED_GOOD','RETAIL_ITEM','RAW_MATERIAL','SEMI_FINISHED')
  group by
    c.organization_id,
    c.branch_id,
    case
      when c.item_type in ('FINISHED_GOOD','RETAIL_ITEM') then 'PRODUCTS'
      when c.item_type = 'RAW_MATERIAL' then 'RAW_MATERIALS'
      when c.item_type = 'SEMI_FINISHED' then 'INVENTORY_UNITS'
      else null
    end
)
select
  coalesce(l.organization_id, c.organization_id) as organization_id,
  coalesce(l.branch_id, c.branch_id) as branch_id,
  coalesce(l.source_type, c.source_type) as source_type,
  coalesce(l.legacy_count, 0)::bigint as legacy_count,
  coalesce(c.canonical_count, 0)::bigint as canonical_count,
  (coalesce(c.canonical_count, 0) - coalesce(l.legacy_count, 0))::bigint as delta,
  (coalesce(l.legacy_count, 0) = coalesce(c.canonical_count, 0)) as is_match
from legacy l
full outer join canonical c
  on c.organization_id = l.organization_id
 and c.branch_id = l.branch_id
 and c.source_type = l.source_type;

revoke all on table public.canonical_item_reconciliation from anon, authenticated;
grant select on table public.canonical_item_reconciliation to authenticated, service_role;
