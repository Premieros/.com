'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {invoke}=require('./windows-print.cjs');
(async()=>{
 const testValue=JSON.stringify({projectRef:'hvqlkapynjfjikqithvd',token:'only-a-synthetic-test-secret'});
 const encrypted=await invoke('protect',{value:testValue});assert.equal(typeof encrypted.protected,'string');assert.ok(!encrypted.protected.includes('synthetic'));
 assert.equal((await invoke('unprotect',{protected:encrypted.protected})).value,testValue);
 const printers=await invoke('printers');assert.ok(Array.isArray(printers.printers));
 const receipt={saleId:'11111111-1111-4111-8111-111111111111',createdAt:'2026-10-29T00:00:00Z',totalMinor:1250,lines:[{label:'اختبار رسم عربي — لا يرسل إلى الطابعة',quantity:1,priceMinor:1250}]};
 const render=[];
 for(const dots of [384,512,576]){const result=await invoke('render',{receipt,dots});const bytes=Buffer.from(result.bytes,'base64');assert.equal(bytes[0],27);assert.equal(bytes[1],64);assert.equal(result.width,dots);assert.ok(result.height>40&&result.height<16000);render.push({dots,height:result.height,bytes:bytes.length});}
 const report={ok:true,dpapiMachine:true,printerDiscovery:true,printerCount:printers.printers.length,render,physicalPrintSent:false};
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
