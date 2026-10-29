'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
const {PROJECT_URL}=require('./cloud-client.cjs');
const root=path.resolve(__dirname,'..');
const result=spawnSync(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--outDir',path.join(__dirname,'browser-app'),'--emptyOutDir'],{cwd:root,stdio:'inherit',env:{...process.env,VITE_BRANCH_HUB_DESKTOP:'true',VITE_SUPABASE_URL:PROJECT_URL,VITE_SUPABASE_ANON_KEY:'sb_publishable_9W6651rcdIsyBoegwGe_qw_MvCPRIPK'}});
process.exit(result.status??1);
