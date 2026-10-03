import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SNAP_DIR = path.join(ROOT, 'repair-snapshots');
const ACTIVE = new Map();

function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function clip(v, max=12000) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length <= max ? v : `${s.slice(0,max)}\n...[truncated]`;
}

async function ensureDir(){ await fs.mkdir(SNAP_DIR,{recursive:true}); }

export async function collectPreflight(client) {
  const reads = {
    resource:'/system resource print',
    interfaces:'/interface print',
    addresses:'/ip address print',
    routes:'/ip route print',
    dns:'/ip dns print',
    queues:'/queue simple print',
    filter:'/ip firewall filter print',
    nat:'/ip firewall nat print',
    history:'/system history print detail'
  };
  const out={};
  for(const [k,cmd] of Object.entries(reads)){
    try{ out[k]=await client.command(cmd); }
    catch(e){ out[k]={error:e?.message||String(e)}; }
  }
  return out;
}

function historySignature(entry){
  if(!entry||typeof entry!=='object') return '';
  return [entry.time,entry.by,entry.action,entry.redo,entry.undo].join('|');
}

function newHistoryEntries(before, after){
  const beforeSet=new Set((before||[]).map(historySignature));
  return (after||[]).filter(x=>x?.undo && !beforeSet.has(historySignature(x)));
}

function isNonReversible(script){
  return /(?:\/system\s+(?:reboot|reset-configuration|shutdown)|\bimport\b|\bupgrade\b|\/system\s+package\s+(?:update|downgrade))/i.test(String(script));
}

export async function prepareRepair({client, scripts, issue, reason, expectedChecks=[]}={}){
  const planScripts=(Array.isArray(scripts)?scripts:[scripts]).map(s=>String(s||'').trim()).filter(Boolean);
  if(!planScripts.length) throw new Error('لا توجد أوامر إصلاح.');
  const preflight=await collectPreflight(client);
  const reversible=!planScripts.some(isNonReversible);
  const plan={
    id:id(), kind:'repair_plan', createdAt:now(), issue:String(issue||''), reason:String(reason||''),
    scripts:planScripts, expectedChecks:Array.isArray(expectedChecks)?expectedChecks:[],
    reversibleByHistory:reversible, preflight:clip(preflight,50000),
    token:null, status:'approval_required'
  };
  await ensureDir();
  const snapshotPath=path.join(SNAP_DIR,`${plan.id}.json`);
  await fs.writeFile(snapshotPath, JSON.stringify(plan,null,2));
  plan.snapshotPath=snapshotPath;
  ACTIVE.set(plan.id,plan);
  return plan;
}

async function healthCheck(client, baseline={}){
  const checks={};
  try{ const r=await client.command('/system resource print'); checks.resource=!!r?.[0]; checks.version=r?.[0]?.version||''; }
  catch(e){ checks.resourceError=e?.message||String(e); }
  try{ const i=await client.command('/interface print'); checks.interfaces=Array.isArray(i); checks.runningInterfaces=Array.isArray(i)?i.filter(x=>String(x.running)==='true').length:0; }
  catch(e){ checks.interfacesError=e?.message||String(e); }
  checks.ok=!!checks.resource && !!checks.interfaces && !checks.resourceError && !checks.interfacesError;
  if(Number(baseline.runningInterfaces||0)>0 && Number(checks.runningInterfaces||0)===0) checks.ok=false;
  return checks;
}

function getPath(obj, path){
  return String(path||'').split('.').reduce((v,k)=>v?.[k],obj);
}

async function runExpectedChecks(client, expectedChecks=[]){
  const checks=[];
  const allowedPrefix=/^\/(?:system\s+resource|interface|ip\s+(?:route|address|dns)|queue\s+simple|ip\s+hotspot\s+active)\s+print\b/i;
  for(const item of (Array.isArray(expectedChecks)?expectedChecks:[])){
    const script=typeof item==='string'?item:String(item?.script||'');
    if(!allowedPrefix.test(script)) { checks.push({ok:false,script,error:'التحقق المتوقع يجب أن يكون أمر قراءة معتمدًا.'}); continue; }
    try{
      const rows=await client.command(script);
      let ok=true; let reason='قراءة ناجحة.';
      const expect=item?.expect||null;
      if(expect && typeof expect==='object'){
        if(expect.exists===true) ok=rows.length>0;
        if(expect.exists===false) ok=rows.length===0;
        if(expect.field && Object.prototype.hasOwnProperty.call(expect,'equals')){
          ok=rows.some(r=>String(getPath(r,expect.field))===String(expect.equals));
        }
        if(expect.field && Object.prototype.hasOwnProperty.call(expect,'notEquals')){
          ok=rows.every(r=>String(getPath(r,expect.field))!==String(expect.notEquals));
        }
      }
      if(!ok) reason='شرط التحقق لم يتحقق.';
      checks.push({ok,script,reason,rows});
    }catch(error){ checks.push({ok:false,script,error:error?.message||String(error)}); }
  }
  return {ok:checks.every(x=>x.ok),checks};
}

