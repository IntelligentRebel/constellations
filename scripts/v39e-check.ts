// Constellations 0.3.9 (lot E) checks: sector governors, operations (run: npx tsx scripts/v39e-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const g0: any = globalThis;
  g0.window = g0; g0.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  g0.document = undefined;
  const { quickGame, newFleet } = await import('../src/engine/newgame');
  const { generateTurn } = await import('../src/engine/turn');
  const G = await import('../src/engine/governors');
  const O = await import('../src/engine/operations');
  const { planetSpec } = await import('../src/engine/planet');
  const { unitCost } = await import('../src/engine/production');
  const { canBuildShip } = await import('../src/engine/production');

  console.log('--- sector governors');
  {
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39e-gov', { shape: 'arm' });
    const me = g.players[g.human];
    check(!!g.settings.governors, 'the rule is on by default');
    check((me.govPool?.length ?? 0) === G.POOL_SIZE, `three candidates from the start (${me.govPool?.map(x => `${x.name}, ${G.GOV_TRAITS[x.trait].name}`).join(' · ')})`);
    const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
    check(hw.sector === hw.id, 'the capital heads the first sector');
    // a steward: more resources in the sector
    const cand = me.govPool![0];
    cand.trait = 'steward'; cand.xp = 60;
    const before = planetSpec(g, hw, me).resources;
    check(G.appoint(g, me, cand.id, hw.id) === null, 'a candidate is named at the head of the capital\'s sector');
    check(me.govPool!.length === G.POOL_SIZE - 1 && me.governors!.length === 1, 'the candidate leaves the pool');
    check(G.levelOf(cand) === 5, 'sixty years of service: level 5');
    const after = planetSpec(g, hw, me).resources;
    check(after > before && Math.abs(after / before - 1.1) < 0.02, `an intendant of level 5: +10 % of resources (${before} → ${after})`);
    // a builder: cheaper factories
    cand.trait = 'builder';
    const fc = unitCost(g, hw, me, { kind: 'factory' });
    cand.trait = 'steward';
    const fc0 = unitCost(g, hw, me, { kind: 'factory' });
    check(fc.resources < fc0.resources, `a builder: cheaper factories (${fc0.resources} → ${fc.resources} R)`);
    // the capital stays in the player's hands; a colony is run by the order
    const col = g.planets.filter(p => p.owner < 0 && !p.hidden).sort((a, b) => Math.hypot(a.x - hw.x, a.y - hw.y) - Math.hypot(b.x - hw.x, b.y - hw.y))[0];
    col.owner = me.id; col.pop = 20000; col.queue = [{ kind: 'ship', designId: g.designs.find(d => d.owner === me.id && !d.starbase)!.id, qty: 1, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }, { kind: 'autoMines', qty: 3, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }];
    cand.policy = 'industry';
    const hwQueue = JSON.stringify(hw.queue);
    G.runGovernors(g);
    check(col.sector === hw.id, 'a new colony joins the closest sector');
    check(JSON.stringify(hw.queue) === hwQueue, 'the governor does not touch the capital\'s queue');
    check(col.queue[0].kind === 'ship' && col.queue.some(q => q.kind === 'autoFactories' && q.qty === 500) && !col.queue.some(q => q.kind === 'autoDefenses'), `industry: the manual line first, then the order's lines (${col.queue.map(q => q.kind).join(', ')})`);
    // a world set apart
    col.manual = true; col.queue = [];
    G.runGovernors(g);
    check(col.queue.length === 0, 'a world set apart is left alone');
    col.manual = false;
    // a threat raises the defenses
    cand.policy = 'develop';
    const enemy = g.players.find(p => !p.monster && p.id !== me.id)!;
    me.relations[enemy.id] = 'enemy';
    me.intel.fleets.push({ id: 987654, owner: enemy.id, x: col.x + 20, y: col.y, detail: 'contact' } as any);
    G.runGovernors(g);
    check(col.queue[0].kind === 'autoDefenses' && col.queue[0].qty === 100, 'a hostile fleet 20 ly away: the defenses first');
    check(me.messages.some(m => m.text.includes('renforce les défenses')), 'and the governor says so');
    me.intel.fleets.pop();
    G.runGovernors(g);
    check(col.queue[0].kind !== 'autoDefenses', 'the threat gone, back to the order');
    // seats without the cost of distance
    g.settings.distanceCost = false;
    for (let i = 0; i < 8; i++) { const p = g.planets.find(x => x.owner < 0 && !x.hidden)!; p.owner = me.id; p.pop = 10000; }
    const seat = g.planets.filter(p => p.owner === me.id && p !== hw).sort((a, b) => Math.hypot(b.x - hw.x, b.y - hw.y) - Math.hypot(a.x - hw.x, a.y - hw.y))[0];
    check(G.seatBlocker(g, me, seat) === null, 'ten worlds: one seat can be designated');
    seat.sectorSeat = true;
    check(G.seatBlocker(g, me, g.planets.find(p => p.owner === me.id && !p.sectorSeat && p !== hw)!) !== null, 'but not two');
    G.computeSectors(g, me);
    check(seat.sector === seat.id && G.sectorSeats(g, me).length === 2, 'the designated seat heads its own sector');
    // the seat lost: the governor waits for another sector
    const g2 = me.govPool![0];
    G.appoint(g, me, g2.id, seat.id);
    seat.owner = enemy.id;
    G.runGovernors(g);
    check(g2.seat === undefined && me.governors!.includes(g2), 'a governor whose seat is lost waits for another sector');
    // years go by
    const xp = cand.xp;
    for (let i = 0; i < 3; i++) generateTurn(g);
    check(cand.xp === xp + 3, 'a year of service a year');
    check(g.players.filter(p => p.ai && !p.monster && !p.dead).every(p => (p.governors ?? []).some(x => x.seat !== undefined)), 'the computers name governors too');
    // the pool is renewed
    const ids = me.govPool!.map(x => x.id).join();
    g.year += 10; G.runGovernors(g);
    check(me.govPool!.length === G.POOL_SIZE && me.govPool!.map(x => x.id).join() !== ids, 'ten years later, new candidates');
  }

  console.log('--- operations');
  {
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39e-op', { shape: 'arm' });
    const me = g.players[g.human];
    const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
    me.tech.construction = Math.max(me.tech.construction, 6); me.tech.weapons = Math.max(me.tech.weapons, 6);
    const designs = O.opDesigns(g, me);
    check(designs.length > 0, `armed designs the yards can build (${designs.map(d => d.name).join(', ')})`);
    const d = designs[0];
    check(canBuildShip(g, hw, d) === null, 'the capital can build it');
    const f = newFleet(g, me, d.id, 1, hw);
    // a defense of a colony
    const col = g.planets.filter(p => p.owner < 0 && !p.hidden).sort((a, b) => Math.hypot(a.x - hw.x, a.y - hw.y) - Math.hypot(b.x - hw.x, b.y - hw.y))[0];
    col.owner = me.id; col.pop = 20000;
    check(O.setOperation(g, f, { kind: 'defend', planetId: col.id, designId: d.id, target: 4 }) === null, 'an operation: defend a colony with four ships');
    check(f.waypoints.length === 2 && f.waypoints[1].targetId === col.id, 'the fleet leaves for the colony');
    check(O.setOperation(g, f, { kind: 'defend', planetId: g.planets.find(p => p.owner !== me.id && !p.hidden)!.id, designId: d.id, target: 4 }) !== null, 'one cannot defend a world that is not one\'s own');
    O.setOperation(g, f, { kind: 'defend', planetId: col.id, designId: d.id, target: 4 });
    O.runOperations(g);
    const st = O.opStatus(g, f);
    check(st.queued === 3 && hw.queue[0].forOp === f.id, `the yards are given the three missing ships (${st.queued}, at ${st.yards.map(p => p.name).join(', ')})`);
    O.runOperations(g);
    check(O.opStatus(g, f).queued === 3, 'and not twice');
    hw.surface = { ironium: 50000, boranium: 50000, germanium: 50000 };
    let merged = false; const seen: string[] = [];
    for (let i = 0; i < 25 && !merged; i++) { generateTurn(g); seen.push(...me.messages.map(m => m.text)); hw.surface = { ironium: 50000, boranium: 50000, germanium: 50000 }; merged = O.shipsIn(f) >= 4; }
    const s2 = O.opStatus(g, f);
    check(merged, `the reinforcements are built, fly to the fleet and join it (${s2.ships} ships, ${s2.enRoute} on the way, ${s2.queued} queued, year ${g.year})`);
    check(f.x === col.x && f.y === col.y, 'the fleet holds the colony');
    check(seen.some(t => t.includes('en renfort de')) && seen.some(t => t.includes('renfort') && t.includes('rejoin')), 'the yards say what they built it for, the fleet when they join');
    // an existing fleet sent to reinforce
    const extra = newFleet(g, me, d.id, 2, hw);
    check(O.joinOperation(g, extra, f) === null && extra.waypoints[1]?.targetId === f.id, 'an existing fleet goes to reinforce the operation');
    // the end
    O.endOperation(g, f);
    check(!f.op && extra.joinOp === undefined, 'ending the operation frees the reinforcements');
    // an attack that waits for the fleet to be complete
    const enemy = g.players.find(p => !p.monster && p.id !== me.id)!;
    const target = g.planets.find(p => p.owner === enemy.id)!;
    const a = newFleet(g, me, d.id, 1, hw);
    O.setOperation(g, a, { kind: 'attack', planetId: target.id, designId: d.id, target: 3, launch: true });
    check(a.waypoints.length === 1 && a.op!.launched === undefined, 'an attack that waits: the fleet stays until complete');
    a.tokens[0].qty = 3;
    O.runOperations(g);
    check(a.op!.launched === g.year && a.waypoints[a.waypoints.length - 1].targetId === target.id, 'complete: it leaves for its target');
  }

  console.log('--- slowing down only inside a minefield');
  {
    const { store } = await import('../src/ui/store');
    const A = await import('../src/ui/actions');
    const { minefieldSpans } = await import('../src/engine/movement');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39e-mines', { shape: 'arm' });
    const me = g.players[g.human];
    const enemy = g.players.find(p => !p.monster && p.id !== me.id)!;
    me.relations[enemy.id] = 'enemy';
    // (0.3.9.21: at war with its owner, as the warnings now follow the rule the mines strike by)
    const DIP = await import('../src/engine/diplomacy');
    if (g.diplomacy) DIP.declareWar(g, enemy.id, me.id);
    store.game = g;
    const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
    const f = g.fleets.find(x => x.owner === me.id && x.orbiting === hw.id)!;
    // a destination 200 ly away, a known field of radius 30 in the middle
    const dest = { x: hw.x + 200, y: hw.y };
    const mid = { x: hw.x + 100, y: hw.y + 5 };
    me.intel.minefields[777] = { id: 777, owner: enemy.id, x: mid.x, y: mid.y, mines: 900, type: 'standard', year: g.year } as any;
    g.minefields.push({ id: 777, owner: enemy.id, x: mid.x, y: mid.y, mines: 900, type: 'standard' } as any);
    f.waypoints = [{ x: f.x, y: f.y, target: 'planet', targetId: hw.id, warp: 0, task: 'none' }, { x: dest.x, y: dest.y, target: 'space', warp: 9, task: 'none' }];
    const sp = minefieldSpans(g, me, f.waypoints[0], f.waypoints[1], 9);
    check(sp.length === 1 && sp[0].t0 > 0.3 && sp[0].t1 < 0.7 && sp[0].safe === 4, `the span inside the field (${sp.map(x => `${x.t0.toFixed(2)}→${x.t1.toFixed(2)} Warp ${x.safe}`).join(', ')})`);
    store.commanded = { kind: 'fleet', id: f.id }; store.selected = { kind: 'fleet', id: f.id };
    A.slowInMinefields(1);
    const w = f.waypoints;
    check(w.length === 4 && w[1].warp === 9 && w[2].warp === 4 && w[3].warp === 9, `Warp 9, then Warp 4 in the field, then Warp 9 (${w.map(x => x.warp).join(', ')})`);
    check(Math.abs(w[1].x - (hw.x + 100 - Math.sqrt(30 * 30 + 1 - 25) - 1)) < 3 && w[2].x > mid.x, `the waypoints at the edges of the field (${w[1].x}, ${w[2].x})`);
    check(minefieldSpans(g, me, w[0], w[1], w[1].warp).length === 0 && minefieldSpans(g, me, w[1], w[2], w[2].warp).length === 0 && minefieldSpans(g, me, w[2], w[3], w[3].warp).length === 0, 'no leg is dangerous any more');
    check(store.waypointIndex === 3, 'the destination stays selected');
    // and the flight: through the field at Warp 4, at war with its owner, without a stop at the new waypoints
    f.fuel = 1e6;
    let hit = false, years = 0;
    while (years < 40 && !(f.x === dest.x && f.y === dest.y)) { generateTurn(g); years++; f.fuel = 1e6; if (me.messages.some(m => m.text.includes('heurté un champ de mines'))) hit = true; if (!g.fleets.includes(f)) break; }
    check(!hit && f.x === dest.x && f.y === dest.y, `the fleet crosses the field without a hit and arrives in ${years} years`);
  }

  console.log('--- the strength of a guardian, remembered');
  {
    const { guardianAssessments, guardianStrength } = await import('../src/engine/guardians');
    const g = quickGame(undefined, 'Medium', 3, 'standard', 'v39e-guard', { shape: 'arm' });
    const me = g.players[g.human];
    const gd = (g.guardians ?? []).find(x => x.alive);
    check(!!gd, 'a game with guardians');
    if (gd) {
      const gf = g.fleets.find(f => f.id === gd.fleetId)!;
      const scout = g.fleets.find(f => f.owner === me.id)!;
      scout.x = gf.x; scout.y = gf.y;
      guardianAssessments(g);
      const r = me.intel.guardianReports?.[gd.id];
      check(!!r && r.year === g.year && r.witness === scout.name && r.strength === guardianStrength(g, gd), `the measure is kept (${r?.witness}, ${r?.year})`);
      g.year += 3;
      scout.x += 50;
      guardianAssessments(g);
      check(me.intel.guardianReports?.[gd.id]?.year === g.year - 3, 'and stays as it was once the ship has left');
    }
  }

  console.log('--- the garrison of a pirate lair, remembered');
  {
    const { lairAssessments } = await import('../src/engine/pirates');
    const g = quickGame(undefined, 'Medium', 3, 'standard', 'v39e-lair', { shape: 'arm' });
    const me = g.players[g.human];
    g.pirates!.emergeYear = g.year + 1; generateTurn(g);
    const l = g.pirates!.lairs.find(x => x.alive);
    check(!!l, `the pirates are out (${g.pirates!.lairs.length} lairs)`);
    if (l) {
      const lf = g.fleets.find(f => f.id === l.fleetId)!;
      const scout = g.fleets.find(f => f.owner === me.id)!;
      scout.x = lf.x; scout.y = lf.y;
      me.messages = [];
      lairAssessments(g);
      const r = me.intel.lairReports?.[l.planetId];
      check(!!r && r.year === g.year && r.ships === lf.tokens.reduce((a, t) => a + t.qty, 0) && r.witness === scout.name, `the garrison is measured and kept (${r?.ships} ships, by ${r?.witness})`);
      check(me.messages.some(m => m.text.includes('la garnison du repaire')), 'and the crew says so');
      check(me.intel.planets[l.planetId]?.lair === 'pirates', 'the lair is known');
      g.year += 4; scout.x += 60;
      lairAssessments(g);
      check(me.intel.lairReports?.[l.planetId]?.year === g.year - 4, 'the measure stays once the ship has left');
    }
  }

  console.log(bad ? `${bad} FAILED, ${good} ok` : `all good (${good})`);
  if (bad) process.exit(1);
}
void main();
