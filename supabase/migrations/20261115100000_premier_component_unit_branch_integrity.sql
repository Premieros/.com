-- Premier consolidated ERP branch integrity: component and unit links.
-- Intentionally preserves the existing authorization, RLS and work-authorization triggers.
-- Refuse cross-branch relationships and branch moves which would orphan relationships.
-- These checks are required because link tables do not carry their own branch_id.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.product_components c
    JOIN public.products p ON p.id = c.product_id
    JOIN public.products cp ON cp.id = c.component_product_id
    WHERE p.branch_id IS DISTINCT FROM cp.branch_id
  ) THEN RAISE EXCEPTION 'PREMIER_COMPONENT_BRANCH_BASELINE_MISMATCH'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_unit_links l
    JOIN public.products p ON p.id = l.product_id
    JOIN public.inventory_units u ON u.id = l.unit_id
    WHERE p.branch_id IS DISTINCT FROM u.branch_id
  ) THEN RAISE EXCEPTION 'PREMIER_PRODUCT_UNIT_BRANCH_BASELINE_MISMATCH'; END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.premier_assert_product_component_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE source_branch uuid; component_branch uuid;
BEGIN
  SELECT branch_id INTO source_branch
  FROM public.products WHERE id = NEW.product_id FOR SHARE;
  SELECT branch_id INTO component_branch
  FROM public.products WHERE id = NEW.component_product_id FOR SHARE;
  IF source_branch IS NULL OR component_branch IS NULL
     OR source_branch IS DISTINCT FROM component_branch THEN
    RAISE EXCEPTION 'PREMIER_COMPONENT_BRANCH_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.premier_assert_product_unit_link_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE source_branch uuid; linked_branch uuid;
BEGIN
  SELECT branch_id INTO source_branch
  FROM public.products WHERE id = NEW.product_id FOR SHARE;
  SELECT branch_id INTO linked_branch
  FROM public.inventory_units WHERE id = NEW.unit_id FOR SHARE;
  IF source_branch IS NULL OR linked_branch IS NULL
     OR source_branch IS DISTINCT FROM linked_branch THEN
    RAISE EXCEPTION 'PREMIER_PRODUCT_UNIT_BRANCH_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.premier_assert_product_branch_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_components l JOIN public.products other ON other.id=l.component_product_id
    WHERE l.product_id=NEW.id AND other.branch_id IS DISTINCT FROM NEW.branch_id
  ) OR EXISTS (
    SELECT 1 FROM public.product_components l JOIN public.products other ON other.id=l.product_id
    WHERE l.component_product_id=NEW.id AND other.branch_id IS DISTINCT FROM NEW.branch_id
  ) OR EXISTS (
    SELECT 1 FROM public.product_unit_links l JOIN public.inventory_units u ON u.id=l.unit_id
    WHERE l.product_id=NEW.id AND u.branch_id IS DISTINCT FROM NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'PREMIER_PRODUCT_BRANCH_MOVE_BREAKS_LINKS'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.premier_assert_inventory_unit_branch_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_unit_links l JOIN public.products p ON p.id=l.product_id
    WHERE l.unit_id=NEW.id AND p.branch_id IS DISTINCT FROM NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'PREMIER_INVENTORY_UNIT_BRANCH_MOVE_BREAKS_LINKS'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.premier_assert_product_component_branch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premier_assert_product_unit_link_branch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premier_assert_product_branch_move() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premier_assert_inventory_unit_branch_move() FROM PUBLIC, anon, authenticated;

DO $triggers$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.product_components'::regclass AND tgname='trg_premier_guard_product_component_branch' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_premier_guard_product_component_branch
      BEFORE INSERT OR UPDATE OF product_id, component_product_id ON public.product_components
      FOR EACH ROW EXECUTE FUNCTION public.premier_assert_product_component_branch();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.product_unit_links'::regclass AND tgname='trg_premier_guard_product_unit_link_branch' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_premier_guard_product_unit_link_branch
      BEFORE INSERT OR UPDATE OF product_id, unit_id ON public.product_unit_links
      FOR EACH ROW EXECUTE FUNCTION public.premier_assert_product_unit_link_branch();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.products'::regclass AND tgname='trg_premier_guard_product_branch_move' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_premier_guard_product_branch_move
      BEFORE UPDATE OF branch_id ON public.products
      FOR EACH ROW EXECUTE FUNCTION public.premier_assert_product_branch_move();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.inventory_units'::regclass AND tgname='trg_premier_guard_inventory_unit_branch_move' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_premier_guard_inventory_unit_branch_move
      BEFORE UPDATE OF branch_id ON public.inventory_units
      FOR EACH ROW EXECUTE FUNCTION public.premier_assert_inventory_unit_branch_move();
  END IF;
END $triggers$;
