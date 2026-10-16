// Every component and hull is explained (run: npx tsx scripts/tech-text-check.ts): a short line in the tables and a
// tooltip that says what each of its effects does.
import { TECHS, HULLS } from '../src/engine/tech';
import { partBrief, unexplainedStats, secondaryLines, PRIMARY } from '../src/ui/techtext';
import { tl } from '../src/data/labels';

let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else good++; };
for (const t of TECHS.values()) {
  check(!!PRIMARY[t.cat], `${t.name}: category ${t.cat} has a description`);
  const miss = unexplainedStats(t);
  check(miss.length === 0, `${t.name} (${tl(t.name)}): effects without a sentence: ${miss.join(', ')}`);
  check(partBrief(t).length > 0, `${t.name} (${tl(t.name)}): empty "Caractéristiques"`);
}
for (const h of HULLS.values()) check(h.slots.length > 0 || h.starbase, `${h.name}: hull without slots`);
// samples
const sample = (n: string) => secondaryLines(TECHS.get(n)!).join(' / ');
console.log('Multi Contained Munition →', sample('Multi Contained Munition'));
console.log('Langston Shell →', sample('Langston Shell'));
console.log('Holographic Decoy →', partBrief(TECHS.get('Holographic Decoy')!));
console.log(bad ? `${bad} failure(s), ${good} ok` : `all good (${good})`);
process.exit(bad ? 1 : 0);
