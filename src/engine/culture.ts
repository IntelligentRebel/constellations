// Culture and territory (Constellations 3.3).
//
// Every colony gathers culture points year after year: its population (square root, so a crowded world does not
// drown everything), the seat of government, a station in orbit, and the cultural buildings raised there. Culture
// fades a little each year (0.5 %): a territory must be kept alive.
//
// Culture gives the colony its radiance radius, 16 al plus a term growing like the square root of the culture gathered:
// fast at first, then slower and slower, never beyond RADIUS_MAX (3.6: twice the radii of 3.3-3.5). A young colony
// shines over 30 to 40 al, a capital over about 65 al at year 10, 90 at year 25, 120 at year 50; old populous worlds
// with cultural buildings reach 100 to 180 al late in the game.
//
// At any point of space, an empire's influence is the sum, over its colonies, of (radius − distance) when positive.
// The point belongs to the empire with the greatest influence, and every colonized world always keeps a core of
// CORE_RADIUS light-years whatever the culture around it. No one can found a colony in another empire's territory:
// to take it, one has to invade it.
//
// A world surrounded by a stronger foreign culture slowly turns towards it: when the foreign influence at the world
// exceeds its owner's by more than 25 %, assimilation progresses (faster the wider the gap, at most 2 points a year,
// halved by a station in orbit), and after a few decades (25 years at the very least, about 50 when the foreign
// culture is twice as strong) the world joins the dominant empire with its population. Capitals never do; a
// world just founded, conquered or turned enjoys some years of grace.
import { people } from './words';
import { worldTaken } from './diplomacy';
import { seizeArchives } from './espionage';
import type { Fleet, GameState, Planet, Player, ShipDesign } from './types';
import { autoDesign, specOf } from './design';
import { TECHS, hasTech } from './tech';
import { addDesign } from './newgame';
import { fleetSpec } from './fleet';
import { govBonus } from './governors';

export const RADIUS_MAX = 180;
export const CORE_RADIUS = 2;
export const CULTURE_DECAY = 0.005;
export const START_COLONY = 5;
export const START_HOMEWORLD = 60;
/** assimilation points needed for a world to change hands */
export const ASSIM_NEEDED = 50;
/** the foreign influence must exceed the owner's by this factor before assimilation starts */
export const ASSIM_THRESHOLD = 1.25;
export const GRACE_COLONY = 15, GRACE_CONQUEST = 25;
/** radius of the territory a sovereignty beacon claims around its world */
export const BEACON_RADIUS = 50;

export type CultureBuildingId = 'center' | 'university' | 'holonet';
export interface CultureBuilding { id: CultureBuildingId; name: string; perYear: number; req: Partial<Record<'energy' | 'weapons' | 'propulsion' | 'construction' | 'electronics' | 'biotechnology', number>>; cost: { ironium: number; boranium: number; germanium: number; resources: number }; text: string }

export const CULTURE_BUILDINGS: CultureBuilding[] = [
  { id: 'center', name: 'Centre culturel', perYear: 2, req: { biotechnology: 4 }, cost: { ironium: 20, boranium: 0, germanium: 20, resources: 200 }, text: 'Bibliothèques, théâtres et archives : +2 points de culture par an.' },
  { id: 'university', name: 'Université planétaire', perYear: 4, req: { electronics: 9, biotechnology: 7 }, cost: { ironium: 40, boranium: 20, germanium: 40, resources: 500 }, text: 'Le savoir attire étudiants et chercheurs de toute la région : +4 points de culture par an.' },
  { id: 'holonet', name: 'Réseau holographique', perYear: 8, req: { electronics: 15, energy: 12 }, cost: { ironium: 60, boranium: 60, germanium: 120, resources: 1200 }, text: 'Divertissement et information diffusés à des années-lumière : +8 points de culture par an.' },
];
export const CULTURE_BUILDING = Object.fromEntries(CULTURE_BUILDINGS.map(b => [b.id, b])) as Record<CultureBuildingId, CultureBuilding>;
/** Patronage (mécénat): resources turned into culture points at once, repeatable (the late-game outlet). */
export const PATRONAGE = { cost: { ironium: 0, boranium: 0, germanium: 0, resources: 100 }, points: 3, req: { biotechnology: 4 } };

export const cultureOn = (game: GameState) => !!game.settings.culture;

