create or replace view private.canonical_inventory_balances
as
with warehouse_shape as (
  select
    branch_id,
    count(*)::int as warehouse_count,
    (array_agg(id order by id))[1] as single_warehouse_id
  from public.warehouses
  group by branch_id
),
raw_latest as (
  select distinct on (raw_material_id, branch_id)
    raw_material_id,
    branch_id,
    warehouse_id,
    after_qty,
    created_at,
    id
  from public.inventory_ledger
  where raw_material_id is not null
  order by raw_material_id, branch_id, created_at desc, id desc
),
raw_batches as (
  select
    raw_material_id,
    branch_id,
    sum(quantity)::numeric as batch_quantity
  from public.raw_material_batches
  group by raw_material_id, branch_id
),
raw_debts as (
  select
    raw_material_id,
    branch_id,
    sum(greatest(debt_quantity - settled_quantity, 0))::numeric as open_debt_quantity
  from public.raw_fifo_debts
  group by raw_material_id, branch_id
),
unit_entries as (
  select
    unit_id,
    branch_id,
    warehouse_id,
    sum(quantity)::numeric as movement_quantity
  from public.inventory_unit_entries
  group by unit_id, branch_id, warehouse_id
),
unit_batches as (
  select
    unit_id,
    branch_id,
    warehouse_id,
    sum(quantity)::numeric as batch_quantity
  from public.inventory_unit_batches
  group by unit_id, branch_id, warehouse_id
),
unit_debts as (
  select
    unit_id,
    branch_id,
    warehouse_id,
    sum(greatest(debt_quantity - settled_quantity, 0))::numeric as open_debt_quantity
  from public.inventory_unit_stock_debts
  group by unit_id, branch_id, warehouse_id
),
unit_keys as (
  select unit_id, branch_id, warehouse_id from unit_entries
  union
  select unit_id, branch_id, warehouse_id from unit_batches
  union
  select unit_id, branch_id, warehouse_id from unit_debts
)
select
  l.item_id,
  'RAW_MATERIAL'::text as inventory_kind,
  rmi.branch_id,
  case when ws.warehouse_count = 1 then ws.single_warehouse_id else null end as warehouse_id,
  rmi.quantity::numeric as quantity,
  coalesce(rb.batch_quantity, 0)::numeric as batch_quantity,
  coalesce(rd.open_debt_quantity, 0)::numeric as open_debt_quantity,
  rl.after_qty::numeric as movement_quantity,
  case
    when rl.after_qty is null then null
    else (rmi.quantity - rl.after_qty)::numeric
  end as movement_delta,
  (coalesce(rb.batch_quantity, 0) - coalesce(rd.open_debt_quantity, 0) - rmi.quantity)::numeric as batch_delta,
  'RAW_MATERIAL_INVENTORY'::text as balance_source,
  case
    when ws.warehouse_count = 1 then 'EXACT_SINGLE_WAREHOUSE'
    else 'LEGACY_BRANCH_ONLY'
  end::text as warehouse_scope,
  case
    when rl.after_qty is null then 'NO_LEDGER_SNAPSHOT'
    when abs(rmi.quantity - rl.after_qty) <= 0.000001 then 'MATCH'
    else 'MISMATCH'
  end::text as reconciliation_status,
  rmi.updated_at as updated_at
from public.raw_material_inventory rmi
join private.item_legacy_links l
  on l.source_table = 'raw_materials'
 and l.source_id = rmi.raw_material_id
left join warehouse_shape ws
  on ws.branch_id = rmi.branch_id
left join raw_latest rl
  on rl.raw_material_id = rmi.raw_material_id
 and rl.branch_id = rmi.branch_id
left join raw_batches rb
  on rb.raw_material_id = rmi.raw_material_id
 and rb.branch_id = rmi.branch_id
left join raw_debts rd
  on rd.raw_material_id = rmi.raw_material_id
 and rd.branch_id = rmi.branch_id

union all

select
  l.item_id,
  'SEMI_FINISHED'::text as inventory_kind,
  k.branch_id,
  k.warehouse_id,
  (coalesce(ub.batch_quantity, 0) - coalesce(ud.open_debt_quantity, 0))::numeric as quantity,
  coalesce(ub.batch_quantity, 0)::numeric as batch_quantity,
  coalesce(ud.open_debt_quantity, 0)::numeric as open_debt_quantity,
  coalesce(ue.movement_quantity, 0)::numeric as movement_quantity,
  (
    coalesce(ub.batch_quantity, 0)
    - coalesce(ud.open_debt_quantity, 0)
    - coalesce(ue.movement_quantity, 0)
  )::numeric as movement_delta,
  0::numeric as batch_delta,
  'INVENTORY_UNIT_BATCHES'::text as balance_source,
  'EXACT_WAREHOUSE'::text as warehouse_scope,
  case
    when abs(
      coalesce(ub.batch_quantity, 0)
      - coalesce(ud.open_debt_quantity, 0)
      - coalesce(ue.movement_quantity, 0)
    ) <= 0.000001 then 'MATCH'
    else 'MISMATCH'
  end::text as reconciliation_status,
  now() as updated_at
from unit_keys k
join private.item_legacy_links l
  on l.source_table = 'inventory_units'
 and l.source_id = k.unit_id
left join unit_entries ue
  on ue.unit_id = k.unit_id
 and ue.branch_id = k.branch_id
 and ue.warehouse_id = k.warehouse_id
left join unit_batches ub
  on ub.unit_id = k.unit_id
 and ub.branch_id = k.branch_id
 and ub.warehouse_id = k.warehouse_id
left join unit_debts ud
  on ud.unit_id = k.unit_id
 and ud.branch_id = k.branch_id
 and ud.warehouse_id = k.warehouse_id;

revoke all on table private.canonical_inventory_balances from public, anon, authenticated;
grant select on table private.canonical_inventory_balances to postgres, service_role;
