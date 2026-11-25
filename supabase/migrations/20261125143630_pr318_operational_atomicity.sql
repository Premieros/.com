-- PR #318: atomic catalog and stock count operations; corrected inventory projection.
-- No historical inventory movements or data adjustments. Functions use invoker rights;
-- private row-lock helper alone has elevated rights with explicit authorization.

-- Atomic product creation with operational composition.
-- Existing invoker/RLS contract; create_product owns its existing permission checks.
-- No exception handler swallows downstream failures: one RPC transaction rolls back all writes.
-- Reuse the product creation contract and recipe RLS in one transaction.
CREATE FUNCTION public.create_product_operational(p_product jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_recipe_id uuid;
  v_product_id uuid;
  v_attributes jsonb := coalesce(nullif(p_product->'p_business_attributes','null'::jsonb),'{}'::jsonb);
  v_links jsonb := coalesce(nullif(p_product->'p_unit_links','null'::jsonb),'[]'::jsonb);
  v_legacy jsonb := coalesce(nullif(p_product->'p_legacy_components','null'::jsonb),'[]'::jsonb);
  v_branch_id uuid := (p_product->>'p_branch_id')::uuid;
BEGIN
  IF auth.uid() IS NULL OR v_branch_id IS NULL OR NOT public.user_may_access_branch(v_branch_id) THEN
    RAISE EXCEPTION 'PRODUCT_BRANCH_ACCESS_REQUIRED';
  END IF;
  IF public.can_permission('products.create') IS NOT TRUE OR (jsonb_typeof(p_items)='array' AND jsonb_array_length(p_items)>0 AND public.can_permission('recipes.manage') IS NOT TRUE) THEN
    RAISE EXCEPTION 'RECIPE_PERMISSION_REQUIRED';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'RAW_COMPONENT_REQUIRED';
  END IF;
  IF jsonb_typeof(v_attributes) IS DISTINCT FROM 'object' OR jsonb_typeof(v_links) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_COMPOSITION';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_links) AS i(unit_id uuid, quantity numeric)
    LEFT JOIN public.inventory_units u ON u.id=i.unit_id AND u.branch_id=v_branch_id AND u.is_active AND u.unit_type='manufactured'
    WHERE u.id IS NULL OR i.quantity IS NULL OR i.quantity <= 0 OR i.quantity::text IN ('NaN','Infinity','-Infinity')
  ) OR (SELECT count(DISTINCT i.unit_id) FROM jsonb_to_recordset(v_links) AS i(unit_id uuid)) <> jsonb_array_length(v_links) THEN
    RAISE EXCEPTION 'INVALID_MANUFACTURED_COMPONENT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS i(raw_material_id uuid, quantity numeric, wastage_percent numeric)
    LEFT JOIN public.raw_materials m ON m.id=i.raw_material_id AND m.branch_id=v_branch_id AND m.is_active
    WHERE m.id IS NULL OR m.unit_id IS NULL OR i.quantity IS NULL OR i.quantity <= 0
      OR i.quantity::text IN ('NaN','Infinity','-Infinity') OR coalesce(i.wastage_percent,0) < 0
      OR i.wastage_percent::text IN ('NaN','Infinity','-Infinity')
  ) OR (SELECT count(DISTINCT i.raw_material_id) FROM jsonb_to_recordset(p_items) AS i(raw_material_id uuid)) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'INVALID_DIRECT_RAW_COMPONENT';
  END IF;

  IF jsonb_typeof(v_legacy) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_LEGACY_COMPONENTS'; END IF;
  IF jsonb_array_length(v_legacy)>0 AND jsonb_array_length(p_items)+jsonb_array_length(v_links)>0 THEN RAISE EXCEPTION 'MIXED_LEGACY_COMPOSITION'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_legacy) i(component_product_id uuid,quantity numeric) LEFT JOIN public.products p ON p.id=i.component_product_id AND p.branch_id=v_branch_id AND p.is_active WHERE p.id IS NULL OR i.quantity IS NULL OR i.quantity<=0 OR i.quantity::text IN ('NaN','Infinity','-Infinity')) OR (SELECT count(DISTINCT i.component_product_id) FROM jsonb_to_recordset(v_legacy) i(component_product_id uuid))<>jsonb_array_length(v_legacy) THEN RAISE EXCEPTION 'INVALID_LEGACY_COMPONENTS'; END IF;
  v_result := public.create_product(
    p_name => p_product->>'p_name',
    p_branch_id => v_branch_id,
    p_name_en => p_product->>'p_name_en',
    p_barcode => p_product->>'p_barcode',
    p_sku => p_product->>'p_sku',
    p_category_id => (p_product->>'p_category_id')::uuid,
    p_description => p_product->>'p_description',
    p_image_url => p_product->>'p_image_url',
    p_cost_price => coalesce((p_product->>'p_cost_price')::numeric,0),
    p_sale_price => coalesce((p_product->>'p_sale_price')::numeric,0),
    p_wholesale_price => coalesce((p_product->>'p_wholesale_price')::numeric,0),
    p_low_stock_threshold => coalesce((p_product->>'p_low_stock_threshold')::integer,5),
    p_min_stock => coalesce((p_product->>'p_min_stock')::numeric,0),
    p_max_stock => coalesce((p_product->>'p_max_stock')::numeric,0),
    p_reorder_point => coalesce((p_product->>'p_reorder_point')::numeric,0),
    p_product_type => CASE WHEN jsonb_array_length(p_items)+jsonb_array_length(v_links)+jsonb_array_length(v_legacy)>0 THEN 'manufactured' ELSE 'ready' END,
    p_is_active => coalesce((p_product->>'p_is_active')::boolean,true),
    p_units => nullif(p_product->'p_units','null'::jsonb),
    p_unit_links => v_links
  );
  IF (v_result->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '%', coalesce(v_result->>'error','PRODUCT_CREATE_FAILED');
  END IF;

  v_product_id := (v_result->>'product_id')::uuid;
  IF v_attributes <> '{}'::jsonb THEN
    UPDATE public.products SET business_attributes=v_attributes WHERE id=v_product_id AND branch_id=v_branch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_ATTRIBUTES_NOT_SAVED'; END IF;
  END IF;

  IF jsonb_array_length(v_legacy)>0 THEN
    INSERT INTO public.product_components(product_id,component_product_id,quantity) SELECT v_product_id,i.component_product_id,i.quantity FROM jsonb_to_recordset(v_legacy) i(component_product_id uuid,quantity numeric);
    IF (SELECT count(*) FROM public.product_components WHERE product_id=v_product_id)<>jsonb_array_length(v_legacy) THEN RAISE EXCEPTION 'LEGACY_COMPONENTS_NOT_SAVED'; END IF;
  END IF;
  IF jsonb_array_length(p_items)>0 THEN
  INSERT INTO public.recipes(product_id,branch_id,name,yield_quantity,is_active)
  VALUES ((v_result->>'product_id')::uuid,v_branch_id,(p_product->>'p_name') || ' Components',1,true)
  RETURNING id INTO v_recipe_id;

  INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
  SELECT v_recipe_id,i.raw_material_id,i.quantity,coalesce(i.wastage_percent,0)
  FROM jsonb_to_recordset(p_items) AS i(raw_material_id uuid, quantity numeric, wastage_percent numeric);

  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_operational(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_operational(jsonb,jsonb) TO authenticated;


-- Controlled deletion of legacy BOM rows; public direct deletion remains denied by RLS.
CREATE FUNCTION private.replace_legacy_product_components(p_product_id uuid,p_branch_id uuid,p_expected jsonb,p_components jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $legacy_bom$
DECLARE v_current jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.can_permission('products.edit') IS NOT TRUE
    OR public.user_may_access_branch(p_branch_id) IS NOT TRUE THEN RAISE EXCEPTION 'LEGACY_EDIT_DENIED'; END IF;
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'array' OR jsonb_typeof(p_components) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_LEGACY_COMPONENTS'; END IF;
  -- Serialize graph edits in this branch through the controlled path.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('legacy-bom:'||p_branch_id::text,0));
  PERFORM 1 FROM public.products WHERE id=p_product_id AND branch_id=p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('component_product_id',component_product_id,'quantity',quantity) ORDER BY component_product_id),'[]'::jsonb)
    INTO v_current FROM public.product_components WHERE product_id=p_product_id;
  IF v_current IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'COMPOSITION_REFRESH_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_components) i(component_product_id uuid,quantity numeric)
    LEFT JOIN public.products p ON p.id=i.component_product_id AND p.branch_id=p_branch_id AND p.is_active
    WHERE p.id IS NULL OR p.id=p_product_id OR i.quantity IS NULL OR i.quantity<=0 OR i.quantity::text IN ('NaN','Infinity','-Infinity'))
    OR (SELECT count(DISTINCT i.component_product_id) FROM jsonb_to_recordset(p_components) i(component_product_id uuid))<>jsonb_array_length(p_components)
  THEN RAISE EXCEPTION 'INVALID_LEGACY_COMPONENTS'; END IF;
  IF jsonb_array_length(p_components)>0 AND (EXISTS(SELECT 1 FROM public.recipes WHERE product_id=p_product_id AND is_active)
     OR EXISTS(SELECT 1 FROM public.product_unit_links WHERE product_id=p_product_id)) THEN RAISE EXCEPTION 'MIXED_LEGACY_COMPOSITION'; END IF;
  IF EXISTS(WITH RECURSIVE reachable(id) AS (
      SELECT i.component_product_id FROM jsonb_to_recordset(p_components) i(component_product_id uuid)
      UNION SELECT c.component_product_id FROM public.product_components c JOIN reachable r ON r.id=c.product_id
    ) SELECT 1 FROM reachable WHERE id=p_product_id) THEN RAISE EXCEPTION 'LEGACY_COMPONENT_CYCLE'; END IF;
  DELETE FROM public.product_components WHERE product_id=p_product_id;
  INSERT INTO public.product_components(product_id,component_product_id,quantity)
    SELECT p_product_id,i.component_product_id,i.quantity FROM jsonb_to_recordset(p_components) i(component_product_id uuid,quantity numeric);
  IF (SELECT count(*) FROM public.product_components WHERE product_id=p_product_id)<>jsonb_array_length(p_components)
  THEN RAISE EXCEPTION 'LEGACY_COMPONENTS_NOT_SAVED'; END IF;
  UPDATE public.products SET product_type=CASE WHEN jsonb_array_length(p_components)>0 OR EXISTS(SELECT 1 FROM public.recipes WHERE product_id=p_product_id AND is_active) OR EXISTS(SELECT 1 FROM public.product_unit_links WHERE product_id=p_product_id) THEN 'manufactured' ELSE 'ready' END WHERE id=p_product_id AND branch_id=p_branch_id;
