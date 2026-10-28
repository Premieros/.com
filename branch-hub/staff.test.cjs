'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createDeviceRegistry}=require('./devices.cjs');
const {createStaffRegistry}=require('./staff.cjs');
const password='Local-employee-12345';
function fixture(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');const devices=createDeviceRegistry(db,'branch_001');let now=10000000;const registry=createStaffRegistry(db,'branch_001',{clock:()=>now});return {db,devices,registry,advance:ms=>now+=ms};}
test('staff password/session secrets stay hashed; sessions are device-bound with intersected roles and idle expiry',async()=>{
 const {db,devices,registry,advance}=fixture();try{
  const cashier=devices.issue({name:'Till',role:'cashier'}),viewer=devices.issue({name:'Display',role:'viewer'});
  const user=await registry.create({username:'sayed',name:'سيد',role:'cashier',password});
  assert.equal(registry.required(),true);
  const login=await registry.login(cashier.id,{username:'SAYED',password});
  const principal=registry.authenticate(login.token,devices.authenticate(cashier.token));
  assert.equal(principal.id,'staff:'+user.id);assert.equal(principal.allows('sell'),true);assert.equal(principal.allows('admin'),false);
  assert.equal(registry.authenticate(login.token,devices.authenticate(viewer.token)),null);
  const second=await registry.login(viewer.id,{username:'sayed',password});
  assert.equal(registry.authenticate(second.token,devices.authenticate(viewer.token)).allows('sell'),false);
  const stored=db.prepare('SELECT * FROM hub_staff').get();assert.notEqual(stored.password_hash,password);
  assert.notEqual(db.prepare('SELECT token_hash FROM hub_staff_sessions LIMIT 1').get().token_hash,login.token);
  assert(!JSON.stringify(db.prepare('SELECT details FROM hub_audit').all()).includes(password));
  advance(30*60*1000);assert.equal(registry.authenticate(login.token,devices.authenticate(cashier.token)),null);
 }finally{await registry.stop();db.close();}
});
test('staff/device revocation, password reset, logout, and hub restart invalidate sessions immediately',async()=>{
 const {db,devices,registry}=fixture();try{
  const device=devices.issue({name:'Till',role:'cashier'}),user=await registry.create({username:'cashier',name:'Cashier',role:'cashier',password});
  const login=()=>registry.login(device.id,{username:'cashier',password});const principal=()=>devices.authenticate(device.token);
  let session=await login();await registry.update(user.id,{role:'viewer'});assert.equal(registry.authenticate(session.token,principal()),null);
  session=await login();assert.equal(registry.authenticate(session.token,principal()).allows('sell'),false);
  registry.logout(session.token,device.id);assert.equal(registry.authenticate(session.token,principal()),null);
  session=await login();await registry.update(user.id,{password:'New-password-12345'});assert.equal(registry.authenticate(session.token,principal()),null);
  assert.equal(await login(),null);
  session=await registry.login(device.id,{username:'cashier',password:'New-password-12345'});
  createStaffRegistry(db,'branch_001',{resetSessions:true});assert.equal(registry.authenticate(session.token,principal()),null);
  await registry.update(user.id,{disabled:true});assert.equal(registry.required(),true);
  assert.equal(await registry.login(device.id,{username:'cashier',password:'New-password-12345'}),null);
  await registry.update(user.id,{disabled:false});session=await registry.login(device.id,{username:'cashier',password:'New-password-12345'});
  const old=principal();devices.revoke(device.id);assert.equal(registry.authenticate(session.token,old),null);
 }finally{await registry.stop();db.close();}
});
test('failed login budget survives restart and applies across devices without revealing unknown users',async()=>{
 const {db,devices,registry,advance}=fixture();try{
  const a=devices.issue({name:'A',role:'cashier'}),b=devices.issue({name:'B',role:'cashier'});
  await registry.create({username:'cashier',name:'Cashier',role:'cashier',password});
  for(let n=0;n<5;n++)assert.equal(await registry.login(n%2?a.id:b.id,{username:'cashier',password:'wrong-password'}),null);
  const restarted=createStaffRegistry(db,'branch_001',{clock:()=>10000000});
  await assert.rejects(restarted.login(a.id,{username:'cashier',password}),/STAFF_LOGIN_LIMITED/);
  assert.equal(await registry.login(a.id,{username:'unknown',password}),null);
  advance(15*60*1000);assert((await registry.login(a.id,{username:'cashier',password})).token);
 }finally{await registry.stop();db.close();}
});
test('staff creation/audit is atomic and an in-flight password check cannot survive a credential reset',async()=>{
 const {db,devices,registry}=fixture();try{
  const device=devices.issue({name:'Till',role:'cashier'});
  db.exec("CREATE TRIGGER fail_staff BEFORE INSERT ON hub_audit WHEN NEW.action='staff.create' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
  await assert.rejects(registry.create({username:'cashier',name:'Cashier',role:'cashier',password}),/injected/);
  assert.equal(registry.list().length,0);assert.equal(registry.required(),false);db.exec('DROP TRIGGER fail_staff');
  const user=await registry.create({username:'cashier',name:'Cashier',role:'cashier',password});
  const pending=registry.login(device.id,{username:'cashier',password});
  await registry.update(user.id,{disabled:true});assert.equal(await pending,null);
 }finally{await registry.stop();db.close();}
});
