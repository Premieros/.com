-- Smouha raw FIFO purchase-correction lineage — READ ONLY.
-- Canonical project: hvqlkapynjfjikqithvd.
-- This script contains SELECT statements ONLY. No updates, balance fixes,
-- posting changes, temporary table writes or calls to mutating functions.
--
-- Scope: branch 19c3fd23-d784-455b-8840-f4f2ac619651
--        material 03d6381d-b2f9-489e-b536-dc2b88c5767b.
-- Run against production only as an operator-authorized READ ONLY audit.
-- Do not convert any of these observations directly into a journal or stock fix.

-- 1. Operational/batch/debt quantities and the unmatched delta.
SELECT rm.name raw_material_name, br.name branch_name,
       ri.quantity AS operational_quantity,
       (SELECT COALESCE(SUM(b.quantity),0)
          FROM public.raw_material_batches b
         WHERE b.raw_material_id=ri.raw_material_id AND b.branch_id=ri.branch_id) AS batch_quantity,
       (SELECT COALESCE(SUM(d.debt_quantity-d.settled_quantity),0)
          FROM public.raw_fifo_debts d
         WHERE d.raw_material_id=ri.raw_material_id AND d.branch_id=ri.branch_id) AS open_fifo_debt,
       (SELECT COALESCE(SUM(b.quantity),0)
          FROM public.raw_material_batches b
         WHERE b.raw_material_id=ri.raw_material_id AND b.branch_id=ri.branch_id)
       - ri.quantity AS batch_minus_operational
  FROM public.raw_material_inventory ri
  JOIN public.raw_materials rm ON rm.id=ri.raw_material_id
  JOIN public.branches br ON br.id=ri.branch_id
 WHERE ri.raw_material_id='03d6381d-b2f9-489e-b536-dc2b88c5767b'
   AND ri.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651';

-- 2. Source and revised invoices, with item-level quantities and return data.
SELECT p.id purchase_id,p.invoice_number,p.status,p.created_at,
       p.total,p.returned_amount, pi.raw_material_id,pi.quantity,
       pi.unit_cost,pi.returned_quantity
  FROM public.purchases p
  JOIN public.purchase_items pi ON pi.purchase_id=p.id
 WHERE p.id IN ('bd102e26-370e-4cc1-a357-9e5e25702781',
                '3cece2d0-1c09-40fd-a512-eb37e27a97dc')
   AND pi.raw_material_id='03d6381d-b2f9-489e-b536-dc2b88c5767b'
 ORDER BY p.invoice_number,p.id;

-- 3. Stock ledger presence and absence. Do not infer that returned purchase
--    stock was reversed merely from purchases.status or journal existence.
SELECT l.id,l.entry_type,l.reference_type,l.reference_id,l.reference_number,
       l.quantity,l.unit_cost,l.total_cost,l.before_qty,l.after_qty,l.created_at
  FROM public.inventory_ledger l
 WHERE l.raw_material_id='03d6381d-b2f9-489e-b536-dc2b88c5767b'
   AND l.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'
 ORDER BY l.created_at,l.id;

-- 4. Open FIFO debts and applied receipt settlements, including both 0.3000
--    receipts linked to the same historic sale debt.
SELECT d.id debt_id,d.source_ledger_id,d.reference_type debt_reference_type,
       d.reference_number debt_reference_number,d.debt_quantity,d.settled_quantity,
       s.id settlement_id,s.receipt_ledger_id,s.receipt_batch_id,
       s.quantity settlement_quantity,s.unit_cost,s.total_cost,
       s.reconciliation_status,s.created_at settlement_created_at
  FROM public.raw_fifo_debts d
  LEFT JOIN public.raw_fifo_settlements s ON s.debt_id=d.id
 WHERE d.raw_material_id='03d6381d-b2f9-489e-b536-dc2b88c5767b'
   AND d.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'
 ORDER BY d.source_created_at,s.created_at,s.id;

-- 5. Journal entries using either the original/replacement purchase id or
--    the invoice display number. A purchase_return row with reference_id=NULL
--    is name-correlated but not proof of authoritative document linkage.
SELECT j.id,j.entry_number,j.entry_date,j.reference_type,j.reference_id,
       j.reference_number,j.posting_status,j.reversal_of,
       COALESCE(SUM(l.debit),0) journal_debits,
       COALESCE(SUM(l.credit),0) journal_credits
  FROM public.journal_entries j
  LEFT JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
 WHERE j.reference_id IN ('bd102e26-370e-4cc1-a357-9e5e25702781',
                          '3cece2d0-1c09-40fd-a512-eb37e27a97dc')
    OR j.reference_number = 'Johna''s-00103'
 GROUP BY j.id
 ORDER BY j.entry_date,j.entry_number;

-- 6. Non-overlapping debt-source summary; distinguish evidence from accounting impact.
SELECT d.reference_type,d.source_ledger_id,d.debt_quantity,
       d.settled_quantity,
       (d.debt_quantity-d.settled_quantity) outstanding_quantity
  FROM public.raw_fifo_debts d
 WHERE d.raw_material_id='03d6381d-b2f9-489e-b536-dc2b88c5767b'
   AND d.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'
 ORDER BY d.source_created_at,d.id;
