// UI-level fuzzing: random orders through the same actions the interface uses, then turn generation + invariants.
// usage: tsx scripts/fuzz.ts <years> <seed>
import type { WaypointTask, TransportKey } from '../src/engine/types';
async function main() {
const g0: any = globalThis;
g0.window = g0; g0.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
g0.document = undefined;
const { store } = await import('../src/ui/store');
const A = await import('../src/ui/actions');
const { quickGame } = await import('../src/engine/newgame');
const { generateTurn } = await import('../src/engine/turn');
const { availableItems } = await import('../src/engine/production');
const { Rng } = await import('../src/engine/rng');
const { autoDesign, availableHulls } = await import('../src/engine/design');
const { addDesign } = await import('../src/engine/newgame');
const { checkInvariants } = await import('./check');
const { decide } = await import('../src/engine/anomalies');
const RF = await import('../src/engine/refuel');
  const M = await import('../src/engine/missions');
  const R = await import('../src/engine/refit');
  const DIP = await import('../src/engine/diplomacy');

const years = +(process.argv[2] ?? 60);
const seed = process.argv[3] ?? 'fz1';
const rng = new Rng([1, 2, 3, Number.parseInt(seed.replace(/\D/g, '') || '7')]);
const game = quickGame(undefined, 'Small', 3, 'standard', seed, process.env.SHAPE ? { shape: process.env.SHAPE as 'arm' } : undefined);
store.game = game;
const pre = +(process.argv[4] ?? 0);
if (pre) { game.players[0].ai = 'standard'; for (let i = 0; i < pre; i++) { generateTurn(game); if (process.env.VERBOSE) require('node:fs').writeSync(2, 'pre ' + game.year + '\n'); } game.players[0].ai = null; }
const me = () => game.players[game.human];
const pick = <T,>(a: T[]): T | undefined => a.length ? a[rng.int(a.length)] : undefined;
const TASKS: WaypointTask[] = ['none', 'transport', 'colonize', 'remoteMine', 'merge', 'scrap', 'layMines', 'patrol', 'route', 'transfer', 'refuel', 'beacon'];
const KEYS: TransportKey[] = ['fuel', 'ironium', 'boranium', 'germanium', 'colonists'];
const ACTIONS = ['none', 'loadAll', 'unloadAll', 'loadAmount', 'unloadAmount', 'fillPercent', 'waitPercent', 'loadOptimal', 'loadDunnage', 'setAmount', 'setWaypoint'];
let ops = 0;
for (let y = 0; y < years; y++) {
  const n = 6 + rng.int(10);
  for (let k = 0; k < n; k++) {
    const mine = game.planets.filter(p => p.owner === me().id);
    const fleets = game.fleets.filter(f => f.owner === me().id);
    const r = rng.int(10);
    if (process.env.VERBOSE === '2') require('node:fs').writeSync(2, `op ${game.year} ${k} ${r}\n`);
    try {
      if (r <= 3 && fleets.length) {
        const f = pick(fleets)!;
        store.select({ kind: 'fleet', id: f.id });
        const t = rng.int(4);
        const dbg = (m: string) => { if (process.env.VERBOSE === '2') require('node:fs').writeSync(2, `  ${m} f=${f.id} wps=${f.waypoints.length}\n`); };
        dbg('add' + t);
        if (t === 0) { const p = pick(game.planets)!; A.addWaypoint({ kind: 'planet', id: p.id }, p); }
        else if (t === 1) { const x = rng.int(game.width), yy = rng.int(game.height); A.addWaypoint({ kind: 'space', id: -1, x, y: yy }, { x, y: yy }); }
        else if (t === 2) { const o = pick(game.fleets)!; A.addWaypoint({ kind: 'fleet', id: o.id }, o); }
        else { const w = pick(game.wormholes); if (w) A.addWaypoint({ kind: 'wormhole', id: w.id }, w); }
        const wi = rng.int(f.waypoints.length);
        dbg('task');
        if (rng.chance(0.6)) A.setTask(wi, pick(TASKS)!);
        if (rng.chance(0.5)) A.setTransport(wi, pick(KEYS)!, pick(ACTIONS)!, rng.int(200));
        if (rng.chance(0.3) && wi > 0) A.setWarp(wi, 1 + rng.int(11));
        if (rng.chance(0.1)) A.setRepeat(rng.chance(0.5));
        if (rng.chance(0.25) && wi > 0) A.setStop(wi, rng.chance(0.5));
        if (rng.chance(0.2)) { for (let q = 0; q < 3; q++) { const x = rng.int(game.width), yy = rng.int(game.height); A.addWaypoint({ kind: 'space', id: -1, x, y: yy }, { x, y: yy }); } }
        dbg('misc');
        if (rng.chance(0.1)) A.autoWarps();
        if (rng.chance(0.1) && f.waypoints.length > 1) A.deleteWaypoint(1 + rng.int(f.waypoints.length - 1));
        dbg('auto');
        if (rng.chance(0.05)) A.setAutoExplore(f, rng.chance(0.7));
        dbg('done');
      } else if (r === 4 && fleets.length) {
        const f = pick(fleets)!;
        const others = fleets.filter(o => o !== f && o.x === f.x && o.y === f.y);
        if (others.length && rng.chance(0.5)) A.merge(f, pick(others)!);
        else if (f.tokens.length > 1 || f.tokens[0].qty > 1) { const k = rng.int(3); if (k === 0) A.splitAll(f); else if (k === 1) A.splitSingles(f); else A.split(f, [{ designId: f.tokens[0].designId, qty: 1 }]); }
      } else if (r === 5 && fleets.length) {
        const f = pick(fleets)!;
        if (f.orbiting >= 0) A.transferPlanet(f, f.orbiting, pick(KEYS)!, (rng.chance(0.5) ? 1 : -1) * rng.int(500));
        const o = game.fleets.find(x => x !== f && x.x === f.x && x.y === f.y && x.owner === f.owner);
        if (o) A.transferFleets(f, o, pick(KEYS)!, rng.int(300));
      } else if (r <= 8 && mine.length) {
        const p = pick(mine)!;
        const items = availableItems(game, p).filter(i => !i.disabled);
        const it = pick(items);
        if (it) A.queueAdd(p.id, it.kind, it.designId, 1 + rng.int(rng.chance(0.2) ? 1000 : 5), p.queue.length ? rng.int(p.queue.length + 1) : undefined, it.megaId);
        if (rng.chance(0.2) && p.queue.length) A.queueRemove(p.id, rng.int(p.queue.length));
        if (rng.chance(0.2) && p.queue.length > 1) A.queueMove(p.id, rng.int(p.queue.length), rng.int(p.queue.length));
        if (rng.chance(0.1) && p.queue.length) A.queueSetQty(p.id, rng.int(p.queue.length), rng.int(50));
      } else if (r === 9 && rng.chance(0.4)) {
        // Constellations 3 orders
        const sub = rng.int(7);
        const p = pick(mine);
        const f = pick(fleets);
        if (sub === 0 && p) A.setMigration(p, pick(['none', 'out', 'in'] as const)!, rng.int(110));
        else if (sub === 1 && p) A.setMineralPolicy(p, pick(['none', 'export', 'import'] as const)!, rng.int(500));
        else if (sub === 2 && f) A.setNetwork(f, rng.chance(0.7));
        else if (sub === 3) { const fork = pick(['energy', 'propulsion', 'construction', 'electronics', 'biotech', 'weapons']); if (fork) A.pickDoctrine(fork, rng.chance(0.5) ? 'a' : 'b'); }
        else if (sub === 4) { const d = pick(game.designs.filter(x => x.owner === me().id && !x.deleted)); if (d) A.setDesignRole(d, pick(['screen', 'line', 'artillery'] as const)!); const plan = pick(me().battlePlans); if (plan) A.setRetreat(plan, pick([0, 25, 50, 75])!); }
        else if (sub === 5 && rng.chance(0.15)) { A.toggleRule(pick(['terrain', 'distanceCost', 'logistics', 'combatRoles', 'doctrines', 'megaprojects', 'secretObjectives', 'deception', 'anomalies', 'guardians'] as const)!, rng.chance(0.6)); }
        else if (sub === 6 && p) { const it = pick(availableItems(game, p).filter(i => (i.kind === 'mega' || i.kind === 'capital') && !i.disabled)); if (it) A.queueAdd(p.id, it.kind, undefined, 1, 0, it.megaId); }
        // Constellations 3.2: interception, decisions
        if (rng.chance(0.3) && f && me().intel.fleets.length) { store.commanded = { kind: 'fleet', id: f.id }; A.intercept(pick(me().intel.fleets)!.id); if (rng.chance(0.2)) A.stopPursuit(f); }
        if (rng.chance(0.3) && f) { const ro = RF.refuelOptions(game, f); if (ro.length) A.refuel(pick(ro)!.tanker, f); }
        if (me().decisions?.length) { const d = me().decisions![0]; store.checkpoint(); decide(game, me(), d.id, rng.chance(0.5) ? 'a' : 'b'); }
        if (rng.chance(0.3) && f) { const t = pick(f.tokens); const to = t ? pick(R.refitTargets(game, me(), t.designId)) : undefined; if (t && to) A.refit(f, t.designId, to.id, 1 + rng.int(t.qty)); }
        if (rng.chance(0.05)) { const d = pick(game.designs.filter(x => x.owner === me().id && !x.deleted)); if (d) A.deleteDesign(d); }
        // Constellations 3.4: diplomacy, bounties, the new rules
        if (rng.chance(0.4) && game.diplomacy) {
          const o = pick(me().intel.met.filter(id => !game.players[id].monster && !game.players[id].dead));
          const sub2 = rng.int(8);
          store.checkpoint();
          if (o !== undefined && sub2 === 0) DIP.propose(game, me().id, o, pick(['peace', 'trade', 'research', 'alliance', 'tribute', 'embassy'] as const)!, pick([0, 0, 200, 500])!, rng.chance(0.5) ? me().id : o);
          else if (o !== undefined && sub2 === 1 && rng.chance(0.3)) DIP.declareWar(game, me().id, o);
          else if (o !== undefined && sub2 === 2) DIP.gift(game, me().id, o, pick([200, 500, 1000])!);
          else if (o !== undefined && sub2 === 3) DIP.cancel(game, me().id, o, pick(['trade', 'research', 'alliance', 'embassy'] as const)!);
          else if (sub2 === 4) { const pr = pick(game.diplomacy.proposals.filter(x => x.to === me().id)); if (pr) DIP.answer(game, pr.id, rng.chance(0.5)); }
          else if (o !== undefined && sub2 === 5 && p) A.queueAdd(p.id, 'bounty', undefined, 1 + rng.int(4), 0, undefined, undefined, o);
          // 3.5: spies, an agency
          else if (o !== undefined && sub2 === 6 && p) A.queueAdd(p.id, 'spy', undefined, 1 + rng.int(4), 0, undefined, undefined, o);
          else if (sub2 === 7 && p) A.queueAdd(p.id, 'agency', undefined, 1, 0);
        }
        if (rng.chance(0.03)) A.toggleRule(pick(['pirates', 'crisis', 'diplomacy', 'espionage'] as const)!, rng.chance(0.6));
      } else if (r === 9) {
        const sub = rng.int(8);
        if (sub === 0) {
          const f = ['energy', 'weapons', 'propulsion', 'construction', 'electronics', 'biotechnology'] as const;
          me().researching = pick([...f])!; me().researchPct = rng.int(60);
        } else if (sub === 1) {
          // new design from an available hull
          const sb = rng.chance(0.3);
          const h = pick(availableHulls(me(), sb));
          const purposes = sb ? ['starbase', 'fort', 'packetThrower', 'stargater'] : ['scout', 'colonizer', 'freighter', 'bomber', 'beamWarship', 'torpedoWarship', 'mineLayer', 'miner', 'terraformer', 'fuelFreighter'];
          if (h) { const d = autoDesign(me(), h.name, pick(purposes) as any, 'Fuzz ' + rng.int(1000)); if (d) addDesign(game, d); }
        } else if (sub === 2) {
          // delete a design (as the designer does)
          const d = pick(game.designs.filter(x => x.owner === me().id && !x.deleted));
          if (d && rng.chance(0.3)) d.deleted = true;
        } else if (sub === 3) {
          const f = pick(game.fleets.filter(x => x.owner === me().id));
          const bp = pick(me().battlePlans);
          if (f && bp) A.setBattlePlan(f, bp.id);
          const plan = pick(me().battlePlans);
          if (plan) { plan.tactic = pick(['disengage', 'disengageIfChallenged', 'minimizeDamage', 'maximizeNetDamage', 'maximizeDamageRatio', 'maximizeDamage'])! as any; plan.dumpCargo = rng.chance(0.5); }
        } else if (sub === 4) {
          const o = pick(game.players.filter(p => p.id !== me().id));
          if (o) me().relations[o.id] = pick(['friend', 'neutral', 'enemy'])!;
        } else if (sub === 5 || sub === 6) {
          // one-click missions (send / build and send a scout or an ark)
          const t = pick(game.planets.filter(x => x.owner !== me().id))!;
          const kind = me().intel.planets[t.id].year === undefined ? 'explore' as const : rng.chance(0.25) ? 'haul' as const : rng.chance(0.4) ? 'mine' as const : 'colonize' as const;
          const so = M.sendOptions(game, me(), t.id, kind);
          if (so.length && rng.chance(0.6)) M.sendFleet(game, pick(so)!.fleet, t.id, kind);
          else { const d = M.missionDesigns(game, me(), kind)[0]; const bo = d ? M.buildOptions(game, me(), t.id, kind, d) : []; if (bo.length) M.queueMission(game, pick(bo)!.planet, d!, { kind, planetId: t.id }); }
          M.missionStatus(game, me(), t.id);
        } else {
          const p = pick(game.planets.filter(x => x.owner === me().id));
          const t = pick(game.planets);
          if (p && t) { if (rng.chance(0.5)) p.route = t.id; else { p.packetTarget = t.id; p.packetWarp = 5 + rng.int(9); } }
        }
      }
      ops++;
      if (process.env.EACH) { const bad = checkInvariants(game); if (bad.length) { console.log('AFTER OP', game.year, k, 'r', r, bad); process.exit(1); } }
    } catch (e) { console.log('ACTION ERROR year', game.year, (e as Error).stack?.split('\n').slice(0, 4).join(' | ')); process.exit(1); }
  }
  const tt = Date.now();
  if (process.env.SNAP && game.year === +process.env.SNAP) require('node:fs').writeFileSync(process.env.SNAPFILE!, JSON.stringify(game));
  try { generateTurn(game); } catch (e) { console.log('TURN ERROR year', game.year, (e as Error).stack?.split('\n').slice(0, 6).join(' | ')); process.exit(1); }
  const errs = checkInvariants(game);
  if (errs.length) { console.log('INVARIANT year', game.year, errs.slice(0, 8)); process.exit(1); }
  store.undo = [];
  if (process.env.VERBOSE) console.log(game.year, 'turn ms', Date.now() - tt, 'fleets', game.fleets.length, 'my fleets', game.fleets.filter(f => f.owner === 0).length);
}
console.log('ok', seed, 'years', years, 'ops', ops, 'fleets', game.fleets.filter(f => f.owner === 0).length, 'planets', game.planets.filter(p => p.owner === 0).length);
}
void main();
