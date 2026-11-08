'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHub } = require('./server.cjs');
const MASTER = 'dev-admin-only-secret-not-for-phones-123456789';

function withServer(fn) {
  return async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-lan-kds-'));
    const config={host:'127.0.0.1',port:0,branchId:'branch_001',
      organizationId:'org_001',token:MASTER,dataDir:dir};
    let hub=createHub(config);
    try {
      let address=await hub.listen();
      await fn({
        get hub(){return hub;},
        get port(){return address.port;},
        restart:async()=>{
          const currentPort=address.port;
          await hub.close();
          hub=createHub({...config,port:currentPort});
          address=await hub.listen();
          return hub;
        },
      });
    } finally {
      if(hub)await hub.close();
      fs.rmSync(dir,{recursive:true,force:true});
    }
  };
}
function req(port,method,pathname,payload,credential,headers={}) {
  return new Promise((resolve,reject)=>{
    const request=http.request({
      hostname:'127.0.0.1',port,path:pathname,method,agent:false,
      headers:{
        ...(credential?{authorization:'Bearer '+credential}:{}),
        ...(payload?{'content-type':'application/json'}:{}),
        ...headers,
      },
    },res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        const body=Buffer.concat(chunks).toString('utf8');
        let data;
        try {data=JSON.parse(body);}catch {data=body;}
        resolve({status:res.statusCode,data,headers:res.headers});
      });
    });
    request.on('error',reject);
    request.end(payload?JSON.stringify(payload):undefined);
  });
}
const order=(overrides={})=>({
  organizationId:'org_001',branchId:'branch_001',
  tableCode:'Table 05',stationCode:'hot',
  idempotencyKey:'waiter-order-000001',
  items:[{name:'Pizza',quantity:2},{name:'Soup',quantity:1}],
  ...overrides,
});
const credentials=(hub)=>({
  waiter:hub.provisionLanDevice({deviceId:'waiter_phone_001',operatorId:'waiter_001',role:'waiter'}).credential,
  chef:hub.provisionLanDevice({deviceId:'chef_tablet_001',operatorId:'chef_001',role:'kitchen',stationCode:'hot'}).credential,
  bar:hub.provisionLanDevice({deviceId:'bar_tablet_001',operatorId:'chef_002',role:'kitchen',stationCode:'cold'}).credential,
});

test('mobile UI is served locally without external scripts and APIs require paired device',withServer(async({hub,port})=>{
  const html=await req(port,'GET','/lan');
  assert.equal(html.status,200);
  assert.match(html.data,/الويتر وشاشة المطبخ/);
  assert.match(html.headers['content-security-policy'],/script-src 'self'/);
  assert.equal((await req(port,'GET','/lan/app.js')).status,200);
  assert.equal((await req(port,'GET','/lan/styles.css')).status,200);
  assert.equal((await req(port,'GET','/api/v1/lan/orders')).status,401);
  assert.equal((await req(port,'GET','/api/v1/lan/orders',null,MASTER)).status,401);
  assert.equal((await req(port,'POST','/api/v1/lan/orders',order(),MASTER)).status,401);
  const {waiter}=credentials(hub);
  const profile=await req(port,'GET','/api/v1/lan/profile',null,waiter);
  assert.equal(profile.status,200);
  assert.equal(profile.data.organizationId,'org_001');
  assert.equal(profile.data.role,'waiter');
  assert.equal(profile.data.localOnly,true);
}));

