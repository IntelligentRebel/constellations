// One-click missions for human players: send a scout or an ark to a planet, or build one and send it.
import type { Fleet, GameState, Planet, Player, QueueItem, ShipDesign, Waypoint, TransportOrder } from './types';
import { miningBlocker } from './culture';
import { fleetSpec, estimateRoute, distance, emptyCargo, travelYears, bestWarpForLeg, canRefuelAt, type FleetSpec } from './fleet';
import { designSpec , isScoutDesign } from './design';
import { canBuildShip, unitCost, isAuto, zeroCost } from './production';
import { planetSpec } from './planet';
import { safeGoto } from './ai';
import { raceSpec } from './race';
import { capitalOf as empireCapital } from './empire';
import { joinNetwork } from './logistics';

export type MissionKind = 'colonize' | 'explore' | 'mine' | 'haul' | 'logistics';
/** homeId: for a mineral shuttle ('haul'), the planet where the minerals are delivered (default: the capital). */
export interface QueueMission { kind: MissionKind; planetId: number; homeId?: number }
export interface MissionOpts { homeId?: number }

/** A scout fleet: every ship is of a scout design (the Scout hull by default, or ticked in the designer), 0.3.8.10. */
export function isPureScout(sp: FleetSpec): boolean {
  return sp.hasEngines && sp.scanRange > 0 && sp.scout;
}

const idle = (f: Fleet) => f.waypoints.length <= 1 && !f.auto;

/** Fleets that could carry out the mission right now. */
function candidates(game: GameState, p: Player, kind: MissionKind): Fleet[] {
  const own = game.fleets.filter(f => f.owner === p.id && idle(f));
  if (kind === 'colonize') {
    return own.filter(f => {
      const sp = fleetSpec(game, f);
      if (!sp.colonizer || !sp.hasEngines) return false;
      if (f.cargo.colonists > 0) return true;
      const here = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
      return !!here && here.owner === p.id && here.pop > 1000;
    });
  }
  if (kind === 'mine') return own.filter(f => { const sp = fleetSpec(game, f); return sp.hasEngines && sp.miningRate > 0; });
  if (kind === 'haul') return own.filter(f => isFreighter(fleetSpec(game, f)));
  const scouts = own.filter(f => isPureScout(fleetSpec(game, f)));
  if (scouts.length) return scouts;
  // no dedicated scout: an armed probe (one small scout hull) will do
  return own.filter(f => { const sp = fleetSpec(game, f); return sp.hasEngines && sp.scanRange > 0 && !sp.colonizer && sp.ships === 1 && f.tokens.every(t => game.designs.find(d => d.id === t.designId)?.hull === 'Scout') && f.cargo.colonists + f.cargo.ironium + f.cargo.boranium + f.cargo.germanium === 0; });
}

/** A ship that carries cargo and does nothing else. */
export function isFreighter(sp: FleetSpec): boolean {
  return sp.hasEngines && sp.cargoCapacity > 0 && !sp.colonizer && sp.miningRate === 0;
}

/** The capital: the homeworld if it is still ours, else the most populated colony. */
export function capitalOf(game: GameState, p: Player): Planet | undefined {
  const seat = empireCapital(game, p);
  if (seat) return seat;
  const own = game.planets.filter(x => x.owner === p.id);
  return own.find(x => x.homeworld) ?? own.sort((a, b) => b.pop - a.pop)[0];
}

const ALL = (action: TransportOrder['action']) => ({ ironium: { action, amount: 0 }, boranium: { action, amount: 0 }, germanium: { action, amount: 0 } });

/**
 * Mineral shuttle: the fleet goes to the mined planet, loads all minerals, delivers them to its home port,
 * and repeats. Returns false if the round trip cannot be flown with the fuel available.
 */
