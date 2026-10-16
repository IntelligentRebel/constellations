// Logistics network (Constellations 3). Instead of micro-managing freighters (the "population pump" of Stars!),
// the player sets policies: which worlds send colonists or minerals, which ones receive them. Freighters assigned to
// the network then fly the convoys by themselves. They are real fleets: raiders can intercept them, and the
// dispatcher avoids routes where enemy warships have just been seen.
import { people } from './words';
import type { Fleet, GameState, Planet, Player } from './types';
import { MINERALS } from './types';
import { fleetSpec, distance, cargoMass } from './fleet';
import { planetSpec } from './planet';
import { safeGoto } from './ai';
import { specOf } from './design';
import { capitalOf } from './empire';

export const logisticsOn = (game: GameState) => !!game.settings.logistics;
export const DEFAULT_OUT = 50;
export const DEFAULT_IN = 35;
export const DEFAULT_RESERVE = 100;
/** No convoy for less than this (kt), unless the freighter is smaller. */
const MIN_LOAD = 10;
/** Known enemy warships closer than this to a route make it unsafe (light-years). */
export const DANGER_RADIUS = 70;

/**
 * 0.3.8.6: a crowded world that sends nobody away while another of its owner's worlds still has room to grow at full
 * speed (under a quarter of its capacity). Past half its capacity, a world's growth per colonist is under half what
 * it was (Stars! crowding: (1 − p)² × 16/9 above 25 %): its colonists would grow faster elsewhere.
 */
export const CROWDED = DEFAULT_OUT / 100;
export function crowdedNoEmigration(game: GameState, player: Player, p: Planet): boolean {
  if (!logisticsOn(game) || p.owner !== player.id || p.migration?.mode === 'out') return false;
  const sp = planetSpec(game, p, player);
  if (sp.maxPop <= 0 || p.pop / sp.maxPop < CROWDED) return false;
  return game.planets.some(o => o !== p && o.owner === player.id && (() => { const so = planetSpec(game, o, player); return so.hab > 0 && so.maxPop > 0 && o.pop / so.maxPop < 0.25; })());
}

/** Once a game: the first crowded world without emigration gets a word in the reports. */
export function crowdingAdvice(game: GameState) {
  if (!logisticsOn(game)) return;
  for (const pl of game.players) {
    if (pl.ai || pl.dead || pl.hints?.includes('emigration')) continue;
    const p = game.planets.find(x => x.owner === pl.id && crowdedNoEmigration(game, pl, x));
    if (!p) continue;
    (pl.hints ??= []).push('emigration');
    const sp = planetSpec(game, p, pl);
    pl.messages.push({ year: game.year, kind: 'population', text: `La population de ${p.name} atteint ${Math.round(p.pop / sp.maxPop * 100)} % de la capacité de la planète : sa croissance ralentit nettement. Une émigration automatique pourrait être utile.`, target: { kind: 'planet', id: p.id } });
  }
}

export function emptyLogStats() { return { colonists: 0, minerals: 0, lostColonists: 0, lostMinerals: 0, convoysLost: 0, trips: 0 }; }

/** Can this fleet serve in the network (engines and cargo holds, no colony module or mining)? */
export function canServe(game: GameState, f: Fleet): boolean {
  const sp = fleetSpec(game, f);
  return sp.hasEngines && sp.cargoCapacity > 0 && !sp.colonizer && sp.miningRate === 0;
}

export function joinNetwork(game: GameState, f: Fleet): boolean {
  if (!logisticsOn(game) || !canServe(game, f)) return false;
  f.auto = 'logistics'; f.job = undefined; f.repeat = false; f.route = undefined; f.pursue = undefined; f.refuelFor = undefined;
  f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }];
  return true;
}

export function leaveNetwork(f: Fleet) {
  if (f.auto === 'logistics') f.auto = undefined;
  f.job = undefined;
}

/** Colonists (in units of 100) a planet can spare under its migration policy. */
export function colonistSurplus(game: GameState, p: Planet): number {
  if (p.owner < 0 || p.migration?.mode !== 'out') return 0;
  const sp = planetSpec(game, p);
  return Math.max(0, Math.floor((p.pop - sp.maxPop * p.migration.target / 100) / 100));
}

/** Colonists (in units of 100) a planet wants under its migration policy. */
export function colonistNeed(game: GameState, p: Planet): number {
  if (p.owner < 0 || p.migration?.mode !== 'in') return 0;
  const sp = planetSpec(game, p);
  return Math.max(0, Math.floor((sp.maxPop * p.migration.target / 100 - p.pop) / 100));
}

