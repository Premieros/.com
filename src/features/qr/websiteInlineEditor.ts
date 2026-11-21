import {supabase} from '@/api';

export const BUNKER_BRANCH = 'd56aae83-f1b3-4153-9224-87594500368d';
export const EDITOR_CHANNEL = 'bunker-editor-v1';
export const WEBSITE_ORIGINS = ['https://www.bunker-egy.app','https://bunker-egy.app','https://premieros-sage.vercel.app'];
export const TEXT_KEYS = ['eyebrow','heroSub','heroCopy','heroPanel','experienceEyebrow','experienceTitle','experienceCopy',
 'featureBadge','featureTitle','featureCopy','burgerTitle','burgerCopy','coffeeTitle','coffeeCopy','interiorTitle','interiorCopy',
 'dessertTitle','dessertCopy','galleryTitle','ctaTitle','ctaCopy','brand','navExperience','navGallery','navOrder','orderButton',
 'exploreButton','spotlightTitle','burgerEyebrow','coffeeEyebrow','interiorEyebrow','dessertEyebrow','galleryEyebrow',
 'galleryLabel1','galleryLabel2','galleryLabel3','galleryLabel4','galleryLabel5','orderEyebrow','openOrdering','backTop','footerSub','footerCopy'] as const;
export const IMAGE_KEYS = ['heroImage','featureImage','burgerImage','coffeeImage','interiorImage','dessertImage',
 'gallery1','gallery2','gallery3','gallery4','gallery5'] as const;

export function isWebsiteEditorMessage(event: Pick<MessageEvent,'origin'|'source'|'data'>, opener: Window|null, origin: string, nonce: string) {
 return !!opener && WEBSITE_ORIGINS.includes(origin) && event.origin===origin && event.source===opener &&
  /^[a-f0-9]{32}$/.test(nonce) && event.data?.channel===EDITOR_CHANNEL && event.data?.nonce===nonce &&
  typeof event.data?.id==='string' && event.data.id.length<100;
}

type EditorRequest = {op:string;key?:string;value?:unknown;revision?:number;file?:File;previous?:string};
function checked<T>({data,error}:{data:T;error:{message:string}|null}):T {
 if(error)throw new Error(error.message);
 return data;
}
async function loadText() {
 return checked(await supabase.rpc('branch_website_content_settings',{p_branch:BUNKER_BRANCH})) as {content:Record<string,string>;revision:number};
}
async function loadPhotos() {
 return (checked(await supabase.rpc('branch_website_photos_settings',{p_branch:BUNKER_BRANCH}))||{}) as Record<string,string>;
}

// Only these branch-scoped operations are available. Credentials stay on Premier's origin.
export async function executeWebsiteEdit(request:EditorRequest) {
 if(request.op==='load') {
  const [text,photos]=await Promise.all([loadText(),loadPhotos()]);
  return {...text,photos};
 }
 if(request.op==='text') {
  if(!TEXT_KEYS.includes(request.key as typeof TEXT_KEYS[number]) || typeof request.value!=='string' || request.value.length>3000) throw new Error('نص غير صالح.');
  const current=await loadText();
  if(current.revision!==request.revision)throw new Error('نُشرت تعديلات أحدث. أوقف وضع التعديل وافتحه مجددًا قبل الحفظ.');
  const revision=checked(await supabase.rpc('branch_website_content_save',{
   p_branch:BUNKER_BRANCH,p_content:{...current.content,[request.key!]:request.value},p_revision:current.revision,
  }));
  return {revision,key:request.key,value:request.value};
 }
 if(request.op==='image') {
  if(!IMAGE_KEYS.includes(request.key as typeof IMAGE_KEYS[number]))throw new Error('صورة غير صالحة.');
  const photos=await loadPhotos(); // Revalidates branch/settings authorization before uploading.
  if((photos[request.key!]||'')!==(request.previous||''))throw new Error('تغيرت هذه الصورة. أوقف وضع التعديل وافتحه مجددًا.');
  let url:string;
  if(request.file) {
   const file=request.file;
   if(!(file instanceof File) || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024 || !file.size) throw new Error('اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 5 ميجابايت.');
   const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
   const path=`${BUNKER_BRANCH}/${request.key}/${crypto.randomUUID()}.${ext}`;
   const bucket=supabase.storage.from('branch-website-photos');
   checked(await bucket.upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'}));
   url=bucket.getPublicUrl(path).data.publicUrl;
  } else {
   if(typeof request.value!=='string' || request.value.length>1500)throw new Error('رابط الصورة غير صالح.');
   const parsed=new URL(request.value);
   if(parsed.protocol!=='https:' || parsed.username || parsed.password)throw new Error('استخدم رابط صورة HTTPS.');
   url=parsed.href;
  }
  checked(await supabase.rpc('branch_website_photos_save',{p_branch:BUNKER_BRANCH,p_images:{...photos,[request.key!]:url}}));
  return {key:request.key,value:url};
 }
 throw new Error('عملية غير مسموحة.');
}
