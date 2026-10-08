-- Expose branch-scoped live product costs for product screens.
CREATE OR REPLACE FUNCTION public.get_product_live_costs(
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(product_id uuid, calculated_cost numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    CASE
      WHEN p.product_type='manufactured' THEN public._product_recipe_cost(p.id,p.branch_id)
      ELSE COALESCE(p.cost_price,0)
    END::numeric AS calculated_cost
  FROM public.products p
  WHERE p.is_active=true
    AND (p_branch_id IS NULL OR p.branch_id=p_branch_id)
    AND (public.is_pos_admin() OR public.user_may_access_branch(p.branch_id));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_live_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_live_costs(uuid) TO authenticated, service_role;

NOTIFY pgrst,'reload schema';
