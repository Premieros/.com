-- Review required before hosted execution. No existing business data changes.
create table public.branch_website_content (
 branch_id uuid primary key references public.branches(id),
 content jsonb not null default '{}'::jsonb check(jsonb_typeof(content)='object'),
 revision integer not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.branch_website_content enable row level security;
revoke all on public.branch_website_content from public,anon,authenticated;

create function public.branch_website_content_settings(p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not coalesce(public.can_permission('settings.manage'),false) then raise exception 'FORBIDDEN'; end if;
 perform qr_private.require_settings(p_branch);
 select jsonb_build_object('content',content,'revision',revision) into v
 from public.branch_website_content where branch_id=p_branch;
 return coalesce(v,'{"content":{},"revision":0}'::jsonb);
end $$;

create function public.branch_website_content_save(p_branch uuid,p_content jsonb,p_revision integer)
returns integer language plpgsql security definer set search_path='' as $$
declare k text; v jsonb; current_revision integer;
begin
 if not coalesce(public.can_permission('settings.manage'),false) then raise exception 'FORBIDDEN'; end if;
 perform qr_private.require_settings(p_branch);
 if p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>64000 then
  raise exception 'INVALID_WEBSITE_CONTENT';
 end if;
 for k,v in select key,value from jsonb_each(p_content) loop
  if k not in ('eyebrow','heroSub','heroCopy','heroPanel','experienceEyebrow',
   'experienceTitle','experienceCopy','featureBadge','featureTitle','featureCopy',
   'burgerTitle','burgerCopy','coffeeTitle','coffeeCopy','interiorTitle','interiorCopy',
   'dessertTitle','dessertCopy','galleryTitle','ctaTitle','ctaCopy')
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
end $$;

create function public.branch_website_content_public(p_branch uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select w.content from public.branch_website_content w
 join public.branches b on b.id=w.branch_id and b.is_active
 join public.organizations o on o.id=b.organization_id and o.is_active
 where w.branch_id=p_branch),'{}'::jsonb)
$$;
revoke all on function public.branch_website_content_settings(uuid) from public,anon;
revoke all on function public.branch_website_content_save(uuid,jsonb,integer) from public,anon;
revoke all on function public.branch_website_content_public(uuid) from public;
grant execute on function public.branch_website_content_settings(uuid),public.branch_website_content_save(uuid,jsonb,integer) to authenticated,service_role;
grant execute on function public.branch_website_content_public(uuid) to anon,authenticated,service_role;
