-- Dedicated, branch-scoped website editing. Existing settings managers retain website access.
create or replace function qr_private.require_website(p_branch uuid) returns void
language sql security invoker set search_path='' as $f$
 select qr_private.require_staff(p_branch,'website.edit')
$f$;
revoke all on function qr_private.require_website(uuid) from public,anon;
grant execute on function qr_private.require_website(uuid) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.branch_website_photos_settings(p_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform qr_private.require_website(p_branch);
 return coalesce((select images from public.branch_website_photos where branch_id=p_branch),'{}'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_photos_save(p_branch uuid, p_images jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text; v text;
begin
 perform qr_private.require_website(p_branch);
 if p_images is null or jsonb_typeof(p_images)<>'object' or octet_length(p_images::text)>18000 then
  raise exception 'INVALID_BRANCH_PHOTOS';
 end if;
 for k,v in select key,value from jsonb_each_text(p_images) loop
   if k not in ('heroImage','featureImage','burgerImage','coffeeImage','interiorImage',
    'dessertImage','gallery1','gallery2','gallery3','gallery4','gallery5')
    or length(v)>1500
    or (v<>'' and (v !~ '^https://[^[:space:]]+$' or v ~ '[<>"'']'))
   then raise exception 'INVALID_BRANCH_PHOTO'; end if;
 end loop;
 insert into public.branch_website_photos(branch_id,images)
 values(p_branch,p_images)
 on conflict(branch_id) do update set images=excluded.images,updated_at=now();
end $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_photo_upload_allowed(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid;
begin
 if p_name is null or p_name !~* '^[0-9a-f-]{36}/(heroImage|featureImage|burgerImage|coffeeImage|interiorImage|dessertImage|gallery[1-5])/[a-z0-9-]{36}\.(jpg|jpeg|png|webp)$' then return false; end if;
 v_branch:=split_part(p_name,'/',1)::uuid;
 perform qr_private.require_website(v_branch);
 return true;
exception when others then return false;
end $function$
;

CREATE OR REPLACE FUNCTION qr_private.branch_website_content_settings(p_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb;
begin
 perform qr_private.require_website(p_branch);
 select jsonb_build_object('content',content,'revision',revision) into v
 from public.branch_website_content where branch_id=p_branch;
 return coalesce(v,'{"content":{},"revision":0}'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION qr_private.branch_website_content_save(p_branch uuid, p_content jsonb, p_revision integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text; v jsonb; current_revision integer;
begin
 perform qr_private.require_website(p_branch);
 if p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>64000 then
  raise exception 'INVALID_WEBSITE_CONTENT';
 end if;
 for k,v in select key,value from jsonb_each(p_content) loop
  if k not in ('eyebrow','heroSub','heroCopy','heroPanel','experienceEyebrow',
   'experienceTitle','experienceCopy','featureBadge','featureTitle','featureCopy',
   'burgerTitle','burgerCopy','coffeeTitle','coffeeCopy','interiorTitle','interiorCopy',
   'dessertTitle','dessertCopy','galleryTitle','ctaTitle','ctaCopy',
   'brand','navExperience','navGallery','navOrder','orderButton','exploreButton','spotlightTitle',
   'burgerEyebrow','coffeeEyebrow','interiorEyebrow','dessertEyebrow','galleryEyebrow',
   'galleryLabel1','galleryLabel2','galleryLabel3','galleryLabel4','galleryLabel5',
   'orderEyebrow','openOrdering','backTop','footerSub','footerCopy')
   or jsonb_typeof(v)<>'string' or length(v#>>'{}')>3000 then
   raise exception 'INVALID_WEBSITE_TEXT';
  end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('website-content:'||p_branch::text,0));
 select revision into current_revision from public.branch_website_content where branch_id=p_branch;
 if p_revision is distinct from coalesce(current_revision,0) then raise exception 'WEBSITE_CONTENT_CONFLICT'; end if;
 insert into public.branch_website_content(branch_id,content,revision)
 values(p_branch,p_content,1) on conflict(branch_id) do update
 set content=excluded.content,revision=branch_website_content.revision+1,updated_at=now()
 returning revision into current_revision;
 return current_revision;
end $function$
;

update public.roles set permissions=coalesce(permissions,'[]'::jsonb)||'["website.edit"]'::jsonb
where permissions ? 'settings.manage' and not permissions ? 'website.edit';
