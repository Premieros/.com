-- BUNKER owner elected to use the fifteen former demonstration products as the
-- branch's provisional real catalog, at their existing prices.
-- This is data adoption only. It does NOT enable QR orders, create payments,
-- add inventory, imply verified recipes, or create user accounts.
do $adopt$
declare v_branch uuid:='d56aae83-f1b3-4153-9224-87594500368d'; v_count integer;
begin
 if not exists(select 1 from public.branches where id=v_branch and name='BUNKER') then
   return; -- fresh empty CI database or unrelated tenant
 end if;
 if exists(select 1 from qr_private.branch_settings where branch_id=v_branch and enabled) then
   raise exception 'BUNKER_LIVE_ORDERS_MUST_REMAIN_DISABLED_DURING_ADOPTION';
 end if;
 select count(*) into v_count from public.products
 where branch_id=v_branch and is_demo and sku like 'BUNKER-DEMO-%';
 if v_count not in (0,15) then
   raise exception 'BUNKER_PRODUCT_ADOPTION_REQUIRES_REVIEW: %',v_count;
 end if;
 if v_count=15 then
   update public.products
    set is_demo=false,sku=regexp_replace(sku,'^BUNKER-DEMO-','BUNKER-'),
        description=trim(regexp_replace(coalesce(description,''),'[[:space:]]*Demo item\.[[:space:]]*$','','i'))
    where branch_id=v_branch and is_demo and sku like 'BUNKER-DEMO-%';
 end if;
 update public.categories
    set is_demo=false,
        description=case when description='Demo menu category — sample only' then '' else description end
    where branch_id=v_branch and is_demo;
end $adopt$;

-- When branch QR intake is off, allow a read-only storefront preview of all
-- published active products, even after those products become non-demo.
-- Simulation never writes to the production sales/kitchen tables.
create or replace function public.bunker_demo_menu_preview()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_branch uuid:='d56aae83-f1b3-4153-9224-87594500368d'; v_products jsonb;
begin
 if not exists(select 1 from public.branches where id=v_branch and is_active) then return '{}'::jsonb; end if;
 if coalesce((select enabled from qr_private.branch_settings where branch_id=v_branch),true) then
   return '{}'::jsonb;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'name',p.name,'description',p.description,'price',round(p.sale_price,2),
  'image_url',p.image_url,'category_id',p.category_id,'category_name',c.name
 ) order by c.name,p.name),'[]'::jsonb)
 into v_products
 from public.products p
 join qr_private.menu_products mp on mp.product_id=p.id and mp.branch_id=v_branch
 left join public.categories c on c.id=p.category_id and c.branch_id=v_branch
 where p.branch_id=v_branch and p.is_active;
 return jsonb_build_object('branch_name','BUNKER','currency','EGP',
  'table_name','','table_id',null,'tables','[]'::jsonb,'products',v_products,
  'appearance',coalesce((select appearance from qr_private.branch_settings where branch_id=v_branch),'{}'::jsonb),
  'demo_preview',true);
end $fn$;
revoke all on function public.bunker_demo_menu_preview() from public;
grant execute on function public.bunker_demo_menu_preview() to anon,authenticated,service_role;
