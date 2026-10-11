-- Architecture V2 Phase 8B — verified, idempotent DB-side outbox consumer.
-- Manually invoked by a trusted DB owner. No public worker grants,
-- cron extension assumptions, external calls, or business writes.
create table private.erp_domain_event_receipts_v2 (
  event_id uuid primary key references private.erp_domain_outbox_v2(id) on delete restrict,
  event_key text not null unique,
  event_type text not null check(event_type in ('JOURNAL_POSTED','PURCHASE_RECEIPT_CREATED')),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  aggregate_id uuid not null,
  payload_hash text not null,
  projection jsonb not null,
  worker_id text not null,
  processed_at timestamptz not null default clock_timestamp()
);

alter table private.erp_domain_event_receipts_v2 enable row level security;
revoke all on private.erp_domain_event_receipts_v2 from public,anon,authenticated,service_role;

create function private.block_erp_domain_receipt_changes_v2()
returns trigger language plpgsql
set search_path=pg_catalog as $$
begin
  raise exception 'PHASE8B_IMMUTABLE_DELIVERY_RECEIPT';
end $$;

create trigger trg_erp_domain_event_receipt_immutable_v2
before update or delete on private.erp_domain_event_receipts_v2
for each row execute function private.block_erp_domain_receipt_changes_v2();

-- The work result contains only immutable identifiers and aggregate facts;
-- no customer/personally identifying data or mutable accounting references.
create function private.erp_verified_event_projection_v2(p_event_id uuid)
returns jsonb language plpgsql stable security invoker
set search_path=public,private,pg_temp
as $$
declare
  e private.erp_domain_outbox_v2%rowtype;
  v_org uuid;
  v_branch uuid;
  v_source uuid;
  v_status text;
  v_lines bigint;
  v_evidence bigint;
  v_bad bigint;
  v_debit numeric;
  v_credit numeric;
  v_purchase uuid;
  v_warehouse uuid;
  v_quantity numeric;
begin
  select * into e from private.erp_domain_outbox_v2 where id=p_event_id;
  if not found then raise exception 'PHASE8B_EVENT_NOT_FOUND'; end if;
  select b.organization_id into v_org from public.branches b where b.id=e.branch_id;
  if v_org is distinct from e.organization_id then
    raise exception 'PHASE8B_EVENT_TENANT_MISMATCH';
  end if;
  if e.event_type='JOURNAL_POSTED' then
    select j.id,j.branch_id,j.posting_status into v_source,v_branch,v_status
    from public.journal_entries j where j.id=e.aggregate_id;
    if v_source is null or v_branch is distinct from e.branch_id
      or v_status not in ('POSTED','REVERSED')
      or e.payload->>'journal_entry_id' is distinct from e.aggregate_id::text then
      raise exception 'PHASE8B_JOURNAL_SOURCE_INVALID';
    end if;
    select count(*),coalesce(sum(l.debit),0),coalesce(sum(l.credit),0),
      count(*) filter(where x.journal_line_id is not null),
      count(*) filter(where x.journal_line_id is null
        or x.branch_id is distinct from e.branch_id
        or x.organization_id is distinct from e.organization_id
        or x.branch_account_id is distinct from l.account_id
        or x.debit is distinct from l.debit or x.credit is distinct from l.credit)
    into v_lines,v_debit,v_credit,v_evidence,v_bad
    from public.journal_entry_lines l
    left join private.organization_journal_line_evidence_v2 x on x.journal_line_id=l.id
    where l.journal_entry_id=e.aggregate_id;
    if v_lines<2 or v_bad<>0 or v_evidence<>v_lines
      or v_debit is distinct from v_credit or v_debit<=0 then
      raise exception 'PHASE8B_JOURNAL_EVIDENCE_INVALID';
    end if;
    return jsonb_build_object('kind','POSTED_JOURNAL_VERIFIED',
      'journal_id',e.aggregate_id,'lines',v_lines,
      'debits',v_debit,'credits',v_credit,
      'posting_status_at_processing',v_status);
  elsif e.event_type='PURCHASE_RECEIPT_CREATED' then
    select r.id,r.branch_id,r.purchase_id,r.warehouse_id
      into v_source,v_branch,v_purchase,v_warehouse
    from public.purchase_receipts r where r.id=e.aggregate_id;
    if v_source is null or v_branch is distinct from e.branch_id
      or e.payload->>'receipt_id' is distinct from e.aggregate_id::text
      or e.payload->>'purchase_id' is distinct from v_purchase::text
      or not exists(select 1 from public.purchases p
        where p.id=v_purchase and p.branch_id=e.branch_id)
      or (v_warehouse is not null and not exists (
        select 1 from public.warehouses w
        where w.id=v_warehouse and w.branch_id=e.branch_id)) then
      raise exception 'PHASE8B_RECEIPT_SOURCE_INVALID';
    end if;
    select count(*),coalesce(sum(li.quantity_received),0),
      count(*) filter(where i.id is null or i.purchase_id is distinct from v_purchase)
    into v_lines,v_quantity,v_bad
    from public.purchase_receipt_items li
    left join public.purchase_items i on i.id=li.purchase_item_id
    where li.receipt_id=e.aggregate_id;
    if v_bad>0 then raise exception 'PHASE8B_RECEIPT_LINES_INVALID'; end if;
    return jsonb_build_object('kind','PURCHASE_RECEIPT_VERIFIED',
      'receipt_id',e.aggregate_id,'purchase_id',v_purchase,
      'receipt_item_count',v_lines,'quantity_received',v_quantity);
  else
    raise exception 'PHASE8B_UNKNOWN_EVENT_TYPE';
  end if;
