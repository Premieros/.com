'use strict';
const $=id=>document.getElementById(id);
let token='',staffToken='',session=null,cart=[],pending=null;
const message=text=>{$('status').textContent=text;};
async function api(route,method='GET',body){
 const response=await fetch('/api/v1/'+route,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json','x-hub-session':staffToken},body:body?JSON.stringify(body):undefined});
 const result=await response.json();
 if(!response.ok){if(result.error==='STAFF_SESSION_REQUIRED')lockStaff();const error=Error(result.error||'تعذر تنفيذ الطلب');error.status=response.status;error.code=result.error;throw error;}return result;
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
 for(const s of stock.stock){const row=document.createElement('tr');for(const value of [s.product_name||s.sku,s.quantity,(s.unit_cost_minor/100).toFixed(2)]){const td=document.createElement('td');td.textContent=value;row.append(td);}$('stock').append(row);const option=document.createElement('option');option.value=s.sku;option.textContent=s.product_name||s.sku;if(s.sale_price_minor!==null&&s.sale_price_minor!==undefined)option.dataset.price=String(s.sale_price_minor);$('sku').append(option);}
 if(!pending)updatePublishedPrice();
 const printerId=$('printer').value;$('printer').replaceChildren();
 for(const id of printers.printers){const opt=document.createElement('option');opt.value=id;opt.textContent=id;$('printer').append(opt);}if(printers.printers.includes(printerId))$('printer').value=printerId;
 $('sales').replaceChildren();
 for(const s of sales.sales){const row=addText($('sales'),`${s.id.slice(0,8)} · ${(s.total_minor/100).toFixed(2)} · ${s.created_at}`);if(session.permissions.includes('print'))button(row,'طباعة',async()=>{await api(`offline/sales/${s.id}/print`,'POST',{printerId:$('printer').value});message('تمت إضافة الإيصال لقائمة الطباعة. راجع حالة الإرسال.');await refresh();});}
 $('jobs').replaceChildren();for(const j of jobs.jobs)addText($('jobs'),`${j.id.slice(0,8)}: ${j.delivery_state||j.status}${j.error?' · '+j.error:''}`);
 $('health').textContent=`سلامة البيانات: ${integrity.ok?'سليمة':'تحتاج مراجعة'} · عمليات محلية تنتظر المزامنة: ${sync.pending}`;
 if(session.admin){drawPrinterSettings(printers.details||{});await refreshStaff();const cloud=await api('cloud/status');$('cloud-status').textContent=cloud.configured?`تم استلام ${cloud.replicatedSales} عملية · رُحلت رسميًا ${cloud.postedSales||0} · معلقة للمراجعة ${cloud.postingConflicts||0} · تعارضات الأسعار ${cloud.priceConflicts}${cloud.lastError?' · تعذر آخر اتصال':''}`:'لم تُربط جلسة المزامنة السحابية لهذا الجهاز.';const postings=await api('cloud/posting-conflicts');$('posting-conflicts').replaceChildren();for(const c of postings.conflicts)addText($('posting-conflicts'),`${c.event_id.slice(0,8)} · ${postingReason(c.reason)}`);const {conflicts}=await api('cloud/conflicts');$('price-conflicts').replaceChildren();for(const c of conflicts){const row=addText($('price-conflicts'),`${c.sku} · ${c.reason==='UNKNOWN_LOCAL_SKU'?'الصنف غير موجود محليًا':'رقم إصدار السعر مستخدم بقيم أخرى'}`);button(row,'إعادة الفحص',async()=>{const r=await api('cloud/conflicts/'+c.id+'/retry','POST');message(r.outcome==='applied'?'تم تطبيق السعر.':'التعارض ما زال يحتاج مراجعة.');await refresh();});}const {devices}=await api('devices');$('devices').replaceChildren();for(const d of devices){const row=addText($('devices'),`${d.name} · ${d.role} · ${d.revoked?'ملغى':'نشط'}`);if(!d.revoked)button(row,'إلغاء الربط',async()=>{await api('devices/'+d.id,'DELETE');await refresh();});}}
}
function lockStaff(){staffToken='';$('workspace').hidden=true;$('staff-login').hidden=false;$('login').hidden=true;$('logout').hidden=false;$('staff-switch').hidden=true;$('staff-password').value='';}
async function openWorkspace(current){
 session=current;
 if(session.staffLoginRequired){lockStaff();return;}
 $('login').hidden=true;$('staff-login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('staff-switch').hidden=!session.staffName;
 $('admin').hidden=!session.admin;$('sale-panel').hidden=!session.permissions.includes('sell');$('branch').textContent='الفرع: '+session.branchId+(session.staffName?' · '+session.staffName:'');
 pending=JSON.parse(localStorage.getItem(draftKey())||'null');cart=pending?.lines||[];drawCart();await refresh();message('متصل بخادم الفرع المحلي.');
}
$('login-form').onsubmit=async event=>{
 event.preventDefault();token=$('credential').value;$('credential').value='';staffToken='';
 try{await openWorkspace(await api('session'));}
 catch(e){token='';session=null;$('login').hidden=false;$('workspace').hidden=true;message(e.message);}
};
$('staff-login-form').onsubmit=async event=>{
 event.preventDefault();const b=event.submitter;b.disabled=true;const password=$('staff-password').value;$('staff-password').value='';
 try{const result=await api('staff/login','POST',{username:$('staff-username').value.toLowerCase(),password});staffToken=result.token;await openWorkspace(await api('session'));}
 catch(e){message(e.code==='STAFF_LOGIN_LIMITED'?'محاولات كثيرة. انتظر 15 دقيقة قبل إعادة المحاولة.':e.code==='STAFF_AUTH_BUSY'?'الخادم يتحقق من حساب آخر. أعد المحاولة.':'تعذر دخول الموظف. تحقق من البيانات أو راجع المدير.');}
 finally{b.disabled=false;}
};
$('logout').onclick=async()=>{if(staffToken)try{await api('staff/logout','POST');}catch{}token='';staffToken='';session=null;location.reload();};
$('staff-switch').onclick=async()=>{if(staffToken)try{await api('staff/logout','POST');}catch{}lockStaff();message('أدخل حساب الموظف. أي بيع معلق سيُعاد التحقق منه بنفس رقمه.');};
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
 }catch(e){message(e.code==='SALE_EVENT_TOO_LARGE'?'تفاصيل البيع كبيرة جدًا. ألغ الطلب المرفوض وقسّم الأصناف على عمليتين.':'لم يتم تأكيد العملية: '+e.message);drawCart();if(e.code==='SALE_EVENT_TOO_LARGE'||e.code==='INVALID_SALE'||e.code==='PRICE_CHANGED'||e.code?.startsWith('INSUFFICIENT_STOCK'))$('cancel-pending').hidden=false;}
};
$('device-form').onsubmit=async event=>{event.preventDefault();try{const d=await api('devices','POST',{...scope(),name:$('device-name').value,role:$('device-role').value});$('device-result').textContent='احفظ رمز الجهاز الآن: '+d.token;await refresh();}catch(e){message(e.message);}};
$('opening-form').onsubmit=async event=>{event.preventDefault();try{await api('offline/stock/opening','POST',{...scope(),sku:$('opening-sku').value,quantity:Number($('opening-qty').value),unitCostMinor:Math.round(Number($('opening-cost').value)*100)});message('تم حفظ الرصيد الافتتاحي.');await refresh();}catch(e){message(e.message);}};
$('backup').onclick=async()=>{try{const b=await api('backups','POST');$('backup-result').textContent=`تم الحفظ على جهاز الفرع: ${b.filename} (${b.bytes} bytes)`;}catch(e){message(e.message);}};

