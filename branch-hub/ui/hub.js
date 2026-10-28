'use strict';
const $=id=>document.getElementById(id);
let token='',session=null,cart=[],pending=null;
const message=text=>{$('status').textContent=text;};
async function api(route,method='GET',body){
 const response=await fetch('/api/v1/'+route,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 const result=await response.json();
 if(!response.ok){const error=Error(result.error||'تعذر تنفيذ الطلب');error.status=response.status;error.code=result.error;throw error;}return result;
}
const scope=()=>({organizationId:session.organizationId,branchId:session.branchId});
const draftKey=()=>`premier-pending:${session.organizationId}:${session.branchId}`;
function addText(parent,text,className='item') {const e=document.createElement('div');e.className=className;e.textContent=text;parent.append(e);return e;}
function button(parent,text,action){const b=document.createElement('button');b.textContent=text;b.onclick=()=>action().catch(e=>message(e.message));parent.append(b);}
function drawCart(){
 $('cart').replaceChildren();
 cart.forEach((line,i)=>{const row=addText($('cart'),`${line.sku} × ${line.quantity} — ${(line.quantity*line.priceMinor/100).toFixed(2)}`);if(!pending)button(row,'حذف',async()=>{cart.splice(i,1);drawCart();});});
 $('pending').hidden=!pending;$('cancel-pending').hidden=true;$('line-form').hidden=Boolean(pending);
 $('checkout').disabled=!cart.length;$('checkout').textContent=pending?'إعادة التحقق من نفس البيع':'تسجيل البيع';
}
async function refresh(){
 const [stock,sales,jobs,sync,integrity,printers]=await Promise.all(['offline/stock','offline/sales','jobs','offline/sync/status','offline/integrity','printers'].map(x=>api(x)));
 $('stock').replaceChildren();$('sku').replaceChildren();
 for(const s of stock.stock){const row=document.createElement('tr');for(const value of [s.sku,s.quantity,(s.unit_cost_minor/100).toFixed(2)]){const td=document.createElement('td');td.textContent=value;row.append(td);}$('stock').append(row);const option=document.createElement('option');option.value=s.sku;option.textContent=s.sku;if(s.sale_price_minor!==null&&s.sale_price_minor!==undefined)option.dataset.price=String(s.sale_price_minor);$('sku').append(option);}
 if(!pending)updatePublishedPrice();
 const printerId=$('printer').value;$('printer').replaceChildren();
 for(const id of printers.printers){const opt=document.createElement('option');opt.value=id;opt.textContent=id;$('printer').append(opt);}if(printers.printers.includes(printerId))$('printer').value=printerId;
 $('sales').replaceChildren();
 for(const s of sales.sales){const row=addText($('sales'),`${s.id.slice(0,8)} · ${(s.total_minor/100).toFixed(2)} · ${s.created_at}`);if(session.permissions.includes('print'))button(row,'طباعة',async()=>{await api(`offline/sales/${s.id}/print`,'POST',{printerId:$('printer').value});message('تمت إضافة الإيصال لقائمة الطباعة. راجع حالة الإرسال.');await refresh();});}
 $('jobs').replaceChildren();for(const j of jobs.jobs)addText($('jobs'),`${j.id.slice(0,8)}: ${j.delivery_state||j.status}${j.error?' · '+j.error:''}`);
 $('health').textContent=`سلامة البيانات: ${integrity.ok?'سليمة':'تحتاج مراجعة'} · عمليات محلية تنتظر المزامنة: ${sync.pending}`;
 if(session.admin){const cloud=await api('cloud/status');$('cloud-status').textContent=cloud.configured?`تم رفع ${cloud.replicatedSales} عملية للاستقبال · تعارضات الأسعار: ${cloud.priceConflicts}${cloud.lastError?' · تعذر آخر اتصال':''} · الترحيل المحاسبي السحابي غير مكتمل`:'لم تُربط جلسة المزامنة السحابية لهذا الجهاز.';const {conflicts}=await api('cloud/conflicts');$('price-conflicts').replaceChildren();for(const c of conflicts){const row=addText($('price-conflicts'),`${c.sku} · ${c.reason==='UNKNOWN_LOCAL_SKU'?'الصنف غير موجود محليًا':'رقم إصدار السعر مستخدم بقيم أخرى'}`);button(row,'إعادة الفحص',async()=>{const r=await api('cloud/conflicts/'+c.id+'/retry','POST');message(r.outcome==='applied'?'تم تطبيق السعر.':'التعارض ما زال يحتاج مراجعة.');await refresh();});}const {devices}=await api('devices');$('devices').replaceChildren();for(const d of devices){const row=addText($('devices'),`${d.name} · ${d.role} · ${d.revoked?'ملغى':'نشط'}`);if(!d.revoked)button(row,'إلغاء الربط',async()=>{await api('devices/'+d.id,'DELETE');await refresh();});}}
}
$('login-form').onsubmit=async event=>{
 event.preventDefault();token=$('credential').value;$('credential').value='';
 try {session=await api('session');$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('admin').hidden=!session.admin;$('sale-panel').hidden=!session.permissions.includes('sell');$('branch').textContent='الفرع: '+session.branchId;
  pending=JSON.parse(localStorage.getItem(draftKey())||'null');cart=pending?.lines||[];drawCart();await refresh();message('متصل بخادم الفرع المحلي.');
 }catch(e){token='';session=null;$('login').hidden=false;$('workspace').hidden=true;message(e.message);}
};
$('logout').onclick=()=>{token='';session=null;location.reload();};
$('refresh').onclick=()=>refresh().catch(e=>message(e.message));
$('line-form').onsubmit=event=>{event.preventDefault();if(pending)return;
 const line={sku:$('sku').value,quantity:Number($('quantity').value),priceMinor:Math.round(Number($('price').value)*100)};
 if(!Number.isSafeInteger(line.quantity)||line.quantity<=0||!Number.isSafeInteger(line.priceMinor)||line.priceMinor<=0)return message('الكمية أو السعر غير صالح.');
 const existing=cart.find(x=>x.sku===line.sku);if(existing){if(existing.priceMinor!==line.priceMinor)return message('الصنف موجود بسعر مختلف.');existing.quantity+=line.quantity;}else cart.push(line);drawCart();
};
$('checkout').onclick=async()=>{
 if(!cart.length)return;$('checkout').disabled=true;
 try {
  if(!pending){pending={...scope(),key:crypto.randomUUID(),lines:structuredClone(cart)};localStorage.setItem(draftKey(),JSON.stringify(pending));}
  const result=await api('offline/sales','POST',pending);
  localStorage.removeItem(draftKey());pending=null;cart=[];drawCart();message(`تم حفظ البيع ${result.saleId} بقيمة ${(result.totalMinor/100).toFixed(2)}`);await refresh();
 }catch(e){message('لم يتم تأكيد العملية: '+e.message);drawCart();if(e.code==='INVALID_SALE'||e.code==='PRICE_CHANGED'||e.code?.startsWith('INSUFFICIENT_STOCK'))$('cancel-pending').hidden=false;}
};
$('device-form').onsubmit=async event=>{event.preventDefault();try{const d=await api('devices','POST',{...scope(),name:$('device-name').value,role:$('device-role').value});$('device-result').textContent='احفظ رمز الجهاز الآن: '+d.token;await refresh();}catch(e){message(e.message);}};
$('opening-form').onsubmit=async event=>{event.preventDefault();try{await api('offline/stock/opening','POST',{...scope(),sku:$('opening-sku').value,quantity:Number($('opening-qty').value),unitCostMinor:Math.round(Number($('opening-cost').value)*100)});message('تم حفظ الرصيد الافتتاحي.');await refresh();}catch(e){message(e.message);}};
$('backup').onclick=async()=>{try{const b=await api('backups','POST');$('backup-result').textContent=`تم الحفظ على جهاز الفرع: ${b.filename} (${b.bytes} bytes)`;}catch(e){message(e.message);}};

$('cancel-pending').onclick=()=>{localStorage.removeItem(draftKey());pending=null;cart=[];drawCart();message('تم إلغاء الطلب المرفوض. يمكنك بدء بيع جديد.');};

if(window.branchHub){window.branchHub.localCredential().then(value=>{if(value){$('credential').value=value;$('login-form').requestSubmit();}}).catch(()=>{});}

if(window.branchHub){$('recovery-key').hidden=false;$('recovery-key').onclick=async()=>{const result=await window.branchHub.exportRecoveryKey();message(result.ok?'تم حفظ مفتاح الاستعادة. احتفظ به منفصلًا عن النسخ الاحتياطية.':result.canceled?'تم إلغاء الحفظ.':'تعذر حفظ المفتاح. اختر ملفًا جديدًا.');};}

$('cloud-sync').onclick=async()=>{try{await api('cloud/sync','POST');message('تمت دورة النقل. الاستقبال السحابي لا يعني الترحيل المحاسبي.');await refresh();}catch(e){message(e.message);}};

function updatePublishedPrice(){const value=$('sku').selectedOptions[0]?.dataset.price;$('price').readOnly=value!==undefined;$('price').value=value!==undefined?(Number(value)/100).toFixed(2):'';}
$('sku').onchange=updatePublishedPrice;
