import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { ImagePlus, Save, Loader2 } from 'lucide-react';

const FIELDS = [
 ['heroImage','Website hero'],['featureImage','Website featured image'],
 ['burgerImage','Burger / ordering banner'],['coffeeImage','Coffee / ordering banner'],
 ['interiorImage','Interior'],['dessertImage','Extra product image'],
 ['gallery1','Gallery photo 1'],['gallery2','Gallery photo 2'],['gallery3','Gallery photo 3'],
 ['gallery4','Gallery photo 4'],['gallery5','Gallery photo 5'],
] as const;
type PhotoKey = (typeof FIELDS)[number][0];
type Photos = Partial<Record<PhotoKey,string>>;
const BUCKET='branch-website-photos';
const allowed=['image/jpeg','image/png','image/webp'];
export function WebsitePhotosSettings({branchId}:{branchId:string}) {
 const [photos,setPhotos]=useState<Photos>({});
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [uploading,setUploading]=useState<PhotoKey|null>(null);
 const [error,setError]=useState('');
 const [success,setSuccess]=useState('');
 const load=useCallback(async()=>{
  if(!branchId)return;
  setLoading(true);setError('');setSuccess('');
  const {data,error:e}=await supabase.rpc('branch_website_photos_settings',{p_branch:branchId});
  if(e)setError(e.message);else setPhotos((data||{}) as Photos);
  setLoading(false);
 },[branchId]);
 useEffect(()=>{void load();},[load]);
 async function save(next:Photos=photos){
  setError('');setSuccess('');setSaving(true);
  const {error:e}=await supabase.rpc('branch_website_photos_save',{p_branch:branchId,p_images:next});
  setSaving(false);
  if(e){setError(e.message);return false;}
  setSuccess('Photos published. Customers will see the updated images after refresh.');
  return true;
 }
 async function upload(key:PhotoKey,file?:File){
  if(!file)return;
  setError('');setSuccess('');
  if(!allowed.includes(file.type)){setError('Choose a JPG, PNG or WebP image.');return;}
  if(file.size>5*1024*1024){setError('Maximum photo size is 5 MB.');return;}
  setUploading(key);
  try{
   const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
   const id=crypto.randomUUID();
   const path=`${branchId}/${key}/${id}.${ext}`;
   const {error:e}=await supabase.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
   if(e)throw e;
   const {data}=supabase.storage.from(BUCKET).getPublicUrl(path);
   const updated={...photos,[key]:data.publicUrl};
   setPhotos(updated);
   await save(updated);
  }catch(e){setError(e instanceof Error?e.message:'Could not upload image.');}
  finally{setUploading(null);}
 }
 return <section className="space-y-5 rounded-2xl border border-ui-border bg-ui-surface p-5">
  <div>
   <h2 className="text-xl font-bold text-ui-text">Website & Ordering Photos</h2>
   <p className="mt-1 text-sm text-ui-muted">Upload photos from your phone or computer, or paste an HTTPS image URL. Burger and coffee images also update the BUNKER customer ordering page. Changes are saved for the selected branch and visible to all visitors.</p>
  </div>
  {loading?<p role="status">Loading photos…</p>:<>
   <div className="grid gap-5 sm:grid-cols-2">
    {FIELDS.map(([key,label])=><div key={key} className="space-y-2 rounded-xl border border-ui-border p-3">
      <label className="block text-sm font-bold text-ui-text">{label}</label>
      {photos[key]&&<img src={photos[key]} alt={label} className="h-36 w-full rounded-lg object-cover" loading="lazy" />}
      <input type="url" value={photos[key]||''} placeholder="https://..." maxLength={1500}
       onChange={e=>setPhotos(p=>({...p,[key]:e.target.value.trim()}))}
       className="w-full rounded-xl border border-ui-border bg-ui-page px-3 py-2 text-sm text-ui-text"/>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-ui-border px-3 py-3 text-sm font-bold text-ui-text">
       {uploading===key?<Loader2 size={17} className="animate-spin"/>:<ImagePlus size={17}/>}
       {uploading===key?'Uploading…':'Upload photo'}
       <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!uploading||saving}
        onChange={e=>{void upload(key,e.target.files?.[0]);e.target.value='';}}/>
      </label>
    </div>)}
   </div>
   {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
   {success&&<p role="status" className="text-sm text-green-600">{success}</p>}
   <button type="button" className="flex items-center gap-2 rounded-xl bg-ui-primary px-5 py-3 text-white disabled:opacity-60"
    onClick={()=>void save()} disabled={saving||!!uploading}>{saving?<Loader2 size={17} className="animate-spin"/>:<Save size={17}/>}
    {saving?'Saving…':'Save / Publish Photo Links'}
   </button>
  </>}
 </section>;
}
