// Ship & starbase designs: derived specs, costs and an automatic designer.
import type { HullData, TechData } from '../data/types';
import type { Cost, DesignSlot, GameState, MinefieldType, Player, Race, ShipDesign, TechLevels } from './types';
import { HULLS, TECHS, hasTech, hull as getHull, partFitsSlot, playerCost, tech as getTech } from './tech';
import { raceSpec } from './race';
import { RULES_RAW } from '../data/rules-raw';
import { hasDoctrine } from './doctrines';

type Owner = { tech: TechLevels; race: Race; doctrines?: Record<string, 'a' | 'b'> };

/**
 * Constellations 3.6: the battle role a design takes when none is chosen: artillery when most of its expected damage
 * comes from torpedoes or missiles (long range, they keep their distance), the line otherwise (beams).
 */
export function autoRole(spec: { weapons: WeaponSpec[] }): 'line' | 'artillery' {
  let torp = 0, beam = 0;
  for (const w of spec.weapons) { const d = w.power * w.qty * (w.torpedo ? w.accuracy : 1); if (w.torpedo) torp += d; else beam += d; }
  return torp > beam ? 'artillery' : 'line';
}

export interface WeaponSpec {
  part: string;
  slotIndex: number;
  qty: number;
  power: number;
  range: number;
  initiative: number;
  accuracy: number;
  torpedo: boolean;
  gatling: boolean;
  sapper: boolean;
  hitsAll: boolean;
  capital: boolean;
}

export interface BombSpec { part: string; qty: number; killRate: number; minKill: number; structure: number; smart: boolean; unterraform: number }

export interface DesignSpec {
  hull: string;
  hullType: string;
  starbase: boolean;
  mass: number;
  armor: number;
  shields: number;
  fuelCapacity: number;
  cargoCapacity: number;
  initiative: number;
  engine: string | null;
  numEngines: number;
  idealSpeed: number;
  freeSpeed: number;
  maxSafeSpeed: number;
  fuelUsage: number[]; // per warp 0..10 (after IFE)
  scoop: boolean;
  radiating: boolean;
  scanRange: number; // -1 none
  scanRangePen: number; // -1 none
  cloakUnits: number;
  cloakPercent: number;
  torpedoBonus: number;
  torpedoJamming: number;
  beamBonus: number;
  beamDefense: number;
  reduceMovement: number;
  tachyons: number;
  movement: number;
  movementFull: number;
  /** battle movement bonus of the parts (overthrusters...), for the battle speed with a partial hold */
  movementBonus: number;
  mineLaying: Record<MinefieldType, number>;
  miningRate: number;
  terraformRate: number;
  bombs: BombSpec[];
  weapons: WeaponSpec[];
  hasWeapons: boolean;
  bomber: boolean;
  powerRating: number;
  colonyModule: boolean;
  orbitalConstruction: boolean;
  canStealFleet: boolean;
  canStealPlanet: boolean;
  fuelGeneration: number;
  repairBonus: number;
  /** Stars!: only one stargate counts (the last one fitted); a second adds neither mass nor range. `count` says how many are fitted */
  gate: { safeMass: number; safeRange: number; count: number } | null;
  driver: { speed: number; safeSpeed: number } | null;
  maxPop: number;
  dock: number; // 0 none, -1 unlimited
  mineSweep: number;
  cost: Cost;
  estimatedRange: number;
  /** class used by battle targeting & scores */
  rating: 'unarmed' | 'escort' | 'capital';
  canJump: boolean;
  /** Constellations 3 decoys: apparent extra mass and phantom ships per ship */
  decoyMass: number;
  decoys: number;
  /** Constellations 3.3: sovereignty beacon kits aboard (per ship) */
  beaconKits: number;
}

const cloakTable: number[] = RULES_RAW.cloakTable;
export function cloakPercent(units: number): number {
  if (units <= 0) return 0;
  if (units >= cloakTable.length) return 98;
  return cloakTable[Math.round(units)];
}

function emptyCost(): Cost { return { ironium: 0, boranium: 0, germanium: 0, resources: 0 }; }
export function addCost(a: Cost, b: Cost, mul = 1): Cost {
  return { ironium: a.ironium + b.ironium * mul, boranium: a.boranium + b.boranium * mul, germanium: a.germanium + b.germanium * mul, resources: a.resources + b.resources * mul };
}

