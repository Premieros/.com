create or replace function private.assert_accounting_period_postable(
  p_branch_id uuid,
  p_entry_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period_id uuid;
  v_status text;
begin
  v_period_id:=private.ensure_accounting_period_for_date(
    p_branch_id,
    coalesce(p_entry_date,current_date)
  );

  select ap.status
  into v_status
  from public.accounting_periods ap
  where ap.id=v_period_id;

  if v_status is null then
    raise exception 'ACCOUNTING_PERIOD_NOT_FOUND';
  end if;

  if v_status='SOFT_CLOSED' then
    raise exception 'ACCOUNTING_PERIOD_SOFT_CLOSED';
  end if;

  if v_status='CLOSED' then
    raise exception 'ACCOUNTING_PERIOD_CLOSED';
  end if;

  return v_period_id;
end;
$$;

revoke execute on function private.assert_accounting_period_postable(uuid,date)
  from public,anon,authenticated;
grant execute on function private.assert_accounting_period_postable(uuid,date)
  to postgres,service_role;

create or replace function private.assign_journal_posting_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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
    new.period_id:=private.assert_accounting_period_postable(
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

create unique index if not exists journal_entries_one_reversal_idx
  on public.journal_entries(reversal_of)
  where reversal_of is not null;

create or replace function public.set_accounting_period_status(
  p_period_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period public.accounting_periods%rowtype;
  v_target text:=upper(trim(coalesce(p_status,'')));
begin
  if auth.uid() is null then
    return jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  end if;

  if not public.can_permission('accounting.reconciliation.manage') then
    return jsonb_build_object(
      'success',false,
      'error','NOT_ALLOWED',
      'permission','accounting.reconciliation.manage'
    );
  end if;

  if length(trim(coalesce(p_reason,'')))<3 then
    return jsonb_build_object('success',false,'error','REASON_REQUIRED');
  end if;

  if v_target not in ('OPEN','SOFT_CLOSED','CLOSED') then
    return jsonb_build_object('success',false,'error','INVALID_PERIOD_STATUS');
  end if;

  select *
  into v_period
  from public.accounting_periods
  where id=p_period_id
  for update;

  if not found then
    return jsonb_build_object('success',false,'error','PERIOD_NOT_FOUND');
  end if;

  if not public.user_can_access_organization(v_period.organization_id) then
    return jsonb_build_object('success',false,'error','ORGANIZATION_ACCESS_DENIED');
  end if;

  if v_period.status='CLOSED' and v_target<>'CLOSED' then
    return jsonb_build_object(
      'success',false,
      'error','CLOSED_PERIOD_IMMUTABLE',
      'detail','Closed accounting periods cannot be reopened by the ordinary period command.'
    );
  end if;

  if v_period.status=v_target then
    return jsonb_build_object(
      'success',true,
      'already_set',true,
      'period_id',v_period.id,
      'status',v_period.status
    );
  end if;

  update public.accounting_periods
  set status=v_target,
      closed_at=case when v_target='OPEN' then null else clock_timestamp() end,
      closed_by=case when v_target='OPEN' then null else auth.uid() end,
      updated_at=clock_timestamp()
  where id=v_period.id;

  perform public.log_audit_action(
    null,
    'accounting_period_status_change',
    'accounting_period',
    v_period.id,
    jsonb_build_object(
      'organization_id',v_period.organization_id,
      'period_start',v_period.period_start,
      'period_end',v_period.period_end,
      'from_status',v_period.status,
      'to_status',v_target,
      'reason',trim(p_reason)
    )
  );

  return jsonb_build_object(
    'success',true,
    'period_id',v_period.id,
    'previous_status',v_period.status,
    'status',v_target
  );
exception
  when others then
    return jsonb_build_object(
      'success',false,
      'error','TRANSACTION_FAILED',
      'detail',sqlerrm
    );
end;
$$;

revoke execute on function public.set_accounting_period_status(uuid,text,text)
  from public,anon;
grant execute on function public.set_accounting_period_status(uuid,text,text)
  to authenticated,service_role;

create or replace function public.reverse_journal_entry(
  p_entry_id uuid,
  p_reason text,
  p_reversal_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_existing uuid;
  v_reversal_id uuid;
  v_entry_no text;
  v_reversal_date date:=coalesce(p_reversal_date,current_date);
  v_debit numeric:=0;
  v_credit numeric:=0;
begin
  if auth.uid() is null then
    return jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  end if;

  if not public.can_permission('accounting.reconciliation.manage') then
    return jsonb_build_object(
      'success',false,
      'error','NOT_ALLOWED',
      'permission','accounting.reconciliation.manage'
    );
  end if;

  if length(trim(coalesce(p_reason,'')))<3 then
    return jsonb_build_object('success',false,'error','REASON_REQUIRED');
  end if;

  select *
  into v_entry
  from public.journal_entries
  where id=p_entry_id
  for update;

  if not found then
    return jsonb_build_object('success',false,'error','JOURNAL_NOT_FOUND');
  end if;

  if not public.user_may_access_branch(v_entry.branch_id) then
    return jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  end if;

  if v_entry.reference_type='journal_reversal' or v_entry.reversal_of is not null then
    return jsonb_build_object('success',false,'error','REVERSAL_ENTRY_NOT_REVERSIBLE');
  end if;

  select id into v_existing
  from public.journal_entries
  where reversal_of=v_entry.id
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'success',true,
      'already_reversed',true,
      'entry_id',v_entry.id,
      'reversal_entry_id',v_existing
    );
  end if;

  if v_entry.posting_status='REVERSED' then
    return jsonb_build_object('success',false,'error','JOURNAL_ALREADY_REVERSED');
  end if;

  if v_entry.posting_status<>'POSTED' then
    return jsonb_build_object('success',false,'error','JOURNAL_NOT_POSTED');
  end if;

  if v_reversal_date<v_entry.entry_date then
    return jsonb_build_object('success',false,'error','REVERSAL_DATE_BEFORE_ORIGINAL');
  end if;

  perform private.assert_accounting_period_postable(v_entry.branch_id,v_reversal_date);

  select coalesce(sum(debit),0),coalesce(sum(credit),0)
  into v_debit,v_credit
  from public.journal_entry_lines
  where journal_entry_id=v_entry.id;

  if round(v_debit,2)<>round(v_credit,2) or v_debit<=0 then
    return jsonb_build_object('success',false,'error','SOURCE_JOURNAL_UNBALANCED');
  end if;

  v_entry_no:=(public.next_document_number('journal')->>'number')::text;

  insert into public.journal_entries(
    entry_number,branch_id,entry_date,reference_type,reference_id,
    reference_number,description,created_by,posting_status,
    reversal_of,correlation_id
  )
  values(
    v_entry_no,v_entry.branch_id,v_reversal_date,'journal_reversal',
    v_entry.id,v_entry.entry_number,
    'Reversal of '||v_entry.entry_number||': '||trim(p_reason),
    auth.uid(),'POSTED',v_entry.id,v_entry.correlation_id
  )
  returning id into v_reversal_id;

  insert into public.journal_entry_lines(
    journal_entry_id,account_id,debit,credit,customer_id,supplier_id,note
  )
  select
    v_reversal_id,account_id,credit,debit,customer_id,supplier_id,
    'Reversal: '||coalesce(note,'')
  from public.journal_entry_lines
  where journal_entry_id=v_entry.id
  order by id;

  update public.journal_entries
  set posting_status='REVERSED'
  where id=v_entry.id;

  perform public.log_audit_action(
    v_entry.branch_id,
    'journal_reverse',
    'journal_entry',
    v_entry.id,
    jsonb_build_object(
      'entry_number',v_entry.entry_number,
      'reversal_entry_id',v_reversal_id,
      'reversal_entry_number',v_entry_no,
      'reversal_date',v_reversal_date,
      'reason',trim(p_reason),
      'amount',round(v_debit,2)
    )
  );

  return jsonb_build_object(
    'success',true,
    'entry_id',v_entry.id,
    'entry_number',v_entry.entry_number,
    'reversal_entry_id',v_reversal_id,
    'reversal_entry_number',v_entry_no,
    'reversal_date',v_reversal_date
  );
exception
  when unique_violation then
    select id into v_existing
    from public.journal_entries
    where reversal_of=p_entry_id
    limit 1;

    return jsonb_build_object(
      'success',true,
      'already_reversed',true,
      'entry_id',p_entry_id,
      'reversal_entry_id',v_existing
    );
  when others then
    return jsonb_build_object(
      'success',false,
      'error','TRANSACTION_FAILED',
      'detail',sqlerrm
    );
end;
$$;

revoke execute on function public.reverse_journal_entry(uuid,text,date)
  from public,anon;
grant execute on function public.reverse_journal_entry(uuid,text,date)
  to authenticated,service_role;

revoke insert,update,delete,truncate
  on table public.journal_entries
  from authenticated,service_role;

revoke insert,update,delete,truncate
  on table public.journal_entry_lines
  from authenticated,service_role;

drop policy if exists auth_insert_journal_entries on public.journal_entries;
drop policy if exists auth_update_journal_entries on public.journal_entries;
drop policy if exists auth_delete_journal_entries on public.journal_entries;
drop policy if exists auth_insert_journal_entry_lines on public.journal_entry_lines;
drop policy if exists auth_update_journal_entry_lines on public.journal_entry_lines;
drop policy if exists auth_delete_journal_entry_lines on public.journal_entry_lines;