export function planHaul(game: GameState, f: Fleet, planetId: number, homeId: number): boolean {
  const pl = game.planets[planetId], home = game.planets[homeId];
  if (!pl || !home || planetId === homeId) return false;
  const sp = fleetSpec(game, f);
  const ideal = sp.idealSpeed || 5;
  const load: Waypoint = { x: pl.x, y: pl.y, target: 'planet', targetId: pl.id, warp: ideal, task: 'transport', transport: ALL('loadAll') };
  const unload: Waypoint = { x: home.x, y: home.y, target: 'planet', targetId: home.id, warp: ideal, task: 'transport', transport: ALL('unloadAll') };
  const carrying = f.cargo.ironium + f.cargo.boranium + f.cargo.germanium > 0;
  const here: Waypoint = { ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true };
  const route: Waypoint[] = [];
  if (f.orbiting === home.id) { here.task = 'transport'; here.transport = ALL('unloadAll'); here.processed = false; }
  else if (f.orbiting === pl.id) { here.task = 'transport'; here.transport = ALL('loadAll'); here.processed = false; }
  if (f.orbiting === pl.id) route.push({ ...unload });
  else if (carrying && f.orbiting !== home.id) route.push({ ...unload }, { ...load }, { ...unload });
  else route.push({ ...load }, { ...unload });
  const saved = { wps: f.waypoints, repeat: f.repeat, route: f.route };
  f.waypoints = [here, ...route];
  for (let i = 1; i < f.waypoints.length; i++) f.waypoints[i].warp = bestWarpForLeg(game, f, i, ideal);
  // the steady cycle: from the home port, with a full tank if the port has a dock
  const cycleFleet: Fleet = { ...f, x: home.x, y: home.y, orbiting: home.id, fuel: canRefuelAt(game, game.players[f.owner], home) ? sp.fuelCapacity : f.fuel };
  const cycle = estimateRoute(game, cycleFleet, [{ ...unload, processed: true, task: 'none', transport: undefined }, { ...load, warp: f.waypoints.find(w => w.targetId === pl.id)?.warp ?? ideal }, { ...unload, warp: f.waypoints[f.waypoints.length - 1].warp }]);
  const first = estimateRoute(game, f);
  if (!first.every(l => l.ok) || !cycle.every(l => l.ok)) { f.waypoints = saved.wps; f.repeat = saved.repeat; f.route = saved.route; return false; }
  f.repeat = true;
  f.route = [{ ...load, warp: f.waypoints.find(w => w.targetId === pl.id && w.task === 'transport')?.warp ?? ideal }, { ...unload, warp: f.waypoints[f.waypoints.length - 1].warp }];
  f.auto = undefined;
  return true;
}

/** Years of one round trip home → mined planet → home for this fleet (or design probe). */
export function haulCycleYears(game: GameState, f: Fleet, planetId: number, homeId: number): number {
  const pl = game.planets[planetId], home = game.planets[homeId];
  const sp = fleetSpec(game, f);
  const w = sp.idealSpeed || 5;
  const probe: Fleet = { ...f, x: home.x, y: home.y, orbiting: home.id, fuel: sp.fuelCapacity, cargo: emptyCargo(), waypoints: [] };
  const est = estimateRoute(game, probe, [
    { x: home.x, y: home.y, target: 'planet', targetId: home.id, warp: 0, task: 'none', processed: true },
    { x: pl.x, y: pl.y, target: 'planet', targetId: pl.id, warp: w, task: 'transport', transport: ALL('loadAll') },
    { x: home.x, y: home.y, target: 'planet', targetId: home.id, warp: w, task: 'none' }]);
  return est.length ? est[est.length - 1].arrival : Infinity;
}

/**
 * 0.3.8: a fleet that cannot reach a far world at full speed with what is left in its tank crawled there at Warp 1 or 2
 * (decades), when a stop at one of your stations (or an ally's) on the way would fill it up. The fastest route with
 * one such stop, if it arrives sooner than `direct` (years); null otherwise.
 */
