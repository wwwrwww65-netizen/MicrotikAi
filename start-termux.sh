#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo 'Node.js غير مثبت في Termux.'; exit 1; }
[ -f .env ] || { echo 'ملف .env غير موجود. شغّل setup-termux.sh أولًا.'; exit 1; }
node --input-type=module <<'NODE'
import fs from 'node:fs';
const file='.env';
const text=fs.readFileSync(file,'utf8');
const map=new Map();
for(const line of text.split(/\r?\n/)){ const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if(m) map.set(m[1],m[2]); }
map.set('PORT','8787');
map.set('HOST','127.0.0.1');
map.set('DEMO_MODE','false');
map.set('MIKROTIK_MODE','v6api');
map.set('MIKROTIK_HOST','172.16.0.1');
map.set('MIKROTIK_PORT','8728');
map.set('MIKROTIK_API_SSL','false');
map.set('MIKROTIK_INSECURE_TLS','true');
const out=[...map.entries()].map(([k,v])=>`${k}=${v}`).join('\n')+'\n';
fs.writeFileSync(file,out,{mode:0o600});
console.log('RouterOS: 172.16.0.1:8728 | Demo=false | credentials preserved');
NODE
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi
npm start
