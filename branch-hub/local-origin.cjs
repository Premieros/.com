'use strict';
const os=require('node:os');
const net=require('node:net');
// The desktop bootstrap credential may only be delivered to a listener on this computer.
function localOrigin({hostname='127.0.0.1',port,tls=false,interfaces=os.networkInterfaces()}){
 const local=['localhost','127.0.0.1','::1'].includes(hostname)||
  net.isIP(hostname)!==0&&Object.values(interfaces).flat().some(n=>n&&n.address===hostname);
 if(!local||!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_DESKTOP_HOST');
 const host=net.isIP(hostname)===6?'['+hostname+']':hostname;
 return `${tls?'https':'http'}://${host}:${port}`;
}
module.exports={localOrigin};
