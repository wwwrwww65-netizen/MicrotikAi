import net from 'node:net';
import assert from 'node:assert/strict';
import {RouterOSApiClient, consoleToApi} from './routeros-api.mjs';

function encLen(n){if(n<0x80)return Buffer.from([n]);if(n<0x4000)return Buffer.from([(n>>8)|0x80,n&255]);if(n<0x200000)return Buffer.from([(n>>16)|0xc0,(n>>8)&255,n&255]);if(n<0x10000000)return Buffer.from([(n>>24)|0xe0,(n>>16)&255,(n>>8)&255,n&255]);const b=Buffer.alloc(5);b[0]=0xf0;b.writeUInt32BE(n,1);return b;}
function encWord(w){const b=Buffer.from(w);return Buffer.concat([encLen(b.length),b]);}
function sentence(words){return Buffer.concat([...words.map(encWord),Buffer.from([0])]);}
function dec(buf){let o=0, words=[];while(o<buf.length){const f=buf[o];let len,nb;if(f<0x80){len=f;nb=1}else if(f<0xc0){len=((f&0x3f)<<8)|buf[o+1];nb=2}else if(f<0xe0){len=((f&0x1f)<<16)|(buf[o+1]<<8)|buf[o+2];nb=3}else if(f<0xf0){len=((f&0x0f)<<24)|(buf[o+1]<<16)|(buf[o+2]<<8)|buf[o+3];nb=4}else{len=buf.readUInt32BE(o+1);nb=5} if(buf.length<o+nb+len)return null;o+=nb;if(len===0)return {words,used:o};words.push(buf.subarray(o,o+len).toString());o+=len;}return null;}

const server=net.createServer(sock=>{
 let buf=Buffer.alloc(0);
 sock.on('data',data=>{buf=Buffer.concat([buf,data]); while(true){const p=dec(buf); if(!p)break; buf=buf.subarray(p.used); const w=p.words; const cmd=w[0]; if(cmd==='/login'){sock.write(sentence(['!done']));} else if(cmd==='/system/resource/print'){sock.write(sentence(['!re','=version=6.49.22','=cpu-load=17','=board-name=MockRouter','=free-memory=100000','=total-memory=200000']));sock.write(sentence(['!done']));} else if(cmd==='/interface/print'){sock.write(sentence(['!re','=name=ether1','=running=true','=rx-byte=123','=tx-byte=456']));sock.write(sentence(['!done']));} else if(cmd==='/ping'){sock.write(sentence(['!re','=host=1.1.1.1','=time=10ms']));sock.write(sentence(['!done']));} else {sock.write(sentence(['!trap','=message=unknown command']));}}});
});

await new Promise(r=>server.listen(18728,'127.0.0.1',r));
assert.deepEqual(consoleToApi('/system resource print').command,'/system/resource/print');
assert.deepEqual(consoleToApi('/ping 1.1.1.1 count=4'),{command:'/ping',args:['=address=1.1.1.1','=count=4']});
const c=new RouterOSApiClient({host:'127.0.0.1',port:18728,user:'akram',pass:'x',timeout:2});
await c.connect();
const r=await c.print('system/resource',['version','cpu-load','board-name']);
assert.equal(r[0].version,'6.49.22');
assert.equal(r[0]['cpu-load'],'17');
const p=await c.executeConsole('/ping 1.1.1.1 count=4');
assert.equal(p[0].host,'1.1.1.1');
await c.close();
await new Promise(r=>server.close(r));
console.log('DIRECT_ROUTEROS_CLIENT_TEST_OK');