/**
 * 0.3.8.7: where emigrants go. First the worlds set to Immigration (up to their own threshold); then, unless the
 * player turned it off, every habitable colony without a policy that is under `upTo` % of its capacity, the emptiest
 * first (on by default for human players; the computers set their own Immigration worlds).
 */
export function autoImmigration(player: Player): { on: boolean; upTo: number } {
  return player.autoImmigration ?? { on: !player.ai, upTo: DEFAULT_IN };
}
export interface MigrationTarget { planet: Planet; need: number; auto: boolean; weight: number }
export function migrationTargets(game: GameState, player: Player): MigrationTarget[] {
  const out: MigrationTarget[] = [];
  const ai = autoImmigration(player);
  for (const p of game.planets) {
    if (p.owner !== player.id) continue;
    if (p.migration?.mode === 'in') {
      const need = colonistNeed(game, p);
      if (need > 0) out.push({ planet: p, need, auto: false, weight: 2 });
    } else if (!p.migration && ai.on) {
      const sp = planetSpec(game, p, player);
      if (sp.hab <= 0 || sp.maxPop <= 0) continue;
      const fill = p.pop / sp.maxPop, cap = ai.upTo / 100;
      if (fill >= cap) continue;
      const need = Math.floor((sp.maxPop * cap - p.pop) / 100);
      // the emptier, the more it is worth (between 1 and 1.8, under the Immigration worlds' 2)
      if (need > 0) out.push({ planet: p, need, auto: true, weight: 1 + 0.8 * (1 - fill / cap) });
    }
  }
  return out;
}

export function mineralSurplus(p: Planet): Record<'ironium' | 'boranium' | 'germanium', number> {
  const r = { ironium: 0, boranium: 0, germanium: 0 };
  if (p.owner < 0 || p.mineralPolicy?.mode !== 'export') return r;
  for (const m of MINERALS) r[m] = Math.max(0, p.surface[m] - p.mineralPolicy.reserve);
  return r;
}

/** Worlds receiving minerals: the importers, or the capital when nobody imports. */
export function mineralSinks(game: GameState, player: Player): Planet[] {
  const imp = game.planets.filter(p => p.owner === player.id && p.mineralPolicy?.mode === 'import');
  if (imp.length) return imp;
  const cap = capitalOf(game, player);
  return cap && cap.mineralPolicy?.mode !== 'export' ? [cap] : [];
}

/** Is a known enemy warship near this route? (only what the player has seen this year) */
export function routeDanger(game: GameState, player: Player, a: { x: number; y: number }, b: { x: number; y: number }): string | null {
  for (const fi of player.intel.fleets) {
    if (fi.owner === player.id) continue;
    if (fi.owner >= 0 && player.relations[fi.owner] === 'friend') continue;
    let armed = false;
    if (fi.tokens?.length) armed = fi.tokens.some(t => { try { return specOf(game, t.designId).hasWeapons; } catch { return false; } });
    else armed = (fi.mass ?? 0) >= 60; // unidentified contact of some size: assume the worst
    if (!armed) continue;
    if (segDist(fi, a, b) <= DANGER_RADIUS) return fi.owner >= 0 ? `navires des ${game.players[fi.owner].name}` : 'contact armé non identifié';
  }
  return null;
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + k * dx - p.x, a.y + k * dy - p.y);
}

export interface Flow { kind: 'colonists' | 'minerals'; from: Planet; to: Planet; amount: number; fleet: Fleet }

/** Convoys under way (for the logistics page and the map). */
export function activeFlows(game: GameState, player: Player): Flow[] {
  const res: Flow[] = [];
  for (const f of game.fleets) {
    if (f.owner !== player.id || f.auto !== 'logistics' || !f.job) continue;
    res.push({ kind: f.job.kind, from: game.planets[f.job.from], to: game.planets[f.job.to], amount: f.job.amount, fleet: f });
  }
  return res;
}

/** Text for the fleet panel. */
export function jobText(game: GameState, f: Fleet): string {
  if (f.auto !== 'logistics') return '';
  if (!f.job) return 'En attente d\'un convoi (aucun besoin ou routes dangereuses).';
  const from = game.planets[f.job.from], to = game.planets[f.job.to];
  const what = f.job.kind === 'colonists' ? `${people(game, f.job.amount * 100)} colons` : `${f.job.amount} kt de minerais`;
  const loaded = cargoMass(f.cargo) > 0;
  return loaded ? `Convoi en route : ${what} de ${from.name} vers ${to.name}.` : `Va chercher ${what} à ${from.name} pour ${to.name}.`;
}

