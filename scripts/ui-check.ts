// Interface actions without a browser: route editing keeps sensible speeds (run: npx tsx scripts/ui-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
async function main() {
  const g0: any = globalThis;
  g0.window = g0; g0.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  g0.document = undefined;
  const { store } = await import('../src/ui/store');
  const A = await import('../src/ui/actions');
  const { quickGame } = await import('../src/engine/newgame');
  const { fleetSpec, estimateRoute, distance } = await import('../src/engine/fleet');
  const game = quickGame(undefined, 'Medium', 3, 'standard', 'ui-warp');
  for (const p of game.players) p.ai = null;
  store.game = game;
  (store as any).warn = () => {};
  const origOpen = store.open.bind(store); store.open = ((k: any, d?: any) => { if (k !== 'warn') origOpen(k, d); }) as any;
  const me = game.players[0];
  const home = game.planets.find(p => p.owner === 0 && p.homeworld)!;
  const f = game.fleets.find(x => x.owner === 0 && fleetSpec(game, x).scanRange > 0 && fleetSpec(game, x).cargoCapacity === 0 && !fleetSpec(game, x).colonizer)!;
  const sp = fleetSpec(game, f);
  store.select({ kind: 'fleet', id: f.id });
  // a destination beyond the fuel range: the speed drops
  const far = [...game.planets].sort((a, b) => distance(b, home) - distance(a, home))[0];
  store.waypointIndex = 0;
  A.addWaypoint({ kind: 'planet', id: far.id }, far);
  const slow = f.waypoints[1].warp;
  check(slow < sp.idealSpeed, `far destination (${Math.round(distance(far, home))} al): Warp ${slow} instead of ${sp.idealSpeed}`);
  // the step is dragged to a near planet: back to the ideal speed
  const near = game.planets.filter(p => p.id !== home.id).sort((a, b) => distance(a, home) - distance(b, home))[1];
  A.moveWaypoint(1, { kind: 'planet', id: near.id }, near);
  check(f.waypoints[1].warp === sp.idealSpeed && estimateRoute(game, f)[0].ok, `moved to ${near.name} (${Math.round(distance(near, home))} al): Warp ${f.waypoints[1].warp}`);
  // and back to the far one: slowed again
  A.moveWaypoint(1, { kind: 'planet', id: far.id }, far);
  check(f.waypoints[1].warp < sp.idealSpeed, `moved back far: Warp ${f.waypoints[1].warp}`);
  // a speed chosen by hand is replaced when the destination changes
  A.moveWaypoint(1, { kind: 'planet', id: near.id }, near);
  A.setWarp(1, 9);
  const mid = game.planets.filter(p => p.id !== home.id && p.id !== near.id).sort((a, b) => distance(a, home) - distance(b, home))[2];
  A.moveWaypoint(1, { kind: 'planet', id: mid.id }, mid);
  check(f.waypoints[1].warp === sp.idealSpeed, `hand-set Warp 9, then a new destination: Warp ${f.waypoints[1].warp}`);
  // inserted step: computed, and the following leg too
  store.waypointIndex = 1;
  A.addWaypoint({ kind: 'planet', id: far.id }, far);
  const before = f.waypoints[2].warp;
  A.deleteWaypoint(1);
  check(f.waypoints.length === 2 && f.waypoints[1].target === 'planet' && f.waypoints[1].targetId === far.id && f.waypoints[1].warp <= before && estimateRoute(game, f)[0].ok, `step deleted: the next leg is computed again (Warp ${f.waypoints[1].warp})`);
  A.insertWaypoint(1, { kind: 'planet', id: near.id }, near);
  check(f.waypoints[1].warp === sp.idealSpeed && estimateRoute(game, f).every(l => l.ok), `step inserted near: Warp ${f.waypoints[1].warp}, then Warp ${f.waypoints[2].warp}`);
  // withdrawing a design keeps the ships
  const d = game.designs.find(x => x.id === f.tokens[0].designId)!;
  const h = game.planets.find(p => p.owner === 0 && p.homeworld)!;
  h.queue.unshift({ kind: 'ship', designId: d.id, qty: 2, allocated: { ironium: 3, boranium: 0, germanium: 0, resources: 5 } });
  const fe = h.surface.ironium;
  A.deleteDesign(d);
  check(d.deleted === true && game.fleets.includes(f) && f.tokens[0].designId === d.id, 'design withdrawn, the fleet keeps its ships');
  check(!h.queue.some(q => q.designId === d.id) && h.surface.ironium === fe + 3, 'its queue lines removed, minerals refunded');
  // 3.2: manual orders end a pursuit; one ship per fleet; decisions; slow trips
  const other = game.fleets.find(x => x.owner === 1)!;
  other.x = home.x + 40; other.y = home.y; other.orbiting = -1; other.waypoints = [{ x: other.x, y: other.y, target: 'space', warp: 0, task: 'none' }];
  me.intel.fleets.push({ id: other.id, owner: 1, x: other.x, y: other.y, detail: 'full', name: other.name, tokens: other.tokens.map(t => ({ designId: t.designId, qty: t.qty })), heading: null, warp: 0 });
  const g2 = game.fleets.find(x => x.owner === 0 && x !== f && fleetSpec(game, x).hasEngines)!;
  store.select({ kind: 'fleet', id: g2.id });
  A.intercept(other.id);
  check(g2.pursue === other.id && g2.waypoints.length === 2, `intercept order: ${(store as any).toast?.text}`);
  if (g2.pursue !== undefined) {
    A.addWaypoint({ kind: 'planet', id: home.id }, home);
    check(g2.pursue === undefined, 'a hand-given waypoint ends the pursuit');
  }
  const many = game.fleets.find(x => x.owner === 0 && x !== f)!;
  many.tokens[0].qty = 3;
  const n0 = game.fleets.length;
  A.splitSingles(many);
  check(game.fleets.length === n0 + 2 && many.tokens[0].qty === 1, 'one ship per fleet');
  store.undoLast();
  check(store.game!.fleets.length === n0, 'and it can be undone');
  // 0.3.6.7: a fleet waiting in orbit for its refit is not idle
  {
    const { fleetMission } = await import('../src/ui/sidebar');
    const { zeroCost } = await import('../src/engine/production');
    const idleF = game.fleets.find(x => x.owner === 0 && x.waypoints.length <= 1 && x.orbiting === home.id && fleetMission(game, me, x).id === 'idle')
      ?? (() => { const x = game.fleets.find(y => y.owner === 0)!; x.x = home.x; x.y = home.y; x.orbiting = home.id; x.waypoints = [{ x: home.x, y: home.y, target: 'planet', targetId: home.id, warp: 0, task: 'none', processed: true }]; return x; })();
    check(fleetMission(game, me, idleF).id === 'idle', `${idleF.name} in orbit without orders is idle`);
    home.queue.unshift({ kind: 'refit', designId: idleF.tokens[0].designId, fromDesignId: idleF.tokens[0].designId, fleetId: idleF.id, qty: 1, allocated: zeroCost() });
    const mi = fleetMission(game, me, idleF);
    check(mi.id === 'refit' && mi.detail.includes(home.name), `once its refit is queued, it is in "${mi.label}" (${mi.detail})`);
    home.queue.shift();
  }
  // 0.3.7: the hidden cluster: a step there from the galaxy goes through its wormhole; the way into a veiled star
  {
    const { knowSecret } = await import('../src/engine/secrets');
    const { regionOf, inWall } = await import('../src/engine/walls');
    const { fleetMission } = await import('../src/ui/sidebar');
    const g2 = quickGame(undefined, 'Medium', 3, 'standard', 'ui-hidden', { shape: 'arm' });
    for (const p of g2.players) p.ai = null;
    store.game = g2;
    const me2 = g2.players[0];
    const pk = g2.secrets!.find(x => x.kind === 'pocket')!;
    const mouth = g2.wormholes.find(w => w.id === pk.mouthId)!, end = g2.wormholes.find(w => w.id === pk.endId)!;
    mouth.sealed = false; end.sealed = false; pk.openedBy = 0;
    knowSecret(g2, pk, me2);
    me2.tech.propulsion = 10; me2.tech.electronics = 10; // wormhole navigation
    const sc = g2.fleets.find(x => x.owner === 0 && fleetSpec(g2, x).scanRange > 0)!;
    store.select({ kind: 'fleet', id: sc.id }); store.waypointIndex = 0;
    const target = g2.planets[pk.ids[0]];
    A.addWaypoint({ kind: 'planet', id: target.id }, target);
    check(sc.waypoints.length === 3 && sc.waypoints[1].target === 'wormhole' && sc.waypoints[1].targetId === mouth.id && sc.waypoints[2].targetId === target.id, 'a step in the hidden cluster: the wormhole step is added before it');
    const est = estimateRoute(g2, sc);
    check(est.length === 2 && Number.isFinite(est[1].arrival) && est[1].dist < pk.box!.w * 1.5, `the estimate goes on from the other end (${Math.round(est[1].dist)} al after the wormhole)`);
    store.waypointIndex = 2;
    A.addWaypoint({ kind: 'space', id: -1, x: g2.width + 50, y: 50 }, { x: g2.width + 50, y: 50 });
    const last = sc.waypoints[sc.waypoints.length - 1];
    check(regionOf(g2, last) >= 0, `a step in the void is placed back (${Math.round(last.x)}, ${Math.round(last.y)})`);
    const v = g2.secrets!.find(x => x.kind === 'veiled')!;
    knowSecret(g2, v, me2); v.tunnel!.push(0);
    const sc2 = g2.fleets.find(x => x.owner === 0 && x !== sc)!;
    store.select({ kind: 'fleet', id: sc2.id }); store.waypointIndex = 0;
    const q = v.lane![2];
    A.addWaypoint({ kind: 'space', id: -1, x: q.x, y: q.y }, q);
    const w = sc2.waypoints[sc2.waypoints.length - 1];
    check(w.x === q.x && w.y === q.y && inWall(g2, q.x, q.y), 'a step on the way into the veiled star stays where it is put');
    // a fleet sounding the cloud is busy, not idle
    sc2.waypoints = [{ x: v.zone!.x, y: v.zone!.y, target: 'space', warp: 0, task: 'none', processed: true }];
    sc2.x = v.zone!.x; sc2.y = v.zone!.y; sc2.orbiting = -1;
    v.tunnel = [];
    const mi = fleetMission(g2, me2, sc2);
    check(fleetSpec(g2, sc2).scanRange <= 0 || (mi.id === 'study' && mi.detail.includes('sonde')), `a ship in the zone sounds the cloud (${mi.detail})`);
    store.game = game;
  }
  void me;
  console.log(bad ? `${bad} failure(s), ${good} ok` : `all good (${good})`);
  process.exit(bad ? 1 : 0);
}
void main();