/** Cost of one ship or new starbase for a player. */
export function designCost(player: Owner, design: { hull: string; slots: DesignSlot[]; starbase: boolean }): Cost {
  const h = getHull(design.hull);
  let total = playerCost(player, h);
  for (const s of design.slots) {
    const p = TECHS.get(s.part);
    if (!p) continue;
    let c = playerCost(player, p);
    if (design.starbase && p.cat !== 'Orbital') c = { ironium: c.ironium * 0.5, boranium: c.boranium * 0.5, germanium: c.germanium * 0.5, resources: c.resources * 0.5 };
    total = addCost(total, c, s.qty);
  }
  if (design.starbase) {
    const f = raceSpec(player.race).starbaseCostFactor;
    total = { ironium: total.ironium * f, boranium: total.boranium * f, germanium: total.germanium * f, resources: total.resources * f };
  }
  if (hasDoctrine(player, 'modular')) total.resources *= 0.88;
  return { ironium: Math.ceil(total.ironium - 1e-9), boranium: Math.ceil(total.boranium - 1e-9), germanium: Math.ceil(total.germanium - 1e-9), resources: Math.ceil(total.resources - 1e-9) };
}

/** Cost of upgrading an existing starbase (Stars! rules, approximated as in craig-stars). */
export function starbaseUpgradeCost(player: Owner, oldD: ShipDesign, newD: ShipDesign): Cost {
  return upgradeCost(player, oldD, newD, true);
}

/**
 * Constellations: cost of refitting a ship to another design of the same hull at a shipyard. Same rule as the
 * starbase upgrade (parts kept are free, parts swapped cost part of their value), with full part prices and at
 * least a tenth of the new design's resources for the work.
 */
export function refitCost(player: Owner, oldD: ShipDesign, newD: ShipDesign): Cost {
  const c = upgradeCost(player, oldD, newD, false);
  const labour = Math.ceil(designCost(player, newD).resources * 0.1 - 1e-9);
  return { ...c, resources: Math.max(c.resources, labour) };
}

function upgradeCost(player: Owner, oldD: ShipDesign, newD: ShipDesign, starbase: boolean): Cost {
  if (oldD.hull === newD.hull && JSON.stringify(oldD.slots) === JSON.stringify(newD.slots)) return emptyCost();
  const f = starbase ? raceSpec(player.race).starbaseCostFactor : 1;
  let cost = emptyCost();
  if (oldD.hull !== newD.hull) {
    cost = addCost(cost, playerCost(player, getHull(newD.hull)));
    cost = addCost(cost, playerCost(player, getHull(oldD.hull)), -0.5);
  }
  const tally = (d: ShipDesign) => { const m = new Map<string, number>(); for (const s of d.slots) m.set(s.part, (m.get(s.part) ?? 0) + s.qty); return m; };
  const oldT = tally(oldD), newT = tally(newD);
  const partCost = (name: string, qty: number) => {
    const p = getTech(name); const c = playerCost(player, p); const m = !starbase || p.cat === 'Orbital' ? 1 : 0.5;
    return { ironium: c.ironium * m * qty, boranium: c.boranium * m * qty, germanium: c.germanium * m * qty, resources: c.resources * m * qty };
  };
  const allOldInNew = [...oldT.entries()].every(([k, q]) => (newT.get(k) ?? 0) >= q);
  if (allOldInNew) {
    for (const [k, q] of newT) { const extra = q - (oldT.get(k) ?? 0); if (extra > 0) cost = addCost(cost, partCost(k, extra)); }
  } else {
    let minCost = emptyCost();
    const cats = new Set<string>();
    for (const k of [...oldT.keys(), ...newT.keys()]) cats.add(getTech(k).cat);
    for (const cat of cats) {
      let oc = emptyCost(), nc = emptyCost();
      for (const [k, q] of oldT) if (getTech(k).cat === cat) oc = addCost(oc, partCost(k, q));
      for (const [k, q] of newT) if (getTech(k).cat === cat) nc = addCost(nc, partCost(k, q));
      const keys = ['ironium', 'boranium', 'germanium', 'resources'] as const;
      for (const key of keys) {
        cost[key] += 0.7 * (nc[key] - oc[key]);
        const adj = Math.max(0.2 * nc[key], 0.3 * nc[key] - 0.1 * oc[key]);
        cost[key] += adj; minCost[key] += adj;
      }
    }
    for (const key of ['ironium', 'boranium', 'germanium', 'resources'] as const) cost[key] = Math.max(cost[key], minCost[key]);
  }
  if (hasDoctrine(player, 'modular')) cost.resources *= 0.88;
  return {
    ironium: Math.max(0, Math.ceil(cost.ironium * f - 1e-9)), boranium: Math.max(0, Math.ceil(cost.boranium * f - 1e-9)),
    germanium: Math.max(0, Math.ceil(cost.germanium * f - 1e-9)), resources: Math.max(0, Math.ceil(cost.resources * f - 1e-9)),
  };
}

export function battleSpeed(idealSpeed: number, movementBonus: number, mass: number, numEngines: number): number {
  if (numEngines === 0) return 0;
  const speed = idealSpeed + Math.ceil(movementBonus) - 2;
  const penalty = Math.trunc(Math.trunc(mass / 70) / numEngines);
  return Math.max(2, Math.min(10, speed - penalty));
}

