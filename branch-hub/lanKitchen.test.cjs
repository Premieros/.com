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

test('status idempotency is durable and rejects reuse for another transition',withServer(async({hub,port})=>{
  const {waiter,chef}=credentials(hub);
  const created=await req(port,'POST','/api/v1/lan/orders',order(),waiter);
  const endpoint='/api/v1/lan/orders/'+created.data.order.id+'/status';
  const command={status:'cooking',expectedVersion:1,commandKey:'cook_action_001'};
  assert.equal((await req(port,'POST',endpoint,command,chef)).data.replayed,false);
  const retry=await req(port,'POST',endpoint,command,chef);
  assert.equal(retry.status,200);
  assert.equal(retry.data.replayed,true);
  assert.equal((await req(port,'POST',endpoint,
    {...command,status:'ready'},chef)).status,409);
  assert.equal(hub.db.prepare('SELECT count(*) n FROM lan_kitchen_events').get().n,2);
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
}));

test('untrusted hosts and LAN without TLS remain blocked, including master maintenance API',()=>{
  assert.throws(()=>createHub({host:'0.0.0.0',branchId:'branch_001',
    organizationId:'org_001',token:MASTER}),/LAN_REQUIRES_TLS_CERTIFICATE/);
  const { isLoopbackAddress }=require('./lanKitchen.cjs');
  assert.equal(isLoopbackAddress('10.0.0.12'),false);
  assert.equal(isLoopbackAddress('::ffff:192.168.1.8'),false);
  assert.equal(isLoopbackAddress('127.0.0.1'),true);
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
