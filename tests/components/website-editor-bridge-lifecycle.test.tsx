import {StrictMode} from 'react';
import {act,cleanup,render,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {WebsiteEditorBridgePage} from '@/features/qr/WebsiteEditorBridgePage';

const mocks=vi.hoisted(()=>({auth:{user:{id:'manager',name:'cached'} as {id:string;name:string}|null,loading:false},execute:vi.fn()}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>mocks.auth}));
vi.mock('@/features/qr/websiteInlineEditor',async importOriginal=>({
 ...await importOriginal<typeof import('@/features/qr/websiteInlineEditor')>(),executeWebsiteEdit:mocks.execute,
}));
vi.mock('@/api',()=>({supabase:{}}));
afterEach(()=>{cleanup();mocks.execute.mockReset();mocks.auth.user={id:'manager',name:'cached'};mocks.auth.loading=false;Object.defineProperty(window,'opener',{configurable:true,value:null});});

it('keeps in-flight editor reads alive through StrictMode and cached-to-fresh profile updates',async()=>{
 const opener={postMessage:vi.fn()} as unknown as Window;
 Object.defineProperty(window,'opener',{configurable:true,value:opener});
 const origin='https://www.bunker-egy.app',nonce='a'.repeat(32);
 let finish!:(value:object)=>void;
 mocks.execute.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const app=()=> <StrictMode><MemoryRouter initialEntries={[`/website-editor?origin=${encodeURIComponent(origin)}&nonce=${nonce}`]}><WebsiteEditorBridgePage/></MemoryRouter></StrictMode>;
 const view=render(app());
 const send=(id:string,op='load')=>window.dispatchEvent(new MessageEvent('message',{origin,source:opener,data:{channel:'bunker-editor-v1',nonce,id,op}}));
 await act(async()=>{send('load-1');});
 mocks.auth.user={id:'manager',name:'verified'};
 view.rerender(app());
 await act(async()=>{finish({revision:1,content:{},photos:{}});});
 await waitFor(()=>expect(opener.postMessage).toHaveBeenCalledWith(expect.objectContaining({id:'load-1',ok:true}),origin));
 expect((opener.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(([data])=>data.type==='disconnected')).toBe(false);
 mocks.auth.user=null;
 view.rerender(app());
 await waitFor(()=>expect(opener.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'disconnected'}),origin));
 const count=mocks.execute.mock.calls.length;
 await act(async()=>{send('after-signout');});
 expect(mocks.execute).toHaveBeenCalledTimes(count);
});