END; $legacy_bom$;
REVOKE ALL ON FUNCTION private.replace_legacy_product_components(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.replace_legacy_product_components(uuid,uuid,jsonb,jsonb) TO authenticated;

-- Atomic edit of metadata, units and all supported component kinds.
CREATE FUNCTION public.edit_product_operational_composition(
  p_product_id uuid,p_branch_id uuid,p_expected_version integer,p_expected_links jsonb,
  p_product jsonb,p_units jsonb,p_items jsonb,p_links jsonb,p_expected_legacy jsonb DEFAULT NULL,p_legacy jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_product public.products%ROWTYPE; v_next public.products%ROWTYPE; v_recipe public.recipes%ROWTYPE; v_result jsonb; v_recipe_id uuid; v_snapshot jsonb; v_legacy_count integer; v_raw_count integer; v_link_count integer;
BEGIN
  IF auth.uid() IS NULL OR public.can_permission('products.edit') IS NOT TRUE
     OR public.user_may_access_branch(p_branch_id) IS NOT TRUE OR (p_items IS NOT NULL AND public.can_permission('recipes.manage') IS NOT TRUE) THEN RAISE EXCEPTION 'COMPOSITION_EDIT_DENIED'; END IF;
  IF p_legacy IS NOT NULL THEN PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('legacy-bom:'||p_branch_id::text,0)); END IF;
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id AND branch_id=p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF jsonb_typeof(p_product) IS DISTINCT FROM 'object' OR (p_items IS NOT NULL AND jsonb_typeof(p_items) IS DISTINCT FROM 'array') OR (p_links IS NOT NULL AND (jsonb_typeof(p_links) IS DISTINCT FROM 'array' OR jsonb_typeof(p_expected_links) IS DISTINCT FROM 'array')) OR (p_legacy IS NOT NULL AND (jsonb_typeof(p_legacy) IS DISTINCT FROM 'array' OR jsonb_typeof(p_expected_legacy) IS DISTINCT FROM 'array')) THEN RAISE EXCEPTION 'INVALID_COMPOSITION'; END IF;
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
  IF p_items IS NOT NULL THEN
    IF (SELECT count(*) FROM public.recipes WHERE product_id=p_product_id AND branch_id=p_branch_id AND is_active)>1 THEN RAISE EXCEPTION 'MULTIPLE_ACTIVE_RECIPES'; END IF;
    SELECT * INTO v_recipe FROM public.recipes WHERE product_id=p_product_id AND branch_id=p_branch_id AND is_active FOR UPDATE;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('unit_id',unit_id,'quantity',quantity) ORDER BY unit_id),'[]'::jsonb) INTO v_snapshot
    FROM public.product_unit_links WHERE product_id=p_product_id;
  IF (p_items IS NOT NULL AND v_recipe.version IS DISTINCT FROM p_expected_version) OR (p_links IS NOT NULL AND v_snapshot IS DISTINCT FROM p_expected_links) THEN RAISE EXCEPTION 'COMPOSITION_REFRESH_REQUIRED'; END IF;
  v_raw_count:=coalesce(jsonb_array_length(p_items),(SELECT count(*)::int FROM public.recipes WHERE product_id=p_product_id AND is_active));
  v_link_count:=coalesce(jsonb_array_length(p_links),jsonb_array_length(v_snapshot));
  v_legacy_count:=coalesce(jsonb_array_length(p_legacy),(SELECT count(*)::int FROM public.product_components WHERE product_id=p_product_id));
  IF v_legacy_count>0 AND v_raw_count+v_link_count>0 THEN RAISE EXCEPTION 'MIXED_LEGACY_COMPOSITION'; END IF;
  v_next:=jsonb_populate_record(v_product,p_product);
  IF nullif(trim(v_next.name),'') IS NULL OR v_next.branch_id IS DISTINCT FROM p_branch_id
    OR v_next.cost_price<0 OR v_next.sale_price<0 OR v_next.wholesale_price<0
    OR v_next.low_stock_threshold<0 OR v_next.min_stock<0 OR v_next.max_stock<0 OR v_next.reorder_point<0
    OR v_next.cost_price::text IN ('NaN','Infinity','-Infinity') OR v_next.sale_price::text IN ('NaN','Infinity','-Infinity') OR v_next.wholesale_price::text IN ('NaN','Infinity','-Infinity')
    OR jsonb_typeof(v_next.business_attributes) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'INVALID_PRODUCT_METADATA'; END IF;
  UPDATE public.products SET name=trim(v_next.name),name_en=v_next.name_en,barcode=v_next.barcode,sku=v_next.sku,
    category_id=v_next.category_id,description=v_next.description,image_url=v_next.image_url,
    image_position_x=v_next.image_position_x,image_position_y=v_next.image_position_y,image_zoom=v_next.image_zoom,
    cost_price=v_next.cost_price,sale_price=v_next.sale_price,wholesale_price=v_next.wholesale_price,
    is_active=v_next.is_active,low_stock_threshold=v_next.low_stock_threshold,min_stock=v_next.min_stock,
    max_stock=v_next.max_stock,reorder_point=v_next.reorder_point,business_attributes=v_next.business_attributes,
    product_type=CASE WHEN v_raw_count+v_link_count+v_legacy_count>0 THEN 'manufactured' ELSE 'ready' END
    WHERE id=p_product_id AND branch_id=p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_SAVED'; END IF;
  IF p_units IS NOT NULL THEN
    v_result:=public.replace_product_units(p_product_id,p_units);
    IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'PRODUCT_UNITS_NOT_SAVED: %',v_result; END IF;
  END IF;
  IF p_links IS NOT NULL THEN
  DELETE FROM public.product_unit_links WHERE product_id=p_product_id;
  INSERT INTO public.product_unit_links(product_id,unit_id,quantity)
    SELECT p_product_id,i.unit_id,i.quantity FROM jsonb_to_recordset(p_links) i(unit_id uuid,quantity numeric);
  IF (SELECT count(*) FROM public.product_unit_links WHERE product_id=p_product_id)<>jsonb_array_length(p_links)
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_links) i(unit_id uuid,quantity numeric) WHERE NOT EXISTS
      (SELECT 1 FROM public.product_unit_links l WHERE l.product_id=p_product_id AND l.unit_id=i.unit_id AND l.quantity=round(i.quantity,4)))
  THEN RAISE EXCEPTION 'GROUP_LINKS_NOT_SAVED'; END IF;
  END IF;
  IF p_items IS NOT NULL THEN
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
    INSERT INTO public.recipes(product_id,branch_id,name,yield_quantity,is_active) VALUES(p_product_id,p_branch_id,trim(v_next.name)||' Components',1,true) RETURNING id INTO v_recipe_id;
    INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
      SELECT v_recipe_id,i.raw_material_id,i.quantity,coalesce(i.wastage_percent,0) FROM jsonb_to_recordset(p_items) i(raw_material_id uuid,quantity numeric,wastage_percent numeric);
  END IF;
  IF v_recipe_id IS NOT NULL AND ((SELECT count(*) FROM public.recipe_items WHERE recipe_id=v_recipe_id)<>jsonb_array_length(p_items)
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) i(raw_material_id uuid,quantity numeric,wastage_percent numeric) WHERE NOT EXISTS
       (SELECT 1 FROM public.recipe_items r WHERE r.recipe_id=v_recipe_id AND r.raw_material_id=i.raw_material_id AND r.quantity=round(i.quantity,4) AND r.wastage_percent=round(coalesce(i.wastage_percent,0),2))))
  THEN RAISE EXCEPTION 'RAW_COMPONENTS_NOT_SAVED'; END IF;
  END IF;
  IF p_legacy IS NOT NULL THEN PERFORM private.replace_legacy_product_components(p_product_id,p_branch_id,p_expected_legacy,p_legacy); END IF;
  RETURN jsonb_build_object('success',true,'product_id',p_product_id,'recipe_id',v_recipe_id);
