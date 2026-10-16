// Computer players: research, designs, production, exploration, colonization and war.
import { reachable } from './secrets';
import type { AIState, Field, Fleet, GameState, Planet, Player, QueueKind, ShipDesign, Waypoint } from './types';
import { FIELDS } from './types';
import { Rng } from './rng';
import { habitability, raceSpec } from './race';
import { autoDesign, availableHulls, designSpec, type Purpose } from './design';
import { planetSpec, terraformedHabValue } from './planet';
import { canBuildShip, zeroCost, hasMassDriver } from './production';
import { fleetSpec, distance, estimateRoute, canRefuelAt, fuelUsageExact, cargoMass, totalShips } from './fleet';
import { mergeFleets, transferWithPlanet } from './tasks';
import { specOf } from './design';
import { minefieldsOnLeg } from './movement';
import { addDesign } from './newgame';
import { researchCost } from './research';
import { runAI3 } from './ai3';
import { crisisActive, nexusFleet, breachPlanet, nexusStrength, waves, TRUCE_RADIUS, STRIKE } from './crisis';
/** Gathering point before striking the Nexus, this far from the Breach (al). */
const RALLY = 35;
import { fleetStrength } from './factions';
import { isStudying } from './anomalies';
import { needsFuel, defaultTankerRange } from './refuel';
import { colonyBlocker, cultureOn, CULTURE_BUILDINGS, PATRONAGE, hasReq } from './culture';
import { swornAgainst, isNemesis, counterPurpose } from './nemesis';
import { actOf } from './acts';
import { dangerAt } from './cataclysms';

const RESEARCH_PLAN: Partial<Record<Field, number>>[] = [
  { propulsion: 2, biotechnology: 1 }, { energy: 1, weapons: 1 }, { construction: 4, electronics: 2 }, { weapons: 6, biotechnology: 3 },
  { energy: 3, weapons: 8, construction: 6, electronics: 4 }, { energy: 5, propulsion: 5, biotechnology: 5 }, { construction: 8, electronics: 6 },
  { energy: 6, weapons: 10, biotechnology: 6 }, { construction: 10, propulsion: 7, electronics: 8 }, { weapons: 12, biotechnology: 8 },
  { energy: 10, propulsion: 10, electronics: 10, biotechnology: 10 }, { construction: 13 }, { weapons: 16, electronics: 12 },
  { energy: 12, propulsion: 12, electronics: 14, biotechnology: 12 }, { weapons: 20, construction: 16 }, { energy: 14, electronics: 16, biotechnology: 14 },
  { weapons: 24 }, { energy: 18, propulsion: 16, electronics: 19 }, { weapons: 26 }, { construction: 26 },
];

function state(p: Player): AIState {
  if (!p.aiState) p.aiState = { phase: 'expand', lastDesignYear: -100, scouted: [], colonyTargets: {} };
  return p.aiState;
}

const diffResearch: Record<string, number> = { easy: 10, standard: 17, harder: 21, expert: 25 };
const diffWarYear: Record<string, number> = { easy: 60, standard: 40, harder: 30, expert: 25 };

export function runAI(game: GameState, p: Player, rng: Rng) {
  const st = state(p);
  p.researchPct = diffResearch[p.ai ?? 'standard'];
  chooseResearch(game, p);
  if (game.year - st.lastDesignYear >= 5 || game.year === 2400) { updateDesigns(game, p); st.lastDesignYear = game.year; }
  const years = game.year - 2400;
  const enemiesKnown = p.intel.met.filter(o => p.relations[o] === 'enemy' && !game.players[o].dead);
  // 0.3.9: a nemesis is at war as soon as it is with its sworn enemy
  const sworn = swornAgainst(game, p.id).filter(h => enemiesKnown.includes(h));
  st.phase = (years >= diffWarYear[p.ai ?? 'standard'] && enemiesKnown.length && actOf(game) >= 2) || sworn.length ? 'war' : years > 10 ? 'build' : 'expand';
  // Constellations 3.4: while the Nexus stands, every fleet goes to war against the Harvesters
  const breach = crisisActive(game) && nexusFleet(game) ? breachPlanet(game) : undefined;
  st.crisisTarget = breach?.id;
  if (breach) st.phase = 'war';
  // (re)choose the enemy to fight: at war start, when it dies, and every 10 years
  if (st.phase === 'war' && (st.targetPlayer === undefined || game.players[st.targetPlayer].dead || (st.attackStartYear ?? 0) + 10 <= game.year || (p.relations[st.targetPlayer] !== 'enemy' && st.portalTarget === undefined) || (sworn.length > 0 && !sworn.includes(st.targetPlayer) && st.portalTarget === undefined))) {
    const t = pickEnemy(game, p, enemiesKnown);
    if (t !== st.targetPlayer) st.attackStartYear = game.year;
    else st.attackStartYear = game.year;
    st.targetPlayer = t;
  }
  runAI3(game, p);
  production(game, p, rng);
  fleets(game, p, rng);
}

function pickEnemy(game: GameState, p: Player, enemies: number[]): number | undefined {
  const sworn = swornAgainst(game, p.id).find(h => enemies.includes(h));
  if (sworn !== undefined) return sworn;
  // closest reachable enemy, weighted towards weaker empires (and slightly towards humans, to keep games lively)
  const mine = game.planets.filter(x => x.owner === p.id);
  const myScore = Math.max(1, p.scores[p.scores.length - 1]?.score ?? 1);
  let best: number | undefined, bs = Infinity;
  for (const e of enemies) {
    let d = Infinity;
    for (const pi of p.intel.planets) {
      if (pi.owner !== e) continue;
      const pl = game.planets[pi.id];
      for (const m of mine) d = Math.min(d, distance(m, pl));
    }
    if (!Number.isFinite(d)) continue;
    const their = game.players[e];
    const ratio = Math.max(1, their.scores[their.scores.length - 1]?.score ?? 1) / myScore;
    const sc = d * (0.6 + 0.4 * Math.min(2.5, ratio)) * (their.ai ? 1 : 0.8);
    if (sc < bs) { bs = sc; best = e; }
  }
  return best ?? enemies[0];
}

function chooseResearch(game: GameState, p: Player) {
  for (const step of RESEARCH_PLAN) {
    let best: Field | null = null;
    for (const f of FIELDS) {
      const want = step[f];
      if (want === undefined || p.tech[f] >= want) continue;
      if (!best || researchCost(game, p, f) < researchCost(game, p, best)) best = f;
    }
    if (best) { p.researching = best; p.nextField = 'same'; return; }
  }
  p.nextField = 'lowest';
}

// ------------------------------------------------------------------ designs

