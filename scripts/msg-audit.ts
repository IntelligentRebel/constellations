// Collects the reports a human player receives over a long AI-driven game and lists those with no target
// (run: npx tsx scripts/msg-audit.ts [years] [seeds...]).
import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { runAI } from '../src/engine/ai';
import { Rng, seedFromString } from '../src/engine/rng';

const years = +(process.argv[2] ?? 120);
const seeds = process.argv.slice(3).length ? process.argv.slice(3) : ['audit-1', 'audit-2'];
const templ = (t: string) => t.replace(/\d[\d  .,]*/g, '#').replace(/«[^»]*»/g, '«…»');
const none = new Map<string, { n: number; ex: string; kind: string }>();
const withT = new Map<string, { n: number; ex: string; kinds: Set<string> }>();
for (const seed of seeds) {
  const g = quickGame(undefined, 'Small', 3, 'standard', seed);
  const me = g.players[0];
  const rng = new Rng(seedFromString(seed + 'me'));
  for (let y = 0; y < years; y++) {
    me.ai = 'standard';
    runAI(g, me, rng);
    me.ai = null;
    generateTurn(g);
    for (const m of me.messages) {
      const k = templ(m.text).slice(0, 90);
      if (!m.target) { const e = none.get(k) ?? { n: 0, ex: m.text, kind: m.kind }; e.n++; none.set(k, e); }
      else { const e = withT.get(k) ?? { n: 0, ex: m.text, kinds: new Set() }; e.n++; e.kinds.add(m.target.kind); withT.set(k, e); }
    }
    if (me.dead) break;
  }
}
console.log('=== NO TARGET');
for (const [k, e] of [...none.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`${e.n}\t[${e.kind}] ${e.ex.slice(0, 200)}`);
console.log('=== WITH TARGET (kinds)');
for (const [k, e] of [...withT.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`${e.n}\t{${[...e.kinds].join(',')}} ${e.ex.slice(0, 160)}`);
