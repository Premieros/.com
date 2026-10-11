
create table if not exists private.sale_payment_method_changes (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  old_method text not null,
  new_method text not null,
  amount numeric(18,2) not null check (amount>=0),
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  reason text,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists sale_payment_method_changes_sale_idx
  on private.sale_payment_method_changes(sale_id,created_at desc);

alter table private.sale_payment_method_changes enable row level security;
revoke all on table private.sale_payment_method_changes from public,anon,authenticated;
revoke insert,update,delete on table private.sale_payment_method_changes from service_role;
grant select on table private.sale_payment_method_changes to service_role;

create or replace function public.change_sale_payment_method(
  p_sale_id uuid,
  p_new_method text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_sale record;
  v_role text;
  v_user_branch uuid;
  v_approval_id uuid;
  v_old_account uuid;
  v_new_account uuid;
  v_old_key text;
  v_new_key text;
  v_changed integer:=0;
  v_change_id uuid;
  v_journal_id uuid;
  v_amount numeric(18,2);
  v_lines jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('success',false,'error','UNAUTHENTICATED');
  end if;

  p_new_method:=lower(btrim(coalesce(p_new_method,'')));

  if p_new_method not in ('cash','card','transfer') then
    return jsonb_build_object(
      'success',false,
      'error','UNSUPPORTED_PAYMENT_METHOD',
      'detail','Only cash, card and transfer can be corrected after sale. Credit requires a receivables workflow.'
    );
  end if;

  select id,branch_id,payment_method,paid_amount,status,invoice_number
  into v_sale
  from public.sales
  where id=p_sale_id
  for update;

  if v_sale.id is null then
    return jsonb_build_object('success',false,'error','SALE_NOT_FOUND');
  end if;

  if v_sale.status='returned' then
    return jsonb_build_object('success',false,'error','SALE_RETURNED');
  end if;

  if lower(coalesce(v_sale.payment_method,'')) not in ('cash','card','transfer') then
    return jsonb_build_object(
      'success',false,
      'error','CURRENT_PAYMENT_METHOD_NOT_RECLASSIFIABLE',
      'payment_method',v_sale.payment_method
    );
  end if;

  select role,branch_id
  into v_role,v_user_branch
  from public.users
  where id=v_uid and is_active;

  if v_role is null then
    return jsonb_build_object('success',false,'error','USER_NOT_FOUND');
  end if;

  if not public.is_pos_admin()
     and v_user_branch is not null
     and v_user_branch<>v_sale.branch_id then
    return jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  end if;

  if lower(v_sale.payment_method)=p_new_method then
    return jsonb_build_object(
      'success',true,
      'sale_id',p_sale_id,
      'payment_method',p_new_method,
      'unchanged',true
    );
  end if;

  if not public.can_permission('approvals.override') then
    select ar.id
    into v_approval_id
    from public.approval_requests ar
    where ar.requester_id=v_uid
      and ar.branch_id=v_sale.branch_id
      and ar.action_type='change_payment_method'
      and ar.entity_type='sale'
      and ar.entity_id=p_sale_id
      and ar.status='approved'
      and ar.consumed_at is null
      and ar.expires_at>now()
      and lower(coalesce(ar.payload->>'new_method',''))=p_new_method
    order by ar.decided_at desc nulls last,ar.created_at desc
    limit 1
    for update skip locked;

    if v_approval_id is null then
      return jsonb_build_object(
        'success',false,
        'error','APPROVAL_REQUIRED',
        'action_type','change_payment_method',
        'entity_type','sale',
        'entity_id',p_sale_id,
        'new_method',p_new_method
      );
    end if;
  end if;

  v_old_key:=case
    when lower(v_sale.payment_method)='cash' then 'cash'
    else 'bank'
  end;

  v_new_key:=case
    when p_new_method='cash' then 'cash'
    else 'bank'
  end;

  v_amount:=round(greatest(coalesce(v_sale.paid_amount,0),0),2);

  if v_amount>0 and v_old_key<>v_new_key then
    v_old_account:=public.resolve_account_key(v_sale.branch_id,v_old_key);
    v_new_account:=public.resolve_account_key(v_sale.branch_id,v_new_key);

    if v_old_account is null or v_new_account is null then
      return jsonb_build_object(
        'success',false,
        'error','PAYMENT_ACCOUNT_MAPPING_MISSING'
      );
    end if;

    insert into private.sale_payment_method_changes(
      sale_id,branch_id,old_method,new_method,amount,reason,changed_by
    )
    values(
      p_sale_id,
      v_sale.branch_id,
      lower(v_sale.payment_method),
      p_new_method,
      v_amount,
      nullif(btrim(coalesce(p_reason,'')),''),
      v_uid
    )
    returning id into v_change_id;

    v_lines:=jsonb_build_array(
      jsonb_build_object(
        'account_code',(select code from public.chart_of_accounts where id=v_new_account),
        'debit',v_amount,
        'credit',0,
        'note','Payment method reclassification '||coalesce(v_sale.invoice_number,p_sale_id::text)
      ),
      jsonb_build_object(
        'account_code',(select code from public.chart_of_accounts where id=v_old_account),
        'debit',0,
        'credit',v_amount,
        'note','Payment method reclassification '||coalesce(v_sale.invoice_number,p_sale_id::text)
      )
    );

    v_journal_id:=public._post_journal_entry(
      v_sale.branch_id,
      'sale_payment_method_change',
      v_change_id,
      v_sale.invoice_number,
      'Payment method changed from '
        ||lower(v_sale.payment_method)
        ||' to '
        ||p_new_method
        ||case
            when nullif(btrim(coalesce(p_reason,'')),'') is not null
            then ': '||btrim(p_reason)
            else ''
          end,
      v_lines
    );

    update private.sale_payment_method_changes
    set journal_entry_id=v_journal_id
    where id=v_change_id;
  else
    insert into private.sale_payment_method_changes(
      sale_id,branch_id,old_method,new_method,amount,reason,changed_by
    )
    values(
      p_sale_id,
      v_sale.branch_id,
      lower(v_sale.payment_method),
      p_new_method,
      v_amount,
      nullif(btrim(coalesce(p_reason,'')),''),
      v_uid
    )
    returning id into v_change_id;
  end if;

  update public.sales
  set payment_method=p_new_method,
      notes=case
        when p_reason is null or btrim(p_reason)='' then notes
        else concat_ws(
          E'\n',
          nullif(notes,''),
          'Payment method changed: '||p_reason
        )
      end
  where id=p_sale_id;

  update public.shift_operations
  set payment_method=p_new_method
  where operation_type='sale'
    and reference_type='sale'
    and reference_id=p_sale_id;

  get diagnostics v_changed=row_count;

  if v_approval_id is not null then
    update public.approval_requests
    set status='consumed',consumed_at=now()
    where id=v_approval_id
      and requester_id=v_uid
      and action_type='change_payment_method'
      and entity_type='sale'
      and entity_id=p_sale_id
      and status='approved'
      and consumed_at is null
      and expires_at>now();

    if not found then
      raise exception 'CHANGE_PAYMENT_APPROVAL_CONSUME_FAILED';
    end if;
  end if;

  perform public.log_audit_action(
    v_sale.branch_id,
    'change_payment_method',
    'sale',
    p_sale_id,
    jsonb_build_object(
      'invoice_number',v_sale.invoice_number,
      'old_method',v_sale.payment_method,
      'new_method',p_new_method,
      'reason',p_reason,
      'shift_rows_updated',v_changed,
      'change_id',v_change_id,
      'reclassification_journal_id',v_journal_id,
      'append_only_accounting',true
    )
  );

  return jsonb_build_object(
    'success',true,
    'sale_id',p_sale_id,
    'old_method',v_sale.payment_method,
    'payment_method',p_new_method,
    'change_id',v_change_id,
    'reclassification_journal_id',v_journal_id,
    'append_only_accounting',true
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

update private.journal_mutation_registry
set active=false,
    remediation='Resolved in Phase 5D with append-only sale_payment_method_change journals.'
where function_signature='change_sale_payment_method(uuid,text,text)';
