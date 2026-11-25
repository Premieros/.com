-- Disposable candidate only: operational product composition; no production application.
CREATE FUNCTION public.pr318_edit_product_composition_candidate(
  p_product_id uuid,p_branch_id uuid,p_expected_version integer,p_expected_links jsonb,
  p_name text,p_items jsonb,p_links jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_product public.products%ROWTYPE; v_recipe public.recipes%ROWTYPE; v_result jsonb; v_recipe_id uuid; v_snapshot jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_permission('products.edit') OR NOT public.can_permission('recipes.manage')
     OR NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'COMPOSITION_EDIT_DENIED'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id AND branch_id=p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.product_components WHERE product_id=p_product_id) THEN RAISE EXCEPTION 'LEGACY_COMPOSITION_REQUIRES_REVIEW'; END IF;
  IF nullif(trim(p_name),'') IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_typeof(p_links) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_expected_links) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_COMPOSITION'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) i(raw_material_id uuid,quantity numeric,wastage_percent numeric)
    LEFT JOIN public.raw_materials r ON r.id=i.raw_material_id AND r.branch_id=p_branch_id AND r.is_active AND r.unit_id IS NOT NULL
    WHERE r.id IS NULL OR i.quantity IS NULL OR i.quantity<=0 OR i.quantity::text IN ('NaN','Infinity','-Infinity')
      OR coalesce(i.wastage_percent,0)<0 OR i.wastage_percent::text IN ('NaN','Infinity','-Infinity')
  ) OR (SELECT count(DISTINCT i.raw_material_id) FROM jsonb_to_recordset(p_items) i(raw_material_id uuid))<>jsonb_array_length(p_items)
  THEN RAISE EXCEPTION 'INVALID_DIRECT_RAW_COMPONENT'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_links) i(unit_id uuid,quantity numeric)
    LEFT JOIN public.inventory_units u ON u.id=i.unit_id AND u.branch_id=p_branch_id AND u.is_active AND u.unit_type='manufactured'
    WHERE u.id IS NULL OR i.quantity IS NULL OR i.quantity<=0 OR i.quantity::text IN ('NaN','Infinity','-Infinity')
  ) OR (SELECT count(DISTINCT i.unit_id) FROM jsonb_to_recordset(p_links) i(unit_id uuid))<>jsonb_array_length(p_links)
  THEN RAISE EXCEPTION 'INVALID_MANUFACTURED_COMPONENT'; END IF;
  IF (SELECT count(*) FROM public.recipes WHERE product_id=p_product_id AND branch_id=p_branch_id AND is_active)>1 THEN RAISE EXCEPTION 'MULTIPLE_ACTIVE_RECIPES'; END IF;
  SELECT * INTO v_recipe FROM public.recipes WHERE product_id=p_product_id AND branch_id=p_branch_id AND is_active FOR UPDATE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('unit_id',unit_id,'quantity',quantity) ORDER BY unit_id),'[]'::jsonb) INTO v_snapshot
    FROM public.product_unit_links WHERE product_id=p_product_id;
  IF v_recipe.version IS DISTINCT FROM p_expected_version OR v_snapshot IS DISTINCT FROM p_expected_links THEN RAISE EXCEPTION 'COMPOSITION_REFRESH_REQUIRED'; END IF;
  UPDATE public.products SET name=trim(p_name),product_type=CASE WHEN jsonb_array_length(p_items)+jsonb_array_length(p_links)>0 THEN 'manufactured' ELSE 'ready' END
    WHERE id=p_product_id AND branch_id=p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_SAVED'; END IF;
  DELETE FROM public.product_unit_links WHERE product_id=p_product_id;
  INSERT INTO public.product_unit_links(product_id,unit_id,quantity)
    SELECT p_product_id,i.unit_id,i.quantity FROM jsonb_to_recordset(p_links) i(unit_id uuid,quantity numeric);
  IF (SELECT count(*) FROM public.product_unit_links WHERE product_id=p_product_id)<>jsonb_array_length(p_links)
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_links) i(unit_id uuid,quantity numeric) WHERE NOT EXISTS
      (SELECT 1 FROM public.product_unit_links l WHERE l.product_id=p_product_id AND l.unit_id=i.unit_id AND l.quantity=round(i.quantity,4)))
  THEN RAISE EXCEPTION 'GROUP_LINKS_NOT_SAVED'; END IF;
  IF jsonb_array_length(p_items)=0 THEN
    IF v_recipe.id IS NOT NULL THEN
      v_result:=public.delete_recipe_controlled(v_recipe.id);
      IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'RECIPE_DELETE_FAILED: %',v_result; END IF;
    END IF;
  ELSIF v_recipe.id IS NOT NULL THEN
    v_result:=public.update_recipe_with_items(v_recipe.id,v_recipe.name,v_recipe.yield_quantity,v_recipe.notes,true,p_items);
    IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'RECIPE_UPDATE_FAILED: %',v_result; END IF;
    v_recipe_id:=v_recipe.id;
  ELSE
    INSERT INTO public.recipes(product_id,branch_id,name,yield_quantity,is_active) VALUES(p_product_id,p_branch_id,trim(p_name)||' Components',1,true) RETURNING id INTO v_recipe_id;
    INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
      SELECT v_recipe_id,i.raw_material_id,i.quantity,coalesce(i.wastage_percent,0) FROM jsonb_to_recordset(p_items) i(raw_material_id uuid,quantity numeric,wastage_percent numeric);
  END IF;
  IF v_recipe_id IS NOT NULL AND ((SELECT count(*) FROM public.recipe_items WHERE recipe_id=v_recipe_id)<>jsonb_array_length(p_items)
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) i(raw_material_id uuid,quantity numeric,wastage_percent numeric) WHERE NOT EXISTS
       (SELECT 1 FROM public.recipe_items r WHERE r.recipe_id=v_recipe_id AND r.raw_material_id=i.raw_material_id AND r.quantity=round(i.quantity,4) AND r.wastage_percent=round(coalesce(i.wastage_percent,0),2))))
  THEN RAISE EXCEPTION 'RAW_COMPONENTS_NOT_SAVED'; END IF;
  RETURN jsonb_build_object('success',true,'product_id',p_product_id,'recipe_id',v_recipe_id);
END; $$;
REVOKE ALL ON FUNCTION public.pr318_edit_product_composition_candidate(uuid,uuid,integer,jsonb,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pr318_edit_product_composition_candidate(uuid,uuid,integer,jsonb,text,jsonb,jsonb) TO authenticated;