interface Job { kind: 'colonists' | 'minerals'; from: Planet; to: Planet; amount: number; score: number }

/** Yearly dispatch: deliveries, pickups and new assignments for every network freighter. */
export function runLogistics(game: GameState) {
  if (!logisticsOn(game)) return;
  for (const player of game.players) {
    if (player.dead) continue;
    const fleets = game.fleets.filter(f => f.owner === player.id && f.auto === 'logistics');
    if (!fleets.length) continue;
    const st = player.logStats ?? (player.logStats = emptyLogStats());
    // what is already promised by convoys under way
    const outC = new Map<number, number>(), inC = new Map<number, number>();
    const outM = new Map<number, number>();
    for (const f of fleets) {
      if (!f.job || cargoMass(f.cargo) > 0) continue; // loaded convoys already took their share
      const m = f.job.kind === 'colonists' ? outC : outM;
      m.set(f.job.from, (m.get(f.job.from) ?? 0) + f.job.amount);
    }
    for (const f of fleets) if (f.job?.kind === 'colonists') inC.set(f.job.to, (inC.get(f.job.to) ?? 0) + f.job.amount);

    for (const f of fleets) {
      if (!game.fleets.includes(f)) continue;
      if (!canServe(game, f)) { leaveNetwork(f); continue; }
      const idle = f.waypoints.length <= 1;
      const here = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
      if (f.job && idle) {
        const job = f.job;
        const to = game.planets[job.to], from = game.planets[job.from];
        if (here && here.id === job.to && here.owner === player.id) {
          // delivery
          const c = f.cargo.colonists, m = f.cargo.ironium + f.cargo.boranium + f.cargo.germanium;
          if (c > 0) { here.pop += c * 100; st.colonists += c * 100; f.cargo.colonists = 0; }
          if (m > 0) { for (const k of MINERALS) { here.surface[k] += f.cargo[k]; f.cargo[k] = 0; } st.minerals += m; }
          st.trips++;
          if (job.kind === 'colonists') inC.set(job.to, Math.max(0, (inC.get(job.to) ?? 0) - job.amount));
          f.job = undefined;
        } else if (here && here.id === job.from && here.owner === player.id && cargoMass(f.cargo) === 0) {
          // pickup: load what the policy still allows, then leave for the destination
          if (to.owner === player.id) pickupNow(game, player, f, outC, outM); else f.job = undefined;
          if (f.job) continue;
        } else if (cargoMass(f.cargo) > 0) {
          // loaded but not at the destination (lost destination, interrupted trip): deliver to the nearest receiving world
          const dest = to.owner === player.id ? to : nearestOwn(game, player, f, job.kind);
          if (dest && safeGoto(game, f, { x: dest.x, y: dest.y, planetId: dest.id }, 'none', false)) { job.to = dest.id; continue; }
          f.job = undefined;
        } else if (from.owner === player.id && safeGoto(game, f, { x: from.x, y: from.y, planetId: from.id }, 'none', false)) {
          continue; // interrupted on the way to the pickup: resume
        } else f.job = undefined;
      }
      if (f.job || !idle) continue;
      if (cargoMass(f.cargo) > 0) {
        // unassigned cargo (e.g. a freighter just added to the network): drop it where it is useful
        const dest = here && here.owner === player.id ? here : nearestOwn(game, player, f, f.cargo.colonists > 0 ? 'colonists' : 'minerals');
        if (dest && here && dest.id === here.id) {
          if (f.cargo.colonists) { here.pop += f.cargo.colonists * 100; f.cargo.colonists = 0; }
          for (const k of MINERALS) { here.surface[k] += f.cargo[k]; f.cargo[k] = 0; }
        } else if (dest) { safeGoto(game, f, { x: dest.x, y: dest.y, planetId: dest.id }, 'none', false); continue; }
      }
      const job = bestJob(game, player, f, outC, inC, outM);
      if (!job) continue;
      f.job = { kind: job.kind, from: job.from.id, to: job.to.id, amount: job.amount };
      const m = job.kind === 'colonists' ? outC : outM;
      m.set(job.from.id, (m.get(job.from.id) ?? 0) + job.amount);
      if (job.kind === 'colonists') inC.set(job.to.id, (inC.get(job.to.id) ?? 0) + job.amount);
      if (here && here.id === job.from.id) {
        // already there: load at once
        f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }];
        pickupNow(game, player, f, outC, outM);
      } else if (!safeGoto(game, f, { x: job.from.x, y: job.from.y, planetId: job.from.id }, 'none', false)) {
        f.job = undefined;
      }
    }
  }
}

