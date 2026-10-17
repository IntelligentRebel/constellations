// Computer players, 0.3.9.14 (aiskill.ts says which level does what). The ships of a design overtaken by a better one
// are refitted at the yards, stations are replaced, the worlds are defended against the enemy fleets that come for
// them, the warships are kept together at a few hubs, research follows what the empire lacks (terraforming when the
// worlds within reach are just out of its range, weapons and armour when the enemy's are ahead), warships are designed
// against the enemy's fleet, colony ships with nowhere to go are put to use, and worlds that sit on years of minerals
// stop building mines.
import type { Field, Fleet, GameState, Planet, Player, ShipDesign } from './types';
import { FIELDS } from './types';
import { aiCan, aiOff } from './aiskill';
import { pendingRefit, refitTargets, refitFree, refitUnitCost, queueRefit, refitBlocker } from './refit';
import { designSpec, specOf, starbaseUpgradeCost } from './design';
import { planetSpec, terraformAbility } from './planet';
import { fleetSpec, distance, canRefuelAt } from './fleet';
import { fleetStrength } from './factions';
import { estimateTrajectory } from './scan';
import { mergeFleets, transferWithPlanet } from './tasks';
import { zeroCost, isAuto } from './production';
import { raceSpec } from './race';
import { etaYears } from './pirates';
import { researchCost } from './research';
import { safeGoto, travel, roleDesign, colonyTargets } from './ai';

/** Busy: guarding a world, or waiting in orbit for a refit (nothing else may send it away). */
export function busy(game: GameState, f: Fleet): boolean {
  return (!!f.aiGuard && f.aiGuard.until >= game.year) || pendingRefit(game, f) !== null;
}

/** Strength of a design: what it takes (armour, shields) times what it deals. */
const might = (p: Player, d: ShipDesign) => { const s = designSpec(p, d); return Math.max(1, s.armor + s.shields) * Math.max(1, s.powerRating); };
/** The role of a design, refit-only designs included ('warship:refit' is a warship). */
export const baseRole = (d: ShipDesign | undefined) => d?.purpose?.split(':')[0];

// ------------------------------------------------------------------------------------------------ refits, stations

/** A warship is refitted when the new design is clearly stronger; anything else once its design is withdrawn. */
const REFIT_GAIN = 1.2;
const REFIT_ROLES = new Set(['warship', 'bomber']);
/** The share of a yard's yearly output the refits queued at once may take (they come before its factories and mines). */
const REFIT_SHARE = 0.25;

/**
 * Idle warships and bombers in orbit of one of the empire's yards are refitted to the newest design of their role on
 * the same hull, within a quarter of the yard's yearly output (the rest waits for the next years).
 */
export function aiRefits(game: GameState, p: Player) {
  if (!aiCan(p, 1, 'refit')) return;
  // a refit still waiting after four years (the yard is busy elsewhere) is given up: the fleet is needed
  const since = (p.aiState!.refitSince ??= {});
  const waiting = new Set<number>();
  for (const pl of game.planets) {
    if (pl.owner !== p.id) continue;
    for (const q of [...pl.queue]) {
      if (q.kind !== 'refit' || q.fleetId === undefined) continue;
      waiting.add(q.fleetId);
      since[q.fleetId] ??= game.year;
      if (game.year - since[q.fleetId] <= 4) continue;
      pl.surface.ironium += q.allocated.ironium; pl.surface.boranium += q.allocated.boranium; pl.surface.germanium += q.allocated.germanium;
      pl.queue.splice(pl.queue.indexOf(q), 1);
    }
  }
  for (const id of Object.keys(since)) if (!waiting.has(+id)) delete since[+id];
  const budget = new Map<number, number>();
  for (const f of game.fleets) {
    if (f.owner !== p.id || f.orbiting < 0 || f.waypoints.length > 1 || busy(game, f) || !REFIT_ROLES.has(f.purpose ?? '')) continue;
    const planet = game.planets[f.orbiting];
    if (planet.owner !== p.id || !planet.starbase) continue;
    if (!budget.has(planet.id)) budget.set(planet.id, planetSpec(game, planet, p).resources * REFIT_SHARE);
    for (const t of [...f.tokens]) {
      const from = game.designs.find(d => d.id === t.designId);
      if (!from || from.alien || from.owner !== p.id) continue;
      const role = baseRole(from) ?? f.purpose!;
      const to = refitTargets(game, p, from.id).filter(d => baseRole(d) === role && d.id > from.id).sort((a, b) => b.id - a.id)[0];
      if (!to) continue;
      if (role === 'warship' ? might(p, to) < might(p, from) * REFIT_GAIN : !from.deleted) continue;
      if (refitBlocker(game, f, from.id, to.id)) continue;
      const free = refitFree(game, f, from.id);
      const unit = refitUnitCost(game, p, from.id, to.id);
      const left = budget.get(planet.id)!;
      const n = Math.min(free, Math.floor(left / Math.max(1, unit.resources)));
      if (n <= 0) continue;
      if (queueRefit(game, f, from.id, to.id, n) === null) budget.set(planet.id, left - n * unit.resources);
    }
  }
}

