function stripHtml(s) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function extractLinks(html) {
  const out=[];
  const re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m=re.exec(html))) {
    const href=m[1]; const title=stripHtml(m[2]);
    if (!title || title.length<4) continue;
    const url=href.startsWith('http')?href:(href.startsWith('//')?'https:'+href:null);
    if (url && /mikrotik|routeros/i.test(url)) out.push({title,url});
  }
  return out.slice(0,20);
}
export async function searchMikrotikDocs(query,{limit=8}={}) {
  const q=String(query||'').trim(); if(!q) throw new Error('أدخل موضوع البحث.');
  const url=`https://www.google.com/search?q=${encodeURIComponent(`site:help.mikrotik.com ${q}`)}&num=${Math.min(10,Math.max(1,limit))}`;
  try {
    const response=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 Jeeey-Network-AI/0.7'}});
    const html=await response.text();
    if(!response.ok) throw new Error(`فشل البحث في وثائق MikroTik: HTTP ${response.status}`);
    const results=extractLinks(html);
    return {query:q,source:'MikroTik official docs search',results,available:true};
  } catch (error) {
    return {query:q,source:'MikroTik official docs search',results:[],available:false,error:error?.message||String(error)};
  }
}
