'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const {createBrowserAppServer}=require('./browser-app-server.cjs');
(async()=>{
 const assets=createBrowserAppServer({port:0});let browser;
 try{
  const url=await assets.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // No credentials or live-cloud writes: this acceptance opens the real anonymous login UI.
  await page.route('https://**/*',route=>route.abort());
  await page.goto(url);await page.getByRole('status').filter({hasText:'النظام الكامل'}).waitFor();
  await page.locator('input').first().waitFor();assert((await page.locator('input').count())>=2);
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');assert.equal(await page.evaluate(()=>typeof window.branchHub),'undefined');
  assert.equal(await page.evaluate(async()=>('serviceWorker' in navigator?(await navigator.serviceWorker.getRegistrations()).length:0)),0);
  assert.deepEqual(errors,[]);console.log('FULL_BROWSER_REACT_LOGIN_AND_ISOLATION_OK');
 }finally{if(browser)await browser.close();await assets.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