export function hasReq(p: Player, req: CultureBuilding['req']): boolean {
  return (Object.entries(req) as [keyof Player['tech'], number][]).every(([f, l]) => p.tech[f] >= l);
}
export const reqText = (req: CultureBuilding['req']) => {
  const N: Record<string, string> = { energy: 'Énergie', weapons: 'Armement', propulsion: 'Propulsion', construction: 'Construction', electronics: 'Électronique', biotechnology: 'Biotechnologie' };
  return Object.entries(req).map(([f, l]) => `${N[f]} ${l}`).join(', ');
};

export function isCapital(game: GameState, pl: Planet): boolean {
  const owner = game.players[pl.owner];
  return !!owner && (owner.capital === pl.id || (owner.capital === undefined && pl.homeworld));
}

/** Radiance radius of a culture total (ly). */
export function radiusOf(culture: number): number {
  return Math.min(RADIUS_MAX, 2 * (8 + 2.2 * Math.sqrt(Math.max(0, culture))));
}
export function radius(pl: Planet): number { return pl.owner >= 0 ? Math.max(CORE_RADIUS, radiusOf(pl.culture ?? 0)) : 0; }

/** Culture gathered by a colony this year, with its parts. */
export function cultureGain(game: GameState, pl: Planet): { total: number; pop: number; capital: number; station: number; buildings: number } {
  if (pl.owner < 0) return { total: 0, pop: 0, capital: 0, station: 0, buildings: 0 };
  // a small base (the life of any colony) plus the population, square root so a crowded world does not drown all
  const pop = 0.5 + 1.4 * Math.sqrt(Math.max(0, pl.pop) / 10000);
  const capital = isCapital(game, pl) ? 3 : 0;
  const station = pl.starbase ? 0.5 : 0;
  const buildings = (pl.cultureBld ?? []).reduce((a, id) => a + (CULTURE_BUILDING[id as CultureBuildingId]?.perYear ?? 0), 0);
  // 0.3.9: a governor with the talent of patron
  const pat = game.settings.governors ? 1 + govBonus(game, pl, 'patron') : 1;
  return { total: (pop + capital + station + buildings) * pat, pop, capital, station, buildings };
}

// ---------------------------------------------------------------- influence and territory

/** Colonies (with their radius) that project culture, optionally restricted to what a player knows. */
interface Source { x: number; y: number; r: number; owner: number; id: number; beacon?: boolean }
function sources(game: GameState, viewer?: Player): Source[] {
  const out: Source[] = [];
  for (const pl of game.planets) {
    if (pl.owner < 0) continue;
    if (viewer && pl.owner !== viewer.id && (viewer.intel.planets[pl.id]?.owner ?? -1) !== pl.owner) continue;
    out.push({ x: pl.x, y: pl.y, r: radius(pl), owner: pl.owner, id: pl.id });
  }
  // sovereignty beacons claim their world and a little space around it
  for (const f of game.fleets) {
    if (f.beaconOf === undefined || !f.tokens.length) continue;
    if (viewer && f.owner !== viewer.id && !viewer.intel.fleets.some(x => x.id === f.id && x.owner === f.owner)) continue;
    const pl = game.planets[f.beaconOf];
    out.push({ x: pl.x, y: pl.y, r: BEACON_RADIUS, owner: f.owner, id: -1 - f.id, beacon: true });
  }
  return out;
}

/** Influence of every empire at a point. */
export function influenceAt(game: GameState, at: { x: number; y: number }, srcs = sources(game)): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of srcs) {
    const d = Math.hypot(s.x - at.x, s.y - at.y);
    if (d >= s.r) continue;
    m.set(s.owner, (m.get(s.owner) ?? 0) + (s.r - d));
  }
  return m;
}

/** Who holds a point of space (−1: nobody). A colonized world always holds its core. */
export function territoryOwner(game: GameState, at: { x: number; y: number }, srcs = sources(game)): number {
  for (const s of srcs) if (Math.hypot(s.x - at.x, s.y - at.y) <= CORE_RADIUS) return s.owner;
  let best = -1, bi = 0, tie = false;
  for (const [o, v] of influenceAt(game, at, srcs)) {
    if (v > bi + 1e-9) { best = o; bi = v; tie = false; } else if (Math.abs(v - bi) <= 1e-9) tie = true;
  }
  return tie ? -1 : best;
}

