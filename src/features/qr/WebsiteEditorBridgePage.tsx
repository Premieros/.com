import {lazy,Suspense,useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {useAuth} from '@/context/AuthContext';
import {EDITOR_CHANNEL,executeWebsiteEdit,isWebsiteEditorMessage,WEBSITE_ORIGINS} from './websiteInlineEditor';

const LoginPage=lazy(()=>import('@/features/auth/pages/LoginPage').then(module=>({default:module.LoginPage})));

export function WebsiteEditorBridgePage() {
 const {user,loading}=useAuth();
 const [params]=useSearchParams();
 const origin=params.get('origin')||'';
 const nonce=params.get('nonce')||'';
 const [status,setStatus]=useState('ارجع إلى الموقع لبدء التعديل بعد التحقق من الصلاحيات.');
 const valid=WEBSITE_ORIGINS.includes(origin)&&/^[a-f0-9]{32}$/.test(nonce)&&!!window.opener;
 useEffect(()=>{
  if(!valid||loading||!user)return;
  const opener=window.opener;
  let cancelled=false;
  let queue=Promise.resolve();
  const send=(payload:object)=>opener?.postMessage({channel:EDITOR_CHANNEL,nonce,...payload},origin);
  const receive=(event:MessageEvent)=>{
   if(!isWebsiteEditorMessage(event,opener,origin,nonce))return;
   const request=event.data;
   if(request.op==='hello'){send({type:'ready'});return;}
   queue=queue.then(async()=>{
    if(cancelled)return;
    try{
     const result=await executeWebsiteEdit(request);
     if(cancelled)return;
     setStatus('التعديل المباشر متاح. ارجع إلى الموقع واترك هذه النافذة مفتوحة أثناء التعديل.');
     send({id:request.id,ok:true,result});
    }catch(error){
     if(!cancelled)send({id:request.id,ok:false,error:error instanceof Error?error.message:'تعذر الحفظ.'});
    }
   });
  };
  window.addEventListener('message',receive);
  send({type:'ready'});
  return()=>{cancelled=true;window.removeEventListener('message',receive);send({type:'disconnected'});};
 },[valid,loading,user,origin,nonce]);
 if(!valid)return <p dir="rtl" role="alert" className="p-8">افتح وضع التعديل من موقع BUNKER نفسه.</p>;
 if(loading)return <p dir="rtl" role="status" className="p-8">جار التحقق من الحساب…</p>;
 if(!user)return <Suspense fallback={<p>جار التحميل…</p>}><LoginPage/></Suspense>;
 return <main dir="rtl" className="mx-auto max-w-lg space-y-5 p-8 text-ui-text">
  <h1 className="text-2xl font-bold">تعديل موقع BUNKER</h1>
  <p role="status">{status}</p>
  <button type="button" onClick={()=>window.opener?.focus()} className="rounded-xl bg-ui-primary px-5 py-3 text-white">العودة للموقع</button>
 </main>;
}
