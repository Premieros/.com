-- Publish new completed-purchase raw prices only, without retroactive revaluation.
ALTER TABLE public.raw_material_price_events DROP CONSTRAINT IF EXISTS raw_material_price_events_source_check;
ALTER TABLE public.raw_material_price_events
 ADD CONSTRAINT raw_material_price_events_source_check CHECK (source IN ('pricing','purchase'));
CREATE OR REPLACE FUNCTION public._publish_completed_purchase_raw_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_purchase record;
BEGIN
 IF NEW.raw_material_id IS NULL OR NEW.unit_cost IS NULL OR NEW.unit_cost < 0 THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.raw_material_id IS NOT DISTINCT FROM OLD.raw_material_id
  AND NEW.unit_cost IS NOT DISTINCT FROM OLD.unit_cost THEN RETURN NEW; END IF;
 SELECT id,branch_id,invoice_number,status INTO v_purchase FROM public.purchases WHERE id=NEW.purchase_id;
 IF v_purchase.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.raw_materials r WHERE r.id=NEW.raw_material_id AND r.branch_id=v_purchase.branch_id) THEN
   RAISE EXCEPTION 'RAW_PURCHASE_BRANCH_MISMATCH';
 END IF;
 INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,detail,priced_at,created_by)
 VALUES (NEW.raw_material_id,v_purchase.branch_id,NEW.unit_cost,'purchase',
  coalesce(v_purchase.invoice_number,v_purchase.id::text),
  'purchase_item:'||NEW.id::text,clock_timestamp(),NULL);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_publish_completed_purchase_raw_price ON public.purchase_items;
CREATE TRIGGER trg_publish_completed_purchase_raw_price AFTER INSERT OR UPDATE OF unit_cost,raw_material_id ON public.purchase_items
FOR EACH ROW EXECUTE FUNCTION public._publish_completed_purchase_raw_price();
