const $ = s => document.querySelector(s);
const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = String(value ?? ''); return el; };
const apiKey = localStorage.getItem('jeeey_api_key') || '';

async function api(path, opts = {}) {
  const headers = {'content-type':'application/json','x-api-key':apiKey,'x-router-id':state.routerId,...(opts.headers||{})};
  const res = await fetch(path, {...opts, headers});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const state = { overview:null, sales:null, alerts:[], ai:null, aiModels:[], chats:[], conversationId:null, backups:null, routers:[], routerId:localStorage.getItem('jeeey_router_id')||'main' };
const AI_MODEL_KEY='jeeey_ai_model_selection';
const MODEL_LABELS={
  'gemini-3.8-flash':'Gemini 3.8 Flash', 'gemini-3.7-flash':'Gemini 3.7 Flash', 'gemini-3.6-flash':'Gemini 3.6 Flash',
  'gemini-3.5-flash':'Gemini 3.5 Flash', 'gemini-3.5-flash-lite':'Gemini 3.5 Flash-Lite', 'gemini-3.1-flash-lite':'Gemini 3.1 Flash-Lite',
  'gemini-2.5-flash':'Gemini 2.5 Flash', 'gemini-2.5-flash-lite':'Gemini 2.5 Flash-Lite'
};
let activeToolTrace=null;
const TOOL_LABELS={diagnose_network:'تشخيص الشبكة',get_network_overview:'حالة الشبكة',get_network_memory:'قراءة ذاكرة الشبكة',refresh_network_memory:'تحديث ذاكرة الشبكة',get_hotspot_users:'فحص مستخدمي HotSpot',get_interfaces:'فحص الواجهات',monitor_interface:'مراقبة الواجهة',get_queues:'فحص الـQueues',get_logs:'فحص السجلات',get_usage_report:'تحليل الاستهلاك',get_sales_summary:'فحص المبيعات',get_network_news:'جلب الأخبار',prepare_repair:'تحضير خطة الإصلاح',request_routeros_command:'تنفيذ أمر RouterOS'};
function selectedAiModel(){return localStorage.getItem(AI_MODEL_KEY)||'auto';}
function modelLabel(name){return MODEL_LABELS[name]||name||'Auto';}
function setupModelSelect(models){const select=$('#aiModelSelect'); if(!select)return; const current=selectedAiModel(); const items=[{name:'auto',displayName:'Auto • ديناميكي'},...(models||[])]; state.aiModels=items; select.innerHTML=items.map(m=>`<option value="${esc(m.name)}">${esc(m.displayName||modelLabel(m.name))}</option>`).join(''); select.value=items.some(m=>m.name===current)?current:'auto'; localStorage.setItem(AI_MODEL_KEY,select.value); setText('#aiLiveModel',select.value==='auto'?'Auto • ديناميكي':modelLabel(select.value));}
async function loadAiModels(){try{const r=await api('/api/ai/models'); setupModelSelect(r.models||[]);}catch{setupModelSelect([]);}}
function scrollToLatest(smooth = true){
  requestAnimationFrame(()=>{
    const stream = document.querySelector('.chat-stream-container');
    if(stream){
      if(smooth){
        stream.scrollTo({ top: stream.scrollHeight + 2000, behavior: 'smooth' });
      } else {
        stream.scrollTop = stream.scrollHeight + 2000;
      }
    }
    const lastEl = document.querySelector('#chat')?.lastElementChild;
    if(lastEl){
      try {
        lastEl.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      } catch(_) {}
    }
  });
}

function setThinkingText(text){const el=$('#thinkingMessage'); if(!el)return; const span=el.querySelector('.thinking-text'); if(span)span.textContent=String(text||'يفكر…'); scrollToLatest(false);}
function addToolStep(callId,name){const wrap=activeToolTrace || (()=>{const x=document.createElement('div');x.className='tool-trace';$('#chat')?.appendChild(x);return x;})(); const el=document.createElement('div'); el.className='tool-step running'; el.dataset.call=callId||`${Date.now()}-${Math.random()}`; el.innerHTML=`<span class="spinner" aria-hidden="true"></span><span>${esc(TOOL_LABELS[name]||name)}…</span><span class="tool-state">جارٍ</span>`; wrap.appendChild(el); scrollToLatest(true); return el;}
function finishToolStep(callId,ok,summary){const el=document.querySelector(`[data-call="${CSS.escape(callId||'')}"]`); if(!el)return; el.classList.remove('running'); el.classList.add(ok?'ok':'bad'); const sp=el.querySelector('.spinner'); if(sp){sp.outerHTML=ok?'<span class="check">✓</span>':'<span class="check">!</span>';} const st=el.querySelector('.tool-state'); if(st)st.textContent=summary|| (ok?'اكتمل':'فشل'); scrollToLatest(true);}
function bytes(n){ n=Number(n||0); const u=['B','KB','MB','GB','TB']; let i=0; while(n>=1024&&i<4){n/=1024;i++;} return `${n.toFixed(n>=100?0:n>=10?1:2)} ${u[i]}`; }
function kbps(n){ n=Number(n||0); if(n>=1_000_000) return `${(n/1_000_000).toFixed(1)} Mbps`; if(n>=1_000) return `${(n/1_000).toFixed(1)} Kbps`; return `${Math.round(n)} bps`; }
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function formatMarkdown(text){
  if(!text) return '';
  let s=String(text);
  const codeBlocks=[];
  s=s.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g,(_,lang,code)=>{
    const id=`__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({lang:lang||'code',code:code.trim()});
    return id;
  });
  const inlineCodes=[];
  s=s.replace(/`([^`\n]+)`/g,(_,code)=>{
    const id=`__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(code);
    return id;
  });
  s=esc(s);
  s=s.replace(/^### (.*$)/gim,'<h4 class="chat-h4">$1</h4>');
  s=s.replace(/^## (.*$)/gim,'<h3 class="chat-h3">$1</h3>');
  s=s.replace(/^# (.*$)/gim,'<h2 class="chat-h2">$1</h2>');
  s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/\*([^*]+)\*/g,'<em>$1</em>');
  s=s.replace(/^\s*[-*•]\s+(.*)$/gim,'<li class="chat-li">$1</li>');
  s=s.replace(/((?:<li class="chat-li">.*?<\/li>\n?)+)/gs,'<ul class="chat-ul">$1</ul>');
  s=s.replace(/\n\n+/g,'<div class="chat-spacer"></div>');
  s=s.replace(/\n/g,'<br>');
  codeBlocks.forEach((item,idx)=>{
    const safeCode=esc(item.code);
    const block=`<div class="code-box"><div class="code-box-head"><span>${esc(item.lang)}</span><button type="button" class="code-copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(item.code)}')).then(()=>toast('تم نسخ الكود'))">نسخ الكود</button></div><pre class="code-pre"><code>${safeCode}</code></pre></div>`;
    s=s.replace(`__CODE_BLOCK_${idx}__`,block);
  });
  inlineCodes.forEach((code,idx)=>{
    s=s.replace(`__INLINE_CODE_${idx}__`,`<code class="inline-code">${esc(code)}</code>`);
  });
  return s;
}

function addChat(text,who='bot',meta='',scroll=true){
  const chat=$('#chat'); if(!chat) return null;
  const el=document.createElement('div');
  el.className=`msg ${who==='me'?'me':'bot'}`;
  if(who==='me'){
    el.textContent=String(text??'');
  } else {
    el.innerHTML=`<div class="msg-content">${formatMarkdown(text)}</div>`;
  }
  if(meta){
    const m=document.createElement('div');
    m.className='msg-meta';
    m.innerHTML=`<span>${esc(meta)}</span>${who==='bot'?`<button class="chat-copy-btn" type="button" title="نسخ الرد" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(String(text??''))}')).then(()=>toast('تم نسخ الرد'))">📋 نسخ</button>`:''}`;
    el.appendChild(m);
  }
  chat.appendChild(el);
  if(scroll) scrollToLatest(true);
  return el;
}
function addThinking(){
  const chat=$('#chat'); if(!chat) return null;
  const el=document.createElement('div');
  el.className='msg bot thinking';
  el.id='thinkingMessage';
  el.innerHTML='<span class="thinking-text">يفكر…</span><span class="thinking-dots"><i></i><i></i><i></i></span>';
  chat.appendChild(el);
  scrollToLatest(true);
  return el;
}
function removeThinking(){ $('#thinkingMessage')?.remove(); }
function setChatMeta(text){ setText('#chatMeta',text); }
function toast(msg){ const t=$('#toast'); if(!t) return; t.textContent=String(msg??''); t.classList.add('show'); clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove('show'),2400); }
function setConnection(kind,text){
  const chip=$('#connectionChip');
  if(chip){
    const dot=chip.querySelector('.status-dot');
    chip.classList.remove('live','bad');
    if(dot){
      dot.classList.remove('live','bad');
      if(kind==='live') dot.classList.add('live');
      if(kind==='bad') dot.classList.add('bad');
    }
    if(chip.lastElementChild) chip.lastElementChild.textContent=String(text??'');
  }
  const sideDot=$('#sidebarStatusDot');
  if(sideDot) sideDot.className=`status-dot ${kind==='live'?'live':kind==='bad'?'bad':''}`;
  setText('#sidebarRouterMeta', text);
}

function themeMode(){ return localStorage.getItem('jeeey_theme') || 'auto'; }
function applyTheme(){ const mode=themeMode(); document.documentElement.dataset.theme=mode; const label=mode==='dark'?'مظهر نهاري':mode==='light'?'مظهر ليلي':'تلقائي'; const btn=$('#themeToggle'); if(btn){ btn.title=label; btn.textContent=mode==='dark'?'☀':mode==='light'?'☾':'◐'; } }
function cycleTheme(){ const next={auto:'dark',dark:'light',light:'auto'}[themeMode()]; localStorage.setItem('jeeey_theme',next); applyTheme(); toast(next==='auto'?'تم استخدام مظهر الجهاز':next==='dark'?'تم التفعيل: ليلي':'تم التفعيل: نهاري'); }
const PAGE_TITLES={overview:'نظرة عامة',network:'الشبكة والأداء',users:'المستخدمون',alerts:'التنبيهات',routers:'الأجهزة',analytics:'التحليلات',assistant:'المساعد الذكي',commands:'الترمنل',sales:'المبيعات',backups:'النسخ الاحتياطي'};
function navActivate(id){ document.querySelectorAll('[data-nav]').forEach(x=>x.classList.toggle('active',x.dataset.nav===id)); }
function setRoute(id, updateHash=true){
  const page=PAGE_TITLES[id]?id:'overview';
  document.body.classList.toggle('page-assistant-active', page==='assistant');
  document.querySelectorAll('.route-page').forEach(x=>x.classList.toggle('is-active',x.id===page));
  navActivate(page);
  const heading=$('.topbar h1'); if(heading) heading.textContent=PAGE_TITLES[page];
  document.title=`${PAGE_TITLES[page]} • Jeeey Network AI`;
  if(updateHash){ history.replaceState(null,'',`#${page}`); }
  $('.sidebar')?.classList.remove('open');
  $('#sidebarBackdrop')?.classList.remove('open');
  $('#mobileMenu')?.setAttribute('aria-expanded','false');
  if(page==='backups') loadBackups();
  if(page==='routers') loadRouters();
  if(page==='analytics') loadAnalytics();
  if(page==='assistant') {
    if(!state.conversationId) loadChats().catch(()=>{});
    setTimeout(()=>scrollToLatest(false), 80);
  }
  if(window.innerWidth<=900 && page!=='assistant') window.scrollTo({top:0,behavior:'smooth'});
}
function setupNav(){
  document.querySelectorAll('[data-nav]').forEach(a=>a.addEventListener('click',e=>{ e.preventDefault(); setRoute(a.dataset.nav,true); }));
  const initial=(location.hash||'#overview').slice(1);
  setRoute(PAGE_TITLES[initial]?initial:'overview',false);
  window.addEventListener('hashchange',()=>{ const id=(location.hash||'#overview').slice(1); setRoute(PAGE_TITLES[id]?id:'overview',false); });
}

async function loadRouters(){
  try{
    const r=await api('/api/routers'); state.routers=r.routers||[];
    const select=$('#routerSelect');
    if(select){ select.innerHTML=state.routers.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.host)}</option>`).join(''); if(state.routers.some(x=>x.id===state.routerId)) select.value=state.routerId; else {state.routerId='main';localStorage.setItem('jeeey_router_id','main');select.value='main';}}
    renderRouterCards();
  }catch(e){ toast('تعذر قراءة أجهزة الشبكة'); }
}
function renderRouterCards(){
  const host=$('#routerCards'); if(!host)return;
  host.innerHTML=state.routers.map(r=>`<article class="router-fleet-card ${r.id===state.routerId?'active':''}">
    <div class="fleet-card-top"><div><span class="eyebrow">${r.id==='main'?'الرئيسي':'جهاز'}</span><h3>${esc(r.name||r.host)}</h3></div><span class="soft-badge">${esc(r.mode||'v6api')}</span></div>
    <div class="fleet-meta"><span>${esc(r.host)}:${esc(r.port)}</span><span>${r.id===state.routerId?'● مستخدم حالي':'○ متاح'}</span></div>
    <div class="button-row"><button class="ghost-btn use-router" data-router="${esc(r.id)}">استخدام</button><button class="ghost-btn test-router" data-router="${esc(r.id)}">اختبار</button>${r.id!=='main'?`<button class="ghost-btn danger-outline delete-router" data-router="${esc(r.id)}">حذف</button>`:''}</div>
  </article>`).join('')||'<div class="history-empty">لا توجد أجهزة.</div>';
  host.querySelectorAll('.use-router').forEach(b=>b.onclick=()=>switchRouter(b.dataset.router));
  host.querySelectorAll('.test-router').forEach(b=>b.onclick=async()=>{try{const r=await api(`/api/routers/${encodeURIComponent(b.dataset.router)}/test`,{method:'POST'});toast(`اتصال ناجح • ${r.resource?.version||'RouterOS'}`);}catch(e){toast(e.message);}});
  host.querySelectorAll('.delete-router').forEach(b=>b.onclick=async()=>{if(!confirm('حذف هذا الراوتر من الأسطول؟'))return;try{await api(`/api/routers/${encodeURIComponent(b.dataset.router)}`,{method:'DELETE'});await loadRouters();toast('تم حذف الراوتر');}catch(e){toast(e.message);}});
}
async function switchRouter(id){ state.routerId=id||'main'; localStorage.setItem('jeeey_router_id',state.routerId); const select=$('#routerSelect'); if(select)select.value=state.routerId; renderRouterCards(); toast('تم تغيير الراوتر الحالي'); await refresh(); if(location.hash==='#analytics') await loadAnalytics(); }
async function loadAnalytics(){
  try{
    const hours=Number($('#analyticsHours')?.value||24); const [r,a]=await Promise.all([api(`/api/traffic/history?routerId=${encodeURIComponent(state.routerId)}&hours=${hours}`),api(`/api/traffic/anomalies?routerId=${encodeURIComponent(state.routerId)}&hours=${hours}`)]);
    const s=r.summary||{}; setText('#avgRx',kbps(s.avgRxBps)); setText('#avgTx',kbps(s.avgTxBps)); setText('#peakRx',kbps(s.peakRxBps)); setText('#anomalyCount',a.anomalies?.length||0); setText('#analyticsMeta',`${s.samples||0} عينة • ${s.interface||'—'} • آخر تحديث ${s.lastAt||'—'}`);
    const bars=$('#trafficBars'); if(bars){ const rows=(r.samples||[]).slice(-30); const peak=Math.max(1,...rows.map(x=>Math.max(Number(x.rxBitsPerSecond||0),Number(x.txBitsPerSecond||0)))); bars.innerHTML=rows.map(x=>`<div class="traffic-bar"><span class="bar-label">${new Date(x.at).toLocaleTimeString('ar-YE',{hour:'2-digit',minute:'2-digit'})}</span><div class="bar-track"><i class="rx" style="width:${Math.max(2,Math.round(Number(x.rxBitsPerSecond||0)/peak*100))}%"></i><i class="tx" style="width:${Math.max(1,Math.round(Number(x.txBitsPerSecond||0)/peak*100))}%"></i></div></div>`).join('')||'<div class="history-empty">لا توجد بيانات تاريخية بعد. أبقِ التطبيق يعمل لبضع دقائق لجمع العينات.</div>'; }
    const list=$('#anomaliesList'); if(list){ list.innerHTML=(a.anomalies||[]).slice(-20).reverse().map(x=>`<div class="simple-list-row"><strong>${esc(x.type)}</strong><span>${esc(x.interface||'—')}</span><small>${esc(x.at||'')}</small></div>`).join('')||'<div class="history-empty">لا توجد مؤشرات غير طبيعية.</div>'; }
  }catch(e){ setText('#analyticsMeta',e.message); }
}
function askAiAboutProblem(promptText){
  const promptInput=$('#prompt');
  if(promptInput){
    promptInput.value=promptText;
    promptInput.style.height='auto';
  }
  setRoute('assistant',true);
  sendPrompt(promptText);
}

function renderOverview(o,s,alerts,ai){
  state.overview=o; state.sales=s; state.alerts=alerts; state.ai=ai;
  const routerOS = o.mode==='routeros';
  if(routerOS) setConnection('live','متصل بـ RouterOS'); else setConnection('bad','وضع تجريبي');
  setText('#sidebarRouterName', o.resource?.['board-name'] || 'MikroTik');
  setText('#sidebarRouterMeta', `RouterOS ${o.resource?.version || '—'}`);
  setText('#routerModel', o.resource?.['board-name'] || 'MikroTik');
  setText('#routerVersion', o.resource?.version || '—');
  setText('#routerArch', o.resource?.['architecture-name'] || o.resource?.cpu || '—');
  setText('#routerUptime', o.resource?.uptime || '—');
  setText('#routerMode', routerOS?'متصل فعليًا':'Demo');
  setText('#aiProviderBadge', ai?.provider==='gemini'?'Gemini':ai?.provider==='openai-compatible'?'AI خارجي':'محلي');
  setText('#assistantStatus', ai?.configured?'متصل':'محلي');

  const activeUsers=o.users||[]; const total=activeUsers.reduce((x,u)=>x+Number(u.totalBytes||0),0); const openAlerts=(alerts||[]).filter(a=>!a.acknowledged);
  const criticalAlerts=openAlerts.filter(a=>a.severity==='critical');
  const cpu=Number(o.resource?.['cpu-load']||0);
  const health = criticalAlerts.length ? 'حرج' : openAlerts.length ? 'يحتاج انتباه' : cpu>=80 ? 'ضغط مرتفع' : 'مستقرة';
  
  let problemMsg = '';
  let problemBadge = '';
  let problemPrompt = '';

  if(criticalAlerts.length > 0){
    problemMsg = criticalAlerts[0].message;
    problemBadge = '🚨 عطل حرج رُصد';
    problemPrompt = `تم رصد عطل حرج في شبكة RouterOS: "${problemMsg}". اشرح لي سبب المشكلة الدقيق، وقدّم خطوات الحل والإجراء الفوري المناسب.`;
  } else if(openAlerts.length > 0){
    problemMsg = openAlerts[0].message;
    problemBadge = '⚠️ تنبيه يحتاج متابعة';
    problemPrompt = `يوجد تنبيه نشط في الشبكة: "${problemMsg}". كيف نقوم بمعالجته والتحقق من عدم تأثيره على المشتركين؟`;
  } else if(cpu >= 80){
    problemMsg = `استهلاك المعالج مرتفع حاليًا بنسبة ${cpu}%، مما قد يؤدي لبطء استجابة المشتركين.`;
    problemBadge = '⚡ حمل معالج مرتفع';
    problemPrompt = `استهلاك المعالج في الراوتر مرتفع بنسبة ${cpu}%. ما هي الجلسات والعمليات المسببة وكيف نخفض الحمل فورًا؟`;
  } else {
    problemMsg = 'جميع العمليات والمؤشرات تعمل بشكل سليم. لا توجد تنبيهات حرجة مفتوحة.';
    problemBadge = '✓ الشبكة مستقرة';
    problemPrompt = 'أجرِ فحصاً شاملاً لحالة الراوتر والمستخدمين والواجهات وقدم تقريراً ملخصاً.';
  }

  setText('#healthTitle', health==='مستقرة'?'الشبكة مستقرة':health==='يحتاج انتباه'?'توجد تنبيهات تحتاج متابعة':'تم رصد مشكلة تحتاج إجراء');
  setText('#healthSub', health==='مستقرة'?'القراءات الحالية لا تظهر مؤشرات حرجة.':'تفاصيل المشكلة موضحة أدناه ويمكنك حلها مباشرة مع المساعد الذكي.');
  setText('#heroProblemText', problemMsg);
  setText('#heroProblemBadge', problemBadge);

  const fixBtn = $('#heroFixBtn');
  if(fixBtn) fixBtn.onclick = () => askAiAboutProblem(problemPrompt);

  const orb=$('#healthOrb'); const score=health==='مستقرة'?82:health==='يحتاج انتباه'?56:26; if(orb){ orb.style.background=`conic-gradient(var(--${health==='مستقرة'?'success':'danger'}) 0 ${score}%, var(--surface-3) ${score}% 100%)`; const orbText=orb.querySelector('span'); if(orbText) orbText.textContent=health==='مستقرة'?'✓':'!'; }
  setText('#heroCpu', `${o.resource?.['cpu-load']??'—'}%`); setText('#heroRam', o.resource?.['total-memory']?`${Math.round((1-Number(o.resource['free-memory']||0)/Number(o.resource['total-memory']))*100)}%`:'—'); setText('#heroUsers', activeUsers.length); setText('#heroAlerts', openAlerts.length);
  setText('#kpiUsers', activeUsers.length); setText('#kpiUsage', bytes(total)); setText('#kpiSales', Number(s.summary.total||0).toLocaleString('ar-YE')); setText('#kpiSalesCount', `${s.summary.count||0} عملية`); setText('#kpiAlerts', openAlerts.length); setText('#lastUpdate', new Date().toLocaleTimeString('ar-YE',{hour:'2-digit',minute:'2-digit'})); setText('#usersCountBadge', `${activeUsers.length} متصل`);

  // Active Users on Users page
  $('#users').innerHTML=activeUsers.slice(0,20).map(u=>`<tr><td><strong>${esc(u.user)}</strong></td><td dir="ltr">${esc(u.ip)}</td><td>${esc(u.uptime)}</td><td><strong>${bytes(u.totalBytes)}</strong></td></tr>`).join('')||'<tr><td colspan="4" class="muted">لا توجد جلسات نشطة.</td></tr>';

  // Overview Active Users Widget
  const overviewUsersTable = $('#overviewUsers');
  if(overviewUsersTable){
    overviewUsersTable.innerHTML=activeUsers.slice(0,5).map(u=>`<tr><td><strong>${esc(u.user)}</strong></td><td dir="ltr">${esc(u.ip)}</td><td>${esc(u.uptime)}</td><td><strong>${bytes(u.totalBytes)}</strong></td></tr>`).join('')||'<tr><td colspan="4" class="muted">لا توجد جلسات نشطة حالياً.</td></tr>';
  }

  const interfaces=o.ifaceStats||[];
  $('#interfaces').innerHTML=interfaces.map(x=>`<div class="iface"><div class="iface-top"><div><div class="iface-name" title="${esc(x.name)}">${esc(x.name)}</div><div class="iface-meta">${esc(x.type||'interface')}</div></div><span class="iface-status ${x.running?'ok':'bad'}">${x.running?'● يعمل':'● متوقف'}</span></div><div class="iface-stats"><div class="iface-stat"><span>RX</span><strong>${bytes(x.rxBytes)}</strong></div><div class="iface-stat"><span>TX</span><strong>${bytes(x.txBytes)}</strong></div></div><div class="iface-meta" style="margin-top:8px">Queue drops: ${Number(x.txQueueDrop||0).toLocaleString('ar')}</div></div>`).join('')||'<div class="muted">لا توجد واجهات.</div>';

  const activeIf=interfaces.filter(x=>x.running).sort((a,b)=>(Number(b.rxBytes)+Number(b.txBytes))-(Number(a.rxBytes)+Number(a.txBytes))).slice(0,8);
  const max=Math.max(1,...activeIf.map(x=>Number(x.rxBytes)+Number(x.txBytes)));
  $('#trafficVisual').innerHTML=`<div class="traffic-axis"></div>${activeIf.map(x=>{const v=Math.max(8,Math.round(((Number(x.rxBytes)+Number(x.txBytes))/max)*100)); const tv=Math.max(6,Math.round((Number(x.txBytes)/Math.max(1,Number(x.rxBytes)+Number(x.txBytes)))*v)); return `<div class="traffic-bar" style="height:${v}%" title="${esc(x.name)} RX ${bytes(x.rxBytes)}"></div><div class="traffic-bar tx" style="height:${tv}%" title="${esc(x.name)} TX ${bytes(x.txBytes)}"></div>`}).join('')}`;
  const primary=activeIf[0]; setText('#trafficPrimary', primary?primary.name:'—'); setText('#trafficPrimaryMeta', primary?`RX ${bytes(primary.rxBytes)} • TX ${bytes(primary.txBytes)}`:'لا توجد واجهة نشطة');

  const alertItems=(alerts||[]).slice(0,9);
  setText('#alertCount', `${alertItems.length} مفتوح`);

  // Alerts Page List with AI Diagnostic button
  $('#alertsList').innerHTML=alertItems.map(a=>`<article class="alert ${a.severity==='critical'?'critical':'warning'}">
    <div class="alert-head">
      <div><strong class="alert-tag">${a.severity==='critical'?'حرج':'تنبيه'}</strong></div>
      <div class="alert-actions-row">
        <button class="ghost-btn compact ask-ai-btn" data-alert-msg="${esc(a.message)}" type="button"><span>✦</span> اسأل المساعد الذكي</button>
        <button class="text-btn" data-ack="${esc(a.id)}" type="button">تمت المتابعة</button>
      </div>
    </div>
    <p>${esc(a.message)}</p>
    <time>${new Date(a.at).toLocaleString('ar-YE')}</time>
  </article>`).join('')||'<article class="alert"><strong>لا توجد تنبيهات</strong><p>لا توجد مؤشرات مفتوحة حاليًا.</p></article>';

  // Overview Alerts Widget with direct AI Consultation
  const overviewAlertsList = $('#overviewAlertsList');
  if(overviewAlertsList){
    const previewAlerts = (openAlerts.length ? openAlerts : (alerts||[])).slice(0,4);
    overviewAlertsList.innerHTML = previewAlerts.map(a=>`<div class="overview-alert-item ${a.severity==='critical'?'critical':''}">
      <div class="overview-alert-top">
        <span class="soft-badge ${a.severity==='critical'?'danger':''}">${a.severity==='critical'?'عطل حرج':'تنبيه'}</span>
        <time>${new Date(a.at).toLocaleTimeString('ar-YE',{hour:'2-digit',minute:'2-digit'})}</time>
      </div>
      <p class="overview-alert-text">${esc(a.message)}</p>
      <div class="overview-alert-actions">
        <button class="ghost-btn compact ask-ai-btn" data-alert-msg="${esc(a.message)}" type="button"><span>✦</span> استشارة وحل بالمساعد</button>
        <button class="text-btn" data-ack="${esc(a.id)}" type="button">أرشفة</button>
      </div>
    </div>`).join('') || '<div class="muted" style="padding:16px;text-align:center">✓ لا توجد تنبيهات مفتوحة حالياً. الشبكة بحالة ممتازة.</div>';
  }

  // Wire all Ask AI and Ack buttons
  document.querySelectorAll('.ask-ai-btn').forEach(btn=>{
    btn.onclick = () => askAiAboutProblem(`يوجد تنبيه مسجل في الراوتر: "${btn.dataset.alertMsg}". ما هو سبب هذا التنبيه، وكيف أقوم بحله بالكامل؟`);
  });
  document.querySelectorAll('[data-ack]').forEach(btn=>btn.addEventListener('click',async()=>{try{await api(`/api/alerts/${btn.dataset.ack}`,{method:'POST'}); toast('تمت أرشفة التنبيه'); refresh();}catch(e){toast(e.message)}}));

  $('#sales').innerHTML=(s.sales||[]).slice(-12).reverse().map(x=>`<div class="sale"><div><strong>${esc(x.package)}</strong><div class="muted">${esc(x.user||'—')} • ${esc(x.seller||'—')}</div></div><strong>${Number(x.amount||0).toLocaleString('ar-YE')} ريال</strong></div>`).join('')||'<div class="muted">لا توجد عمليات مسجلة اليوم.</div>';
  setText('#salesSummary', `${Number(s.summary.total||0).toLocaleString('ar-YE')} ريال`);
}


async function loadChats(){
  try{
    const r=await api('/api/chats'); state.chats=r.chats||[]; renderChatList();
    if(!state.conversationId && state.chats[0]) await loadChat(state.chats[0].id, false);
    else if(!state.conversationId) await newChat(false);
  }catch(e){ toast('تعذر تحميل سجل المحادثات'); }
}
function renderChatList(){
  const box=$('#chatList'); if(!box)return;
  box.innerHTML=(state.chats||[]).map(c=>`<div class="chat-list-item ${c.id===state.conversationId?'active':''}" data-chat-id="${esc(c.id)}"><button class="chat-open" type="button"><strong>${esc(c.title||'محادثة جديدة')}</strong><span>${Number(c.messageCount||0)} رسالة</span></button><button class="chat-menu" type="button" title="خيارات">⋯</button></div>`).join('')||'<div class="muted history-empty">لا توجد محادثات بعد.</div>';
  box.querySelectorAll('.chat-open').forEach(btn=>btn.addEventListener('click',()=>loadChat(btn.parentElement.dataset.chatId, true)));
  box.querySelectorAll('.chat-menu').forEach(btn=>btn.addEventListener('click',async()=>{
    const id=btn.parentElement.dataset.chatId; const choice=prompt('اكتب: rename لإعادة التسمية أو delete للحذف','rename');
    if(choice==='delete'){ if(!confirm('حذف هذه المحادثة؟')) return; await api(`/api/chats/${id}`,{method:'DELETE'}); if(state.conversationId===id){state.conversationId=null; await loadChats();} else {await loadChats();} }
    else if(choice==='rename'){ const title=prompt('اسم المحادثة الجديد'); if(title?.trim()){ await api(`/api/chats/${id}`,{method:'PATCH',body:JSON.stringify({title})}); await loadChats(); } }
  }));
}
function renderChatMessages(chat){
  const chatBox=$('#chat'); if(!chatBox)return; chatBox.innerHTML='';
  (chat?.messages||[]).forEach(m=>addChat(m.content,m.role==='user'?'me':'bot',m.meta||'',false));
  if(!chat?.messages?.length) addChat('مرحبًا. هذه محادثة جديدة. اكتب طلبك وسأستخدم بيانات الشبكة الحقيقية والأدوات المتاحة.','bot','محادثة جديدة');
  scrollToLatest(false);
  setTimeout(()=>scrollToLatest(false), 60);
}
function openChatDrawer(){
  $('#chatHistoryDrawer')?.classList.add('open');
  $('#chatDrawerBackdrop')?.classList.add('open');
}
function closeChatDrawer(){
  $('#chatHistoryDrawer')?.classList.remove('open');
  $('#chatDrawerBackdrop')?.classList.remove('open');
}

async function loadChat(chatId, autoRoute=true){
  closeChatDrawer();
  const chat=await api(`/api/chats/${encodeURIComponent(chatId)}`);
  state.conversationId=chat.id;
  setText('#activeChatTitle',chat.title||'محادثة جديدة');
  renderChatMessages(chat);
  renderChatList();
  if(autoRoute) setRoute('assistant',true);
}
async function newChat(autoRoute=true){
  closeChatDrawer();
  const chat=await api('/api/chats',{method:'POST',body:JSON.stringify({title:'محادثة جديدة'})});
  state.conversationId=chat.id;
  state.chats=[chat,...(state.chats||[])];
  setText('#activeChatTitle','محادثة جديدة');
  renderChatMessages(chat);
  renderChatList();
  if(autoRoute)setRoute('assistant',true);
}
async function renameActiveChat(){
  if(!state.conversationId)return; const title=prompt('اسم المحادثة'); if(!title?.trim())return; const chat=await api(`/api/chats/${state.conversationId}`,{method:'PATCH',body:JSON.stringify({title})}); setText('#activeChatTitle',chat.title); await loadChats();
}
async function deleteActiveChat(){
  if(!state.conversationId)return; if(!confirm('هل تريد حذف المحادثة الحالية؟'))return; await api(`/api/chats/${state.conversationId}`,{method:'DELETE'}); state.conversationId=null; await loadChats();
}
function renderBackups(data){
  state.backups=data; const files=data.files||[]; setText('#backupCount',`${files.length} ملف`);
  const rows=$('#backupRows'); if(!rows)return;
  rows.innerHTML=files.sort((a,b)=>String(b['creation-time']||'').localeCompare(String(a['creation-time']||''))).map(f=>{
    const backup=/\.backup$/i.test(String(f.name||''));
    const action=backup?`<button class="text-btn" data-restore="${esc(f.name)}">استعادة</button>`:`<button class="text-btn" data-import="${esc(f.name)}">استيراد</button>`;
    return `<tr><td><strong>${esc(f.name||'—')}</strong></td><td>${backup?'Binary Backup':'RSC Export'}</td><td>${esc(f.size||'—')}</td><td>${esc(f['creation-time']||'—')}</td><td>${action}</td></tr>`;
  }).join('')||'<tr><td colspan="5" class="muted">لا توجد نسخ احتياطية/ملفات تصدير على الراوتر.</td></tr>';
  rows.querySelectorAll('[data-restore]').forEach(btn=>btn.addEventListener('click',async()=>{
    const name=btn.dataset.restore; const password=prompt('أدخل كلمة مرور النسخة. ستتم إعادة تشغيل الراوتر بعد الاستعادة:'); if(password===null)return; if(!confirm(`استعادة ${name} ستعيد تشغيل MikroTik. هل أنت متأكد؟`))return;
    try{ await api('/api/backups/restore',{method:'POST',body:JSON.stringify({name,password,confirm:true,routerId:state.routerId})}); toast('بدأت الاستعادة. الراوتر سيعيد التشغيل.'); }catch(e){toast(e.message);}
  }));
  rows.querySelectorAll('[data-import]').forEach(btn=>btn.addEventListener('click',async()=>{
    const name=btn.dataset.import; if(!confirm(`استيراد ${name} قد يغيّر إعدادات الراوتر. تأكيد؟`))return;
    try{ await api('/api/backups/import',{method:'POST',body:JSON.stringify({name,confirm:true,routerId:state.routerId})}); toast('تم إرسال الاستيراد. تحقق من الشبكة.'); }catch(e){toast(e.message);}
  }));
  const sc=(data.schedules||[])[0]; setText('#backupScheduleState',sc?`الجدولة: ${sc.interval||'—'} • ${sc['start-time']||'—'} • مرات التنفيذ: ${sc['run-count']||0} • ${String(sc.disabled)==='true'?'معطلة':'مفعلة'}`:'لا توجد جدولة Jeeey نشطة.');
}
async function loadBackups(){ try{const data=await api('/api/backups'); renderBackups(data);}catch(e){setText('#backupScheduleState',e.message);toast('تعذر قراءة النسخ الاحتياطية');}}

function addApproval(action){
  const wrap=document.createElement('div'); wrap.className='approval-card';
  const scripts=Array.isArray(action.plan?.scripts)?action.plan.scripts:[action.script||''];
  const issue=action.plan?.issue?`<div><strong>المشكلة:</strong> ${esc(action.plan.issue)}</div>`:'';
  wrap.innerHTML=`<div><strong>موافقة مطلوبة</strong>${issue}<div class="muted">${scripts.map(esc).join('<br>')}</div></div><button type="button">موافقة وتنفيذ</button>`;
  wrap.querySelector('button').onclick=async()=>{
    const btn=wrap.querySelector('button'); btn.disabled=true; btn.textContent='جارٍ التنفيذ…';
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),120000);
    try{
      const response=await fetch('/api/ai/approve-stream',{method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey},body:JSON.stringify({token:action.token}),signal:controller.signal});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      let final=null;
      await readSse(response,{
        repair_start:e=>{setChatMeta(`بدء خطة الإصلاح: ${e.steps} خطوة`);},
        repair_step_start:e=>{setThinkingText(`ينفذ خطوة الإصلاح ${Number(e.index)+1}…`); addChat(`🔧 ${e.script}`,'bot','إجراء إصلاح');},
        repair_step_result:e=>{setChatMeta(e.ok?'تمت خطوة الإصلاح بنجاح.':'فشلت خطوة الإصلاح.');},
        repair_rollback:e=>{addChat(e.ok?'↩️ تم التراجع عن التغيير بعد فشل التحقق.':'⚠️ تعذر التراجع الآلي بالكامل.','bot','Rollback');},
        done:e=>{final=e;}
      });
      const r=final||{};
      removeThinking();
      addChat(`نتيجة خطة الإصلاح:\n${JSON.stringify(r,null,2)}`,'bot','إصلاح الشبكة');
      wrap.remove(); refresh();
    }catch(e){ removeThinking(); btn.disabled=false; btn.textContent='موافقة وتنفيذ'; addChat('فشل تنفيذ الخطة: '+(e.name==='AbortError'?'انتهت المهلة':e.message),'bot'); }
    finally{clearTimeout(timeout);}
  };
  $('#chat').appendChild(wrap); scrollToLatest(true);
} 

async function refresh(){
  try{
    setConnection('','جاري تحديث البيانات…');
    const [o,s,a,ai]=await Promise.all([api('/api/overview'),api('/api/sales'),api('/api/alerts'),api('/api/ai/status')]);
    renderOverview(o,s,a,ai);
  }catch(e){
    setConnection('bad','فشل الاتصال');
    setText('#healthTitle', 'تعذر تحديث البيانات');
    setText('#healthSub', e.message);
    toast(e.message);
  }
}

async function readSse(response, handlers){
  if(!response.body) throw new Error('المتصفح لا يدعم بث نتائج المساعد.');
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';
  while(true){
    const {value,done}=await reader.read(); if(done)break;
    buffer += decoder.decode(value,{stream:true});
    const frames=buffer.split('\n\n'); buffer=frames.pop()||'';
    for(const frame of frames){
      const lines=frame.split('\n'); let event='message'; let data='';
      for(const line of lines){ if(line.startsWith('event:')) event=line.slice(6).trim(); else if(line.startsWith('data:')) data += line.slice(5).trim(); }
      if(!data)continue; let payload={}; try{payload=JSON.parse(data)}catch{payload={message:data};}
      handlers[event]?.(payload);
    }
  }
}

let aiBusy=false;
async function sendPrompt(text){
  const p=(text||'').trim(); if(!p||aiBusy)return;
  setRoute('assistant'); aiBusy=true;
  const send=$('#send'), prompt=$('#prompt'); if(send){send.disabled=true;send.setAttribute('aria-busy','true');} if(prompt)prompt.value='';
  addChat(p,'me'); const thinking=addThinking(); setText('#assistantStatus','يعمل الآن…'); setChatMeta('جاري تحليل الطلب…');
  const selected=selectedAiModel(); setText('#aiLiveModel',selected==='auto'?'Auto • ديناميكي':modelLabel(selected));
  const trace=document.createElement('div'); trace.className='tool-trace'; activeToolTrace=trace; $('#chat')?.appendChild(trace); scrollToLatest(true);
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),80000);
  try{
    const response=await fetch('/api/ai/chat-stream',{method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey},body:JSON.stringify({message:p,model:selected,conversationId:state.conversationId,routerId:state.routerId}),signal:controller.signal});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`HTTP ${response.status}`);}
    let finalResult=null;
    await readSse(response,{
      status:(e)=>{setThinkingText(e.message||'يفكر…');setChatMeta(e.message||'جاري التحليل…');},
      model_try:(e)=>{setThinkingText(`يتحقق من ${modelLabel(e.model)}…`);setChatMeta(`محاولة النموذج: ${modelLabel(e.model)}`);},
      model_selected:(e)=>{setText('#aiLiveModel',modelLabel(e.model));setThinkingText(`يعمل عبر ${modelLabel(e.model)}…`);},
      model_failed:(e)=>{setChatMeta(`${modelLabel(e.model)} غير متاح الآن، يبحث عن بديل…`);},
      tool_start:(e)=>{setThinkingText(`${TOOL_LABELS[e.name]||e.name}…`);setChatMeta(`أداة نشطة: ${TOOL_LABELS[e.name]||e.name}`);addToolStep(e.callId,e.name);},
      tool_result:(e)=>{finishToolStep(e.callId,e.ok,e.pendingApproval?'بانتظار الموافقة':(e.summary|| (e.ok?'اكتمل':'فشل')));},
      fallback:(e)=>{setThinkingText('يحوّل الطلب إلى المساعد المحلي…');setChatMeta('تعذر Gemini؛ يجري استخدام البديل المحلي.');},
      final:(e)=>{finalResult=e;},
      done:(e)=>{finalResult=e||finalResult;}
    });
    removeThinking();
    const r=finalResult||{};
    const modelMeta=r.model?`${modelLabel(r.model)}`:(r.provider==='gemini'?'Gemini':'المساعد المحلي');
    const traceCount=Array.isArray(r.toolTrace)?r.toolTrace.length:0; const fallbackMeta=r.fallbackReason?' • تم استخدام البديل':'​​';
    addChat(r.reply||'لم يرجع المساعد نصًا.','bot',`${modelMeta}${traceCount?` • استخدم ${traceCount} أداة`:''}${fallbackMeta}`);
    (r.pendingActions||[]).forEach(addApproval);
    setText('#assistantStatus',r.provider==='gemini'?`Gemini • ${modelLabel(r.model)}`:r.provider==='local-fallback'?'محلي • بديل':'محلي');
    setChatMeta(r.provider==='local-fallback'?'تم استخدام المساعد المحلي لأن نماذج Gemini لم تكن متاحة.':`${modelMeta}${traceCount?` • ${traceCount} أداة`:''}`);
  }catch(e){
    removeThinking(); const message=e.name==='AbortError'?'انتهت مهلة الطلب. لم يتم تنفيذ أي تغيير حساس.':`تعذر إكمال الطلب: ${e.message}`; addChat(message,'bot','حالة آمنة'); setText('#assistantStatus','خطأ'); setChatMeta('يمكنك المحاولة مرة أخرى.');
  }finally{
    clearTimeout(timer); activeToolTrace=null; aiBusy=false; if(send){send.disabled=false;send.removeAttribute('aria-busy');}
  }
}

const modelSelect=$('#aiModelSelect'); if(modelSelect) modelSelect.onchange=()=>{localStorage.setItem(AI_MODEL_KEY,modelSelect.value||'auto'); setText('#aiLiveModel',modelSelect.value==='auto'?'Auto • ديناميكي':modelLabel(modelSelect.value)); toast(modelSelect.value==='auto'?'تم اختيار الوضع الديناميكي Auto':`تم اختيار ${modelLabel(modelSelect.value)}`);};
const refreshBtn=$('#refresh'); if(refreshBtn) refreshBtn.onclick=()=>refresh(); const themeBtn=$('#themeToggle'); if(themeBtn) themeBtn.onclick=cycleTheme;
const sendBtn=$('#send'); if(sendBtn) sendBtn.onclick=()=>{ const p=$('#prompt'); sendPrompt(p?.value||''); if(p){p.style.height='auto';} };
const promptEl=$('#prompt'); if(promptEl){
  promptEl.addEventListener('input',()=>{ promptEl.style.height='auto'; promptEl.style.height=Math.min(promptEl.scrollHeight,150)+'px'; });
  promptEl.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendPrompt(promptEl.value); promptEl.style.height='auto'; } });
}
document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>sendPrompt(b.dataset.prompt)));
const quickScan=$('#quickScan'); if(quickScan) quickScan.onclick=()=>sendPrompt('افحص الشبكة بالكامل وأعطني خلاصة مختصرة مع أي مشكلة حرجة فقط.');
const heroScan=$('#heroScan'); if(heroScan) heroScan.onclick=()=>sendPrompt('افحص الشبكة بالكامل وأعطني حالة واضحة للراوتر والمستخدمين والواجهات والتنبيهات.');
const askTopUsers=$('#askTopUsers'); if(askTopUsers) askTopUsers.onclick=()=>sendPrompt('من أكثر 10 مستخدمين استهلاكًا الآن؟ أعطني الأسماء والاستهلاك ورتبهم.');
const trafficHelp=$('#openTrafficHelp'); if(trafficHelp) trafficHelp.onclick=()=>toast('عدادات RX/TX الحالية هنا تراكمية. القياس اللحظي يمكن طلبه من المساعد أو من أمر monitor-traffic.');

document.querySelectorAll('[data-command]').forEach(b=>b.addEventListener('click',()=>{const command=$('#command'); if(command){command.value=b.dataset.command||''; command.focus();} setRoute('commands');}));
const prepareBtn=$('#prepare');
const executeBtn=$('#execute');
if(prepareBtn){
  prepareBtn.onclick=async()=>{
    try{
      const command=$('#command');
      const r=await api('/api/commands/prepare',{method:'POST',body:JSON.stringify({script:command?.value||''})});
      if(executeBtn){ executeBtn.disabled=!r.allowed; executeBtn.dataset.ready=JSON.stringify(r); }
      setText('#commandResult', JSON.stringify(r,null,2));
    }catch(e){ setText('#commandResult', e.message); }
  };
}
if(executeBtn){
  executeBtn.onclick=async()=>{
    const rdy=JSON.parse(executeBtn.dataset.ready||'{}');
    if(!rdy.script){ toast('افحص الأمر أولًا'); return; }
    if(rdy.requiresApproval && !confirm('هذا الأمر قد يغيّر إعدادات الراوتر. هل تريد المتابعة؟')) return;
    try{
      const r=await api('/api/commands/execute',{method:'POST',body:JSON.stringify({script:rdy.script,approved:true,actor:'dashboard',routerId:state.routerId})});
      setText('#commandResult', JSON.stringify(r,null,2));
      toast('تم التنفيذ');
      refresh();
    }catch(e){ setText('#commandResult', e.message); }
  };
}

const newChatBtn=$('#newChat'); if(newChatBtn) newChatBtn.onclick=()=>newChat(true);
const newChatDrawerBtn=$('#newChatDrawer'); if(newChatDrawerBtn) newChatDrawerBtn.onclick=()=>newChat(true);
const toggleDrawerBtn=$('#toggleChatDrawer'); if(toggleDrawerBtn) toggleDrawerBtn.onclick=openChatDrawer;
const closeDrawerBtn=$('#closeChatDrawer'); if(closeDrawerBtn) closeDrawerBtn.onclick=closeChatDrawer;
const drawerBackdrop=$('#chatDrawerBackdrop'); if(drawerBackdrop) drawerBackdrop.onclick=closeChatDrawer;
const renameBtn=$('#renameChat'); if(renameBtn) renameBtn.onclick=renameActiveChat;
const deleteChatBtn=$('#deleteChat'); if(deleteChatBtn) deleteChatBtn.onclick=deleteActiveChat;
const refreshBackupsBtn=$('#refreshBackups'); if(refreshBackupsBtn) refreshBackupsBtn.onclick=loadBackups;
const createBackupBtn=$('#createBackup'); if(createBackupBtn) createBackupBtn.onclick=async()=>{
  const name=$('#backupName')?.value||`jeeey-manual-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}`; const password=$('#backupPassword')?.value||'';
  if(!password){toast('ضع كلمة مرور لتشفير النسخة');return;} if(!confirm('إنشاء نسخة Binary مشفّرة على الراوتر الآن؟'))return;
  try{await api('/api/backups/create',{method:'POST',body:JSON.stringify({name,password,confirm:true,routerId:state.routerId})});toast('تم إنشاء النسخة');loadBackups();}catch(e){toast(e.message);}
};
const exportBtn=$('#exportConfig'); if(exportBtn) exportBtn.onclick=async()=>{ const name=$('#backupName')?.value||`jeeey-export-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}`; if(!confirm('تصدير إعدادات RouterOS إلى ملف RSC؟'))return; try{await api('/api/backups/export',{method:'POST',body:JSON.stringify({name,confirm:true,routerId:state.routerId})});toast('تم تصدير الإعدادات');loadBackups();}catch(e){toast(e.message);} };
const scheduleBtn=$('#scheduleBackup'); if(scheduleBtn) scheduleBtn.onclick=async()=>{
  const time=$('#backupTime')?.value||'03:00'; const interval=$('#backupInterval')?.value||'1d'; const password=$('#schedulePassword')?.value||'';
  if(!password){toast('ضع كلمة مرور لتشفير النسخ المجدولة');return;} if(!confirm(`تفعيل نسخة تلقائية ${interval} عند ${time} على RouterOS؟`))return;
  try{await api('/api/backups/schedule',{method:'POST',body:JSON.stringify({time:time+':00',interval,password,confirm:true,routerId:state.routerId})});toast('تم حفظ الجدولة على الراوتر');loadBackups();}catch(e){toast(e.message);}
};
const disableScheduleBtn=$('#disableBackupSchedule'); if(disableScheduleBtn) disableScheduleBtn.onclick=async()=>{if(!confirm('تعطيل الجدولة؟'))return;try{await api('/api/backups/schedule/disable',{method:'POST',body:JSON.stringify({confirm:true,routerId:state.routerId})});toast('تم تعطيل الجدولة');loadBackups();}catch(e){toast(e.message);}};

function openMobileSidebar(){
  $('#sidebar')?.classList.add('open');
  $('#sidebarBackdrop')?.classList.add('open');
  $('#mobileMenu')?.setAttribute('aria-expanded','true');
}
function closeMobileSidebar(){
  $('#sidebar')?.classList.remove('open');
  $('#sidebarBackdrop')?.classList.remove('open');
  $('#mobileMenu')?.setAttribute('aria-expanded','false');
}
const mobileMenuBtn=$('#mobileMenu'); if(mobileMenuBtn) mobileMenuBtn.onclick=openMobileSidebar;
const sidebarCloseBtn=$('#sidebarClose'); if(sidebarCloseBtn) sidebarCloseBtn.onclick=closeMobileSidebar;
const sidebarBackdrop=$('#sidebarBackdrop'); if(sidebarBackdrop) sidebarBackdrop.onclick=closeMobileSidebar;

const hubAi=$('#hubAiDiagnostic'); if(hubAi) hubAi.onclick=()=>askAiAboutProblem('أجرِ تشخيصاً شاملاً لجميع قياسات ومؤشرات الراوتر والشبكة واقترح تحسينات.');
const hubUsers=$('#hubTopUsers'); if(hubUsers) hubUsers.onclick=()=>askAiAboutProblem('من هم أعلى 10 مستخدمين استهلاكاً للباندويث الآن؟ رتبهم مع استهلاكهم وعناوينهم.');
const hubSec=$('#hubSecurityAudit'); if(hubSec) hubSec.onclick=()=>askAiAboutProblem('افحص إعدادات الحماية وجدار الحماية وسجل محاولات الدخول على الراوتر بحثاً عن أي ثغرات أمنية.');
const hubTraf=$('#hubTrafficStability'); if(hubTraf) hubTraf.onclick=()=>askAiAboutProblem('حلل استقرار حركة المرور والواجهات، وهل توجد أي واجهة متوقفة أو بها drop queues؟');

setupNav(); applyTheme();
const routerSelect=$('#routerSelect'); if(routerSelect) routerSelect.onchange=()=>switchRouter(routerSelect.value);
const refreshRoutersBtn=$('#refreshRouters'); if(refreshRoutersBtn) refreshRoutersBtn.onclick=loadRouters;
const addRouterBtn=$('#addRouterBtn'); if(addRouterBtn) addRouterBtn.onclick=async()=>{try{const payload={name:$('#fleetName')?.value,host:$('#fleetHost')?.value,port:Number($('#fleetPort')?.value||8728),user:$('#fleetUser')?.value,pass:$('#fleetPass')?.value,mode:$('#fleetMode')?.value||'v6api'}; const created=await api('/api/routers',{method:'POST',body:JSON.stringify(payload)}); toast('تمت إضافة الراوتر'); ['#fleetName','#fleetHost','#fleetUser','#fleetPass'].forEach(x=>{const e=$(x);if(e)e.value='';}); await loadRouters(); try{const r=await api(`/api/routers/${encodeURIComponent(created.router.id)}/test`,{method:'POST'});toast(`تمت الإضافة والاتصال بنجاح • ${r.resource?.version||''}`);}catch(e){toast(`تمت الإضافة لكن الاختبار فشل: ${e.message}`);}}catch(e){toast(e.message);}};
const refreshAnalyticsBtn=$('#refreshAnalytics'); if(refreshAnalyticsBtn) refreshAnalyticsBtn.onclick=loadAnalytics;
loadAiModels(); loadChats(); loadBackups(); loadRouters(); refresh(); setInterval(()=>refresh().catch(()=>{}),60000); setInterval(()=>{if(location.hash==='#analytics')loadAnalytics().catch(()=>{});},60000);
