create or replace view private.canonical_sale_cost_variance
as
with scoped_sales as (
  select
    s.id as sale_id,
    s.branch_id,
    s.invoice_number,
    s.created_at,
    private.report_operational_net_sale_amount(s.total,s.tax_amount,s.refunded_amount)::numeric as net_sales
  from public.sales s
  where coalesce(s.is_archived,false)=false
    and coalesce(s.status,'') not in ('returned','cancelled')
),
journal_costs as (
  select
    ss.sale_id,
    round(coalesce(sum(jl.debit-jl.credit),0),2)::numeric as actual_cogs
  from scoped_sales ss
  join public.journal_entries je
    on je.branch_id=ss.branch_id
   and je.reference_id=ss.sale_id
   and je.reference_type in ('sale','fifo_cogs_reconcile')
  join public.account_mappings am
    on am.branch_id=ss.branch_id
   and am.semantic_key='cogs'
  join public.journal_entry_lines jl
    on jl.journal_entry_id=je.id
   and jl.account_id=am.account_id
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
  select
    il.reference_id as sale_id,
    greatest(coalesce(-sum(il.total_cost),0),0)::numeric as actual_cogs
  from public.inventory_ledger il
  join scoped_sales ss on ss.sale_id=il.reference_id
  where il.entry_type='sale'
    and il.reference_type='sale'
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
    s.created_at as sale_created_at,
    greatest(si.quantity-si.refunded_quantity,0)::numeric as net_quantity,
    (jsonb_array_length(coalesce(si.modifiers_snapshot,'[]'::jsonb))>0) as has_modifiers,
    l.item_id,
    cic.theoretical_cost as current_theoretical_unit_cost,
    cic.theoretical_cost_status,
    sc.standard_cost as standard_unit_cost
  from public.sale_items si
  join public.sales s on s.id=si.sale_id
  left join private.item_legacy_links l
    on l.source_table='products'
   and l.source_id=si.product_id
  left join private.canonical_item_costs cic
    on cic.item_id=l.item_id
   and cic.branch_id=s.branch_id
  left join lateral (
    select isc.standard_cost
    from public.item_standard_costs isc
    where isc.item_id=l.item_id
      and isc.branch_id=s.branch_id
      and isc.effective_from<=s.created_at
      and (isc.effective_to is null or isc.effective_to>s.created_at)
    order by isc.effective_from desc
    limit 1
  ) sc on true
),
line_rollup as (
  select
    lb.sale_id,
    count(*) filter(where lb.net_quantity>0)::int as net_line_count,
    count(*) filter(where lb.net_quantity>0 and lb.item_id is not null)::int as mapped_line_count,
    count(*) filter(where lb.net_quantity>0 and lb.has_modifiers)::int as modifier_line_count,
    count(*) filter(
      where lb.net_quantity>0
        and not lb.has_modifiers
        and lb.current_theoretical_unit_cost is not null
        and lb.theoretical_cost_status='AVAILABLE'
    )::int as theoretical_line_count,
    count(*) filter(
      where lb.net_quantity>0
        and lb.standard_unit_cost is not null
    )::int as standard_line_count,
    sum(
      case
        when lb.net_quantity>0
         and not lb.has_modifiers
         and lb.current_theoretical_unit_cost is not null
         and lb.theoretical_cost_status='AVAILABLE'
        then lb.net_quantity*lb.current_theoretical_unit_cost
        else 0
      end
    )::numeric as theoretical_partial_cost,
    sum(
      case
        when lb.net_quantity>0 and lb.standard_unit_cost is not null
        then lb.net_quantity*lb.standard_unit_cost
        else 0
      end
    )::numeric as standard_partial_cost
  from line_basis lb
  group by lb.sale_id
)
select
  ss.sale_id,
  ss.branch_id,
  ss.invoice_number,
  ss.created_at as sale_created_at,
  ss.net_sales,
  ra.actual_cogs,
  ra.actual_cogs_basis,
  coalesce(lr.net_line_count,0) as net_line_count,
  coalesce(lr.mapped_line_count,0) as mapped_line_count,
  coalesce(lr.modifier_line_count,0) as modifier_line_count,
  coalesce(lr.theoretical_line_count,0) as theoretical_line_count,
  coalesce(lr.standard_line_count,0) as standard_line_count,
  lr.theoretical_partial_cost,
  case
    when coalesce(lr.net_line_count,0)=0 then 'NO_NET_LINES'
    when coalesce(lr.modifier_line_count,0)>0 then 'MODIFIER_UNMODELED'
    when coalesce(lr.mapped_line_count,0)<>coalesce(lr.net_line_count,0) then 'UNMAPPED_ITEM'
    when coalesce(lr.theoretical_line_count,0)<>coalesce(lr.net_line_count,0) then 'MISSING_INPUT'
    else 'COMPLETE'
  end::text as theoretical_coverage_status,
  case
    when coalesce(lr.net_line_count,0)>0
     and coalesce(lr.modifier_line_count,0)=0
     and coalesce(lr.mapped_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.theoretical_line_count,0)=coalesce(lr.net_line_count,0)
    then lr.theoretical_partial_cost
    else null
  end::numeric as current_theoretical_cost,
  'CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL'::text as theoretical_basis,
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
     and coalesce(lr.modifier_line_count,0)=0
     and coalesce(lr.mapped_line_count,0)=coalesce(lr.net_line_count,0)
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
     and coalesce(lr.modifier_line_count,0)=0
     and coalesce(lr.theoretical_line_count,0)=coalesce(lr.net_line_count,0)
     and coalesce(lr.standard_line_count,0)=coalesce(lr.net_line_count,0)
    then lr.theoretical_partial_cost-lr.standard_partial_cost
    else null
  end::numeric as theoretical_vs_standard_variance,
  case when ss.net_sales>0 and ra.actual_cogs is not null
       then round(ra.actual_cogs*100.0/ss.net_sales,2)
       else null end::numeric as actual_food_cost_pct,
  case when ss.net_sales>0
         and coalesce(lr.net_line_count,0)>0
         and coalesce(lr.modifier_line_count,0)=0
         and coalesce(lr.theoretical_line_count,0)=coalesce(lr.net_line_count,0)
       then round(lr.theoretical_partial_cost*100.0/ss.net_sales,2)
       else null end::numeric as theoretical_food_cost_pct
