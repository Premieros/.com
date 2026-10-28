'use strict';
// Installed application diagnostic: only fake data, private temp storage and a loopback printer emulator.
const {app,BrowserWindow,nativeImage}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createElectronReceiptRenderer,receiptHtml}=require('./raster-receipt.cjs');
const {createHub}=require('./server.cjs');
const {createCatalogImporter}=require('./catalog-import.cjs');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
app.on('window-all-closed',()=>{});
for(const key of Object.keys(process.env))if(key.startsWith('BRANCH_HUB_'))delete process.env[key];
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-native-raster-'));
fs.mkdirSync(path.join(root,'profile'));app.setPath('userData',path.join(root,'profile'));
function inspect(bytes,width){
 assert.deepEqual([...bytes.subarray(0,2)],[27,64]);let offset=2,rows=0,black=0;
 while(bytes[offset]===29&&bytes[offset+1]===118){
  assert.equal(bytes[offset+2],48);const stride=bytes.readUInt16LE(offset+4),height=bytes.readUInt16LE(offset+6);assert.equal(stride*8,width);assert(height>0&&height<=256);
  const body=bytes.subarray(offset+8,offset+8+stride*height);assert.equal(body.length,stride*height);
  for(const byte of body){let n=byte;while(n){black+=n&1;n>>=1;}}
  rows+=height;offset+=8+stride*height;
 }
 assert.deepEqual([...bytes.subarray(offset)],[10,10,10,29,86,0]);assert(rows>80&&black>200);return {width,rows,black};
}
app.whenReady().then(async()=>{
 let hub,printer,appAssets,erp;
 try{
  // The installed package must contain the actual built React app, isolated from hub IPC.
  appAssets=require('./browser-app-server.cjs').createBrowserAppServer({port:0});
  const appURL=await appAssets.listen();
  erp=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await erp.loadURL(appURL);
  const ui=await erp.webContents.executeJavaScript(`(async()=>{
   for(let i=0;i<150;i++){if(document.body.textContent.includes('النظام الكامل'))break;await new Promise(r=>setTimeout(r,100));}
   return {text:document.body.textContent,require:typeof window.require,bridge:typeof window.branchHub,root:!!document.querySelector('#root')};
  })()`);
  assert(ui.root);assert.match(ui.text,/النظام الكامل/);assert.match(ui.text,/تسجيل الدخول|دخول|Login|Sign in/);assert.equal(ui.require,'undefined');assert.equal(ui.bridge,'undefined');
  console.log('INSTALLED_FULL_BROWSER_APP_ISOLATED_OK');erp.destroy();erp=null;
  const render=createElectronReceiptRenderer({BrowserWindow,nativeImage});
  const sample={saleId:'77777777-7777-4777-8777-777777777777',createdAt:'2026-10-28 12:00:00',totalMinor:500,lines:[{label:'قهوة عربية — اختبار الإيصال',quantity:2,priceMinor:250}]};
  assert(!receiptHtml({...sample,lines:[{...sample.lines[0],label:'<img src="https://invalid.test" onerror="alert(1)">'}]},384).includes('<img'));
  const sizes=[];for(const dots of [384,512,576])sizes.push(inspect(await render(sample,dots),dots));
  let delivered;const arrival=new Promise(resolve=>{delivered=resolve;});let connections=0,received=Buffer.alloc(0);
  printer=net.createServer(socket=>{connections++;socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);});socket.on('end',delivered);});
  await new Promise(resolve=>printer.listen(0,'127.0.0.1',resolve));
  const organizationId='11111111-1111-4111-8111-111111111111',branchId='22222222-2222-4222-8222-222222222222',warehouseId='55555555-5555-4555-8555-555555555555',productId='66666666-6666-4666-8666-666666666666';
  const token='native-raster-self-test-credential-123456789';
  hub=createHub({host:'127.0.0.1',port:0,dataDir:path.join(root,'data'),organizationId,branchId,token,renderReceipt:render,printers:{cashier:{host:'127.0.0.1',port:printer.address().port,format:'raster',dots:576}}});
  const {port}=await hub.listen(),sku=`p_${productId}_${warehouseId}`;
  createCatalogImporter(hub.db,{organizationId,branchId}).apply({organizationId,branchId,warehouseId,products:[{sku,productId,name:sample.lines[0].label,unitName:'piece',quantity:4,priceCommand:{id:'88888888-8888-4888-8888-888888888888',organization_id:organizationId,branch_id:branchId,sku,revision:1,sale_price_minor:250,unit_cost_minor:100}}]});
  const sale=createOfflineSalesEngine(hub.db,branchId).commitSale({key:'native-raster-sale-001',lines:[{sku,quantity:2,priceMinor:250}]});
  const url=`http://127.0.0.1:${port}/api/v1/offline/sales/${sale.saleId}/print`;
  const submit=async()=>{const result=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({printerId:'cashier'})});assert.equal(result.status,202);return result.json();};
  const jobs=await Promise.all(Array.from({length:4},submit));assert.equal(new Set(jobs.map(j=>j.jobId)).size,1);
  await hub.printWorker.processOnce();
  const delivery=hub.db.prepare('SELECT state,error FROM print_dispatches').get();assert.equal(delivery.state,'submitted',JSON.stringify(delivery));
  let deadline;try{await Promise.race([arrival,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('TCP_RECEIPT_NOT_RECEIVED')),15000);})]);}finally{clearTimeout(deadline);}
  inspect(received,576);assert.equal(connections,1);
  assert.equal(hub.db.prepare('SELECT state FROM print_dispatches').get().state,'submitted');
  assert.equal(JSON.parse(hub.db.prepare('SELECT payload FROM jobs').get().payload).receipt.lines[0].label,sample.lines[0].label);
  hub.db.prepare('UPDATE offline_item_links SET product_name=?').run('اسم جديد');assert.equal((await submit()).jobId,jobs[0].jobId);
  assert.equal(await hub.printWorker.processOnce(),false);assert.equal(connections,1);hub.createLocalBackup();
  console.log('NATIVE_ARABIC_RASTER_TCP_ONCE_OK',JSON.stringify(sizes));
 }catch(error){console.error(error);process.exitCode=1;}
 finally{if(erp)erp.destroy();if(appAssets)await appAssets.close();if(hub)await hub.close();if(printer)await new Promise(resolve=>printer.close(resolve));try{fs.rmSync(root,{recursive:true,force:true});}catch{}app.exit(process.exitCode||0);}
});
