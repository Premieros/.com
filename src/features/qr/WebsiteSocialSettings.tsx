import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { Facebook, Instagram, Globe, MessageCircle, Music2, Save, Loader2 } from 'lucide-react';

type Links = { facebook:string; instagram:string; tiktok:string; whatsapp:string; website:string };
const EMPTY: Links = { facebook:'', instagram:'', tiktok:'', whatsapp:'', website:'' };
const FIELDS = [
  {key:'facebook',name:'Facebook',Icon:Facebook},
  {key:'instagram',name:'Instagram',Icon:Instagram},
  {key:'tiktok',name:'TikTok',Icon:Music2},
  {key:'whatsapp',name:'WhatsApp',Icon:MessageCircle},
  {key:'website',name:'Other website',Icon:Globe},
] as const;

export function WebsiteSocialSettings({branchId}: {branchId:string}) {
  const [links,setLinks]=useState<Links>(EMPTY);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [status,setStatus]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);setError('');setStatus('');
    if (!branchId){setLoading(false);return;}
    const {data,error:failure}=await supabase.rpc('branch_website_links_settings',{p_branch:branchId});
    if(failure)setError(failure.message);
    else setLinks({...EMPTY,...(data as Partial<Links>)});
    setLoading(false);
  },[branchId]);
  useEffect(()=>{void load();},[load]);
  async function save(){
    setError('');setStatus('');
    for (const [key,url] of Object.entries(links)){
      if(url && (!/^https:\/\//i.test(url) || url.length>500)){
        setError('Use an HTTPS URL (up to 500 characters) for '+key);return;
      }
    }
    setSaving(true);
    const {error:failure}=await supabase.rpc('branch_website_links_save',
       {p_branch:branchId,p_links:links});
    setSaving(false);
    if(failure)setError(failure.message);
    else setStatus('Website social links saved for this branch.');
  }
  return <section className="space-y-5 rounded-2xl border border-ui-border bg-ui-surface p-5">
    <div><h2 className="text-xl font-bold text-ui-text">Website & Social Links</h2>
      <p className="mt-1 text-sm text-ui-muted">Manage branch-specific social icons shown on the customer website and QR ordering page. Blank links are hidden.</p>
    </div>
    {loading?<p role="status">Loading website settings…</p>:<>
      <div className="grid gap-4 md:grid-cols-2">
        {FIELDS.map(({key,name,Icon})=><label className="block space-y-2" key={key}>
          <span className="flex items-center gap-2 text-sm font-semibold text-ui-text"><Icon size={17}/>{name}</span>
          <input type="url" autoComplete="off" placeholder="https://..." value={links[key]}
            onChange={e=>setLinks(v=>({...v,[key]:e.target.value.trim()}))}
            className="w-full rounded-xl border border-ui-border bg-ui-page px-3 py-3 text-ui-text" />
        </label>)}
      </div>
      {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
      {status&&<p role="status" className="text-sm text-green-600">{status}</p>}
      <button type="button" onClick={()=>void save()} disabled={saving}
        className="flex items-center gap-2 rounded-xl bg-ui-primary px-5 py-3 text-white disabled:opacity-60">
        {saving?<Loader2 size={17} className="animate-spin"/>:<Save size={17}/>}
        {saving?'Saving…':'Save Website Links'}
      </button>
    </>}
  </section>;
}
