// Fleets: aggregate specs, fuel usage, movement estimates, cargo helpers.
import { hasWalls, withDetours, voidStop } from './walls';
import { canUseWormholes } from './specials';
import { effectiveWarp } from './terrain';
import type { Cargo, Fleet, GameState, MinefieldType, Planet, Player, ShipToken, Waypoint } from './types';
import { specOf, type DesignSpec, cloakPercent, isScoutDesign } from './design';
import { raceSpec } from './race';
import { hasRelic } from './relics';

export interface FleetSpec {
  mass: number; // ships + cargo
  massEmpty: number;
  cargoCapacity: number;
  fuelCapacity: number;
  scanRange: number;
  scanRangePen: number;
  cloakPercent: number;
  idealSpeed: number;
  freeSpeed: number;
  maxSafeSpeed: number;
  hasEngines: boolean;
  hasWeapons: boolean;
  bomber: boolean;
  colonizer: boolean;
  orbitalConstruction: boolean;
  miningRate: number;
  terraformRate: number;
  mineLaying: Record<MinefieldType, number>;
  mineSweep: number;
  armor: number;
  shields: number;
  ships: number;
  powerRating: number;
  fuelGeneration: number;
  repairBonus: number;
  canStealFleet: boolean;
  canStealPlanet: boolean;
  tachyons: number;
  movement: number;
  estimatedRange: number;
  purposeIcon: string;
  /** 0.3.8.10: every ship of the fleet is of a scout design (see isScoutDesign) */
  scout: boolean;
  canJump: boolean;
  /** Constellations 3 decoys: apparent extra mass and phantom ships */
  decoyMass: number;
  decoys: number;
  /** Constellations 3.3: sovereignty beacon kits aboard */
  beaconKits: number;
}

export function tokenSpecs(game: GameState, fleet: Fleet): { token: ShipToken; spec: DesignSpec }[] {
  return fleet.tokens.map(t => ({ token: t, spec: specOf(game, t.designId) }));
}

export function cargoMass(c: Cargo): number { return c.ironium + c.boranium + c.germanium + c.colonists; }

/** After ships are lost, cargo and fuel beyond the remaining capacity are lost proportionally. */
export function clampFleetHold(game: GameState, f: Fleet) {
  let cap = 0, fuelCap = 0;
  for (const t of f.tokens) { const s = specOf(game, t.designId); cap += s.cargoCapacity * t.qty; fuelCap += s.fuelCapacity * t.qty; }
  const total = cargoMass(f.cargo);
  if (total > cap) {
    const r = total > 0 ? cap / total : 0;
    f.cargo = { ironium: Math.floor(f.cargo.ironium * r), boranium: Math.floor(f.cargo.boranium * r), germanium: Math.floor(f.cargo.germanium * r), colonists: Math.floor(f.cargo.colonists * r) };
  }
  if (f.fuel > fuelCap) f.fuel = fuelCap;
}