test('waiter order is stored durably and kitchen status becomes visible without WAN',withServer(async({hub,port,restart})=>{
  const {waiter,chef,bar}=credentials(hub);
  const choices=await req(port,'GET','/api/v1/lan/stations',null,waiter);
  assert.equal(choices.status,200);
  assert.deepEqual(choices.data.stations,['cold','hot']);
  assert.deepEqual((await req(port,'GET','/api/v1/lan/stations',null,chef)).data.stations,['hot']);
  assert.equal((await req(port,'POST','/api/v1/lan/orders',
    order({stationCode:'missing_station'}),waiter)).status,409);
  const created=await req(port,'POST','/api/v1/lan/orders',order(),waiter);
  assert.equal(created.status,201);
  assert.equal(created.data.order.localOnly,true);
  assert.equal(created.data.order.cloudSynced,false);
  assert.equal(created.data.order.status,'new');
  const pendingStart=await req(port,'GET','/api/v1/lan/sync-status',null,waiter);
  assert.equal(pendingStart.status,200);
  assert.equal(pendingStart.data.pendingCloudDraftEvents,1);
  assert.equal(pendingStart.data.cloudAcknowledgementImplemented,false);
  assert.equal(pendingStart.data.cloudSynced,false);
  assert.equal(pendingStart.data.mode,'LOCAL_DRAFT_ONLY');
  assert.equal((await req(port,'GET','/api/v1/lan/sync-status',null,bar))
    .data.pendingCloudDraftEvents,0);
  const id=created.data.order.id;
  const retry=await req(port,'POST','/api/v1/lan/orders',order(),waiter);
  assert.equal(retry.status,200);
  assert.equal(retry.data.order.id,id);
  assert.equal(retry.data.replayed,true);
  assert.equal((await req(port,'POST','/api/v1/lan/orders',order({
    items:[{name:'Pizza',quantity:5}],
  }),waiter)).status,409);

  assert.equal((await req(port,'GET','/api/v1/lan/orders',null,bar)).data.orders.length,0);
  const tickets=await req(port,'GET','/api/v1/lan/orders',null,chef);
  assert.equal(tickets.data.orders[0].id,id);
  assert.equal(tickets.data.orders[0].version,1);
  assert.equal((await req(port,'POST','/api/v1/lan/orders/'+id+'/status',
    {status:'cooking',expectedVersion:1,commandKey:'status_00000001'},waiter)).status,403);
  assert.equal((await req(port,'POST','/api/v1/lan/orders/'+id+'/status',
    {status:'cooking',expectedVersion:1,commandKey:'status_00000001'},bar)).status,404);
  const cooking=await req(port,'POST','/api/v1/lan/orders/'+id+'/status',
    {status:'cooking',expectedVersion:1,commandKey:'status_00000001'},chef);
  assert.equal(cooking.status,200);
  assert.equal(cooking.data.order.version,2);
  assert.equal(cooking.data.order.status,'cooking');
  assert.equal((await req(port,'POST','/api/v1/lan/orders/'+id+'/status',
    {status:'ready',expectedVersion:1,commandKey:'status_00000002'},chef)).status,409);
  const ready=await req(port,'POST','/api/v1/lan/orders/'+id+'/status',
    {status:'ready',expectedVersion:2,commandKey:'status_00000002'},chef);
  assert.equal(ready.status,200);
  assert.equal(ready.data.order.status,'ready');
  assert.equal((await req(port,'GET','/api/v1/lan/sync-status',null,chef))
    .data.pendingCloudDraftEvents,3);

  const afterRestart=await restart();
  assert.ok(afterRestart);
  const waiterView=(await req(port,'GET','/api/v1/lan/orders',null,waiter)).data.orders;
  assert.equal(waiterView.length,1);
  assert.equal(waiterView[0].status,'ready');
  assert.equal(waiterView[0].version,3);
  const served=await req(port,'POST','/api/v1/lan/orders/'+id+'/status',
    {status:'served',expectedVersion:3,commandKey:'status_00000003'},waiter);
  assert.equal(served.status,200);
  assert.equal(served.data.order.status,'served');
  assert.equal(afterRestart.db.prepare('SELECT count(*) n FROM lan_kitchen_orders').get().n,1);
  assert.equal(afterRestart.db.prepare('SELECT count(*) n FROM lan_kitchen_events').get().n,4);
  assert.equal(afterRestart.db.prepare('SELECT count(*) n FROM lan_kitchen_commands').get().n,3);
  assert.equal((await req(port,'GET','/api/v1/lan/sync-status',null,waiter))
    .data.pendingCloudDraftEvents,4);
  assert.equal(afterRestart.revokeLanDevice('chef_tablet_001'),true);
  const replayAfterRevoke=await req(port,'POST','/api/v1/lan/orders',order(),waiter);
  assert.equal(replayAfterRevoke.status,200);
  assert.equal(replayAfterRevoke.data.replayed,true);
  assert.equal((await req(port,'POST','/api/v1/lan/orders',
    order({idempotencyKey:'fresh-order-after-revoke'}),waiter)).status,409);
}));

