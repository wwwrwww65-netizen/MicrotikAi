const DEFAULT_MODEL = 'gemini-3.8-flash';

const HARD_MAX_TURNS = 8;
const MAX_TOOL_RESULT_CHARS = 24000;

function clip(value, maxChars = 24000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= maxChars) return value;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function extractText(response) {
  return (response?.candidates || [])
    .flatMap(c => c?.content?.parts || [])
    .map(p => p?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractFunctionCalls(response) {
  return (response?.candidates || [])
    .flatMap(c => c?.content?.parts || [])
    .map(p => p?.functionCall)
    .filter(Boolean)
    .map(fc => ({
      id: fc.id || cryptoRandomId(),
      name: fc.name,
      args: fc.args || {}
    }));
}

function cryptoRandomId() {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'diagnose_network',
        description: 'تشخيص الشبكة الحالية من MikroTik: CPU وRAM وHotSpot والواجهات والـQueues والسجلات وحركة المرور الحية على الواجهة الرئيسية، ثم إعادة بيانات تشخيص منظمة. استخدمها عند طلب فحص الشبكة أو البطء أو وجود مشكلة.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'get_network_overview',
        description: 'قراءة حالة RouterOS الحالية: الموارد والواجهات ومستخدمي HotSpot والـQueues والسجلات والتنبيهات.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'get_hotspot_users',
        description: 'الحصول على المستخدمين النشطين في HotSpot وترتيبهم حسب مجموع bytes-in + bytes-out.',
        parameters: {
          type: 'object',
          properties: { limit: { type: 'integer', description: 'عدد المستخدمين المطلوب، من 1 إلى 100.' } }
        }
      },
      {
        name: 'get_interfaces',
        description: 'قراءة جميع واجهات MikroTik مع الاسم الحالي وdefault-name وحالة التشغيل والعدادات.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'monitor_interface',
        description: 'قياس RX/TX اللحظي لواجهة محددة. يجب استخدام الاسم الحالي للواجهة كما يظهر من get_interfaces، وليس default-name إذا كان الاسم قد تغير.',
        parameters: {
          type: 'object',
          properties: { interface: { type: 'string', description: 'اسم الواجهة الحالي، مثل IN أو Out.' } },
          required: ['interface']
        }
      },
      {
        name: 'get_queues',
        description: 'قراءة Simple Queues الحالية وإحصاءات السرعة والبايتات.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'get_logs',
        description: 'قراءة آخر سجلات MikroTik، خصوصًا critical وerror وwarning.',
        parameters: {
          type: 'object',
          properties: { limit: { type: 'integer', description: 'عدد السجلات من 1 إلى 100.' } }
        }
      },
      {
        name: 'get_usage_report',
        description: 'تحليل اللقطات التاريخية التي يجمعها المشروع لمعرفة تغيّر الاستهلاك، والواجهات الأكثر نشاطًا، وأعلى المستخدمين في الفترة بين آخر لقطتين.',
        parameters: {
          type: 'object',
          properties: { samples: { type: 'integer', description: 'عدد اللقطات الأخيرة المستخدمة، من 2 إلى 20.' } }
        }
      },
      {
        name: 'get_sales_summary',
        description: 'قراءة ملخص مبيعات اليوم والعمليات والمبالغ وأهم الباقات.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'get_network_news',
        description: 'جلب أحدث أخبار MikroTik وRouterOS من RSS عام عند طلب الأخبار أو المستجدات. لا تستخدمها في أسئلة الشبكة العادية.',
        parameters: {
          type: 'object',
          properties: { limit: { type: 'integer', description: 'عدد الأخبار من 1 إلى 10.' } }
        }
      },
      {
        name: 'get_network_memory',
        description: 'قراءة ذاكرة الشبكة الدائمة التي تم جمعها من الراوتر: هوية الجهاز، إصدار RouterOS، الواجهات وأسماؤها الحالية، العناوين، المسارات، DNS، HotSpot، الـQueues، وملخص Firewall. الذاكرة ليست بديلًا عن القراءة الحية، لكنها تمنع إعادة اكتشاف نفس المعلومات في كل سؤال.',
        parameters: { type: 'object', properties: {} }
      },
      { name: 'list_routers', description: 'عرض الراوترات المسجلة في لوحة الإدارة وحالتها التعريفية. لا يعرض كلمات المرور.', parameters: { type: 'object', properties: {} } },
      { name: 'get_router_status', description: 'قراءة حالة راوتر محدد في الأسطول. استخدم routerId عندما تريد راوترًا غير الرئيسي.', parameters: { type:'object', properties:{ routerId:{type:'string',description:'معرف الراوتر من list_routers.'} } } },
      { name: 'get_traffic_history', description: 'قراءة تاريخ حركة المرور المجمعة من التطبيق مع متوسطات وذروات لاحقة.', parameters: { type:'object', properties:{ routerId:{type:'string'}, hours:{type:'integer',description:'عدد الساعات المراد تحليلها.'} } } },
      { name: 'get_traffic_anomalies', description: 'كشف الارتفاعات غير المعتادة في RX/TX وQueue drops بناءً على التاريخ المتاح.', parameters: { type:'object', properties:{ routerId:{type:'string'}, hours:{type:'integer'} } } },
      { name: 'search_mikrotik_docs', description: 'البحث في وثائق MikroTik الرسمية على الويب عند الحاجة لمعلومة تقنية غير مؤكدة أو مرتبطة بإصدار RouterOS.', parameters: { type:'object', properties:{ query:{type:'string'}, limit:{type:'integer'} }, required:['query'] } },
      {
        name: 'refresh_network_memory',
        description: 'تحديث ذاكرة الشبكة من MikroTik الآن. استخدمها عندما تكون الذاكرة قديمة أو بعد تغيير إعدادات كبيرة.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'prepare_repair',
        description: 'إنشاء خطة إصلاح آمنة من خطوة أو عدة خطوات. هذه الأداة لا تنفذ التغيير؛ تجمع حالة قبل التنفيذ وتعرض خطة تحتاج موافقة المستخدم. بعد الموافقة ينفذ التطبيق الخطوات ويتحقق منها ويحاول التراجع باستخدام أوامر undo من RouterOS history إذا فشل فحص الصحة.',
        parameters: {
          type: 'object',
          properties: {
            issue: { type:'string', description:'وصف المشكلة التي يحاول الإصلاح معالجتها.' },
            reason: { type:'string', description:'الدليل الفني ولماذا هذه الخطة هي الحل المقترح.' },
            steps: { type:'array', items:{type:'string'}, description:'أوامر RouterOS بالترتيب. يجب أن تكون أقل عدد ممكن ومبررة.' },
            expectedChecks: { type:'array', items:{type:'string'}, description:'شروط تحقق عامة بعد التنفيذ.' }
          },
          required: ['issue','steps']
        }
      },
      {
        name: 'request_routeros_command',
        description: 'طلب تنفيذ أمر RouterOS صريح. استخدمها فقط عندما يطلب المستخدم التنفيذ أو الإصلاح أو عندما تكون هناك خطة إصلاح واضحة. القراءة فقط تنفذ تلقائيًا. أي تغيير يحتاج موافقة صريحة. لا تستخدم الأداة لتجاوز سياسة الأمان أو لتحويل تغيير إلى قراءة.',
        parameters: {
          type: 'object',
          properties: { script: { type: 'string', description: 'أمر RouterOS بصيغة Terminal المعتادة.' } },
          required: ['script']
        }
      }
    ]
  }
];

