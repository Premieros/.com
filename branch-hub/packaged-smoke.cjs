'use strict';
// Run inside packaged Electron too: catches missing files and unsupported node:sqlite.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHub}=require('./server.cjs');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-package-'));
 const hub=createHub({dataDir:dir,branchId:'test_branch',organizationId:'test_org',token:'s'.repeat(40),port:0});
 try {
  const {port}=await hub.listen();
  const response=await fetch(`http://127.0.0.1:${port}/health`);
  if(!response.ok || !(await response.json()).ok)throw Error('PACKAGED_HEALTH_FAILED');
  hub.createLocalBackup();
  console.log('PACKAGED_RUNTIME_OK',process.versions.node);
 }finally{await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
