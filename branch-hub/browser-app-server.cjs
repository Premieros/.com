'use strict';
// Separate asset origin. No hub APIs, IPC, credentials or user files are exposed here.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
function createBrowserAppServer({directory=path.join(__dirname,'browser-app'),port=3848}={}){
 const root=fs.realpathSync(directory);if(!fs.statSync(path.join(root,'index.html')).isFile())throw Error('BROWSER_APP_MISSING');
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
 const server=http.createServer((req,res)=>{
  const deny=code=>{res.writeHead(code,{'cache-control':'no-store'});res.end();};
  if(req.headers.host!==`127.0.0.1:${server.address().port}`)return deny(403);
  if(!['GET','HEAD'].includes(req.method))return deny(405);
  let relative;try{relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '');}catch{return deny(400);}
  if(relative.includes('\\')||relative.includes('\0')||relative.split('/').some(s=>s==='..'||s.startsWith('.')))return deny(404);
  const target=path.resolve(root,relative||'index.html');
  if(!target.startsWith(root+path.sep))return deny(404);
  try{
   const real=fs.realpathSync(target);if(!real.startsWith(root+path.sep)||!fs.statSync(real).isFile())return deny(404);
   const bytes=fs.readFileSync(real);res.writeHead(200,{'content-type':mime[path.extname(real)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://hvqlkapynjfjikqithvd.supabase.co; font-src 'self' data:; connect-src 'self' https://hvqlkapynjfjikqithvd.supabase.co wss://hvqlkapynjfjikqithvd.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{return deny(404);}
 });
 return {async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return `http://127.0.0.1:${server.address().port}/`;},close(){return new Promise(resolve=>server.close(resolve));}};
}
module.exports={createBrowserAppServer};
