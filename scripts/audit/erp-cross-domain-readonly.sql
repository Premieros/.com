-- Premier ERP cross-domain consistency monitor, 2026-10-12.
-- READ-ONLY: SELECT/CTE only. Run as a privileged database operator.
-- A BLOCK check should be zero; REVIEW needs human evidence, not automatic repair.
-- INFO is an observation, not a defect. No business data or identifiers are returned.
WITH audit AS (
  SELECT 'sales_warehouse_wrong_branch' AS check_name,'BLOCK' AS kind,count(*)::bigint AS affected
    FROM public.sales s JOIN public.warehouses w ON w.id=s.warehouse_id WHERE s.branch_id IS DISTINCT FROM w.branch_id
  UNION ALL SELECT 'purchases_warehouse_wrong_branch','BLOCK',count(*) FROM public.purchases p JOIN public.warehouses w ON w.id=p.warehouse_id WHERE p.branch_id IS DISTINCT FROM w.branch_id
  UNION ALL SELECT 'orders_warehouse_wrong_branch','BLOCK',count(*) FROM public.orders o JOIN public.warehouses w ON w.id=o.inventory_warehouse_id WHERE o.branch_id IS DISTINCT FROM w.branch_id
  UNION ALL SELECT 'item_site_wrong_organization','BLOCK',count(*) FROM public.item_sites s JOIN public.items i ON i.id=s.item_id JOIN public.branches b ON b.id=s.branch_id WHERE i.organization_id IS DISTINCT FROM b.organization_id
  UNION ALL SELECT 'item_site_warehouse_wrong_branch','BLOCK',count(*) FROM public.item_sites s JOIN public.warehouses w ON w.id=s.preferred_warehouse_id WHERE s.branch_id IS DISTINCT FROM w.branch_id
  UNION ALL SELECT 'recipes_product_wrong_branch','BLOCK',count(*) FROM public.recipes r JOIN public.products p ON p.id=r.product_id WHERE r.branch_id IS DISTINCT FROM p.branch_id
  UNION ALL SELECT 'recipes_component_wrong_branch','BLOCK',count(*) FROM public.recipe_items ri JOIN public.recipes r ON r.id=ri.recipe_id JOIN public.raw_materials m ON m.id=ri.raw_material_id WHERE r.branch_id IS DISTINCT FROM m.branch_id
  UNION ALL SELECT 'sale_lines_product_wrong_branch','BLOCK',count(*) FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id JOIN public.products p ON p.id=si.product_id WHERE s.branch_id IS DISTINCT FROM p.branch_id
  UNION ALL SELECT 'purchase_lines_product_wrong_branch','BLOCK',count(*) FROM public.purchase_items pi JOIN public.purchases p ON p.id=pi.purchase_id JOIN public.products x ON x.id=pi.product_id WHERE p.branch_id IS DISTINCT FROM x.branch_id
  UNION ALL SELECT 'journal_lines_account_wrong_branch','BLOCK',count(*) FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id JOIN public.chart_of_accounts a ON a.id=l.account_id WHERE j.branch_id IS DISTINCT FROM a.branch_id
  UNION ALL SELECT 'journal_period_wrong_organization','BLOCK',count(*) FROM public.journal_entries j JOIN public.accounting_periods p ON p.id=j.period_id JOIN public.branches b ON b.id=j.branch_id WHERE p.organization_id IS DISTINCT FROM b.organization_id
  UNION ALL SELECT 'posted_journals_unbalanced','BLOCK',count(*) FROM (
    SELECT j.id FROM public.journal_entries j LEFT JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
    WHERE j.posting_status='POSTED' GROUP BY j.id HAVING abs(coalesce(sum(l.debit),0)-coalesce(sum(l.credit),0))>0.01
  ) off_balance
  UNION ALL SELECT 'raw_negative_stock_when_disabled','BLOCK',count(*) FROM public.raw_material_inventory i LEFT JOIN public.branch_settings bs ON bs.branch_id=i.branch_id CROSS JOIN public.settings s WHERE i.quantity < 0 AND coalesce(bs.allow_negative_stock,s.allow_negative_stock,false)=false
  UNION ALL SELECT 'fifo_debts_oversettled','BLOCK',count(*) FROM public.raw_fifo_debts d WHERE d.settled_quantity>d.debt_quantity+0.0001 OR d.settled_quantity<0 OR d.debt_quantity<0
  UNION ALL SELECT 'fifo_debt_settlement_mismatch','BLOCK',count(*) FROM public.raw_fifo_debts d LEFT JOIN (SELECT debt_id,sum(quantity) qty FROM public.raw_fifo_settlements GROUP BY debt_id) s ON s.debt_id=d.id WHERE abs(d.settled_quantity-coalesce(s.qty,0))>0.0001
  UNION ALL SELECT 'canonical_inventory_reconciliation_not_match','BLOCK',count(*) FROM private.canonical_inventory_balances c WHERE c.reconciliation_status IS DISTINCT FROM 'MATCH'
  UNION ALL SELECT 'raw_inventory_batch_quantity_delta','REVIEW',count(*) FROM (
    SELECT coalesce(b.raw_material_id,i.raw_material_id) material_id, coalesce(b.branch_id,i.branch_id) branch_id,coalesce(b.qty,0)-coalesce(i.qty,0) delta
    FROM (SELECT raw_material_id,branch_id,sum(quantity) qty FROM public.raw_material_batches GROUP BY 1,2) b
    FULL JOIN (SELECT raw_material_id,branch_id,sum(quantity) qty FROM public.raw_material_inventory GROUP BY 1,2) i USING(raw_material_id,branch_id)
  ) x WHERE abs(x.delta)>0.001
  UNION ALL SELECT 'quarantined_inventory_review_cases','REVIEW',count(*) FROM private.canonical_inventory_review_cases
  UNION ALL SELECT 'negative_raw_material_balances_allowed','INFO',count(*) FROM public.raw_material_inventory i LEFT JOIN public.branch_settings bs ON bs.branch_id=i.branch_id CROSS JOIN public.settings s WHERE i.quantity<0 AND coalesce(bs.allow_negative_stock,s.allow_negative_stock,false)=true
  UNION ALL SELECT 'fifo_debts_outstanding','INFO',count(*) FROM public.raw_fifo_debts d WHERE d.debt_quantity>d.settled_quantity+0.0001
)
SELECT check_name,kind,affected FROM audit ORDER BY kind,check_name;
