import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/context/AuthContext';
import {EDITOR_CHANNEL,executeWebsiteEdit,isWebsiteEditorMessage} from './websiteInlineEditor';

const siteOrigin='https://www.bunker-egy.app';

export function WebsiteEditorLaunch() {
 const {user}=useAuth();
 const session=useRef<{popup:Window;nonce:string}|null>(null);
 const [error,setError]=useState('');
 const userId=user?.id;
 useEffect(()=>{
  if(!userId)return;
  let active=true;
  async function receive(event:MessageEvent) {
   const current=session.current;
   if(!current||!isWebsiteEditorMessage(event,current.popup,siteOrigin,current.nonce))return;
   const {id}=event.data;
   const respond=(payload:object)=>{
    if(active&&session.current===current)current.popup.postMessage({channel:EDITOR_CHANNEL,nonce:current.nonce,id,...payload},siteOrigin);
   };
   try {
    respond({ok:true,result:await executeWebsiteEdit(event.data)});
   } catch (failure) {
    respond({ok:false,error:failure instanceof Error?failure.message:'تعذر التعديل.'});
   }
  }
  window.addEventListener('message',receive);
  return ()=>{
   active=false;
   const current=session.current;
   session.current=null;
   current?.popup.postMessage({channel:EDITOR_CHANNEL,nonce:current.nonce,type:'disconnected'},siteOrigin);
   window.removeEventListener('message',receive);
  };
 },[userId]);
 return <><button type="button" className="rounded-xl bg-ui-primary px-4 py-2 text-white" onClick={()=>{
  const nonce=crypto.randomUUID().replace(/-/g,'');
  const popup=window.open(`${siteOrigin}/?editor=${nonce}`,'_blank');
  if(popup){session.current={popup,nonce};setError('');}
  else setError('اسمح بفتح نافذة الموقع ثم أعد المحاولة.');
 }}>فتح الموقع للتعديل المباشر</button>{error&&<p role="alert">{error}</p>}</>;
}