$('cancel-pending').onclick=()=>{localStorage.removeItem(draftKey());pending=null;cart=[];drawCart();message('تم إلغاء الطلب المرفوض. يمكنك بدء بيع جديد.');};

if(window.branchHub){window.branchHub.localCredential().then(value=>{if(value){$('credential').value=value;$('login-form').requestSubmit();}}).catch(()=>{});}

if(window.branchHub){$('recovery-key').hidden=false;$('recovery-key').onclick=async()=>{const result=await window.branchHub.exportRecoveryKey();message(result.ok?'تم حفظ مفتاح الاستعادة. احتفظ به منفصلًا عن النسخ الاحتياطية.':result.canceled?'تم إلغاء الحفظ.':'تعذر حفظ المفتاح. اختر ملفًا جديدًا.');};}

$('cloud-sync').onclick=async()=>{try{await api('cloud/sync','POST');message('اكتملت دورة المزامنة. راجع عدد العمليات المرحّلة والمعلقة.');await refresh();}catch(e){message(e.message);}};

function updatePublishedPrice(){const value=$('sku').selectedOptions[0]?.dataset.price;$('price').readOnly=value!==undefined;$('price').value=value!==undefined?(Number(value)/100).toFixed(2):'';}
$('sku').onchange=updatePublishedPrice;

