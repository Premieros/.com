'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
function createEnrollmentController({client,vault,dataDir,clock=Date.now}){
 let session=null,busy=false;
 async function exclusive(fn){if(busy)throw Error('ENROLLMENT_BUSY');busy=true;try{return await fn();}finally{busy=false;}}
 return {
  signIn(input){return exclusive(async()=>{
   session=null;
   const signed=await client.signIn(input);
   session={...signed,until:clock()+5*60*1000};
   return {branches:signed.branches};
  });},
  enroll(branchId){return exclusive(async()=>{
   if(!session||session.until<clock())throw Error('LOGIN_REQUIRED');
   if(!session.branches.some(r=>r.id===branchId))throw Error('BRANCH_ACCESS_DENIED');
   const verified=await client.validateEnrollment(session.accessToken,branchId);
   const database=path.join(dataDir,'branch-hub.sqlite');
   if(fs.existsSync(database)){
    const db=new DatabaseSync(database,{readOnly:true});
    try{
     const binding=db.prepare('SELECT organization_id,branch_id FROM hub_identity WHERE singleton=1').get();
     if(binding?.organization_id!==verified.organizationId||binding?.branch_id!==verified.id)throw Error('BRANCH_BINDING_MISMATCH');
    }finally{db.close();}
   }
   const config={projectRef:verified.projectRef,organizationId:verified.organizationId,branchId:verified.id,
    enrolledBy:verified.enrolledBy,enrolledAt:new Date(clock()).toISOString(),hubDeviceId:crypto.randomUUID(),
    backupKey:crypto.randomBytes(32).toString('hex'),token:crypto.randomBytes(32).toString('base64url')};
   vault.save(config);session=null;
   return config;
  });},
  clear(){session=null;},
 };
}
module.exports={createEnrollmentController};
