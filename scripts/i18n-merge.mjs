// Assembles i18n/<lang>.json (French text → translation) from the translated chunks i18n/work/<lang>-NN.json,
// and reports what is missing or suspicious (run: node scripts/i18n-merge.mjs en).
import fs from 'node:fs';
const lang = process.argv[2];
const src = JSON.parse(fs.readFileSync('i18n/source.json', 'utf8'));
const byId = new Map();
for (const f of fs.readdirSync('i18n/work')) {
  if (!f.startsWith(lang + '-') || !f.endsWith('.json')) continue;
  const part = JSON.parse(fs.readFileSync('i18n/work/' + f, 'utf8'));
  for (const [id, t] of Object.entries(part)) byId.set(+id, t);
}
// translations already made for texts that moved (same French text, another id)
const prev = fs.existsSync(`i18n/${lang}.json`) ? JSON.parse(fs.readFileSync(`i18n/${lang}.json`, 'utf8')) : {};
const chunks = fs.readdirSync('i18n/work').filter(f => /^(chunk-\d+|in-\d+)\.json$/.test(f)).flatMap(f => JSON.parse(fs.readFileSync('i18n/work/' + f, 'utf8')));
const frOf = new Map(chunks.map(c => [c.id, c.fr]));
// hand-made translations (French text → translation), applied over everything
const manual = fs.existsSync(`i18n/work/manual-${lang}.json`) ? JSON.parse(fs.readFileSync(`i18n/work/manual-${lang}.json`, 'utf8')) : {};
const out = {};
let missing = 0;
const issues = [];
const ph = s => [...new Set(s.match(/\{\d+\}/g) || [])];
for (const e of src) {
  let t;
  for (const [id, tr] of byId) if (frOf.get(id) === e.key) { t = tr; break; }
  t ??= prev[e.key] && !prev[e.key].startsWith('⟦') ? prev[e.key] : undefined;
  if (manual[e.key] !== undefined) t = manual[e.key];
  if (t === undefined) { missing++; continue; }
  const lost = ph(e.key).filter(p => !t.includes(p.slice(0, -1)));
  if (lost.length) issues.push(`placeholder ${lost.join(',')} dropped: ${JSON.stringify(e.key).slice(0, 80)} → ${JSON.stringify(t).slice(0, 80)}`);
  const extra = (t.match(/\{(\d+)/g) || []).map(x => x.slice(1)).filter(n => !e.key.includes('{' + n + '}'));
  if (extra.length) issues.push(`unknown placeholder {${extra.join(',')}}: ${JSON.stringify(t).slice(0, 100)}`);
  out[e.key] = t;
}
fs.writeFileSync(`i18n/${lang}.json`, JSON.stringify(out, null, 0).replace(/","/g, '",\n"'));
console.log(`${lang}: ${Object.keys(out).length} translated, ${missing} missing, ${issues.length} to look at`);
if (process.env.V) for (const i of issues) console.log('  ' + i);