async function rollbackHistory(client, entries){
  const undone=[];
  for(const entry of [...entries].reverse()){
    const undo=String(entry.undo||'').trim();
    if(!undo) continue;
    try{
      const result=await client.command(undo);
      undone.push({undo,result,ok:true});
    }catch(error){
      undone.push({undo,ok:false,error:error?.message||String(error)});
    }
  }
  return {ok:undone.every(x=>x.ok), undone};
}

export async function executeRepair({client, plan, approved=false, onEvent}={}){
  if(!plan) throw new Error('خطة الإصلاح غير موجودة.');
  if(!approved) return {status:'approval_required',plan};
  const beforeHistory=Array.isArray(plan.preflight?.history)?plan.preflight.history:[];
  const results=[]; let afterHistory=[]; let rollback=null; let health=null;
  await onEvent?.({type:'repair_start',planId:plan.id,steps:plan.scripts.length});
  try{
    for(let i=0;i<plan.scripts.length;i++){
      const script=plan.scripts[i];
      await onEvent?.({type:'repair_step_start',planId:plan.id,index:i,script});
      if(/show-sensitive/i.test(script)) throw new Error('لا يُسمح بتصدير الإعدادات الحساسة إلى المساعد.');
      const result=await client.command(script);
      results.push({script,result,ok:true});
      await onEvent?.({type:'repair_step_result',planId:plan.id,index:i,ok:true});
    }
    try { afterHistory=await client.command('/system history print detail'); }
    catch(e){ afterHistory=[]; }
    const baselineRunning=Array.isArray(plan.preflight?.interfaces)?plan.preflight.interfaces.filter(x=>String(x.running)==='true').length:0;
    health=await healthCheck(client,{runningInterfaces:baselineRunning});
    const expected=await runExpectedChecks(client,plan.expectedChecks);
    if(!expected.ok) health={...health,ok:false,expectedChecks:expected};
    else health={...health,expectedChecks:expected};
    const newEntries=newHistoryEntries(beforeHistory,afterHistory);
    if(!health.ok){
      rollback=plan.reversibleByHistory?await rollbackHistory(client,newEntries):{ok:false,skipped:true,reason:'الأوامر تتضمن عملية غير قابلة للتراجع الآلي.'};
      const postRollback=await healthCheck(client,{runningInterfaces:baselineRunning}).catch(e=>({ok:false,error:e?.message||String(e)}));
      health={beforeRollback:health,afterRollback:postRollback,expectedChecks:expected};
      if(rollback?.ok) await onEvent?.({type:'repair_rollback',planId:plan.id,ok:true});
    }
    plan.status=health?.ok===true || health?.afterRollback?.ok===true ? 'completed' : 'failed';
    return {status:plan.status,planId:plan.id,issue:plan.issue,results,health,rollback,historyEntries:newHistoryEntries(beforeHistory,afterHistory)};
  } catch(error){
    try { afterHistory=await client.command('/system history print detail'); } catch {}
    const newEntries=newHistoryEntries(beforeHistory,afterHistory);
    rollback=plan.reversibleByHistory?await rollbackHistory(client,newEntries):{ok:false,skipped:true,reason:'التراجع الآلي غير مضمون لهذه الأوامر.'};
    health=await healthCheck(client).catch(e=>({ok:false,error:e?.message||String(e)}));
    plan.status='failed';
    await onEvent?.({type:'repair_rollback',planId:plan.id,ok:!!rollback?.ok});
    return {status:'failed',planId:plan.id,error:error?.message||String(error),results,health,rollback};
  } finally {
    await fs.writeFile(path.join(SNAP_DIR,`${plan.id}.result.json`), JSON.stringify({planId:plan.id,results,health,rollback},null,2)).catch(()=>{});
    ACTIVE.delete(plan.id);
  }
}

export function getRepairPlan(id){ return ACTIVE.get(id) || null; }
