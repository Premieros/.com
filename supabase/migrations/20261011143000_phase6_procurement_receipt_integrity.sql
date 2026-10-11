-- Architecture V2 Phase 6 — procurement receipt integrity and traceability.
-- Prevent cross-branch receipts / cross-purchase item receipts, including direct writes.
create function private.validate_purchase_receipt_scope_v2()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_purchase_branch uuid;
  v_warehouse_branch uuid;
begin
  select p.branch_id into v_purchase_branch from public.purchases p where p.id=new.purchase_id;
  if v_purchase_branch is null or new.branch_id is distinct from v_purchase_branch then
    raise exception 'PHASE6_RECEIPT_PURCHASE_BRANCH_MISMATCH';
  end if;
  if new.warehouse_id is not null then
    select w.branch_id into v_warehouse_branch from public.warehouses w where w.id=new.warehouse_id;
    if v_warehouse_branch is null or v_warehouse_branch is distinct from new.branch_id then
      raise exception 'PHASE6_RECEIPT_WAREHOUSE_BRANCH_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_validate_purchase_receipt_scope_v2
before insert or update of purchase_id,branch_id,warehouse_id
on public.purchase_receipts
for each row execute function private.validate_purchase_receipt_scope_v2();

create function private.validate_purchase_receipt_line_v2()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_purchase_id uuid;
  v_item_purchase uuid;
  v_qty numeric;
  v_already_received numeric;
begin
  select r.purchase_id into v_purchase_id
  from public.purchase_receipts r where r.id=new.receipt_id;
  if v_purchase_id is null then raise exception 'PHASE6_RECEIPT_NOT_FOUND'; end if;

  -- Lock the specific purchase item to serialize concurrent incremental receipts.
  select i.purchase_id,i.quantity
    into v_item_purchase,v_qty
  from public.purchase_items i where i.id=new.purchase_item_id for update;
  if v_item_purchase is null or v_item_purchase is distinct from v_purchase_id then
    raise exception 'PHASE6_RECEIPT_WRONG_PURCHASE_ITEM';
  end if;
  if new.quantity_received<=0 then
    raise exception 'PHASE6_RECEIPT_NONPOSITIVE_QUANTITY';
  end if;
  select coalesce(sum(li.quantity_received),0)::numeric
  into v_already_received
  from public.purchase_receipt_items li
  where li.purchase_item_id=new.purchase_item_id
    and (tg_op='INSERT' or li.id<>new.id);
  if v_already_received+new.quantity_received>v_qty then
    raise exception 'PHASE6_RECEIPT_QUANTITY_EXCEEDS_ORDER';
  end if;
  return new;
end;
$$;
create trigger trg_validate_purchase_receipt_line_v2
before insert or update of receipt_id,purchase_item_id,quantity_received
on public.purchase_receipt_items
for each row execute function private.validate_purchase_receipt_line_v2();

create view private.procurement_receipt_progress_v2 as
select p.branch_id,p.id purchase_id,i.id purchase_item_id,
 i.quantity ordered_quantity,
 coalesce(sum(ri.quantity_received),0)::numeric documented_received_quantity,
 i.received_quantity::numeric operational_received_quantity,
 (i.quantity-coalesce(sum(ri.quantity_received),0))::numeric outstanding_documented_quantity,
 case when coalesce(sum(ri.quantity_received),0)>i.quantity
    then 'OVER_RECEIVED'
   when i.received_quantity<0 or i.received_quantity>i.quantity
    then 'OPERATIONAL_RECEIPT_OUT_OF_RANGE'
   when coalesce(sum(ri.quantity_received),0) is distinct from i.received_quantity
    then 'LEDGER_RECEIPT_DIFFERENCE'
   else 'CONSISTENT' end integrity_status
from public.purchases p
join public.purchase_items i on i.purchase_id=p.id
left join public.purchase_receipt_items ri on ri.purchase_item_id=i.id
group by p.branch_id,p.id,i.id,i.quantity,i.received_quantity;

revoke all on function private.validate_purchase_receipt_scope_v2(),
 function private.validate_purchase_receipt_line_v2()
 from public,anon,authenticated,service_role;
revoke all on private.procurement_receipt_progress_v2
 from public,anon,authenticated,service_role;
