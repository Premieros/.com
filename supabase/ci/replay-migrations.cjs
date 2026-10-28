'use strict';
// Disposable CI replay only. Never rewrites historical files or the production migration runner.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {Client}=require('pg');
const ROOT=path.resolve(__dirname,'../..');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const REPAIR={file:'20261023150600_raw_published_price_asof_helper.sql',
 sourceSha256:'f5a8e02dba0142e117ed039f2401a209696c4cc45eab08d351470b663c8ef6bc',
 before:'$function$\n\nREVOKE',after:'$function$;\n\nREVOKE',
 reason:'pg_get_functiondef snapshot lacks a statement terminator before its separate REVOKE statement'};
function validateTarget(env){
 if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='Premieros/.com'||env.SUPABASE_PROJECT_REF!=='hvqlkapynjfjikqithvd')throw Error('CI_REPLAY_ENVIRONMENT_REQUIRED');
 let url;try{url=new URL(env.SUPABASE_DB_URL);}catch{throw Error('CI_REPLAY_LOCAL_DATABASE_REQUIRED');}
 if(!['postgresql:','postgres:'].includes(url.protocol)||!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5432'||url.username!=='postgres'||url.pathname!=='/postgres'||url.search||url.hash)throw Error('CI_REPLAY_LOCAL_DATABASE_REQUIRED');
 return url.href;
}
function assertFreshDatabase(state){
 if(state.actor!=='postgres'||state.database!=='postgres'||state.tables!==0||state.auth_schema!==false)throw Error('CI_REPLAY_EMPTY_DATABASE_REQUIRED');
}
function prepareFixtures(sourceDir,outputDir){
 const files=fs.readdirSync(sourceDir).filter(name=>name.endsWith('.sql')).sort();
 if(!files.includes(REPAIR.file))throw Error('CI_REPLAY_SOURCE_MISSING');
 const staged=files.map(file=>{
  const source=path.join(sourceDir,file);if(!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink())throw Error('CI_REPLAY_REGULAR_FILE_REQUIRED');
  const original=fs.readFileSync(source,'utf8');let sql=original,repair=null;
  if(file===REPAIR.file){
   if(sha(original)!==REPAIR.sourceSha256||original.split(REPAIR.before).length!==2)throw Error('CI_REPLAY_SOURCE_CHANGED');
   sql=original.replace(REPAIR.before,REPAIR.after);repair=REPAIR.reason;
  }
  return {file,sql,sourceSha256:sha(original),replaySha256:sha(sql),repair};
 });
 fs.mkdirSync(outputDir,{mode:0o700});
 try{for(const item of staged)fs.writeFileSync(path.join(outputDir,item.file),item.sql,{flag:'wx',mode:0o600});}
 catch(e){fs.rmSync(outputDir,{recursive:true,force:true});throw e;}
 return staged.map(({sql,...item})=>item);
}
function run(args,env){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(ROOT,'scripts/db/apply-migration.js'),...args],{cwd:ROOT,env,stdio:'inherit'});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('CI_REPLAY_APPLY_FAILED')));
});}
async function main(){
 const connectionString=validateTarget(process.env);
 if(!process.env.RUNNER_TEMP||!fs.statSync(process.env.RUNNER_TEMP).isDirectory())throw Error('CI_REPLAY_RUNNER_TEMP_REQUIRED');
 const staging=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'branch-hub-replay-'));
 try{
  const output=path.join(staging,'migrations'),manifest=prepareFixtures(path.join(ROOT,'supabase/migrations'),output);
  // Inspect before applying even the auth stub. A populated schema or Supabase auth schema is refused.
  const db=new Client({connectionString});await db.connect();
  try{
   const {rows}=await db.query("SELECT current_user AS actor,current_database() AS database,(SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables,EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') AS auth_schema");
   assertFreshDatabase(rows[0]);
  }finally{await db.end();}
  const report={ciOnly:true,projectRef:'hvqlkapynjfjikqithvd',sourceDirectory:'supabase/migrations',repairCount:manifest.filter(x=>x.repair).length,files:manifest};
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'branch-hub-replay-manifest.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  const env={...process.env,SUPABASE_DB_URL:connectionString};
  await run(['--file','supabase/ci/stub_auth.sql'],env);
  await run(['--dir',output],env);
  console.log('CI_REPLAY_COMPLETE: historical sources unchanged; one pinned delimiter repair in disposable fixtures');
 }finally{fs.rmSync(staging,{recursive:true,force:true});}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={validateTarget,assertFreshDatabase,prepareFixtures,REPAIR};
