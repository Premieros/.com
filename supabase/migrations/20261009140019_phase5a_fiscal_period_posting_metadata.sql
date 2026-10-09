create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  name text not null,
  status text not null default 'OPEN'
    check (status in ('OPEN','SOFT_CLOSED','CLOSED')),
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,period_start),
  check (period_start = date_trunc('month',period_start)::date),
  check (period_end = (period_start + interval '1 month - 1 day')::date),
  check (
    (status='OPEN' and closed_at is null)
    or status in ('SOFT_CLOSED','CLOSED')
  )
);

create index if not exists accounting_periods_org_status_idx
  on public.accounting_periods(organization_id,status,period_start desc);

alter table public.accounting_periods enable row level security;

drop policy if exists accounting_periods_select_organization on public.accounting_periods;
create policy accounting_periods_select_organization
on public.accounting_periods
for select
to authenticated
using (public.user_can_access_organization(organization_id));

revoke all on table public.accounting_periods from public,anon,authenticated,service_role;
grant select on table public.accounting_periods to authenticated,service_role;

alter table public.journal_entries
  add column if not exists period_id uuid references public.accounting_periods(id) on delete restrict,
  add column if not exists posting_status text not null default 'POSTED',
  add column if not exists posted_at timestamptz,
  add column if not exists posted_by uuid,
  add column if not exists reversal_of uuid references public.journal_entries(id) on delete restrict,
  add column if not exists correlation_id uuid,
  add column if not exists source_event_id uuid;

alter table public.journal_entries
  drop constraint if exists journal_entries_posting_status_check;

alter table public.journal_entries
  add constraint journal_entries_posting_status_check
  check (posting_status in ('DRAFT','POSTED','REVERSED'));

create index if not exists journal_entries_period_idx
  on public.journal_entries(period_id,entry_date);

create index if not exists journal_entries_correlation_idx
  on public.journal_entries(correlation_id)
  where correlation_id is not null;

create index if not exists journal_entries_reversal_of_idx
  on public.journal_entries(reversal_of)
  where reversal_of is not null;

