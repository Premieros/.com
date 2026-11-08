'use strict';
// Isolated Windows draft journal: NOT a replacement for the live POS outbox.
// No posted accounting, no financial confirmations, no cloud upload.
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TYPES = Object.freeze(['sale','return','hold_order','kitchen_ticket',
  'purchase_receipt','stock_movement','manufacture','expense','journal_draft']);
function required(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    throw new Error('LOCAL_DRAFT_' + label + '_REQUIRED');
  return value.trim();
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const scopedHash = (org, branch, key) => hash(JSON.stringify([org, branch, key]));
function ensureCodec(codec) {
  if (!codec || typeof codec.encryptString !== 'function' ||
      typeof codec.decryptString !== 'function' ||
      (typeof codec.isEncryptionAvailable === 'function' && !codec.isEncryptionAvailable()))
    throw new Error('LOCAL_DRAFT_OS_ENCRYPTION_REQUIRED');
}
function decrypt(codec, row) {
  const json = codec.decryptString(Buffer.from(row.encrypted_payload));
  if (typeof json !== 'string' || hash(json) !== row.payload_hash)
    throw new Error('LOCAL_DRAFT_PAYLOAD_INTEGRITY_FAILED');
  return JSON.parse(json);
}
function openLocalDraftJournal({ filename, codec, clock = () => new Date().toISOString() }) {
  required(filename,'FILENAME');
  ensureCodec(codec);
  if (!path.isAbsolute(filename) || path.extname(filename) !== '.sqlite')
    throw new Error('LOCAL_DRAFT_ABSOLUTE_SQLITE_PATH_REQUIRED');
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  try {
    db.exec([
      'PRAGMA journal_mode=WAL',
      'PRAGMA synchronous=FULL',
      'PRAGMA foreign_keys=ON',
      'CREATE TABLE IF NOT EXISTS local_drafts (' +
        'seq INTEGER PRIMARY KEY AUTOINCREMENT,' +
        'local_id TEXT NOT NULL UNIQUE,' +
        'org_id TEXT NOT NULL,branch_id TEXT NOT NULL,operator_id TEXT NOT NULL,' +
        'device_id TEXT NOT NULL,warehouse_id TEXT,kind TEXT NOT NULL,' +
        'document_hash TEXT NOT NULL,idempotency_hash TEXT NOT NULL,' +
        'payload_hash TEXT NOT NULL,encrypted_payload BLOB NOT NULL,' +
        "state TEXT NOT NULL DEFAULT 'LOCAL_PENDING' " +
        "CHECK(state IN ('LOCAL_PENDING','NEEDS_REVIEW'))," +
        'created_at TEXT NOT NULL,' +
        'UNIQUE(org_id,branch_id,document_hash),' +
        'UNIQUE(org_id,branch_id,idempotency_hash))',
      'CREATE INDEX IF NOT EXISTS local_draft_owner ON ' +
        'local_drafts(org_id,branch_id,operator_id,state,seq)',
    ].join(';') + ';');
    const result = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(result)[0] !== 'ok') throw new Error('LOCAL_DRAFT_CORRUPT_DB');
    try { fs.chmodSync(filename,0o600); } catch { /* Windows ACLs are OS-managed */ }
  } catch (error) { db.close(); throw error; }

  function stage(input) {
    if (!input || typeof input !== 'object') throw new Error('LOCAL_DRAFT_INPUT_REQUIRED');
    const org = required(input.orgId,'ORG');
    const branch = required(input.branchId,'BRANCH');
    const operator = required(input.operatorId,'OPERATOR');
    const device = required(input.deviceId,'DEVICE');
    const document = required(input.documentKey,'DOCUMENT_KEY');
    const operation = required(input.operationKey,'OPERATION_KEY');
    const warehouse = input.warehouseId == null ? null : required(input.warehouseId,'WAREHOUSE');
    if (!TYPES.includes(input.kind)) throw new Error('LOCAL_DRAFT_KIND_UNSUPPORTED');
    if (['sale','return','purchase_receipt','stock_movement','manufacture']
      .includes(input.kind) && !warehouse) throw new Error('LOCAL_DRAFT_WAREHOUSE_REQUIRED');
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload))
      throw new Error('LOCAL_DRAFT_PAYLOAD_REQUIRED');
    const serialized = JSON.stringify(input.payload);
    if (!serialized || Buffer.byteLength(serialized) > 1048576)
      throw new Error('LOCAL_DRAFT_PAYLOAD_SIZE_INVALID');
    const payloadHash = hash(serialized);
    const documentHash = scopedHash(org,branch,document);
    const operationHash = scopedHash(org,branch,operation);
    const prior = db.prepare('SELECT * FROM local_drafts WHERE org_id=? AND branch_id=? ' +
      'AND (document_hash=? OR idempotency_hash=?)')
      .all(org,branch,documentHash,operationHash);
    if (prior.length > 0) {
      if (prior.length !== 1 || prior[0].document_hash !== documentHash ||
          prior[0].idempotency_hash !== operationHash ||
          prior[0].payload_hash !== payloadHash ||
          prior[0].device_id !== device || prior[0].operator_id !== operator ||
          prior[0].kind !== input.kind || prior[0].warehouse_id !== warehouse)
        throw new Error('LOCAL_DRAFT_KEY_CONFLICT');
      return { localId: prior[0].local_id, sequence: prior[0].seq,
        state: prior[0].state, replayed: true };
    }
    const ciphertext = codec.encryptString(serialized);
    if (!Buffer.isBuffer(ciphertext) || !ciphertext.length)
      throw new Error('LOCAL_DRAFT_ENCRYPTION_FAILED');
    const localId = randomUUID();
    let txOpen = false;
    try {
      db.exec('BEGIN IMMEDIATE'); txOpen = true;
      const inserted = db.prepare('INSERT INTO local_drafts ' +
        '(local_id,org_id,branch_id,operator_id,device_id,warehouse_id,' +
        'kind,document_hash,idempotency_hash,payload_hash,encrypted_payload,state,created_at) ' +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,'LOCAL_PENDING',?)").run(
        localId,org,branch,operator,device,warehouse,input.kind,
        documentHash,operationHash,payloadHash,ciphertext,clock(),
      );
      db.exec('COMMIT'); txOpen = false;
      return { localId,sequence:Number(inserted.lastInsertRowid),
        state:'LOCAL_PENDING',replayed:false };
    } catch (error) {
      if (txOpen) db.exec('ROLLBACK');
      throw error;
    }
  }
  function list({ orgId,branchId,operatorId }) {
    return db.prepare('SELECT local_id AS localId,seq AS sequence,kind,state,' +
      'created_at AS createdAt FROM local_drafts ' +
      'WHERE org_id=? AND branch_id=? AND operator_id=? ORDER BY seq')
      .all(required(orgId,'ORG'),required(branchId,'BRANCH'),required(operatorId,'OPERATOR'));
  }
  function get({ orgId,branchId,operatorId,localId }) {
    const row = db.prepare('SELECT * FROM local_drafts WHERE ' +
      'local_id=? AND org_id=? AND branch_id=? AND operator_id=?').get(
      required(localId,'LOCAL_ID'),required(orgId,'ORG'),
      required(branchId,'BRANCH'),required(operatorId,'OPERATOR'));
    if (!row) return null;
    return { localId:row.local_id,sequence:row.seq,kind:row.kind,
      state:row.state,payload:decrypt(codec,row) };
  }
  function flagReview({ orgId,branchId,operatorId,localId }) {
    const changed = db.prepare("UPDATE local_drafts SET state='NEEDS_REVIEW' " +
      "WHERE state='LOCAL_PENDING' AND org_id=? AND branch_id=? " +
      'AND operator_id=? AND local_id=?').run(
      required(orgId,'ORG'),required(branchId,'BRANCH'),
      required(operatorId,'OPERATOR'),required(localId,'LOCAL_ID'));
    return changed.changes > 0;
  }
  function verifyIntegrity() {
    const check = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(check)[0] !== 'ok') throw new Error('LOCAL_DRAFT_CORRUPT_DB');
    const records = db.prepare('SELECT encrypted_payload,payload_hash FROM local_drafts').all();
    for (const row of records) decrypt(codec,row);
    return { verifiedDrafts:records.length };
  }
  return Object.freeze({stage,list,get,flagReview,verifyIntegrity,close:()=>db.close()});
}
module.exports = { openLocalDraftJournal, TYPES };
