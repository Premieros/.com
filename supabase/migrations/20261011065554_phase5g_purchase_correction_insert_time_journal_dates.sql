
create or replace function private.apply_journal_timestamp_override()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created text;
  v_entry_date text;
begin
  v_created:=nullif(current_setting('app.journal_created_at_override',true),'');
  v_entry_date:=nullif(current_setting('app.journal_entry_date_override',true),'');

  if v_created is not null then
    new.created_at:=v_created::timestamptz;
  end if;

  if v_entry_date is not null then
    new.entry_date:=v_entry_date::date;
  end if;

  return new;
end;
$$;

create or replace function private.apply_journal_line_timestamp_override()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created text;
begin
  v_created:=nullif(current_setting('app.journal_created_at_override',true),'');

  if v_created is not null then
    new.created_at:=v_created::timestamptz;
  end if;

  return new;
end;
$$;

revoke execute on function private.apply_journal_timestamp_override()
  from public,anon,authenticated;
revoke execute on function private.apply_journal_line_timestamp_override()
  from public,anon,authenticated;
grant execute on function private.apply_journal_timestamp_override()
  to postgres,service_role;
grant execute on function private.apply_journal_line_timestamp_override()
  to postgres,service_role;

drop trigger if exists trg_00_journal_timestamp_override on public.journal_entries;
create trigger trg_00_journal_timestamp_override
before insert on public.journal_entries
for each row
execute function private.apply_journal_timestamp_override();

drop trigger if exists trg_00_journal_line_timestamp_override on public.journal_entry_lines;
create trigger trg_00_journal_line_timestamp_override
before insert on public.journal_entry_lines
for each row
execute function private.apply_journal_line_timestamp_override();

