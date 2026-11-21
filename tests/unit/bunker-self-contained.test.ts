// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {inlineBunkerAssets} from '../../scripts/build/bunkerInlineEditor';

it('ships editing tools inside the website document despite host-wide HTML rewrites',()=>{
 const html=readFileSync('public/bunker/index.html','utf8');
 const js=readFileSync('public/bunker/inline-editor.js','utf8');
 const css=readFileSync('public/bunker/inline-editor.css','utf8');
 const output=inlineBunkerAssets(html,css,js);
 expect(output).toContain(js);
 expect(output).toContain(css);
 expect(output).not.toContain('src="/bunker/inline-editor.js"');
 expect(output).not.toContain('href="/bunker/inline-editor.css"');
 expect(output).toContain('window.open(');
 expect(()=>inlineBunkerAssets('<html></html>',css,js)).toThrow('markers');
});
