
-- Public storefront properties and staff-authenticated controls.
-- Stored SQL is recovered from the deployed functions, so fresh CI databases
-- recreate the same website behavior as the live project.
create table if not exists public.branch_website_links (
 branch_id uuid primary key references public.branches(id) on delete cascade,
 facebook_url text not null default '', instagram_url text not null default '',
 tiktok_url text not null default '', whatsapp_url text not null default '',
 website_url text not null default '', updated_at timestamptz not null default now()
);
create table if not exists public.branch_website_photos (
 branch_id uuid primary key references public.branches(id) on delete cascade,
 images jsonb not null default '{}'::jsonb,updated_at timestamptz not null default now(),
 constraint website_photos_object check (jsonb_typeof(images) = 'object')
);
create table if not exists public.branch_website_themes (
 branch_id uuid primary key references public.branches(id) on delete cascade,
 theme_mode text not null default 'dark' check(theme_mode in('light','dark')),
 updated_at timestamptz not null default now()
);
alter table public.branch_website_links enable row level security;
alter table public.branch_website_photos enable row level security;
alter table public.branch_website_themes enable row level security;
revoke all on public.branch_website_links,public.branch_website_photos,public.branch_website_themes from anon,authenticated;

CREATE OR REPLACE FUNCTION public.branch_website_links_public(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.branch_website_links;
begin
  if p_slug is null or length(p_slug)>100 then return '{}'::jsonb; end if;
  select w.* into v
    from public.branch_website_links w
    join public.branches b on b.id=w.branch_id and b.is_active
    join public.organizations o on o.id=b.organization_id and o.is_active
   where o.slug=p_slug limit 1;
  if v.branch_id is null then return '{}'::jsonb; end if;
  return jsonb_build_object('facebook',v.facebook_url,'instagram',v.instagram_url,
     'tiktok',v.tiktok_url,'whatsapp',v.whatsapp_url,'website',v.website_url);
end; $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_links_settings(p_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.branch_website_links;
begin
  perform qr_private.require_settings(p_branch);
  select * into v from public.branch_website_links where branch_id=p_branch;
  return jsonb_build_object('facebook',coalesce(v.facebook_url,''),
  'instagram',coalesce(v.instagram_url,''),'tiktok',coalesce(v.tiktok_url,''),
  'whatsapp',coalesce(v.whatsapp_url,''),'website',coalesce(v.website_url,''));
end; $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_links_save(p_branch uuid, p_links jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text; u text;
begin
  perform qr_private.require_settings(p_branch);
  if p_links is null or jsonb_typeof(p_links)<>'object' or octet_length(p_links::text)>5000
     or exists(select 1 from jsonb_object_keys(p_links) k where k not in ('facebook','instagram','tiktok','whatsapp','website'))
  then raise exception 'INVALID_WEBSITE_LINKS'; end if;
  for k in select unnest(array['facebook','instagram','tiktok','whatsapp','website']) loop
    u:=trim(coalesce(p_links->>k,''));
    if length(u)>500 or (u<>'' and (u !~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$' or position('@' in split_part(u,'/',3))>0)) then
       raise exception 'INVALID_WEBSITE_LINK';
    end if;
  end loop;
  insert into public.branch_website_links(branch_id,facebook_url,instagram_url,tiktok_url,whatsapp_url,website_url)
  values(p_branch,trim(coalesce(p_links->>'facebook','')),trim(coalesce(p_links->>'instagram','')),
    trim(coalesce(p_links->>'tiktok','')),trim(coalesce(p_links->>'whatsapp','')),trim(coalesce(p_links->>'website','')))
  on conflict (branch_id) do update set facebook_url=excluded.facebook_url,instagram_url=excluded.instagram_url,
    tiktok_url=excluded.tiktok_url,whatsapp_url=excluded.whatsapp_url,
    website_url=excluded.website_url,updated_at=now();
end; $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_photos_public(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb;
begin
 if p_slug is null or length(p_slug)>100 then return '{}'::jsonb; end if;
 select p.images into v from public.branch_website_photos p
 join public.branches b on b.id=p.branch_id and b.is_active
 join public.organizations o on o.id=b.organization_id and o.is_active
 where o.slug=p_slug limit 1;
 return coalesce(v,'{}'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_photos_settings(p_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform qr_private.require_settings(p_branch);
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
 perform qr_private.require_settings(p_branch);
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
 perform qr_private.require_settings(v_branch);
 return true;
exception when others then return false;
end $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_theme_public(p_slug text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_mode text;
begin
 if p_slug is null or length(p_slug)>100 then return 'dark'; end if;
 select t.theme_mode into v_mode
 from public.branch_website_themes t
 join public.branches b on b.id=t.branch_id and b.is_active
 join public.organizations o on o.id=b.organization_id and o.is_active
 where o.slug=p_slug limit 1;
 return coalesce(v_mode,'dark');
end $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_theme_settings(p_branch uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform qr_private.require_settings(p_branch);
 return coalesce((select t.theme_mode from public.branch_website_themes t where t.branch_id=p_branch),'dark');
end $function$
;

CREATE OR REPLACE FUNCTION public.branch_website_theme_save(p_branch uuid, p_mode text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform qr_private.require_settings(p_branch);
 if p_mode is null or p_mode not in ('light','dark') then raise exception 'INVALID_WEBSITE_THEME'; end if;
 insert into public.branch_website_themes(branch_id,theme_mode) values(p_branch,p_mode)
 on conflict(branch_id) do update set theme_mode=excluded.theme_mode,updated_at=now();
 return p_mode;
end $function$
;

-- CI uses bare PostgreSQL with no Supabase Storage extension.
-- On hosted Supabase, create the public photo bucket and its scoped policies.
-- Skip this block in disposable CI PostgreSQL, not in production.
do $storage_setup$
begin
 if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
   execute $stmt$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
     values('branch-website-photos','branch-website-photos',true,5242880,array['image/jpeg','image/png','image/webp'])
     on conflict(id) do nothing$stmt$;
   execute 'drop policy if exists branch_website_photos_public_read on storage.objects';
   execute $stmt$create policy branch_website_photos_public_read on storage.objects
     for select to anon,authenticated using(bucket_id='branch-website-photos')$stmt$;
   execute 'drop policy if exists branch_website_photos_staff_upload on storage.objects';
   execute $stmt$create policy branch_website_photos_staff_upload on storage.objects
     for insert to authenticated with check(bucket_id='branch-website-photos' and public.branch_website_photo_upload_allowed(name))$stmt$;
 end if;
end
$storage_setup$;

revoke all on function public.branch_website_links_public(text) from public;
grant execute on function public.branch_website_links_public(text) to anon,authenticated,service_role;
revoke all on function public.branch_website_links_settings(uuid) from public;
grant execute on function public.branch_website_links_settings(uuid) to authenticated,service_role;
revoke all on function public.branch_website_links_save(uuid,jsonb) from public;
grant execute on function public.branch_website_links_save(uuid,jsonb) to authenticated,service_role;
revoke all on function public.branch_website_photos_public(text) from public;
grant execute on function public.branch_website_photos_public(text) to anon,authenticated,service_role;
revoke all on function public.branch_website_photos_settings(uuid) from public;
grant execute on function public.branch_website_photos_settings(uuid) to authenticated,service_role;
revoke all on function public.branch_website_photos_save(uuid,jsonb) from public;
grant execute on function public.branch_website_photos_save(uuid,jsonb) to authenticated,service_role;
revoke all on function public.branch_website_photo_upload_allowed(text) from public;
grant execute on function public.branch_website_photo_upload_allowed(text) to authenticated,service_role;
revoke all on function public.branch_website_theme_public(text) from public;
grant execute on function public.branch_website_theme_public(text) to anon,authenticated,service_role;
revoke all on function public.branch_website_theme_settings(uuid) from public;
grant execute on function public.branch_website_theme_settings(uuid) to authenticated,service_role;
revoke all on function public.branch_website_theme_save(uuid,text) from public;
grant execute on function public.branch_website_theme_save(uuid,text) to authenticated,service_role;
