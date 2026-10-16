// Constellations 0.3.9.12 checks: closed borders and intelligence (run: npx tsx scripts/v39i-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { createGame, defaultSettings, newFleet } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES } = await import('../src/engine/race');
  const { generateTurn } = await import('../src/engine/turn');
  const B = await import('../src/engine/borders');
  const DIP = await import('../src/engine/diplomacy');
  const { distance, fleetSpec, travelYears } = await import('../src/engine/fleet');
  const { mergeFleets, splitFleet } = await import('../src/engine/tasks');
  type G = ReturnType<typeof createGame>;

  // the same small spiral arm as the 0.3.9.10 checks: two empires played by hand (0, 1) and a computer (2)
  const s = { ...defaultSettings(), seed: 'v39g', shape: 'arm' as const, size: 'Small' as const, positions: 'Close' as any };
  const base = createGame({ name: 'Frontières', settings: s, players: [
    { race: PREDEFINED_RACES.Humanoid(), ai: 'standard' },
    { race: PREDEFINED_RACES.Insectoid(), ai: 'standard' },
    { race: PREDEFINED_RACES.Rabbitoid(), ai: 'standard' },
  ] } as any);
  while (base.year < 2432) generateTurn(base);
  base.players[0].ai = null; base.players[1].ai = null;
  for (const p of base.players) { p.closed = []; p.bordersSet = []; }
  for (const k of Object.keys(base.diplomacy!.pairs)) { base.diplomacy!.pairs[k].status = 'peace'; base.diplomacy!.pairs[k].trade = undefined; base.diplomacy!.pairs[k].research = undefined; }
  for (const p of base.players) for (const o of base.players) if (p.id !== o.id && !p.intel.met.includes(o.id)) p.intel.met.push(o.id);
  for (const p of base.players) p.bordersSet = base.players.map(o => o.id).filter(id => id !== p.id);
  const { revealPlanet } = await import('../src/engine/scan');
  for (const p of base.players) for (const pl of base.planets) if (pl.owner >= 0 && pl.owner !== p.id) revealPlanet(base, p, pl);
  DIP.syncRelations(base);
  const raw = JSON.stringify(base);
  const fresh = (): G => JSON.parse(raw);
  const own = (g: G, id: number) => g.planets.filter(p => p.owner === id);
  const hw = (g: G, id: number) => own(g, id).find(p => p.homeworld)!;

  const I = await import('../src/engine/espionage');
  const lines = (g: G, o: number, t: number) => g.players[o].intel.dossiers?.[t]?.lines ?? [];
  const has = (g: G, o: number, t: number, key: string) => lines(g, o, t).find(l => l.key === key)?.value;
  const level = (g: G, o: number, t: number) => g.players[o].intel.dossiers?.[t]?.level ?? 0;
  const sum = (g: G, o: number, t: number) => Math.max(0, Math.min(100, lines(g, o, t).reduce((a, l) => a + l.value, 0)));
  check(I.intelOn(base), 'the Intelligence rule is on');

  console.log('--- open borders');
  {
    const g = fresh();
    generateTurn(g);
    check(has(g, 0, 1, 'shutMine') === undefined && has(g, 0, 1, 'shutTheirs') === undefined && has(g, 1, 0, 'shutTheirs') === undefined, `no border line while the borders are open (0 on 1: ${level(g, 0, 1)}, 1 on 0: ${level(g, 1, 0)})`);
  }

  console.log('--- they close theirs');
  {
    const g = fresh(), h = fresh();
    for (const x of [g, h]) DIP.sign(x, 0, 1, 'embassy'); // something to lose: embassies both ways
    B.setBorders(g, 1, 0, true);
    generateTurn(g); generateTurn(h);
    check(has(g, 0, 1, 'shutTheirs') === -I.BORDERS, `0 knows less of 1: "${lines(g, 0, 1).find(l => l.key === 'shutTheirs')?.label}" ${-I.BORDERS}`);
    check(has(g, 1, 0, 'shutMine') === -I.BORDERS, `and 1, who closed them, knows less of 0: "${lines(g, 1, 0).find(l => l.key === 'shutMine')?.label}" ${-I.BORDERS}`);
    check(level(g, 0, 1) === sum(g, 0, 1) && level(g, 1, 0) === sum(g, 1, 0), 'the level is the sum of its lines (never below 0)');
    const pos = (x: G, o: number, t: number) => lines(x, o, t).filter(l => l.value > 0).reduce((a, l) => a + l.value, 0);
    check(pos(g, 0, 1) === pos(h, 0, 1) && level(h, 0, 1) > I.BORDERS && level(g, 0, 1) === Math.max(0, Math.min(100, pos(h, 0, 1) - I.BORDERS)), `the same year with open borders, 0 knew ${level(h, 0, 1)} of 1, now ${level(g, 0, 1)}`);
    check(has(g, 0, 2, 'shutTheirs') === undefined && has(g, 2, 0, 'shutMine') === undefined, 'the others are not concerned');
    const err = (x: G) => I.perception(x, 1, 0).err;
    check(err(g) > err(h), `1 judges the strength of 0 less well (error ±${Math.round(err(h) * 100)} % → ±${Math.round(err(g) * 100)} %)`);
    check(Math.abs(I.detectChance(g, g.players[0], 1, 30) / I.detectChance(h, h.players[0], 1, 30) - I.BORDER_CONTROLS) < 1e-9, `their border controls uncover 0's spies ${I.BORDER_CONTROLS} times as often`);
    check(Math.abs(I.detectChance(g, g.players[1], 0, 30) - I.detectChance(h, h.players[1], 0, 30)) < 1e-9, 'not the spies of the empire that closed them');
  }

  console.log('--- both closed');
  {
    const g = fresh();
    B.setBorders(g, 1, 0, true); B.setBorders(g, 0, 1, true);
    generateTurn(g);
    check(has(g, 0, 1, 'shutMine') === -I.BORDERS && has(g, 0, 1, 'shutTheirs') === -I.BORDERS && has(g, 1, 0, 'shutMine') === -I.BORDERS && has(g, 1, 0, 'shutTheirs') === -I.BORDERS, `closed both ways, both lines on both sides (${-2 * I.BORDERS} each)`);
    DIP.declareWar(g, 0, 1);
    generateTurn(g);
    check(has(g, 0, 1, 'shutMine') === undefined && has(g, 1, 0, 'shutTheirs') === undefined, 'at war, the closed borders no longer count');
  }

  console.log(bad ? `${bad} FAILED, ${good} ok` : `all good (${good})`);
  if (bad) process.exit(1);
}
void main();