const specCache = new Map<string, DesignSpec>();
// 3.4: cheap cache keys (the JSON of the whole race at every call took most of a late-game turn). A race object never
// changes once in a game; it is identified by reference (a reloaded game gets new objects, hence new keys).
const raceKeys = new WeakMap<object, number>();
let raceSeq = 0;
const raceKey = (r: object) => { let k = raceKeys.get(r); if (k === undefined) { k = ++raceSeq; raceKeys.set(r, k); } return k; };

export function designSpec(player: Owner, design: { hull: string; slots: DesignSlot[]; starbase: boolean }): DesignSpec {
  const t = player.tech;
  let sk = '';
  for (const s of design.slots) sk += s.slot + ':' + s.part + ':' + s.qty + ',';
  const key = design.hull + '|' + sk + '|' + t.energy + ',' + t.weapons + ',' + t.propulsion + ',' + t.construction + ',' + t.electronics + ',' + t.biotechnology + '|' + raceKey(player.race) + player.race.prt + (player.race.lrts ?? []).join('') + '|' + (player.doctrines ? JSON.stringify(player.doctrines) : '');
  const c = specCache.get(key);
  if (c) return c;
  const s = computeSpec(player, design);
  if (specCache.size > 5000) specCache.clear();
  specCache.set(key, s);
  return s;
}