function viaRefuel(game: GameState, f: Fleet, target: { x: number; y: number; planetId: number }, task: Waypoint['task'], direct: number): Waypoint[] | null {
  const p = game.players[f.owner];
  const sp = fleetSpec(game, f);
  const ideal = Math.min(sp.idealSpeed || 5, sp.maxSafeSpeed || 9);
  const base: Waypoint = { ...f.waypoints[0], task: 'none', transport: undefined, processed: true };
  const docks = game.planets.filter(d => d.id !== target.planetId && d.id !== f.orbiting && canRefuelAt(game, p, d))
    .sort((a, b) => distance(f, a) + distance(a, target) - distance(f, b) - distance(b, target)).slice(0, 8);
  let best: { wps: Waypoint[]; years: number } | null = null;
  for (const d of docks) {
    for (let w = ideal; w >= 1; w--) {
      const wps: Waypoint[] = [base, { x: d.x, y: d.y, target: 'planet', targetId: d.id, warp: w, task: 'none' }, { x: target.x, y: target.y, target: 'planet', targetId: target.planetId, warp: ideal, task }];
      const est = estimateRoute(game, f, wps);
      if (est.length < 2 || !est.every(l => l.ok) || !est[0].refuelled) continue;
      // the same thin reserve as a direct trip
      if (est[1].fuelAfter < Math.max(1, sp.fuelCapacity * 0.02) && sp.freeSpeed < 2) break;
      const years = est[est.length - 1].arrival;
      if (!best || years < best.years) best = { wps, years };
      break;
    }
  }
  return best && best.years < direct ? best.wps : null;
}

/** The direct trip, or one with a stop to refuel when it arrives sooner (the fleet's waypoints are set). */
function goWithFuel(game: GameState, f: Fleet, target: { x: number; y: number; planetId: number }, task: Waypoint['task'], returns: boolean[]): boolean {
  const ok = returns.some(r => safeGoto(game, f, target, task, r, true));
  const sp = fleetSpec(game, f);
  const ideal = Math.min(sp.idealSpeed || 5, sp.maxSafeSpeed || 9);
  // full speed already, or a ship that makes its own fuel: nothing to gain
  if (ok && (f.waypoints[1]?.warp ?? 0) >= ideal) return true;
  if (sp.freeSpeed >= ideal) return ok;
  const est = ok ? estimateRoute(game, f) : [];
  const direct = ok && est.length ? est[est.length - 1].arrival : Infinity;
  const alt = viaRefuel(game, f, target, task, direct - 1);
  if (alt) { f.waypoints = alt; return true; }
  return ok;
}

/** Gives the fleet its orders (in place). Returns false if the target cannot be reached with the fuel on board. */
export function planMission(game: GameState, f: Fleet, planetId: number, kind: MissionKind, opts: MissionOpts = {}): boolean {
  const pl = game.planets[planetId];
  if (kind === 'logistics') return joinNetwork(game, f);
  if (kind === 'haul') {
    const home = opts.homeId ?? capitalOf(game, game.players[f.owner])?.id;
    return home !== undefined && planHaul(game, f, planetId, home);
  }
  const target = { x: pl.x, y: pl.y, planetId };
  if (kind === 'explore') return goWithFuel(game, f, target, 'none', [true, false]);
  if (kind === 'mine') return goWithFuel(game, f, target, 'remoteMine', [false]);
  const here = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
  const load = f.cargo.colonists === 0 && !!here && here.owner === f.owner;
  const saved = f.cargo.colonists;
  if (load) {
    // estimate with the colonists that will be loaded at departure
    const sp = fleetSpec(game, f);
    f.cargo.colonists = Math.max(0, Math.min(sp.cargoCapacity - f.cargo.ironium - f.cargo.boranium - f.cargo.germanium, Math.floor(here!.pop / 100) - 1));
  }
  const ok = goWithFuel(game, f, target, 'colonize', [false]);
  f.cargo.colonists = saved;
  if (!ok) return false;
  if (load) {
    const w0 = f.waypoints[0];
    w0.task = 'transport'; w0.transport = { colonists: { action: 'loadAll', amount: 0 } }; w0.processed = false;
  }
  return true;
}

export interface SendOption { fleet: Fleet; years: number; warp: number; /** crawling trip (fuel forces a very low warp) */ slow: boolean }

/**
 * A trip not worth making as is: fuel forces a crawl (Warp 2 or less for ships that can do better), or it lasts
 * far longer than the same distance at the engine's ideal speed.
 */
