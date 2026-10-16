// Constellations 0.3.9.11 checks: fleets caught inside closed borders (run: npx tsx scripts/v39h-check.ts).
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

  // a fleet of 0 in deep space, well inside the territory of 1 (near its capital)
  const caught = (g: G, opts: { fuel?: number; ramscoop?: boolean } = {}) => {
    const h = hw(g, 1);
    const ds = g.designs.filter(x => x.owner === 0 && !x.starbase && !x.deleted);
    const probe = (id: number) => { const f = newFleet(g, g.players[0], id, 1, hw(g, 0)); const sp = fleetSpec(g, f); g.fleets.splice(g.fleets.indexOf(f), 1); return sp; };
    const d = ds.find(x => { const sp = probe(x.id); return sp.hasEngines && (opts.ramscoop ? sp.freeSpeed > 1 : sp.freeSpeed <= 1) && sp.fuelCapacity > 0; }) ?? ds[0];
    const f = newFleet(g, g.players[0], d.id, 1, hw(g, 0));
    f.x = h.x + 3; f.y = h.y + 3; f.orbiting = -1;
    f.waypoints = [{ x: f.x, y: f.y, target: 'space', task: 'none', warp: 0, processed: true }];
    f.fuel = opts.fuel ?? fleetSpec(g, f).fuelCapacity;
    return f;
  };
  const say = (g: G, id: number, bit: string) => g.players[id].messages.some(m => m.text.includes(bit));

  console.log('--- the delay');
  {
    const g = fresh();
    const f = caught(g);
    B.setBorders(g, 1, 0, true);
    check(g.players[0].messages.some(m => m.text.includes('ont un délai pour en sortir')), 'closing them tells there is a delay to get out');
    const plan = B.exitPlan(g, f)!;
    check(!!plan && plan.closer === 1 && B.closedFor(g, 0, plan) === -1 && plan.dist > 5, `the way out is the nearest point outside (${Math.round(plan?.dist ?? 0)} al)`);
    check(!plan.stranded && plan.warp >= 1 && plan.years === travelYears(plan.dist, plan.warp), `with a full tank: Warp ${plan.warp}, ${plan.years} year(s)`);
    generateTurn(g);
    const e = f.borderExit;
    check(!!e && e.closer === 1 && e.by > g.year, `the fleet gets a delay (out by ${e?.by}, now ${g.year})`);
    check(say(g, 0, `a jusqu'à l'an ${e?.by} pour en sortir`), 'and the player is told by when');
    const seen = g.players[1].intel.fleets.some(x => x.id === f.id);
    check(!seen || say(g, 1, 'repérées dans votre territoire'), `the closer is told of the fleets it sees inside (${seen ? 'seen' : 'unseen'})`);
    // the player does nothing (and keeps its tank full): warned, then war
    let warned = 0;
    for (let y = 0; y < 20 && DIP.statusOf(g, 0, 1) === 'peace' && g.fleets.includes(f); y++) {
      f.fuel = fleetSpec(g, f).fuelCapacity; f.waypoints = [f.waypoints[0]];
      generateTurn(g);
      if (!warned && g.players[0].messages.some(m => m.kind === 'warning' && m.text.includes('le délai pour en sortir est écoulé'))) warned = g.year;
    }
    check(warned === e!.by, `warned once the delay is over (${warned})`);
    check(DIP.statusOf(g, 0, 1) === 'war' && g.year === warned + 1, `still inside the year after: war (${g.year})`);
    check(say(g, 0, 'est restée dans le territoire des') && say(g, 1, 'en restant dans leur territoire'), 'both are told why');
    check(!f.borderExit, 'at war, no more delay');
  }

  console.log('--- getting out');
  {
    const g = fresh();
    const f = caught(g);
    B.setBorders(g, 1, 0, true);
    generateTurn(g);
    const by = f.borderExit!.by;
    const wp = B.exitOrder(g, f)!;
    f.waypoints = [f.waypoints[0], wp];
    for (let y = 0; y < 10 && f.borderExit; y++) generateTurn(g);
    check(!f.borderExit && g.year <= by && B.closedFor(g, 0, f) === -1 && DIP.statusOf(g, 0, 1) === 'peace', `ordered out by the shortest way, it is out in time (${g.year}, by ${by}): no war`);
  }

  console.log('--- short of fuel');
  {
    const g = fresh();
    const f = caught(g, { fuel: 0 });
    B.setBorders(g, 1, 0, true);
    const plan = B.exitPlan(g, f)!;
    check(plan.stranded, `an empty tank, ${Math.round(plan.dist)} al from the border: stranded (Warp ${plan.warp}, ${plan.years} years)`);
    generateTurn(g);
    const by = f.borderExit?.by ?? 0;
    check(!!f.borderExit?.stranded && say(g, 0, "n'a pas assez de carburant pour en sortir à temps"), `the player is told to refuel it by ${by}`);
    for (let y = 0; y < 12 && g.fleets.includes(f); y++) { f.fuel = 0; generateTurn(g); }
    check(!g.fleets.includes(f) && g.year === by, `still stranded at the deadline: dismantled (${g.year})`);
    check(say(g, 0, 'elle a été démantelée sur place') && DIP.statusOf(g, 0, 1) === 'peace', 'the player is told, and there is no war');
  }
  {
    const g = fresh();
    const f = caught(g, { fuel: 0 });
    B.setBorders(g, 1, 0, true);
    generateTurn(g);
    const by = f.borderExit!.by;
    f.fuel = fleetSpec(g, f).fuelCapacity; // a tanker came
    while (g.year < by) { f.waypoints = [f.waypoints[0]]; generateTurn(g); }
    check(g.fleets.includes(f) && !f.borderExit?.stranded && f.borderExit?.warned === by, 'refuelled in time, it is no longer dismantled: warned like any other');
  }
  {
    const g = fresh();
    const f = caught(g, { fuel: 0, ramscoop: true });
    const sp = fleetSpec(g, f);
    B.setBorders(g, 1, 0, true);
    const plan = B.exitPlan(g, f)!;
    check(sp.freeSpeed <= 1 || !plan.stranded, `free-speed engines (Warp ${sp.freeSpeed}) need no fuel to get out (${plan.years} years)`);
  }

  console.log('--- automatic');
  {
    const g = fresh();
    const f = caught(g);
    f.auto = 'explore';
    B.setBorders(g, 1, 0, true);
    generateTurn(g);
    check(!!f.borderExit && say(g, 0, 'sous un ordre automatique, elle en sort'), 'under an automatic order, it is told to get out by itself');
    for (let y = 0; y < 10 && f.borderExit; y++) { f.fuel = fleetSpec(g, f).fuelCapacity; generateTurn(g); if (process.env.DBG) console.log(g.year, f.x, f.y, JSON.stringify(f.borderExit), B.closedFor(g, 0, f), f.auto, f.waypoints.map(w => w.x + ',' + w.y + ':' + w.warp).join(' '), g.fleets.includes(f)); }
    check(g.fleets.includes(f) && !f.borderExit && B.closedFor(g, 0, f) === -1 && DIP.statusOf(g, 0, 1) === 'peace', `and it does (${f.x}, ${f.y}): no war`);
  }
  {
    const g = fresh();
    const h = hw(g, 1);
    const f2 = g.fleets.find(f => f.owner === 2 && f.tokens.length && !f.immobile && f.beaconOf === undefined && fleetSpec(g, f).hasEngines)!;
    f2.x = h.x - 3; f2.y = h.y + 2; f2.orbiting = -1; f2.waypoints = [{ x: f2.x, y: f2.y, target: 'space', task: 'none', warp: 0, processed: true }];
    f2.fuel = fleetSpec(g, f2).fuelCapacity;
    B.setBorders(g, 1, 2, true);
    const inside = B.closedFor(g, 2, f2) === 1;
    for (let y = 0; y < 10 && g.fleets.includes(f2) && (y === 0 || f2.borderExit); y++) generateTurn(g);
    check(inside && g.fleets.includes(f2) && B.closedFor(g, 2, f2) === -1 && !g.players[2].messages.some(m => m.text.includes('est restée dans le territoire')), `a computer's fleet caught inside gets out by itself (${f2.x}, ${f2.y})`);
  }

  console.log('--- at home, merges, splits');
  {
    const g = fresh();
    const f = caught(g);
    B.setBorders(g, 1, 0, true);
    generateTurn(g);
    const by = f.borderExit!.by;
    const f2 = caught(g);
    f2.x = f.x; f2.y = f.y;
    generateTurn(g);
    check(!!f2.borderExit && f2.borderExit.by > by, 'a fleet arriving later gets a later delay');
    mergeFleets(g, f2, f);
    check(f2.borderExit?.by === by, 'merged, the fleet keeps the shorter delay');
    f2.tokens[0].qty = Math.max(f2.tokens[0].qty, 2);
    const part = splitFleet(g, f2, [{ designId: f2.tokens[0].designId, qty: 1 }]);
    check(!!part && part.borderExit?.by === by, 'split, both parts keep it');
  }
  {
    const g = fresh();
    const f = caught(g);
    // one of their worlds becomes ours (a colony inside their territory): a fleet in its orbit is at home
    const h = hw(g, 1), m = (B.setBorders(g, 1, 0, true), B.closedMask(g, 0)!);
    const pl = g.planets.filter(p => p.owner < 0 && B.closedAt(m, p.x, p.y) === 1).sort((a, b) => distance(a, h) - distance(b, h))[0];
    if (pl) {
      pl.owner = 0; pl.pop = 5000;
      f.x = pl.x; f.y = pl.y; f.orbiting = pl.id;
      generateTurn(g);
      check(!f.borderExit && DIP.statusOf(g, 0, 1) === 'peace', `in orbit of one of its own worlds, a fleet is at home (${pl.name})`);
    } else check(true, 'no free world inside their territory to test a fleet at home');
  }

  console.log(bad ? `${bad} FAILED, ${good} ok` : `all good (${good})`);
  if (bad) process.exit(1);
}
void main();
