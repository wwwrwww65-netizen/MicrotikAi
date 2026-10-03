function safeName(value, fallback='jeeey-backup') {
  const name = String(value || fallback).trim().replace(/[^A-Za-z0-9._-]/g,'-').slice(0,80);
  return name || fallback;
}

function isoNowParts() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  const hh = String(d.getUTCHours()).padStart(2,'0');
  const mm = String(d.getUTCMinutes()).padStart(2,'0');
  return `${y}${m}${day}-${hh}${mm}`;
}

export async function listRouterFiles(client) {
  const api = await client.ensureApi();
  return api.print('file/print',['.id','name','type','size','creation-time']);
}

export async function listBackupSchedules(client) {
  const api = await client.ensureApi();
  const rows = await api.print('system/scheduler/print',['.id','name','interval','start-date','start-time','run-count','disabled','on-event']);
  return rows.filter(x => String(x.name || '').startsWith('jeeey-ai-backup'));
}

export async function createBinaryBackup(client,{name,password}) {
  if (!password) throw new Error('يجب وضع كلمة مرور لتشفير النسخة الاحتياطية.');
  const backupName = safeName(name || `jeeey-${isoNowParts()}`);
  const api = await client.ensureApi();
  return api.command(['system/backup/save', `=name=${backupName}`, `=password=${password}`]);
}

export async function exportConfig(client,{name}) {
  const fileName = safeName(name || `jeeey-export-${isoNowParts()}`);
  const api = await client.ensureApi();
  return api.command(['export', `=file=${fileName}`]);
}

export async function restoreBinaryBackup(client,{name,password,confirmed}) {
  if (!confirmed) throw new Error('الاستعادة تتطلب تأكيدًا صريحًا.');
  if (!password) throw new Error('كلمة مرور النسخة مطلوبة.');
  const file = safeName(name);
  const api = await client.ensureApi();
  return api.command(['system/backup/load', `=name=${file}`, `=password=${password}`]);
}

export async function importExport(client,{name,confirmed}) {
  if (!confirmed) throw new Error('استيراد الإعدادات يتطلب تأكيدًا صريحًا.');
  const file = safeName(name);
  const api = await client.ensureApi();
  return api.command(['import', `=file=${file}`]);
}

export async function configureBackupSchedule(client,{time='03:00:00',interval='1d',password,enabled=true}) {
  if (!password) throw new Error('يجب وضع كلمة مرور للنسخ المجدولة حتى لا تُحفظ النسخ دون تشفير.');
  const api = await client.ensureApi();
  const schedulerName='jeeey-ai-backup-schedule';
  const scriptName='jeeey-ai-backup-script';
  const source = `:local d [/system clock get date]; :local t [/system clock get time]; :local safe ([:pick $d 7 11].[:pick $d 0 3].[:pick $d 4 6]."-".[:pick $t 0 2].[:pick $t 3 5]); /system backup save name=("jeeey-auto-".$safe) password="${String(password).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}";`;

  const scripts = await api.print('system/script/print',['.id','name']);
  for (const row of scripts.filter(x=>x.name===scriptName)) await api.command(['system/script/remove', `=.id=${row['.id']}`]);
  await api.command(['system/script/add', `=name=${scriptName}`, `=source=${source}`, '=policy=read,write,policy,test']);

  const schedulers = await api.print('system/scheduler/print',['.id','name']);
  for (const row of schedulers.filter(x=>x.name===schedulerName)) await api.command(['system/scheduler/remove', `=.id=${row['.id']}`]);
  await api.command(['system/scheduler/add', `=name=${schedulerName}`, `=on-event=${scriptName}`, `=start-time=${time}`, `=interval=${interval}`, `=disabled=${enabled?'no':'yes'}`]);
  return {ok:true,name:schedulerName,script:scriptName,time,interval,enabled};
}

export async function disableBackupSchedule(client) {
  const api = await client.ensureApi();
  const rows = await api.print('system/scheduler/print',['.id','name']);
  for (const row of rows.filter(x=>x.name==='jeeey-ai-backup-schedule')) await api.command(['system/scheduler/set', `=.id=${row['.id']}`, '=disabled=yes']);
  return {ok:true,disabled:true};
}
