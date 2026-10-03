import fs from 'node:fs';

function loadEnv(file = '.env') {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const key = env.GEMINI_API_KEY;
const configured = env.GEMINI_MODEL || 'gemini-3.8-flash';
const preferred = String(env.GEMINI_MODEL_CHAIN || `${configured},gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite`)
  .split(',').map(s => s.trim()).filter(Boolean);

if (!key) {
  console.error('Gemini key: MISSING');
  process.exit(2);
}

const base = 'https://generativelanguage.googleapis.com/v1beta';
const headers = { 'content-type': 'application/json', 'x-goog-api-key': key };
const tool = {
  functionDeclarations: [{
    name: 'get_test_status',
    description: 'Returns a fixed safe status used only to test Gemini function calling.',
    parameters: { type: 'object', properties: {} }
  }]
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const transient = status => [408, 429, 500, 502, 503, 504].includes(Number(status));

async function api(model, body, attempts = 2) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const r = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (r.ok) return data;
    last = new Error(`Gemini ${r.status}: ${data?.error?.message || text.slice(0, 500)}`);
    last.status = r.status;
    if (!transient(r.status) || attempt === attempts - 1) throw last;
    await sleep(600);
  }
  throw last;
}

console.log('Gemini key: configured');
console.log(`Primary model: ${configured}`);

let success = false;
let selected = null;
const failures = [];

for (const model of [...new Set(preferred)]) {
  try {
    const first = await api(model, {
      contents: [{ role: 'user', parts: [{ text: 'استدعِ أداة get_test_status فقط لإجراء فحص آمن.' }] }],
      tools: [tool],
      toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['get_test_status'] } },
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } }
    });

    const parts = first?.candidates?.[0]?.content?.parts || [];
    const fc = parts.map(p => p.functionCall).find(Boolean);
    if (!fc) {
      failures.push(`${model}: no-function-call`);
      continue;
    }

    const second = await api(model, {
      contents: [
        { role: 'user', parts: [{ text: 'استدعِ أداة get_test_status وأعد النتيجة.' }] },
        first.candidates[0].content,
        { role: 'user', parts: [{ functionResponse: { id: fc.id, name: fc.name, response: { result: { ok: true, message: 'TOOL_EXECUTION_OK' } } } }] }
      ],
      tools: [tool],
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } }
    });

    const finalText = (second?.candidates || [])
      .flatMap(c => c?.content?.parts || [])
      .map(p => p?.text || '')
      .filter(Boolean).join('\n').trim();

    selected = model;
    success = true;
    console.log(`Function calling ${model}: OK${finalText ? ` — ${finalText.slice(0, 240)}` : ''}`);
    break;
  } catch (e) {
    failures.push(`${model}: ${e.status || 'ERR'} — ${e.message}`);
    console.log(`Function calling ${model}: FAILED — ${e.message}`);
    if ([400, 401, 402, 403].includes(Number(e.status))) {
      // 400/401/402/403 are configuration/auth/billing issues, not transient model outages.
      break;
    }
  }
}

if (!success) {
  console.error('GEMINI_FUNCTION_CALL_CHECK_FAILED');
  for (const item of failures) console.error(`- ${item}`);
  process.exit(5);
}

console.log(`Selected model: ${selected}`);
if (failures.length) console.log(`Fallbacks skipped/failed: ${failures.length}`);
console.log('GEMINI_FUNCTION_CALL_CHECK_OK');
