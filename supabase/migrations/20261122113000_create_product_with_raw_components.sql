-- Reuse the product creation contract and recipe RLS in one transaction.
CREATE FUNCTION public.create_product_with_raw_components(p_product jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_recipe_id uuid;
  v_branch_id uuid := (p_product->>'p_branch_id')::uuid;
BEGIN
  IF NOT public.can_permission('recipes.manage') THEN
    RAISE EXCEPTION 'RECIPE_PERMISSION_REQUIRED';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'RAW_COMPONENT_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS i(raw_material_id uuid, quantity numeric, wastage_percent numeric)
    LEFT JOIN public.raw_materials m ON m.id=i.raw_material_id AND m.branch_id=v_branch_id AND m.is_active
    WHERE m.id IS NULL OR m.unit_id IS NULL OR i.quantity IS NULL OR i.quantity <= 0
      OR coalesce(i.wastage_percent,0) < 0
  ) OR (SELECT count(DISTINCT value->>'raw_material_id') FROM jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) THEN
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
    p_units => nullif(p_product->'p_units','null'::jsonb)
  );
  IF (v_result->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '%', coalesce(v_result->>'error','PRODUCT_CREATE_FAILED');
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

REVOKE ALL ON FUNCTION public.create_product_with_raw_components(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_raw_components(jsonb,jsonb) TO authenticated;
