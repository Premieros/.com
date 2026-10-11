-- Architecture V2 Phase 8/9: transactional domain outbox and safe agent context.
-- Events are created inside the posting transaction; consumers cannot claim
-- delivery until explicit privileged worker implementation is deployed.
create table private.erp_domain_outbox_v2 (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check(event_type in ('JOURNAL_POSTED','PURCHASE_RECEIPT_CREATED')),
  aggregate_id uuid not null,
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  payload jsonb not null,
  status text not null default 'PENDING'
    check(status in ('PENDING','CLAIMED','DELIVERED','FAILED')),
  attempts integer not null default 0 check(attempts>=0),
  claimed_by text,
  claimed_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp()
);
create index erp_domain_outbox_pending_v2
  on private.erp_domain_outbox_v2(status,created_at,id);
create index erp_domain_outbox_org_time_v2
  on private.erp_domain_outbox_v2(organization_id,created_at desc);

alter table private.erp_domain_outbox_v2 enable row level security;
revoke all on private.erp_domain_outbox_v2 from public,anon,authenticated,service_role;

create function private.publish_erp_domain_event_v2()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_org uuid;
  v_type text;
  v_key text;
  v_payload jsonb;
begin
  if tg_table_name='journal_entries' then
    if new.posting_status<>'POSTED' then return new; end if;
    v_type:='JOURNAL_POSTED';
    v_key:='journal.posted:'||new.id::text;
    v_payload:=jsonb_build_object('journal_entry_id',new.id,
      'reference_type',new.reference_type,'entry_date',new.entry_date,
      'posting_status',new.posting_status);
  elsif tg_table_name='purchase_receipts' then
    v_type:='PURCHASE_RECEIPT_CREATED';
    v_key:='purchase.receipt:'||new.id::text;
    v_payload:=jsonb_build_object('receipt_id',new.id,
      'purchase_id',new.purchase_id,'received_at',new.received_at);
  else
    raise exception 'PHASE8_UNSUPPORTED_DOMAIN_EVENT';
  end if;
  select b.organization_id into v_org
  from public.branches b where b.id=new.branch_id;
  if v_org is null then
    raise exception 'PHASE8_EVENT_MISSING_ORGANIZATION';
  end if;
  insert into private.erp_domain_outbox_v2(
    event_key,event_type,aggregate_id,organization_id,branch_id,payload
  ) values(v_key,v_type,new.id,v_org,new.branch_id,v_payload)
  on conflict(event_key) do nothing;
  return new;
end;
$$;
create trigger trg_journal_domain_outbox_v2
after insert on public.journal_entries
for each row execute function private.publish_erp_domain_event_v2();
create trigger trg_receipt_domain_outbox_v2
after insert on public.purchase_receipts
for each row execute function private.publish_erp_domain_event_v2();

-- Only the DB owner / privileged backend worker can claim or acknowledge.
-- No public, anon, authenticated or service_role direct execution access.
create function private.claim_erp_domain_outbox_v2(
  p_worker text,p_limit integer default 20
)
returns setof private.erp_domain_outbox_v2
language plpgsql security invoker
set search_path=public,private,pg_temp
as $$
begin
  if p_worker is null or length(btrim(p_worker))<3 then
    raise exception 'PHASE8_WORKER_ID_REQUIRED';
  end if;
  return query
  with to_claim as (
    select o.id from private.erp_domain_outbox_v2 o
    where o.status='PENDING'
      or (o.status='CLAIMED' and o.claimed_at<clock_timestamp()-interval '15 minutes')
    order by o.created_at,o.id for update skip locked
    limit least(greatest(coalesce(p_limit,20),1),100)
  )
  update private.erp_domain_outbox_v2 o
  set status='CLAIMED',attempts=o.attempts+1,
    claimed_by=btrim(p_worker),claimed_at=clock_timestamp(),last_error=null
  from to_claim c where o.id=c.id returning o.*;
end;
$$;

create function private.complete_erp_domain_outbox_v2(
  p_event_id uuid,p_worker text,p_success boolean,p_error text default null
)
returns boolean language plpgsql security invoker
set search_path=public,private,pg_temp
as $$
declare
  v_count int;
begin
  update private.erp_domain_outbox_v2
  set status=case when p_success then 'DELIVERED' else 'FAILED' end,
    delivered_at=case when p_success then clock_timestamp() else null end,
    last_error=case when p_success then null
      else left(coalesce(nullif(btrim(p_error),''),'Unspecified worker failure'),2000) end
  where id=p_event_id and status='CLAIMED' and claimed_by=p_worker;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;

revoke all on function private.publish_erp_domain_event_v2(),
 private.claim_erp_domain_outbox_v2(text,integer),
 private.complete_erp_domain_outbox_v2(uuid,text,boolean,text)
 from public,anon,authenticated,service_role;

-- No model/provider secrets, personal data, arbitrary SQL or write actions.
-- This is a restricted, deterministic context endpoint for a FUTURE AI agent.
create function public.get_erp_agent_readiness_context_v2(p_branch_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path=public,private,pg_temp
as $$
declare
  v_org uuid;
  v_missing bigint;
  v_receipt_gaps bigint;
  v_pending_events bigint;
  v_journal_lines bigint;
  v_created bigint;
begin
  if auth.uid() is null then
    return jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  end if;
  if not exists(select 1 from public.users u where u.id=auth.uid() and u.is_active)
    or not public.can_permission('accounts.view')
    or not public.can_permission('reports.view')
    or not public.user_may_access_branch(p_branch_id) then
    return jsonb_build_object('success',false,'error','NOT_AUTHORIZED');
  end if;
  select b.organization_id into v_org from public.branches b where b.id=p_branch_id;
  if v_org is null then
    return jsonb_build_object('success',false,'error','BRANCH_ORGANIZATION_REQUIRED');
  end if;
  select count(*) into v_missing
  from private.organization_journal_line_evidence_v2 e
  where e.branch_id=p_branch_id and e.mapping_status='UNMAPPED_AT_POSTING';
  select count(*) into v_journal_lines
  from private.organization_journal_line_evidence_v2 e
  where e.branch_id=p_branch_id;
  select count(*) into v_receipt_gaps
  from private.procurement_receipt_progress_v2 r
  where r.branch_id=p_branch_id and r.integrity_status<>'CONSISTENT';
  select count(*) into v_pending_events
  from private.erp_domain_outbox_v2 o
  where o.branch_id=p_branch_id and o.status in ('PENDING','CLAIMED','FAILED');
  select count(*) into v_created
  from private.erp_domain_outbox_v2 o
  where o.branch_id=p_branch_id;
  return jsonb_build_object('success',true,'organization_id',v_org,
    'branch_id',p_branch_id,'read_only',true,'agent_execution_enabled',false,
    'journal_lines_with_identity_evidence',v_journal_lines,
    'unmapped_journal_lines_at_posting',v_missing,
    'procurement_receipt_discrepancies',v_receipt_gaps,
    'pending_or_failed_domain_events',v_pending_events,
    'domain_events_created_since_activation',v_created,
    'next_review',case when v_missing>0 then 'ACCOUNT_MAPPING_REVIEW'
      when v_receipt_gaps>0 then 'PURCHASE_RECEIPT_REVIEW'
      when v_pending_events>0 then 'EVENT_PROCESSING_REVIEW'
      else 'NO_BLOCKING_ISSUES' end);
end;
$$;
revoke all on function public.get_erp_agent_readiness_context_v2(uuid)
  from public,anon,service_role;
grant execute on function public.get_erp_agent_readiness_context_v2(uuid)
  to authenticated;
