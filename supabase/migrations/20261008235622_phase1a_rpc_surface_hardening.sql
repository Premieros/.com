-- Phase 1A: harden the public RPC surface without changing supported business APIs.

REVOKE EXECUTE ON FUNCTION public._raw_inventory_actual_avg_cost_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._raw_price_oversold_batch_from_fifo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.treasury_accounts_fill_model_defaults() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._effective_branch_tax(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._normalize_raw_purchase_uom(uuid,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._normalize_thermal_print_payload(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._product_inv_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._product_inv_move(uuid,uuid,uuid,uuid,numeric,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._product_inv_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._treasury_guard(uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;
