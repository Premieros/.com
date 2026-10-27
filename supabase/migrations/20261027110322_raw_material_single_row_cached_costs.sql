-- One cached published cost per raw material and branch. Missing price = 0.
CREATE TABLE IF NOT EXISTS public.raw_material_current_costs (
  raw_material_id uuid PRIMARY KEY REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  price_event_id uuid,
  priced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_material_current_costs_nonnegative CHECK (unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS idx_raw_current_cost_branch ON public.raw_material_current_costs(branch_id);
ALTER TABLE public.raw_material_current_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raw_material_current_costs FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public._refresh_one_raw_current_cost(p_raw_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid; v_cost numeric; v_id uuid; v_at timestamptz;
BEGIN
 SELECT branch_id INTO v_branch FROM public.raw_materials WHERE id=p_raw_id;
 IF v_branch IS NULL THEN
   DELETE FROM public.raw_material_current_costs WHERE raw_material_id=p_raw_id;
   RETURN;
 END IF;
 SELECT e.id, e.unit_cost, e.priced_at INTO v_id, v_cost, v_at
 FROM public.raw_material_price_events e
 WHERE e.raw_material_id=p_raw_id AND e.branch_id=v_branch AND e.priced_at<=now()
 ORDER BY e.priced_at DESC,e.id DESC LIMIT 1;
 INSERT INTO public.raw_material_current_costs(raw_material_id,branch_id,unit_cost,price_event_id,priced_at,updated_at)
 VALUES (p_raw_id,v_branch,coalesce(v_cost,0),v_id,v_at,now())
 ON CONFLICT(raw_material_id) DO UPDATE SET branch_id=excluded.branch_id,
 unit_cost=excluded.unit_cost,price_event_id=excluded.price_event_id,priced_at=excluded.priced_at,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public._refresh_one_raw_current_cost(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public._raw_cost_price_event_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM public._refresh_one_raw_current_cost(OLD.raw_material_id); END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN PERFORM public._refresh_one_raw_current_cost(NEW.raw_material_id); END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_raw_current_cost_price_event ON public.raw_material_price_events;
CREATE TRIGGER trg_raw_current_cost_price_event AFTER INSERT OR UPDATE OR DELETE ON public.raw_material_price_events
FOR EACH ROW EXECUTE FUNCTION public._raw_cost_price_event_change();
CREATE OR REPLACE FUNCTION public._raw_cost_material_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public._refresh_one_raw_current_cost(NEW.id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_raw_current_cost_material ON public.raw_materials;
CREATE TRIGGER trg_raw_current_cost_material AFTER INSERT OR UPDATE OF branch_id ON public.raw_materials
FOR EACH ROW EXECUTE FUNCTION public._raw_cost_material_change();
INSERT INTO public.raw_material_current_costs(raw_material_id,branch_id,unit_cost,price_event_id,priced_at)
SELECT r.id,r.branch_id,coalesce(e.unit_cost,0),e.id,e.priced_at
FROM public.raw_materials r
LEFT JOIN LATERAL (
 SELECT pe.id,pe.unit_cost,pe.priced_at FROM public.raw_material_price_events pe
 WHERE pe.raw_material_id=r.id AND pe.branch_id=r.branch_id AND pe.priced_at<=now()
 ORDER BY pe.priced_at DESC,pe.id DESC LIMIT 1
) e ON true
ON CONFLICT(raw_material_id) DO UPDATE SET branch_id=excluded.branch_id,unit_cost=excluded.unit_cost,
price_event_id=excluded.price_event_id,priced_at=excluded.priced_at,updated_at=now();
CREATE OR REPLACE VIEW public.v_stock_current_costs AS
SELECT 'raw'::text item_type,r.id item_id,r.branch_id,r.name item_name,
coalesce(c.unit_cost,0::numeric) unit_cost,c.priced_at cost_effective_at,
CASE WHEN c.price_event_id IS NULL THEN 'no_published_price_zero'::text ELSE 'published_raw_price'::text END cost_source
FROM public.raw_materials r LEFT JOIN public.raw_material_current_costs c ON c.raw_material_id=r.id
UNION ALL
SELECT 'product'::text,p.id,p.branch_id,p.name,coalesce(p.cost_price,0::numeric),NULL::timestamptz,'product_catalog_cost'::text FROM public.products p
UNION ALL
SELECT 'manufactured'::text,u.id,u.branch_id,u.name,coalesce(u.cost_price,0::numeric),NULL::timestamptz,'inventory_unit_catalog_cost'::text FROM public.inventory_units u;