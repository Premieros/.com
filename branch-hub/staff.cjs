'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const derive=promisify(crypto.scrypt);
const {createDeviceRegistry,roles}=require('./devices.cjs');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const WINDOW=15*60*1000,IDLE=30*60*1000,LIFETIME=8*60*60*1000;
function createStaffRegistry(db,branchId,{clock=Date.now,resetSessions=false}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS hub_staff_policy(branch_id TEXT PRIMARY KEY,required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)));
 CREATE TABLE IF NOT EXISTS hub_staff(id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('viewer','cashier','stock')),password_hash TEXT NOT NULL,salt TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),UNIQUE(branch_id,username));
 CREATE TABLE IF NOT EXISTS hub_staff_sessions(token_hash TEXT PRIMARY KEY,branch_id TEXT NOT NULL,staff_id TEXT NOT NULL REFERENCES hub_staff(id),
 device_id TEXT NOT NULL REFERENCES hub_devices(id),revision INTEGER NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS hub_staff_limits(branch_id TEXT NOT NULL,subject TEXT NOT NULL,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL,PRIMARY KEY(branch_id,subject));`);
 db.prepare('INSERT OR IGNORE INTO hub_staff_policy(branch_id) VALUES(?)').run(branchId);
 db.prepare('UPDATE hub_staff_policy SET required=1 WHERE branch_id=? AND EXISTS(SELECT 1 FROM hub_staff WHERE branch_id=?)').run(branchId,branchId);
 if(resetSessions)db.prepare('DELETE FROM hub_staff_sessions WHERE branch_id=?').run(branchId);
 const {audit}=createDeviceRegistry(db,branchId);let busy=0,closing=false;
 const work=new Set();
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function required(){return db.prepare('SELECT required FROM hub_staff_policy WHERE branch_id=?').get(branchId).required===1;}
 function passwordValid(password){return typeof password==='string'&&Array.from(password).length>=12&&Buffer.byteLength(password)<=128;}
 async function hashed(password,salt){
  if(closing||busy>=2)throw Error('STAFF_AUTH_BUSY');busy++;
  const job=derive(password,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:1,maxmem:32*1024*1024});work.add(job);
  try{return (await job).toString('hex');}finally{work.delete(job);busy--;}
 }
 async function create({username,name,role,password},actor='administrator'){
  if(typeof username!=='string'||! /^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username)||typeof name!=='string'||!name.trim()||name.length>80||!Object.hasOwn(roles,role)||!passwordValid(password))throw Error('INVALID_STAFF');
  const salt=crypto.randomBytes(16).toString('hex'),passwordHash=await hashed(password,salt),id=crypto.randomUUID();
  return transaction(()=>{
   if(db.prepare('SELECT count(*) n FROM hub_staff WHERE branch_id=?').get(branchId).n>=500)throw Error('STAFF_LIMIT_REACHED');
   db.prepare('INSERT INTO hub_staff(id,branch_id,username,name,role,password_hash,salt) VALUES(?,?,?,?,?,?,?)').run(id,branchId,username,name.trim(),role,passwordHash,salt);
   // Sticky policy: disabling the last employee must never re-enable device-only access.
   db.prepare('UPDATE hub_staff_policy SET required=1 WHERE branch_id=?').run(branchId);
   audit(actor,'staff.create',id,{username,name:name.trim(),role});return {id,username,name:name.trim(),role};
  });
 }
 function list(){return db.prepare('SELECT id,username,name,role,disabled FROM hub_staff WHERE branch_id=? ORDER BY username').all(branchId);}
 function reserve(deviceId,username){
  const now=clock();
  return transaction(()=>{
   db.prepare('DELETE FROM hub_staff_limits WHERE branch_id=? AND reset_at<=?').run(branchId,now);
   for(const [subject,limit] of [['device:'+deviceId,20],['user:'+digest(username),5]]){
    const row=db.prepare('SELECT attempts FROM hub_staff_limits WHERE branch_id=? AND subject=?').get(branchId,subject);
    if(row?.attempts>=limit){audit('device:'+deviceId,'staff.login_limited',deviceId);return false;}
   }
   for(const subject of ['device:'+deviceId,'user:'+digest(username)])db.prepare(`INSERT INTO hub_staff_limits(branch_id,subject,attempts,reset_at) VALUES(?,?,1,?)
    ON CONFLICT(branch_id,subject) DO UPDATE SET attempts=attempts+1`).run(branchId,subject,now+WINDOW);
   return true;
  });
 }
 async function login(deviceId,{username,password}={}){
  if(typeof username!=='string'||username.length>40||typeof password!=='string'||Buffer.byteLength(password)>128)throw Error('STAFF_LOGIN_REJECTED');
  username=username.toLowerCase();
  const device=db.prepare('SELECT role FROM hub_devices WHERE id=? AND branch_id=? AND revoked=0').get(deviceId,branchId);
  if(!device)throw Error('STAFF_LOGIN_REJECTED');
  if(busy>=2||closing)throw Error('STAFF_AUTH_BUSY');
  if(!reserve(deviceId,username))throw Error('STAFF_LOGIN_LIMITED');
  const user=db.prepare('SELECT * FROM hub_staff WHERE branch_id=? AND username=?').get(branchId,username);
  // The same work is performed for an unknown or disabled account. No password or session token enters audit details.
  const hash=await hashed(password,user?.salt||'0'.repeat(32));
  const valid=!!user&&!user.disabled&&crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(user.password_hash,'hex'));
  return transaction(()=>{
   const current=db.prepare('SELECT revision,disabled FROM hub_staff WHERE id=? AND branch_id=?').get(user?.id||'',branchId);
   const liveDevice=db.prepare('SELECT id FROM hub_devices WHERE id=? AND branch_id=? AND revoked=0').get(deviceId,branchId);
   if(!valid||!current||current.disabled||current.revision!==user.revision||!liveDevice){audit('device:'+deviceId,'staff.login_failed',deviceId);return null;}
   const token=crypto.randomBytes(32).toString('base64url'),now=clock();
   db.prepare('DELETE FROM hub_staff_sessions WHERE branch_id=? AND (device_id=? OR expires_at<=? OR last_seen<=?)').run(branchId,deviceId,now,now-IDLE);
   db.prepare('INSERT INTO hub_staff_sessions VALUES(?,?,?,?,?,?,?,?)').run(digest(token),branchId,user.id,deviceId,user.revision,now,now,now+LIFETIME);
   db.prepare('DELETE FROM hub_staff_limits WHERE branch_id=? AND subject=?').run(branchId,'user:'+digest(username));
   audit('staff:'+user.id,'staff.login',deviceId,{deviceId});
   return {token,name:user.name,expiresAt:now+LIFETIME};
  });
 }
 function authenticate(token,device){
  if(typeof token!=='string'||token.length>128)return null;
  const now=clock(),row=db.prepare(`SELECT s.staff_id,s.revision,u.name,u.role FROM hub_staff_sessions s
   JOIN hub_staff u ON u.id=s.staff_id AND u.branch_id=s.branch_id JOIN hub_devices d ON d.id=s.device_id AND d.branch_id=s.branch_id
   WHERE s.token_hash=? AND s.branch_id=? AND s.device_id=? AND u.disabled=0 AND d.revoked=0 AND s.revision=u.revision
   AND s.expires_at>? AND s.last_seen>?`).get(digest(token),branchId,device.id,now,now-IDLE);
  if(!row)return null;
  db.prepare('UPDATE hub_staff_sessions SET last_seen=? WHERE token_hash=? AND branch_id=?').run(now,digest(token),branchId);
  return {id:'staff:'+row.staff_id,deviceId:device.id,name:row.name,allows:permission=>device.allows(permission)&&roles[row.role].has(permission)};
 }
 function logout(token,deviceId){return transaction(()=>{
  const row=db.prepare('SELECT staff_id FROM hub_staff_sessions WHERE token_hash=? AND branch_id=? AND device_id=?').get(digest(token),branchId,deviceId);
  db.prepare('DELETE FROM hub_staff_sessions WHERE token_hash=? AND branch_id=? AND device_id=?').run(digest(token),branchId,deviceId);
  if(row)audit('staff:'+row.staff_id,'staff.logout',deviceId);return !!row;
 });}
 async function update(id,{role,disabled,password},actor='administrator'){
  if((role!==undefined&&!Object.hasOwn(roles,role))||(disabled!==undefined&&typeof disabled!=='boolean')||(password!==undefined&&!passwordValid(password)))throw Error('INVALID_STAFF');
  const initial=db.prepare('SELECT revision FROM hub_staff WHERE id=? AND branch_id=?').get(id,branchId);if(!initial)throw Error('STAFF_NOT_FOUND');
  const salt=password!==undefined?crypto.randomBytes(16).toString('hex'):null;
  const hash=salt?await hashed(password,salt):null;
  return transaction(()=>{
   const current=db.prepare('SELECT * FROM hub_staff WHERE id=? AND branch_id=?').get(id,branchId);if(!current||current.revision!==initial.revision)throw Error('STAFF_CHANGED');
   db.prepare('UPDATE hub_staff SET role=?,disabled=?,password_hash=?,salt=?,revision=revision+1 WHERE id=? AND branch_id=?').run(role??current.role,disabled===undefined?current.disabled:Number(disabled),hash??current.password_hash,salt??current.salt,id,branchId);
   db.prepare('DELETE FROM hub_staff_sessions WHERE staff_id=? AND branch_id=?').run(id,branchId);
   audit(actor,'staff.update',id,{role:role??current.role,disabled:disabled??!!current.disabled,passwordReset:password!==undefined});return true;
  });
 }
 return {create,list,required,login,authenticate,logout,update,async stop(){closing=true;await Promise.allSettled([...work]);}};
}
module.exports={createStaffRegistry};