export function fleetSpec(game: GameState, fleet: Fleet): FleetSpec {
  const ts = tokenSpecs(game, fleet);
  const owner = game.players[fleet.owner];
  const rs = raceSpec(owner.race);
  let massEmpty = 0, cargoCap = 0, fuelCap = 0, scan = -1, pen = -1, ideal = 99, free = 99, maxSafe = 99, hasEngines = ts.length > 0;
  let hasWeapons = false, bomber = false, colonizer = false, orbital = false, mining = 0, terra = 0, sweep = 0, armor = 0, shields = 0, ships = 0, power = 0, fuelGen = 0, repair = 0, stealF = false, stealP = false, tach = 0, movement = 10, canJump = false;
  const lay: Record<MinefieldType, number> = { standard: 0, heavy: 0, speedBump: 0 };
  let cloakUnits = 0, uncloakedMass = 0, decoyMass = 0, decoys = 0, kits = 0;
  for (const { token: t, spec: s } of ts) {
    massEmpty += s.mass * t.qty;
    cargoCap += s.cargoCapacity * t.qty;
    fuelCap += s.fuelCapacity * t.qty;
    scan = Math.max(scan, s.scanRange);
    pen = Math.max(pen, s.scanRangePen);
    if (s.numEngines === 0) hasEngines = false;
    else { ideal = Math.min(ideal, s.idealSpeed); free = Math.min(free, s.freeSpeed); maxSafe = Math.min(maxSafe, s.maxSafeSpeed); }
    hasWeapons ||= s.hasWeapons; bomber ||= s.bomber; colonizer ||= s.colonyModule || s.orbitalConstruction; orbital ||= s.orbitalConstruction;
    mining += s.miningRate * t.qty; terra += s.terraformRate * t.qty; sweep += s.mineSweep * t.qty;
    for (const k of ['standard', 'heavy', 'speedBump'] as MinefieldType[]) lay[k] += s.mineLaying[k] * t.qty;
    armor += s.armor * t.qty; shields += s.shields * t.qty; ships += t.qty; power += s.powerRating * t.qty;
    fuelGen += s.fuelGeneration * t.qty; repair = Math.max(repair, s.repairBonus);
    stealF ||= s.canStealFleet; stealP ||= s.canStealPlanet; tach += s.tachyons * t.qty;
    movement = Math.min(movement, s.movement);
    canJump ||= s.canJump;
    decoyMass += (s.decoyMass ?? 0) * t.qty; decoys += (s.decoys ?? 0) * t.qty; kits += (s.beaconKits ?? 0) * t.qty;
    if (s.cloakUnits > 0) cloakUnits = Math.max(cloakUnits, s.cloakUnits); else uncloakedMass += s.mass * t.qty;
  }
  if (ideal === 99) { ideal = 0; free = 0; maxSafe = 0; }
  const cm = cargoMass(fleet.cargo);
  let cloakU = cloakUnits;
  if (cloakU > 0) {
    const cargoForCloak = rs.freeCargoCloak ? 0 : cm;
    cloakU = Math.round(cloakU * massEmpty / (massEmpty + cargoForCloak + uncloakedMass));
  }
  const spec: FleetSpec = {
    mass: massEmpty + cm, massEmpty, cargoCapacity: cargoCap, fuelCapacity: fuelCap, scanRange: scan, scanRangePen: pen,
    cloakPercent: cloakPercent(cloakU), idealSpeed: ideal, freeSpeed: free, maxSafeSpeed: maxSafe, hasEngines,
    hasWeapons, bomber, colonizer, orbitalConstruction: orbital, miningRate: mining, terraformRate: terra, mineLaying: lay, mineSweep: sweep,
    armor, shields, ships, powerRating: power, fuelGeneration: fuelGen, repairBonus: repair, canStealFleet: stealF, canStealPlanet: stealP,
    tachyons: tach, movement, estimatedRange: 0, purposeIcon: fleetIcon(ts.map(x => x.spec)), scout: ts.length > 0 && ts.every(x => { const d = game.designs.find(dd => dd.id === x.token.designId); return !!d && isScoutDesign(d, x.spec); }), canJump, decoyMass, decoys, beaconKits: kits,
  };
  spec.estimatedRange = estimateRange(game, fleet, spec);
  return spec;
}

function fleetIcon(specs: DesignSpec[]): string {
  if (specs.some(s => s.bomber)) return 'bomber';
  if (specs.some(s => s.hasWeapons && s.powerRating > 0)) return 'warship';
  if (specs.some(s => s.colonyModule || s.orbitalConstruction)) return 'colonizer';
  if (specs.some(s => s.miningRate > 0)) return 'miner';
  if (specs.some(s => s.mineLaying.standard + s.mineLaying.heavy + s.mineLaying.speedBump > 0)) return 'minelayer';
  if (specs.some(s => s.cargoCapacity > 0)) return 'freighter';
  if (specs.some(s => s.fuelGeneration > 0 || s.hullType === 'FuelTransport')) return 'fuel';
  return 'scout';
}

/**
 * Fuel used to travel `dist` light-years in one year at `warp`, with cargo loaded first into the most efficient
 * tokens (Stars! / craig-stars rule). Returns the exact (unrounded) amount.
 */
export function fuelUsageExact(game: GameState, fleet: Fleet, warp: number, dist: number, cargo = cargoMass(fleet.cargo)): number {
  if (warp <= 0 || dist <= 0 || warp > 10) return 0;
  const ts = tokenSpecs(game, fleet).map(x => ({ ...x, eff: x.spec.fuelUsage[Math.min(10, warp)] ?? 0 }));
  ts.sort((a, b) => a.eff - b.eff);
  let remaining = cargo;
  let fuel = 0;
  for (const t of ts) {
    const cap = t.spec.cargoCapacity * t.token.qty;
    const load = Math.min(cap, remaining);
    remaining -= load;
    const mass = t.spec.mass * t.token.qty + load;
    fuel += mass * t.eff * dist / 20000;
  }
  return hasRelic(game.players[fleet.owner], 'compass') ? fuel * 0.85 : fuel;
}