export function slowTrip(years: number, warp: number, ideal: number, dist: number): boolean {
  if (!Number.isFinite(years)) return true;
  if (warp <= 2 && ideal >= 4 && years > 3) return true;
  return years >= 12 && years > 2.5 * travelYears(dist, Math.max(1, ideal));
}

/** Ready fleets able to reach the planet, fastest first. */
export function sendOptions(game: GameState, p: Player, planetId: number, kind: MissionKind, opts: MissionOpts = {}): SendOption[] {
  const res: SendOption[] = [];
  for (const f of candidates(game, p, kind)) {
    if (f.orbiting === planetId && kind !== 'haul') continue;
    const clone: Fleet = JSON.parse(JSON.stringify(f));
    if (!planMission(game, clone, planetId, kind, opts)) continue;
    const est = estimateRoute(game, clone);
    if (!est.length || !est.every(l => l.ok)) continue;
    const years = est[est.length - 1].arrival, warp = Math.min(...clone.waypoints.slice(1).map(w => w.warp));
    res.push({ fleet: f, years, warp, slow: kind !== 'haul' && slowTrip(years, warp, fleetSpec(game, f).idealSpeed, distance(f, game.planets[planetId])) });
  }
  return res.sort((a, b) => a.years - b.years || distance(a.fleet, game.planets[planetId]) - distance(b.fleet, game.planets[planetId]));
}

export function sendFleet(game: GameState, f: Fleet, planetId: number, kind: MissionKind, opts: MissionOpts = {}): boolean {
  const before = JSON.stringify(f.waypoints);
  if (planMission(game, f, planetId, kind, opts)) { f.pursue = undefined; f.refuelFor = undefined; if (kind !== 'haul') { f.repeat = false; f.route = undefined; } return true; }
  f.waypoints = JSON.parse(before);
  return false;
}

/** Designs suited to the mission, best first. */
export function missionDesigns(game: GameState, p: Player, kind: MissionKind): ShipDesign[] {
  const list = game.designs.filter(d => d.owner === p.id && !d.deleted && !d.alien && !d.starbase).map(d => ({ d, s: designSpec(p, d) }));
  if (kind === 'colonize') return list.filter(x => x.s.colonyModule && x.s.numEngines > 0).sort((a, b) => b.s.cargoCapacity - a.s.cargoCapacity || a.s.cost.resources - b.s.cost.resources).map(x => x.d);
  if (kind === 'haul') return list.filter(x => x.s.cargoCapacity > 0 && !x.s.colonyModule && x.s.miningRate === 0 && x.s.numEngines > 0).sort((a, b) => b.s.cargoCapacity / Math.max(1, b.s.cost.resources) - a.s.cargoCapacity / Math.max(1, a.s.cost.resources) || b.s.cargoCapacity - a.s.cargoCapacity).map(x => x.d);
  if (kind === 'mine') return list.filter(x => x.s.miningRate > 0 && x.s.numEngines > 0).sort((a, b) => b.s.miningRate / Math.max(1, b.s.cost.resources) - a.s.miningRate / Math.max(1, a.s.cost.resources) || b.s.miningRate - a.s.miningRate).map(x => x.d);
  // 0.3.8.10: the scout designs first, else any unarmed ship with a scanner
  const scouts = list.filter(x => x.s.numEngines > 0 && isScoutDesign(x.d, x.s));
  const pure = scouts.length ? scouts : list.filter(x => x.s.numEngines > 0 && x.s.scanRange > 0 && !x.s.hasWeapons && !x.s.colonyModule && x.s.cargoCapacity === 0);
  return (pure.length ? pure : list.filter(x => x.s.numEngines > 0 && x.s.scanRange > 0 && !x.s.colonyModule))
    .sort((a, b) => b.s.idealSpeed - a.s.idealSpeed || b.s.scanRange - a.s.scanRange || a.s.cost.resources - b.s.cost.resources).map(x => x.d);
}

export interface BuildOption { planet: Planet; design: ShipDesign; buildYears: number; travelYears: number; total: number; reachable: boolean; warp: number; slow: boolean }

