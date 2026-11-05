// Constellations 0.3.9.22 checks: the bugs found by the second review of the code, each one held down
// (run: npx tsx scripts/v39r-check.ts).
import { quickGame, addDesign, newFleet } from '../src/engine/newgame';
import { PREDEFINED_RACES } from '../src/engine/race';
import { autoDesign } from '../src/engine/design';
import { fleetSpec, cargoMass } from '../src/engine/fleet';
import { generateTurn, availableTechNames, emptyPlanet } from '../src/engine/turn';
import { planetSpec, maxPopulation } from '../src/engine/planet';
import { runProduction, estimateQueue } from '../src/engine/production';
import { transferBetweenFleets, splitFleet, mergeFleets, resolveLandings } from '../src/engine/tasks';
import * as DIP from '../src/engine/diplomacy';
import { rivalPortal } from '../src/engine/megaprojects';
import { ruleOffTech, TECHS } from '../src/engine/tech';
import type { GameState, QueueItem } from '../src/engine/types';

let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
const zero = () => ({ ironium: 0, boranium: 0, germanium: 0, resources: 0 });
const minerals = (g: GameState) => {
  let t = 0;
  for (const p of g.planets) t += p.surface.ironium + p.surface.boranium + p.surface.germanium + p.queue.reduce((a, q) => a + q.allocated.ironium + q.allocated.boranium + q.allocated.germanium, 0);
  for (const f of g.fleets) t += f.cargo.ironium + f.cargo.boranium + f.cargo.germanium;
  return t;
};
function game(seed: string, opts: Record<string, unknown> = {}) {
  const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Tiny', 2, 'standard', seed, opts as any);
  for (const p of g.players) p.baseColor ??= p.color;
  const me = g.players[g.human];
  const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
  return { g, me, hw };
}

