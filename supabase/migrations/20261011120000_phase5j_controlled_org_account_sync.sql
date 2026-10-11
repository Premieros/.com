-- Premier Architecture V2 — Accounting Phase 5J
-- Controlled two-person synchronization of organization shadow CoA only.
-- Preserve all public.chart_of_accounts and posted journal IDs/writers unchanged.

create table private.organization_account_sync_requests_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  branch_account_id uuid not null references public.chart_of_accounts(id),
  operation text not null check (operation in ('LINK_NEW','REFRESH_LABELS')),
  source_snapshot jsonb not null,
  requester_id uuid not null references public.users(id),
  request_reason text not null check(length(btrim(request_reason)) >= 3),
  status text not null default 'PENDING'
    check(status in ('PENDING','APPLIED','REJECTED','STALE','EXPIRED')),
  reviewer_id uuid references public.users(id),
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
  decided_at timestamptz,
  applied_at timestamptz
);
create unique index uq_org_account_sync_pending_account_v2
  on private.organization_account_sync_requests_v2(branch_account_id)
  where status='PENDING';
create index org_account_sync_org_status_v2
  on private.organization_account_sync_requests_v2(organization_id,status,created_at);

alter table private.organization_account_sync_requests_v2 enable row level security;
revoke all on private.organization_account_sync_requests_v2
  from public,anon,authenticated,service_role;

