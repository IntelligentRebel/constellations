// 0.3.8: the tutorial, played by its own "Do it for me" buttons, without a browser (run: npx tsx scripts/tutorial-check.ts).
// Checks the fixed map (the worlds the steps point at), that every step can be completed, and that every element of
// the interface a step points at exists in the sources.
import fs from 'node:fs';
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; if (process.env.V) console.log('ok  ', m); } };
async function main() {
  const g0: any = globalThis;
  g0.window = g0; g0.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };
  g0.document = undefined;
  const { store } = await import('../src/ui/store');
  const T = await import('../src/ui/tutorial');
  const { tutorialGame } = await import('../src/engine/newgame');
  const { habitability } = await import('../src/engine/race');
  const { distance } = await import('../src/engine/fleet');
  (store as any).save = () => {};
  const origOpen = store.open.bind(store); store.open = ((k: any, d?: any) => { if (k !== 'warn' && k !== 'backups') origOpen(k, d); }) as any;

  // the map: always the same, and suited to the steps
  const a = tutorialGame(), b = tutorialGame();
  check(JSON.stringify(a.planets) === JSON.stringify(b.planets), 'the tutorial map is always the same');
  const me = a.players[0], t = a.tutorial!.targets;
  const hw = a.planets.find(p => p.owner === 0 && p.homeworld)!;
  const col = a.planets[t.colony], sc = a.planets[t.scout], pr = a.planets[t.probe];
  check(me.race.pluralName === 'Terriens', 'the player plays the Terriens');
  check(me.intel.planets[col.id].year !== undefined && habitability(me.race, col.hab) >= 50 && distance(col, hw) <= 40, `first colony ${col.name}: known, ${habitability(me.race, col.hab)} %, ${Math.round(distance(col, hw))} ly`);
  for (const p of [sc, pr]) check(me.intel.planets[p.id].year === undefined && habitability(me.race, p.hab) > 0 && distance(p, hw) <= 60, `scout target ${p.name}: unknown, ${habitability(me.race, p.hab)} %, ${Math.round(distance(p, hw))} ly`);
  const aiDist = Math.min(...a.players.filter(p => p.id !== 0 && !p.monster).map(p => distance(a.planets.find(x => x.owner === p.id && x.homeworld)!, hw)));
  check(aiDist >= 300, `rival empires far away (${Math.round(aiDist)} ly)`);
  for (const id of [t.scoutFleet, t.probeFleet, t.arkFleet]) check(a.fleets.some(f => f.id === id && f.owner === 0), `starting fleet ${id} exists`);

  // every element pointed at exists in the interface
  const src = fs.readdirSync('src/ui', { recursive: true }).filter(f => String(f).endsWith('.tsx')).map(f => fs.readFileSync('src/ui/' + f, 'utf8')).join('\n');
  const tut = fs.readFileSync('src/ui/tutorial.tsx', 'utf8');
  const marked = new Set([...src.matchAll(/data-tut="([\w-]+)"/g)].map(m => m[1]));
  const dynamic = [...src.matchAll(/data-tut=\{'([\w-]+)' \+/g)].map(m => m[1]);
  for (const m of tut.matchAll(/\[data-tut=([\w-]+)\]/g)) check(marked.has(m[1]) || src.includes(`tut="${m[1]}"`) || src.includes(`id="${m[1]}"`) || dynamic.some(d => m[1].startsWith(d)), `target [data-tut=${m[1]}] exists`);
  for (const m of tut.matchAll(/tutSel\('([\w-]+)'/g)) check(dynamic.includes(m[1]) || dynamic.some(d => m[1].startsWith(d)) || src.includes(`'${m[1]}' +`), `dynamic target ${m[1]}… exists`);
  for (const m of tut.matchAll(/target: '#([\w-]+)'/g)) check(src.includes(`id="${m[1]}"`), `section #${m[1]} exists`);

  // the whole tutorial, step by step
  T.startTutorial();
  const g = store.game!;
  check(!!g.tutorial && g.tutorial.chapter === 'start', 'the tutorial starts on the first chapter');
  const idle = async () => { for (let i = 0; i < 200 && store.busy; i++) await new Promise(r => setTimeout(r, 20)); };
  for (const ch of T.allChapters()) {
    const n = ch.steps().length;
    for (let i = 0; i < n; i++) {
      g.tutorial!.chapter = ch.id; g.tutorial!.step = i;
      let st = ch.steps()[i];
      check(st.title.length > 0 && st.body.length > 0 && st.body.every(p => p.length > 0), `${ch.id}:${st.id} has a title and a text`);
      st.enter?.();
      for (let k = 0; k < 4 && st.goal && !st.goal(); k++) { st.doIt?.(); await idle(); st = ch.steps()[i]; }
      check(!st.goal || st.goal(), `${ch.id}:${st.id} can be completed (year ${g.year})`);
      if (st.goal && !st.goal()) console.log('   stuck at', ch.id, st.id);
    }
    if (!g.tutorial!.done.includes(ch.id)) g.tutorial!.done.push(ch.id);
  }
  check(g.planets.filter(p => p.owner === 0).length >= 2, 'a colony was founded');
  check(g.fleets.some(f => f.owner === 0 && f.waypoints.length > 1), 'fleets are on their way');
  check(g.year <= 2404, `the essentials take a few years only (${g.year})`);
  // Enter: next step on an explanation, nothing on an unmet action, the turn on the turn step
  g.tutorial!.chapter = 'start'; g.tutorial!.step = 1;
  check(T.tutorialEnter() && g.tutorial!.step === 2, 'Enter goes to the next step');
  store.camera = { x: 1, y: 2, zoom: 0.5 };
  console.log(bad ? `${good} ok, ${bad} failed` : `all good (${good})`);
  process.exit(bad ? 1 : 0);
}
main();