create or replace function public.update_purchase_invoice(
  p_purchase_id uuid,
  p_supplier_id uuid,
  p_warehouse_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_tax_amount numeric,
  p_total numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_purchase public.purchases%rowtype;
  v_return jsonb;
  v_replacement jsonb;
  v_revision_number text;
  v_original_created_at timestamptz;
  v_original_entry_date date;
  v_replacement_id uuid;
  v_tx_timestamp timestamptz:=now();
  v_prev_created_override text;
  v_prev_entry_date_override text;
begin
  if auth.uid() is null then
    return jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  end if;

  if not public.can_permission('purchases.manage') then
    return jsonb_build_object(
      'success',false,'error','NOT_ALLOWED',
      'detail','purchases.manage permission is required.'
    );
  end if;

  select * into v_purchase
  from public.purchases
  where id=p_purchase_id;

  if not found then
    return jsonb_build_object('success',false,'error','PURCHASE_NOT_FOUND');
  end if;

  if not public.user_may_access_branch(v_purchase.branch_id) then
    return jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  end if;

  if v_purchase.status<>'completed' then
    return jsonb_build_object(
      'success',false,
      'error','PURCHASE_EDIT_STATUS_NOT_ALLOWED',
      'detail','Only completed purchase invoices can be corrected here.'
    );
  end if;

  select * into v_purchase
  from public.purchases
  where id=p_purchase_id
  for update;

  if not found then
    return jsonb_build_object('success',false,'error','PURCHASE_NOT_FOUND');
  end if;

  if not public.user_may_access_branch(v_purchase.branch_id) then
    return jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  end if;

  if v_purchase.status<>'completed' then
    return jsonb_build_object(
      'success',false,
      'error','PURCHASE_EDIT_STATUS_NOT_ALLOWED',
      'detail','Only completed purchase invoices can be corrected here.'
    );
  end if;

  select min(p.created_at)
  into v_original_created_at
  from public.purchases p
  where p.branch_id=v_purchase.branch_id
    and (
      p.invoice_number=v_purchase.invoice_number
      or left(
        p.invoice_number,
        length(v_purchase.invoice_number)+5
      )=v_purchase.invoice_number||'-REV-'
    );

  v_original_created_at:=coalesce(
    v_original_created_at,
    v_purchase.created_at
  );

  select je.entry_date
  into v_original_entry_date
  from public.journal_entries je
  join public.purchases p on p.id=je.reference_id
  where je.branch_id=v_purchase.branch_id
    and je.reference_type='purchase'
    and (
      p.invoice_number=v_purchase.invoice_number
      or left(
        p.invoice_number,
        length(v_purchase.invoice_number)+5
      )=v_purchase.invoice_number||'-REV-'
    )
  order by p.created_at asc,je.created_at asc
  limit 1;

  v_original_entry_date:=coalesce(
    v_original_entry_date,
    (v_original_created_at at time zone 'Africa/Cairo')::date
  );

  if p_supplier_id is null then
    return jsonb_build_object('success',false,'error','SUPPLIER_REQUIRED');
  end if;

  if p_items is null
     or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)=0 then
    return jsonb_build_object(
      'success',false,'error','PURCHASE_ITEMS_REQUIRED'
    );
  end if;

  if p_total is null
     or p_total<0
     or p_subtotal is null
     or p_subtotal<0 then
    return jsonb_build_object('success',false,'error','INVALID_TOTAL');
  end if;

  if p_warehouse_id is not null
     and not exists(
       select 1
       from public.warehouses w
       where w.id=p_warehouse_id
         and w.branch_id=v_purchase.branch_id
     ) then
    return jsonb_build_object(
      'success',false,'error','WAREHOUSE_BRANCH_MISMATCH'
    );
  end if;

  v_prev_created_override:=current_setting(
    'app.journal_created_at_override',
    true
  );
  v_prev_entry_date_override:=current_setting(
    'app.journal_entry_date_override',
    true
  );

  perform set_config(
    'app.journal_created_at_override',
    v_original_created_at::text,
    true
  );
  perform set_config(
    'app.journal_entry_date_override',
    v_original_entry_date::text,
    true
  );

  v_return:=public.process_purchase_return(
    p_purchase_id=>p_purchase_id,
    p_items=>null,
    p_reason=>'Purchase invoice corrected'
  );

  if coalesce((v_return->>'success')::boolean,false) is not true then
    raise exception using
      message=coalesce(
        v_return->>'detail',
        v_return->>'error',
        'PURCHASE_REVERSAL_FAILED'
      ),
      errcode='P0001';
  end if;

  v_revision_number:=
    v_purchase.invoice_number
    ||'-REV-'
    ||substr(replace(p_purchase_id::text,'-',''),1,8);

  update public.purchases
  set invoice_number=v_revision_number
  where id=p_purchase_id;

  v_replacement:=public.process_purchase(
    p_invoice_number=>v_purchase.invoice_number,
    p_supplier_id=>p_supplier_id,
    p_branch_id=>v_purchase.branch_id,
    p_warehouse_id=>p_warehouse_id,
    p_subtotal=>p_subtotal,
    p_discount_amount=>coalesce(p_discount_amount,0),
    p_tax_amount=>coalesce(p_tax_amount,0),
    p_total=>p_total,
    p_paid_amount=>coalesce(p_paid_amount,0),
    p_payment_method=>p_payment_method,
    p_status=>'completed',
    p_notes=>p_notes,
    p_items=>p_items
  );

  if coalesce((v_replacement->>'success')::boolean,false) is not true then
    raise exception using
      message=coalesce(
        v_replacement->>'detail',
        v_replacement->>'error',
        'PURCHASE_REPLACEMENT_FAILED'
      ),
      errcode='P0001';
  end if;

  v_replacement_id:=(v_replacement->>'purchase_id')::uuid;

  perform set_config(
    'app.journal_created_at_override',
    coalesce(v_prev_created_override,''),
    true
  );
  perform set_config(
    'app.journal_entry_date_override',
    coalesce(v_prev_entry_date_override,''),
    true
  );

  update public.purchases
  set created_at=v_original_created_at
  where id=v_replacement_id;

  update public.purchase_items
  set created_at=v_original_created_at
  where purchase_id=v_replacement_id;

  update public.inventory_batches
  set created_at=v_original_created_at
  where source_type='purchase'
    and source_id=v_replacement_id;

  update public.raw_material_batches
  set created_at=v_original_created_at
  where source_type='purchase'
    and source_id=v_replacement_id;

  update public.inventory_ledger
  set created_at=v_original_created_at
  where (
      reference_type='purchase'
      and reference_id=v_replacement_id
    )
    or (
      reference_type='purchase_return'
      and reference_id=p_purchase_id
      and created_at=v_tx_timestamp
    );

  insert into public.audit_log(
    user_id,action,entity,entity_id,details,branch_id
  )
  values(
    auth.uid(),
    'update',
    'purchase',
    coalesce(
      (v_replacement->>'purchase_id')::uuid,
      p_purchase_id
    ),
    jsonb_build_object(
      'previous_purchase_id',p_purchase_id,
      'previous_revision_number',v_revision_number,
      'invoice_number',v_purchase.invoice_number,
      'transactional_reversal',true,
      'original_document_created_at',v_original_created_at,
      'original_entry_date',v_original_entry_date,
      'journal_dates_assigned_at_insert',true
    ),
    v_purchase.branch_id
  );

  return jsonb_build_object(
    'success',true,
    'purchase_id',v_replacement->>'purchase_id',
    'previous_purchase_id',p_purchase_id,
    'invoice_number',v_purchase.invoice_number,
    'previous_revision_number',v_revision_number,
    'journal_dates_assigned_at_insert',true
  );
end;
$function$;

revoke all on function public.update_purchase_invoice(
  uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb
) from public,anon;
grant execute on function public.update_purchase_invoice(
  uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb
) to authenticated,service_role;

update private.journal_mutation_registry
set active=false,
    remediation='Resolved in Phase 5G: journal dates are assigned by BEFORE INSERT override triggers during the same purchase-correction transaction.'
where function_signature=
  'update_purchase_invoice(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb)';
