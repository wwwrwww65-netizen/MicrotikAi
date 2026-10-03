import { runGeminiAgent } from './gemini-agent.mjs';

const events=[];
let generateCount=0;
const fakeFetch=async (url, opts={})=>{
  if (url.includes('/models?')) return new Response(JSON.stringify({models:[
    {name:'models/gemini-3.8-flash',displayName:'Gemini 3.8 Flash',supportedGenerationMethods:['generateContent']},
    {name:'models/gemini-3.7-flash',displayName:'Gemini 3.7 Flash',supportedGenerationMethods:['generateContent']}
  ]}),{status:200,headers:{'content-type':'application/json'}});
  generateCount++;
  const body=JSON.parse(opts.body);
  if (generateCount===1) return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{id:'call-1',name:'diagnose_network',args:{}}}]}}]}),{status:200,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'تم الفحص بنجاح.'}]}}]}),{status:200,headers:{'content-type':'application/json'}});
};
const result=await runGeminiAgent({
  apiKey:'test', model:'auto', message:'اختبر', systemInstruction:'اختبار', maxTurns:3,
  fetchImpl:fakeFetch,
  toolExecutor:async()=>({ok:true,answer:'TOOL_OK'}),
  onEvent:e=>events.push(e)
});
if (result.reply !== 'تم الفحص بنجاح.') throw new Error('final reply failed');
if (!events.some(e=>e.type==='tool_start')) throw new Error('tool_start event missing');
if (!events.some(e=>e.type==='tool_result')) throw new Error('tool_result event missing');
if (!events.some(e=>e.type==='model_selected')) throw new Error('model_selected event missing');
console.log('AI_STREAM_TOOL_EVENTS_TEST_OK');