/** Rough build time of one more unit, placed before the automatic items of the queue. */
function buildYears(game: GameState, planet: Planet, design: ShipDesign): number {
  const p = game.players[planet.owner];
  const sp = planetSpec(game, planet, p);
  const at = insertIndex(planet);
  const need = { ironium: 0, boranium: 0, germanium: 0, resources: 0 };
  for (const it of [...planet.queue.slice(0, at), { kind: 'ship', designId: design.id, qty: 1, allocated: zeroCost() } as QueueItem]) {
    const c = unitCost(game, planet, p, it);
    const q = isAuto(it.kind) ? 0 : it.qty;
    need.ironium += c.ironium * q - it.allocated.ironium; need.boranium += c.boranium * q - it.allocated.boranium;
    need.germanium += c.germanium * q - it.allocated.germanium; need.resources += c.resources * q - it.allocated.resources;
  }
  let y = Math.ceil(Math.max(0, need.resources) / Math.max(1, sp.resourcesAvailable));
  for (const m of ['ironium', 'boranium', 'germanium'] as const) {
    const short = need[m] - planet.surface[m];
    if (short > 0) y = Math.max(y, sp.mining[m] > 0 ? Math.ceil(short / sp.mining[m]) : 99);
  }
  return Math.max(1, y);
}

function insertIndex(planet: Planet): number {
  const i = planet.queue.findIndex(q => isAuto(q.kind));
  return i < 0 ? planet.queue.length : i;
}

/** A not-yet-built fleet of one ship of this design at the planet, used for fuel and travel estimates. */
function probeFleet(game: GameState, p: Player, design: ShipDesign, at: Planet, kind: MissionKind): Fleet {
  const s = designSpec(p, design);
  return {
    id: -1, owner: p.id, num: 0, name: '', x: at.x, y: at.y, orbiting: at.id, tokens: [{ designId: design.id, qty: 1, damage: 0, qtyDamaged: 0 }],
    cargo: { ...emptyCargo(), colonists: kind === 'colonize' ? s.cargoCapacity : 0 }, fuel: s.fuelCapacity,
    waypoints: [{ x: at.x, y: at.y, target: 'planet', targetId: at.id, warp: 0, task: 'none' }], repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0,
  };
}

/** Shipyards able to build the design, best compromise between build time and travel time first. */
export function buildOptions(game: GameState, p: Player, planetId: number, kind: MissionKind, design = missionDesigns(game, p, kind)[0]): BuildOption[] {
  if (!design) return [];
  const target = game.planets[planetId];
  const s = designSpec(p, design);
  const res: BuildOption[] = [];
  // cheap first pass (build time + straight-line travel), then exact fuel-aware routes for the best shipyards
  const rough: { pl: Planet; by: number; ty: number }[] = [];
  for (const pl of game.planets) {
    if (pl.owner !== p.id || pl.pop <= 0 || canBuildShip(game, pl, design)) continue;
    if (kind === 'colonize' && pl.pop < s.cargoCapacity * 100 + 2000) continue;
    rough.push({ pl, by: buildYears(game, pl, design), ty: travelYears(distance(pl, target), s.idealSpeed || 5) });
  }
  rough.sort((a, b) => a.by + a.ty - (b.by + b.ty));
  for (const r of rough.slice(0, 8)) {
    const probe = probeFleet(game, p, design, r.pl, kind);
    const ok = safeGoto(game, probe, { x: target.x, y: target.y, planetId }, 'none', false, true);
    const est = ok ? estimateRoute(game, probe) : [];
    const ty = ok && est.length ? est[est.length - 1].arrival : r.ty;
    const warp = ok ? probe.waypoints[1]?.warp ?? 0 : 0;
    const slow = ok && kind !== 'haul' && slowTrip(ty, warp, s.idealSpeed, distance(r.pl, target));
    res.push({ planet: r.pl, design, buildYears: r.by, travelYears: ty, total: r.by + ty, reachable: ok, warp, slow });
  }
  return res.sort((a, b) => Number(b.reachable) - Number(a.reachable) || Number(a.slow) - Number(b.slow) || a.total - b.total || b.planet.pop - a.planet.pop);
}