const DESIGN_ROLES: { role: string; purpose: Purpose; hulls: string[] }[] = [
  { role: 'scout', purpose: 'longRangeScout', hulls: ['Scout'] },
  { role: 'colonizer', purpose: 'colonizer', hulls: ['Colony Ship', 'Mini-Colony Ship', 'Medium Freighter'] },
  { role: 'freighter', purpose: 'freighter', hulls: ['Super Freighter', 'Large Freighter', 'Medium Freighter', 'Small Freighter'] },
  { role: 'warship', purpose: 'beamWarship', hulls: ['Dreadnought', 'Battleship', 'Battle Cruiser', 'Cruiser', 'Destroyer', 'Frigate'] },
  { role: 'bomber', purpose: 'bomber', hulls: ['B-52 Bomber', 'B-17 Bomber', 'Mini Bomber'] },
  { role: 'starbase', purpose: 'starbase', hulls: ['Death Star', 'Ultra Station', 'Space Station', 'Space Dock', 'Orbital Fort'] },
  { role: 'fort', purpose: 'fort', hulls: ['Orbital Fort'] },
  { role: 'tanker', purpose: 'fuelFreighter', hulls: ['Super-Fuel Xport', 'Fuel Transport', 'Medium Freighter', 'Small Freighter'] },
  { role: 'minelayer', purpose: 'mineLayer', hulls: ['Super Mine Layer', 'Mini Mine Layer', 'Galleon', 'Frigate', 'Cruiser', 'Privateer', 'Destroyer'] },
];

function roleDesign(game: GameState, p: Player, role: string): ShipDesign | undefined {
  return game.designs.filter(d => d.owner === p.id && !d.deleted && !d.alien && d.purpose === role).sort((a, b) => b.id - a.id)[0];
}

function updateDesigns(game: GameState, p: Player) {
  const hulls = new Set(availableHulls(p, false).map(h => h.name).concat(availableHulls(p, true).map(h => h.name)));
  for (const r of DESIGN_ROLES) {
    const hull = r.hulls.find(h => hulls.has(h));
    if (!hull) continue;
    if (r.role === 'colonizer' && hull === 'Medium Freighter') continue;
    if (r.role === 'freighter' && p.ai && raceSpec(p.race).livesOnStarbases) continue;
    // 0.3.9: a nemesis arms its warships against yours
    const d = autoDesign(p, hull, r.role === 'warship' ? counterPurpose(game, p) ?? r.purpose : r.purpose, '');
    if (!d) continue;
    if (r.role === 'colonizer' && !d.slots.some(s => /Colonization|Orbital Construction/.test(s.part))) continue;
    if (r.role === 'bomber' && !d.slots.some(s => designSpec(p, d).bombs.length > 0 && s)) continue;
    if (r.role === 'minelayer' && !(designSpec(p, d).mineLaying.standard > 0)) continue;
    if (r.role === 'tanker' && designSpec(p, d).fuelCapacity < 350) continue;
    d.purpose = r.role;
    const old = roleDesign(game, p, r.role);
    if (old && old.hull === d.hull && JSON.stringify(old.slots) === JSON.stringify(d.slots)) continue;
    const count = game.designs.filter(x => x.owner === p.id && x.purpose === r.role).length;
    d.name = `${roleName(r.role)} ${romanize(count + 1)}`;
    addDesign(game, d);
    // retire old design of that role from future production (keep for existing ships)
    if (old) old.deleted = true;
  }
}

function roleName(role: string): string {
  return ({ scout: 'Éclaireur', colonizer: 'Colonisateur', freighter: 'Cargo', warship: 'Croiseur', bomber: 'Bombardier', starbase: 'Citadelle', minelayer: 'Mouilleur', fort: 'Fortin', tanker: 'Ravitailleur' } as Record<string, string>)[role] ?? role;
}
function romanize(n: number): string {
  const r: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = ''; for (const [v, l] of r) while (n >= v) { s += l; n -= v; } return s;
}

// ------------------------------------------------------------------ production

function inQueue(planet: Planet, kind: QueueKind, designId?: number): boolean {
  return planet.queue.some(q => q.kind === kind && (designId === undefined || q.designId === designId));
}

function push(planet: Planet, kind: QueueKind, qty: number, designId?: number, front = false) {
  const item = { kind, designId, qty, allocated: zeroCost() };
  if (front) planet.queue.unshift(item); else planet.queue.push(item);
}

const enemyWorldCache = new WeakMap<Player, { year: number; list: Planet[] }>();
function nearestEnemyWorld(game: GameState, p: Player, from: { x: number; y: number }): number {
  let c = enemyWorldCache.get(p);
  if (!c || c.year !== game.year) {
    c = { year: game.year, list: p.intel.planets.filter(pi => pi.owner !== undefined && pi.owner >= 0 && pi.owner !== p.id && p.relations[pi.owner] !== 'friend').map(pi => game.planets[pi.id]) };
    enemyWorldCache.set(p, c);
  }
  let d = Infinity;
  for (const e of c.list) d = Math.min(d, distance(e, from));
  return d;
}