function computeSpec(player: Owner, design: { hull: string; slots: DesignSlot[]; starbase: boolean }): DesignSpec {
  const rs = raceSpec(player.race);
  const h: HullData = getHull(design.hull);
  let mass = h.mass, armor = h.armor, shields = 0, fuel = h.fuel, cargo = h.cargo, init = h.init;
  let engine: TechData | null = null, numEngines = 0;
  let s4 = 0, p4 = 0, hasScanner = false, hasPen = false;
  let cloakUnits = rs.builtInCloakUnits + (design.starbase ? rs.starbaseCloakUnits : 0);
  let unarmedCloak = 0;
  const torpBonusParts: number[] = [], jamParts: number[] = [];
  let beamBonus = 1, beamDefense = 1, reduceMovement = 0, tachyons = 0, movementBonus = rs.movementBonus;
  const mineLaying: Record<MinefieldType, number> = { standard: 0, heavy: 0, speedBump: 0 };
  let miningRate = 0, terraformRate = 0;
  const bombs: BombSpec[] = [];
  const weapons: WeaponSpec[] = [];
  let colonyModule = false, orbitalConstruction = false, stealFleet = false, stealPlanet = false, canJump = false;
  let fuelGen = h.fuelGen ?? 0;
  let gate: { safeMass: number; safeRange: number; count: number } | null = null;
  let gateCount = 0;
  let bestDriver = 0, drivers: number[] = [];
  let decoyMass = 0, decoys = 0, beaconKits = 0;

  for (const slot of design.slots) {
    const p = TECHS.get(slot.part);
    if (!p || slot.qty <= 0) continue;
    const q = slot.qty;
    const st = p.stats ?? {};
    mass += (p.mass ?? 0) * q;
    if (st.armor) armor += (p.cat === 'Armor' ? Math.trunc(st.armor * rs.armorFactor) : st.armor) * q;
    if (st.shield) shields += Math.trunc(st.shield * rs.shieldFactor) * q;
    if (st.fuelBonus) fuel += st.fuelBonus * q;
    if (st.cargoBonus) cargo += st.cargoBonus * q;
    if (st.initiativeBonus) init += st.initiativeBonus * q;
    if (p.cat === 'Engine' && p.engine) { engine = p; numEngines += q; }
    if (p.cat === 'Scanner' || st.scanRange !== undefined || st.scanRangePen !== undefined) {
      if (p.cat === 'Scanner' || st.scanRange) {
        hasScanner = true;
        s4 += Math.pow(st.scanRange ?? 0, 4) * q;
      }
      if (st.scanRangePen) { hasPen = true; p4 += Math.pow(st.scanRangePen, 4) * q; }
    }
    if (st.cloakUnits) {
      if (st.cloakUnarmedOnly) unarmedCloak += st.cloakUnits * q; else cloakUnits += st.cloakUnits * q;
    }
    if (st.torpedoBonus) for (let i = 0; i < q; i++) torpBonusParts.push(st.torpedoBonus);
    if (st.torpedoJamming) for (let i = 0; i < q; i++) jamParts.push(st.torpedoJamming);
    if (st.beamBonus) beamBonus *= Math.pow(1 + st.beamBonus, q);
    if (st.beamDefense) beamDefense *= Math.pow(1 - st.beamDefense, q);
    if (st.reduceMovement) reduceMovement = Math.max(reduceMovement, st.reduceMovement);
    if (st.reduceCloaking) tachyons += q;
    if (st.movementBonus) movementBonus += st.movementBonus * q;
    if (st.mineLayingRate) {
      const t = (st.minefieldType === 'Heavy' ? 'heavy' : st.minefieldType === 'SpeedBump' ? 'speedBump' : 'standard') as MinefieldType;
      mineLaying[t] += Math.trunc(st.mineLayingRate * q * (1 + (h.mineLayingBonus ?? 0)));
    }
    if (st.miningRate) miningRate += st.miningRate * q;
    if (st.terraformRate) terraformRate += st.terraformRate * q;
    // a weapon that also bombs (Multi Contained Munition) bombs like a bomb
    if (p.cat === 'Bomb' || st.killRate || st.structureDestroyRate) bombs.push({ part: p.name, qty: q, killRate: st.killRate ?? 0, minKill: st.minKillRate ?? 0, structure: st.structureDestroyRate ?? 0, smart: !!st.smart, unterraform: st.unterraformRate ?? 0 });
    if (p.cat === 'BeamWeapon' || p.cat === 'Torpedo') {
      weapons.push({
        part: p.name, slotIndex: slot.slot, qty: q, power: st.power ?? 0, range: (st.range ?? 0) + (h.rangeBonus ?? 0),
        initiative: st.initiative ?? 0, accuracy: (st.accuracy ?? 100) / 100, torpedo: p.cat === 'Torpedo',
        gatling: !!st.gatling, sapper: !!st.damageShieldsOnly, hitsAll: !!st.hitsAllTargets, capital: !!st.capitalShipMissile,
      });
    }
    if (st.decoyMass) { decoyMass += st.decoyMass * q; decoys += q; }
    if (st.beaconKit) beaconKits += q;
    if (st.colonizationModule) colonyModule = true;
    if (st.orbitalConstructionModule) orbitalConstruction = true;
    if (st.canStealFleetCargo) stealFleet = true;
    if (st.canStealPlanetCargo) stealPlanet = true;
    if (st.fuelGeneration) fuelGen += st.fuelGeneration * q;
    if (st.canJump) canJump = true;
    if (st.safeHullMass !== undefined) { gateCount += q; gate = { safeMass: st.safeHullMass, safeRange: st.safeRange ?? 0, count: gateCount }; }
    if (st.packetSpeed) { for (let i = 0; i < q; i++) drivers.push(st.packetSpeed); bestDriver = Math.max(bestDriver, st.packetSpeed); }
  }
  const hasWeapons = weapons.length > 0;
  if (!hasWeapons) cloakUnits += unarmedCloak;
  // Constellations 3 doctrines
  if (hasDoctrine(player, 'shields')) shields = Math.trunc(shields * 1.2);
  if (hasDoctrine(player, 'armor')) armor = Math.trunc(armor * 1.2);
  if (hasDoctrine(player, 'endurance')) fuel = Math.trunc(fuel * 1.25);
  if (hasDoctrine(player, 'overcharge')) beamBonus *= 1.15;
  if (hasDoctrine(player, 'speed') && hasWeapons && !design.starbase) movementBonus += 1;
  // JoaT built-in scanner
  if (rs.joatScanner && h.builtInScanner) {
    hasScanner = true; hasPen = true;
    s4 += Math.pow(20 * player.tech.electronics, 4);
    p4 += Math.pow(10 * player.tech.electronics, 4);
  }
  const sensors = hasDoctrine(player, 'sensors') ? 1.25 : 1;
  const scanRange = hasScanner ? Math.round(Math.pow(s4, 0.25) * rs.scanRangeFactor * sensors) : -1;
  const scanRangePen = hasPen ? Math.round(Math.pow(p4, 0.25) * sensors) : -1;
  const torpedoBonus = Math.round((1 - torpBonusParts.reduce((a, b) => a * (1 - b), 1)) * 10000) / 10000;
  let torpedoJamming = 1 - jamParts.reduce((a, b) => a * (1 - b), 1);
  if (hasDoctrine(player, 'ewar')) torpedoJamming = 1 - (1 - torpedoJamming) * 0.9;
  torpedoJamming = design.starbase ? Math.min(1, torpedoJamming) * 0.75 : Math.min(0.95, torpedoJamming);
  beamBonus = Math.min(2.55, beamBonus);

  // engine stats
  const eng = engine?.engine;
  const fuelUsage = eng ? eng.fuel.map(f => Math.ceil(f * rs.fuelEfficiency * (hasDoctrine(player, 'endurance') ? 0.8 : 1) - 1e-9)) : new Array(11).fill(0);
  const idealSpeed = eng ? eng.ideal : 0;
  const movement = battleSpeed(idealSpeed, movementBonus, mass, numEngines);
  const movementFull = battleSpeed(idealSpeed, movementBonus, mass + cargo, numEngines);

  // apply beam bonus to power
  for (const w of weapons) if (!w.torpedo) w.power = Math.trunc(w.power * beamBonus);

  // power rating
  let beam = 0, torp = 0, bombR = 0;
  for (const w of weapons) {
    if (w.torpedo) torp += w.power * w.qty * (w.range - 2) / 2;
    else beam += (w.power * w.qty * (w.range + 3) / 4) / (w.sapper ? 3 : 1);
  }
  beam += beam * (Math.max(2, Math.min(10, movement)) - 6) / 10;
  for (const b of bombs) bombR += Math.trunc(b.killRate * 10 + b.structure) * b.qty * 2;
  const powerRating = Math.round(beam + torp + bombR);

  let mineSweep = 0;
  for (const w of weapons) if (!w.torpedo) mineSweep += w.qty * w.power * w.range * w.range * (w.gatling ? w.range * w.range : 1);

  const cost = designCost(player, design);
  const cloak = hasDoctrine(player, 'ewar') ? Math.min(98, cloakPercent(cloakUnits) + 10) : cloakPercent(cloakUnits);
  const estimatedRange = eng && fuelUsage[idealSpeed] > 0 ? Math.trunc(fuel / Math.ceil(mass * fuelUsage[idealSpeed] * 1000 / 20000) * 1000) : Infinity;
  drivers = drivers.filter(d => d === bestDriver);
  return {
    hull: h.name, hullType: h.type, starbase: design.starbase || h.starbase, mass, armor, shields, fuelCapacity: fuel, cargoCapacity: cargo, initiative: init,
    engine: engine?.name ?? null, numEngines, idealSpeed, freeSpeed: eng ? eng.free : 0, maxSafeSpeed: eng ? eng.maxSafe : 0, fuelUsage,
    scoop: !!eng?.scoop, radiating: !!eng?.radiating,
    scanRange, scanRangePen, cloakUnits, cloakPercent: cloak, torpedoBonus, torpedoJamming, beamBonus, beamDefense, reduceMovement, tachyons,
    movement, movementFull, movementBonus, mineLaying, miningRate, terraformRate, bombs, weapons, hasWeapons, bomber: bombs.length > 0,
    powerRating, colonyModule, orbitalConstruction, canStealFleet: stealFleet, canStealPlanet: stealPlanet, fuelGeneration: fuelGen,
    repairBonus: h.repairBonus ?? 0, gate, driver: bestDriver ? { speed: bestDriver, safeSpeed: bestDriver + drivers.length - 1 } : null,
    maxPop: h.maxPop ?? 0, dock: h.dock ?? 0, mineSweep, cost, estimatedRange,
    rating: powerRating <= 0 ? 'unarmed' : powerRating < 2000 ? 'escort' : 'capital', canJump, decoyMass, decoys, beaconKits,
  };
}

