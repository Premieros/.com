import{c as M,bm as r,b3 as $,aI as i,J as x,aT as z,bo as L}from"./index-DMH0lpXz.js";import{c as B}from"./costing-CW0TsExC.js";/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const V=M("CalendarCheck",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"m9 16 2 2 4-4",key:"19s6y9"}]]);/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const W=M("Play",[["polygon",{points:"5 3 19 12 5 21 5 3",key:"191637"}]]);function A(e,o=2){const n=Number(e||0);return Number.isFinite(n)?new Intl.NumberFormat("en-US",{minimumFractionDigits:0,maximumFractionDigits:o,useGrouping:!0}).format(n):"0"}function q(e,o){return`${A(e,2)} ${String(o||"EGP").trim()}`}function P(e){if(!e)return"-";const o=new Date(e);if(Number.isNaN(o.getTime()))return String(e);const n=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:!1}).formatToParts(o),t=h=>{var c;return((c=n.find(s=>s.type===h))==null?void 0:c.value)||""};return`${t("year")}-${t("month")}-${t("day")} ${t("hour")}:${t("minute")}`}function F(e,o,n){const t=String(e||"").toLowerCase(),c={cash:["نقدي","CASH"],card:["بطاقة","CARD"],transfer:["تحويل","TRANSFER"],bank_transfer:["تحويل بنكي","BANK TRANSFER"],instapay:["إنستاباي","INSTAPAY"],credit:["آجل","CREDIT"]}[t];return c?n?`${c[0]} / ${c[1]}`:c[1]:String(o||e||"-").trim()}function U(e,o="EGP",n="ar"){const t=n==="ar",h="-".repeat(36),c=f=>q(f,o),s=(e.salesDetails||[]).filter(f=>(f.payments||[]).filter(v=>Number(v.amount)>0).length>1).length,u=[e.branchName,t?"*** تقرير Z / Z-REPORT ***":"*** Z-REPORT ***",`SHIFT: #${e.shiftId.slice(0,8).toUpperCase()}`,h,`${t?"الكاشير":"Cashier"}: ${e.cashierName}`,`${t?"الفتح":"Opened"}: ${P(e.openedAt)}`,`${t?"الإغلاق":"Closed"}: ${e.closedAt?P(e.closedAt):t?"مفتوح / ACTIVE":"ACTIVE"}`,h,t?"ملخص المبيعات / SALES":"SALES SUMMARY",`${t?"الفواتير":"Invoices"}: ${A(e.totalInvoices,0)}`,`${t?"إجمالي المبيعات":"Gross Sales"}: ${c(e.grossSales)}`,`${t?"الخصومات":"Discounts"}: ${c(e.totalDiscounts)}`,`${t?"الضرائب":"Taxes"}: ${c(e.totalTaxes)}`,`${t?"المرتجعات":"Returns"}: ${c(e.returns)}`,`${t?"الإلغاءات":"Voids"}: ${c(e.voids)}`,`${t?"المصروفات":"Expenses"}: ${c(e.expenses)}`,`${t?"مشتريات كاش":"Cash Purchases"}: ${c(e.cashPurchases||0)}`,`${t?"صافي المبيعات":"Net Sales"}: ${c(e.netSales)}`,`${t?"صافي الإيراد":"Net Revenue"}: ${c(e.netRevenue)}`,h,t?"طرق الدفع / PAYMENTS":"PAYMENTS",...e.paymentMethods.map(f=>`${F(f.method,f.label,t)}: ${c(f.total)} (${A(f.count,0)})`)];return s>0&&u.push(`${t?"فواتير دفع مقسم":"Split-tender invoices"}: ${s}`),u.push(h,t?"النقدية / CASH DRAWER":"CASH DRAWER",`${t?"رصيد الافتتاح":"Opening Cash"}: ${c(e.openingAmount)}`,`${t?"المتوقع بالدرج":"Expected Cash"}: ${c(e.expectedAmount)}`,`${t?"الفعلي بالدرج":"Actual Counted"}: ${c(e.actualAmount)}`,`${t?"الفارق":"Difference"}: ${c(e.difference)}`,h,t?"التفاصيل الكاملة متاحة في تقرير A4":"Full invoice detail is available in the A4 report"),u.join(`\r
`)}function K(e,o="EGP",n="ar"){const t=n==="ar",h=t?"rtl":"ltr",c=Math.abs(e.difference)>.01?"#dc2626":"#16a34a";return`<!doctype html>
<html dir="${h}" lang="${t?"ar":"en"}">
<head>
<meta charset="utf-8">
<title>${t?"تقرير إغلاق الوردية Z-Report":"Shift Z-Report"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
    font-size: 11px;
    line-height: 1.35;
    color: #000;
    background: #fff;
    padding: 6px;
    width: 80mm;
    margin: 0 auto;
  }
  .text-center { text-align: center; }
  .text-end { text-align: ${t?"left":"right"}; }
  .font-bold { font-weight: bold; }
  .font-black { font-weight: 900; }
  .border-b { border-bottom: 1px dashed #000; }
  .border-t { border-top: 1px dashed #000; }
  .border-double { border-bottom: 3px double #000; }
  .my-1 { margin-top: 4px; margin-bottom: 4px; }
  .my-2 { margin-top: 8px; margin-bottom: 8px; }
  .py-1 { padding-top: 3px; padding-bottom: 3px; }
  .py-2 { padding-top: 6px; padding-bottom: 6px; }
  .flex { display: flex; }
  .justify-between { justify-content: space-between; }
  .section-title {
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 6px;
    margin-bottom: 3px;
    padding-bottom: 2px;
    border-bottom: 1px solid #000;
  }
  table { width: 100%; border-collapse: collapse; margin-top: 2px; }
  th, td { font-size: 10px; padding: 2px 0; }
  th { border-bottom: 1px solid #000; }
  @media print {
    body { width: 100%; margin: 0; padding: 2px; }
    @page { margin: 0; }
  }
</style>
</head>
<body onload="window.print();">
  <div class="text-center">
    <h2 class="font-black" style="font-size: 14px;">${r(e.branchName)}</h2>
    <p class="font-bold my-1" style="font-size: 12px; letter-spacing: 1px;">*** ${t?"تقرير إغلاق الوردية Z-REPORT":"SHIFT Z-REPORT"} ***</p>
    <p style="font-size: 9px;">#${e.shiftId.slice(0,8).toUpperCase()}</p>
  </div>

  <div class="border-b my-1"></div>

  <div class="flex justify-between py-1">
    <span>${t?"الكاشير:":"Cashier:"}</span>
    <span class="font-bold">${r(e.cashierName)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"تاريخ الفتح:":"Opened:"}</span>
    <span>${$(e.openedAt,n)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"تاريخ الإغلاق:":"Closed:"}</span>
    <span>${e.closedAt?$(e.closedAt,n):t?"مستمر":"Active"}</span>
  </div>

  <div class="border-t my-1"></div>

  <!-- Sales Summary -->
  <div class="section-title">${t?"ملخص المبيعات":"SALES SUMMARY"}</div>
  <div class="flex justify-between py-1">
    <span>${t?"عدد الفواتير:":"Invoices Count:"}</span>
    <span class="font-bold">${e.totalInvoices}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"إجمالي المبيعات:":"Gross Sales:"}</span>
    <span>${i(e.grossSales,o,n)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"إجمالي الخصومات:":"Discounts:"}</span>
    <span>-${i(e.totalDiscounts,o,n)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"إجمالي الضرائب:":"Taxes:"}</span>
    <span>+${i(e.totalTaxes,o,n)}</span>
  </div>
  <div class="flex justify-between py-1 font-black border-t border-b" style="font-size: 12px;">
    <span>${t?"صافي المبيعات:":"Net Sales:"}</span>
    <span>${i(e.netSales,o,n)}</span>
  </div>

  <!-- Payment Methods Breakdown -->
  <div class="section-title">${t?"طرق الدفع":"PAYMENT METHODS"}</div>
  ${e.paymentMethods.map(s=>`
    <div class="flex justify-between py-1">
      <span>${r(s.label)} (${s.count}):</span>
      <span class="font-bold">${i(s.total,o,n)}</span>
    </div>
  `).join("")}

  ${(e.salesDetails||[]).length>0?`
    <div class="section-title">${t?"الفواتير وطرق الدفع":"INVOICES & TENDERS"}</div>
    ${(e.salesDetails||[]).map(s=>`
      <div class="py-1 border-b">
        <div class="flex justify-between"><span class="font-bold">${r(s.invoiceNumber)}</span><span class="font-bold">${i(s.total,o,n)}</span></div>
        ${s.orderNumber?`<div style="font-size:9px;font-weight:700;">${t?"الطلب الأصلي":"Original order"}: ${r(s.orderNumber)}</div>`:""}
        <div style="font-size:9px;">${r(s.userName||"-")} · ${$(s.createdAt,n)}</div>
        ${s.payments&&s.payments.length>0?s.payments.map(u=>`<div class="flex justify-between" style="font-size:10px;"><span>${r(u.method)}</span><span>${i(u.amount,o,n)}</span></div>`).join(""):`<div class="flex justify-between" style="font-size:10px;"><span>${r(s.paymentMethod||"-")}</span><span>${i(s.paidAmount,o,n)}</span></div>`}
      </div>
    `).join("")}
  `:""}
  <!-- Cash Drawer Balancing -->
  <div class="section-title">${t?"تسوية الدرج والنقدية":"CASH RECONCILIATION"}</div>
  <div class="flex justify-between py-1">
    <span>${t?"رصيد الافتتاح:":"Opening Cash:"}</span>
    <span>${i(e.openingAmount,o,n)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"المصروفات:":"Expenses:"}</span>
    <span>-${i(e.expenses,o,n)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"مشتريات كاش:":"Cash Purchases:"}</span>
    <span>-${i(e.cashPurchases||0,o,n)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"المتوقع بالدرج:":"Expected Cash:"}</span>
    <span class="font-bold">${i(e.expectedAmount,o,n)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${t?"الفعلي بالدرج:":"Actual Counted:"}</span>
    <span class="font-bold">${i(e.actualAmount,o,n)}</span>
  </div>
  <div class="flex justify-between py-1 font-black" style="color: ${c};">
    <span>${t?"الفارق (عجز / زيادة):":"Difference:"}</span>
    <span>${i(e.difference,o,n)}</span>
  </div>

  ${(e.expenseDetails||[]).length>0?`
    <div class="section-title">${t?"المصروفات بالتفصيل":"EXPENSE DETAILS"}</div>
    ${(e.expenseDetails||[]).map(s=>`
      <div class="py-1 border-b">
        <div class="flex justify-between"><span class="font-bold">${r(s.category||"-")}</span><span class="font-bold">-${i(s.amount,o,n)}</span></div>
        <div class="flex justify-between"><span>${r(s.description||"-")}</span><span>${r(s.paymentMethod)}</span></div>
        <div style="font-size:9px;">${r(s.createdByName)} · ${$(s.createdAt,n)}</div>
      </div>
    `).join("")}
  `:""}

  ${(e.cashPurchaseDetails||[]).length>0?`
    <div class="section-title">${t?"مشتريات الكاش":"CASH PURCHASES"}</div>
    ${(e.cashPurchaseDetails||[]).map(s=>`
      <div class="py-1 border-b">
        <div class="flex justify-between"><span class="font-bold">${r(s.invoiceNumber||"-")}</span><span class="font-bold">-${i(s.amount,o,n)}</span></div>
        <div style="font-size:9px;">${$(s.createdAt,n)}</div>
      </div>
    `).join("")}
  `:""}

  ${(e.userReports||[]).length>0?`
    <div class="section-title">${t?"تفاصيل المستخدمين":"USER DETAILS"}</div>
    ${(e.userReports||[]).map(s=>`
      <div class="py-1 border-b">
        <div class="font-bold">${r(s.displayName)}</div>
        <div class="flex justify-between"><span>${t?"المبيعات":"Sales"}</span><span>${i(s.salesTotal,o,n)}</span></div>
        <div class="flex justify-between"><span>${t?"الفواتير":"Invoices"}</span><span>${s.invoiceCount}</span></div>
        <div class="flex justify-between"><span>${t?"الخصومات":"Discounts"}</span><span>${i(s.discounts,o,n)}</span></div>
        <div class="flex justify-between"><span>${t?"المرتجعات":"Returns"}</span><span>${i(s.returns,o,n)}</span></div>
        <div class="flex justify-between"><span>${t?"المصروفات":"Expenses"}</span><span>${i(s.expenses,o,n)}</span></div>
        <div class="flex justify-between font-bold"><span>${t?"الصافي":"Net"}</span><span>${i(s.netContribution,o,n)}</span></div>
      </div>
    `).join("")}
  `:""}

  <!-- Products Sold -->
  ${e.productsSold.length>0?`
    <div class="section-title">${t?"المنتجات المباعة":"PRODUCTS SOLD"}</div>
    <table>
      <thead>
        <tr>
          <th style="text-align: ${t?"right":"left"};">${t?"الصنف":"Item"}</th>
          <th class="text-center">${t?"الكمية":"Qty"}</th>
          <th class="text-end">${t?"الإجمالي":"Total"}</th>
        </tr>
      </thead>
      <tbody>
        ${e.productsSold.map(s=>`
          <tr>
            <td>${r(s.productName)}</td>
            <td class="text-center font-bold">${s.quantity}</td>
            <td class="text-end font-bold">${i(s.total,o,n)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `:""}

  <!-- Ingredients Consumed -->
  ${e.ingredientsConsumed.length>0?`
    <div class="section-title">${t?"المكونات والمواد الخام المستهلكة":"INGREDIENTS CONSUMED"}</div>
    <table>
      <thead>
        <tr>
          <th style="text-align: ${t?"right":"left"};">${t?"المادة":"Material"}</th>
          <th class="text-center">${t?"الكمية":"Qty"}</th>
          <th class="text-end">${t?"التكلفة الفعلية":"Actual Cost"}</th>
          <th class="text-end">${t?"السالب التقديري":"Negative Estimate"}</th>
          <th class="text-end">${t?"الإجمالي المعروض":"Displayed Total"}</th>
        </tr>
      </thead>
      <tbody>
        ${e.ingredientsConsumed.map(s=>`
          <tr>
            <td>${r(s.materialName)}</td>
            <td class="text-center font-bold">${s.quantity} ${r(s.unit)}</td>
            <td class="text-end">${i(s.actualCost,o,n)}</td>
            <td class="text-end">${s.estimatedQuantity>0?i(s.estimatedCost,o,n):"-"}</td>
            <td class="text-end font-bold">${i(s.displayedCost,o,n)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `:""}

  <div class="border-double my-2"></div>
  <div class="text-center" style="font-size: 9px;">
    <p>${t?"تم استخراج التقرير بواسطة النظام":"Generated by ERP System"}</p>
    <p>${new Date().toLocaleString(t?"ar-EG":"en-US")}</p>
  </div>
</body>
</html>`}function J(e,o="EGP",n="ar"){const t=n==="ar",h=t?"rtl":"ltr",c=Math.abs(e.difference)>.01?"#dc2626":"#16a34a";return`<!doctype html>
<html dir="${h}" lang="${t?"ar":"en"}">
<head>
<meta charset="utf-8">
<title>${t?"تقرير إغلاق الوردية واليوم":"Day & Shift Closing Report"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
    color: #1e293b;
    background: #f8fafc;
    padding: 24px;
    font-size: 13px;
    line-height: 1.5;
  }
  .container {
    max-width: 900px;
    margin: 0 auto;
    background: #fff;
    padding: 32px;
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 20px;
    margin-bottom: 24px;
  }
  .header h1 { font-size: 22px; font-weight: 900; color: #0f172a; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px;
  }
  .card .label { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; }
  .card .val { font-size: 16px; font-weight: 900; color: #0f172a; }
  .section-heading {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    margin: 20px 0 10px 0;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 6px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  th {
    background: #f1f5f9;
    text-align: ${t?"right":"left"};
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 800;
    color: #475569;
    border: 1px solid #e2e8f0;
  }
  td {
    padding: 8px 12px;
    font-size: 12px;
    border: 1px solid #e2e8f0;
  }
  .text-end { text-align: ${t?"left":"right"}; }
  .text-center { text-align: center; }
  @media print {
    body { background: #fff; padding: 0; }
    .container { box-shadow: none; padding: 0; width: 100%; max-width: 100%; }
  }
</style>
</head>
<body onload="window.print();">
  <div class="container">
    <div class="header">
      <div>
        <h1>${r(e.branchName)}</h1>
        <p style="font-weight: 700; color: #64748b; margin-top: 4px;">
          ${t?"تقرير إغلاق الوردية واليوم الشامل":"Comprehensive Day & Shift Closing Report"} (Z-Report)
        </p>
      </div>
      <div style="text-align: ${t?"left":"right"}; font-size: 12px;">
        <p><strong>${t?"رقم الوردية:":"Shift ID:"}</strong> #${e.shiftId.slice(0,8).toUpperCase()}</p>
        <p><strong>${t?"الكاشير:":"Cashier:"}</strong> ${r(e.cashierName)}</p>
        <p><strong>${t?"تاريخ الفتح:":"Opened:"}</strong> ${$(e.openedAt,n)}</p>
        <p><strong>${t?"تاريخ الإغلاق:":"Closed:"}</strong> ${e.closedAt?$(e.closedAt,n):"-"}</p>
      </div>
    </div>

    <!-- Top KPI Cards -->
    <div class="grid-4">
      <div class="card">
        <div class="label">${t?"صافي المبيعات":"Net Sales"}</div>
        <div class="val" style="color: #2563eb;">${i(e.netSales,o,n)}</div>
      </div>
      <div class="card">
        <div class="label">${t?"عدد الفواتير":"Invoices Count"}</div>
        <div class="val">${e.totalInvoices}</div>
      </div>
      <div class="card">
        <div class="label">${t?"متوسط الفاتورة":"Avg Ticket"}</div>
        <div class="val">${i(e.avgTicket,o,n)}</div>
      </div>
      <div class="card">
        <div class="label">${t?"فارق الصندوق":"Drawer Difference"}</div>
        <div class="val" style="color: ${c};">${i(e.difference,o,n)}</div>
      </div>
    </div>

    <!-- Sales & Drawer Reconciliation Tables Grid -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
      <div>
        <h3 class="section-heading">${t?"ملخص الإيرادات والضرائب":"Revenue & Tax Summary"}</h3>
        <table>
          <tbody>
            <tr><td>${t?"إجمالي المبيعات (Gross):":"Gross Sales:"}</td><td class="text-end font-bold">${i(e.grossSales,o,n)}</td></tr>
            <tr><td>${t?"إجمالي الخصومات:":"Total Discounts:"}</td><td class="text-end font-bold" style="color: #dc2626;">-${i(e.totalDiscounts,o,n)}</td></tr>
            <tr><td>${t?"إجمالي الضرائب:":"Total Taxes:"}</td><td class="text-end font-bold">+${i(e.totalTaxes,o,n)}</td></tr>
            <tr style="background: #f1f5f9; font-weight: 900;"><td>${t?"صافي الإيراد (Net):":"Net Revenue:"}</td><td class="text-end font-bold">${i(e.netSales,o,n)}</td></tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 class="section-heading">${t?"تسوية عهدة النقدية":"Cash Reconciliation"}</h3>
        <table>
          <tbody>
            <tr><td>${t?"رصيد الافتتاح:":"Opening Cash:"}</td><td class="text-end">${i(e.openingAmount,o,n)}</td></tr>
            <tr><td>${t?"المصروفات النقدية:":"Cash Expenses:"}</td><td class="text-end">-${i(e.expenses,o,n)}</td></tr>
            <tr><td>${t?"مشتريات الكاش:":"Cash Purchases:"}</td><td class="text-end">-${i(e.cashPurchases||0,o,n)}</td></tr>
            <tr><td>${t?"المتوقع بالدرج:":"Expected Cash:"}</td><td class="text-end font-bold">${i(e.expectedAmount,o,n)}</td></tr>
            <tr><td>${t?"الفعلي بالدرج (العد):":"Actual Counted:"}</td><td class="text-end font-bold">${i(e.actualAmount,o,n)}</td></tr>
            <tr style="background: #f8fafc; font-weight: 900; color: ${c};"><td>${t?"الفارق (عجز / زيادة):":"Difference:"}</td><td class="text-end">${i(e.difference,o,n)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Payment Methods -->
    <h3 class="section-heading">${t?"تفصيل طرق الدفع المحصلة":"Payment Methods Breakdown"}</h3>
    <table>
      <thead>
        <tr>
          <th>${t?"طريقة الدفع":"Payment Method"}</th>
          <th class="text-center">${t?"عدد العمليات":"Transactions"}</th>
          <th class="text-end">${t?"إجمالي المبلغ":"Total Amount"}</th>
        </tr>
      </thead>
      <tbody>
        ${e.paymentMethods.map(s=>`
          <tr>
            <td style="font-weight: 700;">${r(s.label)}</td>
            <td class="text-center">${s.count}</td>
            <td class="text-end font-bold">${i(s.total,o,n)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    ${(e.salesDetails||[]).length>0?`
      <h3 class="section-heading">${t?"الفواتير ودفعات كل فاتورة":"Invoices & Tender Allocation"}</h3>
      <table>
        <thead><tr>
          <th>${t?"الفاتورة":"Invoice"}</th>
          <th>${t?"المستخدم":"User"}</th>
          <th>${t?"طرق الدفع":"Tender Allocation"}</th>
          <th class="text-end">${t?"الإجمالي":"Total"}</th>
        </tr></thead>
        <tbody>${(e.salesDetails||[]).map(s=>`<tr>
          <td>
            <div>${r(s.invoiceNumber)}</div>
            ${s.orderNumber?`<div style="font-size:10px;color:#64748b;font-weight:700;">${t?"الطلب":"Order"}: ${r(s.orderNumber)}</div>`:""}
          </td>
          <td>${r(s.userName||"-")}</td>
          <td>${s.payments&&s.payments.length>0?s.payments.map(u=>`${r(u.method)}: ${i(u.amount,o,n)}`).join(" + "):`${r(s.paymentMethod||"-")}: ${i(s.paidAmount,o,n)}`}</td>
          <td class="text-end font-bold">${i(s.total,o,n)}</td>
        </tr>`).join("")}</tbody>
      </table>
    `:""}
    ${(e.expenseDetails||[]).length>0?`
      <h3 class="section-heading">${t?"المصروفات بالتفصيل":"Expense Details"}</h3>
      <table>
        <thead><tr>
          <th>${t?"التصنيف":"Category"}</th><th>${t?"البيان":"Description"}</th>
          <th>${t?"المستخدم":"User"}</th><th>${t?"الدفع":"Payment"}</th>
          <th class="text-end">${t?"المبلغ":"Amount"}</th>
        </tr></thead>
        <tbody>${(e.expenseDetails||[]).map(s=>`<tr>
          <td>${r(s.category||"-")}</td><td>${r(s.description||"-")}</td>
          <td>${r(s.createdByName||"-")}</td><td>${r(s.paymentMethod||"-")}</td>
          <td class="text-end font-bold">${i(s.amount,o,n)}</td>
        </tr>`).join("")}</tbody>
      </table>
    `:""}

    ${(e.cashPurchaseDetails||[]).length>0?`
      <h3 class="section-heading">${t?"مشتريات الكاش بالتفصيل":"Cash Purchase Details"}</h3>
      <table>
        <thead><tr>
          <th>${t?"فاتورة الشراء":"Purchase Invoice"}</th>
          <th>${t?"التاريخ":"Date"}</th>
          <th class="text-end">${t?"المبلغ المخصوم":"Cash Outflow"}</th>
        </tr></thead>
        <tbody>${(e.cashPurchaseDetails||[]).map(s=>`<tr>
          <td>${r(s.invoiceNumber||"-")}</td>
          <td>${$(s.createdAt,n)}</td>
          <td class="text-end font-bold">-${i(s.amount,o,n)}</td>
        </tr>`).join("")}</tbody>
      </table>
    `:""}

    ${(e.userReports||[]).length>0?`
      <h3 class="section-heading">${t?"تفاصيل كل مستخدم":"Per-user Details"}</h3>
      <table>
        <thead><tr>
          <th>${t?"المستخدم":"User"}</th><th class="text-center">${t?"الفواتير":"Invoices"}</th>
          <th class="text-end">${t?"المبيعات":"Sales"}</th><th class="text-end">${t?"الخصومات":"Discounts"}</th>
          <th class="text-end">${t?"المرتجعات":"Returns"}</th><th class="text-end">${t?"المصروفات":"Expenses"}</th>
          <th class="text-end">${t?"الصافي":"Net"}</th>
        </tr></thead>
        <tbody>${(e.userReports||[]).map(s=>`<tr>
          <td>${r(s.displayName)}</td><td class="text-center">${s.invoiceCount}</td>
          <td class="text-end">${i(s.salesTotal,o,n)}</td>
          <td class="text-end">${i(s.discounts,o,n)}</td>
          <td class="text-end">${i(s.returns,o,n)}</td>
          <td class="text-end">${i(s.expenses,o,n)}</td>
          <td class="text-end font-bold">${i(s.netContribution,o,n)}</td>
        </tr>`).join("")}</tbody>
      </table>
    `:""}

    <!-- Products Sold -->
    <h3 class="section-heading">${t?"المنتجات والأصناف المباعة":"Products Sold Summary"}</h3>
    <table>
      <thead>
        <tr>
          <th>${t?"اسم المنتج":"Product Name"}</th>
          <th class="text-center">${t?"الكمية المباعة":"Qty Sold"}</th>
          <th class="text-end">${t?"إجمالي المبيعات":"Total Sales"}</th>
        </tr>
      </thead>
      <tbody>
        ${e.productsSold.map(s=>`
          <tr>
            <td>${r(s.productName)}</td>
            <td class="text-center font-bold">${s.quantity} ${r(s.unitName)}</td>
            <td class="text-end font-bold">${i(s.total,o,n)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <!-- Ingredients Consumed -->
    ${e.ingredientsConsumed.length>0?`
      <h3 class="section-heading">${t?"المكونات والمواد الخام المستهلكة (الخصم التلقائي للوصفات)":"Raw Materials & Ingredients Consumed (Recipe Deductions)"}</h3>
      <table>
        <thead>
          <tr>
            <th>${t?"المادة الخام / المكون":"Raw Material"}</th>
            <th class="text-center">${t?"الكمية المستهلكة":"Consumed Qty"}</th>
            <th class="text-end">${t?"التكلفة الفعلية":"Actual Cost"}</th>
            <th class="text-end">${t?"السالب التقديري":"Negative Estimate"}</th>
            <th class="text-end">${t?"الإجمالي المعروض":"Displayed Total"}</th>
          </tr>
        </thead>
        <tbody>
          ${e.ingredientsConsumed.map(s=>`
            <tr>
              <td>${r(s.materialName)}</td>
              <td class="text-center font-bold">${s.quantity} ${r(s.unit)}</td>
              <td class="text-end">${i(s.actualCost,o,n)}</td>
              <td class="text-end">${s.estimatedQuantity>0?i(s.estimatedCost,o,n):"-"}</td>
              <td class="text-end font-bold">${i(s.displayedCost,o,n)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `:""}

    ${e.notes?`
      <div style="margin-top: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
        <strong style="color: #475569;">${t?"ملاحظات الإغلاق:":"Closing Notes:"}</strong>
        <p style="margin-top: 4px;">${r(e.notes)}</p>
      </div>
    `:""}

    <div style="margin-top: 40px; display: flex; justify-content: space-between; padding-top: 20px; border-top: 1px dashed #cbd5e1; font-size: 12px; color: #64748b;">
      <div>${t?"توقيع الكاشير: _______________________":"Cashier Signature: _______________________"}</div>
      <div>${t?"توقيع مدير الفرع / المحاسب: _______________________":"Manager Signature: _______________________"}</div>
    </div>
  </div>
</body>
</html>`}const H={cash:"نقدي (Cash)",card:"بطاقة / ائتمان (Card)",transfer:"تحويل / محفظة (Transfer)",bank_transfer:"تحويل بنكي (Bank Transfer)",instapay:"إنستاباي / محفظة (InstaPay)",credit:"آجل عملاء (Customer Credit)",employee_credit:"آجل موظفين (Employee Credit)"},G={dine_in:"صالة (Dine-in)",takeaway:"سفري / تيك أواي (Takeaway)",delivery:"توصيل (Delivery)",drive_thru:"خدمة السيارات (Drive-thru)"};async function Z(e){var E,D;const[o,n]=await Promise.all([x.rpc("get_shift_closing_report",{p_shift_id:e}),z.getSaleTenders({p_shift_id:e})]);if(o.error)throw new Error(o.error.message);const t=o.data;if(!(t!=null&&t.success))throw new Error(String((t==null?void 0:t.detail)||(t==null?void 0:t.error)||"Could not load shift closing report"));const h=n.data||null,c=new Map;if(!n.error&&(h!=null&&h.success)&&Array.isArray(h.sales))for(const l of h.sales){const a=l,p=String(a.sale_id||""),d=Array.isArray(a.payments)?a.payments.map(b=>{const m=b;return{method:String(m.method||"cash"),amount:Number(m.amount||0)}}):[];p&&c.set(p,d)}const s=!n.error&&(h!=null&&h.success)&&Array.isArray(h.payment_methods)?h.payment_methods:t.payment_methods,u=Array.isArray(s)?s.map(l=>{const a=l,p=String(a.method||"cash");return{method:p,label:H[p]||p,count:Number(a.count||0),total:Number(a.total||0)}}):[],f=Array.isArray(t.users)?t.users.map(l=>{const a=l;return{userId:String(a.user_id||""),displayName:String(a.display_name||""),salesTotal:Number(a.sales_total||0),invoiceCount:Number(a.invoice_count||0),discounts:Number(a.discounts||0),returns:Number(a.returns||0),expenses:Number(a.expenses||0),netContribution:Number(a.net_contribution||0),sales:Array.isArray(a.sales)?a.sales.map(p=>{const d=p;return{invoiceNumber:String(d.invoice_number||""),total:Number(d.total||0),paymentMethod:String(d.payment_method||""),createdAt:String(d.created_at||"")}}):[],expenseDetails:Array.isArray(a.expenses_detail)?a.expenses_detail.map(p=>{const d=p;return{category:String(d.category||""),description:String(d.description||""),amount:Number(d.amount||0),paymentMethod:String(d.payment_method||""),createdAt:String(d.created_at||"")}}):[],returnDetails:Array.isArray(a.returns_detail)?a.returns_detail.map(p=>{const d=p;return{amount:Number(d.amount||0),paymentMethod:String(d.payment_method||""),createdAt:String(d.created_at||"")}}):[]}}):[],v=Array.isArray(t.expense_details)?t.expense_details.map(l=>{const a=l;return{expenseId:String(a.expense_id||""),category:String(a.category||""),description:String(a.description||""),amount:Number(a.amount||0),paymentMethod:String(a.payment_method||"cash"),expenseDate:String(a.expense_date||""),notes:a.notes?String(a.notes):null,createdAt:String(a.created_at||""),createdBy:String(a.created_by||""),createdByName:String(a.created_by_name||"")}}):[],_=Array.isArray(t.sales_details)?t.sales_details.map(l=>{const a=l;return{saleId:String(a.sale_id||""),invoiceNumber:String(a.invoice_number||""),orderNumber:"",userId:String(a.user_id||""),userName:String(a.user_name||""),subtotal:Number(a.subtotal||0),discountAmount:Number(a.discount_amount||0),taxAmount:Number(a.tax_amount||0),total:Number(a.total||0),paidAmount:Number(a.paid_amount||0),refundedAmount:Number(a.refunded_amount||0),paymentMethod:String(a.payment_method||""),payments:c.get(String(a.sale_id||""))||[],orderType:String(a.order_type||""),createdAt:String(a.created_at||"")}}):[],w=Array.from(new Set(_.map(l=>l.saleId).filter(Boolean)));if(w.length>0){const{data:l,error:a}=await x.from("sales").select("id,source_order:orders!sales_source_order_id_fkey(order_number)").in("id",w);if(a)throw new Error(`SHIFT_REPORT_ORDER_TRACE_LOAD_FAILED: ${a.message}`);const p=new Map;for(const d of l||[]){const b=d.source_order;b!=null&&b.order_number&&p.set(String(d.id),String(b.order_number))}for(const d of _)d.orderNumber=p.get(d.saleId)||""}const g=[];if(t.branch_id&&t.opened_at){const l=t.closed_at?String(t.closed_at):new Date().toISOString(),{data:a,error:p}=await x.from("purchases").select("id,invoice_number,paid_amount,returned_amount,payment_method,status,created_at").eq("branch_id",String(t.branch_id)).eq("payment_method","cash").in("status",["completed","returned"]).gte("created_at",String(t.opened_at)).lte("created_at",l).order("created_at",{ascending:!0});if(p)throw new Error(`SHIFT_REPORT_CASH_PURCHASES_LOAD_FAILED: ${p.message}`);for(const d of a||[]){const b=Math.max(0,Number(d.paid_amount||0)-Number(d.returned_amount||0));b<=0||g.push({purchaseId:String(d.id),invoiceNumber:String(d.invoice_number||""),amount:b,createdAt:String(d.created_at||"")})}}const j=g.reduce((l,a)=>l+a.amount,0),k=Array.isArray(t.treasury)?t.treasury.map(l=>{const a=l;return{accountId:String(a.account_id||""),accountName:String(a.account_name||""),openingBalance:Number(a.opening_balance||0),glBalance:Number(a.gl_balance||0)}}):[],y=new Map;for(const l of _){const a=l.orderType||"takeaway",p=y.get(a)||{count:0,total:0};p.count+=1,p.total+=Number(l.total||0),y.set(a,p)}const S=new Map,C=Array.from(new Set(_.map(l=>l.saleId).filter(Boolean)));if(C.length>0){const{data:l,error:a}=await x.from("sale_items").select("sale_id,product_id,unit_name,quantity,unit_price,total,refunded_quantity,refunded_amount,product:products(name,name_en)").in("sale_id",C);if(a)throw new Error(`SHIFT_REPORT_ITEMS_LOAD_FAILED: ${a.message}`);const p=l||[];for(const d of p){const b=d.product_id||`unlinked:${d.unit_name||"item"}`,m=((E=d.product)==null?void 0:E.name)||((D=d.product)==null?void 0:D.name_en)||d.unit_name||"منتج",N=S.get(b)||{name:m,quantity:0,unitName:d.unit_name||"قطعة",total:0},R=Math.max(0,Number(d.quantity||0)-Number(d.refunded_quantity||0)),O=Number(d.total||Number(d.quantity||0)*Number(d.unit_price||0)),I=Math.max(0,O-Number(d.refunded_amount||0));R<=0&&I<=0||(N.quantity+=R,N.total+=I,S.set(b,N))}}const T=[];if(t.branch_id&&t.opened_at){const l=t.closed_at?String(t.closed_at):new Date().toISOString(),{data:a,error:p}=await B.getRawConsumptionCostBreakdown({p_branch_id:String(t.branch_id),p_from:String(t.opened_at),p_to:l});if(p)throw new Error(`SHIFT_REPORT_RAW_COST_LOAD_FAILED: ${p.message}`);for(const d of a||[])T.push({materialId:String(d.raw_material_id||""),materialName:String(d.raw_material_name||"مادة خام"),quantity:Number(d.consumed_quantity||0),unit:String(d.unit_name||""),actualQuantity:Number(d.actual_quantity||0),estimatedQuantity:Number(d.estimated_quantity||0),actualCost:Number(d.actual_cost||0),estimatedCost:Number(d.estimated_cost||0),displayedCost:Number(d.displayed_cost||0)})}return{shiftId:e,branchId:String(t.branch_id||""),branchName:String(t.branch_name||""),cashierName:String(t.cashier_name||""),openedAt:String(t.opened_at||""),closedAt:t.closed_at?String(t.closed_at):null,openingAmount:Number(t.opening_amount||0),expectedAmount:Number(t.expected_cash||0),actualAmount:Number(t.actual_cash||0),difference:Number(t.difference||0),notes:t.notes?String(t.notes):null,totalInvoices:Number(t.invoice_count||0),grossSales:Number(t.gross_sales||0),totalDiscounts:Number(t.discounts||0),returns:Number(t.returns||0),voids:Number(t.voids||0),expenses:Number(t.expenses||0),cashPurchases:j,cashPurchaseDetails:g,netRevenue:Number(t.net_revenue||0),totalTaxes:Number(t.taxes||0),netSales:Number(t.net_sales||0),avgTicket:Number(t.invoice_count||0)>0?Number(t.net_revenue||0)/Number(t.invoice_count):0,orderTypes:Array.from(y,([l,a])=>({type:l,label:G[l]||l,count:a.count,total:a.total})),paymentMethods:u,productsSold:Array.from(S,([l,a])=>({productId:l,productName:a.name,quantity:a.quantity,unitName:a.unitName,total:a.total})),ingredientsConsumed:T,userReports:f,treasuryBalances:k,expenseDetails:v,salesDetails:_}}async function X(e){try{const o=await Z(e.shiftId);return await L({branchId:e.branchId,payload:{text:U(o,e.currency,e.lang),paperWidthMm:80,copies:1},idempotencyKey:`zreport:auto:${e.shiftId}`})}catch(o){return{accepted:!1,error:o instanceof Error?o.message:"Z_REPORT_QUEUE_FAILED"}}}export{V as C,W as P,J as a,K as b,U as c,X as e,Z as f};