function production(game: GameState, p: Player, rng: Rng) {
  const st = state(p);
  const rs = raceSpec(p.race);
  const mine = game.planets.filter(x => x.owner === p.id);
  const myFleets = game.fleets.filter(f => f.owner === p.id);
  const count = (role: string) => myFleets.filter(f => f.purpose === role || f.tokens.some(t => game.designs.find(d => d.id === t.designId)?.purpose === role)).reduce((a, f) => a + f.tokens.reduce((b, t) => b + t.qty, 0), 0);
  const designPurpose = (f: Fleet) => game.designs.find(d => d.id === f.tokens[0]?.designId)?.purpose;
  // scouts still exploring (a short-legged one turned picket no longer counts)
  const scouts = myFleets.filter(f => f.purpose === 'scout' || (!f.purpose && designPurpose(f) === 'scout')).reduce((a, f) => a + f.tokens.reduce((b, t) => b + t.qty, 0), 0);
  const colonizers = myFleets.filter(f => fleetSpec(game, f).colonizer).length;
  const targets = colonyTargets(game, p).length;
  const queuedColonizers = mine.reduce((a, pl) => a + pl.queue.filter(q => q.kind === 'ship' && game.designs.find(d => d.id === q.designId)?.purpose === 'colonizer').reduce((b, q) => b + q.qty, 0), 0);
  const queuedScouts = mine.reduce((a, pl) => a + pl.queue.filter(q => q.kind === 'ship' && game.designs.find(d => d.id === q.designId)?.purpose === 'scout').reduce((b, q) => b + q.qty, 0), 0);
  let wantColonizers = Math.max(0, Math.min(targets, Math.ceil(mine.length / 2) + 1) - colonizers - queuedColonizers);
  let wantScouts = Math.max(0, (game.year - 2400 < 30 ? 2 + Math.trunc(game.planets.length / 60) : 1) - scouts - queuedScouts);
  const warships = count('warship'), bombers = count('bomber');
  // troop transports for invasions
  const freD = roleDesign(game, p, 'freighter');
  let wantFreighters = 0;
  if (st.phase === 'war' && freD) {
    const needs = troopTargets(game, p).map(t => t.needKt).sort((a, b) => a - b).slice(0, 3);
    const need = Math.min(needs.length ? Math.max(...needs) : 0, 6000);
    const have = myFleets.filter(f => f.purpose === 'freighter').reduce((a, f) => a + fleetSpec(game, f).cargoCapacity, 0);
    const queued = mine.reduce((a, pl) => a + pl.queue.filter(q => q.kind === 'ship' && q.designId === freD.id).reduce((b, q) => b + q.qty, 0), 0);
    const per = Math.max(1, designSpec(p, freD).cargoCapacity);
    wantFreighters = Math.min(8, Math.max(0, Math.ceil((need - have) / per) - queued));
  }
  // mine layers: Space Demolition lives by them, others use a few to protect key worlds
  const mlD = roleDesign(game, p, 'minelayer');
  let wantLayers = 0;
  if (mlD && game.year - 2400 >= 12) {
    const target = p.race.prt === 'SD' ? Math.min(12, Math.ceil(mine.length / 3)) : st.phase === 'expand' ? 0 : Math.min(5, Math.ceil(mine.length / 8));
    const queued = mine.reduce((a, pl) => a + pl.queue.filter(q => q.kind === 'ship' && q.designId === mlD.id).reduce((b, q) => b + q.qty, 0), 0);
    wantLayers = Math.max(0, target - count('minelayer') - queued);
  }
  // tankers (3.2.5): one once the fleet is spread out, more at war; posted where fleets run short of fuel
  const tankD = roleDesign(game, p, 'tanker');
  let wantTankers = 0;
  if (tankD && game.year - 2400 >= 25) {
    const movers = myFleets.filter(f => f.purpose !== 'tanker' && fleetSpec(game, f).hasEngines).length;
    const target = st.phase === 'war' ? Math.min(4, 1 + Math.floor(count('warship') / 12)) : movers >= 8 ? 1 : 0;
    const have = myFleets.filter(f => f.purpose === 'tanker' || designPurpose(f) === 'tanker').length;
    const queued = mine.reduce((a, pl) => a + pl.queue.filter(q => q.kind === 'ship' && q.designId === tankD.id).reduce((b, q) => b + q.qty, 0), 0);
    wantTankers = Math.max(0, target - have - queued);
  }
  const byPop = [...mine].sort((a, b) => b.pop - a.pop);
  for (const planet of byPop) {
    const spec = planetSpec(game, planet, p);
    // base economy items
    if (!rs.livesOnStarbases) {
      if (!inQueue(planet, 'autoFactories')) push(planet, 'autoFactories', 250);
      if (!inQueue(planet, 'autoMines')) push(planet, 'autoMines', 250);
      if (st.phase !== 'expand' && !inQueue(planet, 'autoDefenses') && planet.pop > 50000) push(planet, 'autoDefenses', 50);
    }
    if (!inQueue(planet, 'autoMaxTerraform') && spec.canTerraform) push(planet, 'autoMaxTerraform', 10);
    if (!planet.scanner && !rs.livesOnStarbases && planet.pop > 20000 && !inQueue(planet, 'scanner')) push(planet, 'scanner', 1);
    // starbases: a dock where population is large
    const sbDesign = roleDesign(game, p, 'starbase');
    if (!planet.starbase && sbDesign && planet.pop > (rs.livesOnStarbases ? 0 : 150000) && !inQueue(planet, 'starbase')) push(planet, 'starbase', 1, sbDesign.id, true);
    // frontier worlds get at least an armed fort (it also blocks invasions)
    const fortD = roleDesign(game, p, 'fort');
    if (!planet.starbase && fortD && st.phase !== 'expand' && planet.pop > 30000 && !inQueue(planet, 'starbase') && nearestEnemyWorld(game, p, planet) < 220) push(planet, 'starbase', 1, fortD.id, true);
    // ships need a dock
    const scoutD = roleDesign(game, p, 'scout'), colD = roleDesign(game, p, 'colonizer'), warD = roleDesign(game, p, 'warship'), bombD = roleDesign(game, p, 'bomber');
    const canBuild = (d?: ShipDesign) => !!d && !canBuildShip(game, planet, d);
    const shipItems = planet.queue.filter(q => q.kind === 'ship').length;
    if (wantFreighters > 0 && canBuild(freD) && planet.pop > 100000) { const n = Math.min(wantFreighters, 4); push(planet, 'ship', n, freD!.id, true); wantFreighters -= n; }
    if (shipItems >= 3) continue;
    if (wantScouts > 0 && canBuild(scoutD)) { push(planet, 'ship', 1, scoutD!.id, true); wantScouts--; }
    if (wantColonizers > 0 && canBuild(colD) && spec.maxPop > 0 && planet.pop / spec.maxPop > 0.2) { push(planet, 'ship', 1, colD!.id, true); wantColonizers--; }
    if (st.phase !== 'expand' && spec.resources > 60) {
      const warWanted = (st.phase === 'war' ? 2 + Math.trunc((game.year - 2400) / 10) * mine.length : Math.trunc(mine.length / 2) + 1) * (swornAgainst(game, p.id).length ? 1.5 : 1);
      if (canBuild(warD) && warships < warWanted && !inQueue(planet, 'ship', warD!.id)) push(planet, 'ship', 1 + Math.trunc(spec.resources / 300), warD!.id);
      if (st.phase === 'war' && st.crisisTarget === undefined && canBuild(bombD) && bombers < warships / 2 && !inQueue(planet, 'ship', bombD!.id)) push(planet, 'ship', 1 + Math.trunc(spec.resources / 500), bombD!.id);
    }
    if (wantLayers > 0 && canBuild(mlD)) { push(planet, 'ship', 1, mlD!.id); wantLayers--; }
    if (wantTankers > 0 && canBuild(tankD) && planet.pop > 50000) { push(planet, 'ship', 1, tankD!.id); wantTankers--; }
    // Constellations 3.3: culture buildings once the world has grown, patronage where a foreign culture presses
    if (cultureOn(game)) {
      if (st.phase !== 'expand' && planet.pop > 60000 && spec.resources > 150) {
        const b = CULTURE_BUILDINGS.find(x => hasReq(p, x.req) && !(planet.cultureBld ?? []).includes(x.id) && !planet.queue.some(q => q.kind === 'culture' && q.cultureId === x.id));
        if (b && !planet.queue.some(q => q.kind === 'culture')) planet.queue.push({ kind: 'culture', cultureId: b.id, qty: 1, allocated: zeroCost() });
      }
      if ((planet.assim?.progress ?? 0) > 5 && hasReq(p, PATRONAGE.req) && !inQueue(planet, 'patronage')) push(planet, 'patronage', Math.max(2, Math.trunc(spec.resources / 150)), undefined, true);
      if (game.year - 2400 > 90 && hasReq(p, PATRONAGE.req) && !inQueue(planet, 'autoPatronage') && planet.pop > 150000) push(planet, 'autoPatronage', 3);
    }
    // Packet Physicists bombard the enemy with mineral packets
    if (p.race.prt === 'PP' && planet.starbase && hasMassDriver(game, planet)) packets(game, p, planet);
    // alchemy if starving on minerals
    if (planet.queue.length > 0 && !inQueue(planet, 'autoAlchemy') && game.year - 2400 > 60 && rng.chance(0.2)) push(planet, 'autoAlchemy', 1);
  }
}