END; $$;
REVOKE ALL ON FUNCTION public.edit_product_operational_composition(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.edit_product_operational_composition(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;


-- Atomic legacy product-only draft stock count edit.
-- Row-level locks require UPDATE privilege, which is deliberately revoked from clients.
-- Keep the privileged operation in a non-exposed schema, lock only an authorized draft,
-- never change data or return protected rows, and retain the existing client table ACLs.
CREATE FUNCTION private.lock_stock_count_draft_for_edit(p_count_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $count_lock$
DECLARE v_branch uuid; v_status text;
BEGIN
  IF auth.uid() IS NULL OR public.can_permission('inventory.count.create') IS NOT TRUE THEN
    RAISE EXCEPTION 'COUNT_EDIT_DENIED';
  END IF;
  SELECT c.branch_id,c.status INTO v_branch,v_status
    FROM public.stock_counts c WHERE c.id=p_count_id
      AND public.user_may_access_branch(c.branch_id) IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUNT_EDIT_DENIED'; END IF;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'COUNT_NOT_DRAFT'; END IF;
END; $count_lock$;
REVOKE ALL ON FUNCTION private.lock_stock_count_draft_for_edit(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.lock_stock_count_draft_for_edit(uuid) TO authenticated;

CREATE FUNCTION public.edit_stock_count_draft(p_count_id uuid,p_expected jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count public.stock_counts%ROWTYPE; v_snapshot jsonb; v_item record; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.can_permission('inventory.count.create') IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_EDIT_DENIED'; END IF;
  PERFORM private.lock_stock_count_draft_for_edit(p_count_id);
  SELECT * INTO v_count FROM public.stock_counts WHERE id=p_count_id;
  IF NOT FOUND OR public.user_may_access_branch(v_count.branch_id) IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_EDIT_DENIED'; END IF;
  IF v_count.status<>'draft' THEN RAISE EXCEPTION 'COUNT_NOT_DRAFT'; END IF;
  IF EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=p_count_id AND raw_material_id IS NOT NULL) THEN RAISE EXCEPTION 'RAW_COUNT_NOT_SUPPORTED'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_COUNT_LINES'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'counted_quantity',counted_quantity,'reason',reason) ORDER BY product_id),'[]'::jsonb) INTO v_snapshot FROM public.stock_count_items WHERE stock_count_id=p_count_id;
  IF v_snapshot IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'COUNT_REFRESH_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) i(product_id uuid,counted_quantity numeric,reason text)
    LEFT JOIN public.products p ON p.id=i.product_id AND p.branch_id=v_count.branch_id
    WHERE p.id IS NULL OR i.counted_quantity IS NULL OR i.counted_quantity<0 OR i.counted_quantity::text IN ('NaN','Infinity','-Infinity'))
    OR (SELECT count(DISTINCT i.product_id) FROM jsonb_to_recordset(p_items) i(product_id uuid))<>jsonb_array_length(p_items)
  THEN RAISE EXCEPTION 'INVALID_COUNT_LINES'; END IF;
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) i(product_id uuid,counted_quantity numeric,reason text) LOOP
    IF EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=p_count_id AND product_id=v_item.product_id) THEN
      v_result:=public.update_stock_count_item(p_count_id,v_item.product_id,v_item.counted_quantity,v_item.reason);
    ELSE
      v_result:=public.add_stock_count_item(p_count_id,v_item.product_id,v_item.counted_quantity,v_item.reason);
    END IF;
    IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_LINE_SAVE_FAILED: %',v_result; END IF;
  END LOOP;
  FOR v_item IN SELECT product_id FROM public.stock_count_items s WHERE s.stock_count_id=p_count_id AND NOT EXISTS
    (SELECT 1 FROM jsonb_to_recordset(p_items) i(product_id uuid) WHERE i.product_id=s.product_id) LOOP
    v_result:=public.remove_stock_count_item(p_count_id,v_item.product_id);
    IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_LINE_REMOVE_FAILED: %',v_result; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.stock_count_items WHERE stock_count_id=p_count_id)<>jsonb_array_length(p_items)
     OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) i(product_id uuid,counted_quantity numeric,reason text) WHERE NOT EXISTS
       (SELECT 1 FROM public.stock_count_items s WHERE s.stock_count_id=p_count_id AND s.product_id=i.product_id AND s.counted_quantity=round(i.counted_quantity,4) AND s.reason IS NOT DISTINCT FROM i.reason))
  THEN RAISE EXCEPTION 'COUNT_LINES_NOT_SAVED'; END IF;
  RETURN jsonb_build_object('success',true,'items_count',jsonb_array_length(p_items));
