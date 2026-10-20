// Constellations 0.3.9.20 checks: what the interface keeps between renders (src/ui/memo.ts) must never show a game
// older than the one played, and the faster engine paths must give the same answers (run: npx tsx scripts/v39p-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const g0: any = globalThis;
  g0.window = g0; g0.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  g0.document = undefined;
  const { store } = await import('../src/ui/store');
  const M = await import('../src/ui/memo');
  const { quickGame } = await import('../src/engine/newgame');
  const { generateTurn } = await import('../src/engine/turn');
  const { planetSpec } = await import('../src/engine/planet');
  const F = await import('../src/engine/fleet');
  const { getDesign } = await import('../src/engine/design');
  const { estimateQueue } = await import('../src/engine/production');
  const { todoItems } = await import('../src/ui/todo');

  const g = quickGame(undefined, 'Small', 3, 'standard', 'v39p');
  g.settings.cataclysms = false;
  while (g.year < 2440) generateTurn(g);
  store.game = g;
  const me = g.players[g.human];
  const home = g.planets.find(p => p.owner === me.id && p.homeworld)!;
  const fleet = g.fleets.find(f => f.owner === me.id && F.fleetSpec(g, f).hasEngines)!;

  console.log('--- a selection, a dialog, a tab or a centring keeps what was computed');
  {
    const a = M.viewSpec(g, home, me), r0 = store.dataRev;
    store.select({ kind: 'planet', id: home.id });
    store.open('help'); store.close('help');
    store.goTab('colonies'); store.goTab('map');
    store.center(home.x, home.y);
    store.notify('test');
    check(store.dataRev === r0, `none of them moves dataRev (${r0} → ${store.dataRev})`);
    check(M.viewSpec(g, home, me) === a, 'the colony\'s spec is the one computed before');
    const v0 = store.version;
    store.setMessageIndex(1);
    check(store.version === v0, 'the report arrows do not even render the interface again (version unchanged)');
  }

  console.log('--- an order, then a selection: everything is computed again');
  {
    const before = M.viewSpec(g, home, me);
    const est0 = M.viewQueue(g, home, 50);
    store.checkpoint();
    home.factories += 40; home.pop += 50000;
    home.queue.push({ kind: 'factory', qty: 5 } as any);
    store.select({ kind: 'fleet', id: fleet.id }); // a selection right after the order, with no bump in between
    const after = M.viewSpec(g, home, me);
    check(after !== before, 'the spec is not the one from before the order');
    check(after.resources === planetSpec(g, home, me).resources, `and it is the engine's (${after.resources} resources)`);
    const est1 = M.viewQueue(g, home, 50);
    check(est1 !== est0 && est1.length === home.queue.length, 'the production estimate follows the new queue');
    check(JSON.stringify(est1) === JSON.stringify(estimateQueue(g, home, 50)), 'and gives the engine\'s years');
    home.queue.pop(); store.bump();
  }

  console.log('--- a bump, an undo, another game');
  {
    const a = M.viewSpec(g, home, me);
    store.bump();
    check(M.viewSpec(g, home, me) !== a, 'a bump computes again');
    const t = M.viewMemo('t', g, () => todoItems(g, me));
    check(M.viewMemo('t', g, () => []) === t, 'a named value is kept within a state of the game');
    store.bump();
    check(M.viewMemo('t', g, () => []).length === 0, 'and recomputed after it');
    const g2: typeof g = JSON.parse(JSON.stringify(g));
    const h2 = g2.planets[home.id];
    check(M.viewSpec(g2, h2, g2.players[me.id]) !== M.viewSpec(g, home, me), 'another game (an undo reads a copy) has its own specs');
  }

  console.log('--- fleets: their specs and routes');
  {
    const s1 = M.viewFleet(g, fleet);
    store.select(null);
    check(M.viewFleet(g, fleet) === s1, 'the fleet spec is kept through a selection');
    const t0 = fleet.tokens;
    fleet.tokens = fleet.tokens.map(t => ({ ...t, qty: t.qty + 1 }));
    check(M.viewFleet(g, fleet) !== s1, 'other ships (a new token list): computed again');
    fleet.tokens = t0;
    store.checkpoint();
    fleet.waypoints = [fleet.waypoints[0], { x: fleet.x + 120, y: fleet.y + 40, target: 'space', warp: 6, task: 'none' } as any];
    store.select({ kind: 'fleet', id: fleet.id });
    const legs = M.viewRoute(g, fleet);
    check(JSON.stringify(legs) === JSON.stringify(F.estimateRoute(g, fleet)), 'the route shown is the engine\'s, after the order');
  }

  console.log('--- the fuel of a route, the ship specs given once');
  {
    let same = 0, all = 0;
    for (const f of g.fleets) {
      const ts = F.tokenSpecs(g, f);
      for (const w of [1, 4, 6, 9, 10]) for (const d of [3, 25, 81]) {
        all++;
        if (F.fuelForYear(g, f, w, d, undefined, ts) === F.fuelForYear(g, f, w, d) && F.fuelGenerated(g, f, w, d, ts) === F.fuelGenerated(g, f, w, d)) same++;
      }
    }
    check(same === all, `the same fuel with the specs given or not (${same} / ${all} cases)`);
  }

  console.log('--- designs found by their place in the list');
  {
    const ids = g.designs.map(d => d.id);
    check(ids.every(id => getDesign(g, id) === g.designs.find(d => d.id === id)), `every design is found (${ids.length})`);
    const removed = g.designs.splice(1, 1)[0];
    check(g.designs.slice(0, 6).every(d => getDesign(g, d.id) === d), 'after a removal (the list moved) each id still gives its design');
    let threw = false; try { getDesign(g, removed.id); } catch { threw = true; }
    check(threw, 'a removed design is not found any more');
    g.designs.push(removed);
    check(getDesign(g, removed.id) === removed, 'and found again once added back');
    const copy = { ...g, designs: [...g.designs].reverse() };
    check(copy.designs.every(d => getDesign(copy, d.id) === d), 'another list has its own index');
  }

  console.log(`\n${good} ok, ${bad} failed`);
  if (bad) process.exit(1);
}
main();
