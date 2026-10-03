import assert from 'node:assert/strict';
import { consoleToApi } from './routeros-api.mjs';
assert.deepEqual(consoleToApi('/system resource print'), {command:'/system/resource/print',args:[]});
assert.deepEqual(consoleToApi('/interface print'), {command:'/interface/print',args:[]});
assert.deepEqual(consoleToApi('/ip hotspot active print'), {command:'/ip/hotspot/active/print',args:[]});
assert.deepEqual(consoleToApi('/ping 1.1.1.1 count=4'), {command:'/ping',args:['=address=1.1.1.1','=count=4']});
assert.deepEqual(consoleToApi('/system/resource/print'), {command:'/system/resource/print',args:[]});
console.log('RouterOS command translation tests: OK');
