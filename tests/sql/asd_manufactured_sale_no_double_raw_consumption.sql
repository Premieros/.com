-- ASD isolated regression. Must run on test database only; rolls back all inventory writes.
BEGIN;
DO $verify$
DECLARE v_result jsonb; v_unit numeric; v_flour numeric; v_sugar numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.product_unit_links
   WHERE product_id='ef450000-0000-4000-8000-000000000401'
     AND unit_id='ef450000-0000-4000-8000-000000000201' AND quantity=1) THEN
   RAISE EXCEPTION 'ASD_TEST_PRODUCT_LINK_MISSING';
 END IF;
 SELECT COALESCE(SUM(quantity),0) INTO v_unit FROM public.inventory_unit_batches
 WHERE unit_id='ef450000-0000-4000-8000-000000000201' AND warehouse_id='9ea3fc07-7294-4107-ac77-1bfabc2cea03';
 IF v_unit<>10 THEN RAISE EXCEPTION 'EXPECTED_TEST_OPENING_10_GOT_%',v_unit; END IF;
 v_result:=public.deduct_sale_unit_inventory(
 '6359fb0e-456c-47bc-ab7b-28dd4b91a34a',
 '9ea3fc07-7294-4107-ac77-1bfabc2cea03',
 '[{"product_id":"ef450000-0000-4000-8000-000000000401","quantity":1}]'::jsonb,
 'ef450000-0000-4000-8000-000000000998','ASD-DEMO-SALE-ROLLBACK');
 IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'DEMO_SALE_DEDUCTION_FAILED %',v_result;
 END IF;
 SELECT COALESCE(SUM(quantity),0) INTO v_unit FROM public.inventory_unit_batches WHERE unit_id='ef450000-0000-4000-8000-000000000201' AND warehouse_id='9ea3fc07-7294-4107-ac77-1bfabc2cea03';
 SELECT COALESCE(SUM(quantity),0) INTO v_flour FROM public.raw_material_batches WHERE raw_material_id='ef450000-0000-4000-8000-000000000101' AND warehouse_id='9ea3fc07-7294-4107-ac77-1bfabc2cea03';
 SELECT COALESCE(SUM(quantity),0) INTO v_sugar FROM public.raw_material_batches WHERE raw_material_id='ef450000-0000-4000-8000-000000000102' AND warehouse_id='9ea3fc07-7294-4107-ac77-1bfabc2cea03';
 IF v_unit<>9 OR v_flour<>80 OR v_sugar<>40 THEN RAISE EXCEPTION 'DOUBLE_RAW_DEDUCTION_OR_WRONG_UNIT_STOCK %,%,%',v_unit,v_flour,v_sugar; END IF;
END $verify$;
ROLLBACK;