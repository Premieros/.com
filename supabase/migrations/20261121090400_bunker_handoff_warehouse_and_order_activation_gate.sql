-- BUNKER handoff foundation: an empty receiving warehouse and a fail-closed
-- QR order activation gate. Existing stock, menu prices, staff, orders, and
-- live order switch are deliberately not modified.
do $warehouse$
declare v_branch uuid:='d56aae83-f1b3-4153-9224-87594500368d';
begin
 if exists(select 1 from public.branches where id=v_branch and name='BUNKER')
   and not exists(select 1 from public.warehouses where branch_id=v_branch and is_active)
 then
  insert into public.warehouses(name,branch_id,warehouse_type,is_default,is_active,is_demo)
  values('BUNKER Main Stock',v_branch,'general',true,true,false);
 end if;
end $warehouse$;

CREATE OR REPLACE FUNCTION qr_private.bunker_live_menu_ready()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with b as (select 'd56aae83-f1b3-4153-9224-87594500368d'::uuid id),
items as (
 select p.id,p.cost_price,p.is_demo,p.category_id
 from qr_private.menu_products m join public.products p on p.id=m.product_id and p.branch_id=m.branch_id
 join b on b.id=m.branch_id
),
staff as (
 select 1 from public.user_branch_access uba join auth.users au on au.id=uba.user_id
 join public.branches br on br.id=uba.branch_id
 join public.organization_members om on om.user_id=uba.user_id and om.organization_id=br.organization_id and om.is_active
 join b on b.id=br.id limit 1
)
select
 (select count(*) from items)>0
 and not exists(select 1 from items where is_demo is true or coalesce(cost_price,0)<=0)
 and exists(select 1 from staff)
 and exists(select 1 from public.warehouses w join b on w.branch_id=b.id where w.is_active)
 and exists(select 1 from public.dining_tables t join b on t.branch_id=b.id where t.is_active)
 and not exists(
    select 1 from items i left join public.categories c on c.id=i.category_id
    left join public.kitchen_stations k on k.id=c.kitchen_station_id
    join b on true
    where c.id is null or c.branch_id<>b.id or k.id is null or k.branch_id<>b.id or not k.is_active
 );
$function$;

CREATE OR REPLACE FUNCTION qr_private.bunker_live_menu_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.branch_id='d56aae83-f1b3-4153-9224-87594500368d'::uuid
   and new.enabled and not qr_private.bunker_live_menu_ready()
 then raise exception 'BUNKER_LIVE_NOT_READY: Missing authorized staff, valid menu costs, warehouse, tables, or kitchen routing'; end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.bunker_live_order_readiness(p_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_real integer:=0;v_demo integer:=0;v_tables integer:=0;v_stations integer:=0;
 v_missing_cost integer:=0;v_missing_routes integer:=0;v_warehouses integer:=0;
 v_staff integer:=0;v_active boolean:=false;
begin
 perform qr_private.require_settings(p_branch);
 if p_branch is distinct from 'd56aae83-f1b3-4153-9224-87594500368d'::uuid then return jsonb_build_object('bunker',false); end if;
 select count(*) filter(where p.is_active and p.is_demo is distinct from true),
 count(*) filter(where p.is_demo is true),
 count(*) filter(where p.is_active and coalesce(p.cost_price,0)<=0),
 count(*) filter(where p.is_active and (c.id is null or c.branch_id<>p_branch or k.id is null or k.branch_id<>p_branch or k.is_active is distinct from true))
 into v_real,v_demo,v_missing_cost,v_missing_routes
 from qr_private.menu_products m
 join public.products p on p.id=m.product_id and p.branch_id=m.branch_id
 left join public.categories c on c.id=p.category_id
 left join public.kitchen_stations k on k.id=c.kitchen_station_id
 where m.branch_id=p_branch;
 select count(*) into v_tables from public.dining_tables where branch_id=p_branch and is_active;
 select count(*) into v_stations from public.kitchen_stations where branch_id=p_branch and is_active;
 select count(*) into v_warehouses from public.warehouses where branch_id=p_branch and is_active;
 select count(distinct uba.user_id) into v_staff from public.user_branch_access uba
 join auth.users au on au.id=uba.user_id
 join public.branches br on br.id=uba.branch_id
 join public.organization_members om on om.user_id=uba.user_id and om.organization_id=br.organization_id and om.is_active
 where uba.branch_id=p_branch;
 select enabled into v_active from qr_private.branch_settings where branch_id=p_branch;
 return jsonb_build_object(
 'bunker',true,'ready',qr_private.bunker_live_menu_ready(),
 'real_products',v_real,'demo_products',v_demo,'active_tables',v_tables,
 'active_stations',v_stations,'active_warehouses',v_warehouses,
 'authorized_staff',v_staff,'products_missing_cost',v_missing_cost,
 'products_missing_kitchen_route',v_missing_routes,
 'enabled',coalesce(v_active,false),
 'requires_business_approval',true
 );
end $function$;
revoke all on function qr_private.bunker_live_menu_ready() from public;
revoke all on function qr_private.bunker_live_menu_gate() from public;
revoke all on function public.bunker_live_order_readiness(uuid) from public;
grant execute on function public.bunker_live_order_readiness(uuid) to authenticated,service_role;