export function fuelForYear(game: GameState, fleet: Fleet, warp: number, dist: number, cargo?: number): number {
  return Math.ceil(fuelUsageExact(game, fleet, warp, dist, cargo) - 1e-9);
}

/** Fuel regenerated by engines while travelling (ramscoops, free-speed trickle). */
export function fuelGenerated(game: GameState, fleet: Fleet, warp: number, dist: number): number {
  let total = 0;
  for (const { token: t, spec: s } of tokenSpecs(game, fleet)) {
    if (!s.engine) continue;
    const d = s.freeSpeed - warp;
    const n = s.numEngines * t.qty;
    if (d < 0) continue;
    total += (d === 0 ? 1 : d === 1 ? 3 : d === 2 ? 6 : 10) * dist * n;
  }
  return Math.trunc(total);
}

export function estimateRange(game: GameState, fleet: Fleet, spec: FleetSpec): number {
  if (!spec.hasEngines || spec.idealSpeed <= 0) return 0;
  const perYear = fuelUsageExact(game, fleet, spec.idealSpeed, spec.idealSpeed * spec.idealSpeed);
  if (perYear <= 0) return Infinity;
  return Math.trunc(fleet.fuel / perYear * spec.idealSpeed * spec.idealSpeed);
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Years to travel a distance at a warp (each year moves warp² ly; stargate = 1). */
export function travelYears(dist: number, warp: number): number {
  if (dist <= 0) return 0;
  if (warp >= 11) return 1;
  if (warp <= 0) return Infinity;
  const per = warp * warp;
  return Math.ceil((dist - 1e-9) / per);
}

export interface LegEstimate {
  index: number; // waypoint index (destination)
  dist: number;
  /** years between the previous waypoint and this one (0 when both are passed during the same year) */
  years: number;
  fuel: number; // fuel used on this leg
  fuelAfter: number; // fuel left on arrival (after refuel at dock)
  /** fuel left on arrival, before any refuel */
  fuelArrive: number;
  refuelled: boolean;
  ok: boolean;
  /** fuel would run out on this leg */
  outOfFuel: boolean;
  /** year (relative) on which the fleet arrives, or passes the waypoint */
  arrival: number;
  /** the fleet goes through this waypoint without stopping */
  pass: boolean;
  /** 3.6: the points of the detour around a dark cloud, before this waypoint */
  via?: Waypoint[];
  /** where the fleet will be at the end of each year spent on this leg (the waypoint itself excluded) */
  yearEnds: { x: number; y: number }[];
}

export function planetAt(game: GameState, x: number, y: number): Planet | undefined {
  return game.planets.find(p => p.x === x && p.y === y);
}

/** Can this player refuel at this planet (own or friend's planet with a starbase having a dock)? */
/** Every station refuels the ships of its owner and its friends, an orbital fort as well as a shipyard (3.6). */
export function canRefuelAt(_game: GameState, player: Player, planet: Planet | undefined): boolean {
  // 0.3.7: around a brown dwarf, deuterium is skimmed from its atmosphere, for anyone who knows it is there
  if (planet?.hidden === 'dwarf' && !player.intel.planets[planet.id]?.unknown) return true;
  if (!planet || planet.owner < 0 || !planet.starbase) return false;
  return planet.owner === player.id || player.relations[planet.owner] === 'friend';
}

/**
 * Can the fleet go through waypoint i without stopping? Only a point in deep space (a turn): a planet always
 * means entering orbit, which takes the rest of the year.
 */
export function canPassThrough(wps: Waypoint[], i: number): boolean {
  const wp = wps[i];
  if (!wp || i <= 0 || i >= wps.length - 1) return false;
  if (wp.task !== 'none') return false;
  if (wp.target !== 'space') return false;
  if ((wps[i + 1].warp ?? 0) >= 11) return false;
  return true;
}

/**
 * Waypoint i is crossed without stopping: points in deep space, unless the player asked for a stop there.
 * Planets, the last waypoint, waypoints with a task and the ones before a stargate jump always stop.
 */
export function isPassThrough(wps: Waypoint[], i: number): boolean {
  return canPassThrough(wps, i) && wps[i].stop !== true;
}

/**
 * Simulates the route of a fleet (waypoints[0] is the current position), year by year, exactly as the
 * movement phase does: the fleet keeps its momentum through pass-through waypoints, stops elsewhere.
 * Uses the cargo the fleet currently carries (transport orders are approximated at waypoints).
 */
export function estimateRoute(game: GameState, fleet: Fleet, waypoints: Waypoint[] = fleet.waypoints, startFuel = fleet.fuel): LegEstimate[] {
  // 3.6: around the dark clouds, as the movement will go: the legs of a detour add up into the leg they replace
  if (hasWalls(game) && waypoints.length > 1) {
    const { list, map } = withDetours(game, waypoints, undefined, fleet.owner);
    if (list.length !== waypoints.length) {
      const legs = simulateRoute(game, fleet, list, startFuel);
      const out: LegEstimate[] = [];
      for (let i = 1; i < waypoints.length; i++) {
        const part = legs.slice(map[i - 1], map[i]);
        const last = part[part.length - 1];
        const prevArrival = i > 1 ? out[out.length - 1].arrival : 0;
        out.push({ ...last, index: i, dist: part.reduce((a, l) => a + l.dist, 0), fuel: part.reduce((a, l) => a + l.fuel, 0), years: Number.isFinite(last.arrival) ? last.arrival - prevArrival : Infinity, ok: part.every(l => l.ok), outOfFuel: part.some(l => l.outOfFuel), yearEnds: part.flatMap(l => l.yearEnds), via: part.slice(0, -1).map(l => list[l.index]) });
      }
      return out;
    }
  }
  return simulateRoute(game, fleet, waypoints, startFuel);
}

function simulateRoute(game: GameState, fleet: Fleet, waypoints: Waypoint[], startFuel: number): LegEstimate[] {
  const owner = game.players[fleet.owner];
  const spec = fleetSpec(game, fleet);
  const res: LegEstimate[] = [];
  let fuel = startFuel;
  let cargo = cargoMass(fleet.cargo);
  let pos = { x: fleet.x, y: fleet.y };
  // completed years, and what is left of the current one
  let year = 0, budget = 1, prevArrival = 0;
  const fresh = () => { if (budget < 1) { year++; budget = 1; } };
  // refuel at current position if possible
  if (canRefuelAt(game, owner, fleet.orbiting >= 0 ? game.planets[fleet.orbiting] : undefined)) fuel = spec.fuelCapacity;
  for (let i = 1; i < waypoints.length; i++) {
    const wp = waypoints[i];
    // cargo changes at previous waypoint (approximate)
    if (!(i === 1 && waypoints[0].processed)) cargo = applyTransportEstimate(cargo, waypoints[i - 1], spec.cargoCapacity);
    const dist = distance(pos, wp);
    const warp = wp.warp;
    const pass = isPassThrough(waypoints, i);
    let legFuel = 0, outOfFuel = false, arrival: number;
    const yearEnds: { x: number; y: number }[] = [];
    if (warp >= 11) { fresh(); year++; arrival = year; }
    else if (dist > 0 && !(warp > 0)) { arrival = Infinity; outOfFuel = true; } // no speed set: unreachable
    else if (dist > 0 && voidStop(game, pos, wp)) { arrival = Infinity; outOfFuel = true; } // 0.3.7: across the void around the hidden cluster
    else if (dist > 0) {
      // same steps as the movement phase, including the rounding of positions at the end of each year
      let cur = { x: pos.x, y: pos.y }, guard = 0;
      while (guard++ < 5000) {
        if (budget <= 1e-9) { year++; budget = 1; }
        // same terrain cap as the movement phase, evaluated for each year's path
        const w = effectiveWarp(game, cur, wp, warp, budget);
        const speed = w * w;
        const total = distance(cur, wp);
        let d = Math.min(total, speed * budget);
        if (total - d < 1) d = total;
        const f = fuelForYear(game, fleet, w, d, cargo) - fuelGenerated(game, fleet, w, d);
        legFuel += Math.max(0, f);
        fuel -= Math.max(0, f);
        if (f < 0) fuel = Math.min(spec.fuelCapacity, fuel - f);
        if (fuel < 0) outOfFuel = true;
        if (d >= total) { budget -= Math.min(budget, total / speed); break; }
        cur = { x: Math.round(cur.x + (wp.x - cur.x) / total * d), y: Math.round(cur.y + (wp.y - cur.y) / total * d) };
        budget = 0;
        yearEnds.push(cur);
      }
      arrival = year + (budget < 1 ? 1 : 0);
    } else arrival = year + (budget < 1 ? 1 : 0);
    if (!pass && Number.isFinite(arrival)) { year = arrival; budget = 1; }
    const planet = wp.target === 'planet' && wp.targetId !== undefined ? game.planets[wp.targetId] : undefined;
    const fuelArrive = Math.max(0, fuel);
    let refuelled = false;
    if (!outOfFuel && !pass && canRefuelAt(game, owner, planet)) { fuel = spec.fuelCapacity; refuelled = true; }
    res.push({ index: i, dist, years: Number.isFinite(arrival) ? arrival - prevArrival : Infinity, fuel: legFuel, fuelAfter: Math.max(0, fuel), fuelArrive, refuelled, ok: !outOfFuel, outOfFuel, arrival, pass, yearEnds });
    if (Number.isFinite(arrival)) prevArrival = arrival;
    if (outOfFuel) fuel = 0;
    pos = { x: wp.x, y: wp.y };
    // 0.3.7: through a wormhole whose exit is known (and that it may cross), the route goes on from its exit
    if (wp.target === 'wormhole' && wp.targetId !== undefined) {
      const w = game.wormholes.find(x => x.id === wp.targetId);
      const exit = w && !w.sealed && canUseWormholes(owner) ? owner.intel.wormholes[w.destId] : undefined;
      if (exit && owner.intel.wormholes[w!.id]?.destId === w!.destId) pos = { x: exit.x, y: exit.y };
    }
  }
  return res;
}

/** Fuel the current route will burn: until the first refuelling stop, or the end of the route. */
export function routeFuelPreview(game: GameState, fleet: Fleet): { start: number; after: number; dry: boolean; refuelAt?: number } | null {
  if (fleet.waypoints.length < 2) return null;
  const est = estimateRoute(game, fleet);
  const spec = fleetSpec(game, fleet);
  const owner = game.players[fleet.owner];
  const start = canRefuelAt(game, owner, fleet.orbiting >= 0 ? game.planets[fleet.orbiting] : undefined) ? spec.fuelCapacity : fleet.fuel;
  let dry = false;
  for (const l of est) {
    if (!l.ok) dry = true;
    if (l.refuelled) return { start, after: l.fuelArrive, dry, refuelAt: l.index };
  }
  const last = est[est.length - 1];
  return { start, after: dry ? 0 : last.fuelArrive, dry };
}

function applyTransportEstimate(cargo: number, wp: Waypoint, cap: number): number {
  if (wp.task !== 'transport' || !wp.transport) return cargo;
  let c = cargo;
  for (const [k, o] of Object.entries(wp.transport)) {
    if (!o || k === 'fuel') continue;
    if (o.action === 'unloadAll') c = Math.max(0, c - cap); // unknown split: assume unloading clears
    else if (o.action === 'loadAll' || o.action === 'loadDunnage') c = cap;
    else if (o.action === 'loadAmount' || o.action === 'fillPercent') c = Math.min(cap, c + (o.action === 'fillPercent' ? cap * o.amount / 100 : o.amount));
    else if (o.action === 'unloadAmount') c = Math.max(0, c - o.amount);
  }
  return c;
}

/** The fastest warp (<= max) for the leg toward waypoint i that does not exhaust fuel. */
export function bestWarpForLeg(game: GameState, fleet: Fleet, i: number, maxWarp = 10): number {
  const spec = fleetSpec(game, fleet);
  const limit = Math.min(maxWarp, spec.maxSafeSpeed || 9);
  for (let w = limit; w >= 1; w--) {
    const wps = fleet.waypoints.map((x, j) => j === i ? { ...x, warp: w } : x).slice(0, i + 1);
    const est = estimateRoute(game, fleet, wps);
    if (est.every(l => l.ok)) return w;
  }
  return Math.max(1, spec.freeSpeed);
}

/** Default warp for a newly added waypoint: engine ideal speed, reduced to keep fuel. */
export function defaultWarp(game: GameState, fleet: Fleet): number {
  const spec = fleetSpec(game, fleet);
  return spec.idealSpeed || 5;
}

export function emptyCargo(): Cargo { return { ironium: 0, boranium: 0, germanium: 0, colonists: 0 }; }

export function fleetName(game: GameState, fleet: Fleet): string { return fleet.name; }

export function totalShips(fleet: Fleet): number { return fleet.tokens.reduce((a, t) => a + t.qty, 0); }

export function fleetCost(game: GameState, fleet: Fleet) {
  let c = { ironium: 0, boranium: 0, germanium: 0, resources: 0 };
  for (const { token, spec } of tokenSpecs(game, fleet)) {
    c = { ironium: c.ironium + spec.cost.ironium * token.qty, boranium: c.boranium + spec.cost.boranium * token.qty, germanium: c.germanium + spec.cost.germanium * token.qty, resources: c.resources + spec.cost.resources * token.qty };
  }
  return c;
}
