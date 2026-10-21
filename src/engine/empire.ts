// Cost of size (Constellations 3). An empire is run from its capital and from the regional capitals it builds:
// worlds far from every seat of government lose part of their output, conquered worlds need a generation to work
// at full capacity, and losing the capital disorganises the whole empire for a few years.
import { people } from './words';
import type { GameState, Planet, Player } from './types';

/** Full efficiency within this distance of a capital (light-years). */
export const ADMIN_RADIUS = 120;
/** Beyond the radius, efficiency falls by ADMIN_LOSS for every ADMIN_STEP light-years… */
export const ADMIN_STEP = 50;
export const ADMIN_LOSS = 0.1;
/** …down to this floor. */
export const ADMIN_FLOOR = 0.5;
/** A conquered world starts at 50 % and recovers linearly over this many years. */
export const CONQUEST_YEARS = 20;
export const CONQUEST_START = 0.5;
/** Losing the capital: the whole empire works at 80 % for this many years. */
export const DISORG_YEARS = 5;
export const DISORG_FACTOR = 0.8;
/** Regional capitals: cost, minimum population, minimum distance from another capital, one per N worlds. */
export const REGIONAL_COST = { resources: 400, ironium: 60, boranium: 60, germanium: 60 };
export const REGIONAL_MIN_POP = 25_000;
export const REGIONAL_MIN_DIST = 180;
export const REGIONAL_PER_WORLDS = 5;
export const REGIONAL_MAX = 8;

export const distanceCostOn = (game: GameState) => !!game.settings.distanceCost;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The capital of a player: the stored one if still theirs, else the homeworld, else nothing. */
export function capitalOf(game: GameState, player: Player): Planet | null {
  if (player.capital !== undefined) {
    const c = game.planets[player.capital];
    if (c && c.owner === player.id) return c;
  }
  return game.planets.find(p => p.owner === player.id && p.homeworld) ?? null;
}

/** Every seat of government of a player: the capital first, then the regional capitals. */
export function seatsOf(game: GameState, player: Player): Planet[] {
  const cap = capitalOf(game, player);
  const res = cap ? [cap] : [];
  for (const p of game.planets) if (p.owner === player.id && p.regionalCapital && p !== cap) res.push(p);
  return res;
}

export interface Efficiency {
  /** product of every factor (1 = full output) */
  total: number;
  /** distance factor */
  admin: number;
  /** distance to the nearest seat of government (Infinity if none) */
  distance: number;
  nearest: Planet | null;
  /** conquered world factor */
  conquest: number;
  /** capital lost recently */
  disorg: number;
}

const FULL: Efficiency = { total: 1, admin: 1, distance: 0, nearest: null, conquest: 1, disorg: 1 };

export function adminFactor(d: number): number {
  if (d <= ADMIN_RADIUS) return 1;
  return Math.max(ADMIN_FLOOR, 1 - ADMIN_LOSS * (d - ADMIN_RADIUS) / ADMIN_STEP);
}

export function conquestFactor(game: GameState, planet: Planet): number {
  if (planet.conqueredYear === undefined) return 1;
  const k = Math.min(1, Math.max(0, (game.year - planet.conqueredYear) / CONQUEST_YEARS));
  return CONQUEST_START + (1 - CONQUEST_START) * k;
}

/** Output factor of a planet for a player (planet resources are multiplied by `total`). */
export function efficiency(game: GameState, player: Player, planet: { x: number; y: number; owner?: number; conqueredYear?: number; id?: number }): Efficiency {
  if (!distanceCostOn(game)) return FULL;
  const seats = seatsOf(game, player);
  let nearest: Planet | null = null, d = Infinity;
  for (const s of seats) { const k = dist(s, planet); if (k < d) { d = k; nearest = s; } }
  const admin = seats.length ? adminFactor(d) : 1;
  const conquest = planet.owner === player.id ? conquestFactor(game, planet as Planet) : 1;
  const disorg = player.disorgUntil !== undefined && game.year < player.disorgUntil ? DISORG_FACTOR : 1;
  return { total: admin * conquest * disorg, admin, distance: d, nearest, conquest, disorg };
}