/** Territory as a player sees it (colonies they know of). */
export function knownTerritoryOwner(game: GameState, viewer: Player, at: { x: number; y: number }): number {
  return territoryOwner(game, at, sources(game, viewer));
}

/** Can this player found a colony on the planet? (null: yes; otherwise the empire whose territory it is) */
export function colonyBlocker(game: GameState, player: Player, pl: Planet, known = false): number | null {
  if (!cultureOn(game)) return null;
  const o = known ? knownTerritoryOwner(game, player, pl) : territoryOwner(game, pl);
  return o >= 0 && o !== player.id ? o : null;
}

/** Grid of territory for the map (owner per cell, −1 nobody), from what the viewer knows. Cached per year. */
let gridCache: { key: string; grid: Int16Array; cols: number; rows: number; cell: number } | null = null;
export function territoryGrid(game: GameState, viewer: Player): { grid: Int16Array; cols: number; rows: number; cell: number } {
  const srcs = sources(game, viewer);
  const key = `${game.settings.seed}|${game.year}|${viewer.id}|${srcs.length}|${srcs.reduce((a, s) => a + s.r * 7 + s.owner * 13 + s.id, 0).toFixed(1)}`;
  if (gridCache && gridCache.key === key) return gridCache;
  const cell = Math.max(3, Math.round(Math.max(game.width, game.height) / 260));
  const cols = Math.ceil(game.width / cell), rows = Math.ceil(game.height / cell);
  const grid = new Int16Array(cols * rows).fill(-1);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const at = { x: (i + 0.5) * cell, y: (j + 0.5) * cell };
    grid[j * cols + i] = territoryOwner(game, at, srcs);
  }
  gridCache = { key, grid, cols, rows, cell };
  return gridCache;
}

/**
 * Signed territory field for drawing smooth borders (3.3.2): for each empire, at the vertices of a grid, a value
 * positive inside its territory and negative outside, crossing zero exactly on the border (the edge of its discs, or
 * where a rival's influence takes over). The map traces the zero line with marching squares, so borders are smooth
 * curves at any zoom. Built from what the viewer knows, cached per year.
 */
export interface TerritoryField { cols: number; rows: number; cell: number; owners: number[]; fields: Float32Array[]; key: string }
let fieldCache: TerritoryField | null = null;
export function territoryField(game: GameState, viewer: Player): TerritoryField {
  const srcs = sources(game, viewer);
  const key = `${game.settings.seed}|${game.year}|${viewer.id}|${srcs.length}|${srcs.reduce((a, s) => a + s.r * 7 + s.owner * 13 + s.id, 0).toFixed(1)}`;
  if (fieldCache && fieldCache.key === key) return fieldCache;
  const cell = Math.max(2, Math.round(Math.max(game.width, game.height) / 320));
  const cols = Math.ceil(game.width / cell), rows = Math.ceil(game.height / cell);
  const W = cols + 1, n = W * (rows + 1);
  const owners = [...new Set(srcs.map(s => s.owner))].sort((a, b) => a - b);
  const idx = new Map(owners.map((o, i) => [o, i]));
  const I = owners.map(() => new Float32Array(n));
  const M = owners.map(() => new Float32Array(n).fill(-1e3));
  for (const s of srcs) {
    const k0 = idx.get(s.owner)!, reach = s.r + 2 * cell;
    const i0 = Math.max(0, Math.floor((s.x - reach) / cell)), i1 = Math.min(cols, Math.ceil((s.x + reach) / cell));
    const j0 = Math.max(0, Math.floor((s.y - reach) / cell)), j1 = Math.min(rows, Math.ceil((s.y + reach) / cell));
    const Ik = I[k0], Mk = M[k0];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = s.r - Math.hypot(i * cell - s.x, j * cell - s.y), k = j * W + i;
      if (v > 0) Ik[k] += v;
      if (v > Mk[k]) Mk[k] = v;
    }
  }
  const fields = owners.map(() => new Float32Array(n));
  for (let k = 0; k < n; k++) {
    let t1 = 0, t2 = 0, o1 = -1;
    for (let e = 0; e < owners.length; e++) { const v = I[e][k]; if (v > t1) { t2 = t1; t1 = v; o1 = e; } else if (v > t2) t2 = v; }
    for (let e = 0; e < owners.length; e++) {
      const ie = I[e][k];
      const other = e === o1 ? t2 : t1;
      fields[e][k] = ie > 0 ? Math.min(M[e][k], ie - other) : M[e][k];
    }
  }
  // the core of every colonized world (and beacon) belongs to its owner whatever the influence around
  for (const s of srcs) {
    const reach = CORE_RADIUS + 2 * cell;
    const i0 = Math.max(0, Math.floor((s.x - reach) / cell)), i1 = Math.min(cols, Math.ceil((s.x + reach) / cell));
    const j0 = Math.max(0, Math.floor((s.y - reach) / cell)), j1 = Math.min(rows, Math.ceil((s.y + reach) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * cell - s.x, j * cell - s.y), k = j * W + i;
      for (let e = 0; e < owners.length; e++) {
        if (owners[e] === s.owner) fields[e][k] = Math.max(fields[e][k], CORE_RADIUS - d);
        else fields[e][k] = Math.min(fields[e][k], d - CORE_RADIUS);
      }
    }
  }
  fieldCache = { cols, rows, cell, owners, fields, key };
  return fieldCache;
}