/** Upgrades under way at most at once (a station is dear): two, and one more per ten worlds. */
const stationWorks = (worlds: number) => 2 + Math.floor(worlds / 10);

/**
 * Stations overtaken by a better design are replaced (the upgrade pays only for what changes): the big worlds get the
 * best station, the small ones keep their fort up to date. A dock is never traded for a station without one.
 */
export function aiStations(game: GameState, p: Player) {
  if (!aiCan(p, 1, 'station')) return;
  const station = roleDesign(game, p, 'starbase'), fort = roleDesign(game, p, 'fort');
  const rs = raceSpec(p.race);
  const mine = game.planets.filter(pl => pl.owner === p.id && pl.starbase);
  const upgrading = mine.filter(pl => pl.queue.some(q => q.kind === 'starbase'));
  // an upgrade under way is not left behind the ships queued since, once an enemy is close
  for (const pl of upgrading) {
    const i = pl.queue.findIndex(q => q.kind === 'starbase');
    if (i > 0 && enemyNear(game, p, pl) <= 120 && pl.queue.slice(0, i).some(q => q.kind === 'ship')) pl.queue.unshift(...pl.queue.splice(i, 1));
  }
  let works = upgrading.length;
  const most = stationWorks(game.planets.filter(pl => pl.owner === p.id).length);
  for (const pl of mine.sort((a, b) => b.pop - a.pop)) {
    if (works >= most) break;
    if (pl.queue.some(q => q.kind === 'starbase')) continue;
    const cur = game.designs.find(d => d.id === pl.starbase!.designId);
    if (!cur || cur.purpose === 'beacon') continue;
    const big = rs.livesOnStarbases || pl.pop > 150000;
    const want = big ? station : fort && cur.hull === fort.hull ? fort : undefined;
    if (!want || want.id === cur.id) continue;
    // only where it matters: near an enemy, or where the dock is too small for today's ships
    const danger = enemyNear(game, p, pl);
    const cramped = big && dockBlocks(game, p, cur, want);
    if (danger > 260 && !cramped) continue;
    const gain = might(p, want) / might(p, cur);
    if (!cramped && !(gain >= 1.5 || (cur.deleted && gain >= 1.2))) continue;
    if (designSpec(p, cur).dock !== 0 && designSpec(p, want).dock === 0) continue;
    const cost = starbaseUpgradeCost(p, cur, want);
    if (cost.resources > planetSpec(game, pl, p).resources * 2) continue; // too dear for this world now
    const item = { kind: 'starbase' as const, designId: want.id, qty: 1, allocated: zeroCost() };
    // first when an enemy is close, else before the factories and mines
    if (danger <= 120) pl.queue.unshift(item);
    else { const i = pl.queue.findIndex(q => isAuto(q.kind)); pl.queue.splice(i < 0 ? pl.queue.length : i, 0, item); }
    works++;
  }
}

// ------------------------------------------------------------------------------------------------ hubs, defense

/** Is the station's dock too small for today's warships, colony ships or freighters, when the new one's is not? */
function dockBlocks(game: GameState, p: Player, cur: ShipDesign, want: ShipDesign): boolean {
  const cap = (d: ShipDesign) => designSpec(p, d).dock;
  const fits = (dock: number, mass: number) => dock < 0 || mass <= dock;
  for (const role of ['warship', 'colonizer', 'freighter']) {
    const d = roleDesign(game, p, role);
    if (!d) continue;
    const mass = designSpec(p, d).mass;
    if (!fits(cap(cur), mass) && fits(cap(want), mass)) return true;
  }
  return false;
}

/** How far the nearest known world of an empire at war with this one lies (Infinity: none known). */
function enemyNear(game: GameState, p: Player, from: { x: number; y: number }): number {
  let d = Infinity;
  for (const pi of p.intel.planets) {
    if (pi.owner === undefined || pi.owner < 0 || pi.owner === p.id || p.relations[pi.owner] !== 'enemy') continue;
    d = Math.min(d, distance(game.planets[pi.id], from));
  }
  return d;
}

/**
 * The hubs where the warships wait (one per eight worlds or so, five at most): the most populous dock, then the docks
 * that cover the most of the empire the others leave far.
 */
