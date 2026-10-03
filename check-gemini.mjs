import fs from 'node:fs';

function loadEnv(path = '.env') {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const env = loadEnv();
const key = env.GEMINI_API_KEY;
const configuredModel = env.GEMINI_MODEL || 'gemini-3.8-flash';
if (!key) {
  console.error('GEMINI_API_KEY غير مضبوط في .env');
  process.exit(2);
}

const base = 'https://generativelanguage.googleapis.com/v1beta';
const headers = { 'x-goog-api-key': key, 'content-type': 'application/json' };

async function api(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${data?.error?.message || text.slice(0, 400)}`);
  return data;
}

console.log('Gemini key: configured');
console.log(`Configured model: ${configuredModel}`);

let modelData;
try {
  modelData = await api('/models?pageSize=1000');
} catch (e) {
  console.error(`Models API: FAILED — ${e.message}`);
  process.exit(3);
}

const usable = (modelData.models || [])
  .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
  .map(m => ({
    id: String(m.name || '').replace(/^models\//, ''),
    methods: m.supportedGenerationMethods || [],
    displayName: m.displayName || ''
  }))
  .filter(m => /^gemini-/i.test(m.id));

console.log(`Models visible to this key: ${usable.length}`);
for (const m of usable) console.log(`- ${m.id}${m.displayName ? ` — ${m.displayName}` : ''}`);

const preferred = [
  configuredModel,
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];
const candidates = [...new Set(preferred)].filter(id => usable.some(m => m.id === id));
if (!candidates.length) {
  console.error('No configured/candidate generateContent model is visible to this key.');
  process.exit(4);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const transient = status => [408, 429, 500, 502, 503, 504].includes(Number(status));
let tested = false;

for (const model of candidates) {
  let ok = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await api(`/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'رد فقط بكلمة OK' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8 }
        })
      });
      const text = (result?.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').filter(Boolean).join(' ').trim();
      console.log(`GenerateContent ${model}: OK${text ? ` — ${text}` : ''}`);
      console.log(`Selected working model: ${model}`);
      tested = true;
      ok = true;
      break;
    } catch (e) {
      console.log(`GenerateContent ${model}: FAILED — ${e.message}`);
      const status = Number(String(e.message).match(/^(\d+):/)?.[1] || 0);
      if (!transient(status) || attempt === 1) break;
      await sleep(600);
    }
  }
  if (ok) break;
}
if (!tested) process.exit(5);

console.log('GEMINI_CHECK_OK');
