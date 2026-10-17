// Constellations 0.3.9.16 checks: battles, mines, bombing and invasions as in Stars! (run: npx tsx scripts/v39l-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { quickGame, newFleet, addDesign } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES } = await import('../src/engine/race');
  const { generateTurn } = await import('../src/engine/turn');
  const BT = await import('../src/engine/battle');
  const MV = await import('../src/engine/movement');
  const TK = await import('../src/engine/tasks');
  const { autoDesign, specOf } = await import('../src/engine/design');
  const { fleetSpec } = await import('../src/engine/fleet');
  const { planetSpec } = await import('../src/engine/planet');
  const { Rng, seedFromString } = await import('../src/engine/rng');
  const DIP = await import('../src/engine/diplomacy');
  type G = ReturnType<typeof quickGame>;

  const base = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 2, 'standard', 'v39l');
  base.settings.cataclysms = false;
  while (base.year < 2420) generateTurn(base);
  const raw = JSON.stringify(base);
  const fresh = (): G => JSON.parse(raw);
  const home = (g: G, id: number) => g.planets.find(p => p.owner === id && p.homeworld) ?? g.planets.find(p => p.owner === id)!;
  /** A design of `hull` for `purpose`, owned by `owner`, at high tech. */
  const design = (g: G, owner: number, hull: string, purpose: any, name: string, tech = 10) => {
    const p = g.players[owner];
    const save = { ...p.tech };
    for (const k of Object.keys(p.tech) as (keyof typeof p.tech)[]) p.tech[k] = Math.max(p.tech[k], tech);
    const d = autoDesign(p, hull, purpose, name)!;
    p.tech = save;
    return addDesign(g, { ...d, owner } as any);
  };
  const deep = (g: G, f: any, x: number, y: number) => { f.x = x; f.y = y; f.orbiting = -1; f.waypoints = [{ x, y, target: 'space', task: 'none', warp: 0, processed: true }]; };

  console.log('--- armour damage (help: "Armor, Shields and Damage")');
  {
    const t = { armor: 150, qty: 10, damage: 0, qtyDamaged: 0 };
    check(BT.armorHit(t, 500) === 3 && t.qty === 7 && Math.abs(t.damage - 50 / 7) < 1e-6 && t.qtyDamaged === 7, 'the help\'s example: 500 dp on 10 ships of 150 kill 3, the 7 others take about 7 each (under 5 %)');
    const u = { armor: 100, qty: 5, damage: 10, qtyDamaged: 5 };
    check(BT.armorHit(u, 60) === 0 && u.qty === 5 && Math.abs(u.damage - 22) < 1e-6, 'five ships at 10 damage hit for 60: nobody dies, all five at 22');
    const v = { armor: 150, qty: 10, damage: 75, qtyDamaged: 10 };
    check(BT.armorHit(v, 1) === 0 && v.qty === 10, 'a stack already at 50 % hit for 1 dp loses no ship (it lost 5 before)');
    const w = { armor: 100, qty: 4, damage: 60, qtyDamaged: 2 };
    check(BT.armorHit(w, 90) === 2 && w.qty === 2 && Math.abs(w.damage - 5) < 1e-6, 'the damaged ships go first (2 × 40 dp left), the rest is spread over the whole ones');
    const x = { armor: 100, qty: 10, damage: 0, qtyDamaged: 0 };
    check(BT.armorHit(x, 950, 1) === 1 && x.qty === 9, 'a torpedo kills one ship at most');
  }

  console.log('--- targets');
  {
    const g = fresh();
    const d = design(g, 1, 'Destroyer', 'beamWarship', 'Cible');
    const sp = specOf(g, d.id);
    const tok = (qty: number) => ({ spec: sp, qty, armor: sp.armor, damage: 0, qtyDamaged: 0, stackShields: sp.shields * qty, cost: sp.cost } as any);
    const w = sp.weapons[0];
    const one = BT.attractiveness(w, tok(1), tok(1)), ten = BT.attractiveness(w, tok(1), tok(10));
    check(Math.abs(one - ten) < 1e-9 * one, `ten ships in one stack are as worth shooting as one alone (${one.toFixed(4)} and ${ten.toFixed(4)}; ten times less before)`);
  }

  console.log('--- fire back, and the cargo of the ships lost');
  {
    const g = fresh();
    g.players[0].ai = null;
    const wd = design(g, 0, 'Destroyer', 'beamWarship', 'Garde');
    const ad = design(g, 1, 'Destroyer', 'beamWarship', 'Assaillant');
    const fd = design(g, 0, 'Medium Freighter', 'freighter', 'Convoi');
    const mine = newFleet(g, g.players[0], wd.id, 3, home(g, 0));
    const conv = newFleet(g, g.players[0], fd.id, 2, home(g, 0));
    const foe = newFleet(g, g.players[1], ad.id, 6, home(g, 1));
    for (const f of [mine, conv, foe]) deep(g, f, 5, 5);
    conv.cargo.ironium = 100;
    g.players[0].battlePlans[0].attackWho = 'nobody';
    g.players[0].relations[1] = 'friend';
    mine.battlePlan = 0; conv.battlePlan = 0;
    g.players[1].relations[0] = 'enemy';
    g.diplomacy = undefined; g.settings.diplomacy = false as any;
    const recs = BT.resolveBattles(g, new Rng(seedFromString('v39l-b')));
    const rec = recs[0];
    const ourIds = new Set(rec?.tokens.filter(t => t.owner === 0).map(t => t.id) ?? []);
    check(!!rec && rec.actions.some(a => a.t === 'fire' && ourIds.has(a.id)), 'attacked, our warships fire back although their plan attacks nobody (Stars! "Guts")');
    void conv;
    // a convoy caught alone: what its lost ships carried is left in space
    const c = fresh();
    const cfd = design(c, 0, 'Medium Freighter', 'freighter', 'Convoi');
    const cad = design(c, 1, 'Destroyer', 'beamWarship', 'Pirate', 14);
    const cv = newFleet(c, c.players[0], cfd.id, 4, home(c, 0));
    const raider = newFleet(c, c.players[1], cad.id, 2, home(c, 1));
    deep(c, cv, 5, 5); deep(c, raider, 5, 5);
    cv.cargo.ironium = 200;
    c.players[1].relations[0] = 'enemy'; c.diplomacy = undefined; c.settings.diplomacy = false as any;
    const hull = specOf(c, cfd.id).cost.ironium;
    BT.resolveBattles(c, new Rng(seedFromString('v39l-c')));
    const left = c.fleets.includes(cv) ? cv.tokens[0]?.qty ?? 0 : 0;
    const salv = c.salvage.reduce((a, s) => a + s.cargo.ironium, 0);
    const want = Math.ceil(200 * (4 - left) / 4) + Math.trunc(hull * (4 - left) / 3);
    check(left < 4 && salv === want && (left === 0 || cv.cargo.ironium === 200 - Math.ceil(200 * (4 - left) / 4)), `${4 - left} freighters of 4 lost: their share of the cargo is left in space with a third of their hulls (${salv} kt of ironium, ${want} expected)`);
  }

  console.log('--- mines (Guts of Minefields)');
  {
    const g = fresh();
    const d = design(g, 0, 'Destroyer', 'beamWarship', 'Démineur', 3);
    const sp = specOf(g, d.id);
    const f = newFleet(g, g.players[0], d.id, 10, home(g, 0));
    deep(g, f, 300, 300);
    const m = { id: 1, owner: 1, x: 300, y: 300, mines: 2000, type: 'standard' } as any;
    MV.mineDamage(g, f, m, false);
    const per = (100 * Math.max(1, sp.numEngines) * 10 - Math.min(sp.shields * 10, 500 * Math.max(1, sp.numEngines))) / 10;
    check(g.fleets.includes(f) && f.tokens[0].qty === 10 && f.tokens[0].damage === Math.floor(per), `10 destroyers hit by a mine: all 10 survive, ${f.tokens[0]?.damage} damage each (5 were lost before)`);
    const g2 = fresh();
    const two = design(g2, 0, 'Cruiser', 'beamWarship', 'Bimoteur', 9);
    const s2 = specOf(g2, two.id);
    const f2 = newFleet(g2, g2.players[0], two.id, 2, home(g2, 0));
    deep(g2, f2, 300, 300);
    MV.mineDamage(g2, f2, m, false);
    const taken = (f2.tokens[0]?.damage ?? s2.armor) * 2;
    const expect = 500 * s2.numEngines - Math.min(s2.shields * 2, 500 * s2.numEngines / 2);
    check(s2.numEngines < 2 || Math.abs(taken - expect) <= 2, `a small fleet of ${s2.numEngines}-engine ships takes the minimum times its engines (${taken} dp for ${expect})`);
    // two identical fields on top of each other strike no more often than one
    const trials = (fields: number) => {
      let hits = 0;
      for (let i = 0; i < 300; i++) {
        const gg = fresh();
        const dd = design(gg, 0, 'Destroyer', 'beamWarship', 'Démineur', 3);
        const ff = newFleet(gg, gg.players[0], dd.id, 1, home(gg, 0));
        deep(gg, ff, 100, 300);
        gg.minefields = Array.from({ length: fields }, (_, k) => ({ id: 900 + k, owner: 1, x: 130, y: 300, mines: 400, type: 'standard' } as any));
        gg.players[1].relations[0] = 'enemy'; gg.players[0].relations[1] = 'enemy'; gg.diplomacy = undefined; gg.settings.diplomacy = false as any;
        ff.waypoints.push({ x: 170, y: 300, target: 'space', task: 'none', warp: 9 });
        ff.fuel = fleetSpec(gg, ff).fuelCapacity;
        const before = ff.waypoints.length;
        (MV as any).moveFleets(gg, new Rng(seedFromString('mf' + i)));
        if (gg.players[0].messages.some(mm => mm.text.includes('heurté un champ de mines'))) hits++;
        void before;
      }
      return hits;
    };
    const h1 = trials(1), h2 = trials(2);
    check(h2 <= h1 * 1.25 + 8, `overlapping fields are rolled once: ${h1} hits in 300 crossings of one field, ${h2} of two on top of each other`);
  }

  console.log('--- foreign fleets');
  {
    const g = fresh();
    const fd = design(g, 0, 'Medium Freighter', 'freighter', 'Pillard');
    const td = design(g, 1, 'Medium Freighter', 'freighter', 'Victime');
    const thief = newFleet(g, g.players[0], fd.id, 1, home(g, 0));
    const victim = newFleet(g, g.players[1], td.id, 1, home(g, 1));
    deep(g, thief, 50, 50); deep(g, victim, 50, 50);
    victim.cargo.boranium = 80; victim.fuel = 200;
    check(TK.transferBetweenFleets(g, victim, thief, 'boranium', 80, 0) === 0 && victim.cargo.boranium === 80, 'no cargo taken from another empire\'s fleet without a steal scanner');
    check(TK.transferBetweenFleets(g, victim, thief, 'fuel', 50, 0) === 0, '... nor its fuel');
    g.players[1].relations[0] = 'enemy';
    thief.cargo.ironium = 10;
    check(TK.transferBetweenFleets(g, thief, victim, 'ironium', 10, 0) === 0, 'a fleet accepts nothing from an empire it treats as an enemy');
    // a waypoint on a fleet out of sight: where it was last seen
    const hunter = newFleet(g, g.players[0], fd.id, 1, home(g, 0));
    deep(g, hunter, 0, 0);
    g.players[0].intel.fleets = g.players[0].intel.fleets.filter(x => x.id !== victim.id);
    const wp = { x: 40, y: 40, target: 'fleet' as const, targetId: victim.id, task: 'none' as const, warp: 6 };
    const p = MV.targetPosition(g, wp, 0);
    check(p.x === 40 && p.y === 40, 'a fleet followed out of sight: the waypoint stays where it was last seen');
    g.players[0].intel.fleets.push({ id: victim.id, owner: 1, x: 50, y: 50, detail: 'full' });
    const q = MV.targetPosition(g, wp, 0);
    check(q.x === 50 && q.y === 50, '... and follows it again once seen');
  }

  console.log('--- invasions');
  {
    const g = fresh();
    const target = g.planets.find(pl => pl.owner === 1 && !pl.homeworld) ?? home(g, 1);
    target.starbase = null; target.pop = 20000; target.defenses = 0;
    DIP.declareWar(g, 0, 1);
    g.players[0].relations[1] = 'enemy'; g.players[1].relations[0] = 'enemy';
    const td = design(g, 0, 'Medium Freighter', 'freighter', 'Troupes');
    const f = newFleet(g, g.players[0], td.id, 3, home(g, 0));
    f.x = target.x; f.y = target.y; f.orbiting = target.id;
    f.cargo.colonists = 300;
    const moved = TK.transferWithPlanet(g, f, target, 'colonists', -300);
    check(moved === -300 && target.owner === 1 && (g.landings ?? []).length === 1, 'troops dropped by hand land, but the outcome waits for the turn (no more peeking at the defenders, then undoing)');
    TK.resolveLandings(g);
    check(target.owner === 0 && target.pop > 0, `resolved with the turn: the world is taken (${target.pop} colonists left)`);
    // two empires landing together: they fight it out
    const h = fresh();
    const t2 = h.planets.find(pl => pl.owner < 0 && pl.id !== home(h, 0).id)!;
    t2.owner = 1; t2.pop = 10000; t2.defenses = 0; t2.starbase = null;
    const third = h.players.find(p => p.id !== 0 && p.id !== 1 && !p.monster);
    if (third) {
      for (const [a, b] of [[0, 1], [third.id, 1], [0, third.id]]) DIP.declareWar(h, a, b);
      h.landings = [{ planetId: t2.id, owner: 0, kt: 150, fleetId: -1, fleetName: 'A' }, { planetId: t2.id, owner: third.id, kt: 400, fleetId: -2, fleetName: 'B' }];
      TK.resolveLandings(h);
      check(t2.owner === third.id, `two empires landing on the same world the same year: the strongest side wins (${h.players[t2.owner]?.name ?? 'nobody'})`);
    }
  }

  console.log('--- bombing');
  {
    const g = fresh();
    const target = g.planets.find(pl => pl.owner === 1 && !pl.homeworld) ?? home(g, 1);
    target.starbase = null; target.pop = 30000; target.defenses = 0; target.mines = 20; target.factories = 20;
    DIP.declareWar(g, 0, 1);
    g.players[0].relations[1] = 'enemy';
    const bd = design(g, 0, 'B-17 Bomber', 'bomber', 'Grêle', 12);
    const a = newFleet(g, g.players[0], bd.id, 2, home(g, 0)), b = newFleet(g, g.players[0], bd.id, 2, home(g, 0));
    for (const f of [a, b]) { f.x = target.x; f.y = target.y; f.orbiting = target.id; }
    const h = JSON.parse(JSON.stringify(g)) as G;
    const ha = h.fleets.find(f => f.id === a.id)!, hb = h.fleets.find(f => f.id === b.id)!;
    ha.tokens[0].qty = 4; h.fleets.splice(h.fleets.indexOf(hb), 1);
    const bombing = (await import('../src/engine/turn') as any).bombingForTests;
    if (bombing) {
      bombing(g, new Rng(1)); bombing(h, new Rng(1));
      const tg = g.planets[target.id], th = h.planets[target.id];
      check(tg.pop === th.pop && tg.mines + tg.factories === th.mines + th.factories, `two fleets of 2 bombers do what one fleet of 4 does (${30000 - tg.pop} colonists, ${40 - tg.mines - tg.factories} installations)`);
    }
    // smart bombs never kill the last 100
    const s = fresh();
    const t3 = s.planets.find(pl => pl.owner === 1 && !pl.homeworld) ?? home(s, 1);
    t3.starbase = null; t3.pop = 300; t3.defenses = 0;
    DIP.declareWar(s, 0, 1); s.players[0].relations[1] = 'enemy';
    const sd = design(s, 0, 'B-17 Bomber', 'smartBomber', 'Scalpel', 26);
    const sf = newFleet(s, s.players[0], sd.id, 8, home(s, 0));
    sf.x = t3.x; sf.y = t3.y; sf.orbiting = t3.id;
    const fn = (await import('../src/engine/turn') as any).bombingForTests;
    if (fn && specOf(s, sd.id).bombs.some(x => x.smart)) { fn(s, new Rng(2)); check(t3.owner === 1 && t3.pop >= 100, `smart bombs alone leave the last colonists (${t3.pop})`); }
    // emptied by bombs, taken by troops the same year
    const e = fresh();
    const t4 = e.planets.find(pl => pl.owner === 1 && !pl.homeworld) ?? home(e, 1);
    t4.starbase = null; t4.pop = 100; t4.defenses = 0; t4.mines = 300; t4.factories = 400;
    DIP.declareWar(e, 0, 1); e.players[0].relations[1] = 'enemy';
    const bd2 = design(e, 0, 'B-17 Bomber', 'bomber', 'Marteau', 12);
    for (const sl of bd2.slots) if (/Bomb/.test(sl.part)) sl.part = 'M-80 Bomb'; // bombs that kill (not the LBU)
    const bf = newFleet(e, e.players[0], bd2.id, 1, home(e, 0));
    bf.x = t4.x; bf.y = t4.y; bf.orbiting = t4.id;
    const fn2 = (await import('../src/engine/turn') as any).bombingForTests;
    if (fn2) {
      fn2(e, new Rng(3));
      const tr = newFleet(e, e.players[0], design(e, 0, 'Medium Freighter', 'freighter', 'Débarquement').id, 1, home(e, 0));
      tr.x = t4.x; tr.y = t4.y; tr.orbiting = t4.id; tr.cargo.colonists = 50;
      const dropped = TK.transferWithPlanet(e, tr, t4, 'colonists', -50);
      TK.resolveLandings(e);
      check(dropped === -50 && t4.owner === 0 && t4.pop === 5000 && t4.factories > 0, `a world emptied by bombs is taken by troops landed the same year, with what is left of its factories (${t4.factories})`);
    }
  }

  console.log(`\n${good} ok, ${bad} failed`);
  if (bad) process.exit(1);
}
main();