function packets(game: GameState, p: Player, planet: Planet) {
  const st = state(p);
  const minerals = planet.surface.ironium + planet.surface.boranium + planet.surface.germanium;
  let target: Planet | undefined;
  if (st.phase === 'war' && st.targetPlayer !== undefined && minerals > 1500) {
    let bd = 450;
    for (const pi of p.intel.planets) {
      if (pi.owner !== st.targetPlayer) continue;
      const e = game.planets[pi.id]; const d = distance(e, planet);
      if (d < bd) { bd = d; target = e; }
    }
  }
  const sb = specOf(game, planet.starbase!.designId);
  const idx = planet.queue.findIndex(q => q.kind === 'autoPackets');
  if (target) {
    planet.packetTarget = target.id;
    planet.packetWarp = Math.min(13, (sb.driver?.safeSpeed ?? 8) + 1);
    if (idx < 0) push(planet, 'autoPackets', 1);
  } else {
    if (idx >= 0) planet.queue.splice(idx, 1);
    if (planet.packetTarget !== undefined && game.planets[planet.packetTarget].owner !== p.id) planet.packetTarget = undefined;
  }
}

// ------------------------------------------------------------------ fleets

function colonyTargets(game: GameState, p: Player): { planet: Planet; value: number }[] {
  const res: { planet: Planet; value: number }[] = [];
  for (const pi of p.intel.planets) {
    if (pi.year === undefined || !pi.hab || pi.guardian || pi.lair) continue;
    if (pi.owner !== undefined && pi.owner >= 0) continue;
    const planet = game.planets[pi.id];
    if (planet.hidden && !reachable(game, p, planet)) continue; // 0.3.7: the veiled star without its way in, the hidden cluster
    if (colonyBlocker(game, p, planet) !== null) continue; // another empire's territory
    if (game.cataclysms?.length && dangerAt(game, planet, 20)) continue; // 0.3.9: not under an announced cataclysm
    const hab = habitability(p.race, pi.hab);
    const tf = terraformedHabValue(p, { ...planet, hab: pi.hab, baseHab: pi.baseHab ?? pi.hab });
    // a hostile world only pays off if terraforming can fix it quickly
    const v = hab > 0 ? Math.max(hab, tf * 0.7) : hab > -12 && tf >= 30 ? tf * 0.45 : 0;
    if (v < 12 && !raceSpec(p.race).livesOnStarbases) continue;
    res.push({ planet, value: v });
  }
  return res;
}

function nearestDock(game: GameState, p: Player, from: { x: number; y: number }): Planet | undefined {
  let best: Planet | undefined, bd = Infinity;
  for (const pl of game.planets) {
    if (!canRefuelAt(game, p, pl)) continue;
    const d = distance(from, pl);
    if (d < bd) { bd = d; best = pl; }
  }
  return best;
}

/** A warp worth flying at: below it, a trip of several years is a crawl better avoided by refuelling first. */
export function decentWarp(game: GameState, f: Fleet): number {
  const sp = fleetSpec(game, f);
  return Math.max(3, Math.min(sp.idealSpeed || 5, 6) - 2);
}

/** Is the leg just ordered (waypoint 1) flown at a decent warp, or short enough not to matter? */
export function decentLeg(game: GameState, f: Fleet): boolean {
  if (f.waypoints.length < 2) return true;
  const sp = fleetSpec(game, f);
  if (sp.freeSpeed >= decentWarp(game, f)) return true;
  const w = f.waypoints[1].warp;
  if (w >= decentWarp(game, f) || w >= 11) return true;
  const leg = estimateRoute(game, f, f.waypoints.slice(0, 2))[0];
  return !!leg && leg.years <= 2;
}

/**
 * AI travel that does not crawl (3.2.5). The fleet goes at a fuel-safe warp; when that is a crawl of several years
 * and a dock can be reached at a decent warp, it goes to fill up there first (its next order starts from a full
 * tank). Returns 'go', 'refuel', 'crawl' (no better option) or 'none' (unreachable).
 */
export function travel(game: GameState, f: Fleet, target: { x: number; y: number; planetId?: number; kind?: Waypoint['target']; id?: number }, task: Waypoint['task'] = 'none', requireReturn = false): 'go' | 'refuel' | 'crawl' | 'none' {
  const p = game.players[f.owner];
  const sp = fleetSpec(game, f);
  const before = f.waypoints.map(w => ({ ...w }));
  const ok = safeGoto(game, f, target, task, requireReturn);
  if (ok && decentLeg(game, f)) return 'go';
  const atDock = f.orbiting >= 0 && canRefuelAt(game, p, game.planets[f.orbiting]);
  if (!atDock && f.fuel < sp.fuelCapacity * 0.9) {
    const dock = nearestDock(game, p, f);
    if (dock && target.planetId !== dock.id) {
      const chosen = f.waypoints;
      f.waypoints = before.map(w => ({ ...w }));
      if (safeGoto(game, f, { x: dock.x, y: dock.y, planetId: dock.id }, 'none', false) && decentLeg(game, f)) return 'refuel';
      f.waypoints = ok ? chosen : before;
    }
  }
  // a crawl of decades is no order at all
  if (ok && legYears(game, f) > MAX_CRAWL_YEARS) { f.waypoints = before; return 'none'; }
  return ok ? 'crawl' : 'none';
}

/** Longest trip an AI accepts when only a crawl is possible. */
const MAX_CRAWL_YEARS = 12;
function legYears(game: GameState, f: Fleet): number {
  if (f.waypoints.length < 2) return 0;
  return estimateRoute(game, f, f.waypoints.slice(0, 2))[0]?.years ?? 0;
}

/** Orders a fleet to a target with a fuel-safe warp; returns false if unreachable with a safe return. */
/**
 * Sends the fleet at the fastest speed its fuel allows. `lean` (0.3.8, the player's one-click missions): the fuel
 * estimate is exact (checked turn by turn), so a thin reserve is enough; the computers keep a year's worth.
 */