END; $$;
REVOKE ALL ON FUNCTION public.edit_stock_count_draft(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.edit_stock_count_draft(uuid,jsonb,jsonb) TO authenticated;



-- Atomic edit for raw-material, product and mixed draft counts.
-- No direct client table grants: the private function may write only scoped draft lines.
CREATE FUNCTION private.edit_stock_count_draft_items_internal(p_count_id uuid,p_expected jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $count_items$
DECLARE v_count public.stock_counts%ROWTYPE; v_snapshot jsonb; v_line record; v_result jsonb; v_qty numeric; v_cost numeric;
BEGIN
  IF auth.uid() IS NULL OR public.can_permission('inventory.count.create') IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_EDIT_DENIED'; END IF;
  PERFORM private.lock_stock_count_draft_for_edit(p_count_id);
  SELECT * INTO v_count FROM public.stock_counts WHERE id=p_count_id AND public.user_may_access_branch(branch_id) IS TRUE;
  IF NOT FOUND OR v_count.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'COUNT_EDIT_DENIED'; END IF;
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'array' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_COUNT_LINES'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('item_kind',CASE WHEN raw_material_id IS NOT NULL THEN 'raw_material' ELSE 'product' END,
    'item_id',coalesce(raw_material_id,product_id),'counted_quantity',counted_quantity,'reason',reason)
    ORDER BY CASE WHEN raw_material_id IS NOT NULL THEN 'raw_material' ELSE 'product' END,coalesce(raw_material_id,product_id)),'[]'::jsonb)
    INTO v_snapshot FROM public.stock_count_items WHERE stock_count_id=p_count_id;
  IF v_snapshot IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'COUNT_REFRESH_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) i(item_kind text,item_id uuid,counted_quantity numeric,reason text)
      WHERE i.item_kind IS NULL OR i.item_kind NOT IN ('raw_material','product') OR i.item_id IS NULL
      OR i.counted_quantity IS NULL OR i.counted_quantity<0 OR i.counted_quantity::text IN ('NaN','Infinity','-Infinity')
      OR (i.item_kind='raw_material' AND NOT EXISTS(SELECT 1 FROM public.raw_materials r WHERE r.id=i.item_id AND r.branch_id=v_count.branch_id AND r.is_active))
      OR (i.item_kind='product' AND NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=i.item_id AND p.branch_id=v_count.branch_id)))
    OR (SELECT count(DISTINCT (i.item_kind,i.item_id)) FROM jsonb_to_recordset(p_items) i(item_kind text,item_id uuid))<>jsonb_array_length(p_items)
  THEN RAISE EXCEPTION 'INVALID_COUNT_LINES'; END IF;
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_items) i(item_kind text,item_id uuid,counted_quantity numeric,reason text) LOOP
    IF v_line.item_kind='raw_material' THEN
      UPDATE public.stock_count_items SET counted_quantity=v_line.counted_quantity,reason=v_line.reason
       WHERE stock_count_id=p_count_id AND raw_material_id=v_line.item_id;
      IF NOT FOUND THEN
        SELECT quantity,avg_cost INTO v_qty,v_cost FROM public.raw_material_warehouse_inventory
          WHERE raw_material_id=v_line.item_id AND branch_id=v_count.branch_id AND warehouse_id=v_count.warehouse_id;
        INSERT INTO public.stock_count_items(stock_count_id,product_id,raw_material_id,system_quantity,counted_quantity,unit_cost,reason)
          VALUES(p_count_id,NULL,v_line.item_id,coalesce(v_qty,0),v_line.counted_quantity,coalesce(v_cost,0),v_line.reason);
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM public.stock_count_items WHERE stock_count_id=p_count_id AND product_id=v_line.item_id) THEN
        v_result:=public.update_stock_count_item(p_count_id,v_line.item_id,v_line.counted_quantity,v_line.reason);
      ELSE
        v_result:=public.add_stock_count_item(p_count_id,v_line.item_id,v_line.counted_quantity,v_line.reason);
      END IF;
      IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_LINE_SAVE_FAILED: %',v_result; END IF;
    END IF;
  END LOOP;
  FOR v_line IN SELECT s.raw_material_id,s.product_id FROM public.stock_count_items s
    WHERE s.stock_count_id=p_count_id AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) i(item_kind text,item_id uuid)
      WHERE (i.item_kind='raw_material' AND i.item_id=s.raw_material_id) OR (i.item_kind='product' AND i.item_id=s.product_id)) LOOP
    IF v_line.raw_material_id IS NOT NULL THEN
      DELETE FROM public.stock_count_items WHERE stock_count_id=p_count_id AND raw_material_id=v_line.raw_material_id;
    ELSE
      v_result:=public.remove_stock_count_item(p_count_id,v_line.product_id);
      IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_LINE_REMOVE_FAILED: %',v_result; END IF;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.stock_count_items WHERE stock_count_id=p_count_id)<>jsonb_array_length(p_items)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) i(item_kind text,item_id uuid,counted_quantity numeric,reason text)
      WHERE NOT EXISTS(SELECT 1 FROM public.stock_count_items s WHERE s.stock_count_id=p_count_id
        AND ((i.item_kind='raw_material' AND s.raw_material_id=i.item_id) OR (i.item_kind='product' AND s.product_id=i.item_id))
        AND s.counted_quantity=round(i.counted_quantity,4) AND s.reason IS NOT DISTINCT FROM i.reason))
  THEN RAISE EXCEPTION 'COUNT_LINES_NOT_SAVED'; END IF;
  RETURN jsonb_build_object('success',true,'items_count',jsonb_array_length(p_items));
