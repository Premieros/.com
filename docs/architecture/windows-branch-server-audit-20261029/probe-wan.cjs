const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'premier-com'));
const {createHub}=require(path.join(root,'branch-hub/server.cjs'));
const {chromium}=require(process.env.AUDIT_PLAYWRIGHT_MODULE||path.join(root,'node_modules/playwright'));
const out=path.resolve(process.argv[3]||path.join(__dirname,'audit-evidence'));
fs.mkdirSync(out,{recursive:true});
const token='audit-only-synthetic-local-token-20261029';
(async()=>{
 const hub=createHub({host:'127.0.0.1',port:0,organizationId:'audit_org',branchId:'audit_branch',token,dataDir:fs.mkdtempSync(path.join(out,'hub-probe-'))});
 const {port}=await hub.listen();
 let browser;
 const results={scope:'Synthetic isolated branch; browser blocks all non-loopback network. This is WAN fault injection, not a physical unplug or production acceptance.',checks:[],blockedExternal:[]};
 try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({extraHTTPHeaders:{authorization:'Bearer '+token}});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='127.0.0.1'||u.hostname==='localhost')return route.continue();
   results.blockedExternal.push({host:u.hostname,path:u.pathname});
   return route.abort('internetdisconnected');
  });
  const page=await context.newPage();
  const base='http://127.0.0.1:'+port;
  const home=await page.goto(base+'/#/pos');
  results.checks.push({name:'real Premier UI on branch hub',status:home.status(),body:await page.locator('body').innerText(),outcome:'MISSING: handler returns JSON NOT_FOUND, not Premier UI'});
  assert.equal(home.status(),404);
  const probe=await page.evaluate(async(base)=>{
   const checks=[];
   for(const pathname of ['/health','/api/v1/sync/status','/api/v1/orders','/api/v1/sales','/api/v1/inventory','/api/v1/journals','/printers']){
    const r=await fetch(base+pathname);checks.push({pathname,status:r.status,body:await r.json()});
   }
   let blocked=false;
   try{await fetch('https://hvqlkapynjfjikqithvd.supabase.co/rest/v1/');}catch{blocked=true;}
   return {checks,wanCanaryBlocked:blocked};
  },base);
  assert.equal(probe.wanCanaryBlocked,true);
  results.checks.push(...probe.checks);
  results.wanCanaryBlocked=probe.wanCanaryBlocked;
  await page.screenshot({path:path.join(out,'hub-wan-off.png'),fullPage:true});
  fs.writeFileSync(path.join(out,'wan-probe.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results));
 }finally{if(browser)await browser.close();await hub.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