// Canonical allow-list derived from the actual Gemini tool declarations.
// This prevents runtime ReferenceError and keeps validation in sync with the schema.
export const GEMINI_TOOL_NAMES = new Set(
  GEMINI_TOOLS.flatMap(group => (group.functionDeclarations || []).map(fn => fn.name)).filter(Boolean)
);

const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];


const MODEL_PREFERRED_ORDER = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-pro-latest'
];

function modelBaseName(name) { return String(name || '').replace(/^models\//, ''); }
function looksLikeTextAgentModel(model) {
  const name = modelBaseName(model.name || model);
  const lower = name.toLowerCase();
  if (!name) return false;
  if (/(^|[-_])(live|tts|image|audio|transcrib|embedding|robotic|computer|deep-research|veo|lyria)([-_]|$)/i.test(lower)) return false;
  const methods = model.supportedGenerationMethods || model.methods || [];
  return methods.length ? methods.includes('generateContent') : /gemini-(?:3\.|2\.5).*?(flash|pro)/i.test(name);
}

export async function listAvailableGeminiModels({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || typeof fetchImpl !== 'function') return [];
  const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': apiKey }
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) throw new Error(`Gemini Models API ${response.status}: ${data?.error?.message || raw.slice(0, 500)}`);
  return (data.models || [])
    .filter(looksLikeTextAgentModel)
    .map(m => ({
      name: modelBaseName(m.name),
      displayName: m.displayName || modelBaseName(m.name),
      description: m.description || '',
      supportedGenerationMethods: m.supportedGenerationMethods || []
    }));
}

async function resolveModelChain(primary, {apiKey, fetchImpl} = {}) {
  const configured = getModelChain(primary);
  if (primary !== 'auto') {
    try {
      const available = await listAvailableGeminiModels({apiKey, fetchImpl});
      const names = available.map(m => m.name);
      const rank = MODEL_PREFERRED_ORDER.filter(x => names.includes(x));
      return [...new Set([primary, ...rank, ...configured])];
    } catch {
      return [...new Set(configured)];
    }
  }
  try {
    const available = await listAvailableGeminiModels({apiKey, fetchImpl});
    const names = available.map(m => m.name);
    const preferred = MODEL_PREFERRED_ORDER.filter(x => names.includes(x));
    const extras = available.map(m => m.name).filter(x => !preferred.includes(x));
    return [...new Set([...preferred, ...extras, ...DEFAULT_FALLBACK_MODELS])];
  } catch {
    return [...new Set(DEFAULT_FALLBACK_MODELS)];
  }
}

async function emit(onEvent, event) {
  try { await onEvent?.(event); } catch {}
}
const modelCooldownUntil = new Map();

function buildUrl(apiKey, model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function getModelChain(primary) {
  const envChain = String(process.env.GEMINI_MODEL_CHAIN || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  const chain = envChain.length ? envChain : [primary, ...DEFAULT_FALLBACK_MODELS];
  return [...new Set(chain)];
}

function getErrorMessage(data, raw = '') {
  return String(data?.error?.message || raw || '').trim();
}

function classifyGeminiError(status, data, raw = '') {
  const message = getErrorMessage(data, raw);
  const lower = message.toLowerCase();
  const code = String(data?.error?.status || data?.error?.code || '').toUpperCase();
  const numeric = Number(status);
  const quota = numeric === 429 && /quota|resource_exhausted|daily|per.?day|tokens?.*limit|limit.*tokens?/i.test(lower + ' ' + code);
  const rateLimit = numeric === 429 && !quota;
  const transient = [408, 500, 502, 503, 504].includes(numeric);
  const unavailable = [404, 501].includes(numeric);
  const auth = [400, 401, 402, 403].includes(numeric) && !quota;
  return { status: numeric, message, code, quota, rateLimit, transient, unavailable, auth };
}

function isTransientStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

function isModelUnavailableStatus(status) {
  return [404, 501].includes(Number(status));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestModel({ apiKey, model, body, fetchImpl }) {
  const now = Date.now();
  const cooldown = modelCooldownUntil.get(model) || 0;
  if (cooldown > now) {
    const error = new Error(`Model ${model} is cooling down`);
    error.code = 'MODEL_COOLDOWN';
    error.status = 503;
    throw error;
  }

  const maxRetries = Math.min(4, Math.max(0, Number(process.env.GEMINI_RETRIES ?? '2')));
  const baseDelay = Math.min(8000, Math.max(100, Number(process.env.GEMINI_RETRY_BASE_MS ?? '700')));
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(buildUrl(apiKey, model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body)
      });
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (response.ok) {
        modelCooldownUntil.delete(model);
        return data;
      }

      const err = new Error(`Gemini API ${response.status}: ${getErrorMessage(data, raw.slice(0, 500))}`);
      err.status = response.status;
      err.data = data;
      err.classification = classifyGeminiError(response.status, data, raw);
      lastError = err;

      // Retry only temporary overload/rate-limit/server errors. For quota exhaustion
      // we do not waste retries; we immediately let the fallback chain continue.
      if (err.classification.auth && !err.classification.quota) break;
      if (attempt < maxRetries && (err.classification.transient || err.classification.rateLimit) && !err.classification.quota) {
        const retryAfter = Number(response.headers?.get?.('retry-after') || 0);
        const delay = retryAfter > 0 ? Math.min(15000, retryAfter * 1000) : Math.min(15000, baseDelay * (2 ** attempt));
        await sleep(delay);
        continue;
      }
      break;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await sleep(Math.min(15000, baseDelay * (2 ** attempt)));
        continue;
      }
    }
  }

  const classification = lastError?.classification;
  if (lastError?.status && (isTransientStatus(lastError.status) || isModelUnavailableStatus(lastError.status) || classification?.quota || classification?.rateLimit)) {
    const cooldownMs = Math.min(15 * 60_000, Math.max(15_000, Number(process.env.GEMINI_MODEL_COOLDOWN_MS ?? '120000')));
    // Keep busy/unavailable/quota-hit models out for a short period so every user request
    // does not repeatedly hit a failing model.
    modelCooldownUntil.set(model, Date.now() + cooldownMs);
  }
  throw lastError || new Error(`Gemini model ${model} failed`);
}

