create or replace view private.canonical_inventory_review_cases
as
with batch_evidence as (
  select
    raw_material_id,
    branch_id,
    count(*) filter (where source_type='historical_opening')::int as historical_opening_batches,
    coalesce(sum(quantity) filter (where source_type='historical_opening'),0)::numeric as historical_opening_quantity,
    count(*) filter (where source_type='sale_oversold')::int as oversold_batches,
    count(*) filter (where source_type='purchase')::int as purchase_batches,
    count(*)::int as total_batches
  from public.raw_material_batches
  group by raw_material_id,branch_id
),
ledger_evidence as (
  select
    raw_material_id,
    branch_id,
    count(*) filter (where entry_type='purchase' and before_qty=0)::int as zero_before_purchase_rows,
    count(*) filter (where entry_type='opening')::int as opening_rows,
    count(*) filter (where entry_type='kitchen_send' and before_qty<=0)::int as nonpositive_before_kitchen_rows
  from public.inventory_ledger
  where raw_material_id is not null
  group by raw_material_id,branch_id
)
select
  d.item_id,
  l.source_id as raw_material_id,
  d.item_name,
  d.item_code,
  d.branch_id,
  d.warehouse_id,
  d.classification,
  d.operational_quantity,
  d.batch_quantity,
  d.open_debt_quantity,
  d.batch_delta,
  coalesce(be.historical_opening_batches,0) as historical_opening_batches,
  coalesce(be.historical_opening_quantity,0) as historical_opening_quantity,
  coalesce(be.oversold_batches,0) as oversold_batches,
  coalesce(be.purchase_batches,0) as purchase_batches,
  coalesce(be.total_batches,0) as total_batches,
  coalesce(le.zero_before_purchase_rows,0) as zero_before_purchase_rows,
  coalesce(le.opening_rows,0) as opening_rows,
  coalesce(le.nonpositive_before_kitchen_rows,0) as nonpositive_before_kitchen_rows,
  case
    when d.classification='HISTORICAL_BATCH_EXCESS'
      and coalesce(be.historical_opening_batches,0)>0
      then 'HISTORICAL_OPENING_REBASE'
    when d.classification='HISTORICAL_BATCH_EXCESS'
      then 'TRANSACTION_BASELINE_DRIFT'
    when d.classification='NEGATIVE_BALANCE_WITHOUT_DEBT'
      and coalesce(be.oversold_batches,0)>0
      then 'UNTRACKED_NEGATIVE_STOCK_PATH'
    else 'UNCLASSIFIED_REVIEW'
  end::text as evidence_reason,
  true as requires_human_review,
  'NO_AUTOMATIC_REPAIR'::text as repair_policy,
  d.recommended_action,
  d.updated_at
from private.canonical_raw_batch_diagnostics d
join private.item_legacy_links l
  on l.item_id=d.item_id
 and l.source_table='raw_materials'
left join batch_evidence be
  on be.raw_material_id=l.source_id
 and be.branch_id=d.branch_id
left join ledger_evidence le
  on le.raw_material_id=l.source_id
 and le.branch_id=d.branch_id
where d.requires_review;

create or replace view private.canonical_inventory_review_summary
as
select
  evidence_reason,
  count(*)::bigint as row_count,
  sum(batch_delta)::numeric as total_batch_delta,
  max(abs(batch_delta))::numeric as max_abs_batch_delta
from private.canonical_inventory_review_cases
group by evidence_reason;

revoke all on table private.canonical_inventory_review_cases from public,anon,authenticated;
revoke all on table private.canonical_inventory_review_summary from public,anon,authenticated;
grant select on table private.canonical_inventory_review_cases to postgres,service_role;
grant select on table private.canonical_inventory_review_summary to postgres,service_role;
