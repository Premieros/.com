-- Run ONLY against disposable staging after applying
-- 20261121120000_shared_sale_auto_raw_recipe.sql.
-- This test uses ROLLBACK, so test product/material/stock rows never persist.
BEGIN;
DO $test$
DECLARE
  v_branch uuid;
  v_warehouse uuid;
  v_product uuid;
  v_raw uuid;
  v_result jsonb;
  v_qty numeric;
  v_recipe_count integer;
BEGIN
  SELECT b.id,w.id INTO v_branch,v_warehouse
  FROM public.branches b JOIN public.warehouses w ON w.branch_id=b.id
  WHERE w.is_active ORDER BY b.id LIMIT 1;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURE_REQUIRES_BRANCH_AND_WAREHOUSE'; END IF;

  INSERT INTO public.products(name,branch_id,sale_price,cost_price)
  VALUES ('AUTO_RAW_SMOKE_'||gen_random_uuid()::text,v_branch,99,0)
  RETURNING id INTO v_product;

  v_result := public._ensure_sale_auto_raw_recipe(v_branch,v_product);
  IF v_result->>'action' <> 'auto_linked' THEN
    RAISE EXCEPTION 'AUTO_RECIPE_CREATE_FAILED: %',v_result;
  END IF;
  v_raw := (v_result->>'raw_material_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE id=v_raw AND branch_id=v_branch
                 AND name=(SELECT name FROM public.products WHERE id=v_product))
  THEN RAISE EXCEPTION 'RAW_NAME_OR_BRANCH_INCORRECT'; END IF;

  -- Idempotent mapping itself must not insert duplicates.
  PERFORM public._ensure_sale_auto_raw_recipe(v_branch,v_product);
  SELECT count(*) INTO v_recipe_count FROM public.recipes
  WHERE product_id=v_product AND branch_id=v_branch;
  IF v_recipe_count<>1 THEN RAISE EXCEPTION 'DUPLICATE_RECIPE: %',v_recipe_count; END IF;

  -- Check actual sale stock effect at zero opening inventory.
  v_result := public._deduct_sale_inventory_with_modifiers_core(
    v_branch,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2)),
    gen_random_uuid(),'AUTO-RAW-TEST'
  );
  IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'NEGATIVE_RAW_DEDUCTION_FAILED: %',v_result;
  END IF;
  SELECT COALESCE(SUM(quantity),0) INTO v_qty FROM public.raw_material_batches
  WHERE raw_material_id=v_raw AND branch_id=v_branch AND warehouse_id=v_warehouse;
  IF v_qty <> -2 THEN RAISE EXCEPTION 'EXPECTED_MINUS_TWO_GOT_%',v_qty; END IF;
  IF jsonb_array_length(v_result->'raw_materials_deducted') <> 1
     OR jsonb_array_length(v_result->'ready_products_deducted') <> 0 THEN
    RAISE EXCEPTION 'INCORRECT_DEDUCTION_SOURCE: %',v_result;
  END IF;
END $test$;
ROLLBACK;

-- Separate REQUIRED end-to-end gates (not covered by this unit smoke test):
-- process_sale with kitchen send and refund, concurrent same-order attempts,
-- partial void/return, no double accounting or stock entries, branch-scoped RLS,
-- persistence/retry behavior and QR activation. Do not deploy to production
-- until all pass on staging.