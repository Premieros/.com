'use strict';
const {UUID}=require('./cloud-client.cjs');
const MAX_HEIGHT=16000;
function validateReceipt(receipt){
 if(!receipt||!UUID.test(receipt.saleId||'')||typeof receipt.createdAt!=='string'||receipt.createdAt.length>60||!Number.isSafeInteger(receipt.totalMinor)||receipt.totalMinor<=0||!Array.isArray(receipt.lines)||!receipt.lines.length||receipt.lines.length>100)throw Error('INVALID_RASTER_RECEIPT');
 let total=0;
 for(const line of receipt.lines){
  if(!line||typeof line.label!=='string'||!line.label.length||Array.from(line.label).length>160||!Number.isSafeInteger(line.quantity)||line.quantity<=0||!Number.isSafeInteger(line.priceMinor)||line.priceMinor<=0)throw Error('INVALID_RASTER_RECEIPT');
  const amount=line.quantity*line.priceMinor;if(!Number.isSafeInteger(amount)||!Number.isSafeInteger(total+amount))throw Error('INVALID_RASTER_RECEIPT');total+=amount;
 }
 if(total!==receipt.totalMinor)throw Error('INVALID_RASTER_RECEIPT');
 return receipt;
}
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function receiptHtml(receipt,dots){
 validateReceipt(receipt);if(![384,512,576].includes(dots))throw Error('INVALID_PRINTER_DOTS');
 const money=minor=>{const n=BigInt(minor);return `${n/100n}.${String(n%100n).padStart(2,'0')}`;};
 const rows=receipt.lines.map(line=>`<tr><td class="name" dir="auto">${escape(line.label)}</td><td class="numbers">${line.quantity}</td><td class="numbers">${money(line.priceMinor)}</td><td class="numbers">${money(line.quantity*line.priceMinor)}</td></tr>`).join('');
 return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
 *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:"Segoe UI",Tahoma,Arial,sans-serif;font-size:18px;line-height:1.5}#receipt{width:${dots}px;padding:12px}h1{font-size:28px;margin:0;text-align:center}h2{font-size:20px;margin:4px;text-align:center}.meta{font-size:13px;overflow-wrap:anywhere;text-align:center}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:12px}th,td{padding:6px 2px;vertical-align:top;border-bottom:1px solid #000;text-align:right;font-size:16px}th:first-child,td:first-child{width:46%}.name{overflow-wrap:anywhere;unicode-bidi:plaintext}.numbers{direction:ltr;text-align:center;font-size:14px;overflow-wrap:anywhere}.total{font-size:24px;font-weight:bold;margin-top:14px;display:flex;justify-content:space-between}.footer{text-align:center;margin:12px 0 0;font-size:14px}
 </style></head><body><main id="receipt"><h1>Premier</h1><h2>إيصال بيع محلي</h2><div class="meta" dir="ltr">${escape(receipt.saleId)}<br>${escape(receipt.createdAt)}</div><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>القيمة</th></tr></thead><tbody>${rows}</tbody></table><div class="total"><span>الإجمالي</span><span dir="ltr">${money(receipt.totalMinor)}</span></div><p class="footer">شكرًا لزيارتكم</p></main></body></html>`;
}
function bitmapToEscPos({width,height,bitmap}){
 if(!Number.isInteger(width)||width<8||width>576||width%8||!Number.isInteger(height)||height<1||height>MAX_HEIGHT||!Buffer.isBuffer(bitmap)||bitmap.length!==width*height*4)throw Error('INVALID_RECEIPT_BITMAP');
 let black=0;
 const stride=width/8,parts=[Buffer.from([27,64])];
 for(let y=0;y<height;y+=256){
  const rows=Math.min(256,height-y),data=Buffer.alloc(stride*rows);
  for(let row=0;row<rows;row++)for(let x=0;x<width;x++){
   const i=((y+row)*width+x)*4,alpha=bitmap[i+3]/255;
   // Renderer emits monochrome grayscale on opaque white; RGB/BGR ordering is immaterial.
   const light=(bitmap[i]+bitmap[i+1]+bitmap[i+2])/3*alpha+255*(1-alpha);
   if(light<160){data[row*stride+(x>>3)]|=0x80>>(x&7);black++;}
  }
  parts.push(Buffer.from([29,118,48,0,stride&255,stride>>8,rows&255,rows>>8]),data);
 }
 if(!black)throw Error('EMPTY_RECEIPT_BITMAP');
 parts.push(Buffer.from([10,10,10,29,86,0]));return Buffer.concat(parts);
}
function createElectronReceiptRenderer({BrowserWindow,nativeImage}){
 let active=false;
 return async(receipt,dots=576)=>{
  const html=receiptHtml(receipt,dots);if(active)throw Error('RASTER_RENDERER_BUSY');active=true;
  let window,timer;
  const render=async()=>{
   window=new BrowserWindow({show:false,width:dots,height:128,useContentSize:true,frame:false,backgroundColor:'#ffffff',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
   window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   window.webContents.on('will-navigate',event=>event.preventDefault());
   await window.loadURL('data:text/html;charset=UTF-8,'+encodeURIComponent(html));
   const height=await window.webContents.executeJavaScript("document.fonts.ready.then(()=>Math.ceil(document.getElementById('receipt').getBoundingClientRect().height))");
   if(!Number.isInteger(height)||height<1||height>MAX_HEIGHT)throw Error('RECEIPT_TOO_TALL');
   window.setContentSize(dots,height);
   const capture=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
   // A PNG roundtrip normalizes the display scale before producing Windows' 4-channel bitmap.
   const image=nativeImage.createFromBuffer(capture.toPNG({scaleFactor:1})).resize({width:dots,quality:'best'});
   const size=image.getSize(),bitmap=image.toBitmap({scaleFactor:1});
   if(size.width!==dots||size.height>MAX_HEIGHT)throw Error('INVALID_CAPTURE_SIZE');
   const bytes=bitmapToEscPos({width:dots,height:size.height,bitmap});
   return bytes;
  };
  try{return await Promise.race([render(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RASTER_RENDER_TIMEOUT')),10000);})]);}
  finally{clearTimeout(timer);if(window&&!window.isDestroyed())window.destroy();active=false;}
 };
}
module.exports={validateReceipt,receiptHtml,bitmapToEscPos,createElectronReceiptRenderer};
