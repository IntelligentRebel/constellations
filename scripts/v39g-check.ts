// Constellations 0.3.9.10 checks: closed borders (run: npx tsx scripts/v39g-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { createGame, defaultSettings, newFleet } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES } = await import('../src/engine/race');
  const { generateTurn } = await import('../src/engine/turn');
  const B = await import('../src/engine/borders');
  const DIP = await import('../src/engine/diplomacy');
  const { estimateRoute, distance, fleetSpec } = await import('../src/engine/fleet');
  const { safeGoto } = await import('../src/engine/ai');
  type G = ReturnType<typeof createGame>;

  // a small spiral arm, two empires played by hand (0, 1) and a computer (2), thirty years in
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
  // everyone knows everyone's worlds (the borders one may not cross are the ones one sees)
  const { revealPlanet } = await import('../src/engine/scan');
  for (const p of base.players) for (const pl of base.planets) if (pl.owner >= 0 && pl.owner !== p.id) revealPlanet(base, p, pl);
  DIP.syncRelations(base);
  const raw = JSON.stringify(base);
  const fresh = (): G => JSON.parse(raw);
  const own = (g: G, id: number) => g.planets.filter(p => p.owner === id);
  check(B.bordersOn(base) && own(base, 0).length > 0 && own(base, 1).length > 0, `culture and diplomacy on, both empires settled (${own(base, 0).length} and ${own(base, 1).length} worlds)`);

  console.log('--- closing');
  {
    const g = fresh();
    g.players[0].messages = [];
    B.setBorders(g, 1, 0, true);
    check(B.closedTo(g, 1, 0) && B.closersOf(g, 0).join() === '1' && !B.closedTo(g, 0, 1), 'the borders of 1 are closed to 0, not the other way');
    check(g.players[0].messages.some(m => m.text.includes('ferment leurs frontières à vos vaisseaux')), '0 is told');
    const t0 = Date.now();
    const m = B.closedMask(g, 0)!;
    const ms = Date.now() - t0;
    const cells = m.hard.reduce((a, x) => a + x, 0);
    check(cells > 50 && ms < 400, `their territory is closed on the routing grid (${cells} cells, ${ms} ms)`);
    const hw1 = own(g, 1).find(p => p.homeworld)!;
    check(B.closedFor(g, 0, hw1) === 1 && B.closedFor(g, 0, own(g, 0)[0]) === -1, 'their capital is in it, our worlds are not');
    DIP.sign(g, 0, 1, 'alliance');
    check(!B.closedTo(g, 1, 0) && !B.hasClosed(g, 1, 0), 'an alliance opens the borders');
    check(!!B.closeBlocker(g, 1, 0), `allies cannot close them (${B.closeBlocker(g, 1, 0)})`);
    B.setBorders(g, 1, 0, true);
    check(!B.hasClosed(g, 1, 0), 'closing them to an ally does nothing');
  }

  // a fleet of 0 with engines
  const mover = (g: G) => {
    const hw0 = own(g, 0).find(p => p.homeworld)!;
    const d = g.designs.filter(x => x.owner === 0 && !x.starbase && !x.deleted).find(x => /Scout|Éclaireur|scout/i.test(x.name) || x.hull === 'Scout') ?? g.designs.find(x => x.owner === 0 && !x.starbase)!;
    const f = newFleet(g, g.players[0], d.id, 1, hw0);
    f.fuel = fleetSpec(g, f).fuelCapacity;
    return f;
  };
  // a year, with a full tank (the routes here are long: no running dry at Warp 1)
  const year = (g: G, f: { fuel: number }) => { const ff = f as any; if (g.fleets.includes(ff)) ff.fuel = fleetSpec(g, ff).fuelCapacity; generateTurn(g); };
  const W = (g: G, f: any) => Math.min(fleetSpec(g, f).idealSpeed || 6, 9);

  console.log('--- going in');
  {
    const g = fresh();
    B.setBorders(g, 1, 0, true);
    const f = mover(g);
    const hw1 = own(g, 1).find(p => p.homeworld)!;
    f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, target: 'space', task: 'none', warp: 0 }, { x: hw1.x, y: hw1.y, target: 'planet', targetId: hw1.id, warp: W(g, f), task: 'none' }];
    const en = B.routeEntries(g, 0, f.waypoints);
    check(en.length === 1 && en[0].closer === 1, 'the route warns: their capital lies inside');
    let y = 0;
    while (y++ < 25 && DIP.statusOf(g, 0, 1) !== "war" && g.fleets.includes(f)) { year(g, f); if (process.env.DBG) console.log(g.year, f.x, f.y, f.waypoints.length, B.closedFor(g, 0, f), B.automaticFleet(g, f), f.waypoints.map(w => w.x + "," + w.y + (w.detour ? "d" : "")).join(" ")); }
    check(DIP.statusOf(g, 0, 1) === 'war', `going in by the player's own order is war (${g.year})`);
    check(g.players[0].messages.some(m => m.text.includes('dont les frontières vous étaient fermées')), 'the player is told why');
    check(g.players[1].messages.some(m => m.text.includes('vous déclarent la guerre') && m.text.includes('frontières fermées')), 'and so are they');
  }
  {
    const g = fresh();
    B.setBorders(g, 1, 0, true);
    const f = mover(g);
    f.auto = 'explore';
    const hw1 = own(g, 1).find(p => p.homeworld)!;
    const st = B.trespass(g, f, f, hw1);
    check(!!st && st.closer === 1 && B.closedFor(g, 0, st) === -1 && DIP.statusOf(g, 0, 1) === 'peace', `an automatic order stops at the border (${st?.x}, ${st?.y}): no war`);
    const { moveFleets } = await import('../src/engine/movement');
    const { Rng, seedFromString } = await import('../src/engine/rng');
    f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, target: 'space', task: 'none', warp: 0 }, { x: hw1.x, y: hw1.y, target: 'planet', targetId: hw1.id, warp: W(g, f), task: 'none' }];
    let stopped = false;
    for (let y = 0; y < 25 && !stopped; y++) { f.fuel = fleetSpec(g, f).fuelCapacity; g.players[0].messages = []; moveFleets(g, new Rng(seedFromString('mv' + y))); stopped = g.players[0].messages.some(m => m.text.includes('s\'arrête à la frontière')); }
    check(stopped && DIP.statusOf(g, 0, 1) === 'peace' && f.waypoints.length === 1 && B.closedFor(g, 0, f) === -1, `moving, it stops outside and its orders are dropped (${f.x}, ${f.y})`);
    check(safeGoto(g, f, { x: hw1.x, y: hw1.y, planetId: hw1.id }) === false, 'the automatic orders never send it in');
  }

  console.log('--- leaving');
  {
    const g = fresh();
    B.setBorders(g, 1, 0, true);
    const m = B.closedMask(g, 0)!;
    const hw1 = own(g, 1).find(p => p.homeworld)!;
    const hw0 = own(g, 0).find(p => p.homeworld)!;
    // a point of their territory on the side of ours, a fleet there, sent home
    let inside: { x: number; y: number } | null = null;
    for (let t = 0.05; t < 1 && !inside; t += 0.02) { const p = { x: Math.round(hw1.x + (hw0.x - hw1.x) * t), y: Math.round(hw1.y + (hw0.y - hw1.y) * t) }; if (B.closedAt(m, p.x, p.y) === 1 && distance(p, hw1) > 10) inside = p; }
    const f = mover(g);
    f.x = inside!.x; f.y = inside!.y; f.orbiting = -1;
    f.waypoints = [{ x: f.x, y: f.y, target: 'space', task: 'none', warp: 0 }, { x: hw0.x, y: hw0.y, target: 'planet', targetId: hw0.id, warp: W(g, f), task: 'none' }];
    for (let y = 0; y < 40 && f.orbiting !== hw0.id; y++) { year(g, f); if (process.env.DBG) console.log('leave', g.year, f.x, f.y, f.orbiting, hw0.id, f.waypoints.map(w => w.x + ',' + w.y).join(' '), DIP.statusOf(g, 0, 1)); }
    check(DIP.statusOf(g, 0, 1) === 'peace' && f.orbiting === hw0.id, 'a fleet already inside may leave: no war');
  }

  console.log('--- going around');
  {
    const g = fresh();
    B.setBorders(g, 1, 0, true);
    const m = B.closedMask(g, 0)!;
    const hw1 = own(g, 1).find(p => p.homeworld)!;
    const f = mover(g);
    // a point beyond their territory, the straight way through it, a way around it
    let target: { x: number; y: number } | null = null;
    const dx = hw1.x - f.x, dy = hw1.y - f.y, L = Math.hypot(dx, dy) || 1;
    for (let k = 1.2; k < 4 && !target; k += 0.1) for (const a of [0, 0.15, -0.15, 0.3, -0.3]) {
      const c = Math.cos(a), sn = Math.sin(a);
      const q = { x: Math.round(f.x + (dx * c - dy * sn) * k), y: Math.round(f.y + (dx * sn + dy * c) * k) };
      if (q.x < 5 || q.y < 5 || q.x > g.width - 5 || q.y > g.height - 5) continue;
      let near = false;
      for (let a2 = 0; a2 < 12 && !near; a2++) for (const r of [0, 20, 40, 60]) if (B.closedAt(m, q.x + Math.cos(a2 / 12 * 6.283) * r, q.y + Math.sin(a2 / 12 * 6.283) * r) >= 0) near = true;
      if (near) continue;
      if (!B.entryOnLeg(g, 0, f, q, m)) continue;
      const wps = [{ ...f.waypoints[0], x: f.x, y: f.y, target: 'space' as const, task: 'none' as const, warp: 0 }, { x: q.x, y: q.y, target: 'space' as const, warp: W(g, f), task: 'none' as const }];
      if (B.routeEntries(g, 0, wps).length === 0) { target = q; break; }
    }
    check(!!target, `a point behind their territory, reachable around it (${target?.x}, ${target?.y}; straight line ${target ? Math.round(distance(f, target)) : '?'} al)`);
    if (target) {
      f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, target: 'space', task: 'none', warp: 0 }, { x: target.x, y: target.y, target: 'space', warp: W(g, f), task: 'none' }];
      const est = estimateRoute(g, f)[0];
      check(est.dist > distance(f, target) + 1, `the estimate goes around (${Math.round(est.dist)} al instead of ${Math.round(distance(f, target))})`);
      let y = 0;
      while (y++ < 30 && (f.x !== target.x || f.y !== target.y)) { year(g, f); if (process.env.DBG) console.log('around', g.year, f.x, f.y, f.waypoints.map(w => w.x + ',' + w.y + (w.detour ? 'd' : '')).join(' '), DIP.statusOf(g, 0, 1)); }
      check(f.x === target.x && f.y === target.y && DIP.statusOf(g, 0, 1) === 'peace', `the fleet gets there around their territory, without war (${y} years)`);
    }
  }

  console.log('--- policy and the computers');
  {
    const g = fresh();
    g.players[0].borderPolicy = 'closed';
    g.players[0].bordersSet = [];
    B.runBorders(g);
    check(B.hasClosed(g, 0, 1) && B.hasClosed(g, 0, 2), 'a closed policy closes the borders to the empires met');
    B.setBorders(g, 0, 1, false);
    B.runBorders(g);
    check(!B.hasClosed(g, 0, 1), 'then each empire is decided on its own');
  }
  {
    const g = fresh();
    DIP.remember(g, 2, 0, 'betrayal', -60, 0);
    B.runBorders(g);
    check(B.hasClosed(g, 2, 0), `a computer closes its borders to an empire it dislikes (opinion ${DIP.opinion(g, 2, 0).total}, threshold ${B.closeAt(g.players[2])})`);
    g.diplomacy!.memory = g.diplomacy!.memory.filter(x => x.kind !== 'betrayal');
    DIP.remember(g, 2, 0, 'gift', 30, 0);
    B.runBorders(g);
    check(!B.hasClosed(g, 2, 0), `and opens them again when it thinks better of it (opinion ${DIP.opinion(g, 2, 0).total})`);
  }
  {
    const g = fresh();
    B.setBorders(g, 0, 2, true);
    B.runBorders(g);
    const h = B.hindrance(g, 2, 0);
    check(h >= 0 && h <= 1, `the computer measures how our borders hinder it (${h})`);
    // as if they hemmed it in completely
    g.players[2].hindered = { 0: 0.8 };
    const op = DIP.opinion(g, 2, 0);
    const line = op.lines.find(l => l.label.includes('frontières'));
    check(!!line && line.value <= -40, `its opinion says it (${line?.label} ${line?.value})`);
    const w0 = DIP.warDesire(g, 2, 0);
    g.players[2].hindered = { 0: 0 };
    const w1 = DIP.warDesire(g, 2, 0);
    check(w0 - w1 >= 30, `and it is readier for war (${w1} → ${w0})`);
    // it asks for the borders to open, some year
    g.players[2].hindered = { 0: 0.5 };
    let asked = false;
    for (let y = 0; y < 12 && !asked; y++) { DIP.runDiplomacy(g); asked = g.diplomacy!.proposals.some(p => p.from === 2 && p.to === 0 && p.kind === 'borders'); g.year++; }
    check(asked, 'a hindered computer asks the player to open the borders');
    const p = g.diplomacy!.proposals.find(x => x.kind === 'borders')!;
    DIP.answer(g, p.id, true);
    check(!B.hasClosed(g, 0, 2), 'accepting opens them');
  }
  {
    const g = fresh();
    B.setBorders(g, 2, 0, true);
    check(!!DIP.proposalBlocker(g, 0, 1, 'borders') && !DIP.proposalBlocker(g, 0, 2, 'borders'), 'one asks only an empire whose borders are closed to you');
    DIP.remember(g, 2, 0, 'gift', 30, 0);
    const ans = DIP.evaluate(g, 2, 0, 'borders');
    check(ans.chance !== undefined && ans.chance > 0.5, `a computer that likes you probably opens them (${ans.why})`);
    let opened = false;
    for (let y = 0; y < 6 && !opened; y++) { DIP.propose(g, 0, 2, 'borders'); opened = !B.hasClosed(g, 2, 0); g.year++; }
    check(opened, 'and does, some year');
    const f2 = g.fleets.find(f => f.owner === 2 && f.tokens.length && !f.immobile && f.beaconOf === undefined)!;
    B.setBorders(g, 1, 2, true);
    const hw1 = own(g, 1).find(p => p.homeworld)!;
    check(safeGoto(g, f2, { x: hw1.x, y: hw1.y, planetId: hw1.id }) === false, 'a computer never orders a fleet into a territory closed to it');
  }

  console.log('--- reports');
  {
    const g = fresh();
    g.diplomacy!.proposals.push({ id: 987654, from: 2, to: 0, kind: 'trade', year: g.year - 5, expires: g.year - 1 });
    generateTurn(g);
    check(g.players[0].messages.some(m => m.text.includes('la proposition a expiré') && m.year === g.year), 'what diplomacy tells at the start of the year now reaches the reports');
  }

  console.log(bad ? `${bad} FAILED, ${good} ok` : `all good (${good})`);
  if (bad) process.exit(1);
}
void main();
