'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateTarget,assertFreshDatabase,prepareFixtures,REPAIR}=require('./replay-migrations.cjs');
const env={CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'Premieros/.com',SUPABASE_PROJECT_REF:'hvqlkapynjfjikqithvd',SUPABASE_DB_URL:'postgresql://postgres:isolated@localhost:5432/postgres'};
test('CI replay refuses external databases, alternate projects, URL options and non-CI execution',()=>{
 assert.equal(new URL(validateTarget(env)).hostname,'localhost');
 for(const value of ['postgresql://postgres@db.hvqlkapynjfjikqithvd.supabase.co:5432/postgres','postgresql://postgres@localhost.evil.test:5432/postgres','postgresql://postgres@localhost:5432/production','postgresql://postgres@localhost:5432/postgres?host=db.example.test','postgresql://postgres@localhost:6543/postgres'])assert.throws(()=>validateTarget({...env,SUPABASE_DB_URL:value}),/LOCAL_DATABASE_REQUIRED/);
 for(const update of [{CI:'false'},{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'another/repo'},{SUPABASE_PROJECT_REF:'other-project'}])assert.throws(()=>validateTarget({...env,...update}),/ENVIRONMENT_REQUIRED/);
});
test('CI fixture repairs exactly one reviewed delimiter and preserves every historical source byte',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-replay-test-')),source=path.join(__dirname,'../migrations');
 const originals=new Map(fs.readdirSync(source).filter(n=>n.endsWith('.sql')).map(n=>[n,fs.readFileSync(path.join(source,n))]));
 try{
  const out=path.join(root,'replay'),manifest=prepareFixtures(source,out);
  assert.equal(manifest.filter(x=>x.repair).length,1);
  for(const item of manifest){
   const original=originals.get(item.file);assert.deepEqual(fs.readFileSync(path.join(source,item.file)),original);
   const replay=fs.readFileSync(path.join(out,item.file));
   if(item.repair){assert.equal(item.sourceSha256,REPAIR.sourceSha256);assert.equal(replay.toString(),original.toString().replace(REPAIR.before,REPAIR.after));}
   else assert.deepEqual(replay,original);
  }
  assert.throws(()=>prepareFixtures(source,out),/EEXIST/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('an unreviewed historical source change is rejected before any fixture is published',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-replay-drift-'));
 try{
  const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,REPAIR.file),'SELECT 1;');
  const output=path.join(root,'out');assert.throws(()=>prepareFixtures(source,output),/SOURCE_CHANGED/);assert.equal(fs.existsSync(output),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('replay refuses existing public data, Supabase auth schemas and unexpected database identities',()=>{
 const empty={actor:'postgres',database:'postgres',tables:0,auth_schema:false};assert.doesNotThrow(()=>assertFreshDatabase(empty));
 for(const change of [{tables:1},{auth_schema:true},{actor:'authenticated'},{database:'other'}, {auth_schema:null}])assert.throws(()=>assertFreshDatabase({...empty,...change}),/EMPTY_DATABASE_REQUIRED/);
});
