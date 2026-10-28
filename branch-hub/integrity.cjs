'use strict';
// One accounting audit shared by recovery and the authenticated health API.
function auditOfflineSales(db,branchId) {
 const missingOutbox=db.prepare(`SELECT count(*) n FROM offline_sales s LEFT JOIN offline_outbox o
  ON o.sale_id=s.id AND o.branch_id=s.branch_id WHERE s.branch_id=? AND o.event_id IS NULL`).get(branchId).n;
 const unbalanced=db.prepare(`SELECT count(*) n FROM (SELECT s.id FROM offline_sales s
  LEFT JOIN offline_journal j ON j.sale_id=s.id WHERE s.branch_id=? GROUP BY s.id
  HAVING count(j.sale_id)=0 OR sum(j.debit_minor)!=sum(j.credit_minor))`).get(branchId).n;
 const missingMovements=db.prepare(`SELECT count(*) n FROM offline_sale_lines l JOIN offline_sales s ON s.id=l.sale_id
  LEFT JOIN offline_stock_movements m ON m.sale_id=s.id AND m.sku=l.sku AND m.branch_id=s.branch_id
  WHERE s.branch_id=? AND (m.id IS NULL OR m.delta != -l.quantity)`).get(branchId).n;
 const invalidPostings=db.prepare(`SELECT count(*) n FROM offline_sales s WHERE s.branch_id=? AND (
  s.total_minor != COALESCE((SELECT sum(l.quantity*l.price_minor) FROM offline_sale_lines l WHERE l.sale_id=s.id),-1)
  OR s.total_minor != COALESCE((SELECT sum(j.debit_minor) FROM offline_journal j WHERE j.sale_id=s.id AND j.account IN ('cash','bank')),0)
  OR s.total_minor != COALESCE((SELECT sum(j.credit_minor) FROM offline_journal j WHERE j.sale_id=s.id AND j.account='sales_revenue'),0)
  OR (SELECT sum(l.cost_minor) FROM offline_sale_lines l WHERE l.sale_id=s.id) != COALESCE((SELECT sum(j.debit_minor) FROM offline_journal j WHERE j.sale_id=s.id AND j.account='cost_of_goods_sold'),0)
  OR (SELECT sum(l.cost_minor) FROM offline_sale_lines l WHERE l.sale_id=s.id) != COALESCE((SELECT sum(j.credit_minor) FROM offline_journal j WHERE j.sale_id=s.id AND j.account='inventory'),0)
  OR EXISTS(SELECT 1 FROM offline_journal j WHERE j.sale_id=s.id AND (
   j.account NOT IN ('cash','bank','sales_revenue','cost_of_goods_sold','inventory')
   OR (j.account IN ('cash','bank','cost_of_goods_sold') AND j.credit_minor!=0)
   OR (j.account IN ('sales_revenue','inventory') AND j.debit_minor!=0))))`).get(branchId).n;
 const invalidEvents=invalidOfflineEvents(db,branchId);
 return {missingOutbox,unbalanced,missingMovements,invalidPostings,invalidEvents};
}
function invalidOfflineEvents(db,branchId,eventId){
 const query=`SELECT count(*) n FROM offline_outbox o WHERE o.branch_id=? ${eventId?'AND o.event_id=?':''} AND
  CASE WHEN json_valid(o.payload) THEN
   COALESCE(json_extract(o.payload,'$.saleId'),'') != o.sale_id
   OR COALESCE(json_extract(o.payload,'$.branchId'),'') != o.branch_id
   OR NOT EXISTS(SELECT 1 FROM offline_sales s WHERE s.id=o.sale_id AND s.branch_id=o.branch_id
     AND s.key=json_extract(o.payload,'$.key') AND s.total_minor=json_extract(o.payload,'$.totalMinor') AND json_extract(s.canonical,'$.paymentAccount')=json_extract(o.payload,'$.paymentAccount'))
   OR json_type(o.payload,'$.lines') IS NOT 'array'
   OR EXISTS(SELECT 1 FROM json_each(o.payload,'$.lines') GROUP BY json_extract(value,'$.sku') HAVING count(*)>1)
   OR COALESCE(json_array_length(o.payload,'$.lines'),0)!=(SELECT count(*) FROM offline_sale_lines l WHERE l.sale_id=o.sale_id)
   OR EXISTS(SELECT 1 FROM json_each(o.payload,'$.lines') e LEFT JOIN offline_sale_lines l
     ON l.sale_id=o.sale_id AND l.sku=json_extract(e.value,'$.sku') WHERE l.sale_id IS NULL
     OR l.quantity IS NOT json_extract(e.value,'$.quantity') OR l.price_minor IS NOT json_extract(e.value,'$.priceMinor')
     OR l.cost_minor IS NOT json_extract(e.value,'$.costMinor')
     OR json_extract(l.canonical,'$.productId') IS NOT json_extract(e.value,'$.canonical.productId')
     OR json_extract(l.canonical,'$.warehouseId') IS NOT json_extract(e.value,'$.canonical.warehouseId')
     OR json_extract(l.canonical,'$.unitName') IS NOT json_extract(e.value,'$.canonical.unitName'))
  ELSE 1 END`;
 return db.prepare(query).get(...(eventId?[branchId,eventId]:[branchId])).n;
}
module.exports={auditOfflineSales,invalidOfflineEvents};