// ---------------------------------------------------------------- yearly update

/** Culture of the worlds when the rule is switched on during a game: as if it had always been there. */
export function initCulture(game: GameState) {
  for (const pl of game.planets) {
    if (pl.owner < 0) { pl.culture = 0; pl.cultureOwner = -1; continue; }
    const age = Math.max(0, game.year - (pl.colonizedYear ?? 2400));
    const g = cultureGain(game, pl).total;
    // the sum of a decaying yearly gain over `age` years
    const c = g * (1 - Math.pow(1 - CULTURE_DECAY, age)) / CULTURE_DECAY;
    pl.culture = Math.max(pl.homeworld && age >= 0 ? START_HOMEWORLD : START_COLONY, c * 0.8);
    pl.cultureOwner = pl.owner;
  }
}

/** Assimilation estimate for an owned world: who presses on it, how fast, how long before it turns. */
export function assimilation(game: GameState, pl: Planet, srcs = sources(game)): { by: number; ratio: number; rate: number; years: number; immune?: string } {
  const none = { by: -1, ratio: 0, rate: 0, years: Infinity };
  if (pl.owner < 0) return none;
  if (isCapital(game, pl)) return { ...none, immune: 'capitale' };
  const inf = influenceAt(game, pl, srcs.filter(s => !s.beacon));
  const own = Math.max(inf.get(pl.owner) ?? 0, radius(pl));
  let by = -1, best = 0;
  for (const [o, v] of inf) if (o !== pl.owner && !game.players[o]?.monster && v > best) { best = v; by = o; }
  if (by < 0) return none;
  const ratio = best / own;
  let rate = ratio > ASSIM_THRESHOLD ? Math.min(2, (ratio - ASSIM_THRESHOLD) * 1.25) : 0;
  if (pl.starbase) rate *= 0.5;
  const grace = pl.cultureGrace !== undefined && game.year < pl.cultureGrace;
  const left = ASSIM_NEEDED - (pl.assim?.by === by ? pl.assim.progress : 0);
  return { by, ratio, rate: grace ? 0 : rate, years: rate > 0 ? Math.ceil(left / rate) + (grace ? pl.cultureGrace! - game.year : 0) : Infinity, immune: grace ? `répit jusqu'en ${pl.cultureGrace}` : undefined };
}

const msg = (game: GameState, p: Player, text: string, planetId: number, kind: 'event' | 'warning' = 'event') =>
  p.messages.push({ year: game.year, kind, text, target: { kind: 'planet', id: planetId } });

