create or replace view public.canonical_item_catalog
with (security_invoker = true)
as
select
  i.id as item_id,
  i.organization_id,
  s.branch_id,
  i.item_type,
  i.code,
  i.sku,
  i.barcode,
  i.name,
  i.name_en,
  i.base_uom_id,
  mu.code as base_uom_code,
  mu.name as base_uom_name,
  mu.symbol as base_uom_symbol,
  (i.is_active and s.is_active) as is_active,
  s.preferred_warehouse_id,
  s.min_stock,
  s.max_stock,
  s.reorder_point,
  s.lead_time_days,
  i.created_at,
  greatest(i.updated_at, s.updated_at) as updated_at
from public.items i
join public.item_sites s on s.item_id = i.id
join public.branches b
  on b.id = s.branch_id
 and b.organization_id = i.organization_id
left join public.measurement_units mu on mu.id = i.base_uom_id;

revoke all on table public.canonical_item_catalog from anon, authenticated;
grant select on table public.canonical_item_catalog to authenticated, service_role;
