import { useEffect, useState } from 'react';
import { Facebook, Instagram, Music2, MessageCircle, Globe } from 'lucide-react';
import { supabase } from '@/api';

type Links={facebook?:string;instagram?:string;tiktok?:string;whatsapp?:string;website?:string};
const providers=[
  { key:'facebook' as const,label:'Facebook',Icon:Facebook },
  { key:'instagram' as const,label:'Instagram',Icon:Instagram },
  { key:'tiktok' as const,label:'TikTok',Icon:Music2 },
  { key:'whatsapp' as const,label:'WhatsApp',Icon:MessageCircle },
  { key:'website' as const,label:'Website',Icon:Globe }
];
const valid=(url?:string)=>!!url && /^https:\/\/[^\s]+$/i.test(url);
export function BranchSocialLinks({slug='bunker'}:{slug?:string}){
 const [links,setLinks]=useState<Links>({});
 useEffect(()=>{let active=true;
   void supabase.rpc('branch_website_links_public',{p_slug:slug}).then(({data,error})=>{
      if(active && !error && data && typeof data==='object')setLinks(data as Links);
   }); return ()=>{active=false;};
 },[slug]);
 const active=providers.filter(p=>valid(links[p.key]));
 if(!active.length)return null;
 return <nav aria-label="Branch social media" className="bunker-social-links">
  {active.map(({key,label,Icon})=><a key={key} aria-label={label} title={label}
   href={links[key]} target="_blank" rel="noopener noreferrer"><Icon size={19}/></a>)}
 </nav>;
}
