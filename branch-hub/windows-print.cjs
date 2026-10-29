'use strict';
const path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
function helperPath(){
 const candidates=[process.env.PREMIER_WINDOWS_HELPER,
  process.resourcesPath&&path.join(process.resourcesPath,'branch-windows','Premier.Windows.exe'),
  path.join(__dirname,'native-runtime/Premier.Windows.exe'),
  path.join(__dirname,'native/bin/Release/net8.0-windows/win-x64/publish/Premier.Windows.exe')].filter(Boolean);
 const selected=candidates.find(p=>path.isAbsolute(p)&&fs.existsSync(p));
 if(!selected)throw Error('WINDOWS_HELPER_UNAVAILABLE');return selected;
}
function invoke(command,input={},options={}){
 if(process.platform!=='win32')return Promise.reject(Error('WINDOWS_REQUIRED'));
 if(!['printers','print','render','protect','unprotect'].includes(command))return Promise.reject(Error('INVALID_WINDOWS_HELPER_COMMAND'));
 return new Promise((resolve,reject)=>{
  const child=spawn(options.executable||helperPath(),[command],{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
  let stdout='',complete=false;
  const finish=(error,result)=>{if(complete)return;complete=true;clearTimeout(timer);if(error)reject(error);else resolve(result);};
  const timer=setTimeout(()=>{child.kill();const e=Error('WINDOWS_HELPER_TIMEOUT');e.deliveryUncertain=command==='print';finish(e);},30000);
  child.stdout.on('data',data=>{stdout+=data;if(stdout.length>4*1024*1024){child.kill();const e=Error('WINDOWS_HELPER_RESPONSE_TOO_LARGE');e.deliveryUncertain=command==='print';finish(e);}});
  child.stderr.on('data',()=>{});
  child.once('error',error=>finish(error));
  child.once('close',code=>{
   if(complete)return;
   try{const result=JSON.parse(stdout);if(code!==0||result.ok!==true){const e=Error(result.error||'WINDOWS_HELPER_FAILED');e.deliveryUncertain=result.uncertain===true;throw e;}finish(null,result);}
   catch(error){if(!stdout||error instanceof SyntaxError)error.deliveryUncertain=command==='print';finish(error);}
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
 });
}
async function sendWindows(printer,bytes){
 if(!printer||printer.kind!=='windows'||typeof printer.name!=='string'||!Buffer.isBuffer(bytes)||bytes.length>2*1024*1024)throw Error('INVALID_WINDOWS_PRINT');
 return invoke('print',{name:printer.name,bytes:bytes.toString('base64')});
}
async function renderWindows(receipt,dots=576){
 require('./raster-receipt.cjs').validateReceipt(receipt);
 const response=await invoke('render',{receipt,dots});const bytes=Buffer.from(response.bytes||'','base64');
 if(bytes.length<16||bytes.length>2*1024*1024||bytes[0]!==27||bytes[1]!==64)throw Error('INVALID_RASTER_OUTPUT');return bytes;
}
module.exports={invoke,sendWindows,renderWindows,helperPath};