end $$;

-- Every event is processed with an isolated exception subtransaction,
-- so a poison event cannot stop the next good event in the batch.
-- The outbox delivery status + immutable receipt commit together.
create function private.process_erp_domain_outbox_batch_v2(
  p_worker text,p_limit integer default 20
)
returns jsonb language plpgsql security invoker
set search_path=public,private,pg_temp
as $$
declare
  e private.erp_domain_outbox_v2%rowtype;
  v_projection jsonb;
  v_claimed integer:=0;
  v_delivered integer:=0;
  v_failed integer:=0;
  v_error text;
  v_max integer:=least(greatest(coalesce(p_limit,20),1),100);
begin
  if length(btrim(coalesce(p_worker,'')))<3 or length(p_worker)>128 then
    raise exception 'PHASE8B_WORKER_NAME_INVALID';
  end if;

  for e in
    select * from private.claim_erp_domain_outbox_v2(p_worker,v_max)
  loop
    v_claimed:=v_claimed+1;
    begin
      v_projection:=private.erp_verified_event_projection_v2(e.id);
      insert into private.erp_domain_event_receipts_v2(
        event_id,event_key,event_type,organization_id,branch_id,
        aggregate_id,payload_hash,projection,worker_id
      ) values(
        e.id,e.event_key,e.event_type,e.organization_id,e.branch_id,
        e.aggregate_id,md5(e.payload::text),v_projection,p_worker
      )
      on conflict(event_id) do nothing;

      -- If a stale claim was reprocessed, enforce exact same event facts.
      if not exists(
        select 1 from private.erp_domain_event_receipts_v2 r
        where r.event_id=e.id and r.event_key=e.event_key
          and r.payload_hash=md5(e.payload::text)
          and r.organization_id=e.organization_id and r.branch_id=e.branch_id
          and r.aggregate_id=e.aggregate_id
      ) then raise exception 'PHASE8B_DELIVERY_RECEIPT_CONFLICT'; end if;

      if not private.complete_erp_domain_outbox_v2(e.id,p_worker,true,null) then
        raise exception 'PHASE8B_EVENT_ACK_FAILED';
      end if;
      v_delivered:=v_delivered+1;
    exception when others then
      v_error:=left(SQLSTATE||': '||SQLERRM,2000);
      if not private.complete_erp_domain_outbox_v2(e.id,p_worker,false,v_error) then
        raise exception 'PHASE8B_EVENT_FAILURE_ACK_FAILED';
      end if;
      v_failed:=v_failed+1;
    end;
  end loop;
  return jsonb_build_object('claimed',v_claimed,'delivered',v_delivered,
    'failed',v_failed,'worker',p_worker);
end $$;

-- A reviewed, owner-only retry action for temporarily failed events.
-- No automatic infinite retry storms.
create function private.retry_failed_erp_domain_event_v2(
  p_event_id uuid,p_reason text
)
returns boolean language plpgsql security invoker
set search_path=public,private,pg_temp
as $$
declare v_rows integer;
begin
  if length(btrim(coalesce(p_reason,'')))<8 then
    raise exception 'PHASE8B_RETRY_REASON_REQUIRED';
  end if;
  update private.erp_domain_outbox_v2
  set status='PENDING',claimed_by=null,claimed_at=null,
    last_error=left('RETRY: '||btrim(p_reason),2000)
  where id=p_event_id and status='FAILED' and attempts<5;
  get diagnostics v_rows=row_count;
  return v_rows=1;
end $$;

revoke all on function private.block_erp_domain_receipt_changes_v2(),
  private.erp_verified_event_projection_v2(uuid),
  private.process_erp_domain_outbox_batch_v2(text,integer),
  private.retry_failed_erp_domain_event_v2(uuid,text)
  from public,anon,authenticated,service_role;

-- Owner-only visibility. Neither browser users nor public API can poll this.
create view private.erp_domain_delivery_health_v2 as
select o.organization_id,o.branch_id,o.event_type,o.status,
  count(*)::bigint event_count,
  max(o.created_at) latest_event_at,
  count(r.event_id)::bigint verified_receipts
from private.erp_domain_outbox_v2 o
left join private.erp_domain_event_receipts_v2 r on r.event_id=o.id
group by o.organization_id,o.branch_id,o.event_type,o.status;

revoke all on private.erp_domain_delivery_health_v2
  from public,anon,authenticated,service_role;
