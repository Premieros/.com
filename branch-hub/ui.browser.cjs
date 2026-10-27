'use strict';
// Browser acceptance test: local hub only; intentionally denies all external requests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {createHub}=require('./server.cjs');
const {createDeviceRegistry}=require('./devices.cjs');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-browser-'));
 const token='browser-admin-test-token-32-characters';
 const hub=createHub({port:0,dataDir:dir,organizationId:'org_001',branchId:'branch_001',token});
 let browser;
 try {
  const {port}=await hub.listen();browser=await chromium.launch({headless:true,channel:process.env.BRANCH_HUB_BROWSER_CHANNEL||undefined});
  const page=await browser.newPage({viewport:{width:1366,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const login=async credential=>{await page.locator('#credential').fill(credential);await page.locator('#login-form button').click();await page.locator('#workspace').waitFor({state:'visible'});};
  await page.goto(`http://127.0.0.1:${port}`);await login(token);
  await page.locator('#opening-sku').fill('coffee');await page.locator('#opening-qty').fill('10');await page.locator('#opening-cost').fill('1.20');
  await page.locator('#opening-form button').click();await page.waitForFunction(()=>document.getElementById('stock').textContent.includes('coffee'));
  const registry=createDeviceRegistry(hub.db,'branch_001');const device=registry.issue({name:'Tablet',role:'cashier'});
  await page.locator('#logout').click();await login(device.token);
  await page.locator('#sku').selectOption('coffee');await page.locator('#quantity').fill('2');await page.locator('#price').fill('3.00');await page.locator('#line-form button').click();
  // Server commits but the browser loses the ACK. Reload must reuse the durable checkout key.
  let dropped=false;
  await page.route('**/api/v1/offline/sales',async route=>{
   if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort();}else await route.continue();
  });
  await page.locator('#checkout').click();await page.locator('#pending').waitFor({state:'visible'});
  await page.reload();await login(device.token);await page.locator('#pending').waitFor({state:'visible'});
  await page.locator('#checkout').click();await page.locator('#pending').waitFor({state:'hidden'});
  assert.equal(hub.db.prepare('SELECT count(*) n FROM offline_sales').get().n,1);
  assert.equal(hub.db.prepare('SELECT quantity FROM offline_stock').get().quantity,8);
  assert.equal(hub.db.prepare('SELECT count(*) n FROM offline_outbox').get().n,1);
  await page.locator('#refresh').click();await page.waitForFunction(()=>document.getElementById('sales').textContent.includes('6.00'));
  fs.mkdirSync(path.join(__dirname,'test-output'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,'test-output/desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(__dirname,'test-output/mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('BROWSER_OFFLINE_SALE_RETRY_OK');
 }finally{if(browser)await browser.close();await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