async function requestWithFallback({ apiKey, primaryModel, modelCandidates, body, fetchImpl, onEvent }) {
  const candidates = modelCandidates?.length ? modelCandidates : await resolveModelChain(primaryModel, { apiKey, fetchImpl });
  const errors = [];
  for (const model of candidates) {
    try {
      await emit(onEvent, {type:'model_try', model});
      const data = await requestModel({ apiKey, model, body, fetchImpl });
      await emit(onEvent, {type:'model_selected', model});
      return { data, model, errors, candidates };
    } catch (error) {
      const classification = error?.classification || classifyGeminiError(error?.status, error?.data, error?.message || String(error));
      errors.push({
        model,
        status: error?.status || null,
        message: error?.message || String(error),
        quota: !!classification.quota,
        rateLimit: !!classification.rateLimit,
        transient: !!classification.transient
      });
      await emit(onEvent, {type:'model_failed', model, status:error?.status || null, reason: classification.quota ? 'quota' : classification.rateLimit ? 'rate_limit' : classification.transient ? 'temporary' : 'unavailable'});
      if (classification.auth && !classification.quota) throw error;
    }
  }
  const summary = errors.map(e => `${e.model}${e.status ? `(${e.status})` : ''}`).join(', ');
  const quotaAll = errors.length > 0 && errors.every(e => e.quota || e.rateLimit || e.transient);
  const error = new Error(`لا يوجد نموذج Gemini متاح حاليًا. تمت تجربة: ${summary}`);
  error.code = quotaAll && errors.some(e => e.quota) ? 'GEMINI_QUOTA_EXHAUSTED' : 'ALL_GEMINI_MODELS_FAILED';
  error.details = errors;
  throw error;
}

