import{J as $,bm as r,b3 as m,aI as _}from"./index-DT0DAaE3.js";import{c as b}from"./costing-CC9tfLh4.js";const a=i=>Number(i||0),n=i=>String(i||"");async function v(i,h){const{data:u,error:t}=await $.rpc("get_day_closing_report",{p_branch_id:i,p_day:h});if(t)throw new Error(t.message);const e=u;if(!(e!=null&&e.success))throw new Error(String((e==null?void 0:e.detail)||(e==null?void 0:e.error)||"Could not load day closing report"));const o=[],d=n(e.window_start),p=n(e.window_end);if(d&&p){const{data:l,error:s}=await b.getRawConsumptionCostBreakdown({p_branch_id:i,p_from:d,p_to:p});if(s)throw new Error(`DAY_REPORT_RAW_COST_LOAD_FAILED: ${s.message}`);for(const c of l||[])o.push({materialId:n(c.raw_material_id),materialName:n(c.raw_material_name),unit:n(c.unit_name),quantity:a(c.consumed_quantity),actualQuantity:a(c.actual_quantity),estimatedQuantity:a(c.estimated_quantity),actualCost:a(c.actual_cost),estimatedCost:a(c.estimated_cost),displayedCost:a(c.displayed_cost)})}return{branchId:n(e.branch_id),branchName:n(e.branch_name),businessDate:n(e.business_date||h),dailyCloseStatus:e.daily_close_status==="closed"?"closed":"open",snapshot:!!e.snapshot,historicalReconciled:!!e.historical_reconciled,snapshotCashExpenses:a(e.snapshot_cash_expenses),snapshotCashAfterOutflows:a(e.snapshot_cash_after_outflows),reconciliationCashExpenseDelta:a(e.reconciliation_cash_expense_delta),reconciliationCashAfterDelta:a(e.reconciliation_cash_after_delta),businessDayMode:e.business_day_mode==="shift_span"?"shift_span":"fixed_time",windowStart:n(e.window_start),windowEnd:n(e.window_end),grossSales:a(e.gross_sales),discounts:a(e.discounts),taxes:a(e.taxes),returns:a(e.returns),netSales:a(e.net_sales),expenses:a(e.expenses),cashPurchases:a(e.cash_purchases),netAfterExpenses:a(e.net_after_expenses),netAfterExpensesAndCashPurchases:a(e.net_after_expenses_and_cash_purchases),cashSales:a(e.cash_sales),cashExpenses:a(e.cash_expenses),cashAfterOutflows:a(e.cash_after_outflows),invoiceCount:a(e.invoice_count),shiftCount:a(e.shift_count),paymentMethods:Array.isArray(e.payment_methods)?e.payment_methods.map(l=>{const s=l;return{method:n(s.method),invoiceCount:a(s.invoice_count),salesTotal:a(s.sales_total)}}):[],shifts:Array.isArray(e.shifts)?e.shifts.map(l=>{const s=l;return{shiftId:n(s.shift_id),cashierId:n(s.cashier_id),cashierName:n(s.cashier_name),openedAt:n(s.opened_at),closedAt:s.closed_at?n(s.closed_at):null,openingAmount:a(s.opening_amount),expectedAmount:a(s.expected_amount),actualAmount:a(s.actual_amount),difference:a(s.difference),status:n(s.status)}}):[],salesDetails:Array.isArray(e.sales_details)?e.sales_details.map(l=>{const s=l;return{saleId:n(s.sale_id),invoiceNumber:n(s.invoice_number),userId:n(s.user_id),userName:n(s.user_name),subtotal:a(s.subtotal),discountAmount:a(s.discount_amount),taxAmount:a(s.tax_amount),total:a(s.total),paidAmount:a(s.paid_amount),refundedAmount:a(s.refunded_amount),paymentMethod:n(s.payment_method),orderType:n(s.order_type),status:n(s.status),createdAt:n(s.created_at)}}):[],expenseDetails:Array.isArray(e.expense_details)?e.expense_details.map(l=>{const s=l;return{expenseId:n(s.expense_id),category:n(s.category),description:n(s.description),amount:a(s.amount),paymentMethod:n(s.payment_method),expenseDate:n(s.expense_date),notes:s.notes?n(s.notes):null,createdAt:n(s.created_at),createdBy:n(s.created_by),createdByName:n(s.created_by_name),shiftId:n(s.shift_id)}}):[],cashPurchaseDetails:Array.isArray(e.cash_purchase_details)?e.cash_purchase_details.map(l=>{const s=l;return{purchaseId:n(s.purchase_id),invoiceNumber:n(s.invoice_number),supplierId:n(s.supplier_id),supplierName:n(s.supplier_name),buyerId:n(s.buyer_id),buyerName:n(s.buyer_name),subtotal:a(s.subtotal),discountAmount:a(s.discount_amount),taxAmount:a(s.tax_amount),total:a(s.total),paidAmount:a(s.paid_amount),returnedAmount:a(s.returned_amount),cashOutflow:a(s.cash_outflow),paymentMethod:n(s.payment_method),status:n(s.status),createdAt:n(s.created_at)}}):[],users:Array.isArray(e.users)?e.users.map(l=>{const s=l;return{userId:n(s.user_id),displayName:n(s.display_name),invoiceCount:a(s.invoice_count),salesTotal:a(s.sales_total),discounts:a(s.discounts),returns:a(s.returns),expenses:a(s.expenses),cashPurchases:a(s.cash_purchases)}}):[],rawMaterials:o}}function g(i,h="EGP",u="ar"){const t=u==="ar",e=t?"rtl":"ltr",o=d=>_(d,h,u);return`<!doctype html><html dir="${e}" lang="${t?"ar":"en"}"><head><meta charset="utf-8">
<title>${t?"تقرير إغلاق اليوم":"Day Closing Report"}</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Cairo",sans-serif;margin:0;padding:20px;color:#111827;background:#fff;font-size:12px}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #d1d5db;padding-bottom:5px}
.meta{display:flex;justify-content:space-between;gap:16px;margin-top:8px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0}
.card{border:1px solid #d1d5db;border-radius:8px;padding:10px}.label{font-size:10px;color:#6b7280}.value{font-size:15px;font-weight:800;margin-top:3px}
table{width:100%;border-collapse:collapse;margin:6px 0 16px}th,td{border:1px solid #d1d5db;padding:6px;text-align:${t?"right":"left"};vertical-align:top}th{background:#f3f4f6}
.num{text-align:${t?"left":"right"};white-space:nowrap}.negative{color:#b91c1c}.strong{font-weight:800}
@media print{@page{size:A4;margin:8mm}body{padding:0}}
</style></head><body onload="window.print()">
<h1>${r(i.branchName)} — ${t?"إغلاق اليوم":"Day Close"}</h1>
<div class="meta"><div>${t?"تاريخ العمل":"Business date"}: <b>${r(i.businessDate)}</b></div><div>${i.snapshot?t?"نسخة إغلاق ثابتة":"Immutable closing snapshot":t?"معاينة مباشرة":"Live preview"}</div></div>
<div class="meta"><div><b>${t?"بداية اليوم:":"Day start:"}</b> ${i.windowStart?m(i.windowStart,u):"-"}</div><div><b>${t?"نهاية اليوم:":"Day end:"}</b> ${i.windowEnd?m(i.windowEnd,u):"-"}</div></div>
<div class="meta"><div>${t?"طريقة تحديد اليوم:":"Boundary mode:"} <b>${i.businessDayMode==="shift_span"?t?"أول شفت ← آخر شفت":"First shift → last shift":t?"وقت ثابت":"Fixed time"}</b></div></div>
${i.historicalReconciled?`<div style="margin-top:10px;padding:10px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb">
<b>${t?"تمت مصالحة هذا الإغلاق التاريخي مع حركة الخزنة الفعلية.":"This historical close was reconciled to actual treasury movements."}</b>
<div>${t?"مصروفات الكاش المحفوظة سابقًا":"Stored cash expenses"}: ${o(i.snapshotCashExpenses)} → <b>${o(i.cashExpenses)}</b></div>
<div>${t?"الكاش بعد الخارج المحفوظ سابقًا":"Stored cash after outflows"}: ${o(i.snapshotCashAfterOutflows)} → <b>${o(i.cashAfterOutflows)}</b></div>
</div>`:""}
<div class="grid">
<div class="card"><div class="label">${t?"صافي المبيعات":"Net sales"}</div><div class="value">${o(i.netSales)}</div></div>
<div class="card"><div class="label">${t?"المصروفات":"Expenses"}</div><div class="value negative">-${o(i.expenses)}</div></div>
<div class="card"><div class="label">${t?"مشتريات الكاش":"Cash purchases"}</div><div class="value negative">-${o(i.cashPurchases)}</div></div>
<div class="card"><div class="label">${t?"الصافي بعد كل الخارج":"Net after outflows"}</div><div class="value">${o(i.netAfterExpensesAndCashPurchases)}</div></div>
</div>
<h2>${t?"ملخص اليوم بالكامل":"Full day summary"}</h2>
<table><tbody>
<tr><td>${t?"إجمالي المبيعات":"Gross sales"}</td><td class="num">${o(i.grossSales)}</td></tr>
<tr><td>${t?"الخصومات":"Discounts"}</td><td class="num negative">-${o(i.discounts)}</td></tr>
<tr><td>${t?"المرتجعات":"Returns"}</td><td class="num negative">-${o(i.returns)}</td></tr>
<tr><td>${t?"الضرائب":"Taxes"}</td><td class="num">${o(i.taxes)}</td></tr>
<tr><td>${t?"صافي المبيعات":"Net sales"}</td><td class="num strong">${o(i.netSales)}</td></tr>
<tr><td>${t?"إجمالي المصروفات":"Expenses"}</td><td class="num negative">-${o(i.expenses)}</td></tr>
<tr><td>${t?"مشتريات الكاش":"Cash purchases"}</td><td class="num negative">-${o(i.cashPurchases)}</td></tr>
<tr><td>${t?"الصافي بعد المصروفات والمشتريات الكاش":"Net after expenses & cash purchases"}</td><td class="num strong">${o(i.netAfterExpensesAndCashPurchases)}</td></tr>
<tr><td>${t?"كاش المبيعات":"Cash sales"}</td><td class="num">${o(i.cashSales)}</td></tr>
<tr><td>${t?"مصروفات كاش":"Cash expenses"}</td><td class="num negative">-${o(i.cashExpenses)}</td></tr>
<tr><td>${t?"الكاش بعد الخارج":"Cash after outflows"}</td><td class="num strong">${o(i.cashAfterOutflows)}</td></tr>
</tbody></table>

<h2>${t?"الشفتات":"Shifts"}</h2>
<table><thead><tr><th>${t?"المستخدم":"User"}</th><th>${t?"فتح":"Opened"}</th><th>${t?"إغلاق":"Closed"}</th><th class="num">${t?"المتوقع":"Expected"}</th><th class="num">${t?"الفعلي":"Actual"}</th><th class="num">${t?"الفرق":"Difference"}</th></tr></thead>
<tbody>${i.shifts.map(d=>`<tr><td>${r(d.cashierName)}</td><td>${m(d.openedAt,u)}</td><td>${d.closedAt?m(d.closedAt,u):"-"}</td><td class="num">${o(d.expectedAmount)}</td><td class="num">${o(d.actualAmount)}</td><td class="num">${o(d.difference)}</td></tr>`).join("")}</tbody></table>

<h2>${t?"كل مستخدم — التفاصيل":"Every user — details"}</h2>
<table><thead><tr><th>${t?"المستخدم":"User"}</th><th class="num">${t?"الفواتير":"Invoices"}</th><th class="num">${t?"المبيعات":"Sales"}</th><th class="num">${t?"الخصومات":"Discounts"}</th><th class="num">${t?"المرتجعات":"Returns"}</th><th class="num">${t?"المصروفات":"Expenses"}</th><th class="num">${t?"مشتريات كاش":"Cash purchases"}</th></tr></thead>
<tbody>${i.users.map(d=>`<tr><td>${r(d.displayName)}</td><td class="num">${d.invoiceCount}</td><td class="num">${o(d.salesTotal)}</td><td class="num">${o(d.discounts)}</td><td class="num">${o(d.returns)}</td><td class="num">${o(d.expenses)}</td><td class="num">${o(d.cashPurchases)}</td></tr>`).join("")}</tbody></table>

${i.rawMaterials.length>0?`
<h2>${t?"المواد الخام المستهلكة":"Raw materials consumed"}</h2>
<table><thead><tr>
<th>${t?"الخامة":"Material"}</th>
<th class="num">${t?"الكمية":"Quantity"}</th>
<th class="num">${t?"التكلفة الفعلية":"Actual cost"}</th>
<th class="num">${t?"السالب التقديري":"Negative estimate"}</th>
<th class="num">${t?"الإجمالي المعروض":"Displayed total"}</th>
</tr></thead><tbody>
${i.rawMaterials.map(d=>`<tr>
<td>${r(d.materialName)}</td>
<td class="num">${d.quantity} ${r(d.unit)}</td>
<td class="num">${o(d.actualCost)}</td>
<td class="num">${d.estimatedQuantity>0?o(d.estimatedCost):"-"}</td>
<td class="num strong">${o(d.displayedCost)}</td>
</tr>`).join("")}
</tbody></table>
<div style="font-size:10px;color:#6b7280;margin-top:-10px;margin-bottom:16px;">
${t?"التكلفة الفعلية لا تشمل الجزء السالب غير المسوّى؛ الجزء السالب يظهر كتقدير مستقل حتى وصول الشراء وتسوية FIFO.":"Actual cost excludes unsettled negative stock; negative consumption is shown separately as an estimate until a purchase settles FIFO."}
</div>
`:""}

<h2>${t?"المصروفات — بدون إخفاء":"Expenses — full detail"}</h2>
<table><thead><tr><th>${t?"التصنيف":"Category"}</th><th>${t?"البيان":"Description"}</th><th>${t?"المستخدم":"User"}</th><th>${t?"الدفع":"Payment"}</th><th class="num">${t?"المبلغ":"Amount"}</th></tr></thead>
<tbody>${i.expenseDetails.map(d=>`<tr><td>${r(d.category)}</td><td>${r(d.description)}</td><td>${r(d.createdByName)}</td><td>${r(d.paymentMethod)}</td><td class="num">${o(d.amount)}</td></tr>`).join("")}</tbody></table>

<h2>${t?"مشتريات الكاش — بدون إخفاء":"Cash purchases — full detail"}</h2>
<table><thead><tr><th>${t?"الفاتورة":"Invoice"}</th><th>${t?"المورد":"Supplier"}</th><th>${t?"المستخدم":"Buyer"}</th><th class="num">${t?"الإجمالي":"Total"}</th><th class="num">${t?"المدفوع":"Paid"}</th><th class="num">${t?"المرتجع":"Returned"}</th><th class="num">${t?"صافي الخارج":"Cash outflow"}</th></tr></thead>
<tbody>${i.cashPurchaseDetails.map(d=>`<tr><td>${r(d.invoiceNumber)}</td><td>${r(d.supplierName)}</td><td>${r(d.buyerName)}</td><td class="num">${o(d.total)}</td><td class="num">${o(d.paidAmount)}</td><td class="num">${o(d.returnedAmount)}</td><td class="num strong">${o(d.cashOutflow)}</td></tr>`).join("")}</tbody></table>

<h2>${t?"المبيعات — كل الفواتير":"Sales — every invoice"}</h2>
<table><thead><tr><th>${t?"الفاتورة":"Invoice"}</th><th>${t?"المستخدم":"User"}</th><th>${t?"الدفع":"Payment"}</th><th class="num">${t?"الإجمالي":"Total"}</th><th class="num">${t?"المرتجع":"Refunded"}</th></tr></thead>
<tbody>${i.salesDetails.map(d=>`<tr><td>${r(d.invoiceNumber)}</td><td>${r(d.userName)}</td><td>${r(d.paymentMethod)}</td><td class="num">${o(d.total)}</td><td class="num">${o(d.refundedAmount)}</td></tr>`).join("")}</tbody></table>
</body></html>`}export{g as b,v as f};