create or replace function private.ensure_accounting_period_for_date(
  p_branch_id uuid,
  p_entry_date date
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org_id uuid;
  v_period_start date;
  v_period_end date;
  v_period_id uuid;
begin
  select b.organization_id
  into v_org_id
  from public.branches b
  where b.id=p_branch_id;

  if v_org_id is null then
    raise exception 'ACCOUNTING_PERIOD_ORGANIZATION_NOT_FOUND';
  end if;

  v_period_start:=date_trunc('month',coalesce(p_entry_date,current_date))::date;
  v_period_end:=(v_period_start+interval '1 month - 1 day')::date;

  select ap.id
  into v_period_id
  from public.accounting_periods ap
  where ap.organization_id=v_org_id
    and ap.period_start=v_period_start;

  if v_period_id is null then
    insert into public.accounting_periods(
      organization_id,period_start,period_end,name,status
    )
    values(
      v_org_id,
      v_period_start,
      v_period_end,
      to_char(v_period_start,'YYYY-MM'),
      'OPEN'
    )
    on conflict(organization_id,period_start) do update
      set updated_at=public.accounting_periods.updated_at
    returning id into v_period_id;
  end if;

  return v_period_id;
end;
$$;

create or replace function private.assign_journal_posting_metadata()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.branch_id is null then
    raise exception 'JOURNAL_BRANCH_REQUIRED';
  end if;

  if new.entry_date is null then
    new.entry_date:=current_date;
  end if;

  if tg_op='INSERT'
     or new.period_id is null
     or new.branch_id is distinct from old.branch_id
     or new.entry_date is distinct from old.entry_date then
    new.period_id:=private.ensure_accounting_period_for_date(
      new.branch_id,
      new.entry_date
    );
  end if;

  if tg_op='INSERT' then
    new.posting_status:=coalesce(new.posting_status,'POSTED');
    new.posted_at:=coalesce(new.posted_at,clock_timestamp());
    new.posted_by:=coalesce(new.posted_by,new.created_by,auth.uid());
    new.correlation_id:=coalesce(new.correlation_id,gen_random_uuid());
  end if;

  return new;
end;
$$;

revoke execute on function private.ensure_accounting_period_for_date(uuid,date)
  from public,anon,authenticated;
revoke execute on function private.assign_journal_posting_metadata()
  from public,anon,authenticated;

grant execute on function private.ensure_accounting_period_for_date(uuid,date)
  to postgres,service_role;
grant execute on function private.assign_journal_posting_metadata()
  to postgres,service_role;

with organization_bounds as (
  select
    o.id as organization_id,
    coalesce(min(je.entry_date),current_date) as min_date,
    greatest(coalesce(max(je.entry_date),current_date),current_date) as max_date
  from public.organizations o
  left join public.branches b on b.organization_id=o.id
  left join public.journal_entries je on je.branch_id=b.id
  group by o.id
),
months as (
  select
    ob.organization_id,
    gs::date as period_start
  from organization_bounds ob
  cross join lateral generate_series(
    date_trunc('month',ob.min_date)::date,
    date_trunc('month',ob.max_date)::date,
    interval '1 month'
  ) gs
)
insert into public.accounting_periods(
  organization_id,period_start,period_end,name,status
)
select
  m.organization_id,
  m.period_start,
  (m.period_start+interval '1 month - 1 day')::date,
  to_char(m.period_start,'YYYY-MM'),
  'OPEN'
from months m
on conflict(organization_id,period_start) do nothing;

update public.journal_entries je
set
  period_id=ap.id,
  posting_status='POSTED',
  posted_at=coalesce(je.posted_at,je.created_at),
  posted_by=coalesce(je.posted_by,je.created_by),
  correlation_id=coalesce(je.correlation_id,gen_random_uuid())
from public.branches b
join public.accounting_periods ap
  on ap.organization_id=b.organization_id
where b.id=je.branch_id
  and je.entry_date between ap.period_start and ap.period_end;

drop trigger if exists trg_assign_journal_posting_metadata on public.journal_entries;
create trigger trg_assign_journal_posting_metadata
before insert or update of branch_id,entry_date
on public.journal_entries
for each row
execute function private.assign_journal_posting_metadata();

create or replace view private.canonical_journal_lifecycle
as
select
  je.id as journal_entry_id,
  je.entry_number,
  je.branch_id,
  b.organization_id,
  je.entry_date,
  je.period_id,
  ap.period_start,
  ap.period_end,
  ap.status as period_status,
  je.posting_status,
  je.posted_at,
  je.posted_by,
  je.reversal_of,
  je.correlation_id,
  je.source_event_id,
  je.reference_type,
  je.reference_id,
  je.reference_number,
  je.created_at,
  coalesce(sum(jel.debit),0)::numeric as debit_total,
  coalesce(sum(jel.credit),0)::numeric as credit_total,
  (
    abs(
      coalesce(sum(jel.debit),0)
      - coalesce(sum(jel.credit),0)
    )<=0.005
  ) as is_balanced
from public.journal_entries je
join public.branches b on b.id=je.branch_id
left join public.accounting_periods ap on ap.id=je.period_id
left join public.journal_entry_lines jel on jel.journal_entry_id=je.id
group by
  je.id,je.entry_number,je.branch_id,b.organization_id,je.entry_date,
  je.period_id,ap.period_start,ap.period_end,ap.status,
  je.posting_status,je.posted_at,je.posted_by,je.reversal_of,
  je.correlation_id,je.source_event_id,je.reference_type,je.reference_id,
  je.reference_number,je.created_at;

revoke all on table private.canonical_journal_lifecycle
  from public,anon,authenticated;
grant select on table private.canonical_journal_lifecycle
  to postgres,service_role;