/** A world joins the empire whose culture dominates it. */
function turnOver(game: GameState, pl: Planet, to: number) {
  const from = game.players[pl.owner], dest = game.players[to];
  worldTaken(game, from.id, to, 'assimilation');
  seizeArchives(game, to, from.id, pl);
  pl.owner = to;
  pl.queue = [];
  pl.regionalCapital = undefined; pl.migration = undefined; pl.mineralPolicy = undefined;
  pl.colonizedYear = game.year; pl.conqueredYear = undefined;
  pl.culture = (pl.culture ?? 0) * 0.5;
  pl.cultureOwner = to;
  pl.cultureGrace = game.year + GRACE_CONQUEST;
  pl.assim = undefined;
  if (pl.starbase) {
    // the station's crew turns too: the design is copied for the new owner
    const d = game.designs.find(x => x.id === pl.starbase!.designId);
    if (d) {
      let copy = game.designs.find(x => x.owner === to && x.alien && x.name === d.name && x.hull === d.hull && JSON.stringify(x.slots) === JSON.stringify(d.slots));
      if (!copy) { copy = { ...JSON.parse(JSON.stringify(d)), id: game.nextId++, owner: to, alien: true, built: 0 }; game.designs.push(copy!); }
      pl.starbase.designId = copy!.id;
    } else pl.starbase = null;
  }
  from.stats.planetsLost = (from.stats.planetsLost ?? 0) + 1;
  dest.stats.culturalGains = (dest.stats.culturalGains ?? 0) + 1;
  if (dest.defaultTemplate >= 0) for (const t of dest.templates.filter(x => x.id === dest.defaultTemplate)) for (const it of t.items) pl.queue.push({ kind: it.kind, designId: it.designId, qty: it.qty, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } });
  if (!from.ai) msg(game, from, `Votre colonie ${pl.name} a rejoint les ${dest.name} : leur culture dominait la région depuis des années. Sa population (${people(game, pl.pop)} habitants) les suit.`, pl.id, 'warning');
  if (!dest.ai) msg(game, dest, `${pl.name}, colonie des ${from.name} baignée dans votre culture, demande à rejoindre votre empire : elle est désormais à vous, avec ${people(game, pl.pop)} habitants.`, pl.id);
}

/** Yearly: culture gathered, then assimilation of the worlds under foreign influence. */
export function runCulture(game: GameState) {
  if (!cultureOn(game)) return;
  if (game.planets.some(pl => pl.owner >= 0 && pl.cultureOwner === undefined)) initCulture(game);
  for (const pl of game.planets) {
    if (pl.cultureOwner !== pl.owner) {
      // the world changed hands during the year
      if (pl.owner < 0) { pl.culture = 0; pl.assim = undefined; pl.cultureGrace = undefined; }
      else if (pl.conqueredYear === game.year) { pl.culture = (pl.culture ?? 0) * 0.5; pl.cultureGrace = game.year + GRACE_CONQUEST; pl.assim = undefined; }
      else { pl.culture = START_COLONY; pl.cultureGrace = game.year + GRACE_COLONY; pl.assim = undefined; }
      pl.cultureOwner = pl.owner;
    }
    if (pl.owner < 0) continue;
    pl.culture = (pl.culture ?? START_COLONY) * (1 - CULTURE_DECAY) + cultureGain(game, pl).total;
  }
  const srcs = sources(game);
  for (const pl of game.planets) {
    if (pl.owner < 0) continue;
    const owner = game.players[pl.owner];
    if (owner.monster) continue;
    const a = assimilation(game, pl, srcs);
    if (a.by < 0 || a.rate <= 0) {
      if (pl.assim) { pl.assim.progress -= 2; if (pl.assim.progress <= 0) pl.assim = undefined; }
      continue;
    }
    if (!pl.assim || pl.assim.by !== a.by) pl.assim = { by: a.by, progress: 0 };
    const before = pl.assim.progress;
    pl.assim.progress += a.rate;
    const p = pl.assim.progress, other = game.players[a.by];
    if (before === 0 && !owner.ai) msg(game, owner, `La culture des ${other.name} domine autour de ${pl.name} : ses habitants commencent à se tourner vers eux (${a.years <= 150 ? `bascule estimée dans ${a.years} ans` : 'à ce rythme, la bascule prendrait plus d\'un siècle'}). Un centre culturel, du mécénat ou une station en orbite ralentissent le mouvement ; conquérir les mondes voisins l'arrête.`, pl.id, 'warning');
    for (const t of [0.5, 0.8]) if (before < ASSIM_NEEDED * t && p >= ASSIM_NEEDED * t) {
      if (!owner.ai) msg(game, owner, `${pl.name} glisse vers les ${other.name} : assimilation à ${Math.round(t * 100)} % (encore ${Math.max(1, Math.ceil((ASSIM_NEEDED - p) / a.rate))} ans environ).`, pl.id, 'warning');
      if (!other.ai && t === 0.8) msg(game, other, `${pl.name}, colonie des ${owner.name}, est presque gagnée par votre culture (${Math.round(t * 100)} %).`, pl.id);
    }
    if (p >= ASSIM_NEEDED) turnOver(game, pl, a.by);
  }
}