export function safeGoto(game: GameState, f: Fleet, target: { x: number; y: number; planetId?: number; kind?: Waypoint['target']; id?: number }, task: Waypoint['task'] = 'none', requireReturn = true, lean = false): boolean {
  const p = game.players[f.owner];
  const spec = fleetSpec(game, f);
  const wp: Waypoint = { x: target.x, y: target.y, target: target.planetId !== undefined ? 'planet' : (target.kind ?? 'space'), targetId: target.planetId ?? target.id, warp: spec.idealSpeed || 5, task };
  const base: Waypoint = { ...f.waypoints[0], task: 'none', transport: undefined, processed: true };
  // known enemy minefields on the way: stay at or below their safe speed when possible
  const mines = minefieldsOnLeg(game, p, f, target);
  const mineSafe = mines.length ? Math.min(...mines.map(m => m.safeWarp)) : 99;
  const top = Math.min(spec.idealSpeed || 6, spec.maxSafeSpeed || 9);
  const order: number[] = [];
  for (let w = Math.min(top, mineSafe); w >= 1; w--) order.push(w);
  for (let w = top; w > mineSafe; w--) order.push(w);
  for (const w of order) {
    wp.warp = w;
    const est = estimateRoute(game, f, [base, wp]);
    if (!est.every(l => l.ok)) continue;
    // keep a reserve: yearly position rounding can cost an extra year of fuel on long legs
    if (!est[0].refuelled && est[0].fuelAfter < (lean ? Math.max(1, spec.fuelCapacity * 0.02) : Math.max(spec.fuelCapacity * 0.06, est[0].fuel / Math.max(1, est[0].years) * 1.2)) && spec.freeSpeed < 2) continue;
    if (requireReturn && !est[0].refuelled) {
      const dock = nearestDock(game, p, target);
      if (dock) {
        const back = distance(target, dock);
        const need = fuelUsageExact(game, f, Math.min(w, spec.idealSpeed || w), back) * 1.1;
        if (est[0].fuelAfter + 1 < need && spec.freeSpeed < 2) continue;
      }
    }
    f.waypoints = [base, wp];
    return true;
  }
  return false;
}

function fleets(game: GameState, p: Player, rng: Rng) {
  const st = state(p);
  const myFleets = game.fleets.filter(f => f.owner === p.id);
  const targets = colonyTargets(game, p);
  const claimed = new Set<number>();
  for (const [pid, fid] of Object.entries(st.colonyTargets)) {
    if (game.fleets.some(f => f.id === fid)) claimed.add(+pid); else delete st.colonyTargets[+pid];
  }
  const homes = game.planets.filter(x => x.owner === p.id);
  for (const f of myFleets) {
    if (f.auto === 'logistics') continue; // the logistics network flies these
    if (f.aiGuard && f.aiGuard.until >= game.year) continue; // 3.4: guarding a world against a raid
    const spec = fleetSpec(game, f);
    if (!spec.hasEngines) continue;
    const idle = f.waypoints.length <= 1;
    const lays = spec.mineLaying.standard + spec.mineLaying.heavy + spec.mineLaying.speedBump > 0;
    if (!f.purpose && game.designs.find(d => d.id === f.tokens[0]?.designId)?.purpose === 'tanker') f.purpose = 'tanker';
    let role = f.purpose ?? (spec.colonizer ? 'colonizer' : spec.bomber ? 'bomber' : lays && !spec.hasWeapons ? 'minelayer' : spec.hasWeapons ? 'warship' : spec.cargoCapacity > 0 ? 'freighter' : spec.scanRange >= 0 ? 'scout' : 'other');
    if (role === 'other' && lays) role = 'minelayer';
    if (role === 'freighter' && spec.colonizer) role = 'colonizer';
    f.purpose = role;
    if (role === 'freighter' || role === 'minelayer' || role === 'tanker') continue; // handled below
    if ((role === 'warship' || role === 'bomber') && st.phase === 'war' && (st.targetPlayer !== undefined || st.crisisTarget !== undefined)) continue; // handled below
    // refuel guard: low fuel and far from dock -> go home
    if (idle && f.fuel < spec.fuelCapacity * 0.25 && spec.freeSpeed < 4) {
      const dock = nearestDock(game, p, f);
      if (dock && distance(dock, f) > 0) { safeGoto(game, f, { x: dock.x, y: dock.y, planetId: dock.id }, 'none', false); continue; }
    }
    if (role === 'colonizer') {
      // retarget if needed
      const tid = Object.entries(st.colonyTargets).find(([, fid]) => fid === f.id)?.[0];
      let tPlanet = tid !== undefined ? game.planets[+tid] : undefined;
      if (tPlanet && (p.intel.planets[tPlanet.id].owner ?? -1) >= 0) { delete st.colonyTargets[tPlanet.id]; }
      // Constellations 3.3: the target fell inside another empire's territory meanwhile: find another one
      if (tPlanet && colonyBlocker(game, p, tPlanet) !== null) {
        delete st.colonyTargets[tPlanet.id]; tPlanet = undefined;
        if (f.waypoints.length > 1) f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }];
      }
      if (f.orbiting >= 0 && tPlanet && f.orbiting === tPlanet.id && game.planets[f.orbiting].owner < 0) {
        f.waypoints = [{ ...f.waypoints[0], task: 'colonize', processed: false }];
        continue;
      }
      if (!idle && tPlanet) continue;
      // load colonists if empty and at own planet
      if (f.cargo.colonists === 0 && f.orbiting >= 0 && game.planets[f.orbiting].owner === p.id) {
        const pl = game.planets[f.orbiting];
        const cap = spec.cargoCapacity;
        const kt = Math.min(cap, Math.max(0, Math.trunc(pl.pop / 100) - 50));
        f.cargo.colonists += kt; pl.pop -= kt * 100;
      }
      if (f.cargo.colonists === 0) {
        const home = homes.sort((a, b) => b.pop - a.pop)[0];
        if (home && distance(home, f) > 0) travel(game, f, { x: home.x, y: home.y, planetId: home.id });
        continue;
      }
      const ranked = targets.filter(t => !claimed.has(t.planet.id)).map(t => {
        const years = Math.max(1, distance(f, t.planet) / ((spec.idealSpeed || 5) ** 2));
        return { planet: t.planet, score: years * years / Math.max(1, t.value) };
      }).sort((a, b) => a.score - b.score).slice(0, 6);
      // the best target flown at a decent warp; a refuel stop first if needed; a short crawl as a last resort
      const home = f.waypoints[0];
      let crawl: Planet | undefined, done = false;
      for (const t of ranked) {
        f.waypoints = [home];
        const r = travel(game, f, { x: t.planet.x, y: t.planet.y, planetId: t.planet.id }, 'colonize');
        if (r === 'refuel') { done = true; break; }
        if (r === 'go') { st.colonyTargets[t.planet.id] = f.id; claimed.add(t.planet.id); done = true; break; }
        if (r === 'crawl' && !crawl) crawl = t.planet;
      }
      if (!done) {
        f.waypoints = [home];
        if (crawl && safeGoto(game, f, { x: crawl.x, y: crawl.y, planetId: crawl.id }, 'colonize', false)) { st.colonyTargets[crawl.id] = f.id; claimed.add(crawl.id); }
      }
      continue;
    }
    if (!idle) continue;
    if (role === 'scout' && isStudying(game, f)) continue; // studying an anomaly: stays in orbit
    if (role === 'scout') {
      // nearest unexplored planet not yet targeted
      const targeted = new Set(myFleets.filter(x => x !== f && x.waypoints.length > 1).map(x => x.waypoints[x.waypoints.length - 1].targetId));
      let best: Planet | null = null, bd = Infinity;
      for (const pi of p.intel.planets) {
        if (pi.year !== undefined || pi.guardian || pi.unknown) continue;
        if (targeted.has(pi.id)) continue;
        const pl = game.planets[pi.id];
        if (pl.hidden && !reachable(game, p, pl)) continue;
        const d = distance(f, pl) * (0.9 + rng.random() * 0.2);
        if (d < bd) { bd = d; best = pl; }
      }
      if (best) {
        // the nearest targets first, but only at a decent warp (crawling at Warp 1 for decades explores nothing):
        // otherwise fill up at a dock, and crawl only when there is no other way
        const cands = p.intel.planets.filter(pi => pi.year === undefined && !pi.guardian && !pi.unknown && !targeted.has(pi.id)).map(pi => game.planets[pi.id]).filter(pl => !pl.hidden || reachable(game, p, pl))
          .sort((a, b) => distance(f, a) - distance(f, b)).slice(0, 8);
        if (!cands.includes(best)) cands.unshift(best);
        const home = f.waypoints[0];
        let sent = false;
        for (const pl of cands) {
          f.waypoints = [home];
          if (safeGoto(game, f, { x: pl.x, y: pl.y, planetId: pl.id }) && decentLeg(game, f)) { sent = true; break; }
        }
        if (sent) continue;
        f.waypoints = [home];
        const dock = nearestDock(game, p, f);
        const atDock = f.orbiting >= 0 && canRefuelAt(game, p, game.planets[f.orbiting]);
        if (dock && !atDock && f.fuel < spec.fuelCapacity * 0.9 && distance(dock, f) > 0) { safeGoto(game, f, { x: dock.x, y: dock.y, planetId: dock.id }, 'none', false); continue; }
        // full tank and still nothing within decent reach: too short-legged to explore (the starting scout with no
        // fuel tank, once the neighbourhood is done). It stays as a picket and long-range scouts take over.
        if (atDock || f.fuel >= spec.fuelCapacity * 0.9) { f.purpose = 'picket'; continue; }
        if (!safeGoto(game, f, { x: best.x, y: best.y, planetId: best.id }) || legYears(game, f) > MAX_CRAWL_YEARS) {
          f.waypoints = [home];
          if (dock && distance(dock, f) > 0) safeGoto(game, f, { x: dock.x, y: dock.y, planetId: dock.id }, 'none', false);
        }
      }
      continue;
    }
    if (role === 'warship' && homes.length) {
      // patrol around the most populous planet
      const home = homes.sort((a, b) => b.pop - a.pop)[0];
      if (distance(home, f) > 0) travel(game, f, { x: home.x, y: home.y, planetId: home.id });
    }
  }
  if (st.phase === 'war' && st.crisisTarget !== undefined) crisisFleets(game, p, game.planets[st.crisisTarget]);
  else if (st.phase === 'war' && st.targetPlayer !== undefined) warFleets(game, p);
  troopFleets(game, p);
  mineLayers(game, p);
  tankerFleets(game, p);
}

