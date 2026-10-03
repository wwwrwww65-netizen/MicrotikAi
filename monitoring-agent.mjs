import fs from 'node:fs/promises';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'monitor-state.json');
async function readState(){ try{return JSON.parse(await fs.readFile(FILE,'utf8'));}catch{return {};} }
async function writeState(s){await fs.writeFile(FILE,JSON.stringify(s,null,2));}

export async function evaluateAutoAlerts({routerId='main', overview, traffic, db, appendAlert}={}) {
  const state=await readState();
  const prev=state[routerId] || {};
  const alerts=[];
  const cpu=Number(overview?.resource?.['cpu-load']||0);
  if(cpu>=90) alerts.push({severity:'critical',message:`CPU مرتفع جدًا: ${cpu}%`});
  else if(cpu>=80) alerts.push({severity:'warning',message:`CPU مرتفع: ${cpu}%`});
  const ifaces=overview?.ifaceStats||[];
  for(const it of ifaces){
    const drops=Number(it.txQueueDrop||0);
    const previous=Number(prev.queueDrops?.[it.name]||0);
    if(drops>previous+20) alerts.push({severity:'warning',message:`ارتفاع Queue Drops على ${it.name}: ${drops}`});
    if(it.running===false && it.linkDowns>0) alerts.push({severity:'warning',message:`الواجهة ${it.name} غير قيد التشغيل ولها ${it.linkDowns} انقطاعات.`});
  }
  if(traffic?.anomalies?.length) for(const a of traffic.anomalies.slice(-5)) alerts.push({severity:'warning',message:`استهلاك غير معتاد على ${a.interface||'الواجهة الرئيسية'} (${a.type}).`});
  for(const a of alerts) await appendAlert({routerId,severity:a.severity,message:a.message,source:'auto-monitor'});
  state[routerId]={at:new Date().toISOString(),queueDrops:Object.fromEntries(ifaces.map(x=>[x.name,Number(x.txQueueDrop||0)]))};
  await writeState(state);
  return alerts;
}
