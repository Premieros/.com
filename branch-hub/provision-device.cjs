'use strict';

// Local ADMINISTRATOR terminal utility for isolated LAB enrollment.
// Do not offer this command via HTTP or embed an admin master token in a QR.
// Stop Branch Hub before running: enrollment uses its existing SQLite file.
const { createHub } = require('./server.cjs');

async function main() {
  const args=process.argv.slice(2);
  const command=args[0];
  if(!['pair','revoke'].includes(command) ||
     (command==='pair'&&args.length<4) ||
     (command==='revoke'&&args.length!==2)) {
    console.error('Usage (ADMIN LAB only):');
    console.error('  node provision-device.cjs pair <device_id> <operator_id> <waiter|kitchen> [station_code]');
    console.error('  node provision-device.cjs revoke <device_id>');
    process.exitCode=2;return;
  }
  // No server socket exposed and no endpoint that reveals newly issued keys.
  const hub=createHub({
    host:'127.0.0.1', port:0,
    organizationId:process.env.BRANCH_HUB_ORGANIZATION_ID,
    branchId:process.env.BRANCH_HUB_BRANCH_ID,
    token:process.env.BRANCH_HUB_TOKEN,
    dataDir:process.env.BRANCH_HUB_DATA_DIR,
  });
  try {
    await hub.listen();
    if(command==='revoke') {
      console.log(hub.revokeLanDevice(args[1])?'Device revoked.':'Unknown device.');
      return;
    }
    const result=hub.provisionLanDevice({
      deviceId:args[1],operatorId:args[2],role:args[3],
      stationCode:args[3]==='kitchen'?args[4]:null,
    });
    console.log('Provisioned device:',result.deviceId,'role:',result.role);
    console.log('One-time secret (do NOT commit, share or put in URL):');
    console.log(result.credential);
    console.log('Enter the secret manually on the HTTPS /lan screen.');
  } finally {
    await hub.close();
  }
}
main().catch((error)=>{
  console.error('Enrollment failed:',error.message);
  process.exitCode=1;
});