// 0.3.9.20: where each design sits in game.designs (checked on every use, rebuilt when the list has moved)
const designIndex = new WeakMap<ShipDesign[], Map<number, number>>();
export function getDesign(game: GameState, id: number): ShipDesign {
  const list = game.designs;
  let idx = designIndex.get(list);
  let i = idx?.get(id);
  if (i === undefined || list[i]?.id !== id) {
    idx = new Map();
    for (let k = 0; k < list.length; k++) if (!idx.has(list[k].id)) idx.set(list[k].id, k);
    designIndex.set(list, idx);
    i = idx.get(id);
  }
  const d = i === undefined ? undefined : list[i];
  if (!d) throw new Error('design ' + id);
  return d;
}

/**
 * 0.3.8.10: is this design a scout? By default the ships built on the Scout hull; the designer can tick or untick it
 * for any design that has a scanner (a scout without a scanner makes no sense).
 */
export function isScoutDesign(d: { hull: string; scout?: boolean }, s: { scanRange: number }): boolean {
  return s.scanRange > 0 && (d.scout ?? d.hull === 'Scout');
}

/** 0.3.9.15: no slot of a design holds more than its hull allows (the tables changed: the Super Mine Layer's armor slot). */
export function tidyDesigns(game: GameState) {
  for (const d of game.designs) {
    const h = HULLS.get(d.hull);
    if (!h) continue;
    for (const s of d.slots) { const cap = h.slots[s.slot - 1]?.cap; if (cap !== undefined && s.qty > cap) s.qty = cap; }
  }
}

export function specOf(game: GameState, designId: number): DesignSpec {
  const d = getDesign(game, designId);
  const owner = game.players[d.owner] ?? game.players[0];
  return designSpec(owner, d);
}

// ---------------------------------------------------------------- automatic designer

export type Purpose =
  | 'scout' | 'longRangeScout' | 'beaconCarrier' | 'armedScout' | 'colonizer' | 'freighter' | 'fuelFreighter' | 'miner' | 'terraformer' | 'bomber' | 'smartBomber'
  | 'beamWarship' | 'torpedoWarship' | 'startingFighter' | 'mineLayer' | 'speedMineLayer' | 'starbase' | 'starbaseHalf' | 'starterStarbase' | 'fort' | 'packetThrower' | 'stargater' | 'starterColony';

