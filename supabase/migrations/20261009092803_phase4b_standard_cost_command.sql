create or replace function private.guard_item_standard_cost_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.effective_to is not null and new.effective_to <= new.effective_from then
    raise exception 'STANDARD_COST_INVALID_PERIOD';
  end if;

  if exists (
    select 1
    from public.item_standard_costs s
    where s.item_id = new.item_id
      and s.branch_id = new.branch_id
      and s.id <> new.id
      and tstzrange(
        s.effective_from,
        coalesce(s.effective_to, 'infinity'::timestamptz),
        '[)'
      ) && tstzrange(
        new.effective_from,
        coalesce(new.effective_to, 'infinity'::timestamptz),
        '[)'
      )
  ) then
    raise exception 'STANDARD_COST_PERIOD_OVERLAP';
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_item_standard_cost_overlap() from public, anon, authenticated;
grant execute on function private.guard_item_standard_cost_overlap() to postgres, service_role;

drop trigger if exists trg_guard_item_standard_cost_overlap on public.item_standard_costs;
create trigger trg_guard_item_standard_cost_overlap
before insert or update on public.item_standard_costs
for each row
execute function private.guard_item_standard_cost_overlap();

create or replace function public.set_item_standard_cost(
  p_item_id uuid,
  p_branch_id uuid,
  p_standard_cost numeric,
  p_reason text,
  p_effective_from timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_privileged boolean := (
    coalesce(current_setting('role', true), '') in ('service_role','postgres')
    or session_user = 'postgres'
  );
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_next_from timestamptz;
  v_id uuid;
  v_effective_from timestamptz := coalesce(p_effective_from, clock_timestamp());
begin
  if p_item_id is null or p_branch_id is null then
    return jsonb_build_object('success', false, 'error', 'INVALID_SCOPE');
  end if;

  if p_standard_cost is null or p_standard_cost < 0 then
    return jsonb_build_object('success', false, 'error', 'INVALID_STANDARD_COST');
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  end if;

  select i.organization_id
  into v_org_id
  from public.items i
  join public.item_sites s
    on s.item_id = i.id
   and s.branch_id = p_branch_id
  join public.branches b
    on b.id = p_branch_id
   and b.organization_id = i.organization_id
  where i.id = p_item_id;

  if v_org_id is null then
    return jsonb_build_object('success', false, 'error', 'ITEM_BRANCH_NOT_FOUND');
  end if;

  if not v_is_privileged then
    if v_actor is null then
      return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    end if;

    if not public.user_may_access_branch(p_branch_id) then
      return jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
    end if;

    if not public.can_permission('reports.costing') then
      return jsonb_build_object(
        'success', false,
        'error', 'PERMISSION_DENIED',
        'permission', 'reports.costing'
      );
    end if;

    if not public.can_permission('products.edit') then
      return jsonb_build_object(
        'success', false,
        'error', 'PERMISSION_DENIED',
        'permission', 'products.edit'
      );
    end if;
  end if;

  perform 1
  from public.item_standard_costs s
  where s.item_id = p_item_id
    and s.branch_id = p_branch_id
  order by s.effective_from
  for update;

  if exists (
    select 1
    from public.item_standard_costs s
    where s.item_id = p_item_id
      and s.branch_id = p_branch_id
      and s.effective_from = v_effective_from
  ) then
    return jsonb_build_object('success', false, 'error', 'STANDARD_COST_EFFECTIVE_DATE_EXISTS');
  end if;

  select min(s.effective_from)
  into v_next_from
  from public.item_standard_costs s
  where s.item_id = p_item_id
    and s.branch_id = p_branch_id
    and s.effective_from > v_effective_from;

  update public.item_standard_costs s
  set effective_to = v_effective_from
  where s.item_id = p_item_id
    and s.branch_id = p_branch_id
    and s.effective_from < v_effective_from
    and (s.effective_to is null or s.effective_to > v_effective_from);

  insert into public.item_standard_costs(
    item_id,
    branch_id,
    standard_cost,
    effective_from,
    effective_to,
    notes,
    created_by
  )
  values(
    p_item_id,
    p_branch_id,
    round(p_standard_cost, 6),
    v_effective_from,
    v_next_from,
    btrim(p_reason),
    v_actor
  )
  returning id into v_id;

  insert into public.audit_log(
    user_id,
    action,
    entity,
    entity_id,
    branch_id,
    details
  )
  values(
    v_actor,
    'SET_STANDARD_COST',
    'item_standard_costs',
    v_id,
    p_branch_id,
    jsonb_build_object(
      'item_id', p_item_id,
      'standard_cost', round(p_standard_cost, 6),
      'effective_from', v_effective_from,
      'effective_to', v_next_from,
      'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'success', true,
    'standard_cost_id', v_id,
    'item_id', p_item_id,
    'branch_id', p_branch_id,
    'standard_cost', round(p_standard_cost, 6),
    'effective_from', v_effective_from,
    'effective_to', v_next_from
  );
end;
$$;

revoke execute on function public.set_item_standard_cost(uuid,uuid,numeric,text,timestamptz)
  from public, anon;
grant execute on function public.set_item_standard_cost(uuid,uuid,numeric,text,timestamptz)
  to authenticated, service_role;

create or replace function public.get_item_costing_v2(p_branch_id uuid)
returns table(
  item_id uuid,
  organization_id uuid,
  branch_id uuid,
  item_type text,
  name text,
  code text,
  inventory_cost numeric,
  costing_reference_cost numeric,
  theoretical_cost numeric,
  standard_cost numeric,
  standard_effective_from timestamptz,
  standard_effective_to timestamptz,
  theoretical_cost_basis text,
  theoretical_cost_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_privileged boolean := (
    coalesce(current_setting('role', true), '') in ('service_role','postgres')
    or session_user = 'postgres'
  );
begin
  if p_branch_id is null then
    return;
  end if;

  if not v_is_privileged then
    if auth.uid() is null then
      raise exception 'AUTH_REQUIRED';
    end if;

    if not public.user_may_access_branch(p_branch_id) then
      raise exception 'BRANCH_ACCESS_DENIED';
    end if;

    if not public.can_permission('reports.costing') then
      raise exception 'PERMISSION_DENIED';
    end if;
  end if;

  return query
  select
    c.item_id,
    c.organization_id,
    c.branch_id,
    c.item_type,
    c.name,
    c.code,
    c.inventory_cost,
    c.costing_reference_cost,
    c.theoretical_cost,
    c.standard_cost,
    c.standard_effective_from,
    c.standard_effective_to,
    c.theoretical_cost_basis,
    c.theoretical_cost_status
  from private.canonical_item_costs c
  where c.branch_id = p_branch_id
  order by c.item_type, c.name, c.item_id;
end;
$$;

revoke execute on function public.get_item_costing_v2(uuid) from public, anon;
grant execute on function public.get_item_costing_v2(uuid) to authenticated, service_role;

create or replace function public.get_item_standard_cost_history(
  p_item_id uuid,
  p_branch_id uuid
)
returns table(
  id uuid,
  standard_cost numeric,
  effective_from timestamptz,
  effective_to timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_privileged boolean := (
    coalesce(current_setting('role', true), '') in ('service_role','postgres')
    or session_user = 'postgres'
  );
begin
  if p_item_id is null or p_branch_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.item_sites s
    join public.items i on i.id=s.item_id
    join public.branches b
      on b.id=s.branch_id
     and b.organization_id=i.organization_id
    where s.item_id=p_item_id
      and s.branch_id=p_branch_id
  ) then
    return;
  end if;

  if not v_is_privileged then
    if auth.uid() is null then
      raise exception 'AUTH_REQUIRED';
    end if;

    if not public.user_may_access_branch(p_branch_id) then
      raise exception 'BRANCH_ACCESS_DENIED';
    end if;

    if not public.can_permission('reports.costing') then
      raise exception 'PERMISSION_DENIED';
    end if;
  end if;

  return query
  select
    s.id,
    s.standard_cost,
    s.effective_from,
    s.effective_to,
    s.notes,
    s.created_by,
    s.created_at
  from public.item_standard_costs s
  where s.item_id=p_item_id
    and s.branch_id=p_branch_id
  order by s.effective_from desc, s.created_at desc;
end;
$$;

revoke execute on function public.get_item_standard_cost_history(uuid,uuid) from public, anon;
grant execute on function public.get_item_standard_cost_history(uuid,uuid) to authenticated, service_role;
