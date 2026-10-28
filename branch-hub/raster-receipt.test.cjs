'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {receiptHtml,bitmapToEscPos}=require('./raster-receipt.cjs');
const {createParentRasterRenderer}=require('./raster-ipc.cjs');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
const {DatabaseSync}=require('node:sqlite');
const sample={saleId:'77777777-7777-4777-8777-777777777777',createdAt:'2026-10-28 12:00:00',totalMinor:500,lines:[{label:'قهوة عربية',quantity:2,priceMinor:250}]};
function bitmap(width=8,height=1){const b=Buffer.alloc(width*height*4,255);b[0]=b[1]=b[2]=0;return {width,height,bitmap:b};}
test('Arabic receipt markup escapes content and rejects inconsistent money or dimensions',()=>{
 const html=receiptHtml({...sample,lines:[{...sample.lines[0],label:'<img src=x onerror="alert(1)"> قهوة'}]},384);
 assert(html.includes('dir="rtl"'));assert(html.includes('قهوة'));assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes("default-src 'none'"));
 assert(receiptHtml({...sample,totalMinor:9007199254740990,lines:[{label:'قيمة دقيقة',quantity:1,priceMinor:9007199254740990}]},384).includes('90071992547409.90'));
 assert.throws(()=>receiptHtml({...sample,totalMinor:501},384),/INVALID_RASTER_RECEIPT/);
 assert.throws(()=>receiptHtml(sample,1000),/INVALID_PRINTER_DOTS/);
});
test('raster encoding preserves MSB-first pixels, splits bounded rows, flattens alpha and refuses blank output',()=>{
 const image=bitmap(8,257);image.bitmap[(256*8+7)*4]=image.bitmap[(256*8+7)*4+1]=image.bitmap[(256*8+7)*4+2]=0;
 const bytes=bitmapToEscPos(image);assert.deepEqual([...bytes.subarray(0,10)],[27,64,29,118,48,0,1,0,0,1]);assert.equal(bytes[10],128);
 const next=2+8+256;assert.deepEqual([...bytes.subarray(next,next+9)],[29,118,48,0,1,0,1,0,1]);
 assert.deepEqual([...bytes.subarray(-6)],[10,10,10,29,86,0]);
 assert.throws(()=>bitmapToEscPos({width:8,height:1,bitmap:Buffer.alloc(32,255)}),/EMPTY_RECEIPT_BITMAP/);
 const transparent=bitmap();transparent.bitmap[3]=0;assert.throws(()=>bitmapToEscPos(transparent),/EMPTY_RECEIPT_BITMAP/);
 assert.throws(()=>bitmapToEscPos({...bitmap(),width:9}),/INVALID_RECEIPT_BITMAP/);
});
test('native renderer IPC requires a matching response and removes listeners on failure or timeout',async()=>{
 const channel=new EventEmitter();channel.connected=true;let sent;
 channel.send=(message,cb)=>{sent=message;cb(null);};const render=createParentRasterRenderer(channel,{timeoutMs:30});
 const pending=render(sample,384);
 channel.emit('message',{type:'receipt-rendered',requestId:'wrong',ok:true,bytes:'garbage'});
 const bytes=bitmapToEscPos(bitmap());channel.emit('message',{type:'receipt-rendered',requestId:sent.requestId,ok:true,bytes:bytes.toString('base64')});
 assert.deepEqual(await pending,bytes);assert.equal(channel.listenerCount('message'),0);
 const timeout=render(sample,384);await assert.rejects(timeout,/RASTER_RENDER_TIMEOUT/);assert.equal(channel.listenerCount('message'),0);
 const disconnected=render(sample,384);channel.emit('disconnect');await assert.rejects(disconnected,/DISCONNECTED/);assert.equal(channel.listenerCount('disconnect'),0);
 const bad=render(sample,384);channel.emit('message',{type:'receipt-rendered',requestId:sent.requestId,ok:true,bytes:'not-base64'});await assert.rejects(bad,/RASTER_RENDER_FAILED/);
});
test('receipt names are immutable checkout snapshots and oversized cloud events roll back all financial writes',()=>{
 const db=new DatabaseSync(':memory:');try{
  const branch='branch_001',warehouse='55555555-5555-4555-8555-555555555555',engine=createOfflineSalesEngine(db,branch);
  for(let n=0;n<100;n++){
   const product=crypto.randomUUID(),sku=`p_${product}_${warehouse}`;engine.setOpeningStock(sku,1,1);
   db.prepare('INSERT INTO offline_item_links VALUES(?,?,?,?,?,?)').run(branch,sku,product,warehouse,'単'.repeat(80),'界'.repeat(120));
  }
  const lines=db.prepare('SELECT sku FROM offline_stock').all().map(r=>({sku:r.sku,quantity:1,priceMinor:1}));
  assert.throws(()=>engine.commitSale({key:'oversized-receipt-001',lines}),/SALE_EVENT_TOO_LARGE/);
  assert.equal(db.prepare('SELECT sum(quantity) n FROM offline_stock').get().n,100);
  for(const table of ['offline_sales','offline_outbox','offline_sale_lines','offline_stock_movements','offline_journal'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  const sku=lines[0].sku;db.prepare('UPDATE offline_item_links SET product_name=? WHERE sku=?').run('قهوة أصلية',sku);
  engine.commitSale({key:'name-snapshot-001',lines:[lines[0]]});db.prepare('UPDATE offline_item_links SET product_name=? WHERE sku=?').run('اسم آخر',sku);
  assert.equal(JSON.parse(db.prepare('SELECT canonical FROM offline_sale_lines').get().canonical).productName,'قهوة أصلية');
 }finally{db.close();}
});