async function main() {
console.log('--- production: alchemy, population over the maximum, a queue emptied, two lines of the same kind');
{
  const { g, me, hw } = game('r-alch');
  hw.queue = [{ kind: 'alchemy', qty: 3, allocated: zero() } as QueueItem];
  hw.bonusResources = 1000; // (a young colony makes 30 resources a year)
  const before = { ...hw.surface };
  const res = runProduction(g, hw, () => {});
  const made = res.built.find(b => b.kind === 'alchemy')?.qty ?? 0;
  check(made > 0, `alchemy built (${made})`);
  check(made === 3 && hw.surface.ironium === before.ironium + made && hw.surface.germanium === before.germanium + made, `its minerals reach the surface (ironium ${before.ironium} -> ${hw.surface.ironium}, +${made} made)`);
  // over the maximum, the excess works at half rate
  const max = maxPopulation(g, me, hw);
  hw.bonusResources = 0;
  hw.pop = max; const atMax = planetSpec(g, hw, me).resources;
  hw.pop = max * 2; const twice = planetSpec(g, hw, me).resources;
  check(twice > atMax && twice < atMax * 1.75, `twice the maximum population yields between 1 and 1.75 times the resources (${atMax} -> ${twice})`);
  hw.pop = max;
  // a world emptied gives back what its queue had set aside
  const { g: g2, hw: hw2 } = game('r-clear');
  hw2.queue = [{ kind: 'factory', qty: 10, allocated: { ironium: 40, boranium: 30, germanium: 20, resources: 0 } } as QueueItem];
  const m0 = minerals(g2);
  emptyPlanet(hw2);
  check(minerals(g2) === m0 && hw2.queue.length === 0, `emptying a world keeps the minerals its queue held (${m0} -> ${minerals(g2)})`);
  // two lines of the same kind are estimated each on its own
  const { g: g3, hw: hw3 } = game('r-est');
  hw3.queue = [{ kind: 'defenses', qty: 2, allocated: zero() } as QueueItem, { kind: 'factory', qty: 60, allocated: zero() } as QueueItem, { kind: 'defenses', qty: 2, allocated: zero() } as QueueItem];
  const est = estimateQueue(g3, hw3, 30);
  check(est[0].firstYear !== null && est[2].firstYear !== null && est[2].firstYear! >= (est[1].firstYear ?? 0), `the second line of defenses is not credited with the first one's (years ${est[0].firstYear}, ${est[1].firstYear}, ${est[2].firstYear})`);
}

console.log('--- resources given to a world are spent by the next production');
{
  const a = game('r-bonus'), b = game('r-bonus');
  for (const x of [a, b]) x.hw.queue = [{ kind: 'factory', qty: 500, allocated: zero() } as QueueItem];
  b.hw.bonusResources = 2000;
  const fa = a.hw.factories, fb = b.hw.factories;
  generateTurn(a.g); generateTurn(b.g);
  check(b.hw.factories - fb > a.hw.factories - fa, `a bonus set before the turn builds more (${a.hw.factories - fa} vs ${b.hw.factories - fb} factories)`);
}

console.log('--- fleets: routes left with detour points only, transfers, splits, merges, landings');
{
  const { g, me, hw } = game('r-fleet');
  const d = addDesign(g, autoDesign(me, 'Medium Freighter', 'freighter', 'Cargo')!);
  const f = newFleet(g, me, d.id, 3, hw);
  f.waypoints = [f.waypoints[0], { x: hw.x + 40, y: hw.y, target: 'space', warp: 5, task: 'none', detour: true }];
  let threw = '';
  try { generateTurn(g); } catch (e) { threw = String(e); }
  check(!threw, `a route made of detour points only does not break the turn (${threw || 'no error'})`);
  const o = newFleet(g, me, d.id, 1, hw);
  f.cargo.ironium = 10; const c0 = cargoMass(o.cargo);
  check(transferBetweenFleets(g, f, o, 'ironium', NaN) === 0 && cargoMass(o.cargo) === c0 && f.cargo.ironium === 10, 'a transfer of NaN moves nothing');
  check(transferBetweenFleets(g, f, o, 'ironium', -5) === 0 && f.cargo.ironium === 10, 'a negative transfer moves nothing');
  // splits: nonsense parts are refused, the cargo fits both holds
  const n0 = g.fleets.length;
  check(splitFleet(g, f, [{ designId: d.id, qty: -2 }]) === null && splitFleet(g, f, [{ designId: 999999, qty: 1 }]) === null && g.fleets.length === n0, 'a split of a negative quantity or of a design the fleet has not is refused');
  const cap = fleetSpec(g, f).cargoCapacity;
  f.cargo = { ironium: Math.floor(cap / 3) + 1, boranium: Math.floor(cap / 3) + 1, germanium: cap - 2 * (Math.floor(cap / 3) + 1), colonists: 0 };
  const tot = cargoMass(f.cargo);
  const nf = splitFleet(g, f, [{ designId: d.id, qty: 1.7 }])!;
  check(!!nf && nf.tokens[0].qty === 1, `a fractional quantity splits whole ships (${nf?.tokens[0].qty})`);
  check(cargoMass(f.cargo) + cargoMass(nf.cargo) === tot && cargoMass(f.cargo) <= fleetSpec(g, f).cargoCapacity && cargoMass(nf.cargo) <= fleetSpec(g, nf).cargoCapacity, `the cargo is kept and fits both holds (${cargoMass(f.cargo)}/${fleetSpec(g, f).cargoCapacity} + ${cargoMass(nf.cargo)}/${fleetSpec(g, nf).cargoCapacity} = ${tot})`);
  check(nf.waiting === false, 'the fleet split off does not inherit a wait');
  // merges: the routes kept for repeating and this year's landings follow the merged fleet
  const chaser = newFleet(g, me, d.id, 1, hw);
  chaser.route = [{ x: 0, y: 0, target: 'fleet', targetId: nf.id, warp: 5, task: 'none' }];
  g.landings = [{ planetId: hw.id, owner: me.id, kt: 5, fleetId: nf.id, fleetName: nf.name }];
  mergeFleets(g, f, nf);
  check(chaser.route[0].targetId === f.id, `a repeated route aimed at the absorbed fleet now aims at the merged one (${chaser.route[0].targetId} = ${f.id})`);
  check(g.landings[0].fleetId === f.id, 'troops landed by the absorbed fleet will go back aboard the merged one');
  // landings refused go back aboard a fleet of the same owner only, as much as its hold takes
  const ai = g.players.find(p => p.id !== me.id && !p.monster)!;
  const target = g.planets.find(p => p.owner === ai.id && p.homeworld)!;
  const lander = newFleet(g, me, d.id, 1, target);
  lander.cargo = { ironium: 0, boranium: 0, germanium: 0, colonists: fleetSpec(g, lander).cargoCapacity - 10 };
  g.landings = [{ planetId: target.id, owner: me.id, kt: 50, fleetId: lander.id, fleetName: lander.name }];
  resolveLandings(g); // (not at war, the world has a station: they cannot land)
  check(cargoMass(lander.cargo) <= fleetSpec(g, lander).cargoCapacity, `troops that cannot land never overfill the hold (${cargoMass(lander.cargo)}/${fleetSpec(g, lander).cargoCapacity})`);
}

console.log('--- diplomacy: deals made pointless leave the inbox, the lasting peace survives an alliance');
{
  const { g } = game('r-dip', { diplomacy: true });
  const pr = g.diplomacy!.pairs['0-1'];
  pr.status = 'war'; pr.since = g.year - 20;
  g.diplomacy!.proposals.push({ id: 77001, from: 1, to: 0, kind: 'peace', expires: g.year + 2 } as any);
  DIP.makePeace(g, 0, 1);
  check(!g.diplomacy!.proposals.some(x => x.id === 77001), 'a peace signed removes the pending peace proposal');
  check(DIP.answer(g, 77001, true) !== null, `answering a proposal that is gone says why ("${DIP.answer(g, 77001, true)}")`);
  pr.since = g.year - 30;
  DIP.sign(g, 0, 1, 'alliance');
  DIP.cancel(g, 0, 1, 'alliance');
  const v = DIP.opinion(g, 1, 0).lines.find(x => x.label === 'Paix durable')?.value;
  check(pr.peaceSince === g.year - 30 && v === 6, `the peace keeps its first year through an alliance signed and ended and the opinion counts it (${pr.peaceSince}, « Paix durable » ${v ?? 0})`);
  check(DIP.isBetrayal(g, 0, 1), 'a war declared just after ending the alliance is a betrayal');
  // an expired proposal of a dead empire is no refusal
  g.diplomacy!.proposals.push({ id: 77002, from: 1, to: 0, kind: 'trade', expires: g.year } as any);
  g.players[1].dead = true;
  const before = JSON.stringify(g.players[1].memory ?? null);
  DIP.runDiplomacy(g);
  check(!g.diplomacy!.proposals.some(x => x.id === 77002) && JSON.stringify(g.players[1].memory ?? null) === before, 'the proposal of a dead empire expires without a grudge');
}

console.log('--- rules switched off, rival Portals');
{
  const { g, me } = game('r-off', { deception: false, culture: false });
  me.tech = { energy: 26, weapons: 26, propulsion: 26, construction: 26, electronics: 26, biotechnology: 26 };
  const names = availableTechNames(me, g);
  const decoy = [...TECHS.values()].find(t => (t as any).origin === 'deception');
  check(!!decoy && ruleOffTech(g, decoy) && !names.includes(decoy.name), `the decoy is not available without Deception (${decoy?.name})`);
  check(!names.includes('Sovereignty Beacon'), 'the sovereignty beacon is not available without Culture');
  const { g: g2, me: me2, hw } = game('r-portal', { megaprojects: true });
  const rival = g2.planets.find(p => p.owner >= 0 && p.owner !== me2.id && p.homeworld)!;
  hw.queue.push({ kind: 'mega', megaId: 'portal', qty: 1, allocated: zero(), announced: 80 } as any);
  rival.queue.push({ kind: 'mega', megaId: 'portal', qty: 1, allocated: zero(), announced: 20 } as any);
  const rp = rivalPortal(g2, me2);
  check(rp?.planet.id === rival.id, `the rival's Portal is told even when ours is further along (${rp?.planet.name})`);
}

console.log('--- the interface: orders go to our own fleets only, trailing detours go with their destination');
{
  const g0: any = globalThis;
  g0.window = g0; g0.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }; g0.document = undefined;
  const { store } = await import('../src/ui/store');
  const A = await import('../src/ui/actions');
  const { g, me, hw } = game('r-ui', { logistics: true });
  const d = addDesign(g, autoDesign(me, 'Scout', 'scout', 'Eclaireur')!);
  const ai = g.players.find(p => p.id !== me.id && !p.monster)!;
  const f = newFleet(g, me, d.id, 1, hw);
  store.game = g; store.undo = [];
  store.select({ kind: 'fleet', id: f.id });
  f.owner = ai.id;
  check(A.commandedFleet() === undefined, 'a fleet that is no longer ours takes no orders');
  f.owner = me.id;
  f.waypoints = [f.waypoints[0], { x: hw.x + 30, y: hw.y, target: 'space', warp: 5, task: 'none' }, { x: hw.x + 60, y: hw.y + 10, target: 'space', warp: 5, task: 'none', detour: true }, { x: hw.x + 90, y: hw.y, target: 'space', warp: 5, task: 'none' }];
  A.deleteWaypoint(3);
  check(f.waypoints.length === 2 && !f.waypoints.some(w => w.detour), `deleting the destination drops the detour points that led to it (${f.waypoints.length} steps left)`);
  const undo0 = store.undo.length;
  A.setWarp(1, f.waypoints[1].warp);
  check(store.undo.length === undo0, 'setting the same speed again leaves no undo point');
  f.pursue = 12345;
  const n0 = store.undo.length;
  A.setNetwork(f, true); // (a scout cannot serve the network)
  check(f.pursue === 12345 && store.undo.length === n0, 'a network refused leaves the fleet\'s orders as they were');
}

console.log(`\n${bad} failure(s), ${good} ok`);
process.exit(bad ? 1 : 0);
}
void main();
