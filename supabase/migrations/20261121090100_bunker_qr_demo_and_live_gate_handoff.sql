-- BUNKER QR demo preview and live ordering go-live gates.
-- Orders are intentionally blocked while demo-priced products remain published.
CREATE OR REPLACE FUNCTION public.bunker_demo_menu_preview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid := 'd56aae83-f1b3-4153-9224-87594500368d';
v_products jsonb;
begin
 if not exists (select 1 from public.branches where id=v_branch and is_active) then
  return '{}'::jsonb;
 end if;
 -- Preview is available only while checkout is disabled. Real orders use QR verification.
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
 where p.branch_id=v_branch and p.is_active and p.is_demo;
 return jsonb_build_object('branch_name','BUNKER','currency','EGP',
  'table_name','','table_id',null,'tables','[]'::jsonb,'products',v_products,
  'appearance',coalesce((select appearance from qr_private.branch_settings where branch_id=v_branch),'{}'::jsonb),
  'demo_preview',true);
end $function$
;

CREATE OR REPLACE FUNCTION qr_private.bunker_live_menu_ready()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS (
   SELECT 1 FROM qr_private.menu_products m
   JOIN public.products p ON p.id=m.product_id AND p.branch_id=m.branch_id
   WHERE m.branch_id='d56aae83-f1b3-4153-9224-87594500368d'
     AND p.is_active=true AND p.is_demo IS DISTINCT FROM true
 ) AND NOT EXISTS (
   SELECT 1 FROM qr_private.menu_products m
   JOIN public.products p ON p.id=m.product_id AND p.branch_id=m.branch_id
   WHERE m.branch_id='d56aae83-f1b3-4153-9224-87594500368d'
     AND p.is_demo IS TRUE
 );
$function$
;

CREATE OR REPLACE FUNCTION qr_private.bunker_live_menu_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.branch_id='d56aae83-f1b3-4153-9224-87594500368d'
   AND NEW.enabled AND NOT qr_private.bunker_live_menu_ready()
 THEN RAISE EXCEPTION 'QR_DEMO_PRODUCTS_NOT_APPROVED';
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION qr_private.bunker_live_menu_item_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.branch_id='d56aae83-f1b3-4153-9224-87594500368d'
   AND EXISTS (SELECT 1 FROM qr_private.branch_settings s WHERE s.branch_id=NEW.branch_id AND s.enabled)
   AND EXISTS (SELECT 1 FROM public.products p WHERE p.id=NEW.product_id AND p.is_demo)
 THEN RAISE EXCEPTION 'QR_DEMO_PRODUCTS_NOT_APPROVED';
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION qr_private.bunker_product_live_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.branch_id='d56aae83-f1b3-4153-9224-87594500368d'
  AND NEW.is_demo IS TRUE AND OLD.is_demo IS DISTINCT FROM TRUE
  AND EXISTS (SELECT 1 FROM qr_private.menu_products m WHERE m.product_id=NEW.id AND m.branch_id=NEW.branch_id)
  AND EXISTS (SELECT 1 FROM qr_private.branch_settings s WHERE s.branch_id=NEW.branch_id AND s.enabled)
 THEN RAISE EXCEPTION 'QR_DEMO_PRODUCTS_NOT_APPROVED'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.bunker_live_order_readiness(p_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_real integer;v_demo integer;v_active boolean;v_tables integer;
BEGIN
 PERFORM qr_private.require_settings(p_branch);
 IF p_branch IS DISTINCT FROM 'd56aae83-f1b3-4153-9224-87594500368d'::uuid THEN
  RETURN jsonb_build_object('bunker',false);
 END IF;
 SELECT COUNT(*) FILTER(WHERE p.is_demo IS TRUE),
        COUNT(*) FILTER(WHERE p.is_demo IS DISTINCT FROM TRUE AND p.is_active)
 INTO v_demo,v_real
 FROM qr_private.menu_products m
 JOIN public.products p ON p.id=m.product_id AND p.branch_id=m.branch_id
 WHERE m.branch_id=p_branch;
 SELECT enabled INTO v_active FROM qr_private.branch_settings WHERE branch_id=p_branch;
 SELECT COUNT(*) INTO v_tables FROM public.dining_tables WHERE branch_id=p_branch AND is_active;
 RETURN jsonb_build_object(
   'bunker',true,'ready',(v_real>0 AND v_demo=0 AND v_tables>0),
   'real_products',v_real,'demo_products',v_demo,'active_tables',v_tables,
   'enabled',coalesce(v_active,false)
 );
END $function$
;
drop trigger if exists bunker_live_menu_gate on qr_private.branch_settings;
create trigger bunker_live_menu_gate before insert or update of enabled
 on qr_private.branch_settings for each row
 execute function qr_private.bunker_live_menu_gate();
drop trigger if exists bunker_live_menu_item_gate on qr_private.menu_products;
create trigger bunker_live_menu_item_gate before insert or update
 on qr_private.menu_products for each row
 execute function qr_private.bunker_live_menu_item_gate();
drop trigger if exists bunker_product_live_gate on public.products;
create trigger bunker_product_live_gate before update of is_demo
 on public.products for each row
 execute function qr_private.bunker_product_live_gate();
revoke all on function public.bunker_demo_menu_preview() from public;
grant execute on function public.bunker_demo_menu_preview() to anon,authenticated,service_role;
revoke all on function public.bunker_live_order_readiness(uuid) from public;
grant execute on function public.bunker_live_order_readiness(uuid) to authenticated,service_role;
revoke all on function qr_private.bunker_live_menu_ready() from public;
revoke all on function qr_private.bunker_live_menu_gate() from public;
revoke all on function qr_private.bunker_live_menu_item_gate() from public;
revoke all on function qr_private.bunker_product_live_gate() from public;
