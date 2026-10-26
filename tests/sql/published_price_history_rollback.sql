-- Regression: historical published prices are selected by transaction time.
-- Run on the .com clone inside a single SQL session. No lasting data is written.
BEGIN;
INSERT INTO public.raw_material_price_events (
 id,raw_material_id,branch_id,unit_cost,source,reference_number,priced_at
) VALUES
 ('00000000-0000-0000-0000-000000000801',
  '299a31db-74b6-4715-a497-369c5cf842a7',
  '19c3fd23-d784-455b-8840-f4f2ac619651',12,'pricing','TEST-PRICE-801',
  '2026-01-01T00:00:00Z'),
 ('00000000-0000-0000-0000-000000000802',
  '299a31db-74b6-4715-a497-369c5cf842a7',
  '19c3fd23-d784-455b-8840-f4f2ac619651',19,'pricing','TEST-PRICE-802',
  '2026-03-01T00:00:00Z');
DO $check$
DECLARE
  v_material uuid := '299a31db-74b6-4715-a497-369c5cf842a7';
  v_branch uuid := '19c3fd23-d784-455b-8840-f4f2ac619651';
  v_before jsonb;
  v_jan jsonb;
  v_mar jsonb;
BEGIN
  v_before:=private.raw_published_unit_cost_at_v2(v_material,v_branch,'2025-12-01'::timestamptz);
  v_jan:=private.raw_published_unit_cost_at_v2(v_material,v_branch,'2026-02-01'::timestamptz);
  v_mar:=private.raw_published_unit_cost_at_v2(v_material,v_branch,'2026-04-01'::timestamptz);
  IF (v_before->>'unit_cost')::numeric<>0
     OR v_before->>'source'<>'no_published_price'
     OR (v_jan->>'unit_cost')::numeric<>12
     OR (v_mar->>'unit_cost')::numeric<>19 THEN
    RAISE EXCEPTION 'AS_OF_PRICE_REGRESSION %, %, %',v_before,v_jan,v_mar;
  END IF;
END $check$;
ROLLBACK;
