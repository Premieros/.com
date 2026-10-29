'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
if(process.platform!=='win32')throw Error('WINDOWS_BUILD_REQUIRED');
const target=path.join(__dirname,'native-runtime');fs.mkdirSync(target,{recursive:true});
const result=spawnSync('dotnet',['publish',path.join(__dirname,'native/Premier.Windows.csproj'),'-c','Release','-r','win-x64','--self-contained','true','-o',target],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
if(!fs.existsSync(path.join(target,'Premier.Windows.exe')))throw Error('NATIVE_RUNTIME_MISSING');
const located=spawnSync('where.exe',['dotnet'],{encoding:'utf8',windowsHide:true});
const dotnetRoot=path.dirname((located.stdout||'').trim().split(/\r?\n/)[0]||'');
for(const name of ['LICENSE.txt','ThirdPartyNotices.txt']){
 const source=path.join(dotnetRoot,name);if(!fs.existsSync(source))throw Error('DOTNET_REDISTRIBUTION_NOTICES_MISSING');
 fs.copyFileSync(source,path.join(target,name));
}
