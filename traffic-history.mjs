import fs from 'node:fs/promises';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'traffic-history.json');
const MAX_SAMPLES = 15000;

async function readAll() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')); }
  catch { return []; }
}
async function writeAll(rows) { await fs.writeFile(FILE, JSON.stringify(rows, null, 2)); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function primaryInterface(rows = []) {
  const live = rows.filter(r => String(r.running) === 'true');
  return live.find(r => /^(in|wan|internet)$/i.test(String(r.name || '')))
    || live.find(r => String(r['default-name'] || '').toLowerCase() === 'ether1')
    || live.sort((a,b)=>((num(b['rx-byte'])+num(b['tx-byte']))-(num(a['rx-byte'])+num(a['tx-byte']))))[0]
    || rows[0] || null;
}

export async function recordTrafficSnapshot({ routerId='main', client } = {}) {
  if (!client) throw new Error('RouterOS client is required');
  const interfaces = await client.command('/interface print');
  const p = primaryInterface(interfaces);
  let live = null;
  if (p?.name) {
    try { live = (await client.command(`/interface monitor-traffic ${p.name} once`))?.[0] || null; }
    catch (error) { live = { error: error?.message || String(error), interface: p.name }; }
  }
  const row = {
    at: new Date().toISOString(),
    routerId,
    interface: p?.name || null,
    running: p?.running ?? null,
    rxBytes: num(p?.['rx-byte']),
    txBytes: num(p?.['tx-byte']),
    linkDowns: num(p?.['link-downs']),
    txQueueDrop: num(p?.['tx-queue-drop']),
    rxBitsPerSecond: num(live?.['rx-bits-per-second']),
    txBitsPerSecond: num(live?.['tx-bits-per-second']),
    rxPacketsPerSecond: num(live?.['rx-packets-per-second']),
    txPacketsPerSecond: num(live?.['tx-packets-per-second'])
  };
  const all = await readAll();
  all.push(row);
  if (all.length > MAX_SAMPLES) all.splice(0, all.length - MAX_SAMPLES);
  await writeAll(all);
  return row;
}

export async function history({ routerId='main', hours=24 } = {}) {
  const all = await readAll();
  const since = Date.now() - Math.max(1, Number(hours) || 24) * 3600 * 1000;
  return all.filter(r => r.routerId === routerId && new Date(r.at).getTime() >= since);
}

export async function historySummary({ routerId='main', hours=24 } = {}) {
  const rows = await history({routerId, hours});
  if (!rows.length) return { routerId, hours, samples: 0, avgRxBps: 0, avgTxBps: 0, peakRxBps: 0, peakTxBps: 0, maxQueueDrops: 0, interface: null };
  const avg = k => rows.reduce((s,r)=>s+num(r[k]),0)/rows.length;
  const max = k => Math.max(...rows.map(r=>num(r[k])));
  return {
    routerId, hours, samples: rows.length,
    interface: rows.at(-1)?.interface || null,
    avgRxBps: avg('rxBitsPerSecond'), avgTxBps: avg('txBitsPerSecond'),
    peakRxBps: max('rxBitsPerSecond'), peakTxBps: max('txBitsPerSecond'),
    maxQueueDrops: max('txQueueDrop'),
    lastAt: rows.at(-1)?.at || null
  };
}
export async function anomalies({routerId='main', hours=24}={}) {
  const rows = await history({routerId, hours});
  if (rows.length < 4) return {samples:rows.length, anomalies:[], note:'لا توجد بيانات تاريخية كافية.'};
  const baseline = rows.slice(0, -3);
  const avgRx = baseline.reduce((s,r)=>s+num(r.rxBitsPerSecond),0)/baseline.length;
  const avgTx = baseline.reduce((s,r)=>s+num(r.txBitsPerSecond),0)/baseline.length;
  const out=[];
  for (const r of rows.slice(-3)) {
    const rx = num(r.rxBitsPerSecond), tx = num(r.txBitsPerSecond);
    if (avgRx > 0 && rx > avgRx * 2.5) out.push({at:r.at,type:'rx_spike',interface:r.interface,current:rx,baseline:avgRx});
    if (avgTx > 0 && tx > avgTx * 2.5) out.push({at:r.at,type:'tx_spike',interface:r.interface,current:tx,baseline:avgTx});
    if (num(r.txQueueDrop) > 0) out.push({at:r.at,type:'queue_drop',interface:r.interface,current:r.txQueueDrop});
    if (r.running === 'false' || r.running === false) out.push({at:r.at,type:'interface_down',interface:r.interface});
  }
  return {samples:rows.length, anomalies:out};
}
