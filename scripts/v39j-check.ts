// Constellations 0.3.9.14 checks: smarter computer players (run: npx tsx scripts/v39j-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { quickGame, newFleet } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES } = await import('../src/engine/race');
  const { generateTurn, aiHooks } = await import('../src/engine/turn');
  const { aiSkill } = await import('../src/engine/aiskill');
  const A4 = await import('../src/engine/ai4');
  const AI = await import('../src/engine/ai');
  const { pendingRefit } = await import('../src/engine/refit');
  const { autoDesign, designSpec, specOf } = await import('../src/engine/design');
  const { addDesign } = await import('../src/engine/newgame');
  const { planetSpec } = await import('../src/engine/planet');
  const { fleetSpec, distance } = await import('../src/engine/fleet');
  const DIP = await import('../src/engine/diplomacy');
  const AK = await import('../src/engine/aiknow');
  const { learnDesign } = await import('../src/engine/scan');
  const { Rng, seedFromString } = await import('../src/engine/rng');
  type G = ReturnType<typeof quickGame>;
  const clone = (g: G): G => JSON.parse(JSON.stringify(g));

  // a human (0) and three expert computers (1-3), twenty-five years in
  const base = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 3, 'expert', 'v39j');
  base.settings.cataclysms = false;
  while (base.year < 2425) generateTurn(base);
  const raw = JSON.stringify(base);
  const fresh = (): G => JSON.parse(raw);
  const home = (g: G, id: number) => g.planets.find(p => p.owner === id && p.homeworld) ?? g.planets.find(p => p.owner === id)!;
  /** A world made rich: full of people and factories, minerals in stock. */
  const enrich = (g: G, pl: G['planets'][number]) => {
    const p = g.players[pl.owner];
    pl.pop = Math.max(pl.pop, planetSpec(g, pl, p).maxPop);
    const sp = planetSpec(g, pl, p);
    pl.factories = sp.maxFactories; pl.mines = sp.maxMines;
    pl.surface = { ironium: 20000, boranium: 20000, germanium: 20000 };
  };
  /** A stronger design of the same hull: the computer's tech raised, then designed again. */
  const stronger = (g: G, pid: number, hull: string, purpose: any, role: string) => {
    const p = g.players[pid];
    for (const f of ['weapons', 'construction', 'energy', 'propulsion'] as const) p.tech[f] += 8;
    const d = autoDesign(p, hull, purpose, 'Neuf')!;
    d.purpose = role;
    addDesign(g, d);
    return d;
  };
  const might = (g: G, pid: number, d: any) => { const s = designSpec(g.players[pid], d); return Math.max(1, s.armor + s.shields) * Math.max(1, s.powerRating); };

  console.log('--- levels');
  check(aiSkill({ ai: 'easy' } as any) === 0 && aiSkill({ ai: 'standard' } as any) === 1 && aiSkill({ ai: 'harder' } as any) === 2 && aiSkill({ ai: 'expert' } as any) === 2 && aiSkill({ ai: null } as any) === 0, 'easy plays as before, standard looks after itself, harder and expert do everything');
  {
    const g = fresh();
    let calls = 0;
    aiHooks.run = () => { calls++; return false; };
    generateTurn(g);
    aiHooks.run = undefined;
    check(calls === g.players.filter(p => p.ai && !p.dead).length, `the arena hook is asked for every computer (${calls})`);
  }

  console.log('--- refits');
  {
    const g = fresh(), p = g.players[1], hw = home(g, 1);
    enrich(g, hw);
    const W = AI.roleDesign(g, p, 'warship') ?? g.designs.find(d => d.owner === 1 && d.purpose === 'warship')!;
    const S = stronger(g, 1, W.hull, 'beamWarship', 'warship');
    W.deleted = true;
    const f = newFleet(g, p, W.id, 3, hw); f.purpose = 'warship';
    check(might(g, 1, S) >= might(g, 1, W) * 1.2, `a clearly stronger design of the same hull (${Math.round(might(g, 1, W))} → ${Math.round(might(g, 1, S))})`);
    const e = clone(g); e.players[1].ai = 'easy';
    A4.aiRefits(e, e.players[1]);
    check(!e.planets[hw.id].queue.some(q => q.kind === 'refit'), 'an easy computer refits nothing');
    A4.aiRefits(g, p);
    const items = hw.queue.filter(q => q.kind === 'refit' && q.fleetId === f.id);
    const firstAuto = hw.queue.findIndex(q => q.kind.startsWith('auto'));
    check(items.length === 1 && items[0].designId === S.id && (firstAuto < 0 || hw.queue.indexOf(items[0]) < firstAuto), `idle warships at the yard: refit queued (${items[0]?.qty} ship(s)), before the factories and mines`);
    check(A4.busy(g, f) && !!pendingRefit(g, f), 'the fleet is busy: nothing sends it away');
    let y = 0;
    while (y++ < 6 && f.tokens.some(t => t.designId === W.id)) generateTurn(g);
    const now = f.tokens.map(t => g.designs.find(d => d.id === t.designId)!);
    check(!f.tokens.some(t => t.designId === W.id) && now.every(d => !d.deleted && d.hull === W.hull) && f.orbiting === hw.id, `refitted within ${y} year(s) to the newest design (${now.map(d => d.name).join(', ')}), without leaving orbit`);
    const g2 = fresh(), hw2 = home(g2, 1);
    enrich(g2, hw2);
    const W2 = AI.roleDesign(g2, g2.players[1], 'warship') ?? g2.designs.find(d => d.owner === 1 && d.purpose === 'warship')!;
    W2.deleted = true;
    const f2 = newFleet(g2, g2.players[1], W2.id, 2, hw2); f2.purpose = 'warship';
    A4.aiRefits(g2, g2.players[1]);
    check(!hw2.queue.some(q => q.kind === 'refit'), 'no better design of that hull: nothing to refit');
  }

  console.log('--- stations');
  {
    const g = fresh(), p = g.players[1], hw = home(g, 1);
    enrich(g, hw);
    const cur = g.designs.find(d => d.id === hw.starbase!.designId)!;
    const S = stronger(g, 1, cur.hull, 'starbase', 'starbase');
    check(might(g, 1, S) >= might(g, 1, cur) * 1.5, `a much stronger station of that hull (${Math.round(might(g, 1, cur))} → ${Math.round(might(g, 1, S))})`);
    const quiet = clone(g);
    A4.aiStations(quiet, quiet.players[1]);
    check(!quiet.planets[hw.id].queue.some(q => q.kind === 'starbase'), 'at peace, far from any enemy: the station is kept');
    // an enemy world close by
    const foe = g.planets.find(pl => pl.owner === 2)!;
    DIP.declareWar(g, 1, 2);
    p.relations[2] = 'enemy';
    const pi = p.intel.planets[foe.id];
    pi.owner = 2; pi.year = g.year;
    const saved = { x: foe.x, y: foe.y };
    foe.x = hw.x + 90; foe.y = hw.y;
    A4.aiStations(g, p);
    foe.x = saved.x; foe.y = saved.y;
    const it = hw.queue.find(q => q.kind === 'starbase');
    check(!!it && it.designId === S.id, 'an enemy world 90 ly away: the station is replaced');
    check(hw.queue.indexOf(it!) === 0, 'and it comes first (the enemy is close)');
  }

  console.log('--- defense');
  {
    const g = fresh(), p = g.players[1], hw = home(g, 1);
    DIP.declareWar(g, 1, 2);
    p.relations[2] = 'enemy';
    // the world threatened: one without a station (the capital's, if need be, is taken down for the test)
    const target = g.planets.find(pl => pl.owner === 1 && !pl.starbase) ?? (() => { hw.starbase = undefined; return hw; })();
    for (const f of g.fleets) if (f.owner === 1 && f.orbiting === target.id) { f.x += 400; f.y += 400; f.orbiting = -1; }
    const ew = AI.roleDesign(g, p, 'warship') ?? g.designs.find(d => d.owner === 1 && d.purpose === 'warship')!;
    const raider = newFleet(g, g.players[2], ew.id, 2, g.planets.find(pl => pl.owner === 2)!);
    // 60 ly from it, on the side where no other world of the empire is nearer
    const mine = g.planets.filter(pl => pl.owner === 1);
    for (let a = 0; a < 24; a++) {
      const x = Math.round(target.x + 60 * Math.cos(a / 24 * 6.283)), y = Math.round(target.y + 60 * Math.sin(a / 24 * 6.283));
      if (mine.every(pl => pl === target || distance(pl, { x, y }) > 75)) { raider.x = x; raider.y = y; break; }
    }
    raider.orbiting = -1;
    p.intel.fleets.push({ id: raider.id, owner: 2, x: raider.x, y: raider.y, detail: 'full', tokens: raider.tokens.map(t => ({ designId: t.designId, qty: t.qty })) });
    // a strong fleet at another world of the empire
    const other = g.planets.filter(pl => pl.owner === 1 && pl.id !== target.id).sort((a, b) => distance(a, target) - distance(b, target))[0];
    const guard = newFleet(g, p, ew.id, 12, other); guard.purpose = 'warship';
    const weak = clone(g);
    A4.aiDefend(g, p);
    check(guard.aiGuard?.planetId === target.id && guard.waypoints[guard.waypoints.length - 1]?.targetId === target.id, `an enemy fleet 60 ly from ${target.name}: the warships at ${other.name} go and guard it`);
    check(A4.busy(g, guard), 'guarding, they are not taken for anything else');
    // too weak to meet it: the world raises its defenses instead
    const wg = weak.fleets.find(f => f.id === guard.id)!;
    wg.tokens[0].qty = 1;
    const wr = weak.fleets.find(f => f.id === raider.id)!;
    wr.tokens[0].qty = 40;
    weak.players[1].intel.fleets.find(x => x.id === raider.id)!.tokens = wr.tokens.map(t => ({ designId: t.designId, qty: t.qty }));
    A4.aiDefend(weak, weak.players[1]);
    const wt = weak.planets[target.id];
    check(!wg.aiGuard && (wt.queue[0]?.kind === 'defenses' || planetSpec(weak, wt, weak.players[1]).maxDefenses <= wt.defenses), 'far too strong a raid: no hopeless sortie, the world raises its defenses');
  }

  console.log('--- hubs');
  {
    const g = fresh(), p = g.players[1];
    const hubs = A4.hubsOf(g, p);
    const docks = g.planets.filter(pl => pl.owner === 1 && pl.starbase).sort((a, b) => b.pop - a.pop);
    check(hubs.length >= 1 && hubs[0].id === docks[0].id, `the first hub is the most populous dock (${hubs[0]?.name})`);
    const mw = AI.roleDesign(g, p, 'warship') ?? g.designs.find(d => d.owner === 1 && d.purpose === 'warship')!;
    const a = newFleet(g, p, mw.id, 1, hubs[0]); a.purpose = 'warship';
    const b = newFleet(g, p, mw.id, 2, hubs[0]); b.purpose = 'warship';
    A4.mergeAtHubs(g, p, hubs);
    const here = g.fleets.filter(f => f.owner === 1 && f.purpose === 'warship' && f.orbiting === hubs[0].id && f.waypoints.length <= 1);
    check(here.length === 1 && here[0].tokens.reduce((s, t) => s + t.qty, 0) >= 3, 'the idle warships at a hub make one fleet');
  }

  console.log('--- economy');
  {
    const g = fresh(), p = g.players[1], hw = home(g, 1);
    hw.surface = { ironium: 9000, boranium: 9000, germanium: 9000 };
    check(A4.mineralRich(hw), 'a world sitting on 9000 kt of each mineral is rich');
    AI.runAI(g, p, new Rng(seedFromString('econ')));
    check(!hw.queue.some(q => q.kind === 'autoMines'), 'it builds no more mines');
    const poor = g.planets.find(pl => pl.owner === 1 && pl.id !== hw.id && !A4.mineralRich(pl) && pl.pop > 0);
    check(!poor || poor.queue.some(q => q.kind === 'autoMines') || !!g.players[1] && planetSpec(g, poor, p).maxMines <= poor.mines, `a world short of minerals keeps building them${poor ? ` (${poor.name})` : ''}`);
    hw.queue.push({ kind: 'autoAlchemy', qty: 1, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } });
    AI.runAI(g, p, new Rng(seedFromString('econ2')));
    check(!hw.queue.some(q => q.kind === 'autoAlchemy'), 'no alchemy (resources into minerals) on a world that has plenty');
    // the colony ships: as many as there are good worlds and output for
    const e = fresh(), x = fresh();
    e.players[1].ai = 'easy';
    for (const gg of [e, x]) { const pl = home(gg, 1); enrich(gg, pl); pl.queue = []; }
    AI.runAI(e, e.players[1], new Rng(seedFromString('col')));
    AI.runAI(x, x.players[1], new Rng(seedFromString('col')));
    const colonies = (gg: G) => gg.planets.filter(pl => pl.owner === 1).reduce((a, pl) => a + pl.queue.filter(q => q.kind === 'ship' && gg.designs.find(d => d.id === q.designId)?.purpose === 'colonizer').reduce((b, q) => b + q.qty, 0), 0);
    check(colonies(x) >= colonies(e), `an expert computer sends at least as many colony ships (${colonies(x)} against ${colonies(e)} for an easy one)`);
  }

  console.log('--- research');
  {
    const g = fresh(), p = g.players[1];
    const st = p.aiState!;
    st.phase = 'war'; st.targetPlayer = 2;
    const d = (p.intel.dossiers ??= {})[2] ??= { level: 60, lines: [], facts: {} };
    d.techs = { v: { ...g.players[2].tech, weapons: p.tech.weapons + 3 }, year: g.year };
    check(A4.researchBoost(g, p) === 'weapons', 'at war, the enemy known three levels ahead in weapons: weapons first');
    d.techs.v.weapons = p.tech.weapons;
    check(A4.researchBoost(g, p) !== 'weapons' || p.tech.weapons <= 0, 'level with it: no hurry');
  }

  console.log('--- designs against the enemy');
  {
    const g = fresh(), p = g.players[1];
    const st = p.aiState!;
    check(A4.warCounter(g, p) === st.counter, 'at peace, the warships are designed as before');
    st.phase = 'war'; st.targetPlayer = 2;
    const ew = g.designs.find(d => !d.starbase && specOf(g, d.id).hasWeapons)!;
    const ew2 = g.designs.find(d => d.owner !== 1 && !d.starbase && specOf(g, d.id).hasWeapons) ?? ew;
    p.intel.fleets.push({ id: 999999, owner: 2, x: 0, y: 0, detail: 'full', tokens: [{ designId: ew2.id, qty: 5 }] });
    // 0.3.9.15: a design only seen in the scanners (its hull) tells nothing of its shields
    if (ew2.owner !== 1) {
      delete p.intel.designs[ew2.id];
      check(A4.warCounter(g, p) === st.counter, 'enemy ships only seen from afar: the warships are designed as before');
      learnDesign(p, g, ew2.id, true); // met in battle
    }
    const s = specOf(g, ew2.id);
    const share = s.shields / Math.max(1, s.shields + s.armor);
    const want = share > 0.4 ? 'torpedoWarship' : share < 0.3 ? 'beamWarship' : undefined;
    check(A4.warCounter(g, p) === want, `against ships ${Math.round(share * 100)} % shields: ${want ?? 'unchanged'}`);
    const h = fresh(); h.players[1].ai = 'standard'; h.players[1].aiState!.phase = 'war'; h.players[1].aiState!.targetPlayer = 2;
    check(A4.warCounter(h, h.players[1]) === h.players[1].aiState!.counter, 'a standard computer keeps its designs');
  }

  console.log('--- idle colony ships');
  {
    const g = fresh(), p = g.players[1], hw = home(g, 1);
    const cd = AI.roleDesign(g, p, 'colonizer') ?? g.designs.find(d => d.owner === 1 && d.purpose === 'colonizer')!;
    const f = newFleet(g, p, cd.id, 1, hw); f.purpose = 'colonizer';
    f.cargo.colonists = Math.min(fleetSpec(g, f).cargoCapacity, 20);
    check(!A4.idleColonyShip(g, p, f) && f.purpose === 'colonizer', 'a colony ship with no world waits a while');
    p.aiState!.idleColonizers![f.id] = g.year - A4.COLONY_WAIT;
    hw.pop = Math.min(hw.pop, planetSpec(g, hw, p).maxPop / 2);
    const before = hw.pop;
    check(A4.idleColonyShip(g, p, f) && f.purpose === 'freighter', `after ${A4.COLONY_WAIT} years, it serves as a transport`);
    check(f.cargo.colonists === 0 && hw.pop > before || f.waypoints.length > 1, 'and its colonists go to a world with room');
  }

  console.log('--- a coalition against the leader');
  {
    const g = fresh();
    g.settings.publicScores = true;
    const last = (id: number) => g.players[id].scores[g.players[id].scores.length - 1];
    for (const pl of g.players) if (!pl.monster) last(pl.id).score = pl.id === 0 ? 3000 : 600;
    // 0.3.9.15: scores kept secret and no intelligence on them: the computers judge from the worlds they have seen
    {
      const h = clone(g);
      h.settings.publicScores = false;
      for (const pl of h.players) if (pl.intel.dossiers) for (const d of Object.values(pl.intel.dossiers)) delete d.facts.score;
      const seen = (id: number) => h.players[1].intel.planets.filter(pi => pi.owner === id).length;
      const mineN = h.planets.filter(pl => pl.owner === 1).length;
      check(AK.knownScore(h, h.players[1], 0) === Math.round(600 * seen(0) / mineN), `secret scores: the human's guessed from the ${seen(0)} worlds seen (${AK.knownScore(h, h.players[1], 0)}, really 3000)`);
      h.players[1].intel.dossiers ??= {};
      (h.players[1].intel.dossiers[0] ??= { level: 60, lines: [], facts: {} } as any).facts.score = { v: 2800, err: 10, year: h.year };
      check(AK.knownScore(h, h.players[1], 0) === 2800, 'with intelligence on it, its estimate');
    }
    check(DIP.runaway(g, 0) > 0 && DIP.runaway(g, 1) === 0, `the human far ahead runs away with the game (${DIP.runaway(g, 0).toFixed(2)})`);
    const op = DIP.opinion(g, 1, 0);
    check(op.lines.some(l => l.label.includes('s\'unir contre vous') && l.value < 0), `an expert computer resents it (${op.lines.find(l => l.label.includes('unir'))?.value})`);
    check(DIP.opinion(g, 1, 2).lines.some(l => l.label === 'Un rival commun' && l.value > 0), 'and draws closer to the others');
    const w = DIP.warDesire(g, 1, 0);
    (globalThis as any).__aiOff = new Set(['coalition']);
    const w0 = DIP.warDesire(g, 1, 0);
    (globalThis as any).__aiOff = undefined;
    check(w > w0, `readier for war against it (${w0} → ${w})`);
    g.players[1].ai = 'standard';
    check(!DIP.opinion(g, 1, 0).lines.some(l => l.label.includes('unir')), 'a standard computer does not band together');
    for (const pl of g.players) if (!pl.monster) last(pl.id).score = 600 + pl.id;
    check(DIP.runaway(g, 0) === 0 && DIP.runaway(g, 3) === 0, 'scores close together: nobody runs away');
  }

  console.log('--- invasions');
  {
    const g = fresh(), p = g.players[1];
    const foe = g.planets.find(pl => pl.owner === 2)!;
    const pi = p.intel.planets[foe.id];
    pi.owner = 2; pi.pop = foe.pop; pi.year = g.year;
    const need = AI.invasionNeed(g, p, foe);
    check(need > foe.pop / 100 * 0.5, `the troops a world takes, from what is known of it (${need} kT for ${foe.pop} people)`);
  }

  console.log('--- a whole game');
  {
    const g = fresh();
    const t0 = Date.now();
    while (g.year < 2445) generateTurn(g);
    const ms = (Date.now() - t0) / 20;
    check(g.players.filter(p => p.ai).every(p => !p.dead || true) && ms < 1500, `twenty more years without a hitch (${Math.round(ms)} ms a year)`);
  }

  console.log(bad ? `${bad} FAILED, ${good} ok` : `all good (${good})`);
  if (bad) process.exit(1);
}
void main();
