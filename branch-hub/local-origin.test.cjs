'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {localOrigin}=require('./local-origin.cjs');
test('desktop credential target accepts its own LAN certificate address and blocks remote origins',()=>{
 const interfaces={Ethernet:[{address:'192.168.1.20'}]};
 assert.equal(localOrigin({hostname:'192.168.1.20',port:3847,tls:true,interfaces}),'https://192.168.1.20:3847');
 assert.equal(localOrigin({hostname:'::1',port:3847,tls:true,interfaces}),'https://[::1]:3847');
 for(const hostname of ['192.168.1.21','example.test','127.0.0.1@evil.test','localhost.evil.test'])assert.throws(()=>localOrigin({hostname,port:3847,interfaces}),/INVALID_DESKTOP_HOST/);
});
