create or replace function private.sync_product_canonical_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_id uuid;
  v_org_id uuid;
begin
  if tg_op = 'DELETE' then
    select l.item_id into v_item_id
    from private.item_legacy_links l
    where l.source_table='products' and l.source_id=old.id;

    if v_item_id is not null then
      delete from public.items where id=v_item_id;
    end if;

    return old;
  end if;

  select b.organization_id into v_org_id
  from public.branches b
  where b.id=new.branch_id;

  if v_org_id is null then
    raise exception 'CANONICAL_ITEM_BRANCH_ORGANIZATION_MISSING';
  end if;

  select l.item_id into v_item_id
  from private.item_legacy_links l
  where l.source_table='products' and l.source_id=new.id;

  if v_item_id is null then
    insert into public.items(
      organization_id,item_type,code,sku,barcode,name,name_en,base_uom_id,is_active,created_at,updated_at
    )
    values(
      v_org_id,
      case when new.product_type='manufactured' then 'FINISHED_GOOD' else 'RETAIL_ITEM' end,
      nullif(new.sku,''),
      nullif(new.sku,''),
      nullif(new.barcode,''),
      new.name,
      new.name_en,
      null,
      new.is_active,
      coalesce(new.created_at,now()),
      coalesce(new.updated_at,new.created_at,now())
    )
    returning id into v_item_id;

    insert into private.item_legacy_links(item_id,source_table,source_id)
    values(v_item_id,'products',new.id);
  else
    update public.items
    set organization_id=v_org_id,
        item_type=case when new.product_type='manufactured' then 'FINISHED_GOOD' else 'RETAIL_ITEM' end,
        code=nullif(new.sku,''),
        sku=nullif(new.sku,''),
        barcode=nullif(new.barcode,''),
        name=new.name,
        name_en=new.name_en,
        is_active=new.is_active,
        updated_at=coalesce(new.updated_at,now())
    where id=v_item_id;
  end if;

  delete from public.item_sites
  where item_id=v_item_id and branch_id<>new.branch_id;

  insert into public.item_sites(
    item_id,branch_id,is_active,min_stock,max_stock,reorder_point,updated_at
  )
  values(
    v_item_id,new.branch_id,new.is_active,new.min_stock,new.max_stock,new.reorder_point,now()
  )
  on conflict(item_id,branch_id) do update
  set is_active=excluded.is_active,
      min_stock=excluded.min_stock,
      max_stock=excluded.max_stock,
      reorder_point=excluded.reorder_point,
      updated_at=now();

  return new;
end;
$$;

create or replace function private.sync_raw_material_canonical_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_id uuid;
  v_org_id uuid;
begin
  if tg_op = 'DELETE' then
    select l.item_id into v_item_id
    from private.item_legacy_links l
    where l.source_table='raw_materials' and l.source_id=old.id;

    if v_item_id is not null then
      delete from public.items where id=v_item_id;
    end if;

    return old;
  end if;

  select b.organization_id into v_org_id
  from public.branches b
  where b.id=new.branch_id;

  if v_org_id is null then
    raise exception 'CANONICAL_ITEM_BRANCH_ORGANIZATION_MISSING';
  end if;

  select l.item_id into v_item_id
  from private.item_legacy_links l
  where l.source_table='raw_materials' and l.source_id=new.id;

  if v_item_id is null then
    insert into public.items(
      organization_id,item_type,code,sku,barcode,name,name_en,base_uom_id,is_active,created_at,updated_at
    )
    values(
      v_org_id,'RAW_MATERIAL',nullif(new.code,''),null,null,new.name,null,new.unit_id,new.is_active,
      coalesce(new.created_at,now()),coalesce(new.updated_at,new.created_at,now())
    )
    returning id into v_item_id;

    insert into private.item_legacy_links(item_id,source_table,source_id)
    values(v_item_id,'raw_materials',new.id);
  else
    update public.items
    set organization_id=v_org_id,
        item_type='RAW_MATERIAL',
        code=nullif(new.code,''),
        sku=null,
        barcode=null,
        name=new.name,
        name_en=null,
        base_uom_id=new.unit_id,
        is_active=new.is_active,
        updated_at=coalesce(new.updated_at,now())
    where id=v_item_id;
  end if;

  delete from public.item_sites
  where item_id=v_item_id and branch_id<>new.branch_id;

  insert into public.item_sites(
    item_id,branch_id,is_active,min_stock,max_stock,reorder_point,updated_at
  )
  values(
    v_item_id,new.branch_id,new.is_active,new.min_stock,0,0,now()
  )
  on conflict(item_id,branch_id) do update
  set is_active=excluded.is_active,
      min_stock=excluded.min_stock,
      max_stock=0,
      reorder_point=0,
      updated_at=now();

  return new;