-- Private, immutable plan calculation. Never a write source or direct browser RPC.
create function private.organization_account_sync_plan_v2(p_branch_account_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path=public,private,pg_temp
as $$
declare
  v_account public.chart_of_accounts%rowtype;
  v_org uuid;
  v_master private.organization_accounts_v2%rowtype;
  v_link private.organization_account_branch_links_v2%rowtype;
  v_op text;
  v_snapshot jsonb;
begin
  select * into v_account from public.chart_of_accounts where id=p_branch_account_id;
  if not found then return jsonb_build_object('status','ACCOUNT_NOT_FOUND'); end if;
  select organization_id into v_org from public.branches where id=v_account.branch_id;
  if v_org is null then return jsonb_build_object('status','MISSING_ORGANIZATION'); end if;

  select * into v_link from private.organization_account_branch_links_v2
    where branch_account_id=v_account.id;
  select * into v_master from private.organization_accounts_v2
    where organization_id=v_org and code=v_account.code;

  if v_link.branch_account_id is not null then
    if v_master.id is null or v_master.id is distinct from v_link.organization_account_id
       or v_link.organization_id is distinct from v_org
       or v_link.branch_id is distinct from v_account.branch_id then
      return jsonb_build_object('status','MANUAL_REVIEW_REQUIRED');
    end if;
    if v_master.account_type is distinct from v_account.account_type
       or v_master.is_system is distinct from v_account.is_system then
      return jsonb_build_object('status','MANUAL_REVIEW_REQUIRED');
    end if;
    if v_master.name is not distinct from v_account.name
       and v_master.name_en is not distinct from v_account.name_en
       and v_master.is_active is not distinct from v_account.is_active then
      return jsonb_build_object('status','ALREADY_SYNCED');
    end if;

    -- A refresh is safe only when ALL linked branches agree on the new
    -- name, translation and active state. Codes/types/system flag never change here.
    if exists (
      select 1 from private.organization_account_branch_links_v2 l
      join public.chart_of_accounts a on a.id=l.branch_account_id
      join public.branches b on b.id=a.branch_id
      where l.organization_account_id=v_master.id
        and (b.organization_id is distinct from v_org
             or a.code is distinct from v_account.code
             or a.account_type is distinct from v_account.account_type
             or a.is_system is distinct from v_account.is_system
             or a.name is distinct from v_account.name
             or a.name_en is distinct from v_account.name_en
             or a.is_active is distinct from v_account.is_active)
    ) then return jsonb_build_object('status','SIBLING_DEFINITION_CONFLICT'); end if;
    v_op:='REFRESH_LABELS';
  else
    if exists (
      select 1 from private.organization_chart_account_conflicts_v2 h
      where h.organization_id=v_org and h.account_code=v_account.code
    ) then return jsonb_build_object('status','SIBLING_DEFINITION_CONFLICT'); end if;
    if v_master.id is not null and (
       v_master.account_type is distinct from v_account.account_type
       or v_master.name is distinct from v_account.name
       or v_master.name_en is distinct from v_account.name_en
       or v_master.is_system is distinct from v_account.is_system
       or v_master.is_active is distinct from v_account.is_active
    ) then return jsonb_build_object('status','MASTER_DEFINITION_CONFLICT'); end if;
    v_op:='LINK_NEW';
  end if;

  v_snapshot:=jsonb_build_object(
    'branch_account_id',v_account.id,
    'organization_id',v_org,
    'branch_id',v_account.branch_id,
    'code',v_account.code,
    'name',v_account.name,
    'name_en',v_account.name_en,
    'account_type',v_account.account_type,
    'is_system',v_account.is_system,
    'is_active',v_account.is_active,
    'master_id',v_master.id,
    'linked_id',v_link.organization_account_id,
    'operation',v_op
  );
  return jsonb_build_object('status','READY','operation',v_op,
    'organization_id',v_org,'branch_id',v_account.branch_id,
    'snapshot',v_snapshot);
end;
$$;

revoke all on function private.organization_account_sync_plan_v2(uuid)
  from public,anon,authenticated,service_role;

-- Authenticated accountant proposes; no private master or link is mutated.
create function public.request_organization_account_sync_v2(
  p_branch_account_id uuid,
  p_reason text
) returns jsonb language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_plan jsonb;
  v_org uuid;
  v_branch uuid;
  v_id uuid;
begin
  if v_actor is null then
    return jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  end if;
  if not exists(select 1 from public.users where id=v_actor and is_active=true)
     or not public.can_permission('accounts.manage') then
    return jsonb_build_object('success',false,'error','NOT_AUTHORIZED');
  end if;
  if p_reason is null or length(btrim(p_reason))<3 then
    return jsonb_build_object('success',false,'error','REASON_REQUIRED');
  end if;
  v_plan:=private.organization_account_sync_plan_v2(p_branch_account_id);
  if v_plan->>'status'<>'READY' then
    return jsonb_build_object('success',false,'error',v_plan->>'status');
  end if;
  v_org:=(v_plan->>'organization_id')::uuid;
  v_branch:=(v_plan->>'branch_id')::uuid;
  -- Organization-wide changes must not be originated by single-branch access.
  if exists(
    select 1 from public.branches b where b.organization_id=v_org
      and public.user_may_access_branch(b.id) is distinct from true
  ) then return jsonb_build_object('success',false,'error','ORGANIZATION_ACCESS_REQUIRED');
  end if;

  -- Duplicate pending proposals are refused (rather than silently reused).
  insert into private.organization_account_sync_requests_v2 (
    organization_id,branch_id,branch_account_id,operation,
    source_snapshot,requester_id,request_reason
  ) values (
    v_org,v_branch,p_branch_account_id,v_plan->>'operation',
    v_plan->'snapshot',v_actor,btrim(p_reason)
  ) on conflict (branch_account_id) where status='PENDING' do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('success',false,'error','PENDING_REQUEST_EXISTS');
  end if;

  insert into public.audit_log(user_id,action,entity,entity_id,branch_id,details)
  values(v_actor,'ORG_ACCOUNT_SYNC_REQUESTED','organization_account_sync',v_id,v_branch,
    jsonb_build_object('organization_id',v_org,'branch_account_id',p_branch_account_id,
      'operation',v_plan->>'operation','snapshot',v_plan->'snapshot','reason',btrim(p_reason)));
  return jsonb_build_object('success',true,'request_id',v_id,'status','PENDING',
    'operation',v_plan->>'operation');
end;
$$;
revoke all on function public.request_organization_account_sync_v2(uuid,text)
  from public,anon;
grant execute on function public.request_organization_account_sync_v2(uuid,text)
  to authenticated;

-- Independent reviewer applies exactly the frozen, revalidated state atomically.
create function public.decide_organization_account_sync_v2(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
) returns jsonb language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_req private.organization_account_sync_requests_v2%rowtype;
  v_plan jsonb;
  v_a public.chart_of_accounts%rowtype;
  v_master private.organization_accounts_v2%rowtype;
  v_master_id uuid;
  v_status text;
begin
  if v_actor is null then
    return jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  end if;
  if not exists(select 1 from public.users where id=v_actor and is_active=true)
    or not public.can_permission('approvals.review')
    or not public.can_permission('accounts.manage') then
    return jsonb_build_object('success',false,'error','NOT_AUTHORIZED');
  end if;
  select * into v_req from private.organization_account_sync_requests_v2
    where id=p_request_id for update;
  if not found then return jsonb_build_object('success',false,'error','REQUEST_NOT_FOUND'); end if;
  if exists(
    select 1 from public.branches b where b.organization_id=v_req.organization_id
      and public.user_may_access_branch(b.id) is distinct from true
  ) then return jsonb_build_object('success',false,'error','ORGANIZATION_ACCESS_REQUIRED'); end if;
  if v_req.requester_id=v_actor then
    return jsonb_build_object('success',false,'error','SELF_APPROVAL_FORBIDDEN'); end if;
  if v_req.status<>'PENDING' then
    return jsonb_build_object('success',false,'error','REQUEST_ALREADY_DECIDED','status',v_req.status);
  end if;
  if v_req.expires_at<=clock_timestamp() then
    update private.organization_account_sync_requests_v2
      set status='EXPIRED',reviewer_id=v_actor,decided_at=clock_timestamp()
      where id=v_req.id;
    return jsonb_build_object('success',false,'error','REQUEST_EXPIRED');
  end if;
  if not coalesce(p_approve,false) then
    update private.organization_account_sync_requests_v2
      set status='REJECTED',reviewer_id=v_actor,review_note=nullif(btrim(p_note),''),
          decided_at=clock_timestamp() where id=v_req.id;
    insert into public.audit_log(user_id,action,entity,entity_id,branch_id,details)
      values(v_actor,'ORG_ACCOUNT_SYNC_REJECTED','organization_account_sync',v_req.id,v_req.branch_id,
        jsonb_build_object('organization_id',v_req.organization_id,
          'requester_id',v_req.requester_id,'note',p_note));
    return jsonb_build_object('success',true,'request_id',v_req.id,'status','REJECTED');
  end if;

  -- Lock the source row; prevent concurrent approvers for the same org/code.
  select * into v_a from public.chart_of_accounts
    where id=v_req.branch_account_id for update;
  if found then
    perform pg_advisory_xact_lock(
      hashtextextended(v_req.organization_id::text||':'||v_a.code,0)
    );
  end if;
  v_plan:=private.organization_account_sync_plan_v2(v_req.branch_account_id);
  if v_plan->>'status' is distinct from 'READY'
     or v_plan->>'operation' is distinct from v_req.operation
     or v_plan->'snapshot' is distinct from v_req.source_snapshot
     or (v_plan->>'organization_id')::uuid is distinct from v_req.organization_id
     or (v_plan->>'branch_id')::uuid is distinct from v_req.branch_id then
    update private.organization_account_sync_requests_v2
      set status='STALE',reviewer_id=v_actor,review_note='Source changed; re-propose',
          decided_at=clock_timestamp() where id=v_req.id;
    insert into public.audit_log(user_id,action,entity,entity_id,branch_id,details)
      values(v_actor,'ORG_ACCOUNT_SYNC_STALE','organization_account_sync',v_req.id,v_req.branch_id,
        jsonb_build_object('organization_id',v_req.organization_id,
          'proposed',v_req.source_snapshot,'actual_status',v_plan->>'status'));
    return jsonb_build_object('success',false,'error','STALE_PROPOSAL');
  end if;

  select * into v_master from private.organization_accounts_v2
    where organization_id=v_req.organization_id and code=v_a.code for update;
  if v_req.operation='LINK_NEW' then
    if v_master.id is null then
      insert into private.organization_accounts_v2(
        organization_id,code,name,name_en,account_type,is_system,is_active,
        initial_branch_account_count,initial_readiness_status
      ) values (
        v_req.organization_id,v_a.code,v_a.name,v_a.name_en,v_a.account_type,
        v_a.is_system,v_a.is_active,1,
        case when
          (select count(*) from public.branches where organization_id=v_req.organization_id)>1
          then 'PARTIAL_BRANCH_COVERAGE' else 'CONSISTENT' end
      ) returning id into v_master_id;
    else
      v_master_id:=v_master.id;
    end if;
    insert into private.organization_account_branch_links_v2(
      branch_account_id,organization_account_id,organization_id,branch_id
    ) values (v_a.id,v_master_id,v_req.organization_id,v_a.branch_id);
  elsif v_req.operation='REFRESH_LABELS' then
    if v_master.id is null then raise exception 'PHASE5J_REFRESH_MISSING_MASTER'; end if;
    v_master_id:=v_master.id;
    update private.organization_accounts_v2
      set name=v_a.name,name_en=v_a.name_en,is_active=v_a.is_active
      where id=v_master_id;
  else
    raise exception 'PHASE5J_UNKNOWN_OPERATION';
  end if;

  select mapping_status into v_status
    from private.organization_account_link_health_v2
    where branch_account_id=v_a.id;
  if v_status is distinct from 'MAPPED_OK' then
    raise exception 'PHASE5J_POST_APPLY_INVARIANT %',coalesce(v_status,'MISSING');
  end if;
  update private.organization_account_sync_requests_v2
    set status='APPLIED',reviewer_id=v_actor,review_note=nullif(btrim(p_note),''),
        decided_at=clock_timestamp(),applied_at=clock_timestamp()
    where id=v_req.id;
  insert into public.audit_log(user_id,action,entity,entity_id,branch_id,details)
    values(v_actor,'ORG_ACCOUNT_SYNC_APPLIED','organization_account_sync',v_req.id,v_req.branch_id,
      jsonb_build_object('organization_id',v_req.organization_id,
        'requester_id',v_req.requester_id,'operation',v_req.operation,
        'branch_account_id',v_a.id,'organization_account_id',v_master_id,
        'approved_source_snapshot',v_req.source_snapshot,'note',p_note));
  return jsonb_build_object('success',true,'request_id',v_req.id,'status','APPLIED',
    'organization_account_id',v_master_id,'branch_account_id',v_a.id);
end;
$$;
revoke all on function public.decide_organization_account_sync_v2(uuid,boolean,text)
  from public,anon;
grant execute on function public.decide_organization_account_sync_v2(uuid,boolean,text)
  to authenticated;
