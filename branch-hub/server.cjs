'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

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
    if (!checkToken(req.headers.authorization)) return send(res, 401, { error: 'UNAUTHORIZED' });
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
    if (pathname === '/api/v1/sync/status' && req.method === 'GET') {
      const row=db.prepare("SELECT count(*) pending FROM sync_outbox WHERE branch_id=? AND status='pending'").get(branchId);
      return send(res,200,{ pending:row.pending, onlineSyncImplemented:false });
    }
    if (pathname === '/api/v1/jobs' && req.method === 'GET') {
      const jobs = db.prepare('SELECT id,kind,status,created_at FROM jobs WHERE branch_id=? ORDER BY created_at DESC LIMIT 100').all(branchId);
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
        db.prepare('INSERT OR IGNORE INTO jobs(id,branch_id,idempotency_key,kind,payload) VALUES(?,?,?,?,?)')
          .run(id, branchId, item.idempotencyKey, item.kind, JSON.stringify(item.payload));
        const job = db.prepare('SELECT id,status FROM jobs WHERE branch_id=? AND idempotency_key=?').get(branchId, item.idempotencyKey);
        return send(res, 202, { job });
      } catch { return send(res, 400, { error: 'INVALID_REQUEST' }); }
    }
    return send(res, 404, { error: 'NOT_FOUND' });
  };
  const server = keyFile && certFile
    ? https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler)
    : http.createServer(handler);
  return { server, db, listen: () => new Promise(resolve => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise(resolve => server.close(() => { db.close(); resolve(); })) };
}
if (require.main === module) {
  const hub = createHub();
  hub.listen().then(addr => console.log('Premier Branch Hub listening on', addr.address, addr.port));
}
module.exports = { createHub };
