'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { validateRecoveryDatabase } = require('./recovery-validation.cjs');
const { createPrintWorker } = require('./print-worker.cjs');
const { createDeviceRegistry } = require('./devices.cjs');
const { createOfflineSalesEngine } = require('./offline-sales.cjs');

function createHub(config = {}) {
  const host = config.host || process.env.BRANCH_HUB_HOST || '127.0.0.1';
  const port = Number(config.port ?? process.env.BRANCH_HUB_PORT ?? 3847);
  const keyFile = config.tlsKey || process.env.BRANCH_HUB_TLS_KEY;
  const certFile = config.tlsCert || process.env.BRANCH_HUB_TLS_CERT;
  const token = config.token || process.env.BRANCH_HUB_TOKEN;
  const branchId = config.branchId || process.env.BRANCH_HUB_BRANCH_ID;
  const organizationId = config.organizationId || process.env.BRANCH_HUB_ORGANIZATION_ID;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('INVALID_PORT');
  if (!branchId || !/^[a-zA-Z0-9_-]{3,80}$/.test(branchId)) throw Error('BRANCH_ID_REQUIRED');
  if (!token || token.length < 32) throw Error('SECURE_BRANCH_TOKEN_REQUIRED');
  if (!organizationId || !/^[a-zA-Z0-9_-]{3,80}$/.test(organizationId)) throw Error('ORGANIZATION_ID_REQUIRED');
  // A LAN port MUST be encrypted. Plain HTTP is loopback-only for developer diagnostics.
  if (host !== '127.0.0.1' && host !== '::1' && (!keyFile || !certFile)) {
    throw Error('LAN_REQUIRES_TLS_CERTIFICATE');
  }
  if (Boolean(keyFile) !== Boolean(certFile)) throw Error('TLS_KEY_AND_CERT_REQUIRED');
  const dir = config.dataDir || process.env.BRANCH_HUB_DATA_DIR ||
    path.join(process.env.APPDATA || path.join(os.homedir(), '.premieros'), 'PremierOS', 'BranchHub', branchId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dir, 'branch-hub.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS hub_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), organization_id TEXT NOT NULL, branch_id TEXT NOT NULL, installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const identity = db.prepare('SELECT organization_id, branch_id FROM hub_identity WHERE singleton=1').get();
  if (identity && (identity.branch_id !== branchId || identity.organization_id !== organizationId)) {
    db.close();
    throw Error('BRANCH_BINDING_MISMATCH: existing local database belongs to another branch or organization');
  }
  if (!identity) db.prepare('INSERT INTO hub_identity(singleton, organization_id, branch_id) VALUES(1,?,?)').run(organizationId,branchId);
  db.exec(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('print')),
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(branch_id, idempotency_key)
  );`);
  // Persist operator-approved receipts independently of the cloud and survive process restarts.
  db.exec(`CREATE TABLE IF NOT EXISTS local_receipts (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    total_minor INTEGER NOT NULL CHECK(total_minor >= 0),
    currency TEXT NOT NULL CHECK(length(currency)=3),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(branch_id, idempotency_key)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS sync_outbox (
    event_id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  const printerConfig = config.printers || {};
  const printWorker = createPrintWorker(db, branchId, printerConfig);
  if (Object.keys(printerConfig).length) printWorker.start();
  const devices = createDeviceRegistry(db, branchId);
  const offlineSales = createOfflineSalesEngine(db, branchId);
  // SQLite VACUUM INTO creates a consistent snapshot even while WAL is enabled.
  // Backups stay on the server, never returned by the HTTP API.
  function createLocalBackup() {
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const filename = 'branch-' + new Date().toISOString().replace(/[:.]/g, '-') +
      '-' + crypto.randomUUID() + '.sqlite';
    const destination = path.join(backupDir, filename);
    db.exec('VACUUM INTO ' + "'" + destination.replaceAll("'", "''") + "'");
    try {
      const check = new DatabaseSync(destination, { readOnly: true });
      try {
        validateRecoveryDatabase(check, organizationId, branchId);
        fs.chmodSync(destination, 0o600);
        const fd = fs.openSync(destination, 'r');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } finally { check.close(); }
    } catch (error) { fs.rmSync(destination, { force:true }); throw error; }
    return { filename, bytes:fs.statSync(destination).size };
  }
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const checkToken = (value) => {
    const candidate = String(value || '').replace(/^Bearer /i, '');
    const a = Buffer.from(candidate), b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const handler = async (req, res) => {
    const pathname = new URL(req.url || '/', 'https://branch.local').pathname;
    if (pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'premier-branch-hub', version: 1 });
    const bearer = String(req.headers.authorization || '').replace(/^Bearer /i, '');
    const principal = checkToken(req.headers.authorization)
      ? {id:'administrator',admin:true,allows:()=>true} : devices.authenticate(bearer);
    if (!principal) return send(res, 401, { error: 'UNAUTHORIZED' });
    const adminPath = pathname.startsWith('/api/v1/devices') || pathname === '/api/v1/audit' ||
      pathname === '/api/v1/backups' || pathname === '/api/v1/jobs' && req.method === 'POST' || pathname.endsWith('/retry') || pathname === '/api/v1/offline/stock/opening';
    const permission = req.method === 'GET' ? 'read' :
      pathname === '/api/v1/offline/sales' ? 'sell' :
      pathname.startsWith('/api/v1/offline/sales/') && pathname.endsWith('/print') ? 'print' : 'admin';
    if ((adminPath && !principal.admin) || (permission === 'admin' && !principal.admin) ||
        (permission !== 'admin' && !principal.allows(permission))) return send(res,403,{error:'FORBIDDEN'});
    if (pathname.startsWith('/api/v1/offline/sales/') && pathname.endsWith('/print') && req.method === 'POST') {
      const saleId=pathname.slice('/api/v1/offline/sales/'.length,-'/print'.length);
      const sale=db.prepare('SELECT id,total_minor FROM offline_sales WHERE branch_id=? AND id=?').get(branchId,saleId);
      if(!sale)return send(res,404,{error:'SALE_NOT_FOUND'});
      try {
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(res,413,{error:'PAYLOAD_TOO_LARGE'});}
        const input=JSON.parse(raw);
        if(!Object.hasOwn(printerConfig,input.printerId))return send(res,400,{error:'PRINTER_NOT_CONFIGURED'});
        const lines=db.prepare('SELECT sku,quantity,price_minor FROM offline_sale_lines WHERE sale_id=? ORDER BY rowid').all(saleId);
        const text=['Premier', 'Sale: '+sale.id, ...lines.map(l=>`${l.sku} x ${l.quantity} @ ${l.price_minor}`), 'Total (minor units): '+sale.total_minor].join('\n');
        const payload=JSON.stringify({printerId:input.printerId,text});
        const key='sale-receipt:'+saleId;
        db.exec('BEGIN IMMEDIATE');
        let job;
        try {
          const id=crypto.randomUUID();
          const result=db.prepare("INSERT OR IGNORE INTO jobs(id,branch_id,idempotency_key,kind,payload) VALUES(?,?,?,'print',?)").run(id,branchId,key,payload);
          job=db.prepare('SELECT id,payload FROM jobs WHERE branch_id=? AND idempotency_key=?').get(branchId,key);
          if(job.payload!==payload)throw Error('IDEMPOTENCY_CONFLICT');
          if(result.changes)devices.audit(principal.id,'print.enqueue',job.id,{saleId});
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        return send(res,202,{jobId:job.id});
      }catch(e){return send(res,e.message==='IDEMPOTENCY_CONFLICT'?409:400,{error:'PRINT_REQUEST_REJECTED'});}
    }
    if (pathname.startsWith('/api/v1/jobs/') && pathname.endsWith('/retry') && req.method === 'POST') {
      const id=pathname.slice('/api/v1/jobs/'.length,-'/retry'.length);
      return send(res,printWorker.retryFailed(id)?200:409,{jobId:id});
    }
    if (pathname === '/api/v1/audit' && req.method === 'GET') {
      return send(res,200,{events:db.prepare('SELECT actor,action,entity_id,details,created_at FROM hub_audit WHERE branch_id=? ORDER BY rowid DESC LIMIT 200').all(branchId)});
    }
    if (pathname === '/api/v1/devices' && req.method === 'GET') {
      return send(res,200,{devices:db.prepare('SELECT id,name,role,revoked,created_at FROM hub_devices WHERE branch_id=? ORDER BY rowid').all(branchId)});
    }
    if (pathname.startsWith('/api/v1/devices/') && req.method === 'DELETE') {
      return send(res,devices.revoke(pathname.slice('/api/v1/devices/'.length))?200:404,{ok:true});
    }
    if (pathname === '/api/v1/backups' && req.method === 'POST') {
      try { return send(res,201,createLocalBackup()); }
      catch { return send(res,500,{error:'BACKUP_FAILED'}); }
    }
    if ((pathname === '/api/v1/devices' || pathname === '/api/v1/offline/stock/opening') && req.method === 'POST') {
      try {
        let raw='';
        for await(const chunk of req) {raw+=chunk;if(Buffer.byteLength(raw)>65536)return send(res,413,{error:'PAYLOAD_TOO_LARGE'});}
        const input=JSON.parse(raw);
        if(input.organizationId!==organizationId || input.branchId!==branchId) return send(res,403,{error:'BRANCH_SCOPE_MISMATCH'});
        if(pathname === '/api/v1/devices') return send(res,201,devices.issue(input));
        offlineSales.setOpeningStock(input.sku,input.quantity,input.unitCostMinor,principal.id);
        return send(res,201,{ok:true});
      } catch { return send(res,400,{error:'INVALID_REQUEST'}); }
    }
    if (pathname === '/api/v1/offline/journal' && req.method === 'GET') {
      return send(res,200,{entries:db.prepare(`SELECT j.*,s.created_at FROM offline_journal j
        JOIN offline_sales s ON s.id=j.sale_id WHERE s.branch_id=? ORDER BY s.rowid DESC,j.rowid LIMIT 500`).all(branchId)});
    }
    if (pathname === '/api/v1/offline/sync/pending' && req.method === 'GET') {
      // Local offline-sale outbox is read-only until a verified, idempotent cloud ACK protocol exists.
      const events=db.prepare("SELECT event_id,sale_id,payload FROM offline_outbox WHERE branch_id=? AND status='pending' ORDER BY rowid LIMIT 100").all(branchId);
      return send(res,200,{events:events.map(e=>({eventId:e.event_id,saleId:e.sale_id,payload:JSON.parse(e.payload)})),cloudAcknowledgementImplemented:false});
    }
    if (pathname === '/api/v1/offline/sync/status' && req.method === 'GET') {
      const pending=db.prepare("SELECT count(*) AS n FROM offline_outbox WHERE branch_id=? AND status='pending'").get(branchId).n;
      return send(res,200,{pending,onlineSyncImplemented:false});
    }
    if (pathname === '/api/v1/offline/stock' && req.method === 'GET') {
      const stock=db.prepare('SELECT sku,quantity,unit_cost_minor FROM offline_stock WHERE branch_id=? ORDER BY sku LIMIT 500').all(branchId);
      return send(res,200,{stock});
    }
    if (pathname === '/api/v1/offline/stock/movements' && req.method === 'GET') {
      const movements=db.prepare('SELECT id,sku,sale_id,delta,balance_after,created_at FROM offline_stock_movements WHERE branch_id=? ORDER BY created_at DESC,id DESC LIMIT 200').all(branchId);
      return send(res,200,{movements});
    }
    if (pathname === '/api/v1/offline/sales' && req.method === 'GET') {
      const sales=db.prepare('SELECT id,total_minor,created_at FROM offline_sales WHERE branch_id=? ORDER BY created_at DESC LIMIT 100').all(branchId);
      return send(res,200,{sales});
    }
    if (pathname === '/api/v1/offline/sales' && req.method === 'POST') {
      let body='';
      try {
        for await (const chunk of req) {
          body+=chunk;
          if (Buffer.byteLength(body)>65536) return send(res,413,{error:'PAYLOAD_TOO_LARGE'});
        }
        const input=JSON.parse(body);
        if(input.organizationId!==organizationId || input.branchId!==branchId)
          return send(res,403,{error:'BRANCH_SCOPE_MISMATCH'});
        const result=offlineSales.commitSale({...input,actor:principal.id});
        return send(res,result.duplicate?200:201,result);
      } catch(error) {
        if(error.message==='IDEMPOTENCY_CONFLICT') return send(res,409,{error:error.message});
        if(error.message.startsWith('INSUFFICIENT_STOCK')) return send(res,409,{error:error.message});
        return send(res,400,{error:'INVALID_SALE'});
      }
    }
    if (pathname === '/api/v1/receipts' && req.method === 'GET') {
      const receipts = db.prepare('SELECT id,device_id,total_minor,currency,created_at FROM local_receipts WHERE branch_id=? ORDER BY created_at DESC LIMIT 100').all(branchId);
      return send(res, 200, { receipts });
    }
    if (pathname === '/api/v1/receipts' && req.method === 'POST') {
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 65536) return send(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
        }
        const item = JSON.parse(body);
        if (item.organizationId !== organizationId || item.branchId !== branchId) return send(res, 403, { error: 'BRANCH_SCOPE_MISMATCH' });
        if (!/^[a-zA-Z0-9_-]{3,80}$/.test(item.deviceId || '') ||
          typeof item.idempotencyKey !== 'string' || item.idempotencyKey.length < 8 || item.idempotencyKey.length > 160 ||
          !Number.isSafeInteger(item.totalMinor) || item.totalMinor < 0 ||
          typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency) ||
          !item.receipt || typeof item.receipt !== 'object' || Array.isArray(item.receipt)) {
          return send(res, 400, { error: 'INVALID_RECEIPT' });
        }
        const canonical = JSON.stringify({deviceId:item.deviceId,totalMinor:item.totalMinor,currency:item.currency,receipt:item.receipt});
        const id = crypto.randomUUID();
        let stored;
        let inserted = false;
        // The uniqueness check and outbox write must share a transaction.
        // Two LAN devices can retry the same receipt concurrently.
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = db.prepare('INSERT OR IGNORE INTO local_receipts(id,branch_id,device_id,idempotency_key,total_minor,currency,body) VALUES(?,?,?,?,?,?,?)')
            .run(id,branchId,item.deviceId,item.idempotencyKey,item.totalMinor,item.currency,canonical);
          inserted = result.changes === 1;
          stored = db.prepare('SELECT id,body FROM local_receipts WHERE branch_id=? AND idempotency_key=?').get(branchId,item.idempotencyKey);
          if (inserted) {
            db.prepare('INSERT INTO sync_outbox(event_id,branch_id,entity_type,entity_id,payload) VALUES(?,?,?,?,?)')
              .run(stored.id,branchId,'receipt',stored.id,canonical);
          }
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        if (stored.body !== canonical) return send(res, 409, { error: 'IDEMPOTENCY_CONFLICT' });
        return send(res, inserted ? 201 : 200, { receiptId:stored.id, duplicated:!inserted, queuedForSync:true });
      } catch { return send(res, 400, { error: 'INVALID_REQUEST' }); }
    }
    if (pathname === '/api/v1/sync/pending' && req.method === 'GET') {
      // Read-only staging: no acknowledgement until cloud reconciliation exists.
      const events = db.prepare("SELECT event_id,entity_type,entity_id,payload,created_at FROM sync_outbox WHERE branch_id=? AND status='pending' ORDER BY created_at,event_id LIMIT 100").all(branchId);
      return send(res,200,{ events: events.map(e=>({...e,payload:JSON.parse(e.payload)})), cloudAcknowledgementImplemented:false });
    }
    if (pathname === '/api/v1/integrity' && req.method === 'GET') {
      const integrity = db.prepare('PRAGMA quick_check').all();
      const orphaned = db.prepare("SELECT count(*) AS count FROM local_receipts r LEFT JOIN sync_outbox o ON o.event_id=r.id AND o.branch_id=r.branch_id WHERE r.branch_id=? AND o.event_id IS NULL").get(branchId).count;
      const counts = db.prepare("SELECT (SELECT count(*) FROM local_receipts WHERE branch_id=?) AS receipts, (SELECT count(*) FROM sync_outbox WHERE branch_id=?) AS outbox").get(branchId,branchId);
      return send(res,200,{ ok:integrity.length===1 && integrity[0].quick_check==='ok' && orphaned===0, orphaned, ...counts });
    }
    if (pathname === '/api/v1/offline/integrity' && req.method === 'GET') {
      const check=db.prepare('PRAGMA quick_check').get();
      const missingOutbox=db.prepare("SELECT count(*) AS n FROM offline_sales s LEFT JOIN offline_outbox o ON o.sale_id=s.id AND o.branch_id=s.branch_id WHERE s.branch_id=? AND o.event_id IS NULL").get(branchId).n;
      const unbalanced=db.prepare("SELECT count(*) AS n FROM (SELECT s.id FROM offline_sales s LEFT JOIN offline_journal j ON j.sale_id=s.id WHERE s.branch_id=? GROUP BY s.id HAVING COALESCE(SUM(j.debit_minor),0) != COALESCE(SUM(j.credit_minor),0) OR COUNT(j.sale_id)=0)").get(branchId).n;
      const missingMovements=db.prepare("SELECT count(*) AS n FROM offline_sale_lines l JOIN offline_sales s ON s.id=l.sale_id LEFT JOIN offline_stock_movements m ON m.sale_id=l.sale_id AND m.sku=l.sku AND m.branch_id=s.branch_id WHERE s.branch_id=? AND (m.id IS NULL OR m.delta != -l.quantity)").get(branchId).n;
      return send(res,200,{ok:check.quick_check==='ok' && missingOutbox===0 && unbalanced===0 && missingMovements===0,missingOutbox,unbalanced,missingMovements});
    }
    if (pathname === '/api/v1/sync/status' && req.method === 'GET') {
      const row=db.prepare("SELECT count(*) pending FROM sync_outbox WHERE branch_id=? AND status='pending'").get(branchId);
      return send(res,200,{ pending:row.pending, onlineSyncImplemented:false });
    }
    if (pathname === '/api/v1/jobs' && req.method === 'GET') {
      const jobs = db.prepare(`SELECT j.id,j.kind,j.status,j.created_at,d.state AS delivery_state,d.error,d.attempts FROM jobs j LEFT JOIN print_dispatches d ON d.job_id=j.id WHERE j.branch_id=? ORDER BY j.rowid DESC LIMIT 100`).all(branchId);
      return send(res, 200, { jobs });
    }
    if (pathname === '/api/v1/jobs' && req.method === 'POST') {
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 65536) return send(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
        }
        const item = JSON.parse(body);
        if (item.branchId !== branchId || item.organizationId !== organizationId) return send(res, 403, { error: 'BRANCH_SCOPE_MISMATCH' });
        if (item.kind !== 'print' || typeof item.idempotencyKey !== 'string' || item.idempotencyKey.length < 8 ||
            item.idempotencyKey.length > 160 || !item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) {
          return send(res, 400, { error: 'INVALID_JOB' });
        }
        const id = crypto.randomUUID();
        const payload = JSON.stringify(item.payload);
        db.prepare('INSERT OR IGNORE INTO jobs(id,branch_id,idempotency_key,kind,payload) VALUES(?,?,?,?,?)')
          .run(id, branchId, item.idempotencyKey, item.kind, payload);
        const job = db.prepare('SELECT id,status,payload FROM jobs WHERE branch_id=? AND idempotency_key=?').get(branchId, item.idempotencyKey);
        if (job.payload !== payload) return send(res,409,{ error:'IDEMPOTENCY_CONFLICT' });
        return send(res, 202, { job: {id:job.id,status:job.status} });
      } catch { return send(res, 400, { error: 'INVALID_REQUEST' }); }
    }
    return send(res, 404, { error: 'NOT_FOUND' });
  };
  const server = keyFile && certFile
    ? https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler)
    : http.createServer(handler);
  return { server, db, createLocalBackup, printWorker, listen: () => new Promise(resolve => server.listen(port, host, () => resolve(server.address()))),
    close: async () => { await printWorker.stop(); return new Promise(resolve => server.close(() => { db.close(); resolve(); })); } };
}
if (require.main === module) {
  const hub = createHub();
  hub.listen().then(addr => console.log('Premier Branch Hub listening on', addr.address, addr.port));
}
module.exports = { createHub };