end;
$$;

create or replace function private.sync_inventory_unit_canonical_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_id uuid;
  v_org_id uuid;
begin
  if tg_op = 'DELETE' then
    select l.item_id into v_item_id
    from private.item_legacy_links l
    where l.source_table='inventory_units' and l.source_id=old.id;

    if v_item_id is not null then
      delete from public.items where id=v_item_id;
    end if;

    return old;
  end if;

  select b.organization_id into v_org_id
  from public.branches b
  where b.id=new.branch_id;

  if v_org_id is null then
    raise exception 'CANONICAL_ITEM_BRANCH_ORGANIZATION_MISSING';
  end if;

  select l.item_id into v_item_id
  from private.item_legacy_links l
  where l.source_table='inventory_units' and l.source_id=new.id;

  if v_item_id is null then
    insert into public.items(
      organization_id,item_type,code,sku,barcode,name,name_en,base_uom_id,is_active,created_at,updated_at
    )
    values(
      v_org_id,'SEMI_FINISHED',nullif(new.code,''),nullif(new.sku,''),nullif(new.barcode,''),
      new.name,new.name_en,null,new.is_active,
      coalesce(new.created_at,now()),coalesce(new.updated_at,new.created_at,now())
    )
    returning id into v_item_id;

    insert into private.item_legacy_links(item_id,source_table,source_id)
    values(v_item_id,'inventory_units',new.id);
  else
    update public.items
    set organization_id=v_org_id,
        item_type='SEMI_FINISHED',
        code=nullif(new.code,''),
        sku=nullif(new.sku,''),
        barcode=nullif(new.barcode,''),
        name=new.name,
        name_en=new.name_en,
        is_active=new.is_active,
        updated_at=coalesce(new.updated_at,now())
    where id=v_item_id;
  end if;

  delete from public.item_sites
  where item_id=v_item_id and branch_id<>new.branch_id;

  insert into public.item_sites(
    item_id,branch_id,is_active,min_stock,max_stock,reorder_point,updated_at
  )
  values(
    v_item_id,new.branch_id,new.is_active,new.min_stock,new.max_stock,new.reorder_point,now()
  )
  on conflict(item_id,branch_id) do update
  set is_active=excluded.is_active,
      min_stock=excluded.min_stock,
      max_stock=excluded.max_stock,
      reorder_point=excluded.reorder_point,
      updated_at=now();

  return new;
end;
$$;

revoke execute on function private.sync_product_canonical_item() from public, anon, authenticated;
revoke execute on function private.sync_raw_material_canonical_item() from public, anon, authenticated;
revoke execute on function private.sync_inventory_unit_canonical_item() from public, anon, authenticated;

grant execute on function private.sync_product_canonical_item() to postgres, service_role;
grant execute on function private.sync_raw_material_canonical_item() to postgres, service_role;
grant execute on function private.sync_inventory_unit_canonical_item() to postgres, service_role;

drop trigger if exists trg_sync_product_canonical_item on public.products;
create trigger trg_sync_product_canonical_item
after insert or update or delete on public.products
for each row execute function private.sync_product_canonical_item();

drop trigger if exists trg_sync_raw_material_canonical_item on public.raw_materials;
create trigger trg_sync_raw_material_canonical_item
after insert or update or delete on public.raw_materials
for each row execute function private.sync_raw_material_canonical_item();

drop trigger if exists trg_sync_inventory_unit_canonical_item on public.inventory_units;
create trigger trg_sync_inventory_unit_canonical_item
after insert or update or delete on public.inventory_units
for each row execute function private.sync_inventory_unit_canonical_item();
