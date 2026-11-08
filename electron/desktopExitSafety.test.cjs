'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { openLocalDraftJournal } = require('./localDraftJournal.cjs');
const { inspectDesktopExitSafety, SAFETY_SCRIPT } = require('./desktopExitSafety.cjs');

function mockCodec() {
  const key=randomBytes(32);
  return {
    isEncryptionAvailable:()=>true,
    encryptString(text) {
      const iv=randomBytes(12);
      const cipher=createCipheriv('aes-256-gcm',key,iv);
      const ciphertext=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]);
    },
    decryptString(blob) {
      const iv=blob.subarray(0,12);
      // Deliberately use normal OS-stub-compatible AEAD layout.
      const decipher=createDecipheriv('aes-256-gcm',key,iv);
      decipher.setAuthTag(blob.subarray(12,28));
      return Buffer.concat([decipher.update(blob.subarray(28)),decipher.final()]).toString('utf8');
    },
  };
}
function h({response={safe:true,reason:'LOCAL_OUTBOX_CLEAN'},
  printing=false,url='http://127.0.0.1:43187/login',
  userDir=os.tmpdir(),safeStorage=mockCodec()}={}) {
  const win={
    isDestroyed:()=>false,
    webContents:{getURL:()=>url},
  };
  const queue={hasPending:()=>printing};
  const app={getPath:()=>userDir};
  return {
    run:()=>inspectDesktopExitSafety({
      mainWindow:win,localAppUrl:'http://127.0.0.1:43187/',
      printerQueue:queue,app,safeStorage,execute:async()=>response,
    }),
    win,queue,app,safeStorage,
  };
}
test('update checks must be read-only, required IndexedDB stores all present',()=>{
  assert.match(SAFETY_SCRIPT,/indexedDB\.databases\(\)/);
  assert.match(SAFETY_SCRIPT,/sales_queue/);
  assert.match(SAFETY_SCRIPT,/orders_queue/);
  assert.match(SAFETY_SCRIPT,/outbox_operations/);
  assert.match(SAFETY_SCRIPT,/local_stock_movements/);
  assert.match(SAFETY_SCRIPT,/transaction\(names,'readonly'\)/);
  assert.match(SAFETY_SCRIPT,/synced !== true/);
  assert.doesNotMatch(SAFETY_SCRIPT,/\.clear\(|\.delete\(|\.put\(/);
});
test('clean local data without drafts or pending prints allows verified installer',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-update-safety-'));
  try {
    assert.deepEqual(await h({userDir:dir}).run(),{
      safe:true,reason:'LOCAL_DATA_IDLE',
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('pending print work blocks update even if the app appears idle',async()=>{
  assert.deepEqual(await h({printing:true}).run(),{
    safe:false,reason:'PRINT_QUEUE_NOT_IDLE',
  });
});
test('pending sales, corrupt browser storage and untrusted origin block update',async()=>{
  assert.deepEqual(await h({response:{safe:false,reason:'PENDING_LOCAL_OPERATIONS'}}).run(),{
    safe:false,reason:'PENDING_LOCAL_OPERATIONS',
  });
  assert.deepEqual(await h({response:null}).run(),{
    safe:false,reason:'LOCAL_OUTBOX_NOT_SAFE',
  });
  assert.deepEqual(await h({url:'https://attacker.example/login'}).run(),{
    safe:false,reason:'LOCAL_WINDOW_ORIGIN_UNTRUSTED',
  });
});
test('encrypted SQLite drafts block automatic install until independently reconciled',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-update-safety-'));
  try {
    const codec=mockCodec();
    const file=path.join(dir,'draft-journal-v1.sqlite');
    const journal=openLocalDraftJournal({filename:file,codec});
    journal.stage({
      orgId:'org',branchId:'branch',operatorId:'cashier',
      deviceId:'device',warehouseId:'wh',kind:'sale',
      documentKey:'INV-OFF-1',operationKey:'payment-1',
      payload:{total:100},
    });
    journal.close();
    const check=h({userDir:dir,safeStorage:codec});
    assert.deepEqual(await check.run(),{
      safe:false,reason:'PENDING_LOCAL_DRAFTS',
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('unknown OS encryption key blocks install on an existing local draft DB',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-update-safety-'));
  try {
    const codec=mockCodec();
    const file=path.join(dir,'draft-journal-v1.sqlite');
    openLocalDraftJournal({filename:file,codec}).close();
    assert.deepEqual(await h({
      userDir:dir,safeStorage:{isEncryptionAvailable:()=>false},
    }).run(),{safe:false,reason:'LOCAL_DRAFT_ENCRYPTION_UNAVAILABLE'});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
