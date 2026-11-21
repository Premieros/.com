import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/api';

const fields = [
 ['eyebrow','النص أعلى العنوان'],['heroSub','العنوان الفرعي'],['heroCopy','وصف الصفحة'],
 ['heroPanel','النص الجانبي'],['experienceEyebrow','مقدمة التجربة'],['experienceTitle','عنوان التجربة'],
 ['experienceCopy','وصف التجربة'],['featureBadge','عنوان القسم المميز'],['featureTitle','العنوان المميز'],
 ['featureCopy','الوصف المميز'],['burgerTitle','عنوان البرجر'],['burgerCopy','وصف البرجر'],
 ['coffeeTitle','عنوان القهوة'],['coffeeCopy','وصف القهوة'],['interiorTitle','عنوان الفرع'],
 ['interiorCopy','وصف الفرع'],['dessertTitle','عنوان الأصناف الإضافية'],['dessertCopy','وصف الأصناف الإضافية'],
 ['galleryTitle','عنوان الصور'],['ctaTitle','عنوان الطلب'],['ctaCopy','وصف الطلب'],
] as const;

export function WebsiteTextSettings({branchId}:{branchId:string}) {
 const [content,setContent]=useState<Record<string,string>>({});
 const [revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 const [failed,setFailed]=useState(false);
 const alive=useRef(true);
 useEffect(()=>{
  let cancelled=false;
  alive.current=true;
  void supabase.rpc('branch_website_content_settings',{p_branch:branchId}).then(({data,error})=>{
   if(cancelled)return;
   if(error){setFailed(true);setMessage('تعذر تحميل نصوص الموقع. '+error.message);}
   else {setContent(data?.content||{});setRevision(data?.revision||0);}
   setLoading(false);
  }).catch(()=>{
   if(cancelled)return;
   setFailed(true);setMessage('تعذر الاتصال لحفظ محتوى الموقع. أعد تحميل الصفحة للمحاولة.');setLoading(false);
  });
  return()=>{cancelled=true;alive.current=false;};
 },[branchId]);
 async function publish(){
  if(saving||loading||failed)return;
  setSaving(true);setMessage('');
  try{
   const {data,error}=await supabase.rpc('branch_website_content_save',{
    p_branch:branchId,p_content:content,p_revision:revision,
   });
   if(!alive.current)return;
   if(error){setMessage(error.message.includes('WEBSITE_CONTENT_CONFLICT')
    ?'نُشرت نسخة أحدث. أعد تحميل الصفحة قبل التعديل لتجنب مسح عمل مستخدم آخر.':error.message);return;}
   setRevision(Number(data));setMessage('تم نشر النصوص. تظهر للزوار بعد تحديث الموقع.');
  }catch{
   if(alive.current)setMessage('تعذر تأكيد النشر. أعد تحميل النسخة المحفوظة قبل المحاولة مجددًا.');
  }finally{if(alive.current)setSaving(false);}
 }
 return <section className="space-y-4 rounded-2xl border border-ui-border bg-ui-surface p-5">
  <h2 className="text-xl font-bold text-ui-text">نصوص الموقع</h2>
  <p className="text-sm text-ui-muted">تُنشر التعديلات على موقع الفرع لجميع الزوار. الحقل غير المخصص يستخدم النص الافتراضي.</p>
  {loading?<p role="status">جار تحميل النصوص…</p>:!failed&&<>
   <div className="grid gap-4 md:grid-cols-2">{fields.map(([key,label])=><label key={key} className="space-y-1 text-sm text-ui-text">
    <span>{label}</span>
    <textarea value={content[key]??''} maxLength={3000} disabled={saving}
     placeholder="النص الافتراضي" onChange={e=>setContent(previous=>({...previous,[key]:e.target.value}))}
     className="block w-full rounded-xl border border-ui-border bg-ui-page p-3"/>
   </label>)}</div>
   <button type="button" disabled={saving} onClick={()=>void publish()}
    className="rounded-xl bg-ui-primary px-5 py-3 text-white disabled:opacity-60">{saving?'جار النشر…':'نشر نصوص الموقع'}</button>
  </>}
  {message&&<p role={failed?'alert':'status'}>{message}</p>}
 </section>;
}