from scoped_sales ss
left join resolved_actual ra on ra.sale_id=ss.sale_id
left join line_rollup lr on lr.sale_id=ss.sale_id;

create or replace view private.canonical_purchase_cost_variance
as
with purchase_groups as (
  select
    p.id as purchase_id,
    p.branch_id,
    p.warehouse_id,
    p.invoice_number,
    p.created_at as purchase_created_at,
    pi.raw_material_id,
    sum(pi.quantity)::numeric as entered_quantity,
    sum(pi.total)::numeric as entered_total
  from public.purchases p
  join public.purchase_items pi on pi.purchase_id=p.id
  where pi.raw_material_id is not null
  group by p.id,p.branch_id,p.warehouse_id,p.invoice_number,p.created_at,pi.raw_material_id
),
receipt_cost as (
  select
    pg.purchase_id,
    pg.raw_material_id,
    count(il.id)::int as ledger_row_count,
    sum(il.quantity)::numeric as received_base_quantity,
    sum(il.total_cost)::numeric as received_total_cost,
    case
      when sum(il.quantity)<>0 then sum(il.total_cost)/sum(il.quantity)
      else null
    end::numeric as actual_base_unit_cost,
    min(il.created_at) as first_receipt_at,
    max(il.created_at) as last_receipt_at
  from purchase_groups pg
  left join public.inventory_ledger il
    on il.entry_type='purchase'
   and il.reference_type='purchase'
   and il.reference_id=pg.purchase_id
   and il.raw_material_id=pg.raw_material_id
  group by pg.purchase_id,pg.raw_material_id
),
resolved as (
  select
    pg.*,
    rc.ledger_row_count,
    rc.received_base_quantity,
    rc.received_total_cost,
    rc.actual_base_unit_cost,
    rc.first_receipt_at,
    rc.last_receipt_at,
    l.item_id
  from purchase_groups pg
  left join receipt_cost rc
    on rc.purchase_id=pg.purchase_id
   and rc.raw_material_id=pg.raw_material_id
  left join private.item_legacy_links l
    on l.source_table='raw_materials'
   and l.source_id=pg.raw_material_id
)
select
  r.purchase_id,
  r.branch_id,
  r.warehouse_id,
  r.invoice_number,
  r.purchase_created_at,
  r.raw_material_id,
  r.item_id,
  r.entered_quantity,
  r.entered_total,
  r.ledger_row_count,
  r.received_base_quantity,
  r.received_total_cost,
  r.actual_base_unit_cost,
  case when r.actual_base_unit_cost is not null then 'LEDGER_NORMALIZED' else 'MISSING_LEDGER' end::text as actual_cost_status,
  prior_ref.unit_cost as prior_reference_unit_cost,
  prior_ref.reference_id as prior_reference_purchase_id,
  prior_ref.created_at as prior_reference_at,
  case when prior_ref.unit_cost is not null then 'PRIOR_PURCHASE_REFERENCE' else 'NO_PRIOR_PURCHASE' end::text as reference_cost_status,
  sc.standard_cost as standard_unit_cost,
  case when sc.standard_cost is not null then 'AVAILABLE' else 'NO_STANDARD_COST' end::text as standard_cost_status,
  case
    when r.actual_base_unit_cost is not null and prior_ref.unit_cost is not null
    then r.actual_base_unit_cost-prior_ref.unit_cost
    else null
  end::numeric as actual_vs_reference_unit_variance,
  case
    when r.actual_base_unit_cost is not null
     and prior_ref.unit_cost is not null
     and r.received_base_quantity is not null
    then (r.actual_base_unit_cost-prior_ref.unit_cost)*r.received_base_quantity
    else null
  end::numeric as actual_vs_reference_total_variance,
  case
    when r.actual_base_unit_cost is not null and sc.standard_cost is not null
    then r.actual_base_unit_cost-sc.standard_cost
    else null
  end::numeric as actual_vs_standard_unit_variance,
  case
    when r.actual_base_unit_cost is not null
     and sc.standard_cost is not null
     and r.received_base_quantity is not null
    then (r.actual_base_unit_cost-sc.standard_cost)*r.received_base_quantity
    else null
  end::numeric as actual_vs_standard_total_variance
from resolved r
left join lateral (
  select
    il.unit_cost,
    il.reference_id,
    il.created_at
  from public.inventory_ledger il
  where il.raw_material_id=r.raw_material_id
    and il.branch_id=r.branch_id
    and il.entry_type='purchase'
    and il.reference_type='purchase'
    and il.quantity>0
    and il.unit_cost>=0
    and il.reference_id is distinct from r.purchase_id
    and il.created_at < coalesce(r.first_receipt_at,r.purchase_created_at)
  order by il.created_at desc, il.id desc
  limit 1
) prior_ref on true
left join lateral (
  select isc.standard_cost
  from public.item_standard_costs isc
  where isc.item_id=r.item_id
    and isc.branch_id=r.branch_id
    and isc.effective_from<=r.purchase_created_at
    and (isc.effective_to is null or isc.effective_to>r.purchase_created_at)
  order by isc.effective_from desc
  limit 1
) sc on true;

revoke all on table private.canonical_sale_cost_variance from public, anon, authenticated;
revoke all on table private.canonical_purchase_cost_variance from public, anon, authenticated;
grant select on table private.canonical_sale_cost_variance to postgres, service_role;
grant select on table private.canonical_purchase_cost_variance to postgres, service_role;
