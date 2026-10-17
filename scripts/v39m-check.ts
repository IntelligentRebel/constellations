// Constellations 0.3.9.17 checks: tech trading, the Mystery Trader, ancient artifacts, stargates, climate changes
// (run: npx tsx scripts/v39m-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { quickGame, newFleet, addDesign } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES } = await import('../src/engine/race');
  const { generateTurn, climateChangeForTests, repairForTests } = await import('../src/engine/turn');
  const TT = await import('../src/engine/techtrade');
  const TR = await import('../src/engine/trader');
  const TK = await import('../src/engine/tasks');
  const MV = await import('../src/engine/movement');
  const { autoDesign, specOf } = await import('../src/engine/design');
  const { Rng, seedFromString } = await import('../src/engine/rng');
  const { FIELDS } = await import('../src/engine/types');
  type G = ReturnType<typeof quickGame>;

  const base = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 2, 'standard', 'v39m', { randomEvents: true } as any);
  base.settings.cataclysms = false;
  while (base.year < 2415) generateTurn(base);
  const raw = JSON.stringify(base);
  const fresh = (): G => JSON.parse(raw);
  const home = (g: G, id: number) => g.planets.find(p => p.owner === id && p.homeworld) ?? g.planets.find(p => p.owner === id)!;
  const design = (g: G, owner: number, hull: string, purpose: any, name: string, tech = 10) => {
    const p = g.players[owner];
    const save = { ...p.tech };
    for (const k of Object.keys(p.tech) as (keyof typeof p.tech)[]) p.tech[k] = Math.max(p.tech[k], tech);
    const d = autoDesign(p, hull, purpose, name)!;
    p.tech = save;
    return addDesign(g, { ...d, owner } as any);
  };

  console.log('--- tech trading (Stars!: 0.5 x (1 - 0.5^n), one a year)');
  {
    const rate = (ahead: number) => {
      let won = 0;
      for (let i = 0; i < 2000; i++) {
        const g = fresh();
        const p = g.players[0];
        const src = { ...p.tech };
        FIELDS.slice(0, ahead).forEach(f => { src[f] = p.tech[f] + 3; });
        if (TT.tradeTech(g, p, src, new Rng(seedFromString('tt' + ahead + ':' + i)), 'Test')) won++;
      }
      return won / 2000;
    };
    const r1 = rate(1), r6 = rate(6);
    check(Math.abs(r1 - 0.25) < 0.04, `one field ahead: about 25 % (${(r1 * 100).toFixed(1)} %)`);
    check(Math.abs(r6 - 0.49) < 0.04, `six fields ahead: never more than 50 % (${(r6 * 100).toFixed(1)} %; up to 82 % before)`);
    const g = fresh(), p = g.players[0];
    const src = { ...p.tech }; for (const f of FIELDS) src[f] = p.tech[f] + 5;
    let gains = 0;
    for (let i = 0; i < 40; i++) if (TT.tradeTech(g, p, src, new Rng(seedFromString('cap' + i)), 'Test')) gains++;
    check(gains === 1, `one trade a year at most (${gains} in 40 tries the same year)`);
    // the next field set is honoured after a level gained that way
    const h = fresh(), q = h.players[0];
    q.researching = 'weapons'; q.nextField = 'lowest';
    TT.gainLevel(h, q, 'weapons');
    check(q.researching !== 'weapons' || FIELDS.every(f => q.tech[f] >= q.tech.weapons), `a level gained in the field researched moves research on to the next field set (now ${q.researching})`);
    // designs: the technology they carry
    const d = design(h, 1, 'Destroyer', 'beamWarship', 'Avancé', 14);
    const lv = TT.designLevels(h, d.id);
    check(FIELDS.some(f => lv[f] >= 5), `a design carries the levels of its parts (${FIELDS.map(f => lv[f]).join('/')})`);
  }

  console.log('--- the Mystery Trader');
  {
    const low = { tech: { energy: 5, weapons: 5, propulsion: 5, construction: 5, electronics: 5, biotechnology: 5 } };
    const high = { tech: { energy: 20, weapons: 20, propulsion: 20, construction: 20, electronics: 20, biotechnology: 20 } };
    check(TR.boonLevels(low, 5000) === 6 && TR.boonLevels(low, 9800) === 10, `an empire of 30 levels gets 6 levels for 5,000 kt, 10 for 9,800 (2 to 5 before)`);
    check(TR.boonLevels(high, 5000) === 1 && TR.boonLevels(high, 9800) === 1, 'an empire of 120 levels: a single one (the table of the original, after craig-stars)');
    const g = fresh();
    const fd = design(g, 0, 'Super Freighter', 'freighter', 'Offrande', 14);
    const f = newFleet(g, g.players[0], fd.id, 3, home(g, 0));
    f.x = 200; f.y = 200; f.orbiting = -1;
    f.cargo.ironium = 6000;
    g.traders = [{ id: 777, x: 200, y: 200, destX: 900, destY: 200, warp: 8, reward: 'research', heading: { x: 1, y: 0 }, rewarded: [] } as any];
    const before = FIELDS.reduce((a, x) => a + g.players[0].tech[x], 0);
    const want = TR.boonLevels(g.players[0], 6000);
    TR.meetTraders(g, new Rng(seedFromString('mt')));
    const after = FIELDS.reduce((a, x) => a + g.players[0].tech[x], 0);
    check(!g.fleets.includes(f), 'the trader takes the whole fleet in payment');
    check(after - before === want && want >= 6, `and gives ${after - before} levels for 6,000 kt to an empire of ${before} levels`);
    // he changes course or speed now and then
    const h = fresh();
    h.traders = [{ id: 778, x: 100, y: 100, destX: 1e7, destY: 100, warp: 8, reward: 'research', heading: { x: 1, y: 0 }, rewarded: [] } as any];
    let faster = false;
    for (let i = 0; i < 200 && h.traders.length; i++) { TR.moveTraders(h, new Rng(seedFromString('w' + i))); if ((h.traders[0]?.warp ?? 8) > 8) faster = true; }
    check(faster, 'the trader speeds up now and then');
  }

  console.log('--- ancient artifacts');
  {
    const g = fresh();
    const free = g.planets.filter(p => p.owner < 0);
    const withArt = free.filter(p => p.artifact).length + g.planets.filter(p => p.owner >= 0 && p.artifact).length;
    const share = withArt / g.planets.length;
    check(share > 0.2 && share < 0.45, `about a third of the worlds hide an artifact (${withArt} of ${g.planets.length})`);
    const t = free.find(p => p.artifact)!;
    t.owner = 0; t.pop = 5000;
    const msgs = g.players[0].messages.length;
    TK.discoverArtifact(g, g.players[0], t);
    const m = g.players[0].messages.slice(msgs).find(x => x.text.includes('artefact'));
    const pts = m ? +(m.text.match(/(\d+) points/)?.[1] ?? 0) : 0;
    check(!!m && pts >= 100 && pts <= 400 && !t.artifact, `the first to settle there finds it: ${pts} research points`);
  }

  console.log('--- stargates');
  {
    const g = fresh();
    const p = g.players[0];
    const a = home(g, 0);
    const b = g.planets.filter(x => x.owner < 0).sort((x, y) => Math.hypot(y.x - a.x, y.y - a.y) - Math.hypot(x.x - a.x, x.y - a.y))[0];
    b.owner = 0; b.pop = 10000;
    const save = { ...p.tech }; p.tech.propulsion = 5; p.tech.construction = 5;
    const sd = addDesign(g, { ...autoDesign(p, 'Space Station', 'starbase', 'Porte')!, owner: 0 } as any);
    p.tech = save;
    const slot = sd.slots.find(s => s.slot === 1) ?? (() => { const s = { slot: 1, part: 'Stargate 100-250', qty: 1 }; sd.slots.push(s); return s; })();
    slot.part = 'Stargate 100-250'; slot.qty = 1;
    a.starbase = { designId: sd.id, damage: 0 }; b.starbase = { designId: sd.id, damage: 0 };
    const wd = design(g, 0, 'Destroyer', 'beamWarship', 'Sauteur', 6);
    const f = newFleet(g, p, wd.id, 4, a);
    f.x = a.x; f.y = a.y; f.orbiting = a.id;
    f.tokens[0].damage = Math.floor(specOf(g, wd.id).armor * 0.9); f.tokens[0].qtyDamaged = 2;
    const wp = { x: b.x, y: b.y, target: 'planet' as const, targetId: b.id, warp: 11, task: 'none' as const };
    f.waypoints = [{ x: a.x, y: a.y, target: 'planet', targetId: a.id, warp: 0, task: 'none' }, wp];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const gc = MV.gateCheck(g, f, 1);
    check(dist <= 250 || (gc.doomed === 2 && gc.damaged), `the jump order warns that the 2 damaged ships would not survive (${gc.doomed})`);
    MV.gateFleetForTests(g, new Rng(seedFromString('gate')), f, wp);
    const q = g.fleets.includes(f) ? f.tokens[0].qty : 0;
    check(dist <= 250 || q <= 2, `overgating (${Math.round(dist)} al for a 250 al gate): the two ships already badly damaged are lost (${q} of 4 left)`);
    check(!g.fleets.includes(f) || f.gatedYear === g.year, 'the fleet is marked as having gone through a gate this year');
    // colonists at a friend's gate: the jump is refused, and the order says so
    {
      const h = fresh(), hp = h.players[0];
      const fr = h.planets.find(x => x.owner === 1)!; hp.relations[1] = 'friend';
      const hd = addDesign(h, { ...sd, id: undefined, owner: 1 } as any);
      fr.starbase = { designId: hd.id, damage: 0 }; const hb = h.planets.find(x => x.id === b.id)!; hb.starbase = { designId: hd.id, damage: 0 }; hb.owner = 1;
      h.players[1].relations[0] = 'friend';
      const cd = design(h, 0, 'Medium Freighter', 'freighter', 'Colons', 6);
      const cf = newFleet(h, hp, cd.id, 1, fr); cf.x = fr.x; cf.y = fr.y; cf.orbiting = fr.id; cf.cargo.colonists = 10;
      const cwp = { x: hb.x, y: hb.y, target: 'planet' as const, targetId: hb.id, warp: 11, task: 'none' as const };
      cf.waypoints = [{ x: fr.x, y: fr.y, target: 'planet', targetId: fr.id, warp: 0, task: 'none' }, cwp];
      const cc = MV.gateCheck(h, cf, 1);
      check(!!cc.problem && cc.problem.includes('colons'), `colonists aboard at a friend's gate: « ${cc.problem} »`);
    }
    if (g.fleets.includes(f) && f.tokens[0].damage > 0) {
      const d0 = f.tokens[0].damage;
      repairForTests(g);
      check(f.tokens[0].damage === d0, 'and is not repaired that year');
    }
  }

  console.log('--- climate changes');
  {
    const g = fresh();
    let changed = 0;
    g.year = 2430; // (settled colonies are spared the first 20 years)
    for (let i = 0; i < 400; i++) {
      const before = JSON.stringify(g.planets.map(p => p.baseHab));
      climateChangeForTests(g, new Rng(seedFromString('cl' + i)));
      if (JSON.stringify(g.planets.map(p => p.baseHab)) !== before) changed++;
    }
    check(changed > 8 && changed < 35, `about one year in twenty a world's climate changes for good (${changed} in 400 years)`);
    // on an owned world, the owner is told
    const h = fresh(); h.year = 2430;
    const all = h.planets; h.planets = all.filter(p => p.owner === 0);
    for (let i = 0; i < 400 && !h.players[0].messages.some(m => m.text.startsWith('Changement de climat')); i++) climateChangeForTests(h, new Rng(seedFromString('own' + i)));
    h.planets = all;
    const msg = h.players[0].messages.find(m => m.text.startsWith('Changement de climat'));
    check(!!msg, `the owner is told: « ${msg?.text.slice(0, 110)}… »`);
  }

  console.log(`\n${good} ok, ${bad} failed`);
  if (bad) process.exit(1);
}
main();
