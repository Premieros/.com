
create table if not exists private.fifo_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  adjustment_kind text not null check (adjustment_kind in ('SALE_COGS','ORPHAN_SALE_COGS','STOCK_VARIANCE')),
  branch_id uuid not null references public.branches(id) on delete cascade,
  business_reference_type text not null,
  business_reference_id uuid not null,
  exact_delta numeric(18,6) not null,
  posted_delta numeric(18,2) not null,
  target_posted_delta numeric(18,2) not null,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists fifo_reconciliation_events_reference_idx
  on private.fifo_reconciliation_events(adjustment_kind,business_reference_id,created_at);

alter table private.fifo_reconciliation_events enable row level security;
revoke all on table private.fifo_reconciliation_events from public,anon,authenticated;
revoke insert,update,delete on table private.fifo_reconciliation_events from service_role;
grant select on table private.fifo_reconciliation_events to service_role;

drop index if exists public.uq_journal_reference;
create unique index uq_journal_reference
  on public.journal_entries(reference_type,reference_id)
  where reference_id is not null
    and reference_type <> 'fifo_cogs_reconcile';

create unique index if not exists journal_entries_source_event_unique_idx
  on public.journal_entries(source_event_id)
  where source_event_id is not null;

create or replace function private.post_fifo_sale_cogs_event(
  p_sale_id uuid,
  p_branch_id uuid,
  p_reference_number text,
  p_preferred_date date,
  p_exact_delta numeric,
  p_posted_delta numeric,
  p_target_posted_delta numeric,
  p_cogs_account uuid,
  p_inventory_account uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_entry_date date;
  v_period_status text;
  v_amount numeric(18,2):=abs(round(coalesce(p_posted_delta,0),2));
begin
  if p_sale_id is null or p_branch_id is null or v_amount<=0 then
    return jsonb_build_object('success',true,'posted_delta',0);
  end if;

  select ap.status
  into v_period_status
  from public.branches b
  join public.accounting_periods ap
    on ap.organization_id=b.organization_id
   and ap.period_start=date_trunc(
     'month',
     coalesce(p_preferred_date,current_date)::timestamptz
   )::date
  where b.id=p_branch_id;

  if v_period_status='OPEN' then
    v_entry_date:=coalesce(p_preferred_date,current_date);
  else
    v_entry_date:=current_date;
  end if;

  perform private.assert_accounting_period_postable(p_branch_id,v_entry_date);

  insert into private.fifo_reconciliation_events(
    adjustment_kind,branch_id,business_reference_type,business_reference_id,
    exact_delta,posted_delta,target_posted_delta,created_by
  )
  values(
    'SALE_COGS',p_branch_id,'sale',p_sale_id,p_exact_delta,
    round(p_posted_delta,2),round(p_target_posted_delta,2),auth.uid()
  )
  returning id into v_event_id;

  v_entry_number:=(public.next_document_number('journal')->>'number')::text;

  insert into public.journal_entries(
    entry_number,branch_id,entry_date,reference_type,reference_id,
    reference_number,description,created_by,source_event_id,correlation_id
  )
  values(
    v_entry_number,p_branch_id,v_entry_date,'fifo_cogs_reconcile',p_sale_id,
    p_reference_number,
    'FIFO COGS adjustment '
      ||coalesce(p_reference_number,p_sale_id::text)
      ||' · delta '
      ||round(p_posted_delta,2)::text,
    auth.uid(),v_event_id,p_correlation_id
  )
  returning id into v_journal_id;

  insert into public.journal_entry_lines(
    journal_entry_id,account_id,debit,credit,note
  )
  values
  (
    v_journal_id,
    case when p_posted_delta>0 then p_cogs_account else p_inventory_account end,
    v_amount,0,'FIFO COGS append-only adjustment'
  ),
  (
    v_journal_id,
    case when p_posted_delta>0 then p_inventory_account else p_cogs_account end,
    0,v_amount,'FIFO inventory append-only adjustment'
  );

  update private.fifo_reconciliation_events
  set journal_entry_id=v_journal_id
  where id=v_event_id;

  return jsonb_build_object(
    'success',true,
    'event_id',v_event_id,
    'journal_entry_id',v_journal_id,
    'entry_date',v_entry_date,
    'posted_delta',round(p_posted_delta,2)
  );
end;
$$;

revoke execute on function private.post_fifo_sale_cogs_event(
  uuid,uuid,text,date,numeric,numeric,numeric,uuid,uuid,uuid
) from public,anon,authenticated;
grant execute on function private.post_fifo_sale_cogs_event(
  uuid,uuid,text,date,numeric,numeric,numeric,uuid,uuid,uuid
) to postgres,service_role;

create or replace function public._fifo_adjust_sale_cogs_delta(
  p_sale_id uuid,
  p_delta numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.sales%rowtype;
  v_row public.raw_fifo_sale_cogs_adjustments%rowtype;
  v_target_posted numeric(18,2);
  v_post_delta numeric(18,2);
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_base_cogs numeric(18,6):=0;
  v_correlation_id uuid;
  v_event jsonb;
begin
  if p_sale_id is null or coalesce(p_delta,0)=0 then
    return jsonb_build_object('success',true,'posted_delta',0);
  end if;

  select *
  into v_sale
  from public.sales
  where id=p_sale_id
  for share;

  if v_sale.id is null then
    return jsonb_build_object('success',false,'error','FIFO_SALE_NOT_FOUND');
  end if;

  select
    coalesce(sum(jl.debit-jl.credit),0),
    (array_agg(je.correlation_id order by je.created_at,je.id))[1]
  into v_base_cogs,v_correlation_id
  from public.journal_entries je
  join public.account_mappings am
    on am.branch_id=v_sale.branch_id and am.semantic_key='cogs'
  join public.journal_entry_lines jl
    on jl.journal_entry_id=je.id and jl.account_id=am.account_id
  where je.branch_id=v_sale.branch_id
    and je.reference_id=v_sale.id
    and je.reference_type='sale';

  insert into public.raw_fifo_sale_cogs_adjustments(
    sale_id,branch_id,exact_delta,posted_delta
  )
  values(v_sale.id,v_sale.branch_id,p_delta,0)
  on conflict(sale_id) do update
  set exact_delta=public.raw_fifo_sale_cogs_adjustments.exact_delta+excluded.exact_delta,
      updated_at=now()
  returning * into v_row;

  if v_base_cogs+v_row.exact_delta < -0.005 then
    raise exception 'FIFO_SALE_COGS_NEGATIVE sale=% base=% delta=%',
      v_sale.id,v_base_cogs,v_row.exact_delta;
  end if;

  v_target_posted:=round(v_row.exact_delta,2);
  v_post_delta:=v_target_posted-v_row.posted_delta;

  if v_post_delta=0 then
    return jsonb_build_object(
      'success',true,
      'exact_delta',v_row.exact_delta,
      'posted_delta',v_row.posted_delta,
      'append_only',true
    );
  end if;

  select account_id into v_cogs_account
  from public.account_mappings
  where branch_id=v_sale.branch_id and semantic_key='cogs';

  select account_id into v_inventory_account
  from public.account_mappings
  where branch_id=v_sale.branch_id and semantic_key='inventory_fg';

  if v_cogs_account is null or v_inventory_account is null then
    raise exception 'FIFO_ACCOUNT_MAPPING_MISSING branch=%',v_sale.branch_id;
  end if;

  v_event:=private.post_fifo_sale_cogs_event(
    v_sale.id,
    v_sale.branch_id,
    v_sale.invoice_number,
    (v_sale.created_at at time zone 'Africa/Cairo')::date,
    p_delta,
    v_post_delta,
    v_target_posted,
    v_cogs_account,
    v_inventory_account,
    v_correlation_id
  );

  if coalesce((v_event->>'success')::boolean,false) is not true then
    raise exception 'FIFO_APPEND_ONLY_EVENT_FAILED: %',v_event;
  end if;

  update public.raw_fifo_sale_cogs_adjustments
  set posted_delta=v_target_posted,
      journal_entry_id=case
        when v_target_posted=0 then null
        else journal_entry_id
      end,
      updated_at=now()
  where sale_id=v_sale.id;

  return jsonb_build_object(
    'success',true,
    'exact_delta',v_row.exact_delta,
    'posted_delta',v_target_posted,
    'posted_increment',v_post_delta,
    'event_id',v_event->>'event_id',
    'journal_entry_id',v_event->>'journal_entry_id',
    'append_only',true
  );
end;
$$;

update private.journal_mutation_registry
set active=false,
    remediation='Resolved in Phase 5E with append-only FIFO COGS adjustment events.'
where function_signature='_fifo_adjust_sale_cogs_delta(uuid,numeric)';
