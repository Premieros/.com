-- Atomically replace one branch website image without losing concurrent updates.
-- The caller must hold website.edit for the supplied branch.
create or replace function public.branch_website_photo_save_one(
  p_branch uuid, p_key text, p_url text, p_previous text
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_images jsonb;
  v_current text;
begin
  perform qr_private.require_website(p_branch);
  if p_key is null or p_key not in (
    'heroImage','featureImage','burgerImage','coffeeImage','interiorImage',
    'dessertImage','gallery1','gallery2','gallery3','gallery4','gallery5'
  ) then raise exception 'INVALID_BRANCH_PHOTO_KEY'; end if;
  if p_url is null or length(p_url) > 1500 or
    p_url !~ '^https://[^[:space:]]+$' or p_url ~ '[<>"'']' then
    raise exception 'INVALID_BRANCH_PHOTO_URL';
  end if;
  if p_previous is null or length(p_previous) > 1500 then
    raise exception 'INVALID_BRANCH_PHOTO_PREVIOUS';
  end if;

  -- Serialize same-branch image updates, including first insert.
  perform pg_advisory_xact_lock(hashtextextended('website-photos:' || p_branch::text, 0));
  select images into v_images from public.branch_website_photos
    where branch_id = p_branch for update;
  v_images := coalesce(v_images, '{}'::jsonb);
  v_current := coalesce(v_images ->> p_key, '');
  if v_current <> p_previous then
    raise exception 'WEBSITE_PHOTO_CONFLICT';
  end if;
  insert into public.branch_website_photos (branch_id, images)
  values (p_branch, jsonb_set(v_images, array[p_key], to_jsonb(p_url), true))
  on conflict (branch_id) do update
    set images = excluded.images, updated_at = now();
end
$function$;

revoke all on function public.branch_website_photo_save_one(uuid,text,text,text)
  from public, anon;
grant execute on function public.branch_website_photo_save_one(uuid,text,text,text)
  to authenticated, service_role;
