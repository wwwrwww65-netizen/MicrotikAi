function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export async function getNetworkNews(limit = 5, fetchImpl = globalThis.fetch) {
  const n = Math.min(10, Math.max(1, Number(limit) || 5));
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent('MikroTik RouterOS')}&hl=ar&gl=YE&ceid=YE:ar`;
  const response = await fetchImpl(url, { headers: { 'user-agent': 'Jeeey-Network-AI/1.0' } });
  if (!response.ok) throw new Error(`News HTTP ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n).map(m => {
    const block = m[1];
    const title = stripHtml((block.match(/<title>([\s\S]*?)<\/title>/i) || [,''])[1]);
    const link = stripHtml((block.match(/<link>([\s\S]*?)<\/link>/i) || [,''])[1]);
    const pubDate = stripHtml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [,''])[1]);
    const source = stripHtml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [,''])[1]);
    return { title, link, pubDate, source };
  }).filter(x => x.title);
  return { query: 'MikroTik RouterOS', count: items.length, items };
}
