import assert from 'node:assert/strict';
import { searchMikrotikDocs } from './docs-research.mjs';
const fakeHtml='<a href="https://help.mikrotik.com/docs/display/ROS/API">RouterOS API</a><a href="https://example.com">ignore</a>';
const original=globalThis.fetch;
globalThis.fetch=async()=>new Response(fakeHtml,{status:200,headers:{'content-type':'text/html'}});
const r=await searchMikrotikDocs('RouterOS API',{limit:5});
assert.equal(r.results.length,1); assert.match(r.results[0].url,/mikrotik/);
globalThis.fetch=original;
console.log('DOCS_RESEARCH_TEST_OK');
