import assert from 'node:assert/strict';
import { runGeminiAgent, GEMINI_TOOLS } from './gemini-agent.mjs';

let calls = [];
const responses = [];
const fakeFetch = async (url, _options) => {
  const model = decodeURIComponent(String(url).split('/models/')[1].split(':')[0]);
  calls.push(model);
  // Primary model is overloaded twice; the fallback model succeeds immediately.
  if (model === 'gemini-3.8-flash') {
    return {
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => JSON.stringify({ error: { message: 'busy' } })
    };
  }
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Fallback OK' }] } }]
    })
  };
};

process.env.GEMINI_MODEL_CHAIN = 'gemini-3.8-flash,gemini-3.7-flash';
const result = await runGeminiAgent({
  apiKey: 'test',
  model: 'gemini-3.8-flash',
  message: 'اختبار fallback',
  systemInstruction: 'اختبار',
  toolExecutor: async () => ({ ok: true }),
  fetchImpl: fakeFetch,
  maxTurns: 1
});

assert.equal(result.reply, 'Fallback OK');
assert.equal(result.model, 'gemini-3.7-flash');
assert.deepEqual(result.usedModels, ['gemini-3.7-flash']);
assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.7-flash']);
console.log('GEMINI_FALLBACK_TEST_OK');


// Quota exhaustion: every model fails with 429 quota, agent should fail fast
// with a distinct code so server.mjs can activate the local assistant.
let quotaCalls = 0;
const quotaFetch = async () => {
  quotaCalls += 1;
  return {
    ok: false,
    status: 429,
    headers: new Headers(),
    text: async () => JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded for this project' } })
  };
};
process.env.GEMINI_MODEL_CHAIN = 'quota-model-a,quota-model-b';
try {
  await runGeminiAgent({
    apiKey: 'test',
    model: 'quota-model-a',
    message: 'quota test',
    systemInstruction: 'test',
    toolExecutor: async () => ({ ok: true }),
    fetchImpl: quotaFetch,
    maxTurns: 1
  });
  assert.fail('Expected quota exhaustion');
} catch (error) {
  assert.equal(error.code, 'GEMINI_QUOTA_EXHAUSTED');
  assert.equal(quotaCalls, 3); // one attempt per model, no wasted retries on quota
}
console.log('GEMINI_QUOTA_FALLBACK_TEST_OK');