export async function runGeminiAgent({ apiKey, model = 'auto', message, history = [], systemInstruction, toolExecutor, maxTurns = 6, fetchImpl = globalThis.fetch, onEvent }) {
  maxTurns = Math.min(HARD_MAX_TURNS, Math.max(1, Number(maxTurns) || 6));
  if (!apiKey) throw new Error('GEMINI_API_KEY غير مضبوط');
  if (typeof fetchImpl !== 'function') throw new Error('fetch غير متاح في بيئة Node الحالية');

  const prior = Array.isArray(history) ? history.slice(-24).map(item => ({
    role: item?.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(item?.content || '') }]
  })).filter(x => x.parts[0].text.trim()) : [];
  const contents = [...prior, { role: 'user', parts: [{ text: String(message || '') }] }];
  const pendingActions = [];
  const toolTrace = [];
  const toolErrors = [];
  const usedModels = [];
  let lastModel = model === 'auto' ? DEFAULT_MODEL : model;
  const candidateModels = await resolveModelChain(model, {apiKey, fetchImpl});

  await emit(onEvent, {type:'status', message:'يجهز طلب الذكاء الاصطناعي…', modelPreference:model, candidates:candidateModels});

  for (let turn = 0; turn < maxTurns; turn++) {
    const responseResult = await requestWithFallback({
      apiKey,
      primaryModel:lastModel,
      modelCandidates:candidateModels,
      fetchImpl,
      onEvent,
      body: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: GEMINI_TOOLS,
        generationConfig: { thinkingConfig: { thinkingLevel: 'low' } }
      }
    });
    const data = responseResult.data;
    const activeModel = responseResult.model;
    lastModel = activeModel;
    if (!usedModels.includes(activeModel)) usedModels.push(activeModel);

    const candidateContent = data?.candidates?.[0]?.content;
    const calls = extractFunctionCalls(data);
    if (!calls.length) {
      let reply = extractText(data) || 'لم يرجع Gemini ردًا نصيًا.';
      if (toolErrors.length) {
        const failedNames = [...new Set(toolErrors.map(x => x.name))].map(toolArabicName).join('، ');
        const failedDetails = toolErrors.map(x => x.error).filter(Boolean).slice(0, 3).join(' | ');
        reply = `⚠️ تعذر تنفيذ بعض أدوات الشبكة، لذلك هذه النتيجة جزئية وليست دليلًا على أن المشكلة حُلّت.\nالأدوات التي تعذر تنفيذها: ${failedNames || 'غير محدد'}.\n${failedDetails ? `الخطأ: ${failedDetails}\n` : ''}\n${reply}`;
      }
      await emit(onEvent, {type:'final', reply, model:activeModel, usedModels, toolCount:toolTrace.length, toolErrors:toolErrors.length});
      return { reply, provider: 'gemini', model: activeModel, usedModels, toolTrace, pendingActions, toolErrors };
    }

    if (candidateContent) contents.push(candidateContent);

    const functionParts = [];
    for (let callIndex = 0; callIndex < calls.length; callIndex++) {
      const call = calls[callIndex];
      const started = Date.now();
      await emit(onEvent, {type:'tool_start', callId:call.id, name:call.name, args:call.args || {}, index:callIndex});
      let result;
      try {
        if (!GEMINI_TOOL_NAMES.has(call.name)) throw new Error(`أداة غير مسجلة: ${call.name}`);
        result = await toolExecutor(call.name, call.args || {});
      } catch (error) {
        result = { ok: false, error: error?.message || String(error) };
      }
      const compact = clip(result, MAX_TOOL_RESULT_CHARS);
      const ok = result?.ok !== false;
      const traceItem = { name: call.name, args: call.args || {}, result: compact, model: activeModel, ok, durationMs:Date.now()-started };
      toolTrace.push(traceItem);
      if (!ok) toolErrors.push({name:call.name,error:result?.error || 'تعذر تنفيذ الأداة'});
      if (result?.pendingAction) pendingActions.push(result.pendingAction);
      await emit(onEvent, {type: ok ? 'tool_result' : 'tool_error', callId:call.id, name:call.name, ok, durationMs:traceItem.durationMs, pendingApproval:!!result?.pendingAction, summary: summarizeToolResult(call.name, result), error: ok ? undefined : result?.error});
      functionParts.push({
        functionResponse: {
          id: call.id,
          name: call.name,
          response: { result: compact }
        }
      });
    }
    contents.push({ role: 'user', parts: functionParts });
  }

  let reply = 'وصل التحليل إلى الحد الآمن لعدد خطوات الأدوات قبل الوصول إلى نتيجة نهائية. أعد الطلب بشكل أكثر تحديدًا.';
  if (toolErrors.length) {
    const failedNames = [...new Set(toolErrors.map(x => x.name))].map(toolArabicName).join('، ');
    reply = `⚠️ لم تكتمل عملية الفحص. تعذر تنفيذ: ${failedNames || 'بعض الأدوات'}. لم يتم إثبات حل المشكلة.`;
  }
  await emit(onEvent, {type:'final', reply, model:lastModel, usedModels, toolCount:toolTrace.length, toolErrors:toolErrors.length});
  return { reply, provider: 'gemini', model: usedModels.at(-1) || lastModel, usedModels, toolTrace, pendingActions, toolErrors };
}

