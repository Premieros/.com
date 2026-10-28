'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createBrowserAppServer}=require('./browser-app-server.cjs');
test('browser UI asset origin exposes no hub API, user files, traversal, foreign host or symlink escape',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-browser-assets-'));const dir=path.join(root,'assets');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'index.html'),'<main>ERP</main>');fs.writeFileSync(path.join(root,'secret.txt'),'secret');
 let linked=false;try{fs.symlinkSync(path.join(root,'secret.txt'),path.join(dir,'escape.txt'));linked=true;}catch{}
 const server=createBrowserAppServer({directory:dir,port:0});
 try{
  const url=await server.listen();const page=await fetch(url);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(await page.text(),'<main>ERP</main>');
  for(const suffix of ['api/v1/health','.env','%2e%2e%2fsecret.txt','a%5c..%5csecret.txt',...(linked?['escape.txt']:[])])assert.equal((await fetch(url+suffix)).status,404,suffix);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  const code=await new Promise((resolve,reject)=>{http.get(url,{headers:{host:'foreign.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(code,403);
 }finally{await server.close();fs.rmSync(root,{recursive:true,force:true});}
});
