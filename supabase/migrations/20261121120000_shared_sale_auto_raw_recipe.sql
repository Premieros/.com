-- Stage P0: safe branch-scoped material generation on the sale deduction path.
-- Deployment is intentionally through a reviewed migration, not an ad-hoc production edit.
-- No demo products, recipe products, linked units, or tracked finished-goods are changed.
CREATE OR REPLACE FUNCTION public._ensure_sale_auto_raw_recipe(p_branch_id uuid, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_product record; v_raw_id uuid;
BEGIN
  -- Canonical existing POS fallback already owns unique, branch-safe raw IDs
  -- and 1:1 recipe links; reuse it instead of inventing a competing code.
  SELECT id,name,branch_id,is_demo INTO v_product
  FROM public.products
  WHERE id=p_product_id AND branch_id=p_branch_id AND is_active
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','PRODUCT_NOT_IN_BRANCH'); END IF;
  IF COALESCE(v_product.is_demo,false)
     OR EXISTS (SELECT 1 FROM public.recipes WHERE product_id=p_product_id AND branch_id=p_branch_id)
     OR EXISTS (SELECT 1 FROM public.product_unit_links WHERE product_id=p_product_id)
     OR EXISTS (SELECT 1 FROM public.product_components WHERE product_id=p_product_id)
     OR EXISTS (SELECT 1 FROM public.inventory_batches WHERE product_id=p_product_id AND branch_id=p_branch_id)
  THEN RETURN jsonb_build_object('success',true,'action','existing_stock_configuration'); END IF;
  v_raw_id := public._ensure_pos_fallback_product_raw(p_product_id,p_branch_id);
  IF v_raw_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTO_RAW_CREATE_FAILED'); END IF;
  RETURN jsonb_build_object('success',true,'action','auto_linked',
    'raw_material_id',v_raw_id);

END $$;
REVOKE ALL ON FUNCTION public._ensure_sale_auto_raw_recipe(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_sale_auto_raw_recipe(uuid,uuid) TO service_role,postgres;

-- Only these system-created 1:1 fallback materials may bypass a branch's
-- normal strict-stock policy. Other raw ingredients and finished products keep
-- their configured policy, even within the same mixed sale.
CREATE OR REPLACE FUNCTION public._is_sale_auto_fallback_raw(p_branch uuid,p_raw uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
 SELECT EXISTS(
   SELECT 1
   FROM public.raw_materials rm
   JOIN public.recipe_items ri ON ri.raw_material_id=rm.id
   JOIN public.recipes r ON r.id=ri.recipe_id
   WHERE rm.id=p_raw AND rm.branch_id=p_branch
     AND r.branch_id=p_branch AND r.product_id IS NOT NULL AND r.is_active
     AND r.notes='AUTO_POS_FALLBACK'
     AND ri.note='AUTO_POS_FALLBACK'
     AND rm.code='AUTO-PROD-'||replace(r.product_id::text,'-','')
 );
$fn$;
REVOKE ALL ON FUNCTION public._is_sale_auto_fallback_raw(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._is_sale_auto_fallback_raw(uuid,uuid) TO service_role,postgres;

-- Patch the existing authoritative sale function in place. No global
-- negative-stock switch is changed: automatic fallback raws alone are exempt.
-- Abort the migration on source drift, before changing the sale function.
DO $patch$
DECLARE
  v_definition text;
  v_needle text := '    v_res := public.check_product_availability(';
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)'::regprocedure
  ) INTO v_definition;

  IF strpos(v_definition,v_needle)=0
     OR strpos(v_definition,'_ensure_sale_auto_raw_recipe(')>0
     OR strpos(v_definition,'v_auto_raw_id uuid;')=0
  THEN RAISE EXCEPTION 'SALE_CORE_SOURCE_DRIFT_OR_ALREADY_PATCHED'; END IF;

  v_new := $fragment$
    -- Prepare only unmapped items; do not alter real recipes, linked units or
    -- tracked finished goods. Reuse the kitchen's canonical auto raw ID.
    v_auto_raw_id := NULL;
    v_res := public._ensure_sale_auto_raw_recipe(p_branch_id,v_product_id);
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_res;
    END IF;
    SELECT ri.raw_material_id INTO v_auto_raw_id
    FROM public.recipes r
    JOIN public.recipe_items ri ON ri.recipe_id=r.id
    JOIN public.raw_materials rm ON rm.id=ri.raw_material_id
    WHERE r.product_id=v_product_id AND r.branch_id=p_branch_id AND r.is_active
      AND rm.branch_id=p_branch_id AND r.notes='AUTO_POS_FALLBACK'
      AND ri.note='AUTO_POS_FALLBACK'
      AND rm.code='AUTO-PROD-'||replace(v_product_id::text,'-','')
    ORDER BY r.created_at DESC LIMIT 1;

$fragment$;
  v_definition := replace(v_definition,v_needle,v_new||v_needle);

  v_old := '    ELSIF v_allow_negative THEN';
  v_new := $fragment$    ELSIF v_allow_negative OR (
      v_auto_raw_id IS NOT NULL
      AND COALESCE(v_res->>'error','')='INSUFFICIENT_RAW_MATERIAL_STOCK'
    ) THEN$fragment$;
  IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'SALE_FALLBACK_AVAILABILITY_DRIFT'; END IF;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := '    IF COALESCE((v_mod->>''success'')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;';
  v_new := v_old || E'\\n\\n' ||
    '    -- An automatically generated raw is never a finished product.' ||
    E'\\n' || '    IF v_auto_raw_id IS NOT NULL THEN v_base_ready:=false; END IF;';
  IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'SALE_FALLBACK_MODIFIER_DRIFT'; END IF;
  v_definition := replace(v_definition,v_old,v_new);

  -- Strict mode must continue checking normal raw/finished/unit inventory.
  v_old := $old$    FOR v_link IN SELECT * FROM pg_temp.sale_raw_need WHERE required_qty>0 ORDER BY raw_material_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available$old$;
  v_new := $new$    FOR v_link IN SELECT * FROM pg_temp.sale_raw_need WHERE required_qty>0 ORDER BY raw_material_id
    LOOP
      IF public._is_sale_auto_fallback_raw(p_branch_id,v_link.raw_material_id) THEN
        CONTINUE;
      END IF;
      SELECT COALESCE(SUM(quantity),0) INTO v_available$new$;
  IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'SALE_FALLBACK_STRICT_CHECK_DRIFT'; END IF;
  v_definition := replace(v_definition,v_old,v_new);

  -- Apply negative movement only for system-generated product fallback raws,
  -- while leaving modifiers, purchased raws and all other items strict.
  v_old := '      auth.uid(),v_allow_negative';
  v_new := '      auth.uid(),v_allow_negative OR public._is_sale_auto_fallback_raw(p_branch_id,v_link.raw_material_id)';
  IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'SALE_FALLBACK_MOVEMENT_DRIFT'; END IF;
  v_definition := replace(v_definition,v_old,v_new);

  EXECUTE v_definition;
END $patch$;

COMMENT ON FUNCTION public._ensure_sale_auto_raw_recipe(uuid,uuid) IS
'Internal sale-path mapping: if product has no recipe, unit link or finished stock records, create the canonical POS fallback raw and 1:1 recipe, avoiding duplicate mappings between direct-sale and kitchen paths. Raw sale stock can run negative via existing FIFO mechanism.';