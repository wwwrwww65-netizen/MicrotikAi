import assert from 'node:assert/strict';
import { runGeminiAgent, GEMINI_TOOL_NAMES } from './gemini-agent.mjs';

assert(GEMINI_TOOL_NAMES.has('diagnose_network'));
assert(GEMINI_TOOL_NAMES.has('request_routeros_command'));

let round = 0;
const events = [];
const fakeFetch = async (_url, opts) => {
  JSON.parse(opts.body);
  round += 1;
  if (round === 1) {
    return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{id:'c1',name:'diagnose_network',args:{}}}]}}]}), {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'لا أستطيع تأكيد حالة الشبكة لأن أداة التشخيص فشلت.'}]}}]}), {status:200,headers:{'content-type':'application/json'}});
};

const result = await runGeminiAgent({
  apiKey:'test', model:'gemini-3.8-flash', message:'افحص الشبكة', systemInstruction:'اختبار', maxTurns:3,
  fetchImpl:fakeFetch,
  toolExecutor:async name => ({ok:false,error:`${name} failed in test`}),
  onEvent:e=>events.push(e)
});
assert.equal(result.toolErrors.length, 1);
assert(events.some(e=>e.type==='tool_error'));
assert(result.reply.includes('تعذر تنفيذ بعض أدوات الشبكة'));
console.log('GEMINI_TOOL_GUARD_TEST_OK');
