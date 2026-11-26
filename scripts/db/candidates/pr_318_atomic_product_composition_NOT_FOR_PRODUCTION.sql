-- PR 318 disposable test candidate; do not deploy or call from production.
-- Existing invoker/RLS contract; create_product owns its existing permission checks.
-- No exception handler swallows downstream failures: one RPC transaction rolls back all writes.
-- Reuse the product creation contract and recipe RLS in one transaction.
CREATE FUNCTION public.pr318_create_product_composition_candidate(p_product jsonb, p_items jsonb)
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
  v_branch_id uuid := (p_product->>'p_branch_id')::uuid;
BEGIN
  IF auth.uid() IS NULL OR v_branch_id IS NULL OR NOT public.user_may_access_branch(v_branch_id) THEN
    RAISE EXCEPTION 'PRODUCT_BRANCH_ACCESS_REQUIRED';
  END IF;
  IF NOT public.can_permission('products.create') OR NOT public.can_permission('recipes.manage') THEN
    RAISE EXCEPTION 'RECIPE_PERMISSION_REQUIRED';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
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
    p_product_type => 'manufactured',
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

  INSERT INTO public.recipes(product_id,branch_id,name,yield_quantity,is_active)
  VALUES ((v_result->>'product_id')::uuid,v_branch_id,(p_product->>'p_name') || ' Components',1,true)
  RETURNING id INTO v_recipe_id;

  INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
  SELECT v_recipe_id,i.raw_material_id,i.quantity,coalesce(i.wastage_percent,0)
  FROM jsonb_to_recordset(p_items) AS i(raw_material_id uuid, quantity numeric, wastage_percent numeric);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.pr318_create_product_composition_candidate(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pr318_create_product_composition_candidate(jsonb,jsonb) TO authenticated;
