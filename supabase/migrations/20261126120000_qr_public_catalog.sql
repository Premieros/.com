-- A valid QR link can browse the published catalog before customer check-in.
CREATE FUNCTION qr_private.public_catalog(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT qr_private.menu_core(p_token) - ARRAY['tables', 'table_id', 'table_name']::text[];
$function$;

CREATE FUNCTION public.qr_public_catalog(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT qr_private.public_catalog(p_token);
$function$;

REVOKE ALL ON FUNCTION qr_private.public_catalog(text), public.qr_public_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qr_private.public_catalog(text), public.qr_public_catalog(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
