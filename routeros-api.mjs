import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const PRINT_PATHS = new Map([
  ['/system resource print', '/system/resource/print'],
  ['/interface print', '/interface/print'],
  ['/interface print stats', '/interface/print'],
  ['/ip hotspot active print', '/ip/hotspot/active/print'],
  ['/queue simple print', '/queue/simple/print'],
  ['/log print', '/log/print'],
  ['/ip hotspot user print', '/ip/hotspot/user/print'],
  ['/ip hotspot cookie print', '/ip/hotspot/cookie/print'],
  ['/ip dhcp-server lease print', '/ip/dhcp-server/lease/print'],
  ['/ip firewall filter print', '/ip/firewall/filter/print'],
  ['/ip firewall nat print', '/ip/firewall/nat/print'],
]);

function shellTokens(text) {
  return String(text || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(x => x.replace(/^['"]|['"]$/g, '')) || [];
}

function splitCommandAndArgs(tokens) {
  const verbs = new Set(['print','get','add','set','remove','enable','disable','find','reset','move','monitor','export','import','reboot','ping','run']);
  const idx = tokens.findIndex((t, i) => i > 0 && verbs.has(String(t).toLowerCase()));
  if (idx < 0) return {pathTokens: tokens, tail: []};
  return {pathTokens: tokens.slice(0, idx + 1), tail: tokens.slice(idx + 1)};
}

export function consoleToApi(script) {
  const raw = String(script || '').trim();
  if (!raw) throw new Error('Empty RouterOS command');
  const canonical = PRINT_PATHS.get(raw.toLowerCase());
  if (canonical) return {command: canonical, args: []};
  const tokens = shellTokens(raw);
  if (!tokens[0]?.startsWith('/')) throw new Error(`Invalid RouterOS command: ${raw}`);
  if (tokens[0].toLowerCase() === '/ping') {
    const args = [];
    let address = null;
    for (const t of tokens.slice(1)) {
      if (t.includes('=')) {
        const i = t.indexOf('=');
        args.push(`=${t.slice(0, i)}=${t.slice(i + 1)}`);
      } else if (!address) address = t;
    }
    if (address) args.unshift(`=address=${address}`);
    return {command:'/ping', args};
  }
  const {pathTokens, tail} = splitCommandAndArgs(tokens);
  let command = pathTokens.join('/').replace(/\/+/g, '/');
  if (!command.startsWith('/')) command = '/' + command;
  const args = [];
  for (const t of tail) {
    if (t.startsWith('?')) { args.push(t); continue; }
    if (t.startsWith('.')) { args.push(t); continue; }
    if (t.includes('=')) {
      const i=t.indexOf('=');
      args.push(`=${t.slice(0,i)}=${t.slice(i+1)}`);
    } else if (/^(detail|brief|stats|terse|count-only)$/i.test(t)) {
      // RouterOS CLI display flags have no direct API equivalent; ignore them.
    } else {
      args.push(`=numbers=${t}`);
    }
  }
  return {command,args};
}

function encodeLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([(n >> 8) | 0x80, n & 0xff]);
  if (n < 0x200000) return Buffer.from([(n >> 16) | 0xc0, (n >> 8) & 0xff, n & 0xff]);
  if (n < 0x10000000) return Buffer.from([(n >> 24) | 0xe0, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  const b=Buffer.alloc(5); b[0]=0xf0; b.writeUInt32BE(n,1); return b;
}

function decodeLength(buf, offset=0) {
  if (offset >= buf.length) return null;
  const first=buf[offset];
  if (first < 0x80) return {length:first, bytes:1};
  if (first < 0xc0) return {length:((first & 0x3f)<<8)|buf[offset+1], bytes:2};
  if (first < 0xe0) return {length:((first & 0x1f)<<16)|(buf[offset+1]<<8)|buf[offset+2], bytes:3};
  if (first < 0xf0) return {length:((first & 0x0f)<<24)|(buf[offset+1]<<16)|(buf[offset+2]<<8)|buf[offset+3], bytes:4};
  if (first === 0xf0) return {length:buf.readUInt32BE(offset+1), bytes:5};
  throw new Error(`Unsupported RouterOS API control byte 0x${first.toString(16)}`);
}

function encodeWord(word) {
  const body=Buffer.from(String(word),'utf8');
  return Buffer.concat([encodeLength(body.length), body]);
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}


async function connectSocket(host, port, tlsEnabled, timeoutMs, rejectUnauthorized=true){
  return await new Promise((resolve,reject)=>{
    let settled=false;
    const socket=tlsEnabled
      ? tls.connect({host,port,rejectUnauthorized,servername:host})
      : net.connect({host,port});
    const timer=setTimeout(()=>{ if(settled)return; settled=true; try{socket.destroy();}catch{}; reject(new Error('RouterOS API connection timeout')); }, timeoutMs);
    const onConnected=()=>{ if(settled)return; settled=true; clearTimeout(timer); resolve(new ApiSocket(socket,timeoutMs)); };
    socket.once('connect',onConnected);
    socket.once('secureConnect',onConnected);
    socket.once('error',e=>{ if(settled)return; settled=true; clearTimeout(timer); reject(e); });
  });
}

class ApiSocket {
  constructor(socket, timeoutMs) {
    this.socket=socket;
    this.timeoutMs=timeoutMs;
    this.buffer=Buffer.alloc(0);
    this.sentenceQueue=[];
    this.waiters=[];
    this.closed=false;
    socket.on('data', d=>{ this.buffer=Buffer.concat([this.buffer,d]); this.pump(); });
    socket.on('error', e=>this.failAll(e));
    socket.on('close', ()=>{ this.closed=true; this.failAll(new Error('RouterOS API socket closed')); });
  }
  failAll(err){ const w=this.waiters.splice(0); for(const x of w) x.reject(err); }
  pump(){
    while(true){
      const words=[]; let off=0;
      while(true){
        const d=decodeLength(this.buffer, off); if(!d) return;
        if(this.buffer.length < off+d.bytes+d.length) return;
        off += d.bytes;
        if(d.length===0){ words.push(''); break; }
        words.push(this.buffer.subarray(off,off+d.length).toString('utf8')); off += d.length;
      }
      this.buffer=this.buffer.subarray(off);
      const waiter=this.waiters.shift();
      if(waiter) waiter.resolve(words); else this.sentenceQueue.push(words);
    }
  }
  readSentence(){
    if(this.closed) return Promise.reject(new Error('Socket closed'));
    if(this.sentenceQueue.length) return Promise.resolve(this.sentenceQueue.shift());
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ const i=this.waiters.findIndex(x=>x.resolve===resolve); if(i>=0)this.waiters.splice(i,1); reject(new Error('RouterOS API timeout')); }, this.timeoutMs);
      this.waiters.push({resolve:(v)=>{clearTimeout(timer);resolve(v);},reject:(e)=>{clearTimeout(timer);reject(e);}});
    });
  }
  send(words){
    if(this.closed) throw new Error('Socket closed');
    this.socket.write(encodeSentence(words));
  }
  close(){ if(!this.closed){this.closed=true; try{this.socket.end();}catch{} try{this.socket.destroy();}catch{}} }
}
function attrsToObject(words){
  const out={};
  for(const w of words){ if(w.startsWith('=')){const i=w.indexOf('=',1); if(i>0) out[w.slice(1,i)]=w.slice(i+1);} }
  return out;
}

function parseReplies(sentences){
  const rows=[]; let done=null;
  for(const s of sentences){
    if(!s.length) continue;
    if(s[0]==='!re') rows.push(attrsToObject(s.slice(1)));
    else if(s[0]==='!trap') { const a=attrsToObject(s.slice(1)); throw new Error(`RouterOS API: ${a.message || a['category'] || 'command failed'}`); }
    else if(s[0]==='!fatal') { const a=attrsToObject(s.slice(1)); throw new Error(`RouterOS API fatal: ${a.message || 'connection failed'}`); }
    else if(s[0]==='!done') done=attrsToObject(s.slice(1));
  }
  return {rows,done};
}

export class RouterOSApiClient {
  constructor({host,port=8728,user,pass,secure=false,timeout=10,rejectUnauthorized=true}){ this.host=host; this.port=Number(port); this.user=user; this.pass=pass??''; this.secure=!!secure; this.timeout=Math.max(1,Number(timeout)||10)*1000; this.rejectUnauthorized=rejectUnauthorized; this.conn=null; this.connected=false; }
  async connect(){
    if(this.connected && this.conn) return this;
    this.conn=await connectSocket(this.host,this.port,this.secure,this.timeout,this.rejectUnauthorized);
    this.conn.send(['/login',`=name=${this.user}`,`=password=${this.pass}`]);
    const loginSentences=[];
    while(true){ const s=await this.conn.readSentence(); loginSentences.push(s); if(['!done','!trap','!fatal'].includes(s[0]||'')) break; }
    const loginWords=loginSentences.flat();
    if(loginWords.includes('!trap') || loginWords.includes('!fatal')) { const p=parseReplies(loginSentences); void p; }
    const ret=loginWords.find(w=>w.startsWith('=ret='))?.slice(5);
    if(ret){
      const md5=crypto.createHash('md5').update(Buffer.concat([Buffer.from([0]),Buffer.from(this.pass,'utf8'),Buffer.from(ret,'hex')])).digest('hex');
      this.conn.send(['/login',`=name=${this.user}`,`=response=00${md5}`]);
      const resp=[];
      while(true){ const s=await this.conn.readSentence(); resp.push(s); if(['!done','!trap','!fatal'].includes(s[0]||'')) break; }
      parseReplies(resp);
    }
    parseReplies(loginSentences);
    this.connected=true;
    return this;
  }
  async close(){ this.connected=false; this.conn?.close(); this.conn=null; }
  async command(words){
    await this.connect();
    const arr=Array.isArray(words)?words:[...arguments];
    this.conn.send(arr);
    const sentences=[];
    while(true){
      const s=await this.conn.readSentence();
      sentences.push(s);
      const head=s[0] || '';
      if(head==='!done' || head==='!trap' || head==='!fatal') break;
    }
    return parseReplies(sentences);
  }
  async print(path,proplist=[]){ let command=path.endsWith('/print')?path:`${path}/print`; if(!command.startsWith('/')) command='/'+command; const words=[command]; if(proplist.length) words.push(`=.proplist=${proplist.join(',')}`); const out=await this.command(words); return out.rows; }
  async executeConsole(script){ const {command,args}=consoleToApi(script); return (await this.command([command,...args])).rows; }
}

// Backward-compatible name used by the project.
export { RouterOSApiClient as RouterOSApiClientLegacy };
