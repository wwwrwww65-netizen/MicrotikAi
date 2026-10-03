import assert from 'node:assert/strict';
import { classifyCommand, validateInterfaceName } from './ai-policy.mjs';
assert.equal(classifyCommand('/system resource print').risk, 'low');
assert.equal(classifyCommand('/interface monitor-traffic IN once').risk, 'low');
assert.equal(classifyCommand('/ip firewall filter add chain=input action=drop').requiresApproval, true);
assert.equal(classifyCommand('/system reboot').risk, 'high');
assert.equal(validateInterfaceName('IN', [{name:'IN', 'default-name':'ether1'}]), 'IN');
assert.equal(validateInterfaceName('ether1', [{name:'IN', 'default-name':'ether1'}]), 'IN');
console.log('AI_POLICY_TEST_OK');
