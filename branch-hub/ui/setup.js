'use strict';
const $=id=>document.getElementById(id);
const messages={CLOUD_ACCESS_DENIED:'تعذر تسجيل الدخول أو لا توجد صلاحية.',BRANCH_ADMIN_REQUIRED:'هذا الحساب لا يملك صلاحية إدارة الفروع.',CLOUD_UNAVAILABLE:'انقطع الاتصال أثناء التحقق. أعد المحاولة؛ لن يُربط الجهاز قبل نجاح التحقق.',CLOUD_TIMEOUT:'انتهت مهلة الاتصال. أعد المحاولة.',CLOUD_DNS_FAILED:'تعذر الوصول إلى عنوان الخادم. راجع DNS أو الشبكة أو VPN.',CLOUD_TLS_FAILED:'تعذر توثيق شهادة الاتصال. راجع تاريخ الجهاز وإعدادات حماية الشبكة.',CLOUD_RATE_LIMITED:'طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.',CLOUD_TEMPORARY_ERROR:'الخادم غير متاح مؤقتًا. أعد المحاولة.',CLOUD_REQUEST_FAILED:'رفض الخادم طلب التحقق. راجع رمز الخطأ أدناه.',CLOUD_INVALID_RESPONSE:'وصل رد غير متوقع من الشبكة أو الخادم.',LOGIN_REQUIRED:'انتهت جلسة الإعداد. سجّل الدخول مجددًا.',BRANCH_ACCESS_DENIED:'لم يعد الحساب مخولًا للوصول إلى هذا الفرع.',OS_CREDENTIAL_VAULT_UNAVAILABLE:'حماية بيانات الجهاز غير متاحة على نظام التشغيل.'};
const phaseName=phase=>({sign_in:'تسجيل الدخول',account:'التحقق من الحساب',permission:'التحقق من الصلاحية',branch:'التحقق من الفرع'})[phase];
function requestError(result){const error=Error(result.error);error.phase=result.phase;error.httpStatus=result.httpStatus;return error;}
function errorText(error){return (messages[error.message]||'تعذر الإعداد: '+error.message)+(phaseName(error.phase)?' · '+phaseName(error.phase):'')+(error.httpStatus?' · HTTP '+error.httpStatus:'');}
$('setup-login').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter||event.currentTarget.querySelector('button');button.disabled=true;$('setup-status').textContent='جارٍ التحقق من الحساب والصلاحية…';
 try {
  const password=$('password').value;$('password').value='';
  const result=await window.branchHub.signIn({email:$('email').value,password});
  if(!result.ok)throw requestError(result);
  $('branch-choice').replaceChildren();
  for(const branch of result.branches){const option=document.createElement('option');option.value=branch.id;option.textContent=branch.name+' · '+branch.organizationId;$('branch-choice').append(option);}
  if(!result.branches.length)throw Error('لا توجد فروع متاحة لهذا الحساب.');
  $('setup-login').hidden=true;$('setup-branch').hidden=false;$('setup-status').textContent='اختر الفرع لتأكيد ربط الجهاز.';
 }catch(e){$('setup-status').textContent=errorText(e);}finally{button.disabled=false;}
};
$('setup-branch').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter||event.currentTarget.querySelector('button');button.disabled=true;$('setup-relogin').disabled=true;$('setup-status').textContent='جارٍ إعادة التحقق من الحساب والفرع قبل حفظ الربط…';
 try{const result=await window.branchHub.enroll($('branch-choice').value);if(!result.ok)throw requestError(result);$('setup-status').textContent='تم الربط. جارٍ تشغيل خادم الفرع…';}
 catch(e){$('setup-status').textContent=errorText(e);button.disabled=false;}finally{$('setup-relogin').disabled=false;}
};

$('setup-relogin').onclick=()=>{$('setup-login').hidden=false;$('setup-branch').hidden=true;$('password').value='';$('setup-status').textContent='سجّل الدخول لتحديث جلسة الربط.';};
