import {afterEach,expect,it,vi} from 'vitest';
import {EDITOR_CHANNEL,executeWebsiteEdit,isWebsiteEditorMessage,TEXT_KEYS} from '@/features/qr/websiteInlineEditor';
import {ALL_PERMISSIONS,PERMISSION_GROUPS,PERMISSION_LABELS} from '@/lib/permissionDefs';

const mock=vi.hoisted(()=>({rpc:vi.fn(),storage:vi.fn()}));
vi.mock('@/api',()=>({supabase:{rpc:mock.rpc,storage:{from:mock.storage}}}));
afterEach(()=>{mock.rpc.mockReset();mock.storage.mockReset();});

it('requires exact source, website origin and per-session nonce for editor messages',()=>{
 const opener={} as Window,nonce='a'.repeat(32),origin='https://www.bunker-egy.app';
 const event={origin,source:opener,data:{channel:EDITOR_CHANNEL,nonce,id:'request'}};
 expect(isWebsiteEditorMessage(event,opener,origin,nonce)).toBe(true);
 expect(isWebsiteEditorMessage({...event,origin:'https://attacker.example'},opener,origin,nonce)).toBe(false);
 expect(isWebsiteEditorMessage({...event,source:{} as Window},opener,origin,nonce)).toBe(false);
 expect(isWebsiteEditorMessage({...event,data:{...event.data,nonce:'b'.repeat(32)}},opener,origin,nonce)).toBe(false);
 expect(isWebsiteEditorMessage(event,null,origin,nonce)).toBe(false);
});

it('registers an independently assignable website permission in the permissions screen',()=>{
 expect(ALL_PERMISSIONS).toContain('website.edit');
 expect(PERMISSION_LABELS['website.edit'].ar).toBe('تعديل الموقع');
 expect(PERMISSION_GROUPS.some(group=>group.permissions.includes('website.edit'))).toBe(true);
});

it('preserves other text and rejects stale writes or unknown keys',async()=>{
 mock.rpc.mockResolvedValueOnce({data:{content:{heroCopy:'Existing'},revision:4},error:null})
  .mockResolvedValueOnce({data:5,error:null});
 await expect(executeWebsiteEdit({op:'text',key:'navOrder',value:'اطلب الآن',revision:4})).resolves.toEqual({revision:5,key:'navOrder',value:'اطلب الآن'});
 expect(mock.rpc).toHaveBeenLastCalledWith('branch_website_content_save',expect.objectContaining({p_content:{heroCopy:'Existing',navOrder:'اطلب الآن'},p_revision:4}));
 mock.rpc.mockResolvedValueOnce({data:{content:{},revision:6},error:null});
 await expect(executeWebsiteEdit({op:'text',key:'navOrder',value:'Stale',revision:5})).rejects.toThrow('أحدث');
 const calls=mock.rpc.mock.calls.length;
 await expect(executeWebsiteEdit({op:'text',key:'__proto__',value:'x',revision:6})).rejects.toThrow('غير صالح');
 expect(mock.rpc).toHaveBeenCalledTimes(calls);
 expect(TEXT_KEYS).toContain('galleryLabel5');
});

it('checks image authorization before upload and preserves unrelated photos',async()=>{
 mock.rpc.mockResolvedValueOnce({data:null,error:{message:'QR_PERMISSION_DENIED'}});
 await expect(executeWebsiteEdit({op:'image',key:'heroImage',file:new File(['x'],'a.jpg',{type:'image/jpeg'})})).rejects.toThrow('QR_PERMISSION_DENIED');
 expect(mock.storage).not.toHaveBeenCalled();
 mock.rpc.mockResolvedValueOnce({data:{coffeeImage:'https://example.com/coffee.jpg'},error:null})
  .mockResolvedValueOnce({data:null,error:null});
 await executeWebsiteEdit({op:'image',key:'heroImage',value:'https://example.com/hero.jpg'});
 expect(mock.rpc).toHaveBeenLastCalledWith('branch_website_photo_save_one',expect.objectContaining({p_key:'heroImage',p_url:'https://example.com/hero.jpg',p_previous:''}));
 await expect(executeWebsiteEdit({op:'delete',key:'heroImage'})).rejects.toThrow('غير مسموحة');
});

it('uploads the image bytes before publishing the photo URL',async()=>{
 const bytes=Uint8Array.of(137,80,78,71).buffer;
 const file=new File([bytes],'photo.png',{type:'image/png'});
 const read=vi.fn().mockResolvedValue(bytes);
 Object.defineProperty(file,'arrayBuffer',{value:read});
 const url='https://example.com/gallery.png';
 const upload=vi.fn().mockResolvedValue({error:null});
 const getPublicUrl=vi.fn().mockReturnValue({data:{publicUrl:url}});
 mock.storage.mockReturnValue({upload,getPublicUrl});
 mock.rpc.mockResolvedValueOnce({data:{},error:null}).mockResolvedValueOnce({error:null});

 await expect(executeWebsiteEdit({op:'image',key:'gallery1',file})).resolves.toEqual({key:'gallery1',value:url});
 expect(read).toHaveBeenCalledOnce();
 expect(mock.storage).toHaveBeenCalledWith('branch-website-photos');
 expect(upload).toHaveBeenCalledWith(expect.stringMatching(/\/gallery1\/[^/]+\.png$/),bytes,{
  contentType:'image/png',upsert:false,cacheControl:'3600',
 });
 expect(mock.rpc).toHaveBeenLastCalledWith('branch_website_photo_save_one',expect.objectContaining({p_key:'gallery1',p_url:url}));
 expect(upload.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[1]);
});
