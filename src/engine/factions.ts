// Factions that are not empires (Constellations 3.4): the pirates and the invaders of the endgame crisis.
// Like the guardians, each one is a pseudo-player marked monster and dead (it never researches, scores or wins);
// unlike the guardians, their fleets move: this module gives them their orders each year.
import type { BattlePlan, Fleet, GameState, Planet, Player, RaidOrder, ShipDesign } from './types';
import { FIELDS } from './types';
import { PREDEFINED_RACES } from './race';
import { designAtTech } from './guardians';
import { type Purpose } from './design';
import { fleetSpec, distance, emptyCargo } from './fleet';

export type FactionKind = 'pirates' | 'crisis';

const FACTION: Record<FactionKind, { name: string; race: string; color: string }> = {
  pirates: { name: 'Pirates', race: 'Pirate', color: '#c97b3c' },
  crisis: { name: 'Moissonneurs', race: 'Moissonneur', color: '#ff2fb0' },
};

export const factionOf = (game: GameState, owner: number): FactionKind | undefined => game.players[owner]?.faction;
export const isEmpire = (p: Player | undefined): p is Player => !!p && !p.monster;
export const empires = (game: GameState) => game.players.filter(p => !p.monster && !p.dead);
/** A fleet that never moves (sovereignty beacon, pirate lair, the Nexus). */
export const isImmobile = (f: Fleet) => f.beaconOf !== undefined || !!f.immobile;

/** The pseudo-player of a faction (created once). Monsters are at peace among themselves, at war with every empire. */
export function ensureFaction(game: GameState, kind: FactionKind): Player {
  const found = game.players.find(p => p.faction === kind);
  if (found) return found;
  const info = FACTION[kind];
  const id = game.players.length;
  // the Harvesters build like war-mongers (dreadnoughts)
  const race = { ...PREDEFINED_RACES.Humanoid(), name: info.race, pluralName: info.name, prt: kind === 'crisis' ? 'WM' as const : 'JoaT' as const, lrts: [] };
  const plan: BattlePlan = { id: 0, name: info.name, primary: 'armed', secondary: 'any', tactic: 'maximizeDamage', attackWho: 'enemies', dumpCargo: false, retreatAt: 0 };
  const p: Player = {
    id, name: info.name, race, color: info.color, ai: 'standard', monster: true, dead: true, faction: kind,
    tech: { energy: 26, weapons: 26, propulsion: 26, construction: 26, electronics: 26, biotechnology: 26 },
    researchSpent: { energy: 0, weapons: 0, propulsion: 0, construction: 0, electronics: 0, biotechnology: 0 },
    researching: 'energy', nextField: 'same', researchPct: 0, researchLastYear: 0,
    relations: [], battlePlans: [plan], templates: [], defaultTemplate: -1, acquiredTechs: [], fleetNum: 0,
    intel: { planets: game.planets.map(pl => ({ id: pl.id })), fleets: [], tracks: {}, designs: {}, met: [], wormholes: {}, minefields: {}, packets: [], salvage: [], traders: [] },
    messages: [], scores: [], stats: { shipsBuilt: 0, shipsLost: 0, shipsDestroyed: 0, planetsColonized: 0 }, traderRewards: [], victoryMet: 0,
  };
  game.players.push(p);
  for (const o of game.players) o.relations[id] = o.id === id || o.monster ? 'friend' : 'enemy';
  p.relations = game.players.map(o => o.id === id || o.monster ? 'friend' : 'enemy');
  return p;
}

/** Technology level the galaxy has reached: the mean of each empire's three best fields. */
export function galaxyTech(game: GameState): number {
  const es = empires(game);
  if (!es.length) return 3;
  const lv = es.map(p => { const v = FIELDS.map(f => p.tech[f]).sort((a, b) => b - a); return (v[0] + v[1] + v[2]) / 3; });
  return lv.reduce((a, b) => a + b, 0) / lv.length;
}
/** The most advanced empire's level, same measure. */
export function topTech(game: GameState): number {
  const es = empires(game);
  if (!es.length) return 3;
  return Math.max(...es.map(p => { const v = FIELDS.map(f => p.tech[f]).sort((a, b) => b - a); return (v[0] + v[1] + v[2]) / 3; }));
}

