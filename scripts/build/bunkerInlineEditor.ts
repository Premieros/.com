import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';

export function inlineBunkerAssets(html:string,css:string,js:string) {
 const style='<link rel="stylesheet" href="/bunker/inline-editor.css" />';
 const script='<script src="/bunker/inline-editor.js"></script>';
 if(!html.includes(style)||!html.includes(script))throw new Error('BUNKER editing asset markers are missing');
 return html.replace(style,()=>`<style>${css}</style>`).replace(script,()=>`<script>${js}</script>`);
}

// The BUNKER domain rewrites every path to its standalone HTML page.
// Keep editing assets inside that document so host routing cannot turn JS/CSS into HTML.
export function bunkerInlineEditor():Plugin {
 let outputDirectory='';
 let projectRoot='';
 return {
  name:'bunker-inline-editor',
  apply:'build',
  configResolved(config){projectRoot=config.root;outputDirectory=path.resolve(config.root,config.build.outDir);},
  writeBundle(){
   const htmlPath=path.join(outputDirectory,'bunker/index.html');
   const html=readFileSync(htmlPath,'utf8');
   const css=readFileSync(path.join(projectRoot,'public/bunker/inline-editor.css'),'utf8');
   const js=readFileSync(path.join(projectRoot,'public/bunker/inline-editor.js'),'utf8');
   writeFileSync(htmlPath,inlineBunkerAssets(html,css,js));
  },
 };
}
