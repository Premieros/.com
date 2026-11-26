import {readFileSync} from 'node:fs';
import {fireEvent,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';

afterEach(()=>{vi.restoreAllMocks();window.history.replaceState(null,'','/');document.body.innerHTML='';});
it('enables double-click editing and per-image controls only after an authenticated handshake',async()=>{
 document.body.innerHTML='<button id="editToggle"></button><section class="hero"><img id="heroImage" data-editable-image="heroImage" alt="Hero"></section><p data-editable-text="heroCopy">Published text</p>';
 const popup={closed:false,postMessage:vi.fn()} as unknown as Window;
 const nonce='a'.repeat(32);
 Object.defineProperty(window,'opener',{configurable:true,value:popup});
 const script=readFileSync('public/bunker/inline-editor.js','utf8');
 const run=()=>window.eval(`{const content={heroCopy:'Published text'}; const render=()=>{}; ${script}}`);
 const toggle=document.getElementById('editToggle')!;
 run();
 expect(toggle).not.toHaveClass('show');
 expect(popup.postMessage).not.toHaveBeenCalled();
 window.history.replaceState(null,'','/?editor='+nonce);
 run();
 expect(toggle).not.toHaveClass('show');
 const text=document.querySelector<HTMLElement>('[data-editable-text]')!;
 fireEvent.doubleClick(text);
 expect(text.hasAttribute('contenteditable')).toBe(false);
 const send=(payload:object,origin='https://premieros-sage.vercel.app')=>window.dispatchEvent(new MessageEvent('message',{
  origin,source:popup,data:{channel:'bunker-editor-v1',nonce,...payload},
 }));
 const load=(popup.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
 const grant={id:load.id,ok:true,result:{content:{heroCopy:'Published text'},photos:{},revision:3}};
 send(grant,'https://attacker.example');
 expect(toggle).not.toHaveClass('show');
 send(grant);
 await waitFor(()=>expect(document.body.classList.contains('website-editing')).toBe(true));
 expect(toggle).toHaveClass('show');
 expect(document.querySelectorAll('.inline-image-change')).toHaveLength(1);
 fireEvent.doubleClick(text);
 expect(text.getAttribute('contenteditable')).toBe('plaintext-only');
 Object.defineProperty(text,'innerText',{configurable:true,value:'Edited text'});
 fireEvent.click(document.querySelector('.inline-text-actions button')!);
 const save=(popup.postMessage as ReturnType<typeof vi.fn>).mock.calls[1][0];
 expect(save).toMatchObject({op:'text',key:'heroCopy',value:'Edited text',revision:3});
 send({id:save.id,ok:false,error:'Conflict'});
 await waitFor(()=>expect(document.getElementById('inlineEditorStatus')!.textContent).toBe('Conflict'));
 expect(text.hasAttribute('contenteditable')).toBe(true);
 fireEvent.click(document.querySelectorAll('.inline-text-actions button')[1]);
 expect(text.textContent).toBe('Published text');
 fireEvent.click(document.getElementById('editToggle')!);
 expect(document.body.classList.contains('website-editing')).toBe(false);
 expect(toggle).not.toHaveClass('show');
 Reflect.deleteProperty(window,'opener');
});
