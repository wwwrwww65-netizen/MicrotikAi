import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'router-vault.json');
const DEFAULT_ID = 'main';

function keyMaterial() {
  const raw = process.env.FLEET_VAULT_KEY || process.env.APP_API_KEY || 'change-this-key';
  return crypto.createHash('sha256').update(raw).digest();
}
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(box) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  const data = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(data);
}
async function readVault() {
  try {
    const box = JSON.parse(await fs.readFile(FILE, 'utf8'));
    const items = decrypt(box);
    return Array.isArray(items) ? items : [];
  } catch { return []; }
}
async function writeVault(items) {
  await fs.writeFile(FILE, JSON.stringify(encrypt(items), null, 2), { mode: 0o600 });
}

export function envMainRouter() {
  return {
    id: DEFAULT_ID,
    name: process.env.MIKROTIK_NAME || process.env.MIKROTIK_HOST || 'Main MikroTik',
    host: process.env.MIKROTIK_HOST || '172.16.0.1',
    port: Number(process.env.MIKROTIK_PORT || 8728),
    user: process.env.MIKROTIK_USER || '',
    pass: process.env.MIKROTIK_PASS || '',
    mode: (process.env.MIKROTIK_MODE || 'v6api').toLowerCase(),
    secure: String(process.env.MIKROTIK_API_SSL || 'false').toLowerCase() === 'true',
    enabled: true,
    source: 'env'
  };
}

export async function listRouters({ includeSecrets = false } = {}) {
  const custom = await readVault();
  const all = [envMainRouter(), ...custom.filter(x => x.id !== DEFAULT_ID)];
  return all.map(r => includeSecrets ? r : {
    ...r,
    pass: undefined,
    hasPassword: Boolean(r.pass),
  });
}
export async function getRouter(id = DEFAULT_ID) {
  if (!id || id === DEFAULT_ID) return envMainRouter();
  const custom = await readVault();
  const r = custom.find(x => x.id === id);
  if (!r) throw new Error('الراوتر غير موجود.');
  return r;
}
export async function upsertRouter(input = {}) {
  const custom = await readVault();
  const id = String(input.id || crypto.randomUUID());
  const item = {
    id,
    name: String(input.name || input.host || id).trim().slice(0, 100),
    host: String(input.host || '').trim(),
    port: Number(input.port || 8728),
    user: String(input.user || '').trim(),
    pass: String(input.pass || ''),
    mode: String(input.mode || 'v6api').toLowerCase(),
    secure: Boolean(input.secure),
    enabled: input.enabled !== false,
    source: 'vault',
    updatedAt: new Date().toISOString(),
  };
  if (!item.host || !item.user || !item.pass) throw new Error('اسم الراوتر والعنوان واسم المستخدم وكلمة المرور مطلوبة.');
  const idx = custom.findIndex(x => x.id === id);
  if (idx >= 0) custom[idx] = { ...custom[idx], ...item };
  else custom.push(item);
  await writeVault(custom);
  return { ...item, pass: undefined, hasPassword: true };
}
export async function deleteRouter(id) {
  if (!id || id === DEFAULT_ID) throw new Error('لا يمكن حذف الراوتر الرئيسي الموجود في .env.');
  const custom = await readVault();
  const next = custom.filter(x => x.id !== id);
  await writeVault(next);
  return next.length !== custom.length;
}
export async function routerSummary() {
  return listRouters();
}