/**
 * Tankers (3.2.5): each one holds a post at a dock with the standing refuelling order (see refuel.ts), at the
 * staging world in war, else near the fleets running short of fuel, else at the dock farthest from the capital.
 */
function tankerFleets(game: GameState, p: Player) {
  const tankers = game.fleets.filter(f => f.owner === p.id && f.purpose === 'tanker');
  if (!tankers.length) return;
  const docks = game.planets.filter(pl => pl.owner === p.id && canRefuelAt(game, p, pl));
  if (!docks.length) return;
  const st = state(p);
  const posts: Planet[] = [];
  if (st.phase === 'war' && st.staging !== undefined && docks.some(d => d.id === st.staging)) posts.push(game.planets[st.staging]);
  const thirsty = game.fleets.filter(f => f.owner === p.id && f.purpose !== 'tanker' && needsFuel(game, f));
  if (thirsty.length) {
    const cx = thirsty.reduce((a, f) => a + f.x, 0) / thirsty.length, cy = thirsty.reduce((a, f) => a + f.y, 0) / thirsty.length;
    const d = [...docks].sort((a, b) => distance(a, { x: cx, y: cy }) - distance(b, { x: cx, y: cy }))[0];
    if (!posts.includes(d)) posts.push(d);
  }
  const cap = docks.find(d => d.homeworld) ?? docks[0];
  const far = [...docks].sort((a, b) => distance(b, cap) - distance(a, cap));
  for (const d of far) if (posts.length < tankers.length && !posts.includes(d)) posts.push(d);
  if (!posts.length) posts.push(cap);
  tankers.forEach((t, i) => {
    if (t.refuelFor !== undefined || t.waypoints.length > 1) return; // serving a fleet, or on its way
    const post = posts[i % posts.length];
    const w0 = t.waypoints[0];
    const range = defaultTankerRange(game, t);
    if (t.orbiting === post.id) { if (w0.task !== 'refuel') t.waypoints = [{ ...w0, task: 'refuel', processed: false, transport: undefined, patrolRange: range }]; return; }
    // already on duty somewhere close enough: stay
    if (w0.task === 'refuel' && distance(t, post) < range * 0.5) return;
    if (safeGoto(game, t, { x: post.x, y: post.y, planetId: post.id }, 'refuel', false)) t.waypoints[t.waypoints.length - 1].patrolRange = range;
  });
}

// ------------------------------------------------------------------ war

/** hit points × firepower: a rough Lanchester-style strength */
function combatScore(game: GameState, f: Fleet): number {
  const sp = fleetSpec(game, f);
  const damage = f.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0);
  return Math.max(1, sp.armor + sp.shields - damage) * Math.max(1, sp.powerRating);
}

function planetDefense(game: GameState, p: Player, planet: Planet): number {
  const pi = p.intel.planets[planet.id];
  let hp = 0, pow = 0;
  if (pi.starbaseDesign !== undefined && game.designs.some(d => d.id === pi.starbaseDesign)) {
    const sp = specOf(game, pi.starbaseDesign); hp += sp.armor + sp.shields; pow += sp.powerRating;
  }
  for (const fi of p.intel.fleets) {
    if ((fi.owner !== pi.owner && !(fi.uncertain && fi.owner < 0)) || distance(fi, planet) > 30) continue;
    if (fi.uncertain) {
      // Constellations 3: only an estimate (decoys included): assume a warship of that mass
      hp += (fi.mass ?? 0) * 3; pow += (fi.mass ?? 0) * 4; continue;
    }
    const f = game.fleets.find(x => x.id === fi.id);
    if (!f) continue;
    const sp = fleetSpec(game, f);
    if (!sp.hasWeapons) continue;
    hp += sp.armor + sp.shields; pow += sp.powerRating;
  }
  return hp * pow;
}