test('device revoke, cross-branch and cross-origin requests are rejected',withServer(async({hub,port})=>{
  const {waiter,chef}=credentials(hub);
  assert.equal((await req(port,'POST','/api/v1/lan/orders',order({branchId:'other_branch'}),waiter)).status,403);
  assert.equal((await req(port,'POST','/api/v1/lan/orders',order({organizationId:'other_org'}),waiter)).status,403);
  assert.equal((await req(port,'POST','/api/v1/lan/orders',order(),chef)).status,403);
  assert.equal((await req(port,'GET','/api/v1/lan/orders',null,waiter,{
    origin:'https://evil.example',
  })).status,403);
  assert.equal((await req(port,'GET','/api/v1/lan/orders',null,waiter,{
    host:'evil.example',
  })).status,403);
  assert.equal(hub.revokeLanDevice('waiter_phone_001'),true);
  assert.equal((await req(port,'GET','/api/v1/lan/orders',null,waiter)).status,401);
  assert.equal((await req(port,'GET','/api/v1/lan/profile',null,chef)).status,200);
}));

test('repeated invalid device keys are throttled but valid paired staff remain operational',withServer(async({hub,port})=>{
  const {waiter}=credentials(hub);
  for(let i=0;i<25;i++){
    const response=await req(port,'GET','/api/v1/lan/profile',null,'incorrect-dev-credential');
    assert.equal(response.status,401);
  }
  const throttled=await req(port,'GET','/api/v1/lan/profile',null,'incorrect-dev-credential');
  assert.equal(throttled.status,429);
  assert.equal(throttled.data.error,'LAN_AUTH_RATE_LIMITED');
  const valid=await req(port,'GET','/api/v1/lan/profile',null,waiter);
  assert.equal(valid.status,200);
  assert.equal(valid.data.role,'waiter');
}));

test('status idempotency is durable and rejects reuse for another transition',withServer(async({hub,port})=>{
  const {waiter,chef}=credentials(hub);
  const created=await req(port,'POST','/api/v1/lan/orders',order(),waiter);
  const endpoint='/api/v1/lan/orders/'+created.data.order.id+'/status';
  const command={status:'cooking',expectedVersion:1,commandKey:'cook_action_001'};
  assert.equal((await req(port,'POST',endpoint,command,chef)).data.replayed,false);
  const retry=await req(port,'POST',endpoint,command,chef);
  assert.equal(retry.status,200);
  assert.equal(retry.data.replayed,true);
  assert.equal(retry.data.committedVersion,2);
  assert.equal((await req(port,'POST',endpoint,
    {...command,expectedVersion:2},chef)).status,409);
  assert.equal((await req(port,'POST',endpoint,
    {...command,status:'ready'},chef)).status,409);
  const newer=await req(port,'POST',endpoint,
    {status:'ready',expectedVersion:2,commandKey:'cook_action_002'},chef);
  assert.equal(newer.status,200);
  const lateRetry=await req(port,'POST',endpoint,command,chef);
  assert.equal(lateRetry.status,200);
  assert.equal(lateRetry.data.replayed,true);
  assert.equal(lateRetry.data.committedVersion,2);
  assert.equal(lateRetry.data.order.status,'ready');
  assert.equal(lateRetry.data.order.version,3);
  assert.equal(hub.db.prepare('SELECT count(*) n FROM lan_kitchen_events').get().n,3);
}));

test('SSE replays only station-allowed durable events with monotonically increasing IDs',withServer(async({hub,port})=>{
  const {waiter,chef,bar}=credentials(hub);
  await req(port,'POST','/api/v1/lan/orders',order(),waiter);
  const first=await fetch('http://127.0.0.1:'+port+'/api/v1/lan/events?after=0',{
    headers:{authorization:'Bearer '+chef},signal:AbortSignal.timeout(3500),
  });
  assert.equal(first.status,200);
  assert.match(first.headers.get('content-type'),/text\/event-stream/);
  const reader=first.body.getReader();
  let chunk='',found=false;
  for(let i=0;i<4;i++){
    const x=await reader.read();if(x.done)break;
    chunk+=Buffer.from(x.value).toString('utf8');
    if(chunk.includes('event: order-created')){found=true;break;}
  }
  assert.equal(found,true);
  assert.match(chunk,/id: 1/);
  await reader.cancel();
  const second=await fetch('http://127.0.0.1:'+port+'/api/v1/lan/events?after=0',{
    headers:{authorization:'Bearer '+bar},signal:AbortSignal.timeout(3500),
  });
  const br=second.body.getReader();
  const val=Buffer.from((await br.read()).value).toString('utf8');
  assert.ok(val.includes(': connected'));
  assert.doesNotMatch(val,/event: order-created/);
  await br.cancel();

  const pastEnd=await fetch('http://127.0.0.1:'+port+'/api/v1/lan/events?after=9999',{
    headers:{authorization:'Bearer '+chef},signal:AbortSignal.timeout(3500),
  });
  assert.equal(pastEnd.status,200);
  const resetReader=pastEnd.body.getReader();
  let resetPayload='';
  for(let i=0;i<4;i++){
    const frame=await resetReader.read();
    if(frame.done)break;
    resetPayload+=Buffer.from(frame.value).toString('utf8');
    if(resetPayload.includes('event: reset-cursor')&&
       resetPayload.includes('event: order-created'))break;
  }
  assert.match(resetPayload,/event: reset-cursor/);
  assert.match(resetPayload,/event: order-created/);
  await resetReader.cancel();
}));