function postingReason(reason){return ({HUB_MAPPING_REQUIRED:'البيع غير مرتبط بصنف ومخزن رسميين',HUB_PRICE_CHANGED:'سعر البيع السحابي تغير',HUB_COST_CHANGED:'التكلفة السحابية تغيرت',HUB_CLOUD_STOCK_SHORTAGE:'الرصيد السحابي غير كافٍ',HUB_TAX_RULE_CONFLICT:'إعداد الضريبة لا يطابق البيع المحلي',HUB_BANK_METHOD_REQUIRED:'بيانات الدفع البنكي غير مكتملة',HUB_READY_PRODUCT_REQUIRED:'نوع الصنف غير مدعوم في الترحيل الحالي',HUB_CANONICAL_SALE_REJECTED:'النظام الرسمي رفض الترحيل؛ راجع إعدادات الفرع'})[reason]||'العملية معلقة وتحتاج مراجعة';}
$('load-warehouses').onclick=async()=>{try{const result=await api('cloud/warehouses');$('cloud-warehouse').replaceChildren();for(const w of result.warehouses){const o=document.createElement('option');o.value=w.id;o.textContent=w.name;$('cloud-warehouse').append(o);}}catch(e){message(e.message);}};
$('catalog-import').onsubmit=async event=>{event.preventDefault();const b=event.submitter;b.disabled=true;try{const r=await api('cloud/catalog/import','POST',{warehouseId:$('cloud-warehouse').value});message(`تم ربط ${r.products} صنف، وتهيئة ${r.seeded} رصيد جديد. أصناف غير مدعومة: ${r.skipped.length}`);await refresh();}catch(e){message(e.message);}finally{b.disabled=false;}};

const roleLabel=role=>({cashier:'كاشير',viewer:'عرض فقط',stock:'عرض المخزون'})[role]||role;
async function refreshStaff(){
 const result=await api('staff');$('staff-list').replaceChildren();$('reset-staff-id').replaceChildren();
 for(const user of result.staff){
  const row=addText($('staff-list'),`${user.name} · ${user.username} · ${roleLabel(user.role)} · ${user.disabled?'معطل':'نشط'}`);
  button(row,user.disabled?'إعادة تفعيل':'تعطيل وإغلاق الجلسات',async()=>{await api('staff/'+user.id,'PATCH',{disabled:!user.disabled});await refreshStaff();});
  const option=document.createElement('option');option.value=user.id;option.textContent=user.name;$('reset-staff-id').append(option);
 }
}
$('staff-create').onsubmit=async event=>{
 event.preventDefault();const b=event.submitter;b.disabled=true;const password=$('new-staff-password').value;$('new-staff-password').value='';
 try{await api('staff','POST',{...scope(),username:$('new-staff-username').value,name:$('new-staff-name').value,role:$('new-staff-role').value,password});message('تم إنشاء الموظف وتفعيل تسجيل الدخول على الأجهزة المرتبطة.');await refreshStaff();}
 catch{message('تعذر إنشاء الحساب. تحقق من الاسم الفريد وكلمة مرور من 12 حرفًا على الأقل.');}finally{b.disabled=false;}
};
$('staff-reset').onsubmit=async event=>{
 event.preventDefault();const b=event.submitter;b.disabled=true;const password=$('reset-staff-password').value;$('reset-staff-password').value='';
 try{await api('staff/'+$('reset-staff-id').value,'PATCH',{password,role:$('reset-staff-role').value});message('تم تغيير البيانات وإغلاق جلسات الموظف.');await refreshStaff();}
 catch{message('تعذر تغيير بيانات الموظف.');}finally{b.disabled=false;}
};

function drawPrinterSettings(printers){
 $('printer-settings-list').replaceChildren();
 for(const [id,p] of Object.entries(printers)){
  const row=addText($('printer-settings-list'),`${id} · ${p.host}:${p.port} · ${p.format==='raster'?'صورة':'نص'}`);
  const b=document.createElement('button');b.type='button';b.textContent='تعديل';b.onclick=()=>{
   $('settings-printer-id').value=id;$('settings-printer-host').value=p.host;$('settings-printer-port').value=p.port;
   $('settings-printer-format').value=p.format;$('settings-printer-dots').value=p.dots||576;
  };row.append(b);
 }
}
$('printer-settings-form').onsubmit=async event=>{
 event.preventDefault();const b=event.submitter;b.disabled=true;
 try{await api('printers/'+$('settings-printer-id').value,'PUT',{...scope(),host:$('settings-printer-host').value,port:Number($('settings-printer-port').value),format:$('settings-printer-format').value,dots:Number($('settings-printer-dots').value)});message('تم حفظ إعداد الطابعة على خادم الفرع.');await refresh();}
 catch(e){message(e.code==='PRINTER_HAS_PENDING_JOBS'?'توجد مهام لهذه الطابعة. راجع حالتها قبل تغيير الوجهة.':'تعذر حفظ الطابعة. استخدم عنوان IPv4 محليًا ومنفذًا صحيحًا.');}finally{b.disabled=false;}
};
