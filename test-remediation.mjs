import assert from 'node:assert/strict';
import { executeRepair } from './remediation-engine.mjs';

let history = [];
let healthy = true;
const client = {
  async command(script) {
    if (script === '/system history print detail') return history;
    if (script === '/system resource print') return [{version:'6.49.22','board-name':'Mock','cpu-load':'5'}];
    if (script === '/interface print') return [{name:'IN',running:healthy?'true':'false'}];
    if (script === '/bad change') {
      history = [...history, {time:new Date().toISOString(),by:'ai',action:'bad change',undo:'/interface enable IN',redo:'/bad change'}];
      healthy = false;
      return [];
    }
    if (script === '/interface enable IN') { healthy=true; return []; }
    return [];
  }
};

const beforeHistory = await client.command('/system history print detail');
const plan = {
  id:'test-plan', issue:'اختبار', scripts:['/bad change'], expectedChecks:[{script:'/interface print',expect:{field:'running',equals:'true'}}],
  reversibleByHistory:true, preflight:{history:beforeHistory}
};
const result = await executeRepair({client,plan,approved:true});
assert.equal(result.status,'completed');
assert.equal(result.rollback?.ok,true);
assert.equal(result.health?.afterRollback?.ok,true);
console.log('REMEDIATION_ROLLBACK_TEST_OK');