test('verified backup restores local kitchen orders, stage history and device revocations',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-kds-backup-'));
  const config={host:'127.0.0.1',port:0,branchId:'branch_001',
    organizationId:'org_001',token:MASTER,dataDir:dir};
  let hub=createHub(config);
  try {
    let address=await hub.listen();
    const keys=credentials(hub);
    const created=await req(address.port,'POST','/api/v1/lan/orders',order(),keys.waiter);
    assert.equal(created.status,201);
    const advance=await req(address.port,'POST',
      '/api/v1/lan/orders/'+created.data.order.id+'/status',
      {status:'cooking',expectedVersion:1,commandKey:'cooking_backup_001'},keys.chef);
    assert.equal(advance.status,200);
    assert.equal(hub.revokeLanDevice('bar_tablet_001'),true);
    const snapshot=hub.createLocalBackup();
    const file=path.join(dir,'backups',snapshot.filename);
    assert.ok(snapshot.bytes>0);
    const {DatabaseSync}=require('node:sqlite');
    const backup=new DatabaseSync(file,{readOnly:true});
    try {
      assert.equal(backup.prepare('PRAGMA quick_check').get().quick_check,'ok');
      assert.equal(backup.prepare('SELECT count(*) n FROM lan_kitchen_orders').get().n,1);
      assert.equal(backup.prepare('SELECT count(*) n FROM lan_kitchen_events').get().n,2);
      assert.equal(backup.prepare('SELECT count(*) n FROM lan_kitchen_commands').get().n,1);
      assert.equal(backup.prepare("SELECT active FROM lan_devices WHERE device_id='bar_tablet_001'").get().active,0);
    } finally {backup.close();}
    await hub.close();hub=null;
    // Disaster-recovery drill: the original service is stopped before restore.
    fs.copyFileSync(file,path.join(dir,'branch-hub.sqlite'));
    hub=createHub(config);
    address=await hub.listen();
    assert.equal((await req(address.port,'GET','/api/v1/lan/orders',null,keys.waiter))
      .data.orders[0].status,'cooking');
    assert.equal((await req(address.port,'GET','/api/v1/lan/sync-status',null,keys.waiter))
      .data.pendingCloudDraftEvents,2);
    assert.equal((await req(address.port,'GET','/api/v1/lan/orders',null,keys.bar)).status,401);
  } finally {
    if(hub)await hub.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('untrusted hosts and LAN without TLS remain blocked, including master maintenance API',()=>{
  assert.throws(()=>createHub({host:'0.0.0.0',branchId:'branch_001',
    organizationId:'org_001',token:MASTER}),/LAN_REQUIRES_TLS_CERTIFICATE/);
  const { isLoopbackAddress }=require('./lanKitchen.cjs');
  assert.equal(isLoopbackAddress('10.0.0.12'),false);
  assert.equal(isLoopbackAddress('::ffff:192.168.1.8'),false);
  assert.equal(isLoopbackAddress('127.0.0.1'),true);
});

test('packaged Hub parent receives readiness IPC only after the local port binds',async()=>{
  const {fork}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-hub-ipc-'));
  const child=fork(path.join(__dirname,'server.cjs'),[],{
    execPath:process.execPath,
    env:{
      ...process.env,BRANCH_HUB_HOST:'127.0.0.1',BRANCH_HUB_PORT:'0',
      BRANCH_HUB_BRANCH_ID:'branch_001',BRANCH_HUB_ORGANIZATION_ID:'org_001',
      BRANCH_HUB_TOKEN:MASTER,BRANCH_HUB_DATA_DIR:dir,
    },
    stdio:['ignore','ignore','ignore','ipc'],
  });
  try {
    const message=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('LAN_IPC_READY_TIMEOUT')),6000);
      child.once('exit',code=>{
        clearTimeout(timeout);
        reject(Error('LAN_SERVICE_EXITED_BEFORE_READY_'+code));
      });
      child.once('message',data=>{
        clearTimeout(timeout);
        resolve(data);
      });
      child.once('error',error=>{
        clearTimeout(timeout);
        reject(error);
      });
    });
    assert.equal(message.type,'premier-hub-ready');
    assert.equal(message.host,'127.0.0.1');
    assert.ok(message.port>0);
    assert.equal((await req(message.port,'GET','/health')).status,200);
  } finally {
    const exited=new Promise(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)return resolve();
      child.once('exit',resolve);
    });
    child.kill();
    await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3500))]);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Windows desktop keeps LAN disabled until explicit TLS hostname and certificate configuration',()=>{
  const {resolveLanDeployment}=require('./lanDeploymentConfig.cjs');
  const cert=path.resolve(os.tmpdir(),'premier-local-test-cert.pem');
  const key=path.resolve(os.tmpdir(),'premier-local-test-key.pem');
  assert.equal(resolveLanDeployment({}).enabled,false);
  assert.equal(resolveLanDeployment({lanEnabled:false,lanHostname:'bad'}).host,'127.0.0.1');
  assert.throws(()=>resolveLanDeployment({lanEnabled:true}),/LAN_TRUSTED_HOSTNAME_REQUIRED/);
  assert.throws(()=>resolveLanDeployment({lanEnabled:true,lanHostname:'evil.com'}),
    /LAN_TRUSTED_TLS_FILES_REQUIRED/);
  assert.throws(()=>resolveLanDeployment({lanEnabled:true,lanHostname:'0.0.0.0',
    tlsCert:cert,tlsKey:key}),/LAN_TRUSTED_HOSTNAME_REQUIRED/);
  assert.throws(()=>resolveLanDeployment({lanEnabled:true,lanHostname:'premier-branch.local',
    tlsCert:cert,tlsKey:key,lanPort:80},()=>true),/LAN_PORT_INVALID/);
  const allowed=resolveLanDeployment({lanEnabled:true,lanHostname:'premier-branch.local',
    tlsCert:cert,tlsKey:key,lanPort:3847},()=>true);
  assert.equal(allowed.host,'0.0.0.0');
  assert.equal(allowed.url,'https://premier-branch.local:3847/lan');
});