export function hubsOf(game: GameState, p: Player): Planet[] {
  const mine = game.planets.filter(pl => pl.owner === p.id);
  const docks = mine.filter(pl => pl.starbase && canRefuelAt(game, p, pl)).sort((a, b) => b.pop - a.pop);
  if (!docks.length) return [];
  const k = Math.max(1, Math.min(5, Math.round(mine.length / 8)));
  const hubs = [docks[0]];
  while (hubs.length < k) {
    let best: Planet | undefined, bs = 0;
    for (const d of docks) {
      if (hubs.includes(d)) continue;
      const far = Math.min(...hubs.map(h => distance(h, d)));
      if (far < 120) continue;
      const sc = Math.sqrt(Math.max(1, d.pop)) * far;
      if (sc > bs) { bs = sc; best = d; }
    }
    if (!best) break;
    hubs.push(best);
  }
  return hubs;
}

/** An idle warship (or bomber) goes to the nearest hub. */
export function toHub(game: GameState, p: Player, f: Fleet, hubs: Planet[]) {
  if (!hubs.length) return;
  const hub = [...hubs].sort((a, b) => distance(a, f) - distance(b, f))[0];
  if (f.orbiting !== hub.id) travel(game, f, { x: hub.x, y: hub.y, planetId: hub.id });
}

/** At each hub, the idle warships make one fleet, the idle bombers another. */
export function mergeAtHubs(game: GameState, p: Player, hubs: Planet[]) {
  for (const h of hubs) for (const role of ['warship', 'bomber']) {
    const here = game.fleets.filter(f => f.owner === p.id && f.purpose === role && f.orbiting === h.id && f.waypoints.length <= 1 && !busy(game, f));
    if (here.length < 2) continue;
    const lead = here.sort((a, b) => b.tokens.reduce((s, t) => s + t.qty, 0) - a.tokens.reduce((s, t) => s + t.qty, 0))[0];
    for (const o of here) if (o !== lead && game.fleets.includes(o)) mergeFleets(game, lead, o);
  }
}

/** What a world is worth defending. */
const worth = (pl: Planet) => pl.pop + (pl.homeworld ? 300000 : 0) + (pl.starbase ? 50000 : 0);

/** The strength of a world's own station (as for a fleet). */
function stationStrength(game: GameState, pl: Planet): number {
  if (!pl.starbase) return 0;
  const s = specOf(game, pl.starbase.designId);
  return Math.max(1, s.armor + s.shields) * Math.max(1, s.powerRating);
}

/**
 * The enemy fleets seen coming for the empire's worlds (armed, bombers or troop ships, within 180 ly of a world, or
 * heading for one): the idle warships that can be there in time and are strong enough together go and guard the world
 * (they are kept for it until the danger has passed); otherwise the world raises its defenses.
 */
