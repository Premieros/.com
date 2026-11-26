/* The authenticated Premier window performs authorized writes without sharing tokens. */
(() => {
 'use strict';
 const channel='bunker-editor-v1', origin='https://premieros-sage.vercel.app';
 const nonce=new URLSearchParams(location.search).get('editor');
 const bridge=window.opener;
 if(!bridge||!/^[a-f0-9]{32}$/.test(nonce||''))return;
 const toggle=document.getElementById('editToggle');
 const socialEdit=document.createElement('a');
 socialEdit.href=origin+'/#/website-contact/d56aae83-f1b3-4153-9224-87594500368d';
 socialEdit.target='_blank';socialEdit.rel='noopener noreferrer';
 socialEdit.textContent='تعديل روابط التواصل';
 socialEdit.hidden=true;
 document.getElementById('bunkerSocial')?.after(socialEdit);

 const status=document.createElement('div');
 status.id='inlineEditorStatus';status.setAttribute('role','status');status.dir='rtl';document.body.append(status);
 const instructions=document.createElement('p');instructions.id='inlineEditorInstructions';
 instructions.textContent='اضغط مرتين على النص لتعديله، أو استخدم زر تغيير الصورة. احفظ كل تعديل أو ألغِه.';
 instructions.className='inline-editor-instructions';instructions.dir='rtl';document.body.append(instructions);
 let active=false,busy=false,revision=0,photos={},edited=null,connecting=true;
 const pending=new Map();
 let closeTimer=null;
 const tell=message=>{status.textContent=message;};
 function stop(){
  socialEdit.hidden=true;active=false;connecting=false;document.body.classList.remove('website-editing');
  toggle.classList.remove('show');
  if(closeTimer)clearInterval(closeTimer);
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('انقطع اتصال التحرير. افتح وضع التعديل مجددًا.'));}pending.clear();
  if(edited)cancelText();
  document.querySelectorAll('[data-editable-text]').forEach(node=>node.removeAttribute('tabindex'));
 }
 function request(op,values={}) {
  return new Promise((resolve,reject)=>{
   if(!bridge||bridge.closed){reject(new Error('افتح وضع التعديل أولًا.'));return;}
   const id=crypto.randomUUID();
   const timer=setTimeout(()=>{pending.delete(id);reject(new Error('تعذر تأكيد الحفظ. أعد فتح وضع التعديل لتحميل النسخة المحفوظة قبل المحاولة مجددًا.'));},60000);
   pending.set(id,{resolve,reject,timer});
   bridge.postMessage({channel,nonce,id,op,...values},origin);
  });
 }
 window.addEventListener('message',event=>{
  const data=event.data;
  if(event.origin!==origin||event.source!==bridge||data?.channel!==channel||data?.nonce!==nonce)return;
  if(data.type==='disconnected'){stop();tell('انتهت جلسة التعديل.');return;}
  const waiting=pending.get(data.id);if(!waiting)return;
  pending.delete(data.id);clearTimeout(waiting.timer);
  if(data.ok)waiting.resolve(data.result);else waiting.reject(new Error(data.error||'تعذر الحفظ.'));
 });
 let loadInFlight=false;
 async function connect(){
  if(loadInFlight||!connecting)return;loadInFlight=true;
  try{
   const result=await request('load');if(!connecting)return;
   revision=result.revision;photos=result.photos||{};
   Object.assign(content,result.content,photos);render();
   socialEdit.hidden=false;active=true;connecting=false;document.body.classList.add('website-editing');
   document.querySelectorAll('[data-editable-text]').forEach(node=>node.tabIndex=0);
   toggle.textContent='إنهاء التعديل';tell('وضع التعديل متاح. اضغط مرتين على النص أو غيّر الصورة من زرها.');
   toggle.classList.add('show');
   window.focus();
  }catch(error){tell(error.message);stop();}finally{loadInFlight=false;}
 }
 toggle.addEventListener('click',()=>{
  if(busy){tell('انتظر اكتمال الحفظ.');return;}
  stop();tell('انتهى وضع التعديل.');
 });
 closeTimer=setInterval(()=>{if(bridge.closed){stop();tell('انتهت جلسة التعديل.');}},1000);
 void connect();
 function cancelText(){
  if(!edited)return;
  const {node,original,controls}=edited;node.textContent=original;node.removeAttribute('contenteditable');
  controls.remove();edited=null;
 }
 async function saveText(){
  if(!edited||busy)return;
  const current=edited,value=current.node.innerText;
  if(value.length>3000){tell('الحد الأقصى للنص ٣٠٠٠ حرف.');return;}
  busy=true;current.controls.querySelectorAll('button').forEach(button=>button.disabled=true);tell('جار نشر النص…');
  try{
   const result=await request('text',{key:current.node.dataset.editableText,value,revision});
   revision=result.revision;content[result.key]=result.value;
   current.node.removeAttribute('contenteditable');current.controls.remove();edited=null;render();tell('تم حفظ النص ونشره للجميع.');
  }catch(error){tell(error.message);}finally{busy=false;if(edited)edited.controls.querySelectorAll('button').forEach(button=>button.disabled=false);}
 }
 function editText(node){
  if(!active||busy)return;
  if(edited){if(edited.node!==node)tell('احفظ النص الحالي أو ألغِ تعديله أولًا.');return;}
  const controls=document.createElement('span');controls.className='inline-text-actions';controls.dir='rtl';
  const save=document.createElement('button');save.type='button';save.textContent='حفظ النص';save.onclick=()=>void saveText();
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='إلغاء';cancel.onclick=cancelText;
  controls.append(save,cancel);node.after(controls);
  edited={node,original:node.textContent,controls};node.setAttribute('contenteditable','plaintext-only');node.focus();
  const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  tell('عدّل النص ثم اضغط حفظ النص. Escape للإلغاء، وCtrl+Enter للحفظ.');
 }
 document.querySelectorAll('[data-editable-text]').forEach(node=>{
  node.addEventListener('dblclick',event=>{if(active){event.preventDefault();event.stopPropagation();editText(node);}});
  node.addEventListener('click',event=>{if(active&&node.closest('a'))event.preventDefault();});
  node.addEventListener('keydown',event=>{
   if(!active)return;
   if(event.key==='Escape'&&edited&&!busy){event.preventDefault();cancelText();}
   else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&edited){event.preventDefault();void saveText();}
   else if(event.key==='Enter'&&!edited){event.preventDefault();editText(node);}
  });
 });
 const dialog=document.createElement('dialog');dialog.className='inline-image-dialog';dialog.dir='rtl';
 dialog.setAttribute('aria-label','تغيير صورة الموقع');
 dialog.innerHTML='<form method="dialog"><h2>تغيير الصورة</h2><label>ارفع صورة من جهازك<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><p>أو ألصق رابط صورة</p><label>رابط الصورة<input name="url" type="url" placeholder="https://..."></label><p>JPG أو PNG أو WebP، حتى ٥ ميجابايت.</p><div><button type="button" data-save>حفظ الصورة</button><button value="cancel">إلغاء</button></div><p role="status" data-status></p></form>';
 document.body.append(dialog);
 let imageKey='';
 document.querySelectorAll('[data-editable-image]').forEach(image=>{
  const button=document.createElement('button');button.type='button';button.className='inline-image-change';
  button.textContent='تغيير الصورة';button.setAttribute('aria-label',`تغيير الصورة: ${image.alt}`);
  const parent=image.id==='heroImage'?image.closest('.hero'):image.parentElement;
  parent.classList.add('inline-image-host');parent.append(button);
  button.onclick=()=>{
   if(!active||busy)return;
   if(edited){tell('احفظ النص الحالي أو ألغِه أولًا.');return;}
   imageKey=image.dataset.editableImage;dialog.querySelector('form').reset();dialog.querySelector('[data-status]').textContent='';dialog.showModal();
  };
 });
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.querySelector('[data-save]').onclick=async()=>{
  if(!active||busy)return;
  const file=dialog.querySelector('[name="photo"]').files[0],url=dialog.querySelector('[name="url"]').value.trim();
  const feedback=dialog.querySelector('[data-status]');
  if(!file&&!url){feedback.textContent='اختر صورة أو أدخل رابطها.';return;}
  if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>5*1024*1024)){feedback.textContent='اختر JPG أو PNG أو WebP حتى ٥ ميجابايت.';return;}
  busy=true;dialog.querySelectorAll('button,input').forEach(node=>node.disabled=true);feedback.textContent='جار رفع الصورة ونشرها…';
  try{
   const result=await request('image',{key:imageKey,file,value:url,previous:photos[imageKey]||''});
   photos[result.key]=result.value;content[result.key]=result.value;render();dialog.close();tell('تم حفظ الصورة ونشرها للجميع.');
  }catch(error){feedback.textContent=error.message;}finally{busy=false;dialog.querySelectorAll('button,input').forEach(node=>node.disabled=false);}
 };
 window.addEventListener('beforeunload',event=>{if(edited||busy){event.preventDefault();event.returnValue='';}});
})();
