import {lazy,Suspense,useEffect,useRef,useState} from 'react';
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
 const actor=useRef<string|undefined>(user?.id);
 const userId=user?.id;
 useEffect(()=>{
  actor.current=userId;
  if(!valid||loading)return;
  window.opener?.postMessage({channel:EDITOR_CHANNEL,nonce,type:userId?'ready':'disconnected'},origin);
 },[userId,loading,valid,origin,nonce]);
 useEffect(()=>{
  if(!valid)return;
  const opener=window.opener;
  let cancelled=false;
  let queue=Promise.resolve();
  const send=(payload:object)=>opener?.postMessage({channel:EDITOR_CHANNEL,nonce,...payload},origin);
  const receive=(event:MessageEvent)=>{
   if(!isWebsiteEditorMessage(event,opener,origin,nonce))return;
   const request=event.data;
   if(!actor.current)return;
   if(request.op==='hello'){send({type:'ready'});return;}
   const requestedActor=actor.current;
   queue=queue.then(async()=>{
    if(cancelled||actor.current!==requestedActor)return;
    try{
     const result=await executeWebsiteEdit(request);
     if(cancelled||actor.current!==requestedActor)return;
     setStatus('التعديل المباشر متاح. ارجع إلى الموقع واترك هذه النافذة مفتوحة أثناء التعديل.');
     send({id:request.id,ok:true,result});
    }catch(error){
     if(!cancelled)send({id:request.id,ok:false,error:error instanceof Error?error.message:'تعذر الحفظ.'});
    }
   });
  };
  window.addEventListener('message',receive);
  const disconnect=()=>send({type:'disconnected'});
  window.addEventListener('pagehide',disconnect);
  // React StrictMode and cached-to-fresh profile hydration may replay effects.
  // Only real navigation/sign-out closes the channel, never an effect cleanup.
  return()=>{cancelled=true;window.removeEventListener('message',receive);window.removeEventListener('pagehide',disconnect);};
 },[valid,origin,nonce]);
 if(!valid)return <p dir="rtl" role="alert" className="p-8">افتح وضع التعديل من موقع BUNKER نفسه.</p>;
 if(loading)return <p dir="rtl" role="status" className="p-8">جار التحقق من الحساب…</p>;
 if(!user)return <Suspense fallback={<p>جار التحميل…</p>}><LoginPage/></Suspense>;
 return <main dir="rtl" className="mx-auto max-w-lg space-y-5 p-8 text-ui-text">
  <h1 className="text-2xl font-bold">تعديل موقع BUNKER</h1>
  <p role="status">{status}</p>
  <button type="button" onClick={()=>window.opener?.focus()} className="rounded-xl bg-ui-primary px-5 py-3 text-white">العودة للموقع</button>
 </main>;
}
