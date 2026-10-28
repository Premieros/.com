'use strict';
const $=id=>document.getElementById(id);
const messages={CLOUD_ACCESS_DENIED:'تعذر تسجيل الدخول أو لا توجد صلاحية.',BRANCH_ADMIN_REQUIRED:'هذا الحساب لا يملك صلاحية إدارة الفروع.',CLOUD_UNAVAILABLE:'تعذر الاتصال بالخادم. تحقق من الإنترنت.',BRANCH_ACCESS_DENIED:'لم يعد الحساب مخولًا للوصول إلى هذا الفرع.',OS_CREDENTIAL_VAULT_UNAVAILABLE:'حماية بيانات الجهاز غير متاحة على نظام التشغيل.'};
$('setup-login').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter||event.currentTarget.querySelector('button');button.disabled=true;
 try {
  const password=$('password').value;$('password').value='';
  const result=await window.branchHub.signIn({email:$('email').value,password});
  if(!result.ok)throw Error(result.error);
  $('branch-choice').replaceChildren();
  for(const branch of result.branches){const option=document.createElement('option');option.value=branch.id;option.textContent=branch.name+' · '+branch.organizationId;$('branch-choice').append(option);}
  if(!result.branches.length)throw Error('لا توجد فروع متاحة لهذا الحساب.');
  $('setup-login').hidden=true;$('setup-branch').hidden=false;$('setup-status').textContent='اختر الفرع لتأكيد ربط الجهاز.';
 }catch(e){$('setup-status').textContent=messages[e.message]||'تعذر إعداد الربط: '+e.message;}finally{button.disabled=false;}
};
$('setup-branch').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter||event.currentTarget.querySelector('button');button.disabled=true;
 try{const result=await window.branchHub.enroll($('branch-choice').value);if(!result.ok)throw Error(result.error);$('setup-status').textContent='تم الربط. جارٍ تشغيل خادم الفرع…';}
 catch(e){$('setup-status').textContent=messages[e.message]||'تعذر ربط الفرع: '+e.message;button.disabled=false;}
};
