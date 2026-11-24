-- BUNKER demo-catalog station split, MANUAL OPERATOR RUNBOOK ONLY.
-- Do not add this file to supabase/migrations or execute automatically.
-- Intended: food/desserts/sides -> station code "kit" (مطبخ);
-- hot/iced coffee -> station code "بار" (بار).
-- Confirm that the actual barista display uses station "بار" before applying.
-- This guarded transaction refuses to run while ANY order with a kitchen send
-- remains open/held. It also refuses unexpected categories or changed mappings.
BEGIN;

DO $$
DECLARE
  v_branch uuid := 'd56aae83-f1b3-4153-9224-87594500368d'::uuid;
  v_main uuid;
  v_kitchen uuid;
  v_bar uuid;
  v_changed integer;
BEGIN
  -- Prevent concurrent station remaps that use this same lock.
  -- This does NOT synchronize ordinary order writers. Historical script only:
  -- never execute without an approved maintenance window with order intake stopped.
  PERFORM pg_advisory_xact_lock(hashtextextended('bunker-demo-station-routing:' || v_branch::text, 0));
  SELECT id INTO STRICT v_main FROM public.kitchen_stations
   WHERE branch_id=v_branch AND code='main' AND is_active;
  SELECT id INTO STRICT v_kitchen FROM public.kitchen_stations
   WHERE branch_id=v_branch AND code='kit' AND is_active;
  SELECT id INTO STRICT v_bar FROM public.kitchen_stations
   WHERE branch_id=v_branch AND code='بار' AND is_active;

  -- Already-sent open orders could move between KDS views if categories change.
  IF EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.order_kitchen_sends oks ON oks.order_id=o.id AND oks.branch_id=v_branch
    WHERE o.branch_id=v_branch AND o.status IN ('open','held')
  ) THEN RAISE EXCEPTION 'BUNKER_ACTIVE_SENT_ORDERS_REQUIRE_WORKFLOW_CLOSURE'; END IF;

  IF (SELECT COUNT(*) FROM public.categories WHERE branch_id=v_branch) <> 5
     OR (SELECT COUNT(*) FROM public.categories WHERE branch_id=v_branch
         AND name IN ('Hot Coffee','Iced Coffee','Burgers','Sides','Desserts')) <> 5
  THEN RAISE EXCEPTION 'BUNKER_DEMO_CATEGORIES_CHANGED'; END IF;

  -- Rerun is safe only when every category is currently either at main
  -- or already at the exact intended station.
  IF EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.branch_id=v_branch
      AND (c.kitchen_station_id IS NULL OR c.kitchen_station_id NOT IN (
        v_main, CASE WHEN c.name IN ('Hot Coffee','Iced Coffee') THEN v_bar ELSE v_kitchen END
      ))
  ) THEN RAISE EXCEPTION 'BUNKER_UNEXPECTED_EXISTING_ROUTING'; END IF;

  UPDATE public.categories c
  SET kitchen_station_id=CASE WHEN c.name IN ('Hot Coffee','Iced Coffee') THEN v_bar ELSE v_kitchen END
  WHERE c.branch_id=v_branch
    AND c.name IN ('Hot Coffee','Iced Coffee','Burgers','Sides','Desserts')
    AND c.kitchen_station_id IS DISTINCT FROM
      CASE WHEN c.name IN ('Hot Coffee','Iced Coffee') THEN v_bar ELSE v_kitchen END;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RAISE NOTICE 'BUNKER categories rerouted: %', v_changed;
END $$;

-- Verify in SAME transaction before final commit.
SELECT c.name, s.code AS station_code
FROM public.categories c
JOIN public.kitchen_stations s ON s.id=c.kitchen_station_id AND s.branch_id=c.branch_id
WHERE c.branch_id='d56aae83-f1b3-4153-9224-87594500368d'::uuid
ORDER BY c.name;
COMMIT;

-- Rollback notes: restore the five recorded category->station UUID assignments
-- from the signed prechange snapshot, only when no later open sent orders exist.
-- Never run blanket DELETE on orders, sends, payments, or financial ledger rows.