export function aiDefend(game: GameState, p: Player) {
  if (!aiCan(p, 1, 'defend')) return;
  const mine = game.planets.filter(pl => pl.owner === p.id);
  if (!mine.length) return;
  const byWorld = new Map<number, { target: Planet; s: number; eta: number }>();
  for (const fi of p.intel.fleets) {
    if (fi.owner < 0 || fi.owner === p.id || p.relations[fi.owner] !== 'enemy' || game.players[fi.owner]?.monster) continue;
    const f = game.fleets.find(x => x.id === fi.id);
    if (!f) continue;
    const sp = fleetSpec(game, f);
    if (!sp.hasWeapons && !sp.bomber && f.cargo.colonists <= 0) continue;
    const tr = estimateTrajectory(p, fi.id, 2);
    const ahead = tr?.ahead[tr.ahead.length - 1];
    let target: Planet | undefined, bd = Infinity;
    for (const pl of mine) {
      const d = Math.min(distance(pl, fi), ahead ? distance(pl, ahead) + 10 : Infinity);
      if (d < bd) { bd = d; target = pl; }
    }
    if (!target || distance(target, fi) > 180) continue;
    const seen = tr && tr.from.length >= 2 ? distance(tr.from[tr.from.length - 2], tr.from[tr.from.length - 1]) : 0;
    const speed = Math.max(16, seen || (sp.idealSpeed || 6) ** 2);
    const eta = Math.max(1, Math.ceil(distance(target, fi) / speed));
    const w = byWorld.get(target.id);
    if (w) { w.s += fleetStrength(game, f); w.eta = Math.min(w.eta, eta); } else byWorld.set(target.id, { target, s: fleetStrength(game, f), eta });
  }
  if (!byWorld.size) return;
  const rs = raceSpec(p.race);
  for (const t of [...byWorld.values()].sort((a, b) => worth(b.target) - worth(a.target))) {
    const there = game.fleets.filter(f => f.owner === p.id && (f.aiGuard?.planetId === t.target.id || (f.orbiting === t.target.id && f.waypoints.length <= 1)) && fleetSpec(game, f).hasWeapons);
    const need = t.s * 1.3 - there.reduce((a, f) => a + fleetStrength(game, f), 0) - stationStrength(game, t.target);
    if (need <= 0) continue;
    const cands = game.fleets.filter(f => f.owner === p.id && f.purpose === 'warship' && f.waypoints.length <= 1 && !busy(game, f) && !there.includes(f)
      && fleetSpec(game, f).hasWeapons && fleetSpec(game, f).hasEngines && (distance(f, t.target) === 0 || etaYears(game, f, t.target) <= t.eta + 1))
      .sort((a, b) => distance(a, t.target) - distance(b, t.target));
    const group: Fleet[] = [];
    let sum = 0;
    for (const f of cands) { group.push(f); sum += fleetStrength(game, f); if (sum >= need) break; }
    if (sum >= need) {
      for (const f of group) {
        if (distance(f, t.target) > 0 && !safeGoto(game, f, { x: t.target.x, y: t.target.y, planetId: t.target.id }, 'none', false)) continue;
        f.aiGuard = { planetId: t.target.id, until: game.year + t.eta + 2 };
      }
    } else if (!rs.livesOnStarbases && !t.target.queue.some(q => q.kind === 'defenses' || q.kind === 'autoDefenses')) {
      const room = planetSpec(game, t.target, p).maxDefenses - t.target.defenses;
      if (room > 0) t.target.queue.unshift({ kind: 'defenses', qty: Math.min(15, room), allocated: zeroCost() });
    }
  }
}

// ------------------------------------------------------------------------------------------------ economy, research

/** A world sitting on this much of each mineral builds no more mines (its mines keep running). */
export const MINERALS_ENOUGH = 5000;
export const mineralRich = (pl: Planet) => Math.min(pl.surface.ironium, pl.surface.boranium, pl.surface.germanium) >= MINERALS_ENOUGH;
/** Alchemy (resources into minerals) only on a world short of one. */
export const mineralShort = (pl: Planet) => Math.min(pl.surface.ironium, pl.surface.boranium, pl.surface.germanium) < 500;

/** The field that terraforms each habitat axis (gravity, temperature, radiation), and the steps of its terraforming. */
const AXIS_FIELD: Field[] = ['propulsion', 'energy', 'weapons'];
const AXIS_TIERS = [{ lvl: 1, bi: 1, amt: 3 }, { lvl: 5, bi: 2, amt: 7 }, { lvl: 10, bi: 3, amt: 11 }, { lvl: 16, bi: 4, amt: 15 }];
const TT_TIERS = [{ bi: 0, amt: 3 }, { bi: 3, amt: 5 }, { bi: 6, amt: 7 }, { bi: 9, amt: 10 }, { bi: 13, amt: 15 }, { bi: 17, amt: 20 }, { bi: 22, amt: 25 }, { bi: 25, amt: 30 }];

/**
 * The next step of terraforming worth learning: the habitat axis on which the most worlds within reach (three at
 * least) lie beyond what the empire can terraform today but within the next step, the others axes being fine.
 */
function terraformBoost(game: GameState, p: Player, mine: Planet[]): Field | null {
  const ab = terraformAbility(p);
  const tt = p.race.lrts.includes('TT');
  const next = [0, 1, 2].map(i => {
    if (p.race.immune[i]) return null;
    const own = AXIS_TIERS.find(t => t.amt > ab[i]);
    const viaTT = tt ? TT_TIERS.find(t => t.amt > ab[i]) : undefined;
    if (viaTT && (!own || viaTT.amt >= own.amt * 0.7)) return { amt: viaTT.amt, field: 'biotechnology' as Field };
    if (!own) return null;
    return { amt: own.amt, field: p.tech[AXIS_FIELD[i]] < own.lvl ? AXIS_FIELD[i] : 'biotechnology' as Field };
  });
  const votes = [0, 0, 0];
  for (const pi of p.intel.planets) {
    if (!pi.hab || (pi.owner !== undefined && pi.owner >= 0) || pi.guardian || pi.lair) continue;
    const pl = game.planets[pi.id];
    if (!mine.some(m => distance(m, pl) <= 250)) continue;
    const out = [0, 1, 2].map(i => p.race.immune[i] ? 0 : Math.max(0, p.race.habLow[i] - pi.hab![i], pi.hab![i] - p.race.habHigh[i]));
    const beyond = [0, 1, 2].filter(i => out[i] > ab[i]);
    if (beyond.length !== 1) continue;
    const i = beyond[0], n = next[i];
    if (n && out[i] <= n.amt) votes[i]++;
  }
  const axis = votes.indexOf(Math.max(...votes));
  return votes[axis] >= 3 ? next[axis]?.field ?? null : null;
}

