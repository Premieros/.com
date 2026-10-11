-- Premier Architecture V2 — Accounting Phase 5K
-- Read-only, tenant-scoped queue/candidate projection for the governed Phase 5J
-- request/decision RPCs. Never grant direct access to private shadow tables.
create or replace function public.get_organization_account_sync_workbench_v2(
  p_organization_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql stable security definer
set search_path = public, private, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org_ids uuid[];
  v_orgs jsonb := '[]'::jsonb;
  v_requests jsonb := '[]'::jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_limit integer := least(greatest(coalesce(p_limit,100),1),100);
begin
  if v_actor is null then
    return jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  end if;
  if not exists(select 1 from public.users u where u.id=v_actor and u.is_active=true)
     or not public.can_permission('accounts.manage') then
    return jsonb_build_object('success',false,'error','NOT_AUTHORIZED');
  end if;

  -- No cross-tenant branch leaks: an org is visible only when this user may
  -- access EVERY branch, just as Phase 5J's request and approval functions require.
  select coalesce(array_agg(o.id),array[]::uuid[]) into v_org_ids
  from public.organizations o
  where exists(select 1 from public.branches b where b.organization_id=o.id)
    and not exists (
      select 1 from public.branches b
      where b.organization_id=o.id
        and public.user_may_access_branch(b.id) is distinct from true
    );
  if p_organization_id is not null and not(p_organization_id=any(v_org_ids)) then
    return jsonb_build_object('success',false,'error','ORGANIZATION_ACCESS_REQUIRED');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('id',o.id,'name',o.name) order by o.name,o.id
  ),'[]'::jsonb)
  into v_orgs
  from public.organizations o
  where o.id=any(v_org_ids);

  -- The request is the immutable proposed snapshot; the live plan and current
  -- source/master are separate to make stale data visible before a decision.
  select coalesce(jsonb_agg(t.payload order by t.created_at desc,t.id desc),'[]'::jsonb)
  into v_requests
  from (
    select r.id,r.created_at,
      jsonb_build_object(
        'id',r.id,'organization_id',r.organization_id,
        'organization_name',o.name,'branch_id',r.branch_id,
        'branch_name',b.name,'branch_account_id',r.branch_account_id,
        'operation',r.operation,'status',r.status,
        'request_reason',r.request_reason,
        'created_at',r.created_at,'expires_at',r.expires_at,
        'decided_at',r.decided_at,'applied_at',r.applied_at,
        'requester_id',r.requester_id,
        'requester_name',coalesce(requester.full_name,requester.email),
        'reviewer_id',r.reviewer_id,
        'reviewer_name',coalesce(reviewer.full_name,reviewer.email),
        'review_note',r.review_note,
        'proposed',r.source_snapshot,
        'source',case when a.id is null then null else
          jsonb_build_object('code',a.code,'name',a.name,'name_en',a.name_en,
            'account_type',a.account_type,'is_system',a.is_system,'is_active',a.is_active)
          end,
        'master',case when m.id is null then null else
          jsonb_build_object('code',m.code,'name',m.name,'name_en',m.name_en,
            'account_type',m.account_type,'is_system',m.is_system,'is_active',m.is_active)
          end,
        'live_plan_status',case when r.status='PENDING'
          then private.organization_account_sync_plan_v2(r.branch_account_id)->>'status'
          else null end,
        'stale',case when r.status='PENDING' then
          r.expires_at<=clock_timestamp()
          or private.organization_account_sync_plan_v2(r.branch_account_id)->>'status' is distinct from 'READY'
          or private.organization_account_sync_plan_v2(r.branch_account_id)->'snapshot'
            is distinct from r.source_snapshot
          else false end
      ) as payload
    from private.organization_account_sync_requests_v2 r
    join public.organizations o on o.id=r.organization_id
    join public.branches b on b.id=r.branch_id
    left join public.users requester on requester.id=r.requester_id
    left join public.users reviewer on reviewer.id=r.reviewer_id
    left join public.chart_of_accounts a on a.id=r.branch_account_id
    left join private.organization_accounts_v2 m
      on m.organization_id=r.organization_id and m.code=r.source_snapshot->>'code'
    where r.organization_id=any(v_org_ids)
      and (p_organization_id is null or r.organization_id=p_organization_id)
    order by r.created_at desc,r.id desc
    limit v_limit
  ) t;

  -- Drift is reviewed on demand. A blocking type/system/code conflict remains
  -- a visibly blocked candidate rather than an unsafe one-click correction.
  select coalesce(jsonb_agg(t.payload order by t.branch_code,t.branch_account_id),'[]'::jsonb)
  into v_candidates
  from (
    select h.branch_account_id,h.branch_code,
      jsonb_build_object(
        'branch_account_id',h.branch_account_id,
        'organization_id',h.current_organization_id,
        'organization_name',o.name,
        'branch_id',h.branch_id,'branch_name',b.name,
        'code',h.branch_code,'mapping_status',h.mapping_status,
        'source',jsonb_build_object(
          'code',a.code,'name',a.name,'name_en',a.name_en,
          'account_type',a.account_type,'is_system',a.is_system,'is_active',a.is_active),
        'master',case when m.id is null then null else
          jsonb_build_object(
            'code',m.code,'name',m.name,'name_en',m.name_en,
            'account_type',m.account_type,'is_system',m.is_system,'is_active',m.is_active)
          end,
        'plan_status',private.organization_account_sync_plan_v2(h.branch_account_id)->>'status',
        'operation',private.organization_account_sync_plan_v2(h.branch_account_id)->>'operation'
      ) payload
    from private.organization_account_link_health_v2 h
    join public.chart_of_accounts a on a.id=h.branch_account_id
    join public.branches b on b.id=h.branch_id
    join public.organizations o on o.id=h.current_organization_id
    -- An unmapped branch account can still match an existing org master.
    -- Surface that master for an accurate reviewer side-by-side comparison.
    left join private.organization_accounts_v2 m
      on m.organization_id=h.current_organization_id and m.code=h.branch_code
    where h.current_organization_id=any(v_org_ids)
      and (p_organization_id is null or h.current_organization_id=p_organization_id)
      and h.mapping_status<>'MAPPED_OK'
    order by h.branch_code,h.branch_account_id
    limit v_limit
  ) t;

  return jsonb_build_object('success',true,'organizations',v_orgs,
    'requests',v_requests,'candidates',v_candidates,'limit',v_limit,
    'can_review',public.can_permission('approvals.review'),
    'shadow_only',true);
end;
$$;
revoke all on function public.get_organization_account_sync_workbench_v2(uuid,integer)
  from public,anon,service_role;
grant execute on function public.get_organization_account_sync_workbench_v2(uuid,integer)
  to authenticated;
