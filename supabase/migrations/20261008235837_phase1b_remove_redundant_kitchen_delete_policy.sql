-- Phase 1B: remove a redundant permissive DELETE policy.
-- auth_delete_order_kitchen_sends used USING (false), so it never granted access.
-- auth_write_order_kitchen_sends_del remains the effective DELETE policy.

DROP POLICY IF EXISTS auth_delete_order_kitchen_sends ON public.order_kitchen_sends;
