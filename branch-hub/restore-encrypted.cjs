'use strict';
const {restoreEncryptedToEmptyDirectory}=require('./encrypted-backup.cjs');
if(require.main===module){
 const [backupPath,dataDir,organizationId,branchId]=process.argv.slice(2);
 if(!backupPath||!dataDir||!organizationId||!branchId){console.error('Usage: node restore-encrypted.cjs <backup.pbh> <empty-directory> <organization-id> <branch-id>');process.exitCode=1;}
 else restoreEncryptedToEmptyDirectory({backupPath,dataDir,organizationId,branchId,key:process.env.BRANCH_HUB_BACKUP_KEY})
 .then(result=>console.log(JSON.stringify({ok:true,...result}))).catch(()=>{console.error('ENCRYPTED_RESTORE_FAILED: verify the key, backup integrity, branch and empty destination');process.exitCode=1;});
}
