'use strict';

/* Pilot waiter/KDS. No sale, payment, inventory, printer or cloud posting. */
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const idValid = (x) => typeof x === 'string' && /^[a-zA-Z0-9_-]{3,80}$/.test(x);
const keyValid = (x) => typeof x === 'string' && x.length >= 8 && x.length <= 160;
const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
function respond(res, code, body) {
  res.writeHead(code, {
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','x-frame-options':'DENY',
    'referrer-policy':'no-referrer',
  });
  res.end(JSON.stringify(body));
}
async function parseBody(req) {
  let chunks=[],size=0;
  for await (const part of req) {
    size+=part.length;
    if(size>32768) { const e=Error('LAN_PAYLOAD_TOO_LARGE');e.status=413;throw e; }
    chunks.push(part);
  }
  try {
    const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw Error();
    return parsed;
  } catch {
    const e=Error('LAN_INVALID_JSON');e.status=400;throw e;
  }
}
function isLoopbackAddress(x) {
  return x==='127.0.0.1'||x==='::1'||(typeof x==='string'&&x.startsWith('::ffff:127.'));
}
function createLanKitchen({db,organizationId,branchId}) {
  const signals=new EventEmitter();
  signals.setMaxListeners(200);
  const streams=new Set();
  db.exec([
    'PRAGMA synchronous=FULL',
    'CREATE TABLE IF NOT EXISTS lan_devices (device_id TEXT PRIMARY KEY,'+
      'organization_id TEXT NOT NULL,branch_id TEXT NOT NULL,'+
      'operator_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('+
      "'waiter','kitchen'"+')),station_code TEXT,token_hash TEXT NOT NULL UNIQUE,'+
      'active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),'+
      "CHECK((role='kitchen' AND station_code IS NOT NULL) OR "+
      "(role='waiter' AND station_code IS NULL)))",
    'CREATE TABLE IF NOT EXISTS lan_kitchen_orders (id TEXT PRIMARY KEY,'+
      'branch_id TEXT NOT NULL,device_id TEXT NOT NULL,operator_id TEXT NOT NULL,'+
      'station_code TEXT NOT NULL,table_code TEXT NOT NULL,'+
      'idempotency_key TEXT NOT NULL,payload_hash TEXT NOT NULL,'+
      'items_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT '+"'new'"+
      " CHECK(status IN ('new','cooking','ready','served')),"+
      'version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
      'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
      'UNIQUE(branch_id,device_id,idempotency_key))',
    'CREATE INDEX IF NOT EXISTS lan_kds_station ON lan_kitchen_orders(branch_id,station_code,status)',
    'CREATE TABLE IF NOT EXISTS lan_kitchen_events ('+
      'seq INTEGER PRIMARY KEY AUTOINCREMENT,branch_id TEXT NOT NULL,'+
      'station_code TEXT NOT NULL,creator_device_id TEXT NOT NULL,'+
      'order_id TEXT NOT NULL,event_type TEXT NOT NULL,data_json TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS lan_kds_event_cursor ON lan_kitchen_events(branch_id,station_code,seq)',
    'CREATE TABLE IF NOT EXISTS lan_kitchen_commands ('+
      'branch_id TEXT NOT NULL,device_id TEXT NOT NULL,command_key TEXT NOT NULL,'+
      'order_id TEXT NOT NULL,intended_status TEXT NOT NULL,result_version INTEGER NOT NULL,'+
      'PRIMARY KEY(branch_id,device_id,command_key))'
  ].join(';')+';');

  function provisionDevice({deviceId,operatorId,role,stationCode=null}) {
    if(!idValid(deviceId)||!idValid(operatorId)||!['waiter','kitchen'].includes(role)||
       (role==='kitchen'&&!idValid(stationCode))||
       (role==='waiter'&&stationCode!==null)) throw Error('LAN_INVALID_DEVICE_ENROLLMENT');
    const secret=crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO lan_devices(device_id,organization_id,branch_id,'+
      'operator_id,role,station_code,token_hash) VALUES(?,?,?,?,?,?,?)').run(
      deviceId,organizationId,branchId,operatorId,role,stationCode,hash(secret));
    // Only a trusted local administrator may call this server-side function.
    // It is deliberately NOT exposed as an unauthenticated HTTP endpoint.
    return {deviceId,role,stationCode,credential:secret};
  }
  function revokeDevice(deviceId) {
    if(!idValid(deviceId)) throw Error('LAN_INVALID_DEVICE_ID');
    const result=db.prepare('UPDATE lan_devices SET active=0 WHERE device_id=? AND branch_id=?')
      .run(deviceId,branchId);
    signals.emit('refresh');
    return result.changes>0;
  }
  function auth(req) {
    const raw=req.headers.authorization;
    if(typeof raw!=='string'||!/^Bearer [A-Za-z0-9_-]{40,100}$/.test(raw)) return null;
    const hashed=hash(raw.slice(7));
    return db.prepare('SELECT device_id,operator_id,role,station_code FROM lan_devices '+
      'WHERE token_hash=? AND organization_id=? AND branch_id=? AND active=1')
      .get(hashed,organizationId,branchId)||null;
  }
  function orderView(row) {
    return {
      id:row.id,tableCode:row.table_code,stationCode:row.station_code,
      items:JSON.parse(row.items_json),status:row.status,version:row.version,
      operatorId:row.operator_id,localOnly:true,cloudSynced:false,
    };
  }
  function eventWrite(order,kind) {
    const payload=JSON.stringify({orderId:order.id,tableCode:order.table_code,
      stationCode:order.station_code,status:order.status,version:order.version,
      localOnly:true});
    const result=db.prepare('INSERT INTO lan_kitchen_events'+
      '(branch_id,station_code,creator_device_id,order_id,event_type,data_json)'+
      ' VALUES(?,?,?,?,?,?)').run(branchId,order.station_code,order.device_id,
        order.id,kind,payload);
    return Number(result.lastInsertRowid);
  }
  function visible(device,order) {
    return device.role==='kitchen' ? order.station_code===device.station_code :
      order.device_id===device.device_id;
  }
  async function handle(req,res,pathname) {
    if(!pathname.startsWith('/api/v1/lan/')) return false;
    const device=auth(req);
    if(!device) {respond(res,401,{error:'LAN_DEVICE_NOT_PAIRED'});return true;}
    if(pathname==='/api/v1/lan/orders'&&req.method==='GET') {
      const rows=db.prepare('SELECT * FROM lan_kitchen_orders WHERE branch_id=? AND '+
        (device.role==='kitchen'?'station_code=?':'device_id=?')+
        ' ORDER BY created_at DESC,id DESC LIMIT 100').all(
        branchId,device.role==='kitchen'?device.station_code:device.device_id);
      respond(res,200,{orders:rows.map(orderView),role:device.role,
        stationCode:device.station_code,offlineBranchOnly:true});
      return true;
    }
    if(pathname==='/api/v1/lan/orders'&&req.method==='POST') {
      if(device.role!=='waiter') {respond(res,403,{error:'LAN_WAITER_REQUIRED'});return true;}
      try {
        const item=await parseBody(req);
        if(item.organizationId!==organizationId||item.branchId!==branchId) {
          respond(res,403,{error:'BRANCH_SCOPE_MISMATCH'});return true;
        }
        if(!idValid(item.stationCode)||!keyValid(item.idempotencyKey)||
          typeof item.tableCode!=='string'|| !/^[a-zA-Z0-9 _-]{1,64}$/.test(item.tableCode)||
          !Array.isArray(item.items)||item.items.length<1||item.items.length>50||
          !item.items.every(line=>line&&typeof line.name==='string'&&
            line.name.trim().length>0&&line.name.length<=120&&
            Number.isInteger(line.quantity)&&line.quantity>=1&&line.quantity<=99)) {
          respond(res,400,{error:'LAN_INVALID_KITCHEN_DRAFT'});return true;
        }
        const items=item.items.map(line=>({name:line.name.trim(),quantity:line.quantity}));
        const payloadHash=hash(JSON.stringify({
          stationCode:item.stationCode,tableCode:item.tableCode,items,
        }));
        const existing=db.prepare('SELECT * FROM lan_kitchen_orders WHERE '+
          'branch_id=? AND device_id=? AND idempotency_key=?')
          .get(branchId,device.device_id,item.idempotencyKey);
        if(existing) {
          if(existing.payload_hash!==payloadHash) {
            respond(res,409,{error:'LAN_ORDER_IDEMPOTENCY_CONFLICT'});return true;
          }
          respond(res,200,{order:orderView(existing),replayed:true});return true;
        }
        let row,seq;
        db.exec('BEGIN IMMEDIATE');
        try {
          const id=crypto.randomUUID();
          db.prepare('INSERT INTO lan_kitchen_orders'+
            '(id,branch_id,device_id,operator_id,station_code,table_code,'+
            'idempotency_key,payload_hash,items_json) VALUES(?,?,?,?,?,?,?,?,?)').run(
            id,branchId,device.device_id,device.operator_id,item.stationCode,
            item.tableCode,item.idempotencyKey,payloadHash,JSON.stringify(items));
          row=db.prepare('SELECT * FROM lan_kitchen_orders WHERE branch_id=? AND id=?')
            .get(branchId,id);
          seq=eventWrite(row,'order-created');
          db.exec('COMMIT');
        } catch(error) {db.exec('ROLLBACK');throw error;}
        signals.emit('event');
        respond(res,201,{order:orderView(row),replayed:false,eventCursor:seq});
      } catch(error) {
        respond(res,error.status||500,
          {error:error.status?error.message:'LAN_LOCAL_ORDER_CAPTURE_FAILED'});
      }
      return true;
    }
    const change=/^\/api\/v1\/lan\/orders\/([0-9a-f-]{36})\/status$/.exec(pathname);
    if(change&&req.method==='POST') {
      try {
        const item=await parseBody(req);
        if(!keyValid(item.commandKey)||!Number.isSafeInteger(item.expectedVersion)||
          item.expectedVersion<1||!['cooking','ready','served'].includes(item.status)) {
          respond(res,400,{error:'LAN_INVALID_STATUS_COMMAND'});return true;
        }
        const order=db.prepare('SELECT * FROM lan_kitchen_orders WHERE branch_id=? AND id=?')
          .get(branchId,change[1]);
        if(!order||!visible(device,order)) {
          respond(res,404,{error:'LAN_ORDER_NOT_FOUND'});return true;
        }
        const duplicate=db.prepare('SELECT * FROM lan_kitchen_commands WHERE '+
          'branch_id=? AND device_id=? AND command_key=?')
          .get(branchId,device.device_id,item.commandKey);
        if(duplicate) {
          if(duplicate.order_id!==order.id||duplicate.intended_status!==item.status) {
            respond(res,409,{error:'LAN_COMMAND_IDEMPOTENCY_CONFLICT'});return true;
          }
          respond(res,200,{order:orderView(order),replayed:true});return true;
        }
        const authorized=device.role==='kitchen' ?
          (order.status==='new'&&item.status==='cooking')||
          (order.status==='cooking'&&item.status==='ready') :
          (order.status==='ready'&&item.status==='served');
        if(!authorized) {
          respond(res,403,{error:'LAN_STATUS_ROLE_OR_TRANSITION_DENIED'});return true;
        }
        if(order.version!==item.expectedVersion) {
          respond(res,409,{error:'LAN_STALE_ORDER_VERSION',currentVersion:order.version});
          return true;
        }
        let updated,seq;
        db.exec('BEGIN IMMEDIATE');
        try {
          const result=db.prepare('UPDATE lan_kitchen_orders SET status=?,'+
            'version=version+1,updated_at=CURRENT_TIMESTAMP WHERE '+
            'branch_id=? AND id=? AND version=? AND status=?').run(
            item.status,branchId,order.id,order.version,order.status);
          if(result.changes!==1) throw Error('LAN_STALE_ORDER_VERSION');
          updated=db.prepare('SELECT * FROM lan_kitchen_orders WHERE branch_id=? AND id=?')
            .get(branchId,order.id);
          db.prepare('INSERT INTO lan_kitchen_commands'+
            '(branch_id,device_id,command_key,order_id,intended_status,result_version)'+
            ' VALUES(?,?,?,?,?,?)').run(
            branchId,device.device_id,item.commandKey,order.id,item.status,updated.version);
          seq=eventWrite(updated,'status-changed');
          db.exec('COMMIT');
        } catch(error) {
          db.exec('ROLLBACK');
          respond(res,error.message==='LAN_STALE_ORDER_VERSION'?409:500,
            {error:error.message==='LAN_STALE_ORDER_VERSION'?
              error.message:'LAN_STATUS_UPDATE_FAILED'});
          return true;
        }
        signals.emit('event');
        respond(res,200,{order:orderView(updated),replayed:false,eventCursor:seq});
      } catch(error) {
        respond(res,error.status||500,
          {error:error.status?error.message:'LAN_STATUS_UPDATE_FAILED'});
      }
      return true;
    }
    if(pathname==='/api/v1/lan/events'&&req.method==='GET') {
      const u=new URL(req.url,'https://localhost');
      const after=Number(u.searchParams.get('after')||0);
      if(!Number.isSafeInteger(after)||after<0) {
        respond(res,400,{error:'LAN_INVALID_EVENT_CURSOR'});return true;
      }
      res.writeHead(200,{
        'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache',
        'x-content-type-options':'nosniff','x-accel-buffering':'no',
      });
      streams.add(res);
      let cursor=after,closed=false;
      let keepalive;
      function cleanup() {
        if(closed)return;closed=true;
        signals.off('event',flush);signals.off('refresh',flush);
        clearInterval(keepalive);streams.delete(res);
      }
      function flush() {
        if(closed||res.destroyed)return;
        if(!auth(req)) {
          res.write('event: revoked\ndata: {}\n\n');cleanup();res.end();return;
        }
        try {
          const rows=db.prepare('SELECT * FROM lan_kitchen_events '+
            'WHERE branch_id=? AND seq>? AND '+
            (device.role==='kitchen'?'station_code=?':'creator_device_id=?')+
            ' ORDER BY seq LIMIT 100').all(
            branchId,cursor,device.role==='kitchen'?device.station_code:device.device_id);
          for(const evt of rows) {
            res.write('id: '+evt.seq+'\nevent: '+evt.event_type+
              '\ndata: '+evt.data_json+'\n\n');cursor=evt.seq;
          }
        } catch {cleanup();res.end();}
      }
      signals.on('event',flush);signals.on('refresh',flush);
      req.on('close',cleanup);
      keepalive=setInterval(()=>{if(!closed){res.write(': keepalive\n\n');flush();}},15000);
      keepalive.unref?.();
      res.write(': connected\n\n');flush();
      return true;
    }
    respond(res,404,{error:'LAN_API_NOT_FOUND'});return true;
  }
  function closeStreams() {
    for(const stream of streams) stream.end();
    streams.clear();
  }
  return Object.freeze({handle,provisionDevice,revokeDevice,closeStreams});
}
module.exports={createLanKitchen,isLoopbackAddress};