/** Why a regional capital cannot be founded on this planet (null = it can). */
export function regionalBlocker(game: GameState, planet: Planet): string | null {
  if (!distanceCostOn(game)) return 'règle désactivée';
  if (planet.owner < 0) return 'planète inhabitée';
  const player = game.players[planet.owner];
  const cap = capitalOf(game, player);
  if (cap === planet) return 'c\'est déjà la capitale';
  if (planet.regionalCapital) return 'déjà capitale régionale';
  if (planet.pop < REGIONAL_MIN_POP) return `il faut ${people(game, REGIONAL_MIN_POP)} habitants`;
  const others = seatsOf(game, player);
  const near = others.find(s => dist(s, planet) < REGIONAL_MIN_DIST);
  if (near) return `trop près de ${near.name} (${Math.round(dist(near, planet))} al, il faut ${REGIONAL_MIN_DIST})`;
  const owned = game.planets.filter(p => p.owner === player.id).length;
  const allowed = Math.min(REGIONAL_MAX, Math.floor(owned / REGIONAL_PER_WORLDS));
  const have = others.length - (cap ? 1 : 0);
  if (have >= allowed) return allowed === 0 ? `il faut au moins ${REGIONAL_PER_WORLDS} planètes` : `limite atteinte (${have}/${allowed} : une par ${REGIONAL_PER_WORLDS} planètes)`;
  return null;
}

/** Number of regional capitals a player may have now. */
export function regionalAllowance(game: GameState, player: Player): { have: number; allowed: number } {
  const owned = game.planets.filter(p => p.owner === player.id).length;
  const have = game.planets.filter(p => p.owner === player.id && p.regionalCapital).length;
  return { have, allowed: Math.min(REGIONAL_MAX, Math.floor(owned / REGIONAL_PER_WORLDS)) };
}

/** Clears what belongs to the former owner when a planet changes hands or is abandoned. */
export function resetPlanetPolicies(planet: Planet) {
  planet.regionalCapital = undefined;
  planet.agency = undefined;
  planet.migration = undefined;
  planet.mineralPolicy = undefined;
  // 0.3.9.21: nor the sector seat or the hand kept on it (a captured seat stayed one, beyond the conqueror's quota),
  // nor where its ships went and its packets flew, nor how its production was to be used
  planet.sectorSeat = undefined;
  planet.manual = undefined;
  planet.route = undefined;
  planet.packetTarget = undefined;
  planet.leftoverOnly = false;
  planet.tpl = undefined; // (the former owner's production template)
}

/**
 * Yearly bookkeeping: a player who lost the capital moves the government to the most populous regional capital
 * (or the most populous world) and is disorganised for a few years.
 */
export function updateCapitals(game: GameState) {
  for (const player of game.players) {
    if (player.dead) continue;
    const owned = game.planets.filter(p => p.owner === player.id);
    if (!owned.length) continue;
    const stored = player.capital !== undefined ? game.planets[player.capital] : undefined;
    if (player.capital === undefined) {
      // first year with the rule (new game or older save): the homeworld, else the most populous world
      const hw = owned.find(p => p.homeworld) ?? [...owned].sort((a, b) => b.pop - a.pop)[0];
      player.capital = hw.id;
      continue;
    }
    if (stored && stored.owner === player.id) continue;
    const regional = owned.filter(p => p.regionalCapital).sort((a, b) => b.pop - a.pop)[0];
    const next = regional ?? [...owned].sort((a, b) => b.pop - a.pop)[0];
    next.regionalCapital = undefined;
    player.capital = next.id;
    if (!distanceCostOn(game)) continue;
    player.disorgUntil = game.year + DISORG_YEARS + 1; // (0.3.9.21: set after this year's production: five productions, it gave four)
    player.messages.push({ year: game.year, kind: 'warning', text: `${stored ? `La capitale ${stored.name} est perdue. ` : ''}Le gouvernement s'installe sur ${next.name} : l'empire est désorganisé pendant ${DISORG_YEARS} ans (rendement ×${DISORG_FACTOR}).`, target: { kind: 'planet', id: next.id } });
    for (const o of game.players) {
      if (o.id === player.id || o.dead || !o.intel.met.includes(player.id)) continue;
      o.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${player.name} ont perdu leur capitale${stored ? ` (${stored.name})` : ''} : leur empire est désorganisé.`, target: { kind: 'player', id: player.id } });
    }
  }
}
