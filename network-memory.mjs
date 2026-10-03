import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const LEGACY_FILE = path.join(ROOT, 'network-memory.json');
function fileFor(routerId='main') {
  if (routerId === 'main') return LEGACY_FILE;
  const safe = String(routerId).replace(/[^A-Za-z0-9_-]/g,'_');
  return path.join(ROOT, `network-memory-${safe}.json`);
}

async function readMemoryFile(routerId='main') {
  try { return JSON.parse(await fs.readFile(fileFor(routerId), 'utf8')); }
  catch { return { version: 1, firstSeenAt: null, lastUpdatedAt: null, router: {}, interfaces: [], addresses: [], routes: [], dns: {}, hotspot: {}, queues: [], firewall: {filter: [], nat: []}, notes: [] }; }
}
async function writeMemoryFile(memory, routerId='main') {
  await fs.writeFile(fileFor(routerId), JSON.stringify(memory, null, 2));
}
function safeRows(rows) { return Array.isArray(rows) ? rows : []; }
function stripSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k,v] of Object.entries(obj)) {
    if (/(password|passwd|secret|token|key|private|certificate)/i.test(k)) continue;
    if (k === 'mac-address') { out[k] = v; continue; }
    if (Array.isArray(v)) out[k] = v.slice(0, 200).map(stripSensitive);
    else if (v && typeof v === 'object') out[k] = stripSensitive(v);
    else out[k] = v;
  }
  return out;
}

async function execPrint(client, script) {
  try { return { ok: true, rows: safeRows(await client.command(script)) }; }
  catch (error) { return { ok: false, error: error?.message || String(error), rows: [] }; }
}

export async function refreshNetworkMemory({ client, reason = 'manual', routerId='main' } = {}) {
  if (!client) throw new Error('RouterOS client is required');
  const memory = await readMemoryFile(routerId);
  const resource = await execPrint(client, '/system resource print');
  const identity = await execPrint(client, '/system identity print');
  const clock = await execPrint(client, '/system clock print');
  const packageInfo = await execPrint(client, '/system package print');
  const interfaces = await execPrint(client, '/interface print');
  const addresses = await execPrint(client, '/ip address print');
  const routes = await execPrint(client, '/ip route print');
  const dns = await execPrint(client, '/ip dns print');
  const hotspot = await execPrint(client, '/ip hotspot print');
  const hotspotProfiles = await execPrint(client, '/ip hotspot profile print');
  const queues = await execPrint(client, '/queue simple print');
  const filter = await execPrint(client, '/ip firewall filter print');
  const nat = await execPrint(client, '/ip firewall nat print');

  const stamp = new Date().toISOString();
  const r = resource.rows?.[0] || {};
  const ident = identity.rows?.[0] || {};
  const clk = clock.rows?.[0] || {};
  memory.version = 1;
  memory.firstSeenAt ||= stamp;
  memory.lastUpdatedAt = stamp;
  memory.lastRefreshReason = reason;
  memory.router = stripSensitive({
    routerId,
    host: client.host,
    port: client.port,
    secure: client.secure,
    identity: ident.name || ident.identity || '',
    boardName: r['board-name'] || '',
    platform: r.platform || '',
    version: r.version || '',
    architecture: r['architecture-name'] || '',
    cpu: r.cpu || '',
    cpuCount: r['cpu-count'] || '',
    cpuFrequency: r['cpu-frequency'] || '',
    totalMemory: r['total-memory'] || '',
    firmware: r['factory-software'] || '',
    clock: clk,
    packageChannels: safeRows(packageInfo.rows).map(p => stripSensitive({name:p.name, version:p.version, disabled:p.disabled, scheduled:p.scheduled})).slice(0,100),
  });
  memory.interfaces = safeRows(interfaces.rows).map(x => stripSensitive({
    '.id': x['.id'], name:x.name, 'default-name':x['default-name'], type:x.type, running:x.running,
    mtu:x.mtu, 'actual-mtu':x['actual-mtu'], l2mtu:x.l2mtu, 'link-downs':x['link-downs'],
    'tx-queue-drop':x['tx-queue-drop'], 'mac-address':x['mac-address']
  }));
  memory.addresses = safeRows(addresses.rows).map(x => stripSensitive({address:x.address, network:x.network, interface:x.interface, disabled:x.disabled}));
  memory.routes = safeRows(routes.rows).map(x => stripSensitive({dst:x.dst, gateway:x.gateway, distance:x.distance, routingMark:x['routing-mark'], active:x.active, disabled:x.disabled})).slice(0,500);
  const d = dns.rows?.[0] || {};
  memory.dns = stripSensitive({servers:d.servers, 'allow-remote-requests':d['allow-remote-requests'], cacheSize:d['cache-size'], maxUdpPacketSize:d['max-udp-packet-size'], verifyDoHCertificate:d['verify-doh-certificates']});
  memory.hotspot = {
    servers: safeRows(hotspot.rows).map(x => stripSensitive({name:x.name, interface:x.interface, profile:x.profile, addressPool:x['address-pool'], disabled:x.disabled})),
    profiles: safeRows(hotspotProfiles.rows).map(x => stripSensitive({name:x.name, hotspotAddress:x['hotspot-address'], dnsName:x['dns-name'], loginBy:x['login-by'], httpProxy:x['http-proxy'], splitUserDomain:x['split-user-domain']}))
  };
  memory.queues = safeRows(queues.rows).map(x => stripSensitive({'.id':x['.id'], name:x.name, target:x.target, 'max-limit':x['max-limit'], 'limit-at':x['limit-at'], disabled:x.disabled, parent:x.parent, priority:x.priority}));
  memory.firewall = {
    filter: safeRows(filter.rows).map(x => stripSensitive({'.id':x['.id'], chain:x.chain, action:x.action, protocol:x.protocol, src:x['src-address'], dst:x['dst-address'], comment:x.comment, disabled:x.disabled})).slice(0,500),
    nat: safeRows(nat.rows).map(x => stripSensitive({'.id':x['.id'], chain:x.chain, action:x.action, protocol:x.protocol, src:x['src-address'], dst:x['dst-address'], out:x['out-interface'], comment:x.comment, disabled:x.disabled})).slice(0,500)
  };
  await writeMemoryFile(memory, routerId);
  return memory;
}

export async function loadNetworkMemory(routerId='main') { return readMemoryFile(routerId); }

export function summarizeNetworkMemory(memory) {
  if (!memory?.router?.version) return { known:false, memoryUpdatedAt:null };
  return {
    known:true,
    memoryUpdatedAt:memory.lastUpdatedAt,
    firstSeenAt:memory.firstSeenAt,
    identity:memory.router.identity,
    boardName:memory.router.boardName,
    platform:memory.router.platform,
    version:memory.router.version,
    architecture:memory.router.architecture,
    interfaceNames:(memory.interfaces||[]).map(x=>x.name).filter(Boolean),
    addressCount:(memory.addresses||[]).length,
    routeCount:(memory.routes||[]).length,
    hotspotServers:(memory.hotspot?.servers||[]).map(x=>x.name).filter(Boolean),
    queueNames:(memory.queues||[]).map(x=>x.name).filter(Boolean),
    firewallFilterCount:(memory.firewall?.filter||[]).length,
    firewallNatCount:(memory.firewall?.nat||[]).length,
  };
}

export function memoryIsStale(memory, maxAgeMs = 24*60*60*1000) {
  if (!memory?.lastUpdatedAt) return true;
  return Date.now() - new Date(memory.lastUpdatedAt).getTime() > maxAgeMs;
}
