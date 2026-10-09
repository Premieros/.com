create or replace view private.canonical_inventory_movements
as
select
  'inventory_ledger'::text as source_stream,
  il.id::text as source_entry_id,
  l.item_id,
  case
    when il.raw_material_id is not null then 'RAW_MATERIAL'
    when il.product_id is not null then 'PRODUCT'
    else 'UNKNOWN'
  end::text as source_entity_type,
  il.branch_id,
  il.warehouse_id,
  il.batch_number,
  il.quantity as base_quantity,
  il.unit_cost,
  il.total_cost as movement_value,
  il.before_qty,
  il.after_qty,
  case il.entry_type
    when 'opening' then 'OPENING'
    when 'purchase' then 'PURCHASE_RECEIPT'
    when 'purchase_return' then 'SUPPLIER_RETURN'
    when 'sale' then 'SALE_CONSUMPTION'
    when 'refund' then 'SALE_REVERSAL'
    when 'kitchen_send' then 'KITCHEN_CONSUMPTION'
    when 'kitchen_void' then 'KITCHEN_REVERSAL'
    when 'production' then 'PRODUCTION_ISSUE'
    when 'transfer' then 'TRANSFER'
    when 'adjustment' then 'ADJUSTMENT'
    else upper(il.entry_type)
  end::text as movement_type,
  il.entry_type as legacy_entry_type,
  il.reference_type,
  il.reference_id,
  il.reference_number,
  il.created_by,
  il.created_at
from public.inventory_ledger il
join private.item_legacy_links l
  on l.source_table = case
       when il.raw_material_id is not null then 'raw_materials'
       else 'products'
     end
 and l.source_id = coalesce(il.raw_material_id, il.product_id)

union all

select
  'inventory_unit_entries'::text as source_stream,
  iue.id::text as source_entry_id,
  l.item_id,
  'INVENTORY_UNIT'::text as source_entity_type,
  iue.branch_id,
  iue.warehouse_id,
  iue.batch_number,
  iue.quantity as base_quantity,
  iue.unit_cost,
  (iue.quantity * iue.unit_cost) as movement_value,
  null::numeric as before_qty,
  null::numeric as after_qty,
  case iue.entry_type
    when 'opening' then 'OPENING'
    when 'sale' then 'SALE_CONSUMPTION'
    when 'refund' then 'SALE_REVERSAL'
    when 'kitchen_send' then 'KITCHEN_CONSUMPTION'
    when 'kitchen_void' then 'KITCHEN_REVERSAL'
    when 'production' then 'PRODUCTION_RECEIPT'
    else upper(iue.entry_type)
  end::text as movement_type,
  iue.entry_type as legacy_entry_type,
  iue.reference_type,
  iue.reference_id,
  iue.reference_number,
  iue.created_by,
  iue.created_at
from public.inventory_unit_entries iue
join private.item_legacy_links l
  on l.source_table = 'inventory_units'
 and l.source_id = iue.unit_id;

revoke all on table private.canonical_inventory_movements from public, anon, authenticated;
grant select on table private.canonical_inventory_movements to postgres, service_role;
