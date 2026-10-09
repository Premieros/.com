create or replace view private.canonical_raw_batch_diagnostics
as
select
  cib.item_id,
  i.name as item_name,
  i.code as item_code,
  cib.branch_id,
  cib.warehouse_id,
  cib.quantity as operational_quantity,
  cib.batch_quantity,
  cib.open_debt_quantity,
  cib.movement_quantity,
  cib.movement_delta,
  cib.batch_delta,
  case
    when abs(cib.batch_delta) <= 0.000001 then 'MATCH'
    when cib.open_debt_quantity > 0 then 'NEGATIVE_STOCK_DEBT'
    when cib.quantity < 0 then 'NEGATIVE_BALANCE_WITHOUT_DEBT'
    when cib.batch_delta > 0 then 'HISTORICAL_BATCH_EXCESS'
    when cib.batch_delta < 0 then 'HISTORICAL_BATCH_SHORTFALL'
    else 'UNKNOWN'
  end::text as classification,
  case
    when abs(cib.batch_delta) <= 0.000001 then false
    when cib.open_debt_quantity > 0 then false
    else true
  end as requires_review,
  case
    when abs(cib.batch_delta) <= 0.000001 then 'NONE'
    when cib.open_debt_quantity > 0 then 'OBSERVE_DEBT_SETTLEMENT'
    when cib.quantity < 0 then 'REVIEW_NEGATIVE_BALANCE_PATH'
    when cib.batch_delta > 0 then 'REVIEW_HISTORICAL_BATCH_BASELINE'
    when cib.batch_delta < 0 then 'REVIEW_HISTORICAL_BATCH_SHORTFALL'
    else 'REVIEW'
  end::text as recommended_action,
  cib.reconciliation_status,
  cib.updated_at
from private.canonical_inventory_balances cib
join public.items i on i.id = cib.item_id
where cib.inventory_kind = 'RAW_MATERIAL';

create or replace view private.canonical_inventory_health_summary
as
select
  branch_id,
  classification,
  requires_review,
  count(*)::bigint as row_count,
  sum(batch_delta)::numeric as total_batch_delta,
  max(abs(batch_delta))::numeric as max_abs_batch_delta
from private.canonical_raw_batch_diagnostics
group by branch_id, classification, requires_review;

revoke all on table private.canonical_raw_batch_diagnostics from public, anon, authenticated;
revoke all on table private.canonical_inventory_health_summary from public, anon, authenticated;

grant select on table private.canonical_raw_batch_diagnostics to postgres, service_role;
grant select on table private.canonical_inventory_health_summary to postgres, service_role;