/** A faction design at a technology level, made once and kept (by role and level). */
export function factionDesign(game: GameState, owner: Player, tech: number, hull: string, purpose: Purpose, name: string): ShipDesign | null {
  const t = Math.max(1, Math.min(26, Math.round(tech)));
  const key = `${owner.faction}:${purpose}:${hull}:${t}`;
  const found = game.designs.find(d => d.owner === owner.id && d.purpose === key);
  if (found) return found;
  const d = designAtTech(owner, t, hull, purpose, name);
  if (!d || !d.slots.length) return null;
  d.purpose = key; d.alien = true; d.id = game.nextId++;
  game.designs.push(d);
  return d;
}

/** A new faction fleet at a planet. */
export function spawnFleet(game: GameState, owner: Player, tokens: { designId: number; qty: number }[], at: Planet, name: string, extra: Partial<Fleet> = {}): Fleet {
  owner.fleetNum++;
  const f: Fleet = {
    id: game.nextId++, owner: owner.id, num: owner.fleetNum, name, customName: true, x: at.x, y: at.y, orbiting: at.id,
    tokens: tokens.filter(t => t.qty > 0).map(t => ({ designId: t.designId, qty: t.qty, damage: 0, qtyDamaged: 0 })), cargo: emptyCargo(), fuel: 0,
    waypoints: [{ x: at.x, y: at.y, target: 'planet', targetId: at.id, warp: 0, task: 'none' }],
    repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0, ...extra,
  };
  game.fleets.push(f);
  f.fuel = fleetSpec(game, f).fuelCapacity;
  return f;
}

/** Sends a faction fleet to a planet, at its best speed (they always have fuel: tanks are filled every year). */
export function sendTo(game: GameState, f: Fleet, pl: Planet) {
  const sp = fleetSpec(game, f);
  f.waypoints = [{ x: f.x, y: f.y, target: f.orbiting >= 0 ? 'planet' : 'space', targetId: f.orbiting >= 0 ? f.orbiting : undefined, warp: 0, task: 'none', processed: true },
    { x: pl.x, y: pl.y, target: 'planet', targetId: pl.id, warp: Math.max(4, Math.min(10, sp.idealSpeed || 6)), task: 'none' }];
}

/** Faction fleets never run dry (they live off the land); their tanks are filled at the start of each year. */
export function refuelFactions(game: GameState) {
  for (const f of game.fleets) if (game.players[f.owner]?.faction) f.fuel = fleetSpec(game, f).fuelCapacity;
}

/** Mends a share of the damage of a faction's fleets (in place, a lair repairs better). */
export function mendFaction(game: GameState, kind: FactionKind, share: number) {
  for (const f of game.fleets) {
    if (game.players[f.owner]?.faction !== kind) continue;
    const k = isImmobile(f) || f.waypoints.length <= 1 ? share : share / 3;
    for (const t of f.tokens) { t.damage = Math.floor(t.damage * (1 - k)); if (t.damage <= 0) { t.damage = 0; t.qtyDamaged = 0; } }
  }
}

/** Strength as the AI counts it: hit points × firepower (damage taken into account). */
export function fleetStrength(game: GameState, f: Fleet): number {
  const sp = fleetSpec(game, f);
  const dmg = f.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0);
  return Math.max(1, sp.armor + sp.shields - dmg) * Math.max(1, sp.powerRating);
}

/** Armed fleets of this empire in orbit of the planet (what stands between a raider and the colony). */
export function defendersAt(game: GameState, pl: Planet, empire: number): Fleet[] {
  return game.fleets.filter(f => f.owner === empire && f.x === pl.x && f.y === pl.y && f.tokens.length > 0 && fleetSpec(game, f).hasWeapons);
}

/** Damage share of a fleet (0 = intact, 1 = wrecked). */
export function damageShare(game: GameState, f: Fleet): number {
  const sp = fleetSpec(game, f);
  const dmg = f.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0);
  return sp.armor > 0 ? Math.min(1, dmg / sp.armor) : 0;
}

/** The raiders of a faction under way. */
export const raiders = (game: GameState, kind: FactionKind) => game.fleets.filter(f => f.raid?.kind === kind && f.tokens.length > 0);

/** A new raid order. */
export function raidOrder(game: GameState, kind: FactionKind, empire: number, target: number, home?: number): RaidOrder {
  return { kind, empire, target, phase: 'go', since: game.year, loot: 0, home };
}

/** The nearest world of an empire to a point (optionally among those passing a test). */
export function nearestWorldOf(game: GameState, empire: number, from: { x: number; y: number }, ok: (pl: Planet) => boolean = () => true): Planet | undefined {
  let best: Planet | undefined, bd = Infinity;
  for (const pl of game.planets) {
    if (pl.owner !== empire || !ok(pl)) continue;
    const d = distance(pl, from);
    if (d < bd) { bd = d; best = pl; }
  }
  return best;
}