function pickupNow(game: GameState, player: Player, f: Fleet, outC: Map<number, number>, outM: Map<number, number>) {
  const job = f.job!;
  const here = game.planets[job.from], to = game.planets[job.to];
  const cap = fleetSpec(game, f).cargoCapacity;
  const m = job.kind === 'colonists' ? outC : outM;
  m.set(job.from, Math.max(0, (m.get(job.from) ?? 0) - job.amount));
  let loaded = 0;
  if (job.kind === 'colonists') {
    loaded = Math.min(cap, job.amount, colonistSurplus(game, here));
    if (loaded > 0) { here.pop -= loaded * 100; f.cargo.colonists += loaded; }
  } else {
    const sur = mineralSurplus(here);
    const total = MINERALS.reduce((a, k) => a + sur[k], 0);
    const room = Math.min(cap, job.amount);
    for (const k of MINERALS) { const take = total > 0 ? Math.min(sur[k], Math.floor(room * sur[k] / total)) : 0; here.surface[k] -= take; f.cargo[k] += take; loaded += take; }
    for (const k of MINERALS) { const extra = Math.min(sur[k] - f.cargo[k], room - loaded); if (extra > 0) { here.surface[k] -= extra; f.cargo[k] += extra; loaded += extra; } }
  }
  if (loaded <= 0) { f.job = undefined; return; }
  job.amount = loaded;
  if (!safeGoto(game, f, { x: to.x, y: to.y, planetId: to.id }, 'none', false)) {
    if (job.kind === 'colonists') { here.pop += f.cargo.colonists * 100; f.cargo.colonists = 0; }
    else for (const k of MINERALS) { here.surface[k] += f.cargo[k]; f.cargo[k] = 0; }
    f.job = undefined;
  }
}

function nearestOwn(game: GameState, player: Player, from: { x: number; y: number }, kind: 'colonists' | 'minerals'): Planet | null {
  let best: Planet | null = null, bd = Infinity;
  for (const p of game.planets) {
    if (p.owner !== player.id) continue;
    const pref = kind === 'colonists' ? p.migration?.mode === 'in' : p.mineralPolicy?.mode === 'import';
    const d = distance(p, from) * (pref ? 0.5 : 1);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function bestJob(game: GameState, player: Player, f: Fleet, outC: Map<number, number>, inC: Map<number, number>, outM: Map<number, number>): Job | null {
  const sp = fleetSpec(game, f);
  const cap = sp.cargoCapacity;
  const v = Math.max(1, sp.idealSpeed || 5);
  const minLoad = Math.min(MIN_LOAD, cap);
  const own = game.planets.filter(p => p.owner === player.id);
  let best: Job | null = null;
  const consider = (kind: Job['kind'], from: Planet, to: Planet, amount: number, weight: number) => {
    if (amount < minLoad || from.id === to.id) return;
    const years = (distance(f, from) + distance(from, to)) / (v * v) + 1;
    const score = amount * weight / years;
    if (best && score <= best.score) return;
    if (routeDanger(game, player, f, from) || routeDanger(game, player, from, to)) return;
    best = { kind, from, to, amount, score };
  };
  const senders = own.filter(p => p.migration?.mode === 'out');
  const receivers = senders.length ? migrationTargets(game, player) : [];
  for (const s of senders) {
    const sur = colonistSurplus(game, s) - (outC.get(s.id) ?? 0);
    if (sur < minLoad) continue;
    for (const r of receivers) {
      const need = r.need - (inC.get(r.planet.id) ?? 0);
      consider('colonists', s, r.planet, Math.min(cap, sur, need), r.weight);
    }
  }
  const exporters = own.filter(p => p.mineralPolicy?.mode === 'export');
  const sinks = mineralSinks(game, player);
  for (const e of exporters) {
    const sur = mineralSurplus(e);
    const total = sur.ironium + sur.boranium + sur.germanium - (outM.get(e.id) ?? 0);
    for (const k of sinks) consider('minerals', e, k, Math.min(cap, total), 1);
  }
  return best;
}

/** Freighters of the network and what they are doing (logistics page). */
export function networkFleets(game: GameState, player: Player): Fleet[] {
  return game.fleets.filter(f => f.owner === player.id && f.auto === 'logistics');
}

/** Ships able to join the network that are doing nothing. */
export function idleFreighters(game: GameState, player: Player): Fleet[] {
  return game.fleets.filter(f => f.owner === player.id && !f.auto && f.waypoints.length <= 1 && !f.repeat && canServe(game, f) && !f.purpose);
}
