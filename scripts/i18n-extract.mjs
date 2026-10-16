// Builds i18n/source.json: every player-visible French text of the game, with where it comes from.
// (run: node scripts/i18n-extract.mjs). The translations live in i18n/<lang>.json, keyed by the French text.
import fs from 'node:fs';
import { collect, sourceFiles, englishKeySet, SKIP_FILES } from './i18n-core.mjs';
const root = process.cwd();
const eng = englishKeySet(root);
const map = new Map(), maybe = new Map();
for (const rel of sourceFiles(root)) {
  if (SKIP_FILES.has(rel)) continue;
  const { items } = collect(fs.readFileSync(rel, 'utf8'), rel, eng);
  for (const c of items) {
    const tgt = c.vis === true ? map : maybe;
    const e = tgt.get(c.key) ?? { key: c.key, kind: c.kind, refs: [] };
    if (e.refs.length < 4) e.refs.push(`${rel.replace(/^src\//, '')}:${c.line}${c.ctx ? ' ' + c.ctx : ''}`);
    tgt.set(c.key, e);
  }
}
// single words reviewed by hand (i18n/extra.json): visible text, not keys
const extra = fs.existsSync('i18n/extra.json') ? JSON.parse(fs.readFileSync('i18n/extra.json', 'utf8')) : [];
for (const k of extra) if (!map.has(k)) map.set(k, maybe.get(k) ?? { key: k, kind: 'str', refs: [] });
for (const k of map.keys()) maybe.delete(k);
fs.mkdirSync('i18n', { recursive: true });
const list = [...map.values()];
fs.writeFileSync('i18n/source.json', JSON.stringify(list, null, 1));
fs.writeFileSync('i18n/maybe.json', JSON.stringify([...maybe.values()], null, 1));
const chars = list.reduce((a, e) => a + e.key.length, 0);
console.log(`${list.length} texts, ${chars} characters; ${maybe.size} single words to review`);
