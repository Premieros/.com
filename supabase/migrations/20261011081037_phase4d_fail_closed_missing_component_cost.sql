-- Phase 4D: fail closed when the immutable component evidence is incomplete.
-- Preserve partial calculated amounts in the JSON basis, not as historical complete cost.
-- Only future INSERTs are affected; no backfill, no user-table schema changes.
create or replace function private.capture_sale_item_cost_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_branch_id uuid;
  v_capture_at timestamptz:=coalesce(new.created_at,clock_timestamp());
  v_snapshot jsonb;
begin
  if new.product_id is null or coalesce(new.quantity,0)<=0 then
    return new;
  end if;

  select s.branch_id
  into v_branch_id
  from public.sales s
  where s.id=new.sale_id;

  if v_branch_id is null then
    return new;
  end if;

  v_snapshot:=private.compute_sale_item_cost_snapshot(
    new.product_id,
    v_branch_id,
    coalesce(new.modifier_option_ids,'{}'::uuid[]),
    new.quantity,
    v_capture_at
  );
  -- Evidence augments (never recalculates) the established immutable cost.
  -- A detail-capture fault must not alter the existing successful sale snapshot.
  begin
    v_snapshot := v_snapshot || jsonb_build_object(
      'component_cost_evidence',
      private.compute_sale_item_component_evidence(
        new.product_id, v_branch_id,
        coalesce(new.modifier_option_ids,'{}'::uuid[]),
        nullif(v_snapshot->>'base_theoretical_unit_cost','')::numeric,
        coalesce((v_snapshot->>'modifier_theoretical_unit_delta')::numeric,0)
      )
    );
  exception when others then
    v_snapshot := v_snapshot || jsonb_build_object(
      'component_cost_evidence',
      jsonb_build_object('status','CAPTURE_ERROR','schema_version',1)
    );
  end;

  -- Missing-priced BOM/effect lines cannot be reported as COMPLETE theoretical cost.
  -- Retain the formerly calculated amount as *partial* evidence, without mutating
  -- any historical rows or changing POS/FIFO/journal writers.
  if coalesce(v_snapshot->'component_cost_evidence'->>'status','CAPTURE_ERROR') in
    ('MISSING_COMPONENT_REFERENCE_COST','MISSING_MODIFIER_REFERENCE_COST',
     'COST_MISMATCH','CAPTURE_ERROR') then
    v_snapshot := v_snapshot || jsonb_build_object(
      'theoretical_partial_unit_cost',v_snapshot->'theoretical_unit_cost',
      'theoretical_partial_total_cost',v_snapshot->'theoretical_total_cost',
      'missing_input_reason',v_snapshot->'component_cost_evidence'->>'status',
      'status','MISSING_INPUT',
      'theoretical_unit_cost',null::numeric,
      'theoretical_total_cost',null::numeric
    );
  end if;

  insert into private.sale_item_cost_snapshots(
    sale_item_id,sale_id,branch_id,product_id,sale_quantity,
    theoretical_unit_cost,theoretical_total_cost,
    standard_unit_cost,standard_total_cost,theoretical_status,
    recipe_id,recipe_version,modifier_theoretical_unit_delta,
    modifier_effect_count,missing_modifier_cost_count,
    selected_modifier_option_ids,costing_model_version,basis,captured_at
  )
  values(
    new.id,new.sale_id,v_branch_id,new.product_id,new.quantity,
    nullif(v_snapshot->>'theoretical_unit_cost','')::numeric,
    nullif(v_snapshot->>'theoretical_total_cost','')::numeric,
    nullif(v_snapshot->>'standard_unit_cost','')::numeric,
    nullif(v_snapshot->>'standard_total_cost','')::numeric,
    coalesce(v_snapshot->>'status','MISSING_INPUT'),
    nullif(v_snapshot->>'recipe_id','')::uuid,
    nullif(v_snapshot->>'recipe_version','')::integer,
    coalesce((v_snapshot->>'modifier_theoretical_unit_delta')::numeric,0),
    coalesce((v_snapshot->>'modifier_effect_count')::integer,0),
    coalesce((v_snapshot->>'missing_modifier_cost_count')::integer,0),
    coalesce(new.modifier_option_ids,'{}'::uuid[]),
    1,v_snapshot,v_capture_at
  )
  on conflict(sale_item_id) do nothing;

  delete from private.sale_item_cost_snapshot_failures
  where sale_item_id=new.id;

  return new;
exception
  when others then
    begin
      insert into private.sale_item_cost_snapshot_failures(
        sale_item_id,sale_id,branch_id,product_id,error_message,attempted_at
      )
      values(
        new.id,new.sale_id,v_branch_id,new.product_id,sqlerrm,clock_timestamp()
      )
      on conflict(sale_item_id) do update
      set sale_id=excluded.sale_id,
          branch_id=excluded.branch_id,
          product_id=excluded.product_id,
          error_message=excluded.error_message,
          attempted_at=excluded.attempted_at;
    exception
      when others then null;
    end;
    return new;
end;
$$;