function summarizeToolResult(name, result) {
  if (result?.error) return `تعذر ${toolArabicName(name)}: ${result.error}`;
  if (result?.pendingAction) return `${toolArabicName(name)}: بانتظار موافقتك على التغيير.`;
  if (name === 'monitor_interface') return `${toolArabicName(name)}: تمت قراءة RX/TX اللحظية.`;
  if (name === 'get_hotspot_users') return `${toolArabicName(name)}: تمت قراءة المستخدمين النشطين.`;
  if (name === 'get_interfaces') return `${toolArabicName(name)}: تمت قراءة الواجهات.`;
  if (name === 'get_logs') return `${toolArabicName(name)}: تمت قراءة السجلات.`;
  if (name === 'get_queues') return `${toolArabicName(name)}: تمت قراءة الـQueues.`;
  if (name === 'diagnose_network') return 'اكتمل تشخيص الشبكة.';
  return `اكتمل ${toolArabicName(name)}.`;
}

function toolArabicName(name) {
  const names = {
    diagnose_network:'تشخيص الشبكة', get_network_overview:'حالة الشبكة', get_hotspot_users:'فحص مستخدمي HotSpot',
    get_interfaces:'فحص الواجهات', monitor_interface:'مراقبة الواجهة', get_queues:'فحص الـQueues', get_logs:'فحص السجلات',
    get_usage_report:'تحليل الاستهلاك', get_sales_summary:'فحص المبيعات', get_network_news:'جلب الأخبار', request_routeros_command:'تنفيذ أمر RouterOS'
  };
  return names[name] || name;
}

