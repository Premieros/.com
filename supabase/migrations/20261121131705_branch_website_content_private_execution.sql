alter function public.branch_website_content_settings(uuid) set schema qr_private;
alter function public.branch_website_content_save(uuid,jsonb,integer) set schema qr_private;
alter function public.branch_website_content_public(uuid) set schema qr_private;
create function public.branch_website_content_settings(p_branch uuid) returns jsonb
language sql stable security invoker set search_path='' as $f$
 select qr_private.branch_website_content_settings(p_branch)
$f$;
create function public.branch_website_content_save(p_branch uuid,p_content jsonb,p_revision integer) returns integer
language sql security invoker set search_path='' as $f$
 select qr_private.branch_website_content_save(p_branch,p_content,p_revision)
$f$;
create function public.branch_website_content_public(p_branch uuid) returns jsonb
language sql stable security invoker set search_path='' as $f$
 select qr_private.branch_website_content_public(p_branch)
$f$;
revoke all on function public.branch_website_content_settings(uuid),public.branch_website_content_save(uuid,jsonb,integer) from public,anon;
revoke all on function public.branch_website_content_public(uuid) from public;
grant execute on function public.branch_website_content_settings(uuid),public.branch_website_content_save(uuid,jsonb,integer) to authenticated,service_role;
grant execute on function public.branch_website_content_public(uuid) to anon,authenticated,service_role;