/** Worlds of a player under foreign cultural pressure, and foreign worlds their culture is winning over. */
export function cultureFronts(game: GameState, me: Player): { ours: { pl: Planet; by: number; progress: number; years: number }[]; theirs: { pl: Planet; progress: number; years: number }[] } {
  const srcs = sources(game);
  const ours: { pl: Planet; by: number; progress: number; years: number }[] = [];
  const theirs: { pl: Planet; progress: number; years: number }[] = [];
  for (const pl of game.planets) {
    if (pl.owner < 0) continue;
    if (pl.owner === me.id) {
      const a = assimilation(game, pl, srcs);
      if (a.by >= 0 && (a.rate > 0 || (pl.assim?.progress ?? 0) > 0)) ours.push({ pl, by: a.by, progress: pl.assim?.progress ?? 0, years: a.years });
    } else if (pl.assim?.by === me.id && (me.intel.planets[pl.id]?.owner ?? -1) === pl.owner) {
      const a = assimilation(game, pl, srcs);
      theirs.push({ pl, progress: pl.assim.progress, years: a.years });
    }
  }
  return { ours: ours.sort((a, b) => b.progress - a.progress), theirs: theirs.sort((a, b) => b.progress - a.progress) };
}


// ---------------------------------------------------------------- remote mining and sovereignty beacons

/**
 * Remote mining in another empire's territory: allowed at war or when neutral towards it, not between friends
 * (you do not dig in your allies' backyard). Returns the empire whose territory forbids it, or null.
 */
export function miningBlocker(game: GameState, player: Player, pl: Planet, known = false): number | null {
  if (!cultureOn(game) || pl.owner >= 0) return null;
  const o = known ? knownTerritoryOwner(game, player, pl) : territoryOwner(game, pl);
  return o >= 0 && o !== player.id && player.relations[o] === 'friend' ? o : null;
}

/** The beacon standing over a planet, if any. */
export function beaconAt(game: GameState, planetId: number): Fleet | undefined {
  return game.fleets.find(f => f.beaconOf === planetId && f.tokens.length > 0);
}

/** Why a fleet could not set up a beacon at this planet (null: it can). */
export function beaconBlocker(game: GameState, f: Fleet, pl: Planet): string | null {
  const p = game.players[f.owner];
  if (!cultureOn(game)) return 'la règle « Culture et territoires » n\'est pas active';
  if (fleetSpec(game, f).beaconKits <= 0) return 'aucun kit de balise à bord';
  if (pl.owner >= 0) return 'la planète est déjà colonisée';
  if (game.guardians?.some(g => g.alive && g.planetId === pl.id)) return 'un gardien veille sur ce monde';
  // 3.4: a pirate lair, the Breach of the crisis
  if (game.fleets.some(x => x.immobile && x.orbiting === pl.id && x.tokens.length > 0 && game.players[x.owner]?.faction)) return game.crisis?.planetId === pl.id ? 'la Brèche des Moissonneurs s\'ouvre ici' : 'un repaire pirate occupe ce monde';
  if (game.crisis?.planetId === pl.id && game.crisis.phase === 'omen') return 'la Brèche des Moissonneurs va s\'ouvrir ici';
  const b = beaconAt(game, pl.id);
  if (b) return b.owner === f.owner ? 'votre balise y est déjà' : `une balise des ${game.players[b.owner].name} s'y dresse déjà`;
  const o = colonyBlocker(game, p, pl);
  if (o !== null) return `la planète est dans le territoire des ${game.players[o].name}`;
  const have = game.fleets.filter(x => x.owner === p.id && x.beaconOf !== undefined).length;
  const max = beaconAllowance(game, p);
  if (have >= max) return `vous avez déjà ${have} balise${have > 1 ? 's' : ''}, le maximum (une par colonie, au moins deux)`;
  return null;
}

/** How many beacons an empire may keep: one per colony, at least two (no carpet of claims). */
export function beaconAllowance(game: GameState, p: Player): number {
  return Math.max(2, game.planets.filter(pl => pl.owner === p.id).length);
}