/**
 * The field the computer studies before its plan, if any: at war, the weapons, armour or energy where the enemy (as
 * known) is two levels ahead; when the worlds within reach are scarce and many of them are out of its range on one
 * habitat axis only, that axis's terraforming; and a field left five levels behind the others.
 */
export function researchBoost(game: GameState, p: Player): Field | null {
  if (!aiCan(p, 1, 'research') || game.year < 2410) return null;
  const st = p.aiState;
  if (st?.phase === 'war' && st.targetPlayer !== undefined && !aiOff('research-war')) {
    const their = p.intel.dossiers?.[st.targetPlayer]?.techs?.v;
    if (their) for (const f of ['weapons', 'construction', 'energy'] as Field[]) if (their[f] >= p.tech[f] + 2) return f;
  }
  const mine = game.planets.filter(pl => pl.owner === p.id);
  if (mine.length && !aiOff('research-terraform') && !raceSpec(p.race).livesOnStarbases && colonyTargets(game, p).length < Math.max(3, mine.length / 3)) {
    const f = terraformBoost(game, p, mine);
    // a step dearer than three years of research is not worth the worlds it opens
    const yearly = mine.reduce((a, pl) => a + planetSpec(game, pl, p).resources, 0) * (p.researchPct ?? 15) / 100;
    if (f && researchCost(game, p, f) <= yearly * 3) return f;
  }
  if (aiOff('research-catchup')) return null;
  const avg = FIELDS.reduce((a, f) => a + p.tech[f], 0) / FIELDS.length;
  const low = FIELDS.filter(f => p.tech[f] <= avg - 5).sort((a, b) => p.tech[a] - p.tech[b])[0];
  return low ?? null;
}

/**
 * At war, the warships are designed against the enemy's fleet as seen: torpedoes against well-shielded ships, beams
 * against armour (switching only past a margin, so the designs do not swing back and forth).
 */
export function warCounter(game: GameState, p: Player): 'beamWarship' | 'torpedoWarship' | undefined {
  const st = p.aiState;
  if (!aiCan(p, 2, 'counter') || !st || st.phase !== 'war' || st.targetPlayer === undefined) return st?.counter;
  let sh = 0, ar = 0;
  for (const fi of p.intel.fleets) {
    if (fi.owner !== st.targetPlayer || !fi.tokens) continue;
    for (const t of fi.tokens) { const s = specOf(game, t.designId); if (!s.hasWeapons || s.starbase) continue; sh += s.shields * t.qty; ar += s.armor * t.qty; }
  }
  if (sh + ar <= 0) return st.counter;
  const share = sh / (sh + ar);
  if (share > 0.4) st.counter = 'torpedoWarship';
  else if (share < 0.3) st.counter = 'beamWarship';
  return st.counter;
}

/** Years a loaded colony ship may wait for a world before its colonists are put to use. */
export const COLONY_WAIT = 8;

/**
 * A colony ship loaded with colonists that has found no world for a few years unloads them on the empire's world with
 * the most room, and serves from then on as a transport (for invasions or the logistics). True when it was given orders.
 */
export function idleColonyShip(game: GameState, p: Player, f: Fleet): boolean {
  if (!aiCan(p, 1, 'colony')) return false;
  const st = p.aiState!;
  const idle = st.idleColonizers ??= {};
  const since = idle[f.id] ??= game.year;
  if (game.year - since < COLONY_WAIT) return false;
  delete idle[f.id];
  const room = game.planets.filter(pl => pl.owner === p.id && pl.pop > 0).map(pl => ({ pl, free: planetSpec(game, pl, p).maxPop - pl.pop })).filter(x => x.free > f.cargo.colonists * 100)
    .sort((a, b) => distance(a.pl, f) / Math.max(1, a.free) - distance(b.pl, f) / Math.max(1, b.free))[0]?.pl;
  f.purpose = 'freighter';
  if (!room) return true;
  if (f.orbiting === room.id) { transferWithPlanet(game, f, room, 'colonists', -f.cargo.colonists); return true; }
  if (!safeGoto(game, f, { x: room.x, y: room.y, planetId: room.id }, 'transport', false)) return true;
  f.waypoints[1].transport = { colonists: { action: 'unloadAll', amount: 0 } };
  return true;
}
