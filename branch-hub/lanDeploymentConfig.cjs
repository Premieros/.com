'use strict';

// Lab-only explicit Windows desktop opt-in to a HTTPS LAN address.
// Never discover arbitrary interfaces or open firewall/NAT ports by default.
const fs=require('node:fs');
const path=require('node:path');

function resolveLanDeployment(config, exists=fs.existsSync) {
  if (config?.lanEnabled !== true) {
    return Object.freeze({
      enabled:false,host:'127.0.0.1',hostname:null,
      tlsCert:null,tlsKey:null,port:3847,url:null,
    });
  }
  const hostname=config.lanHostname;
  const certificate=config.tlsCert;
  const privateKey=config.tlsKey;
  const port=config.lanPort??3847;
  if(typeof hostname!=='string'||!/^[a-zA-Z0-9.-]{3,253}$/.test(hostname)||
    hostname==='0.0.0.0'||hostname==='localhost'||hostname==='127.0.0.1') {
    throw Error('LAN_TRUSTED_HOSTNAME_REQUIRED');
  }
  if(!Number.isInteger(port)||port<1024||port>65535)
    throw Error('LAN_PORT_INVALID');
  if(typeof certificate!=='string'||typeof privateKey!=='string'||
    !path.isAbsolute(certificate)||!path.isAbsolute(privateKey)||
    !exists(certificate)||!exists(privateKey))
    throw Error('LAN_TRUSTED_TLS_FILES_REQUIRED');
  return Object.freeze({
    enabled:true,host:'0.0.0.0',hostname,
    tlsCert:certificate,tlsKey:privateKey,port,
    url:'https://'+hostname+':'+port+'/lan',
  });
}
module.exports={resolveLanDeployment};