export function availableParts(player: Player): TechData[] {
  return [...TECHS.values()].filter(t => hasTech(player, t));
}
export function availableHulls(player: Player, starbase: boolean): HullData[] {
  return [...HULLS.values()].filter(h => h.starbase === starbase && hasTech(player, h));
}

function best(parts: TechData[], pred: (t: TechData) => boolean, score: (t: TechData) => number = t => t.rank): TechData | null {
  let b: TechData | null = null, bs = -Infinity;
  for (const p of parts) if (pred(p)) { const s = score(p); if (s > bs) { bs = s; b = p; } }
  return b;
}

const hasTag = (tag: string) => (t: TechData) => t.tags.includes(tag);

export function bestEngine(parts: TechData[], hullName: string, purpose?: Purpose): TechData | null {
  const engines = parts.filter(p => p.cat === 'Engine' && (!p.req.hullsAllowed || p.req.hullsAllowed.includes(hullName)));
  return best(engines, () => true, e => {
    const en = e.engine!;
    // prefer higher ideal speed; for scouts/colonizers fuel efficiency matters more
    const eff = en.fuel[en.ideal] ?? 100;
    return en.ideal * 1000 - eff + (en.scoop ? 150 : 0) + (purpose === 'colonizer' && en.free >= 6 ? 3000 : 0) - (e.cost[3] ?? 0);
  });
}

