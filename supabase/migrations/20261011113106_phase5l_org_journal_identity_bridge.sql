-- Architecture V2: consolidated Phase 5L — immutable organization ledger identity evidence.
-- We never rewrite posted journal_entry_lines.account_id or change posting writers.
create table private.organization_journal_line_evidence_v2 (
  journal_line_id bigint primary key references public.journal_entry_lines(id) on delete restrict,
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  branch_id uuid not null references public.branches(id),
  organization_id uuid not null references public.organizations(id),
  branch_account_id uuid not null references public.chart_of_accounts(id),
  organization_account_id uuid,
  mapping_status text not null check(mapping_status in ('MAPPED_AT_POSTING','UNMAPPED_AT_POSTING')),
  debit numeric not null,
  credit numeric not null,
  historical_bootstrap boolean not null default false,
  captured_at timestamptz not null default clock_timestamp(),
  foreign key(organization_account_id,organization_id)
    references private.organization_accounts_v2(id,organization_id),
  constraint mapped_evidence_has_master_v2 check(
    (mapping_status='MAPPED_AT_POSTING')=(organization_account_id is not null)
  )
);
create index organization_journal_evidence_org_account_v2
  on private.organization_journal_line_evidence_v2(organization_id,organization_account_id);
create index organization_journal_evidence_branch_status_v2
  on private.organization_journal_line_evidence_v2(branch_id,mapping_status);

alter table private.organization_journal_line_evidence_v2 enable row level security;
revoke all on private.organization_journal_line_evidence_v2 from public,anon,authenticated,service_role;

create function private.deny_organization_journal_evidence_mutation_v2()
returns trigger language plpgsql set search_path=pg_catalog
as $$
begin
  raise exception 'PHASE5L_IMMUTABLE_LEDGER_EVIDENCE';
end;
$$;
create trigger trg_organization_journal_evidence_immutable_v2
before update or delete on private.organization_journal_line_evidence_v2
for each row execute function private.deny_organization_journal_evidence_mutation_v2();

-- Every newly inserted operational journal line receives an immutable
-- organization-owned identity at the exact same transaction boundary.
-- If no approved mapping exists, capture an explicit exception, not a guess.
create function private.capture_organization_journal_line_v2()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_journal_branch uuid;
  v_account_branch uuid;
  v_org uuid;
  v_master uuid;
begin
  select j.branch_id into v_journal_branch from public.journal_entries j
  where j.id=new.journal_entry_id;
  select a.branch_id into v_account_branch from public.chart_of_accounts a
  where a.id=new.account_id;
  if v_journal_branch is null or v_account_branch is distinct from v_journal_branch then
    raise exception 'PHASE5L_CROSS_BRANCH_JOURNAL_ACCOUNT';
  end if;
  select b.organization_id into v_org from public.branches b where b.id=v_journal_branch;
  if v_org is null then
    raise exception 'PHASE5L_JOURNAL_BRANCH_MISSING_ORGANIZATION';
  end if;
  select oa.id into v_master
  from private.organization_account_branch_links_v2 l
  join private.organization_accounts_v2 oa
    on oa.id=l.organization_account_id and oa.organization_id=l.organization_id
  join public.chart_of_accounts a on a.id=l.branch_account_id
  where l.branch_account_id=new.account_id and l.organization_id=v_org
    and l.branch_id=v_journal_branch and oa.code=a.code
    and oa.account_type=a.account_type and oa.is_system=a.is_system
    and oa.name=a.name and oa.name_en is not distinct from a.name_en
    and oa.is_active=a.is_active;
  insert into private.organization_journal_line_evidence_v2(
    journal_line_id,journal_entry_id,branch_id,organization_id,branch_account_id,
    organization_account_id,mapping_status,debit,credit
  ) values(
    new.id,new.journal_entry_id,v_journal_branch,v_org,new.account_id,
    v_master,
    case when v_master is null then 'UNMAPPED_AT_POSTING' else 'MAPPED_AT_POSTING' end,
    new.debit,new.credit
  );
  return new;
end;
$$;
revoke all on function private.deny_organization_journal_evidence_mutation_v2()
  from public,anon,authenticated,service_role;
revoke all on function private.capture_organization_journal_line_v2()
  from public,anon,authenticated,service_role;

-- Validate existing source integrity before recording 7K+ immutable snapshots.
do $$
begin
  if exists (
    select 1 from public.journal_entry_lines l
    join public.journal_entries j on j.id=l.journal_entry_id
    join public.chart_of_accounts a on a.id=l.account_id
    join public.branches b on b.id=j.branch_id
    where a.branch_id is distinct from j.branch_id or b.organization_id is null
  ) then raise exception 'PHASE5L_HISTORICAL_JOURNAL_SCOPE_INVALID'; end if;
end $$;

insert into private.organization_journal_line_evidence_v2(
 journal_line_id,journal_entry_id,branch_id,organization_id,branch_account_id,
 organization_account_id,mapping_status,debit,credit,historical_bootstrap
)
select l.id,l.journal_entry_id,j.branch_id,b.organization_id,l.account_id,
 oa.id,
 case when oa.id is null then 'UNMAPPED_AT_POSTING' else 'MAPPED_AT_POSTING' end,
 l.debit,l.credit,true
from public.journal_entry_lines l
join public.journal_entries j on j.id=l.journal_entry_id
join public.branches b on b.id=j.branch_id
join public.chart_of_accounts a on a.id=l.account_id
left join private.organization_account_branch_links_v2 al
  on al.branch_account_id=a.id and al.organization_id=b.organization_id
    and al.branch_id=j.branch_id
left join private.organization_accounts_v2 oa
  on oa.id=al.organization_account_id and oa.organization_id=al.organization_id
    and oa.code=a.code and oa.account_type=a.account_type
    and oa.is_system=a.is_system and oa.name=a.name
    and oa.name_en is not distinct from a.name_en
    and oa.is_active=a.is_active;

do $$
begin
  if (select count(*) from private.organization_journal_line_evidence_v2)
     <> (select count(*) from public.journal_entry_lines) then
    raise exception 'PHASE5L_EVIDENCE_BACKFILL_COUNT_MISMATCH';
  end if;
end $$;

create trigger trg_capture_organization_journal_line_v2
after insert on public.journal_entry_lines
for each row execute function private.capture_organization_journal_line_v2();

create view private.organization_journal_evidence_health_v2 as
select e.organization_id,e.branch_id,e.mapping_status,
  count(*)::bigint line_count,
  count(*) filter(where e.organization_account_id is null)::bigint unmapped_count,
  coalesce(sum(e.debit),0)::numeric total_debits,
  coalesce(sum(e.credit),0)::numeric total_credits
from private.organization_journal_line_evidence_v2 e
group by e.organization_id,e.branch_id,e.mapping_status;

create view private.organization_journal_trial_balance_v2 as
select e.organization_id,oa.id organization_account_id,oa.code account_code,
  oa.name account_name,oa.account_type,
  count(*)::bigint line_count,
  sum(e.debit)::numeric debits,sum(e.credit)::numeric credits,
  sum(e.debit-e.credit)::numeric net_debit
from private.organization_journal_line_evidence_v2 e
join private.organization_accounts_v2 oa on oa.id=e.organization_account_id
join public.journal_entries j on j.id=e.journal_entry_id
where e.mapping_status='MAPPED_AT_POSTING' and j.posting_status='POSTED'
group by e.organization_id,oa.id,oa.code,oa.name,oa.account_type;

revoke all on private.organization_journal_evidence_health_v2,
 private.organization_journal_trial_balance_v2 from public,anon,authenticated,service_role;
