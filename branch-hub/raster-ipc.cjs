'use strict';
const crypto=require('node:crypto');
const {validateReceipt}=require('./raster-receipt.cjs');
function createParentRasterRenderer(channel=process,{timeoutMs=12000}={}){
 return (receipt,dots)=>{
  validateReceipt(receipt);if(![384,512,576].includes(dots))return Promise.reject(Error('INVALID_PRINTER_DOTS'));
  return new Promise((resolve,reject)=>{
   if(!channel.connected||typeof channel.send!=='function')return reject(Error('RASTER_RENDERER_REQUIRED'));
   const requestId=crypto.randomUUID();let timer;
   const finish=(error,bytes)=>{clearTimeout(timer);channel.off('message',onMessage);channel.off('disconnect',onDisconnect);error?reject(error):resolve(bytes);};
   const onDisconnect=()=>finish(Error('RASTER_RENDERER_DISCONNECTED'));
   const onMessage=message=>{
    if(message?.type!=='receipt-rendered'||message.requestId!==requestId)return;
    if(!message.ok||typeof message.bytes!=='string'||message.bytes.length>2800000||message.bytes.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(message.bytes))return finish(Error('RASTER_RENDER_FAILED'));
    const bytes=Buffer.from(message.bytes,'base64');
    if(bytes.length<16||bytes.length>2*1024*1024||bytes[0]!==27||bytes[1]!==64)return finish(Error('RASTER_RENDER_FAILED'));
    finish(null,bytes);
   };
   channel.on('message',onMessage);channel.once('disconnect',onDisconnect);
   timer=setTimeout(()=>finish(Error('RASTER_RENDER_TIMEOUT')),timeoutMs);
   try{channel.send({type:'render-receipt',requestId,receipt,dots},error=>{if(error)finish(Error('RASTER_RENDERER_DISCONNECTED'));});}
   catch{finish(Error('RASTER_RENDERER_DISCONNECTED'));}
  });
 };
}
module.exports={createParentRasterRenderer};
