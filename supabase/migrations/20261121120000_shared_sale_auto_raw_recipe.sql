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

-- Patch the current deduction core at its exact validation boundary. Fail
-- closed on source drift rather than deploying a stale full-function overwrite.
DO $patch$
DECLARE v_definition text; v_needle text; v_insert text;
BEGIN
  SELECT pg_get_functiondef(
    'public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)'::regprocedure
  ) INTO v_definition;
  -- Resolve and validate modifiers first, before creating any stock setup.
  -- Otherwise an invalid checkout might leave an auto-created raw behind.
  v_needle := '    -- Use the same authoritative base-stock decision as POS availability, but';
  v_insert := $fragment$
    -- Convert unconfigured products to a 1:1 raw recipe before availability.
    -- Existing recipes / units / tracked finished stock remain unchanged.
    v_res := public._ensure_sale_auto_raw_recipe(p_branch_id, v_product_id);
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_res;
    END IF;

$fragment$;
  IF strpos(v_definition,v_needle)=0 OR
     strpos(v_definition,'_ensure_sale_auto_raw_recipe(')>0 THEN
    RAISE EXCEPTION 'SALE_CORE_SOURCE_DRIFT_OR_ALREADY_PATCHED';
  END IF;
  EXECUTE replace(v_definition,v_needle,v_insert || v_needle);
END $patch$;

COMMENT ON FUNCTION public._ensure_sale_auto_raw_recipe(uuid,uuid) IS
'Internal sale-path mapping: if product has no recipe, unit link or finished stock records, create the canonical POS fallback raw and 1:1 recipe, avoiding duplicate mappings between direct-sale and kitchen paths. Raw sale stock can run negative via existing FIFO mechanism.';