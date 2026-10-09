-- Phase 1B: consolidate duplicate permissive kitchen INSERT/UPDATE policies
-- by preserving the exact previous OR semantics in one policy per command.

DROP POLICY IF EXISTS auth_insert_order_kitchen_sends ON public.order_kitchen_sends;
DROP POLICY IF EXISTS auth_write_order_kitchen_sends ON public.order_kitchen_sends;
DROP POLICY IF EXISTS auth_insert_order_kitchen_sends_combined ON public.order_kitchen_sends;

CREATE POLICY auth_insert_order_kitchen_sends_combined
ON public.order_kitchen_sends
FOR INSERT
TO authenticated
WITH CHECK (
  (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_kitchen_sends.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  )
  OR public.is_pos_admin()
  OR (
    branch_id = public.get_branch_id()
    AND public.can_permission('pos.send_kitchen')
  )
);

DROP POLICY IF EXISTS auth_update_order_kitchen_sends ON public.order_kitchen_sends;
DROP POLICY IF EXISTS auth_write_order_kitchen_sends_upd ON public.order_kitchen_sends;
DROP POLICY IF EXISTS auth_update_order_kitchen_sends_combined ON public.order_kitchen_sends;

CREATE POLICY auth_update_order_kitchen_sends_combined
ON public.order_kitchen_sends
FOR UPDATE
TO authenticated
USING (
  (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_kitchen_sends.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  )
  OR public.is_pos_admin()
  OR (
    branch_id = public.get_branch_id()
    AND public.can_permission('pos.send_kitchen')
  )
)
WITH CHECK (
  (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_kitchen_sends.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  )
  OR public.is_pos_admin()
  OR (
    branch_id = public.get_branch_id()
    AND public.can_permission('pos.send_kitchen')
  )
);
