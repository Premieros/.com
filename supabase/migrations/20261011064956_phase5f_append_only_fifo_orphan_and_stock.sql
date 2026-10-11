
drop index if exists public.uq_journal_reference;
create unique index uq_journal_reference
  on public.journal_entries(reference_type,reference_id)
  where reference_id is not null
    and reference_type not in ('fifo_cogs_reconcile','fifo_stock_reconcile');

create or replace function private.post_fifo_orphan_sale_cogs_event(
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
    'ORPHAN_SALE_COGS',p_branch_id,'orphan_sale',p_sale_id,p_exact_delta,
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
    'FIFO orphan sale COGS adjustment '
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
    v_amount,0,'FIFO orphan COGS append-only adjustment'
  ),
  (
    v_journal_id,
    case when p_posted_delta>0 then p_inventory_account else p_cogs_account end,
    0,v_amount,'FIFO orphan inventory append-only adjustment'
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

revoke execute on function private.post_fifo_orphan_sale_cogs_event(
  uuid,uuid,text,date,numeric,numeric,numeric,uuid,uuid,uuid
) from public,anon,authenticated;
grant execute on function private.post_fifo_orphan_sale_cogs_event(
  uuid,uuid,text,date,numeric,numeric,numeric,uuid,uuid,uuid
) to postgres,service_role;

create or replace function public._fifo_adjust_orphan_sale_cogs_delta(
  p_sale_id uuid,
  p_branch_id uuid,
  p_delta numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base_entry public.journal_entries%rowtype;
  v_base_count integer:=0;
  v_row public.raw_fifo_orphan_sale_cogs_adjustments%rowtype;
  v_target_posted numeric(18,2);
  v_post_delta numeric(18,2);
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_base_cogs numeric(18,6):=0;
  v_event jsonb;
begin
  if p_sale_id is null or p_branch_id is null or coalesce(p_delta,0)=0 then
    return jsonb_build_object('success',true,'posted_delta',0);
  end if;

  if exists(select 1 from public.sales where id=p_sale_id) then
    return jsonb_build_object(
      'success',false,'error','FIFO_ORPHAN_SALE_HEADER_STILL_EXISTS','sale_id',p_sale_id
    );
  end if;

  select count(*)
  into v_base_count
  from public.journal_entries je
  where je.branch_id=p_branch_id
    and je.reference_type='sale'
    and je.reference_id=p_sale_id;

  if v_base_count<>1 then
    return jsonb_build_object(
      'success',false,
      'error','FIFO_ORPHAN_SALE_JOURNAL_AMBIGUOUS',
      'sale_id',p_sale_id,
      'branch_id',p_branch_id,
      'journal_matches',v_base_count
    );
  end if;

  select *
  into v_base_entry
  from public.journal_entries je
  where je.branch_id=p_branch_id
    and je.reference_type='sale'
    and je.reference_id=p_sale_id
  limit 1
  for share;

  if exists(
    select 1 from public.raw_fifo_sale_cogs_adjustments where sale_id=p_sale_id
  ) then
    return jsonb_build_object(
      'success',false,
      'error','FIFO_ORPHAN_SALE_NORMAL_ADJUSTMENT_EXISTS',
      'sale_id',p_sale_id
    );
  end if;

  select account_id into v_cogs_account
  from public.account_mappings
  where branch_id=p_branch_id and semantic_key='cogs';

  select account_id into v_inventory_account
  from public.account_mappings
  where branch_id=p_branch_id and semantic_key='inventory_fg';

  if v_cogs_account is null or v_inventory_account is null then
    return jsonb_build_object(
      'success',false,
      'error','FIFO_ORPHAN_SALE_ACCOUNT_MAPPING_MISSING',
      'branch_id',p_branch_id
    );
  end if;

  select coalesce(sum(jl.debit-jl.credit),0)
  into v_base_cogs
  from public.journal_entry_lines jl
  where jl.journal_entry_id=v_base_entry.id
    and jl.account_id=v_cogs_account;

  insert into public.raw_fifo_orphan_sale_cogs_adjustments(
    sale_id,branch_id,exact_delta,posted_delta
  )
  values(p_sale_id,p_branch_id,p_delta,0)
  on conflict(sale_id) do update
  set exact_delta=public.raw_fifo_orphan_sale_cogs_adjustments.exact_delta
      +excluded.exact_delta,
      updated_at=now()
  returning * into v_row;

  if v_row.branch_id is distinct from p_branch_id then
    raise exception
      'FIFO_ORPHAN_SALE_BRANCH_MISMATCH sale=% existing=% requested=%',
      p_sale_id,v_row.branch_id,p_branch_id;
  end if;

  if v_base_cogs+v_row.exact_delta < -0.005 then
    raise exception
      'FIFO_ORPHAN_SALE_COGS_NEGATIVE sale=% base=% delta=%',
      p_sale_id,v_base_cogs,v_row.exact_delta;
  end if;

  v_target_posted:=round(v_row.exact_delta,2);
  v_post_delta:=v_target_posted-v_row.posted_delta;

  if v_post_delta=0 then
    return jsonb_build_object(
      'success',true,
      'exact_delta',v_row.exact_delta,
      'posted_delta',v_row.posted_delta,
      'orphan_sale',true,
      'append_only',true
    );
  end if;

  v_event:=private.post_fifo_orphan_sale_cogs_event(
    p_sale_id,p_branch_id,v_base_entry.reference_number,v_base_entry.entry_date,
    p_delta,v_post_delta,v_target_posted,v_cogs_account,v_inventory_account,
    v_base_entry.correlation_id
  );

  if coalesce((v_event->>'success')::boolean,false) is not true then
    raise exception 'FIFO_ORPHAN_APPEND_ONLY_EVENT_FAILED: %',v_event;
  end if;

  update public.raw_fifo_orphan_sale_cogs_adjustments
  set posted_delta=v_target_posted,
      journal_entry_id=case when v_target_posted=0 then null else journal_entry_id end,
      updated_at=now()
  where sale_id=p_sale_id;

  return jsonb_build_object(
    'success',true,
    'exact_delta',v_row.exact_delta,
    'posted_delta',v_target_posted,
    'posted_increment',v_post_delta,
    'event_id',v_event->>'event_id',
    'journal_entry_id',v_event->>'journal_entry_id',
    'base_sale_journal_id',v_base_entry.id,
    'orphan_sale',true,
    'append_only',true
  );
end;
$$;

create or replace function private.post_fifo_stock_variance_event(
  p_branch_id uuid,
  p_business_reference_type text,
  p_business_reference_id uuid,
  p_reference_number text,
  p_preferred_date date,
  p_exact_delta numeric,
  p_posted_delta numeric,
  p_target_posted_delta numeric,
  p_inventory_account uuid,
  p_variance_account uuid
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
  if p_branch_id is null or p_business_reference_id is null or v_amount<=0 then
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
    'STOCK_VARIANCE',
    p_branch_id,
    coalesce(p_business_reference_type,'stock'),
    p_business_reference_id,
    p_exact_delta,
    round(p_posted_delta,2),
    round(p_target_posted_delta,2),
    auth.uid()
  )
  returning id into v_event_id;

  v_entry_number:=(public.next_document_number('journal')->>'number')::text;

  insert into public.journal_entries(
    entry_number,branch_id,entry_date,reference_type,reference_id,
    reference_number,description,created_by,source_event_id
  )
  values(
    v_entry_number,
    p_branch_id,
    v_entry_date,
    'fifo_stock_reconcile',
    p_business_reference_id,
    p_reference_number,
    'FIFO stock valuation adjustment '
      ||coalesce(p_reference_number,p_business_reference_id::text)
      ||' · delta '
      ||round(p_posted_delta,2)::text,
    auth.uid(),
    v_event_id
  )
  returning id into v_journal_id;

  insert into public.journal_entry_lines(
    journal_entry_id,account_id,debit,credit,note
  )
  values
  (
    v_journal_id,
    case when p_posted_delta>0 then p_variance_account else p_inventory_account end,
    v_amount,0,'FIFO stock variance append-only adjustment'
  ),
  (
    v_journal_id,
    case when p_posted_delta>0 then p_inventory_account else p_variance_account end,
    0,v_amount,'FIFO raw inventory append-only adjustment'
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

revoke execute on function private.post_fifo_stock_variance_event(
  uuid,text,uuid,text,date,numeric,numeric,numeric,uuid,uuid
) from public,anon,authenticated;
grant execute on function private.post_fifo_stock_variance_event(
  uuid,text,uuid,text,date,numeric,numeric,numeric,uuid,uuid
) to postgres,service_role;

create or replace function public._fifo_adjust_stock_variance_delta(
  p_branch_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_entry_date date,
  p_delta numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.raw_fifo_stock_adjustments%rowtype;
  v_target numeric(18,2);
  v_post_delta numeric(18,2);
  v_inventory_account uuid;
  v_variance_account uuid;
  v_event jsonb;
begin
  if p_branch_id is null or p_reference_id is null or coalesce(p_delta,0)=0 then
    return jsonb_build_object('success',true,'posted_delta',0);
  end if;

  insert into public.raw_fifo_stock_adjustments(
    branch_id,reference_type,reference_id,exact_delta,posted_delta
  )
  values(p_branch_id,p_reference_type,p_reference_id,p_delta,0)
  on conflict(branch_id,reference_type,reference_id) do update
  set exact_delta=public.raw_fifo_stock_adjustments.exact_delta+excluded.exact_delta,
      updated_at=now()
  returning * into v_row;

  v_target:=round(v_row.exact_delta,2);
  v_post_delta:=v_target-v_row.posted_delta;

  if v_post_delta=0 then
    return jsonb_build_object(
      'success',true,
      'exact_delta',v_row.exact_delta,
      'posted_delta',v_row.posted_delta,
      'append_only',true
    );
  end if;

  select account_id into v_inventory_account
  from public.account_mappings
  where branch_id=p_branch_id and semantic_key='inventory_rm';

  select account_id into v_variance_account
  from public.account_mappings
  where branch_id=p_branch_id and semantic_key='stock_variance';

  if v_inventory_account is null or v_variance_account is null then
    raise exception 'FIFO_STOCK_ACCOUNT_MAPPING_MISSING branch=%',p_branch_id;
  end if;

  v_event:=private.post_fifo_stock_variance_event(
    p_branch_id,p_reference_type,p_reference_id,p_reference_number,p_entry_date,
    p_delta,v_post_delta,v_target,v_inventory_account,v_variance_account
  );

  if coalesce((v_event->>'success')::boolean,false) is not true then
    raise exception 'FIFO_STOCK_APPEND_ONLY_EVENT_FAILED: %',v_event;
  end if;

  update public.raw_fifo_stock_adjustments
  set posted_delta=v_target,
      journal_entry_id=case when v_target=0 then null else journal_entry_id end,
      updated_at=now()
  where branch_id=p_branch_id
    and reference_type=p_reference_type
    and reference_id=p_reference_id;

  return jsonb_build_object(
    'success',true,
    'exact_delta',v_row.exact_delta,
    'posted_delta',v_target,
    'posted_increment',v_post_delta,
    'event_id',v_event->>'event_id',
    'journal_entry_id',v_event->>'journal_entry_id',
    'append_only',true
  );
end;
$$;

update private.journal_mutation_registry
set active=false,
    remediation=case
      when function_signature='_fifo_adjust_orphan_sale_cogs_delta(uuid,uuid,numeric)'
        then 'Resolved in Phase 5F with append-only orphan-sale COGS events.'
      else 'Resolved in Phase 5F with append-only stock variance events.'
    end
where function_signature in (
  '_fifo_adjust_orphan_sale_cogs_delta(uuid,uuid,numeric)',
  '_fifo_adjust_stock_variance_delta(uuid,text,uuid,text,date,numeric)'
);
