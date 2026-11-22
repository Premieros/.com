-- Keep the existing API signatures. Privileged execution lives only in qr_private.
ALTER FUNCTION public.customer_support_qr_branch(text) SET SCHEMA qr_private;
ALTER FUNCTION public.customer_support_start(uuid,text,text,text) SET SCHEMA qr_private;
ALTER FUNCTION public.customer_support_follow(uuid,text,text) SET SCHEMA qr_private;
ALTER FUNCTION public.branch_contact_links(uuid) SET SCHEMA qr_private;

CREATE FUNCTION public.customer_support_qr_branch(p_token text) RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT qr_private.customer_support_qr_branch(p_token)
$$;

CREATE FUNCTION public.customer_support_start(p_branch uuid,p_kind text,p_body text,p_code text DEFAULT NULL) RETURNS text
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT qr_private.customer_support_start(p_branch,p_kind,p_body,p_code)
$$;

CREATE FUNCTION public.customer_support_follow(p_branch uuid,p_code text,p_body text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT qr_private.customer_support_follow(p_branch,p_code,p_body)
$$;

CREATE FUNCTION public.branch_contact_links(p_branch uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT qr_private.branch_contact_links(p_branch)
$$;

REVOKE ALL ON FUNCTION public.customer_support_qr_branch(text),public.customer_support_start(uuid,text,text,text),
  public.customer_support_follow(uuid,text,text),public.branch_contact_links(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_support_qr_branch(text),public.customer_support_start(uuid,text,text,text),
  public.customer_support_follow(uuid,text,text),public.branch_contact_links(uuid) TO anon,authenticated;
