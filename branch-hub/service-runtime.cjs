'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PROJECT_REF,UUID}=require('./cloud-client.cjs');
function validateServiceBinding(input){
 const c=input?.binding;
 if(!c||c.projectRef!==PROJECT_REF||!UUID.test(c.organizationId||'')||!UUID.test(c.branchId||'')||!UUID.test(c.hubDeviceId||'')||typeof c.token!=='string'||c.token.length<32||!/^[0-9a-f]{64}$/.test(c.backupKey||'')||typeof input.dataDir!=='string'||!path.isAbsolute(input.dataDir))throw Error('INVALID_SERVICE_BINDING');
 return input;
}
async function runService(input,{createHub=require('./server.cjs').createHub,createBrowserAppServer=require('./browser-app-server.cjs').createBrowserAppServer,persistBinding}={}){
 validateServiceBinding(input);const c=input.binding;
 if(typeof persistBinding!=='function')throw Error('SERVICE_VAULT_REQUIRED');
 const hub=createHub({...c,host:c.host||'127.0.0.1',port:c.port||3847,dataDir:input.dataDir,
  installationId:c.hubDeviceId,renderReceipt:require('./windows-print.cjs').renderWindows,
  persistRefreshToken:async refreshToken=>{if(typeof refreshToken!=='string'||refreshToken.length<8||refreshToken.length>8192)throw Error('INVALID_CLOUD_SESSION');const next={...input,binding:{...c,cloudRefreshToken:refreshToken}};await persistBinding(next);c.cloudRefreshToken=refreshToken;}});
 let browser;
 try{const address=await hub.listen();browser=createBrowserAppServer({port:c.browserPort||3848});const browserUrl=await browser.listen();
  return {port:address.port,browserUrl,async close(){await browser.close();await hub.close();}};
 }catch(error){if(browser)await browser.close().catch(()=>{});await hub.close().catch(()=>{});throw error;}
}
function publishProtectedBinding(file,encrypted){
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,encrypted,{flag:'wx',mode:0o600});const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,file);}
 finally{fs.rmSync(temporary,{force:true});}
}
if(require.main===module){
 const readline=require('node:readline').createInterface({input:process.stdin});let current,service,stdinClosed=false;
 readline.once('line',async line=>{
  try{
   if(Buffer.byteLength(line)>65536)throw Error('SERVICE_CONFIGURATION_TOO_LARGE');
   current=JSON.parse(line);validateServiceBinding(current);
   service=await runService(current,{persistBinding:async next=>{
    const result=await require('./windows-print.cjs').invoke('protect',{value:JSON.stringify(next)});
    publishProtectedBinding(current.vaultFile,result.protected);current=next;
   }});
   if(stdinClosed){await service.close();process.exit(0);return;}
   process.stdout.write(JSON.stringify({ready:true,projectRef:PROJECT_REF,port:service.port,browserUrl:service.browserUrl})+'\n');
  }catch{process.stdout.write(JSON.stringify({ready:false,error:'SERVICE_START_FAILED'})+'\n');process.exitCode=1;readline.close();}
 });
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;if(service)await service.close();readline.close();process.exit(0);};
 readline.on('line',line=>{if(line==='stop')void stop();});
 process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());readline.on('close',()=>{stdinClosed=true;if(service&&!stopping)void stop();});
}
module.exports={runService,validateServiceBinding,publishProtectedBinding};
