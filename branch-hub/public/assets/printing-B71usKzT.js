var Q=Object.defineProperty;var Y=(e,t,o)=>t in e?Q(e,t,{enumerable:!0,configurable:!0,writable:!0,value:o}):e[t]=o;var M=(e,t,o)=>Y(e,typeof t!="symbol"?t+"":t,o);import{bk as U,bl as J,bm as w,n as X,e as D,f as L,bn as k,J as R}from"./index-DMH0lpXz.js";const Z=[58,80],S=80,E=new Map;class _ extends Error{constructor(o,n){super(n);M(this,"code");this.name="ReceiptPrintApprovalError",this.code=o}}async function ee(e){var T;const t=(T=e.invoice)==null?void 0:T.trim();if(!t)throw new _("INVALID_INVOICE","Receipt invoice number is required");const{data:o,error:n}=await R.from("sales").select("id").eq("invoice_number",t).maybeSingle();if(n)throw n;if(!(o!=null&&o.id))throw new _("SALE_NOT_FOUND","Sale was not found for receipt printing");const a=async y=>{const{data:h,error:p}=await R.rpc("authorize_sale_print",{p_sale_id:o.id,p_approval_request_id:y});if(p)throw p;return h??{}},d=await a(null);if(d.success)return{saleId:o.id,approvalRequestId:null};if(d.error!=="MANAGER_APPROVAL_REQUIRED")throw new _(d.error||"PRINT_NOT_AUTHORIZED",d.error||"Receipt print is not authorized");const r=new Date().toISOString(),{data:s,error:i}=await R.from("approval_requests").select("id,status,expires_at").eq("action_type","reprint").eq("entity_type","sale").eq("entity_id",o.id).in("status",["pending","approved"]).gt("expires_at",r).order("created_at",{ascending:!1}).limit(1).maybeSingle();if(i)throw i;const m=s;if((m==null?void 0:m.status)==="approved"){const y=await a(m.id);if(y.success)return{saleId:o.id,approvalRequestId:m.id};throw new _(y.error||"INVALID_APPROVAL",y.error||"Reprint approval is invalid")}if((m==null?void 0:m.status)==="pending")throw new _("REPRINT_APPROVAL_PENDING","Manager approval is pending for this receipt reprint");const{data:c,error:u}=await R.rpc("request_manager_approval",{p_action_type:"reprint",p_entity_type:"sale",p_entity_id:o.id,p_payload:{invoice_number:t,total:e.total},p_reason:`Receipt reprint: ${t}`});if(u)throw u;const b=c??{};throw b.success?new _("REPRINT_APPROVAL_PENDING","Manager approval request was sent for this receipt reprint"):new _(b.error||"APPROVAL_REQUEST_FAILED",b.error||"Could not create reprint approval request")}async function q(e){const{data:t,error:o}=await R.rpc("record_sale_print",{p_sale_id:e.saleId,p_approval_request_id:e.approvalRequestId});if(o)throw o;const n=t??{};if(!n.success)throw new _(n.error||"PRINT_RECORD_FAILED",n.error||"Receipt print could not be recorded")}function te(){var e,t;return((t=(e=globalThis.crypto)==null?void 0:e.randomUUID)==null?void 0:t.call(e))||`print_${Date.now()}_${Math.random().toString(16).slice(2)}`}function ne(e){var t;return((t=e.match(/<meta name="johns-print-auth" content="([^"]+)">/))==null?void 0:t[1])||null}function oe(e){const t=Number(e);return Number.isFinite(t)?Math.max(50,Math.min(100,t)):80}function O(e){return e<=Z[0]+2}function l(e){return Array.from(String(e??"")).filter(t=>t==="\r"||t===`
`||t==="	"||t>=" ").join("").trim()}function C(e,t=2){const o=Number(e||0);return Number.isFinite(o)?new Intl.NumberFormat("en-US",{minimumFractionDigits:0,maximumFractionDigits:t,useGrouping:!0}).format(o):"0"}function f(e,t){return`${C(e,2)} ${l(t||"EGP")}`}function H(e){const t=new Date(e);if(Number.isNaN(t.getTime()))return l(e);const o=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:!1}).formatToParts(t),n=a=>{var d;return((d=o.find(r=>r.type===a))==null?void 0:d.value)||""};return`${n("year")}-${n("month")}-${n("day")} ${n("hour")}:${n("minute")}`}function G(e,t){const o=String(e||"").toLowerCase(),a={cash:["نقدي","CASH"],card:["بطاقة","CARD"],transfer:["تحويل","TRANSFER"],bank_transfer:["تحويل بنكي","BANK TRANSFER"],instapay:["إنستاباي","INSTAPAY"],credit:["آجل","CREDIT"]}[o];return a?t?a[0]:a[1]:l(e).toUpperCase()}function ae(e,t){const o=l(e);return!o||o.length>=t?o:`${" ".repeat(Math.max(0,Math.floor((t-o.length)/2)))}${o}`}function z(e,t,o){const n=l(e),a=l(t);if(!a)return n;const d=o-n.length-a.length;return d<2?`${n}\r
${a}`:`${n}${" ".repeat(d)}${a}`}function W(e,t,o,n){const a=l(t.currency||"EGP"),d=S,r=[];r.push({label:e.isOpenOrder?n?"رقم الطلب":"Order":n?"رقم الفاتورة":"Invoice",value:l(e.invoice),emphasis:!0}),r.push({label:n?"التاريخ":"Date",value:H(e.date)}),e.orderTypeLabel&&r.push({label:n?"النوع":"Type",value:l(e.orderTypeLabel)}),e.tableName&&r.push({label:n?"الطاولة":"Table",value:l(e.tableName),emphasis:!0}),e.guestCount&&r.push({label:n?"عدد الأفراد":"Guests",value:String(e.guestCount)}),e.customerName&&r.push({label:n?"العميل":"Customer",value:l(e.customerName)}),e.operatorName&&r.push({label:n?"المستخدم":"User",value:l(e.operatorName)});const s=[{label:n?"المجموع الفرعي":"Subtotal",value:f(e.subtotal,a)}];if(e.discount>0&&s.push({label:n?"الخصم":"Discount",value:`-${f(e.discount,a)}`}),t.receipt_show_tax!==!1&&e.tax>0&&s.push({label:n?"الضريبة":"Tax",value:f(e.tax,a)}),s.push({label:n?"الإجمالي":"TOTAL",value:f(e.total,a),emphasis:!0}),!e.isOpenOrder&&!e.hidePaymentSummary){for(const u of(e.payments||[]).filter(b=>l(b.method)))s.push({label:G(u.method,n),value:f(u.amount,a)});s.push({label:n?"المدفوع":"Paid",value:f(e.paid,a)}),e.change>0&&s.push({label:n?"الباقي":"Change",value:f(e.change,a)})}const i=l(t.receipt_footer),m=n?"شكراً لزيارتكم":"Thank you for visiting",c=[];return t.store_address&&c.push(l(t.store_address)),t.store_phone&&c.push(`${n?"هاتف":"Tel"}: ${l(t.store_phone)}`),i&&i.toLocaleLowerCase()!==m.toLocaleLowerCase()&&c.push(i),c.push(m),{version:1,kind:"customer",isAr:n,paperWidthMm:d,storeName:l(t.store_name||"JOHNA'S").toUpperCase(),storeSubtitle:"RESTAURANT",title:l(e.documentTitle)||(e.isOpenOrder?n?"الحساب المفتوح":"OPEN CHECK":n?"إيصال العميل":"CUSTOMER RECEIPT"),subtitle:e.isOpenOrder?n?"غير مدفوع":"NOT PAID":n?"نسخة العميل":"CUSTOMER COPY",slogan:l(t.receipt_header)||(n?"الأكل الجيد يجمع الناس":"Good Food Brings People Together"),branchName:l(e.branchName),meta:r,itemsHeading:n?"الأصناف":"ITEMS",items:e.items.map(u=>({qty:C(u.qty,3),name:l(u.name),price:f(u.price,a),total:f(u.total,a)})),totals:s,footerLines:c}}function V(e,t,o,n){const a=l(t.currency||"EGP"),d=S,r=O(d)?32:42,s="-".repeat(O(d)?32:42),i=[],m=p=>n?l(p):ae(p,r),c=(p,g)=>i.push(`${p}: ${l(g)}`),u=(p,g)=>{const $=l(g);i.push(n?`${p}: ${$}`:z(p,$,r))},b=l(t.store_name);b&&i.push(m(b.toUpperCase())),i.push(m(l(e.documentTitle)||(e.isOpenOrder?n?"حساب مبدئي":"OPEN CHECK":n?"إيصال العميل":"CUSTOMER RECEIPT")));const T=l(e.branchName);T&&i.push(m(T)),i.push(s),c(e.isOpenOrder?n?"الطلب":"Order":n?"الفاتورة":"Invoice",e.invoice),c(n?"التاريخ":"Date",H(e.date)),e.orderTypeLabel&&c(n?"النوع":"Type",e.orderTypeLabel),e.orderNumber&&e.orderNumber!==e.invoice&&c(n?"الطلب":"Order",e.orderNumber),e.tableName&&c(n?"الطاولة":"Table",e.tableName),e.guestCount&&c(n?"الأفراد":"Guests",e.guestCount),e.customerName&&c(n?"العميل":"Customer",e.customerName),e.operatorName&&c(n?"المستخدم":"User",e.operatorName),i.push(s),i.push(m(n?"الأصناف":"ITEMS")),i.push(s);for(const p of e.items){i.push(l(p.name));const g=`${C(p.qty,3)} x ${f(p.price,a)}`,$=f(p.total,a);i.push(n?`${g} = ${$}`:z(g,$,r))}if(i.push(s),u(n?"المجموع الفرعي":"SUBTOTAL",f(e.subtotal,a)),e.discount>0&&u(n?"الخصم":"DISCOUNT",`-${f(e.discount,a)}`),t.receipt_show_tax!==!1&&e.tax>0&&u(n?"الضريبة":"TAX",f(e.tax,a)),u(n?"الإجمالي":"TOTAL",f(e.total,a)),!e.isOpenOrder&&!e.hidePaymentSummary){const p=(e.payments||[]).filter(g=>String(g.method||"").trim());if(p.length>0){i.push(s),i.push(m(n?"الدفع":"PAYMENT"));for(const g of p)u(G(g.method,n),f(g.amount,a))}u(n?"المدفوع":"PAID",f(e.paid,a)),e.change>0&&u(n?"الباقي":"CHANGE",f(e.change,a))}i.push(s),t.receipt_footer&&i.push(m(t.receipt_footer)),i.push(m(n?"شكراً لزيارتكم":"Thank you for visiting"));const y=`${i.join(`\r
`)}\r
\r
`,h=Math.max(1,Math.min(5,t.receipt_copies||1));return Array.from({length:h},()=>y).join(`\r
\f\r
`)}function F(e,t){const o=window.open("","_blank",`width=${Math.min(500,t+140)},height=600`);return o?(o.document.write(e),o.document.close(),o.focus(),o.print(),window.setTimeout(()=>{o.closed||o.close()},300),!0):!1}function se(e,t){const o=ne(e),n=o?E.get(o)??null:null;if(o&&E.delete(o),n&&!X())return(async()=>{try{if((await U({saleId:n.authorization.saleId,approvalRequestId:n.authorization.approvalRequestId,payload:{text:n.plainText,template:n.template,paperWidthMm:t,copies:1},idempotencyKey:o?`receipt-ui:${o}`:void 0})).accepted)return;const s=D(),i=s.cashier||s.receipt||s.main||"";if(i&&L()&&await k({printerName:i,text:n.plainText,template:n.template,paperWidthMm:t})){await q(n.authorization);return}console.warn("[receipt-print] cloud/local print not confirmed; browser fallback is not recorded as printed"),F(e,t)}catch(r){console.error("[receipt-print] remote print failed",r),F(e,t)}})(),!0;const a=window.open("","_blank",`width=${Math.min(500,t+140)},height=600`);if(!a)return!1;if(a.document.write(e),a.document.close(),!n)return!0;const d=async()=>{if(!a.closed)try{const r=D(),s=r.cashier||r.receipt||r.main||"";let i=!1;if(s&&L()&&(i=await k({printerName:s,html:e,template:n.template,paperWidthMm:t})),i){await q(n.authorization),a.closed||a.close();return}console.warn("[receipt-print] local print not confirmed; browser fallback is not recorded as printed"),a.focus(),a.print(),window.setTimeout(()=>{a.closed||a.close()},300)}catch(r){if(console.error("[receipt-print] confirmed print record failed",r),!a.closed){const s=r instanceof Error?r.message:"Receipt print could not be confirmed";a.document.body.innerHTML=`<pre style="white-space:pre-wrap;padding:20px;font-family:sans-serif">${w(s)}</pre>`}}};return a.document.readyState==="complete"?window.setTimeout(()=>void d(),0):a.addEventListener("load",()=>void d(),{once:!0}),!0}async function le(e){var o;const t=(o=e.saleId)==null?void 0:o.trim();return t?U({saleId:t,approvalRequestId:null,payload:{text:V(e.receipt,e.settings,e.lang,e.isAr),template:W(e.receipt,e.settings,e.lang,e.isAr),paperWidthMm:S,copies:1},idempotencyKey:`receipt:auto:${t}:1`}):{accepted:!1,error:"SALE_ID_REQUIRED"}}async function de(e,t,o,n,a){let d=null;const r=W(e,t,o,n);if((a==null?void 0:a.authorize)!==!1){const i=await ee(e);d=te(),E.set(d,{authorization:i,plainText:V(e,t,o,n),template:r});const m=d;window.setTimeout(()=>E.delete(m),6e4)}let s=J(r);if(d){const i=`<meta name="johns-print-auth" content="${w(d)}">`;s=s.replace("<head>",`<head>
${i}`)}return s}function me(e){const t=oe(e.s.receipt_width_mm||80),o=O(t),n=o?2:3,a=o?15:17,d=o?19:22,r=o?14:16,s=o?19:22,i=o?20:24,{orderNumber:m,tableName:c,orderTypeLabel:u,guestCount:b,items:T,orderNote:y,isAr:h}=e,p=new Date().toLocaleString(h?"ar-EG":"en-US"),g=2+(m?1:0)+(c?1:0)+(b?1:0),$=(v,N)=>{const x=String(v||"").trim();return x?x.split(/\r?\n/).reduce((P,I)=>P+Math.max(1,Math.ceil(I.length/N)),0):0},j=T.reduce((v,N)=>{const x=o?16:24,P=Math.max(1,$(N.name,x)),I=$(N.note,o?20:28);return v+7.5+P*4.8+I*4.2},0),K=$(y,o?22:30),A=Math.max(45,Math.ceil(25+g*5+K*4.2+j+9)),B=T.map(v=>`<section class="item-row"><div class="item-line"><strong class="qty-badge">${w(v.qty)}×</strong><div class="item-name">${w(v.name)}${v.unit_name&&v.unit_name!=="piece"?` <span class="unit">(${w(v.unit_name)})</span>`:""}</div></div><div class="qty-caption">${h?"الكمية":"Qty"}: <strong>${w(v.qty)}</strong></div>${v.note?`<div class="item-note"><strong>${h?"ملاحظة":"Note"}:</strong> ${w(v.note)}</div>`:""}</section>`).join("");return`<!DOCTYPE html>
    <html lang="${h?"ar":"en"}" dir="${h?"rtl":"ltr"}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${h?"تذكرة المطبخ":"Kitchen Ticket"}</title>
      <style>
        :root { color-scheme: light only; }
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          width: ${t}mm;
          min-width: ${t}mm;
          max-width: ${t}mm;
          min-height: 0;
          height: auto;
          background: #fff;
          color: #000;
          font-family: Tahoma, Arial, "Segoe UI", sans-serif;
          font-size: ${a}px;
          line-height: 1.35;
          font-weight: 600;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body { overflow: visible; }
        .ticket {
          width: ${t}mm;
          padding: 2.5mm ${n}mm 3mm;
          background: #fff;
          color: #000;
          border: .45mm solid #000;
        }
        .center { text-align: center; }
        .header {
          font-size: ${d}px;
          line-height: 1.2;
          font-weight: 900;
          margin-bottom: 1.5mm;
          overflow-wrap: anywhere;
        }
        .ticket-title {
          font-size: ${r}px;
          font-weight: 900;
          margin-bottom: 1mm;
        }
        .divider {
          width: 100%;
          margin: 2mm 0;
          border: 0;
          border-top: .45mm solid #000;
        }
        .meta-row {
          display: block;
          margin: 1mm 0;
          font-size: ${r}px;
          font-weight: 700;
          overflow-wrap: anywhere;
        }
        .item-row {
          padding: 2.2mm 0;
          border-bottom: .35mm dashed #000;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .item-row:last-child { border-bottom: 0; }
        .item-line {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 2.5mm;
          align-items: center;
        }
        .qty-badge {
          min-width: 12mm;
          padding: 1mm 1.5mm;
          border: .4mm solid #000;
          text-align: center;
          direction: ltr;
          unicode-bidi: isolate;
          font-size: ${i}px;
          line-height: 1;
          font-weight: 900;
        }
        .item-name {
          font-size: ${s}px;
          line-height: 1.2;
          font-weight: 900;
          overflow-wrap: anywhere;
        }
        .unit { font-size: .72em; font-weight: 700; }
        .item-note { margin-top: 1.2mm; padding: 1.2mm 1.5mm; border: .3mm solid #000; font-size: ${r}px; line-height: 1.35; font-weight: 800; white-space: pre-wrap; overflow-wrap: anywhere; }
        .order-note { margin: 1.5mm 0; padding: 1.5mm; border: .4mm solid #000; font-size: ${r}px; line-height: 1.35; font-weight: 900; white-space: pre-wrap; overflow-wrap: anywhere; }
        .qty-caption {
          margin-top: 1.2mm;
          font-size: ${r}px;
          font-weight: 800;
        }
        .qty-caption strong {
          direction: ltr;
          unicode-bidi: isolate;
          font-size: 1.15em;
          font-weight: 900;
        }
        .footer {
          margin-top: 2mm;
          text-align: center;
          font-size: ${r}px;
          font-weight: 800;
        }
        @page {
          size: ${t}mm ${A}mm;
          margin: 0;
        }
        @media print {
          html,
          body {
            width: ${t}mm !important;
            min-width: ${t}mm !important;
            max-width: ${t}mm !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            color: #000 !important;
          }
          .ticket {
            width: ${t}mm !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
        }
      </style>
    </head>
    <body>
      <main class="ticket">
        <div class="center header">${w(e.s.store_name)}</div>
        <div class="center ticket-title">${h?"تذكرة المطبخ":"Kitchen Ticket"}</div>
        <div class="divider"></div>
        <div class="meta-row">${h?"التاريخ":"Date"}: ${w(p)}</div>
        <div class="meta-row">${h?"النوع":"Type"}: ${w(u)}</div>
        ${m?`<div class="meta-row">${h?"الطلب":"Order"}: ${w(m)}</div>`:""}
        ${c?`<div class="meta-row">${h?"طاولة":"Table"}: ${w(c)}</div>`:""}
        ${b?`<div class="meta-row">${h?"الضيوف":"Guests"}: ${b}</div>`:""}
        ${y?`<div class="order-note"><strong>${h?"ملاحظات الطلب":"Order notes"}:</strong> ${w(y)}</div>`:""}
        <div class="divider"></div>
        ${B}
        <div class="divider"></div>
        <div class="footer">${h?"شكراً":"Thank you"}</div>
      </main>
    </body>
    <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }<\/script>
    </html>`}export{S as A,_ as R,V as a,me as b,W as c,de as d,le as e,se as o};
