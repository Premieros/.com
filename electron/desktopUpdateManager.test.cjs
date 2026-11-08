'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const policy = require('./desktop-update-policy.json');
const { createDesktopUpdateManager, policyIsApproved } = require('./desktopUpdateManager.cjs');

const SIGNED_POLICY = {
  enabled:true, channel:'stable',
  provider:{ type:'github', owner:'Premieros', repo:'.com' },
  publisherName:'Premier Verified Signer', minimumBacklogCheck:true,
};

function harness({ approved = true, inspector = async () => ({ safe:true }) } = {}) {
  const updater = new EventEmitter();
  const events = [];
  const app = {
    isPackaged: true,
    quit: () => events.push('quit'),
  };
  updater.checkForUpdates = async () => { events.push('check'); };
  updater.quitAndInstall = (silent, forceRun) =>
    events.push(['install',silent,forceRun]);
  const manager = createDesktopUpdateManager({
    app, updater, inspectSafeExit:inspector, logger:{warn:()=>{}},
    policy:approved ? SIGNED_POLICY : policy, platform:'win32',
    scheduleTimeout: () => 1, scheduleInterval: () => 2,
    clearScheduledTimeout: () => {}, clearScheduledInterval: () => {},
  });
  manager.start();
  const close = () => {
    const event = { defaultPrevented:false,
      preventDefault() { this.defaultPrevented = true; } };
    manager.beforeQuit(event);
    return event;
  };
  return { app,updater,manager,events,close };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('default committed policy fails closed before signing and publisher verification', () => {
  assert.equal(policy.enabled,false);
  assert.equal(policy.publisherName,null);
  assert.equal(policyIsApproved(policy),false);
  assert.equal(policyIsApproved({...SIGNED_POLICY,provider:{type:'github',owner:'Other',repo:'.com'}}),false);
  assert.equal(policyIsApproved({...SIGNED_POLICY,publisherName:''}),false);
  assert.equal(policyIsApproved({...SIGNED_POLICY,minimumBacklogCheck:false}),false);
});
test('updater remains disabled for unsigned, non-windows and unpackaged apps', async () => {
  const blocked = harness({approved:false});
  assert.equal(blocked.manager.status().state,'disabled');
  assert.equal(blocked.manager.status().autoInstallOnExit,false);
  blocked.updater.emit('update-downloaded',{version:'9.9.9'});
  const evt = blocked.close();
  assert.equal(evt.defaultPrevented,false);
  assert.equal(blocked.events.length,0);
});
test('signed release checks download in background without automatically restarting POS', async () => {
  const {updater,manager,events,close} = harness();
  assert.equal(updater.autoDownload,true);
  assert.equal(updater.autoInstallOnAppQuit,false);
  assert.equal(updater.allowPrerelease,false);
  assert.equal(updater.allowDowngrade,false);
  await manager.check();
  assert.deepEqual(events,['check']);
  updater.emit('update-available',{version:'2.0.0'});
  assert.equal(manager.status().state,'downloading');
  assert.equal(manager.status().latestVersion,'2.0.0');
  assert.equal(close().defaultPrevented,false);
  assert.deepEqual(events,['check']);
});
test('verified downloaded update only installs after real exit and clean outbox', async () => {
  const {updater,manager,events,close} = harness({
    inspector:async () => { events.push('checked-local-financial-queue'); return {safe:true}; },
  });
  updater.emit('update-downloaded',{version:'2.0.0'});
  assert.equal(manager.status().downloaded,true);
  assert.equal(manager.status().downloadedVersion,'2.0.0');
  assert.equal(close().defaultPrevented,true);
  await settle();
  assert.deepEqual(events,[
    'checked-local-financial-queue',['install',false,true],
  ]);
});
test('pending sales or printer work never trigger install; real exit still proceeds', async () => {
  const {updater,events,close} = harness({
    inspector:async()=>({safe:false,reason:'PENDING_LOCAL_OPERATIONS'}),
  });
  updater.emit('update-downloaded',{version:'2.0.0'});
  assert.equal(close().defaultPrevented,true);
  await settle();
  assert.deepEqual(events,['quit']);
  assert.equal(close().defaultPrevented,false);
});
test('failed safety inspection must never be treated as clean or prevent exit', async () => {
  const {updater,events,close} = harness({
    inspector:async()=>{throw new Error('IDB_READ_FAILED');},
  });
  updater.emit('update-downloaded',{version:'2.0.0'});
  assert.equal(close().defaultPrevented,true);
  await settle();
  assert.deepEqual(events,['quit']);
});
test('desktop shell maintains X-to-hide and explicit tray Quit distinction', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname,'main.cjs'),'utf8');
  assert.match(main,/mainWindow\.on\('close',[\s\S]*?mainWindow\.hide\(\)/);
  assert.match(main,/Exit Premier OS', click:\s*\(\)\s*=>\s*app\.quit\(\)/);
  assert.match(main,/app\.on\('before-quit'/);
  assert.match(main,/updateManager\?\.beforeQuit\(event\)/);
});