/** Builds a design for a purpose with the best parts available to the player. */
export function autoDesign(player: Player, hullName: string, purpose: Purpose, name: string): ShipDesign | null {
  const h = HULLS.get(hullName);
  if (!h) return null;
  const parts = availableParts(player);
  const fits = (t: TechData, types: string[]) => partFitsSlot(t, types, h.name);
  const slots: DesignSlot[] = [];
  let hasScanner = false, hasColony = false, hasGate = false, hasDriver = false, beams = 0, torps = 0;
  // 0.3.9.21: no radiating engine on a colony ship of a race the radiation kills (its colonists died on the way, 18 %
  // a year, and the ship reached its world empty)
  const radOk = player.race.immune[2] || raceSpec(player.race).habCenter[2] >= 85;
  const engine = h.starbase ? null : bestEngine(parts.filter(p => fits(p, ['Engine']) && (radOk || purpose !== 'colonizer' || !p.engine?.radiating)), h.name, purpose);
  const starbase = h.starbase;
  const pickFor = (types: string[], tagOrder: string[], scoreFn?: (t: TechData) => number) => {
    for (const tag of tagOrder) {
      const p = best(parts, t => fits(t, types) && t.tags.includes(tag), scoreFn);
      if (p) return p;
    }
    return null;
  };
  const beamScore = (t: TechData) => { const s = t.stats ?? {}; return (s.power ?? 0) * ((s.range ?? 0) + 3) * (s.damageShieldsOnly ? 0.3 : 1) - (t.cost[3] ?? 0) * 0.1; };
  const torpScore = (t: TechData) => { const s = t.stats ?? {}; return (s.power ?? 0) * (s.accuracy ?? 50) / 100 * ((s.range ?? 0) + 1) - (t.cost[3] ?? 0) * 0.1; };
  const armorScore = (t: TechData) => (t.stats?.armor ?? 0) - (t.mass ?? 0) * 0.5;
  const shieldScore = (t: TechData) => t.stats?.shield ?? 0;

  h.slots.forEach((slot, idx) => {
    const index = idx + 1;
    const types = slot.types;
    let part: TechData | null = null;
    let qty = slot.cap;
    if (types.includes('Engine')) { if (engine) slots.push({ slot: index, part: engine.name, qty: slot.cap }); return; }
    switch (purpose) {
      case 'scout': case 'armedScout':
        if (!hasScanner) { part = pickFor(types, ['Scanner'], t => (t.stats?.scanRangePen ?? 0) * 2 + (t.stats?.scanRange ?? 0)); if (part) hasScanner = true; }
        if (!part && purpose === 'armedScout') part = best(parts, t => fits(t, types) && t.cat === 'BeamWeapon', beamScore);
        // no extra fuel tank: early scouts must come back to refuel (long-range scouts are a design choice)
        break;
      case 'beaconCarrier':
        part = pickFor(types, ['BeaconKit']);
        if (part) qty = 1;
        break;
      case 'longRangeScout':
        // the classic opening move: a scanner and, in the general slot, the biggest fuel tank available
        if (!hasScanner && types.includes('Scanner') && !types.includes('Mechanical')) { part = pickFor(types, ['Scanner'], t => (t.stats?.scanRangePen ?? 0) * 2 + (t.stats?.scanRange ?? 0)); if (part) hasScanner = true; }
        if (!part) part = pickFor(types, ['FuelTank'], t => t.stats?.fuelBonus ?? 0);
        if (!part && !hasScanner) { part = pickFor(types, ['Scanner']); if (part) hasScanner = true; }
        break;
      case 'colonizer':
        if (!hasColony) { part = best(parts, t => fits(t, types) && (t.stats?.colonizationModule || t.stats?.orbitalConstructionModule) === true); if (part) { hasColony = true; qty = 1; } }
        if (!part) part = pickFor(types, ['CargoPod', 'FuelTank']);
        break;
      case 'freighter':
        part = pickFor(types, ['CargoPod', 'FuelTank', 'Shield']);
        break;
      case 'fuelFreighter':
        part = pickFor(types, ['FuelTank', 'Shield']);
        break;
      case 'miner':
        part = pickFor(types, ['MiningRobot']);
        if (!part) part = pickFor(types, ['FuelTank']);
        break;
      case 'terraformer':
        part = pickFor(types, ['TerraformingRobot']);
        if (!part) part = pickFor(types, ['FuelTank']);
        break;
      case 'bomber': case 'smartBomber':
        if (types.includes('Bomb')) part = best(parts, t => fits(t, types) && t.cat === 'Bomb' && (purpose === 'smartBomber' ? !!t.stats?.smart : !t.stats?.smart && !t.stats?.unterraformRate), t => (t.stats?.killRate ?? 0) * 10 + (t.stats?.structureDestroyRate ?? 0));
        if (!part) part = pickFor(types, ['Armor'], armorScore) ?? pickFor(types, ['FuelTank']);
        break;
      case 'mineLayer': case 'speedMineLayer':
        if (types.includes('MineLayer')) part = best(parts, t => fits(t, types) && t.cat === 'MineLayer' && (purpose === 'speedMineLayer' ? t.stats?.minefieldType === 'SpeedBump' : t.stats?.minefieldType !== 'SpeedBump'), t => t.stats?.mineLayingRate ?? 0);
        if (!part) part = pickFor(types, ['FuelTank']);
        break;
      case 'startingFighter':
        if (!hasScanner && types.includes('Scanner')) { part = pickFor(types, ['Scanner']); if (part) hasScanner = true; }
        if (!part && types.includes('Weapon')) {
          const b = best(parts, t => fits(t, types) && t.cat === 'BeamWeapon' && !t.stats?.damageShieldsOnly, beamScore);
          const tp = best(parts, t => fits(t, types) && t.cat === 'Torpedo', torpScore);
          if (b && tp) { if (torps > beams) { part = b; beams += qty; } else { part = tp; torps += qty; } }
          else part = b ?? tp;
        }
        if (!part) part = pickFor(types, ['Armor'], armorScore);
        break;
      case 'beamWarship': case 'torpedoWarship': case 'starbase': case 'starbaseHalf': case 'fort': {
        const wantTorp = purpose === 'torpedoWarship';
        if (types.includes('Orbital') && purpose === 'starbase' && player.race.prt === 'PP' && !hasDriver) { part = best(parts, t => fits(t, types) && t.tags.includes('MassDriver'), t => t.stats?.packetSpeed ?? 0); if (part) { hasDriver = true; qty = 1; } }
        if (types.includes('Weapon')) {
          const b = best(parts, t => fits(t, types) && t.cat === 'BeamWeapon' && !t.stats?.damageShieldsOnly && !t.stats?.gatling, beamScore);
          const tp = best(parts, t => fits(t, types) && t.cat === 'Torpedo', torpScore);
          part = wantTorp ? (tp ?? b) : (b ?? tp);
          if (purpose === 'starbaseHalf') qty = Math.max(1, Math.ceil(slot.cap / 2));
        }
        if (!part && types.includes('Shield') && !types.includes('Armor')) { part = best(parts, t => fits(t, types) && t.cat === 'Shield', shieldScore); if (purpose === 'starbaseHalf') qty = Math.max(1, Math.ceil(slot.cap / 2)); }
        if (!part && types.includes('Armor')) part = best(parts, t => fits(t, types) && t.cat === 'Armor', armorScore) ?? best(parts, t => fits(t, types) && t.cat === 'Shield', shieldScore);
        if (!part && types.includes('Shield')) part = best(parts, t => fits(t, types) && t.cat === 'Shield', shieldScore);
        if (!part && (types.includes('Electrical') || types.includes('Mechanical'))) {
          if (wantTorp) part = best(parts, t => fits(t, types) && t.tags.includes('TorpedoBonus'), t => t.stats?.torpedoBonus ?? 0);
          if (!part && !starbase) part = best(parts, t => fits(t, types) && t.tags.includes('BeamCapacitor'), t => t.stats?.beamBonus ?? 0);
          if (!part && !starbase) part = best(parts, t => fits(t, types) && t.tags.includes('ManeuveringJet'), t => t.stats?.movementBonus ?? 0);
          if (!part) part = best(parts, t => fits(t, types) && t.tags.includes('InitiativeBonus'), t => t.stats?.initiativeBonus ?? 0);
          if (!part && starbase) part = best(parts, t => fits(t, types) && t.tags.includes('BeamCapacitor'), t => t.stats?.beamBonus ?? 0);
        }
        if (!part && types.includes('Scanner') && !hasScanner) { part = pickFor(types, ['Scanner'], t => (t.stats?.scanRangePen ?? 0) + (t.stats?.scanRange ?? 0)); if (part) { hasScanner = true; qty = 1; } }
        break;
      }
      case 'packetThrower':
        if (types.includes('Orbital') && !hasDriver) { part = best(parts, t => fits(t, types) && t.tags.includes('MassDriver'), t => t.stats?.packetSpeed ?? 0); if (part) { hasDriver = true; qty = 1; } }
        break;
      case 'stargater':
        if (types.includes('Orbital') && !hasGate) { part = best(parts, t => fits(t, types) && t.tags.includes('Stargate'), t => (t.stats?.safeRange ?? 0) + (t.stats?.safeHullMass ?? 0)); if (part) { hasGate = true; qty = 1; } }
        break;
      case 'starterColony':
        break;
      case 'starterStarbase': {
        // Stars! starting starbase: half of every weapon and shield slot with the most basic beam weapon / shield
        const basicBeam = [...parts].filter(t => fits(t, types) && t.cat === 'BeamWeapon' && !t.stats?.damageShieldsOnly && !t.stats?.gatling).sort((a, b) => a.rank - b.rank || (a.cost[3] ?? 0) - (b.cost[3] ?? 0))[0];
        const basicShield = [...parts].filter(t => fits(t, types) && t.cat === 'Shield').sort((a, b) => a.rank - b.rank || (a.cost[3] ?? 0) - (b.cost[3] ?? 0))[0];
        if (types.includes('Weapon') && basicBeam) { part = basicBeam; qty = Math.ceil(slot.cap / 2); }
        else if (types.includes('Shield') && basicShield) { part = basicShield; qty = Math.ceil(slot.cap / 2); }
        break;
      }
    }
    if (!part && !starbase && !['starterColony'].includes(purpose) && (types.includes('Mechanical') || types.includes('Electrical') || types.includes('Shield') || types.includes('Scanner'))) {
      if (purpose === 'colonizer' || purpose === 'armedScout' || purpose === 'freighter' || purpose === 'fuelFreighter' || purpose === 'miner' || purpose === 'terraformer' || purpose === 'mineLayer' || purpose === 'speedMineLayer') {
        part = pickFor(types, ['FuelTank']) ?? pickFor(types, ['Shield'], shieldScore);
        if (!part && !hasScanner) { part = pickFor(types, ['Scanner']); if (part) { hasScanner = true; qty = 1; } }
      }
    }
    if (part) slots.push({ slot: index, part: part.name, qty: Math.min(qty, slot.cap) });
  });
  if (!starbase && !engine) return null;
  return { id: -1, owner: player.id, name, hull: h.name, slots, starbase, purpose, built: 0 };
}