/** Adds one ship with standing orders to the queue (before the automatic items, so it is built first). */
export function queueMission(game: GameState, planet: Planet, design: ShipDesign, mission: QueueMission) {
  planet.queue.splice(insertIndex(planet), 0, { kind: 'ship', designId: design.id, qty: 1, allocated: zeroCost(), mission: { ...mission } });
}

/** Orders for a freshly built ship that carries a mission. */
export function applyBuiltMission(game: GameState, f: Fleet, mission: QueueMission): boolean {
  if (mission.kind === 'logistics') return joinNetwork(game, f);
  const home = mission.homeId !== undefined && game.planets[mission.homeId]?.owner === f.owner ? mission.homeId : undefined;
  return planMission(game, f, mission.planetId, mission.kind, { homeId: home });
}

export interface MissionStatus {
  arks: { fleet: Fleet; arrival: number }[];
  scouts: { fleet: Fleet; arrival: number }[];
  /** miners heading there */
  miners: { fleet: Fleet; arrival: number }[];
  /** miners already working there */
  mining: Fleet[];
  /** mineral shuttles serving this planet, with their home port */
  haulers: { fleet: Fleet; home: Planet }[];
  queued: { planet: Planet; kind: MissionKind; homeId?: number }[];
}

/** The home port of a shuttle serving this planet, or null if the fleet is not one. */
export function haulHome(game: GameState, f: Fleet, planetId: number): Planet | null {
  if (!f.repeat || !f.route) return null;
  const i = f.route.findIndex(w => w.targetId === planetId && w.target === 'planet' && w.task === 'transport');
  if (i < 0) return null;
  const u = f.route.find((w, k) => k !== i && w.target === 'planet' && w.task === 'transport' && w.targetId !== planetId);
  return u && u.targetId !== undefined ? game.planets[u.targetId] : null;
}

/** What is already heading for (or being built for) this planet. */
export function missionStatus(game: GameState, p: Player, planetId: number): MissionStatus {
  const st: MissionStatus = { arks: [], scouts: [], miners: [], mining: [], haulers: [], queued: [] };
  for (const f of game.fleets) {
    if (f.owner !== p.id) continue;
    const home = haulHome(game, f, planetId);
    if (home) { st.haulers.push({ fleet: f, home }); continue; }
    const i = f.waypoints.findIndex((w, k) => k > 0 && w.target === 'planet' && w.targetId === planetId);
    if (i < 0) continue;
    const est = estimateRoute(game, f);
    const arrival = est[i - 1]?.arrival ?? 0;
    if (f.waypoints[i].task === 'colonize') st.arks.push({ fleet: f, arrival });
    else if (f.waypoints[i].task === 'remoteMine') st.miners.push({ fleet: f, arrival });
    else if (f.waypoints[i].task === 'none') st.scouts.push({ fleet: f, arrival });
  }
  for (const f of game.fleets) if (f.owner === p.id && f.waypoints.length <= 1 && f.waypoints[0]?.task === 'remoteMine' && f.orbiting === planetId) st.mining.push(f);
  for (const pl of game.planets) if (pl.owner === p.id) for (const q of pl.queue) if (q.mission?.planetId === planetId) st.queued.push({ planet: pl, kind: q.mission.kind, homeId: q.mission.homeId });
  return st;
}

/** Can this player remote-mine the planet (free world, or own world for races living in orbit)? */
export function canMineHere(game: GameState, p: Player, planetId: number): boolean {
  const intel = p.intel.planets[planetId];
  if (intel.year === undefined) return false;
  const owner = intel.owner ?? -1;
  if (owner < 0) return miningBlocker(game, p, game.planets[planetId], true) === null; // not in a friend's territory
  return owner === p.id && raceSpec(p.race).canRemoteMineOwn;
}

/** Yearly output of a remote miner on a planet: kt of each mineral (same formula as the turn). */
export function miningYield(conc: { ironium: number; boranium: number; germanium: number }, miningRate: number) {
  const y = (c: number) => Math.trunc(c * miningRate * 10 / 1000);
  return { ironium: y(conc.ironium), boranium: y(conc.boranium), germanium: y(conc.germanium) };
}