function warFleets(game: GameState, p: Player) {
  const st = state(p);
  const portal = st.portalTarget !== undefined ? game.planets[st.portalTarget] : undefined;
  const enemyPlanets = portal && portal.owner === st.targetPlayer ? [portal] : p.intel.planets.filter(pi => pi.owner === st.targetPlayer).map(pi => game.planets[pi.id]);
  const homes = game.planets.filter(x => x.owner === p.id);
  const docks = homes.filter(h => canRefuelAt(game, p, h));
  const war = () => game.fleets.filter(f => f.owner === p.id && (f.purpose === 'warship' || f.purpose === 'bomber') && !(f.aiGuard && f.aiGuard.until >= game.year));
  if (!docks.length) return;
  let staging = docks[0], sd = Infinity;
  for (const d of docks) for (const e of enemyPlanets) { const dd = distance(d, e); if (dd < sd) { sd = dd; staging = d; } }
  st.staging = staging.id;
  for (const f of war()) {
    if (f.waypoints.length > 1) continue;
    const here = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
    if (here && here.owner >= 0 && here.owner !== p.id && p.relations[here.owner] === 'enemy') {
      // siege: hold the orbit (bombers bomb, troops follow) unless badly hurt
      const sp = fleetSpec(game, f);
      const damage = f.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0);
      if (damage < (sp.armor + sp.shields) * 0.5) continue;
    }
    if (f.orbiting !== staging.id) travel(game, f, { x: staging.x, y: staging.y, planetId: staging.id });
  }
  const atStage = war().filter(f => f.waypoints.length <= 1 && f.orbiting === staging.id);
  if (!atStage.length) return;
  const main = atStage[0];
  for (const o of atStage.slice(1)) mergeFleets(game, main, o);
  if (!enemyPlanets.length) return;
  main.purpose = 'warship';
  const sp = fleetSpec(game, main);
  const damage = main.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0);
  if (damage > (sp.armor + sp.shields) * 0.25) return; // repair at the dock first
  if (totalShips(main) < 3) return;
  const score = combatScore(game, main);
  const cands: { e: Planet; sc: number }[] = [];
  // 0.3.9: a nemesis goes for the weakest worlds of its sworn enemy
  const hunter = st.targetPlayer !== undefined && isNemesis(game, p.id, st.targetPlayer);
  for (const e of enemyPlanets) {
    const pi = p.intel.planets[e.id];
    const def = planetDefense(game, p, e);
    if (score < def * (portal ? 1 : 2)) continue;
    const val = (pi.pop ?? 20000) + (pi.homeworld ? 300000 : 0) + 50000;
    cands.push({ e, sc: val / (distance(staging, e) + 60) / (hunter ? 1 + 4 * def / Math.max(1, score) : 1) });
  }
  // the most valuable target the fleet can reach at a decent warp (not a decades-long crawl across the galaxy)
  const home = main.waypoints[0];
  for (const c of cands.sort((a, b) => b.sc - a.sc).slice(0, 8)) {
    main.waypoints = [home];
    if (safeGoto(game, main, { x: c.e.x, y: c.e.y, planetId: c.e.id }, 'none', false) && decentLeg(game, main)) return;
  }
  main.waypoints = [home];
}

/**
 * Constellations 3.4, the crisis: the warships gather at the dock nearest the Breach. The main fleet meets a wave
 * harvesting one of the AI's worlds when clearly stronger, and goes for the Nexus once it can beat it, counting the
 * fleets of the other empires already there or on their way (at the Breach nobody fights anybody but the Harvesters).
 */
function crisisFleets(game: GameState, p: Player, breach: Planet) {
  const st = state(p);
  const docks = game.planets.filter(x => x.owner === p.id && canRefuelAt(game, p, x));
  if (!docks.length) return;
  const staging = docks.sort((a, b) => distance(a, breach) - distance(b, breach))[0];
  st.staging = staging.id;
  const nx = nexusStrength(game);
  const d = Math.max(1, distance(staging, breach));
  const rally = { x: Math.round(breach.x + (staging.x - breach.x) * RALLY / d), y: Math.round(breach.y + (staging.y - breach.y) * RALLY / d) };
  const near = (f: Fleet) => distance(f, breach) <= TRUCE_RADIUS;
  const hurt = (f: Fleet) => { const sp = fleetSpec(game, f); return f.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0) > (sp.armor + sp.shields) * 0.5; };
  const war = () => game.fleets.filter(f => f.owner === p.id && f.purpose === 'warship' && !(f.aiGuard && f.aiGuard.until >= game.year));
  // fleets add up (Lanchester): hit points with hit points, firepower with firepower
  const pool = (fs: Fleet[]) => { let hp = 0, pow = 0; for (const f of fs) { const sp = fleetSpec(game, f); hp += Math.max(0, sp.armor + sp.shields - f.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0)); pow += sp.powerRating; } return hp * pow; };
  // everything armed gathered around the Breach, whoever it belongs to (the truce holds there)
  const gathered = game.fleets.filter(f => !game.players[f.owner].monster && !game.players[f.owner].dead && f.tokens.length > 0 && near(f) && fleetSpec(game, f).hasWeapons);
  const strike = pool(gathered) >= nx * STRIKE;
  for (const f of war()) {
    if (f.waypoints.length > 1) continue;
    const atBreach = f.x === breach.x && f.y === breach.y;
    if (near(f) && !hurt(f)) {
      // at the gathering point: everyone strikes the same year, from one year away
      if (strike && !atBreach) {
        const sp = fleetSpec(game, f);
        const w = Math.max(1, Math.min(sp.maxSafeSpeed || 9, 10, Math.ceil(Math.sqrt(distance(f, breach)))));
        f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }, { x: breach.x, y: breach.y, target: 'planet', targetId: breach.id, warp: w, task: 'none' }];
      }
      continue;
    }
    if (f.orbiting !== staging.id) travel(game, f, { x: staging.x, y: staging.y, planetId: staging.id });
  }
  const atStage = war().filter(f => f.waypoints.length <= 1 && f.orbiting === staging.id);
  if (!atStage.length) return;
  const main = atStage[0];
  for (const o of atStage.slice(1)) mergeFleets(game, main, o);
  main.purpose = 'warship';
  const sp = fleetSpec(game, main);
  const damage = main.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0);
  if (damage > (sp.armor + sp.shields) * 0.25) return; // repair at the dock first
  const mine = combatScore(game, main);
  const home = main.waypoints[0];
  // a wave harvesting one of our worlds near the dock, when clearly stronger
  const threats = waves(game).filter(w => w.raid!.empire === p.id).map(w => ({ w, t: game.planets[w.raid!.target] })).filter(x => distance(x.t, staging) <= 250).sort((a, b) => distance(a.t, staging) - distance(b.t, staging));
  for (const { w, t } of threats) {
    if (mine < fleetStrength(game, w) * 1.5) continue;
    if (safeGoto(game, main, { x: t.x, y: t.y, planetId: t.id }, 'none', false) && decentLeg(game, main)) return;
    main.waypoints = [home];
  }
  // else join the gathering near the Breach
  if (mine >= nx * 0.05 && safeGoto(game, main, { x: rally.x, y: rally.y }, 'none', false)) return;
  main.waypoints = [home];
}