END; $count_items$;
REVOKE ALL ON FUNCTION private.edit_stock_count_draft_items_internal(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.edit_stock_count_draft_items_internal(uuid,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.edit_stock_count_draft_items(p_count_id uuid,p_expected jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $count_api$
  SELECT private.edit_stock_count_draft_items_internal(p_count_id,p_expected,p_items);
$count_api$;
REVOKE ALL ON FUNCTION public.edit_stock_count_draft_items(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_stock_count_draft_items(uuid,jsonb,jsonb) TO authenticated;

-- Canonical reconciliation: do not deduct a debt already represented in its linked negative batch.
-- Preserve raw-material projection and debt diagnostics. Subtract only debt not already represented by its linked negative batch.
create or replace view private.canonical_inventory_balances
as
with warehouse_shape as (
  select
    branch_id,
    count(*)::int as warehouse_count,
    (array_agg(id order by id))[1] as single_warehouse_id
  from public.warehouses
  group by branch_id
),
raw_latest as (
  select distinct on (raw_material_id, branch_id)
    raw_material_id,
    branch_id,
    warehouse_id,
    after_qty,
    created_at,
    id
  from public.inventory_ledger
  where raw_material_id is not null
  order by raw_material_id, branch_id, created_at desc, id desc
),
raw_batches as (
  select
    raw_material_id,
    branch_id,
    sum(quantity)::numeric as batch_quantity
  from public.raw_material_batches
  group by raw_material_id, branch_id
),
raw_debts as (
  select
    raw_material_id,
    branch_id,
    sum(greatest(debt_quantity - settled_quantity, 0))::numeric as open_debt_quantity
  from public.raw_fifo_debts
  group by raw_material_id, branch_id
),
unit_entries as (
  select
    unit_id,
    branch_id,
    warehouse_id,
    sum(quantity)::numeric as movement_quantity
  from public.inventory_unit_entries
  group by unit_id, branch_id, warehouse_id
),
unit_batches as (
  select
    unit_id,
    branch_id,
    warehouse_id,
    sum(quantity)::numeric as batch_quantity
  from public.inventory_unit_batches
  group by unit_id, branch_id, warehouse_id
),
unit_debt_groups as (
  -- Aggregate first: several debts sharing a batch must not claim its negative
  -- quantity more than once.
  select unit_id, branch_id, warehouse_id, oversold_batch_id,
         sum(greatest(debt_quantity - settled_quantity, 0))::numeric as open_debt_quantity
  from public.inventory_unit_stock_debts
  group by unit_id, branch_id, warehouse_id, oversold_batch_id
),
unit_debts as (
  select d.unit_id, d.branch_id, d.warehouse_id,
    sum(d.open_debt_quantity)::numeric as open_debt_quantity,
    sum(greatest(d.open_debt_quantity - greatest(-coalesce(b.quantity, 0), 0), 0))::numeric as unrepresented_debt_quantity
  from unit_debt_groups d
  left join public.inventory_unit_batches b on b.id = d.oversold_batch_id
    and b.unit_id = d.unit_id and b.branch_id = d.branch_id and b.warehouse_id = d.warehouse_id
  group by d.unit_id, d.branch_id, d.warehouse_id
),
unit_keys as (
  select unit_id, branch_id, warehouse_id from unit_entries
  union
  select unit_id, branch_id, warehouse_id from unit_batches
  union
  select unit_id, branch_id, warehouse_id from unit_debts
)
select
  l.item_id,
  'RAW_MATERIAL'::text as inventory_kind,
  rmi.branch_id,
  case when ws.warehouse_count = 1 then ws.single_warehouse_id else null end as warehouse_id,
  rmi.quantity::numeric as quantity,
  coalesce(rb.batch_quantity, 0)::numeric as batch_quantity,
  coalesce(rd.open_debt_quantity, 0)::numeric as open_debt_quantity,
  rl.after_qty::numeric as movement_quantity,
  case
    when rl.after_qty is null then null
    else (rmi.quantity - rl.after_qty)::numeric
  end as movement_delta,
  (coalesce(rb.batch_quantity, 0) - coalesce(rd.open_debt_quantity, 0) - rmi.quantity)::numeric as batch_delta,
  'RAW_MATERIAL_INVENTORY'::text as balance_source,
  case
    when ws.warehouse_count = 1 then 'EXACT_SINGLE_WAREHOUSE'
    else 'LEGACY_BRANCH_ONLY'
  end::text as warehouse_scope,
  case
    when rl.after_qty is null then 'NO_LEDGER_SNAPSHOT'
    when abs(rmi.quantity - rl.after_qty) <= 0.000001 then 'MATCH'
    else 'MISMATCH'
  end::text as reconciliation_status,
  rmi.updated_at as updated_at
from public.raw_material_inventory rmi
join private.item_legacy_links l
  on l.source_table = 'raw_materials'
 and l.source_id = rmi.raw_material_id
left join warehouse_shape ws
  on ws.branch_id = rmi.branch_id
left join raw_latest rl
  on rl.raw_material_id = rmi.raw_material_id
 and rl.branch_id = rmi.branch_id
left join raw_batches rb
  on rb.raw_material_id = rmi.raw_material_id
 and rb.branch_id = rmi.branch_id
left join raw_debts rd
  on rd.raw_material_id = rmi.raw_material_id
 and rd.branch_id = rmi.branch_id

union all

select
  l.item_id,
  'SEMI_FINISHED'::text as inventory_kind,
  k.branch_id,
  k.warehouse_id,
  (coalesce(ub.batch_quantity, 0) - coalesce(ud.unrepresented_debt_quantity, 0))::numeric as quantity,
  coalesce(ub.batch_quantity, 0)::numeric as batch_quantity,
  coalesce(ud.open_debt_quantity, 0)::numeric as open_debt_quantity,
  coalesce(ue.movement_quantity, 0)::numeric as movement_quantity,
  (
    coalesce(ub.batch_quantity, 0)
    - coalesce(ud.unrepresented_debt_quantity, 0)
    - coalesce(ue.movement_quantity, 0)
  )::numeric as movement_delta,
  0::numeric as batch_delta,
  'INVENTORY_UNIT_BATCHES'::text as balance_source,
  'EXACT_WAREHOUSE'::text as warehouse_scope,
  case
    when abs(
      coalesce(ub.batch_quantity, 0)
      - coalesce(ud.unrepresented_debt_quantity, 0)
      - coalesce(ue.movement_quantity, 0)
    ) <= 0.000001 then 'MATCH'
    else 'MISMATCH'
  end::text as reconciliation_status,
  now() as updated_at
from unit_keys k
join private.item_legacy_links l
  on l.source_table = 'inventory_units'
 and l.source_id = k.unit_id
left join unit_entries ue
  on ue.unit_id = k.unit_id
 and ue.branch_id = k.branch_id
 and ue.warehouse_id = k.warehouse_id
left join unit_batches ub
  on ub.unit_id = k.unit_id
 and ub.branch_id = k.branch_id
 and ub.warehouse_id = k.warehouse_id
left join unit_debts ud
  on ud.unit_id = k.unit_id
 and ud.branch_id = k.branch_id
 and ud.warehouse_id = k.warehouse_id;

revoke all on table private.canonical_inventory_balances from public, anon, authenticated;
grant select on table private.canonical_inventory_balances to postgres, service_role;
