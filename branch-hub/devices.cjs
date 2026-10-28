'use strict';
const crypto = require('node:crypto');
const roles = {
  viewer: new Set(['read']),
  cashier: new Set(['read','sell','print']),
  stock: new Set(['read','stock']),
};
function createDeviceRegistry(db, branchId) {
  db.exec(`CREATE TABLE IF NOT EXISTS hub_devices (
    id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('viewer','cashier','stock')),
    token_hash TEXT NOT NULL UNIQUE, revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS hub_audit (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, actor TEXT NOT NULL,
      action TEXT NOT NULL, entity_id TEXT NOT NULL, details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  function audit(actor, action, entityId, details={}) {
    db.prepare('INSERT INTO hub_audit(id,branch_id,actor,action,entity_id,details) VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(),branchId,actor,action,entityId,JSON.stringify(details));
  }
  function issue({name,role}) {
    if (typeof name !== 'string' || name.trim().length<1 || name.length>80 || !Object.hasOwn(roles,role))
      throw Error('INVALID_DEVICE');
    const id=crypto.randomUUID(), token=crypto.randomBytes(32).toString('base64url');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO hub_devices(id,branch_id,name,role,token_hash) VALUES(?,?,?,?,?)')
        .run(id,branchId,name.trim(),role,hash(token));
      audit('administrator','device.issue',id,{name:name.trim(),role});
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
    return {id,token,role}; // Shown once; only the digest is persisted.
  }
  function authenticate(token) {
    if (typeof token!=='string' || token.length>512) return null;
    const device=db.prepare('SELECT id,role FROM hub_devices WHERE branch_id=? AND token_hash=? AND revoked=0')
      .get(branchId,hash(token));
    return device ? {id:device.id,allows:permission=>roles[device.role].has(permission)} : null;
  }
  function revoke(id) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result=db.prepare('UPDATE hub_devices SET revoked=1 WHERE branch_id=? AND id=? AND revoked=0').run(branchId,id);
      if(result.changes) audit('administrator','device.revoke',id);
      db.exec('COMMIT');return result.changes===1;
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  return {issue,authenticate,revoke,audit};
}
module.exports={createDeviceRegistry,roles};
