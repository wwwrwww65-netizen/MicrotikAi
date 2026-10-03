import assert from 'node:assert/strict';
import { refreshNetworkMemory, summarizeNetworkMemory } from './network-memory.mjs';

const fake = {
  host:'172.16.0.1',port:8728,secure:false,
  async command(script){
    if (script==='/system resource print') return [{version:'6.49.22 (long-term)','board-name':'RB1100AHx4',platform:'MikroTik','architecture-name':'arm'}];
    if (script==='/system identity print') return [{name:'MAIN'}];
    if (script==='/system clock print') return [{time:'12:00:00',date:'oct/03/2026',timezone:'EAT-3'}];
    if (script==='/system package print') return [{name:'routeros',version:'6.49.22',disabled:'false'}];
    if (script==='/interface print') return [{'.id':'*1',name:'IN','default-name':'ether1',type:'ether',running:'true','mac-address':'AA:BB:CC:DD:EE:FF'}];
    if (script==='/ip address print') return [{address:'10.0.0.1/24',interface:'IN'}];
    if (script==='/ip route print') return [{dst:'0.0.0.0/0',gateway:'10.0.0.254',active:'true'}];
    if (script==='/ip dns print') return [{servers:'1.1.1.1,8.8.8.8','allow-remote-requests':'yes'}];
    if (script==='/ip hotspot print') return [{name:'hotspot1',interface:'Out',profile:'hsprof1',disabled:'false'}];
    if (script==='/ip hotspot profile print') return [{name:'hsprof1'}];
    if (script==='/queue simple print') return [{name:'CLIENTS',target:'10.0.0.0/24'}];
    if (script==='/ip firewall filter print') return [{'.id':'*1',chain:'input',action:'accept'}];
    if (script==='/ip firewall nat print') return [{'.id':'*1',chain:'srcnat',action:'masquerade'}];
    throw new Error(`unexpected ${script}`);
  }
};
const memory=await refreshNetworkMemory({client:fake,reason:'test'});
const summary=summarizeNetworkMemory(memory);
assert.equal(summary.known,true);
assert.equal(summary.version,'6.49.22 (long-term)');
assert.deepEqual(summary.interfaceNames,['IN']);
assert.equal(summary.routeCount,1);
console.log('NETWORK_MEMORY_TEST_OK');
