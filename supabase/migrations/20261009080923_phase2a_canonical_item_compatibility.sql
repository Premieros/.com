create schema if not exists private;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_type text not null check (item_type in (
    'RAW_MATERIAL','SEMI_FINISHED','FINISHED_GOOD','RETAIL_ITEM','PACKAGING','SERVICE','NON_STOCK'
  )),
  code text,
  sku text,
  barcode text,
  name text not null,
  name_en text,
  base_uom_id uuid references public.measurement_units(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_organization_type_idx
  on public.items(organization_id, item_type, is_active);

create index if not exists items_organization_code_idx
  on public.items(organization_id, code)
  where code is not null;

create index if not exists items_organization_sku_idx
  on public.items(organization_id, sku)
  where sku is not null;

create table if not exists public.item_sites (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  preferred_warehouse_id uuid references public.warehouses(id) on delete set null,
  is_active boolean not null default true,
  min_stock numeric(18,6) not null default 0,
  max_stock numeric(18,6) not null default 0,
  reorder_point numeric(18,6) not null default 0,
  lead_time_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_id, branch_id),
  check (min_stock >= 0),
  check (max_stock >= 0),
  check (reorder_point >= 0),
  check (lead_time_days is null or lead_time_days >= 0)
);

create index if not exists item_sites_branch_item_idx
  on public.item_sites(branch_id, item_id);

create table if not exists private.item_legacy_links (
  item_id uuid not null references public.items(id) on delete cascade,
  source_table text not null check (source_table in ('products','raw_materials','inventory_units')),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(source_table, source_id),
  unique(item_id, source_table, source_id)
);

alter table public.items enable row level security;
alter table public.item_sites enable row level security;
alter table private.item_legacy_links enable row level security;

drop policy if exists items_select_accessible_organization on public.items;
create policy items_select_accessible_organization
on public.items
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists item_sites_select_accessible_branch on public.item_sites;
create policy item_sites_select_accessible_branch
on public.item_sites
for select
to authenticated
using (public.user_may_access_branch(branch_id));

revoke all on table public.items from anon, authenticated;
revoke all on table public.item_sites from anon, authenticated;
grant select on table public.items to authenticated;
grant select on table public.item_sites to authenticated;

revoke all on table private.item_legacy_links from public, anon, authenticated;

grant all on table public.items to service_role;
grant all on table public.item_sites to service_role;
grant all on table private.item_legacy_links to service_role;

create temporary table pg_temp.canonical_item_stage (
  item_id uuid not null,
  source_table text not null,
  source_id uuid not null,
  organization_id uuid not null,
  branch_id uuid not null,
  item_type text not null,
  code text,
  sku text,
  barcode text,
  name text not null,
  name_en text,
  base_uom_id uuid,
  is_active boolean not null,
  min_stock numeric(18,6) not null,
  max_stock numeric(18,6) not null,
  reorder_point numeric(18,6) not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
) on commit drop;

insert into pg_temp.canonical_item_stage
select
  gen_random_uuid(),
  'products',
  p.id,
  b.organization_id,
  p.branch_id,
  case when p.product_type='manufactured' then 'FINISHED_GOOD' else 'RETAIL_ITEM' end,
  nullif(p.sku,''),
  nullif(p.sku,''),
  nullif(p.barcode,''),
  p.name,
  p.name_en,
  null::uuid,
  p.is_active,
  p.min_stock,
  p.max_stock,
  p.reorder_point,
  coalesce(p.created_at,now()),
  coalesce(p.updated_at,p.created_at,now())
from public.products p
join public.branches b on b.id=p.branch_id
where not exists (
  select 1 from private.item_legacy_links l
  where l.source_table='products' and l.source_id=p.id
);

insert into pg_temp.canonical_item_stage
select
  gen_random_uuid(),
  'raw_materials',
  r.id,
  b.organization_id,
  r.branch_id,
  'RAW_MATERIAL',
  nullif(r.code,''),
  null,
  null,
  r.name,
  null,
  r.unit_id,
  r.is_active,
  r.min_stock,
  0,
  0,
  r.created_at,
  r.updated_at
from public.raw_materials r
join public.branches b on b.id=r.branch_id
where not exists (
  select 1 from private.item_legacy_links l
  where l.source_table='raw_materials' and l.source_id=r.id
);

insert into pg_temp.canonical_item_stage
select
  gen_random_uuid(),
  'inventory_units',
  u.id,
  b.organization_id,
  u.branch_id,
  'SEMI_FINISHED',
  nullif(u.code,''),
  nullif(u.sku,''),
  nullif(u.barcode,''),
  u.name,
  u.name_en,
  null::uuid,
  u.is_active,
  u.min_stock,
  u.max_stock,
  u.reorder_point,
  u.created_at,
  u.updated_at
from public.inventory_units u
join public.branches b on b.id=u.branch_id
where not exists (
  select 1 from private.item_legacy_links l
  where l.source_table='inventory_units' and l.source_id=u.id
);

insert into public.items(
  id,organization_id,item_type,code,sku,barcode,name,name_en,base_uom_id,is_active,created_at,updated_at
)
select
  item_id,organization_id,item_type,code,sku,barcode,name,name_en,base_uom_id,is_active,created_at,updated_at
from pg_temp.canonical_item_stage
on conflict(id) do nothing;

insert into private.item_legacy_links(item_id,source_table,source_id)
select item_id,source_table,source_id
from pg_temp.canonical_item_stage
on conflict(source_table,source_id) do nothing;

insert into public.item_sites(
  item_id,branch_id,is_active,min_stock,max_stock,reorder_point
)
select
  item_id,branch_id,is_active,min_stock,max_stock,reorder_point
from pg_temp.canonical_item_stage
on conflict(item_id,branch_id) do nothing;