/** Validation errors for a design (empty when valid). */
export function validateDesign(player: Player, design: { hull: string; slots: DesignSlot[]; starbase: boolean; name: string }): string[] {
  const errs: string[] = [];
  const h = HULLS.get(design.hull);
  if (!h) return ['Coque inconnue'];
  if (!hasTech(player, h)) errs.push(`Coque ${h.name} non disponible`);
  if (!design.name.trim()) errs.push('Le modèle doit porter un nom');
  h.slots.forEach((slot, i) => {
    const used = design.slots.filter(s => s.slot === i + 1);
    const total = used.reduce((a, s) => a + s.qty, 0);
    if (total > slot.cap) errs.push(`Emplacement ${i + 1} : ${total} > ${slot.cap}`);
    if (slot.req && total < slot.cap) errs.push(`L'emplacement ${i + 1} (${slot.types.join('/')}) doit être rempli entièrement (${slot.cap} composants)`);
    for (const u of used) {
      const p = TECHS.get(u.part);
      if (!p) { errs.push(`Composant inconnu ${u.part}`); continue; }
      if (!partFitsSlot(p, slot.types, h.name)) errs.push(`${p.name} ne convient pas à l'emplacement ${i + 1}`);
      if (!hasTech(player, p)) errs.push(`${p.name} n'est pas disponible`);
    }
    if (new Set(used.map(u => u.part)).size > 1) errs.push(`Emplacement ${i + 1} : un seul type de composant par emplacement`);
  });
  return errs;
}

export const HULL_NAMES_FR: Record<string, string> = {};
