// Plays a few decades in a language (default English) with the real build transform, and lists the generated report
// texts that still contain French (run: node scripts/i18n-audit.mjs [lang] [years]).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync, strToU8 } from 'fflate';
import { rewrite, englishKeySet, SKIP_FILES } from './i18n-core.mjs';
const lang = process.argv[2] ?? 'en', years = +(process.argv[3] ?? 60);
const known = new Set(JSON.parse(fs.readFileSync('i18n/source.json', 'utf8')).map(e => e.key));
const cats = {};
for (const l of new Set([lang, 'en'])) if (l !== 'fr') cats[l] = Buffer.from(deflateSync(strToU8(fs.readFileSync(`i18n/${l}.json`, 'utf8')))).toString('base64');
const eng = englishKeySet(process.cwd());
const entry = `
import { setLang } from './src/i18n';
import { quickGame } from './src/engine/newgame';
import { generateTurn } from './src/engine/turn';
const out = new Set();
for (const shape of ['arm', 'nursery', undefined]) {
  const g = quickGame(undefined, 'Small', 4, 'standard', 'audit-' + shape, shape ? { shape } : undefined);
  g.players[0].ai = 'standard';
  for (let y = 0; y < ${years}; y++) { generateTurn(g); for (const p of g.players) for (const m of p.messages) out.add(m.text.replace(/\\d[\\d\\s.,]*/g, '#')); }
  const names = new Set([...g.planets.map(p => p.name), ...g.fleets.map(f => f.name), ...g.players.map(p => p.name), ...g.designs.map(d => d.name)]);
  globalThis.__names = [...(globalThis.__names ?? []), ...names];
}
globalThis.__out = [...out];
void setLang;
`;
fs.writeFileSync('.audit-entry.ts', entry);
const res = await esbuild.build({
  entryPoints: ['.audit-entry.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'warning',
  define: { __VERSION__: '"audit"', __I18N__: JSON.stringify(cats) },
  plugins: [{ name: 'i18n', setup(b) { b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, async a => { const rel = path.relative(process.cwd(), a.path).split(path.sep).join('/'); const src = await fs.promises.readFile(a.path, 'utf8'); return { contents: SKIP_FILES.has(rel) || rel === 'src/i18n.ts' ? src : rewrite(src, rel, eng, known), loader: rel.endsWith('x') ? 'tsx' : 'ts' }; }); } }],
});
fs.unlinkSync('.audit-entry.ts');
globalThis.localStorage = { getItem: () => lang, setItem() {}, removeItem() {} };
new Function('require', 'module', 'exports', res.outputFiles[0].text)((m) => import.meta.resolve ? require(m) : null, { exports: {} }, {});
function require(m) { return globalThis.process.getBuiltinModule ? process.getBuiltinModule(m) : null; }
const names = (globalThis.__names ?? []).filter(n => n && n.length > 2).sort((a, b) => b.length - a.length);
const FR = /\b(le|la|les|des|du|de|et|vos|votre|une|est|sont|pour|avec|sans|dans|sur|qui|que|pas|ont|été|année|vaisseau|vaisseaux|flotte|planète|colons)\b|[éèêàçùâîôû]/i;
const bad = [];
for (const t of globalThis.__out) {
  let s = t;
  for (const n of names) s = s.split(n).join('¤');
  if (FR.test(s)) bad.push(t);
}
console.log(`${globalThis.__out.length} distinct reports, ${bad.length} with French left`);
for (const b of bad.slice(0, +(process.env.N ?? 60))) console.log(' - ' + b.slice(0, 220));
