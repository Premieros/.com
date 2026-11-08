-- Premier source-lineage diagnosis, READ-ONLY. Verified on original project.
-- Classification is NOT a fix or permission to zero a discrepancy.
-- Phase 3B architecture explicitly uses latest ledger.after_qty rather than
-- sum(ledger.quantity), because import/opening flows may reset the baseline.
-- The signed ledger SUM is returned ONLY as corroborating evidence.
WITH affected AS (
 SELECT item_id,inventory_kind,branch_id,warehouse_id,quantity,batch_quantity,
        open_debt_quantity,movement_quantity,batch_delta,movement_delta,reconciliation_status
 FROM private.canonical_inventory_balances
 WHERE reconciliation_status IS DISTINCT FROM 'MATCH'
),
raw_ledger_totals AS (
 SELECT branch_id,warehouse_id,raw_material_id,count(*)::int AS ledger_rows,
        sum(quantity) AS signed_ledger_sum,min(created_at) AS first_ledger_at,
        max(created_at) AS last_ledger_at
 FROM public.inventory_ledger WHERE raw_material_id IS NOT NULL
 GROUP BY 1,2,3
)
SELECT b.name AS branch,a.inventory_kind,a.item_id,a.warehouse_id,
       l.source_table,COALESCE(r.name,u.name,'UNKNOWN') AS item_name,
       a.quantity,a.batch_quantity,a.open_debt_quantity,
       a.movement_quantity,a.batch_delta,a.movement_delta,
       h.signed_ledger_sum,h.ledger_rows,h.first_ledger_at,h.last_ledger_at,
       CASE
         WHEN a.inventory_kind='RAW_MATERIAL'
              AND h.ledger_rows>0
              AND abs(a.quantity-h.signed_ledger_sum)<=0.0001
              AND abs(a.quantity-a.batch_quantity)<=0.0001
           THEN 'LATEST_SNAPSHOT_DISAGREES_WITH_CONSISTENT_SUMS'
         WHEN a.inventory_kind='SEMI_FINISHED'
              AND a.open_debt_quantity>0
              AND abs(a.batch_quantity-a.movement_quantity)<=0.0001
              AND abs(a.movement_delta+a.open_debt_quantity)<=0.0001
           THEN 'POSSIBLE_DEBT_DOUBLE_SUBTRACTION_IN_PROJECTION'
         ELSE 'REQUIRES_SOURCE_DOCUMENT_RECONCILIATION'
       END AS triage_class
FROM affected a
JOIN public.branches b ON b.id=a.branch_id
LEFT JOIN private.item_legacy_links l
       ON l.item_id=a.item_id
      AND l.source_table IN ('raw_materials','inventory_units')
LEFT JOIN public.raw_materials r
       ON r.id=l.source_id AND l.source_table='raw_materials'
LEFT JOIN public.inventory_units u
       ON u.id=l.source_id AND l.source_table='inventory_units'
LEFT JOIN raw_ledger_totals h
       ON a.inventory_kind='RAW_MATERIAL'
      AND h.branch_id=a.branch_id AND h.warehouse_id=a.warehouse_id
      AND h.raw_material_id=l.source_id
ORDER BY a.inventory_kind,b.name,abs(a.movement_delta) DESC;