/** enemy planets an invasion could take, with the colonists (kT) needed */
export function troopTargets(game: GameState, p: Player): { planet: Planet; needKt: number }[] {
  const st = state(p);
  const res: { planet: Planet; needKt: number }[] = [];
  if (raceSpec(p.race).livesOnStarbases) return res;
  for (const pi of p.intel.planets) {
    if (pi.owner === undefined || pi.owner < 0 || pi.owner === p.id) continue;
    if (p.relations[pi.owner] !== 'enemy') continue;
    if (st.targetPlayer !== undefined && pi.owner !== st.targetPlayer) continue;
    if (pi.starbaseDesign !== undefined || pi.year === undefined || game.year - pi.year > 3) continue;
    const planet = game.planets[pi.id];
    const defender = game.players[pi.owner];
    const cov = planetSpec(game, planet, defender).defenseCoverage;
    const atk = raceSpec(p.race).invasionAttack, def = raceSpec(defender.race).invasionDefend;
    const pop = (pi.pop ?? 0) * Math.pow(1.12, game.year - pi.year) + 2500;
    const need = pop * def / atk / Math.max(0.15, 1 - cov * 0.75) * 1.25;
    res.push({ planet, needKt: Math.ceil(need / 100) });
  }
  return res;
}

function troopFleets(game: GameState, p: Player) {
  const st = state(p);
  st.troopClaims ??= {};
  for (const [pid, fid] of Object.entries(st.troopClaims)) {
    const f = game.fleets.find(x => x.id === fid);
    if (!f || f.waypoints.length <= 1 || game.planets[+pid].owner === p.id) delete st.troopClaims[+pid];
  }
  const freighters = () => game.fleets.filter(f => f.owner === p.id && f.purpose === 'freighter' && f.waypoints.length <= 1);
  const targets = st.phase === 'war' ? troopTargets(game, p).filter(t => st.troopClaims![t.planet.id] === undefined) : [];
  const homes = game.planets.filter(x => x.owner === p.id && !raceSpec(p.race).livesOnStarbases);
  const surplusOf = (pl: Planet) => Math.trunc(pl.pop / 100) - Math.max(300, Math.trunc(planetSpec(game, pl, p).maxPop * 0.3 / 100));
  for (const f of freighters()) {
    if (!game.fleets.includes(f) || f.waypoints.length > 1) continue;
    const here = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
    // colonists left aboard at home: put them back
    if (here && here.owner === p.id && f.cargo.colonists > 0 && !targets.length) transferWithPlanet(game, f, here, 'colonists', -f.cargo.colonists);
    if (!targets.length) continue;
    if (!here || here.owner !== p.id) {
      const src = homes.filter(h => canRefuelAt(game, p, h)).sort((a, b) => surplusOf(b) - surplusOf(a))[0];
      if (src) travel(game, f, { x: src.x, y: src.y, planetId: src.id });
      continue;
    }
    for (const o of freighters()) if (o !== f && o.orbiting === f.orbiting && game.fleets.includes(o)) mergeFleets(game, f, o);
    f.purpose = 'freighter';
    const cap = fleetSpec(game, f).cargoCapacity - cargoMass(f.cargo) + f.cargo.colonists;
    const avail = surplusOf(here) + f.cargo.colonists;
    const ok = targets.filter(t => t.needKt <= Math.min(cap, avail)).sort((a, b) => distance(here, a.planet) - distance(here, b.planet));
    const t = ok[0];
    if (t) {
      if (f.cargo.colonists < t.needKt) transferWithPlanet(game, f, here, 'colonists', Math.min(cap, avail) - f.cargo.colonists);
      const r = travel(game, f, { x: t.planet.x, y: t.planet.y, planetId: t.planet.id }, 'transport');
      if (r === 'go' || r === 'crawl') {
        f.waypoints[1].transport = { colonists: { action: 'unloadAll', amount: 0 } };
        st.troopClaims[t.planet.id] = f.id;
        targets.splice(targets.indexOf(t), 1);
      }
      continue;
    }
    const smallest = Math.min(...targets.map(x => x.needKt));
    if (avail < smallest && cap >= smallest) {
      const better = homes.filter(h => canRefuelAt(game, p, h) && surplusOf(h) >= smallest).sort((a, b) => distance(a, here) - distance(b, here))[0];
      if (better && better !== here) travel(game, f, { x: better.x, y: better.y, planetId: better.id });
    }
  }
}

// ------------------------------------------------------------------ mines

function mineLayers(game: GameState, p: Player) {
  const st = state(p);
  st.mineClaims ??= {};
  for (const [pid, fid] of Object.entries(st.mineClaims)) {
    if (!game.fleets.some(x => x.id === fid) || game.planets[+pid].owner !== p.id) delete st.mineClaims[+pid];
  }
  const layers = game.fleets.filter(f => f.owner === p.id && f.purpose === 'minelayer' && f.waypoints.length <= 1);
  if (!layers.length) return;
  const homes = game.planets.filter(x => x.owner === p.id);
  const enemies = p.intel.planets.filter(pi => pi.owner !== undefined && pi.owner >= 0 && pi.owner !== p.id && p.relations[pi.owner] !== 'friend').map(pi => game.planets[pi.id]);
  const threat = (pl: Planet) => enemies.length ? Math.min(...enemies.map(e => distance(e, pl))) : 1000;
  for (const f of layers) {
    const claimed = Object.entries(st.mineClaims).find(([, fid]) => fid === f.id);
    if (claimed && f.orbiting === +claimed[0]) {
      const wp = f.waypoints[0];
      if (wp.task !== 'layMines') { wp.task = 'layMines'; wp.layYears = undefined; wp.processed = false; }
      continue;
    }
    if (claimed) continue; // travelling or waiting
    let best: Planet | undefined, bs = -Infinity;
    for (const h of homes) {
      if (st.mineClaims[h.id] !== undefined) continue;
      const sc = h.pop / 10000 + 400 / (threat(h) + 40) - distance(f, h) / 200;
      if (sc > bs) { bs = sc; best = h; }
    }
    if (!best) continue;
    st.mineClaims[best.id] = f.id;
    if (f.orbiting === best.id) { f.waypoints[0].task = 'layMines'; f.waypoints[0].layYears = undefined; f.waypoints[0].processed = false; }
    else safeGoto(game, f, { x: best.x, y: best.y, planetId: best.id }, 'layMines', false);
  }
}

export { planetSpec };
