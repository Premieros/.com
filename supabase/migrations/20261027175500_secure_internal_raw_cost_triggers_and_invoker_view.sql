REVOKE EXECUTE ON FUNCTION public._publish_completed_purchase_raw_price() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._raw_cost_material_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._raw_cost_price_event_change() FROM PUBLIC, anon, authenticated;
ALTER VIEW public.v_stock_current_costs SET (security_invoker = true);