/** The fort a player's beacons become (the best armed Orbital Fort they can design), made when first needed. */
export function beaconDesign(game: GameState, p: Player): ShipDesign | null {
  const d = autoDesign(p, 'Orbital Fort', 'fort', '');
  if (!d) return null;
  const same = game.designs.find(x => x.owner === p.id && x.purpose === 'beacon' && x.hull === d.hull && JSON.stringify(x.slots) === JSON.stringify(d.slots));
  if (same) return same;
  const n = game.designs.filter(x => x.owner === p.id && x.purpose === 'beacon').length;
  d.purpose = 'beacon';
  d.name = n ? `Balise de souveraineté ${n + 1}` : 'Balise de souveraineté';
  return addDesign(game, d);
}

/** One ship carrying a kit is turned into a beacon in orbit of the planet. Returns the beacon fleet. */
export function plantBeacon(game: GameState, f: Fleet, pl: Planet): Fleet | null {
  const p = game.players[f.owner];
  const why = beaconBlocker(game, f, pl);
  const say = (text: string, target?: Fleet) => { if (!p.ai) p.messages.push({ year: game.year, kind: 'fleet', text, target: target ? { kind: 'fleet', id: target.id } : { kind: 'planet', id: pl.id } }); };
  if (why) { say(`${f.name} ne peut pas poser de balise à ${pl.name} : ${why}.`, f); return null; }
  const d = beaconDesign(game, p);
  if (!d) { say(`${f.name} ne peut pas poser de balise : aucun fort orbital n'est concevable.`, f); return null; }
  // the ship that carries the kit is used up
  const tok = f.tokens.find(t => specOf(game, t.designId).beaconKits > 0)!;
  tok.qty -= 1;
  if (tok.qtyDamaged > tok.qty) tok.qtyDamaged = tok.qty;
  f.tokens = f.tokens.filter(t => t.qty > 0);
  if (!f.tokens.length) game.fleets.splice(game.fleets.indexOf(f), 1);
  p.fleetNum++;
  const b: Fleet = {
    id: game.nextId++, owner: p.id, num: p.fleetNum, name: `Balise de ${pl.name}`, customName: true, x: pl.x, y: pl.y, orbiting: pl.id,
    tokens: [{ designId: d.id, qty: 1, damage: 0, qtyDamaged: 0 }], cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 }, fuel: 0,
    waypoints: [{ x: pl.x, y: pl.y, target: 'planet', targetId: pl.id, warp: 0, task: 'none', processed: true }], repeat: false, battlePlan: 0,
    heading: null, lastWarp: 0, age: 0, purpose: 'beacon', beaconOf: pl.id,
  };
  game.fleets.push(b);
  d.built = (d.built ?? 0) + 1;
  say(`Balise de souveraineté posée à ${pl.name} : le monde et ${BEACON_RADIUS} al autour sont à vous tant qu'elle tient. Pour coloniser ici, un autre empire devra d'abord la détruire.`, b);
  return b;
}

/** When the owner settles the world, the beacon becomes its orbital station (if it has none). */
export function beaconToStation(game: GameState, pl: Planet) {
  const b = beaconAt(game, pl.id);
  if (!b) return;
  if (b.owner === pl.owner && !pl.starbase) pl.starbase = { designId: b.tokens[0].designId, damage: b.tokens[0].damage * b.tokens[0].qtyDamaged };
  game.fleets.splice(game.fleets.indexOf(b), 1);
}

/** Players get a ready-made beacon carrier (scout hull, best engine, the kit) once the kit is researched. */
export function ensureBeaconCarrier(game: GameState, p: Player): ShipDesign | null {
  if (!cultureOn(game) || p.ai || p.monster) return null;
  const kit = TECHS.get('Sovereignty Beacon');
  if (!kit || !hasTech(p, kit)) return null;
  if (game.designs.some(d => d.owner === p.id && d.purpose === 'beaconCarrier' && !d.deleted)) return null;
  const label = 'Porte-balise'; // a variable: the extractor skips autoDesign's arguments
  const d = autoDesign(p, 'Scout', 'beaconCarrier', label);
  if (!d || !d.slots.some(x => x.part === kit.name)) return null;
  d.purpose = 'beaconCarrier';
  addDesign(game, d);
  p.messages.push({ year: game.year, kind: 'research', text: `Kit de balise de souveraineté maîtrisé : un modèle « Porte-balise » est prêt. Envoyé en orbite d'un monde libre, il y pose un fort qui revendique ce monde et ${BEACON_RADIUS} al autour.`, target: { kind: 'design', id: d.id } });
  return d;
}
