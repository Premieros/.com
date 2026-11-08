-- Premier / Premieros/.com — branch-scoped operational reconciliation
-- 2026-11-08. SELECT-only: NEVER auto-replay print jobs or rewrite stock.
-- Verified read-only on canonical Supabase hvqlkapynjfjikqithvd.
-- Each nonzero row needs underlying order/ledger/physical printer evidence.
WITH
stock AS (
 SELECT branch_id,inventory_kind,count(*)::int AS qty,
        round(sum(abs(coalesce(movement_delta,0))),4) AS movement_abs,
        round(sum(abs(coalesce(batch_delta,0))),4) AS batch_abs
 FROM private.canonical_inventory_balances
 WHERE reconciliation_status IS DISTINCT FROM 'MATCH'
 GROUP BY 1,2
),
print_queue AS (
 SELECT branch_id,kind,station_code,count(*)::int AS qty,
        count(*) FILTER(WHERE status='pending' AND attempts=0 AND claimed_agent_id IS NULL)::int AS never_claimed,
        min(created_at) AS oldest_at
 FROM public.cloud_print_jobs
 WHERE status IN ('pending','claimed','printing')
   AND created_at < now()-interval '10 minutes'
 GROUP BY 1,2,3
),
table_state AS (
 SELECT t.branch_id,
 count(*) FILTER(
   WHERE lower(coalesce(t.status,'')) IN ('vacant','available','free')
     AND EXISTS (
       SELECT 1 FROM public.orders o
       WHERE o.table_id=t.id AND o.status IN ('open','held')
         AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0)
     )
 )::int AS vacant_with_order,
 count(*) FILTER(
   WHERE lower(coalesce(t.status,''))='occupied'
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
       WHERE o.table_id=t.id AND o.status IN ('open','held')
         AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0)
     )
 )::int AS occupied_without_order
 FROM public.dining_tables t GROUP BY t.branch_id
),
kitchen_sends AS (
 SELECT order_item_id,sum(sent_quantity)::numeric sent_qty
 FROM public.order_kitchen_sends GROUP BY 1
),
kitchen_pending AS (
 SELECT order_item_id,
   coalesce(sum(greatest(sent_quantity-voided_quantity,0))
            FILTER(WHERE settled_sale_id IS NULL),0)::numeric pending_qty
 FROM public.order_kitchen_inventory_events GROUP BY 1
),
kitchen_state AS (
 SELECT o.branch_id,count(*)::int AS qty
 FROM public.order_items oi
 JOIN public.orders o ON o.id=oi.order_id AND o.status IN ('open','held')
 LEFT JOIN kitchen_sends s ON s.order_item_id=oi.id
 LEFT JOIN kitchen_pending p ON p.order_item_id=oi.id
 WHERE abs(coalesce(s.sent_qty,0)-coalesce(p.pending_qty,0))>0.0001
 GROUP BY 1
),
issues AS (
 SELECT branch_id,'canonical_inventory_'||inventory_kind AS issue,'BLOCK' AS severity,
        qty AS affected,jsonb_build_object('abs_movement_delta',movement_abs,'abs_batch_delta',batch_abs) AS detail
 FROM stock
 UNION ALL
 SELECT branch_id,'stale_print_'||kind||'_'||station_code,'REVIEW',qty,
        jsonb_build_object('never_claimed',never_claimed,'oldest_at',oldest_at)
 FROM print_queue
 UNION ALL
 SELECT branch_id,'vacant_table_with_active_order','REVIEW',vacant_with_order,'{}'::jsonb
 FROM table_state WHERE vacant_with_order>0
 UNION ALL
 SELECT branch_id,'occupied_table_without_active_order','REVIEW',occupied_without_order,'{}'::jsonb
 FROM table_state WHERE occupied_without_order>0
 UNION ALL
 SELECT branch_id,'kitchen_pending_send_mismatch','BLOCK',qty,'{}'::jsonb
 FROM kitchen_state
)
SELECT b.name AS branch,i.issue,i.severity,i.affected,i.detail
FROM issues i JOIN public.branches b ON b.id=i.branch_id
WHERE i.affected>0
ORDER BY i.severity,i.issue,b.name;