test('SSE replay drains more than 100 persisted authorized events without a new write',withServer(async({hub,port})=>{
  const {waiter,chef,bar}=credentials(hub);
  const created=await req(port,'POST','/api/v1/lan/orders',order(),waiter);
  assert.equal(created.status,201);
  const id=created.data.order.id;
  // Insert a durable historical event backlog directly. No live notification
  // follows: the reconnecting kitchen must catch up without a fresh order.
  const insert=hub.db.prepare('INSERT INTO lan_kitchen_events'+
    '(branch_id,station_code,creator_device_id,order_id,event_type,data_json)'+
    ' VALUES(?,?,?,?,?,?)');
  for(let i=0;i<250;i++){
    insert.run('branch_001','hot','waiter_phone_001',id,'status-changed',
      JSON.stringify({orderId:id,status:'new',sequence:i,localOnly:true}));
  }
  const response=await fetch('http://127.0.0.1:'+port+'/api/v1/lan/events?after=0',{
    headers:{authorization:'Bearer '+chef},signal:AbortSignal.timeout(7000),
  });
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  let payload='';
  try {
    while(!payload.includes('id: 251\\n')) {
      const frame=await reader.read();
      assert.equal(frame.done,false,'event stream stopped before backlog was replayed');
      payload+=Buffer.from(frame.value).toString('utf8');
    }
    const ids=[...payload.matchAll(/^id: (\\d+)$/gm)].map(m=>Number(m[1]));
    assert.equal(ids.length,251);
    assert.equal(ids[0],1);
    assert.equal(ids.at(-1),251);
    assert.deepEqual(ids,Array.from({length:251},(_,i)=>i+1));
  } finally {await reader.cancel();}
  const isolated=await fetch('http://127.0.0.1:'+port+'/api/v1/lan/events?after=0',{
    headers:{authorization:'Bearer '+bar},signal:AbortSignal.timeout(3000),
  });
  const otherReader=isolated.body.getReader();
  try {
    const first=await otherReader.read();
    assert.equal(Buffer.from(first.value).toString('utf8').includes('id: 1'),false);
  } finally {await otherReader.cancel();}
}));
