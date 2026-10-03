export const READ_ONLY_COMMANDS = [
  /^\/ping\b/i,
  /^\/interface\s+print\b/i,
  /^\/interface\s+monitor-traffic\b/i,
  /^\/log\s+print\b/i,
  /^\/ip\s+hotspot\s+active\s+print\b/i,
  /^\/system\s+resource\s+print\b/i,
  /^\/queue\s+simple\s+print\b/i,
  /^\/queue\s+simple\s+print\s+stats\b/i,
  /^\/ip\s+route\s+print\b/i,
  /^\/ip\s+address\s+print\b/i,
  /^\/ip\s+dns\s+print\b/i,
  /^\/ip\s+firewall\s+(filter|nat|mangle|raw)\s+print\b/i,
  /^\/system\s+clock\s+print\b/i,
  /^\/system\s+identity\s+print\b/i,
  /^\/system\s+package\s+print\b/i,
  /^\/interface\s+monitor-traffic\b/i,
];

export const ALWAYS_APPROVE = [
  /\bremove\b/i, /\breset-configuration\b/i, /\bfactory\b/i,
  /\breboot\b/i, /\bshutdown\b/i, /\bpassword\b/i,
  /\/user\s+(add|set|remove)\b/i,
  /\/ip\s+firewall\s+(filter|nat|mangle|raw)\s+(add|set|remove)\b/i,
  /\/ip\s+route\s+(add|set|remove)\b/i,
  /\/system\s+package\s+update\b/i,
  /\bupgrade\b/i,
];

export function classifyCommand(script) {
  const s = String(script || '').trim();
  if (!s) return { allowed: false, risk: 'blocked', requiresApproval: false, reason: 'الأمر فارغ.' };
  if (ALWAYS_APPROVE.some(re => re.test(s))) {
    return { allowed: true, risk: 'high', requiresApproval: true, reason: 'الأمر يغيّر جانبًا حساسًا من الشبكة.' };
  }
  if (READ_ONLY_COMMANDS.some(re => re.test(s))) {
    return { allowed: true, risk: 'low', requiresApproval: false, reason: 'قراءة فقط.' };
  }
  return { allowed: true, risk: 'medium', requiresApproval: true, reason: 'الأمر قد يغيّر إعدادات الشبكة.' };
}

export function sanitizeToolResult(value, maxChars = 24000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return value;
  const redacted = text
    .replace(/(password|passwd|secret|token|api[-_]?key)\s*[:=]\s*[^,\s}]+/gi, '$1:[REDACTED]')
    .replace(/AQ\.[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]');
  if (redacted.length <= maxChars) return value;
  return `${redacted.slice(0, maxChars)}\n...[truncated]`;
}

export function validateInterfaceName(name, interfaces) {
  const requested = String(name || '').trim();
  if (!requested) throw new Error('اسم الواجهة مطلوب.');
  const list = Array.isArray(interfaces) ? interfaces : [];
  const exact = list.filter(x => String(x?.name || '') === requested);
  if (exact.length === 1) return exact[0].name;
  if (exact.length > 1) throw new Error(`اسم الواجهة ${requested} مكرر في البيانات الحالية.`);
  const defaultMatches = list.filter(x => String(x?.['default-name'] || '') === requested);
  if (defaultMatches.length === 1) return defaultMatches[0].name;
  if (defaultMatches.length > 1) throw new Error(`القيمة ${requested} تطابق أكثر من واجهة. استخدم الاسم الحالي.`);
  throw new Error(`الواجهة ${requested} غير موجودة ضمن الواجهات الحالية.`);
}
