// Fleet movement, stargates, wormholes, minefield collisions, mineral packets.
import { hasWalls, withDetours, segmentBlocked, wallAt, wallStop, voidStop, inWall } from './walls';
import { slingshot, secretArrival } from './secrets';
import { people } from './words';
import { pointInGalaxy } from './shape';
import { diplomacyOn, statusOf } from './diplomacy';
import type { Fleet, GameState, Minefield, Packet, Planet, Player, Waypoint } from './types';
import { MINERALS } from './types';
import { Rng } from './rng';
import { fleetSpec, fuelForYear, fuelGenerated, distance, canRefuelAt, cargoMass, bestWarpForLeg, clampFleetHold, isPassThrough } from './fleet';
import { WORMHOLE_NAV, canUseWormholes, specialReqText } from './specials';
import { effectiveWarp } from './terrain';
import { specOf } from './design';
import { raceSpec } from './race';
import { RULES_RAW } from '../data/rules-raw';
import { willAttack } from './battle';
import { planetSpec } from './planet';
import { resetPlanetPolicies } from './empire';
import { borderObstacles, trespass, leaveNow } from './borders';

const MINE_STATS: Record<string, { maxSpeed: number; chanceOfHit: number; minDamagePerFleet: number; damagePerEngine: number; minDamagePerFleetRS: number; damagePerEngineRS: number; minDecay: number; sweepFactor?: number }> = {
  standard: RULES_RAW.minefieldStats.Standard, heavy: RULES_RAW.minefieldStats.Heavy, speedBump: RULES_RAW.minefieldStats.SpeedBump,
};

/** Known foreign minefields crossed by the segment a→b, with the warp above which they become dangerous. */
export function minefieldsOnLeg(game: GameState, player: Player, a: { x: number; y: number }, b: { x: number; y: number }): { id: number; owner: number; type: string; safeWarp: number }[] {
  const rs = raceSpec(player.race);
  const res: { id: number; owner: number; type: string; safeWarp: number }[] = [];
  for (const m of Object.values(player.intel.minefields)) {
    if (m.owner === player.id || player.relations[m.owner] === 'friend') continue;
    const r = Math.sqrt(m.mines);
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((m.x - a.x) * dx + (m.y - a.y) * dy) / l2)) : 0;
    if (Math.hypot(a.x + t * dx - m.x, a.y + t * dy - m.y) > r) continue;
    res.push({ id: m.id, owner: m.owner, type: m.type, safeWarp: MINE_STATS[m.type].maxSpeed + rs.mineSafeWarpBonus });
  }
  return res;
}

/**
 * 0.3.9.6: the parts of the segment a→b that run through known foreign minefields dangerous at this warp, as
 * fractions of the segment (0 at a, 1 at b), widened by `margin` light-years on each side (the field may have grown
 * since it was seen), merged when they touch; each with the safe warp of the fields it crosses.
 */
export function minefieldSpans(game: GameState, player: Player, a: { x: number; y: number }, b: { x: number; y: number }, warp: number, margin = 1): { t0: number; t1: number; safe: number }[] {
  const rs = raceSpec(player.race);
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L === 0) return [];
  const spans: { t0: number; t1: number; safe: number }[] = [];
  for (const m of Object.values(player.intel.minefields)) {
    if (m.owner === player.id || player.relations[m.owner] === 'friend') continue;
    const safe = MINE_STATS[m.type].maxSpeed + rs.mineSafeWarpBonus;
    if (warp <= safe) continue;
    const r = Math.sqrt(m.mines) + margin;
    // segment-circle intersection, in distance along the segment
    const fx = a.x - m.x, fy = a.y - m.y;
    const B = 2 * (fx * dx + fy * dy) / L, C = fx * fx + fy * fy - r * r;
    const disc = B * B - 4 * C;
    if (disc <= 0) continue;
    const s0 = (-B - Math.sqrt(disc)) / 2, s1 = (-B + Math.sqrt(disc)) / 2;
    if (s1 <= 0 || s0 >= L) continue;
    spans.push({ t0: Math.max(0, s0 / L), t1: Math.min(1, s1 / L), safe });
  }
  spans.sort((x, y) => x.t0 - y.t0);
  const out: typeof spans = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.t0 <= last.t1) { last.t1 = Math.max(last.t1, s.t1); last.safe = Math.min(last.safe, s.safe); }
    else out.push({ ...s });
  }
  return out;
}

export function targetPosition(game: GameState, wp: Waypoint, by?: number): { x: number; y: number } {
  if (wp.target === 'fleet' && wp.targetId !== undefined) {
    const f = game.fleets.find(x => x.id === wp.targetId);
    // 0.3.9.16 (help, Waypoints): a fleet sent after another empire's fleet heads for where it was last seen when it is
    // no longer in its scanners (it used to follow it anywhere, cloaked or out of sight)
    if (f && by !== undefined && f.owner !== by && !game.players[by]?.intel.fleets.some(x => x.id === f.id)) return { x: wp.x, y: wp.y };
    if (f) return { x: f.x, y: f.y };
  }
  if (wp.target === 'planet' && wp.targetId !== undefined) { const p = game.planets[wp.targetId]; return { x: p.x, y: p.y }; }
  if (wp.target === 'wormhole' && wp.targetId !== undefined) { const w = game.wormholes.find(x => x.id === wp.targetId); if (w) return { x: w.x, y: w.y }; }
  if (wp.target === 'trader' && wp.targetId !== undefined) { const t = game.traders.find(x => x.id === wp.targetId); if (t) return { x: t.x, y: t.y }; }
  return { x: wp.x, y: wp.y };
}

function msg(game: GameState, player: Player, text: string, fleet?: Fleet, kind: 'fleet' | 'minefield' | 'wormhole' | 'warning' = 'fleet') {
  player.messages.push({ year: game.year, kind, text, target: fleet ? { kind: 'fleet', id: fleet.id } : undefined });
}

/** Move every fleet one year along its route. */
export function moveFleets(game: GameState, rng: Rng) {
  for (const f of movementOrder(game)) {
    if (!game.fleets.includes(f)) continue;
    f.prevX = f.x; f.prevY = f.y;
    f.outOfFuel = false;
    f.trail = undefined;
    if (f.beaconOf !== undefined || f.immobile) { if (f.waypoints.length > 1) f.waypoints = [f.waypoints[0]]; continue; } // a beacon (or a lair, the Nexus) never moves
    // 0.3.9.11: a computer's fleet, or one under an automatic order, caught inside closed borders flies out
    if (f.borderExit) leaveNow(game, f);
    if (f.waypoints.length < 2 || f.waiting) { f.heading = null; f.lastWarp = 0; continue; }
    moveFleet(game, rng, f);
  }
}

/**
 * Fleets steering at another fleet move after it (Constellations 3.2), so that a pursuer able to reach the place
 * where its target ends the year meets it there, whatever the order the fleets were created in. Chains are
 * resolved in a few passes; a cycle keeps the creation order.
 */
function movementOrder(game: GameState): Fleet[] {
  const chasing = (f: Fleet) => f.waypoints.length >= 2 && f.waypoints[1].target === 'fleet' && f.waypoints[1].targetId !== undefined && f.waypoints[1].warp < 11;
  const order = game.fleets.filter(f => !chasing(f));
  let pending = game.fleets.filter(chasing);
  if (!pending.length) return order;
  const waiting = new Set(pending.map(f => f.id));
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next: Fleet[] = [];
    for (const f of pending) {
      if (waiting.has(f.waypoints[1].targetId!) && f.waypoints[1].targetId !== f.id) next.push(f);
      else { order.push(f); waiting.delete(f.id); }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  for (const f of pending) if (!order.includes(f)) order.push(f);
  return order;
}

/**
 * One year of travel. The fleet flies its legs in sequence: reaching a pass-through waypoint (a turn in deep
 * space, by default) it keeps the rest of its year and goes on toward the next one; any other waypoint ends
 * its movement for the year. The path flown is kept in `trail` for the scanners.
 */
function moveFleet(game: GameState, rng: Rng, f: Fleet) {
  const owner = game.players[f.owner];
  const rs = raceSpec(owner.race);
  const spec = fleetSpec(game, f);
  if (!spec.hasEngines) return;
  // stargate (only at the start of a year)
  if (f.waypoints[1].warp >= 11) {
    const wp = f.waypoints[1], t = targetPosition(game, wp, f.owner);
    wp.x = t.x; wp.y = t.y;
    gateFleet(game, rng, f, wp); return;
  }
  // 3.6: around the dark clouds (the detour is recomputed every year: targets move, orders change)
  // 0.3.9.10: and around the territories whose borders are closed to the owner
  const closed = borderObstacles(game, f.owner);
  if (hasWalls(game) || closed || f.waypoints.some(w => w.detour)) {
    const kept = f.waypoints.filter((w, i) => i === 0 || !w.detour);
    f.waypoints = withDetours(game, kept, w => targetPosition(game, w, f.owner), f.owner, closed).list;
  }
  let borderStop = false;
  const trail = [{ x: f.x, y: f.y }];
  // 0.3.7: leaving from near a known black hole, the fleet gains half a year (gravitational slingshot)
  let budget = game.secrets ? slingshot(game, f.owner, f) : 1, first = true, overwarp = false, endedOnPass = false;
  for (let guard = 0; guard < 64; guard++) {
    const wp = f.waypoints[1];
    const target = targetPosition(game, wp, f.owner);
    wp.x = target.x; wp.y = target.y;
    if (wp.warp >= 11) break; // a gate jump starts a new year
    let warp = Math.max(1, wp.warp || spec.idealSpeed || 1);
    if (f.fuel <= 0 && spec.freeSpeed > 0 && warp > spec.freeSpeed) {
      // empty tank: free speed only (user request: immediately drop to warp 1 / free speed)
      warp = Math.max(1, spec.freeSpeed);
    }
    // nebulae and dense clusters cap the speed of the year's path
    warp = effectiveWarp(game, f, target, warp, budget);
    // CE engines may refuse to engage
    if (first && rs.engineFailureRate > 0 && warp > rs.engineReliableSpeed && rng.chance(rs.engineFailureRate)) {
      msg(game, owner, `Les moteurs de ${f.name} ont refusé de démarrer cette année.`, f);
      f.heading = null; f.lastWarp = 0; return;
    }
    first = false;
    const speed = warp * warp;
    const total = distance(f, target);
    let dist = Math.min(total, speed * budget);
    if (total - dist < 1) dist = total; // arrive if within 1 ly
    // fuel
    // (as in Stars!/craig-stars: a fleet that could reach its waypoint never runs short because of rounding)
    const gotEnoughFuel = fuelForYear(game, f, warp, total) <= f.fuel;
    const fuelBefore = f.fuel;
    const cost = fuelForYear(game, f, warp, dist);
    if (cost > f.fuel) {
      const frac = f.fuel / cost;
      dist = dist * frac;
      f.fuel = 0;
      f.outOfFuel = true;
      // next legs at free speed
      for (let i = 1; i < f.waypoints.length; i++) if (f.waypoints[i].warp > Math.max(1, spec.freeSpeed) && f.waypoints[i].warp < 11) f.waypoints[i].warp = Math.max(1, spec.freeSpeed);
      msg(game, owner, `${f.name} est à court de carburant et continue à Warp ${Math.max(1, spec.freeSpeed)}.`, f, 'warning');
    } else f.fuel -= cost;
    // overwarp (checked once a year)
    if (!overwarp && warp > spec.maxSafeSpeed && spec.maxSafeSpeed > 0) {
      overwarp = true;
      for (const t of f.tokens) {
        let lost = 0;
        for (let i = 0; i < t.qty; i++) if (rng.chance(0.1)) lost++;
        if (lost) { t.qty -= lost; msg(game, owner, `${lost} vaisseau(x) de ${f.name} ont explosé en dépassant la vitesse de sécurité.`, f); }
      }
      f.tokens = f.tokens.filter(t => t.qty > 0);
      if (!f.tokens.length) { game.fleets.splice(game.fleets.indexOf(f), 1); return; }
      clampFleetHold(game, f);
    }
    const dx = target.x - f.x, dy = target.y - f.y;
    const len = Math.hypot(dx, dy) || 1;
    const start = { x: f.x, y: f.y };
    let nx = f.x + dx / len * dist, ny = f.y + dy / len * dist;
    // 3.6: a dark cloud ahead (a target inside one, or beyond, with no way around): the fleet stops at its edge
    // 0.3.7: and the void between the galaxy and the hidden cluster, that only its wormhole crosses
    const gap = voidStop(game, start, { x: nx, y: ny });
    const wall = (hasWalls(game) ? wallStop(game, start, { x: nx, y: ny }, f.owner) : null) ?? (gap ? { ...gap, cloud: '' } : null);
    if (wall && distance(start, wall) < 1) {
      // already at the edge: no way through, the orders are dropped
      f.fuel = fuelBefore;
      if (!owner.ai) msg(game, owner, gap && !wall.cloud ? `${f.name} ne peut pas franchir le vide entre l'amas et la galaxie : seul le trou de ver le traverse. Ordres de route annulés.` : `${f.name} ne trouve aucun passage à travers ${wall.cloud || 'un nuage sombre'} : ordres de route annulés.`, f, 'warning');
      f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y }];
      f.heading = null; f.lastWarp = 0;
      break;
    }
    if (wall) {
      nx = wall.x; ny = wall.y; dist = distance(start, wall);
      if (!f.outOfFuel) f.fuel = Math.max(0, fuelBefore - Math.min(fuelBefore, fuelForYear(game, f, warp, dist)));
      if (!owner.ai) msg(game, owner, gap && !wall.cloud ? `${f.name} s'arrête : au-delà, c'est le vide entre l'amas et la galaxie, que seul le trou de ver traverse.` : `${f.name} s'arrête : ${wall.cloud || 'un nuage sombre'} lui barre la route, les nuages sombres sont infranchissables.`, f, 'warning');
    }
    // 0.3.9.10: a closed border ahead: the player's own orders go in (and that is war), the computers and the
    // automatic orders stop at it
    const border = trespass(game, f, start, { x: nx, y: ny });
    if (border) {
      nx = border.x; ny = border.y; dist = distance(start, border);
      if (!f.outOfFuel) f.fuel = Math.max(0, fuelBefore - Math.min(fuelBefore, fuelForYear(game, f, warp, dist)));
      if (!owner.ai) msg(game, owner, `${f.name} s'arrête à la frontière des ${game.players[border.closer].name} : leurs frontières vous sont fermées, et y entrer leur déclarerait la guerre. Ordres de route annulés.`, f, 'warning');
      borderStop = true;
    }
    // minefields along the path
    const tank = (fl: Fleet) => fl.tokens.reduce((a, t) => a + specOf(game, t.designId).fuelCapacity * t.qty, 0);
    const tank0 = tank(f);
    const hit = checkMinefields(game, rng, f, start, { x: nx, y: ny }, warp) ?? (wall || border ? { x: nx, y: ny } : null);
    if (hit) {
      nx = hit.x; ny = hit.y; dist = distance(start, hit);
      // stopped by a mine: only the distance actually travelled is paid for
      if (!f.outOfFuel) f.fuel = Math.max(0, fuelBefore - Math.min(fuelBefore, fuelForYear(game, f, warp, dist)));
      // ships lost to the mines took their share of the tank with them
      if (game.fleets.includes(f)) { const t1 = tank(f); if (tank0 > 0 && t1 < tank0) f.fuel = Math.floor(f.fuel * t1 / tank0); clampFleetHold(game, f); }
    }
    if (total > 0) f.heading = { x: dx / len, y: dy / len };
    f.lastWarp = warp;
    const arrived = !hit && Math.abs(dist - total) < 1e-6;
    // fuel generation
    if (!f.outOfFuel && !hit) f.fuel = Math.min(spec.fuelCapacity, f.fuel + fuelGenerated(game, f, warp, dist));
    if (arrived) {
      f.x = target.x; f.y = target.y;
      trail.push({ x: f.x, y: f.y });
      budget -= Math.min(budget, total / speed);
      if (isPassThrough(f.waypoints, 1)) {
        // keep going: the waypoint is only a turn
        f.waypoints.shift();
        f.waypoints[0] = { ...f.waypoints[0], x: f.x, y: f.y, processed: true };
        f.orbiting = -1;
        if (budget > 1e-6) continue;
        endedOnPass = true;
        break;
      }
      arrive(game, f);
      break;
    }
    f.x = Math.round(nx); f.y = Math.round(ny);
    trail.push({ x: f.x, y: f.y });
    f.orbiting = -1;
    f.waypoints[0] = { x: f.x, y: f.y, target: 'space', warp: 0, task: 'none', processed: true };
    if (borderStop) { f.waypoints = [f.waypoints[0]]; f.repeat = false; f.heading = null; f.pursue = undefined; break; }
    // top up if position rounding left us short of what the rest of the leg needs
    if (gotEnoughFuel && !f.outOfFuel && !hit) {
      const need = fuelForYear(game, f, warp, distance(f, target));
      if (need > f.fuel) f.fuel = Math.min(spec.fuelCapacity, need);
    }
    break;
  }
  if (endedOnPass) { const pl = game.planets.find(p => p.x === f.x && p.y === f.y); f.orbiting = pl ? pl.id : -1; }
  if (trail.length > 1) f.trail = trail;
  // radiating engines kill colonists
  if (f.cargo.colonists > 0) {
    const radiating = f.tokens.some(t => specOf(game, t.designId).radiating);
    if (radiating && !owner.race.immune[2] && rs.habCenter[2] < 85) {
      const rate = Math.floor((86 - rs.habCenter[2]) / 2) / 100;
      const killed = Math.max(1, Math.trunc(rate * f.cargo.colonists));
      f.cargo.colonists = Math.max(0, f.cargo.colonists - killed);
    }
  }
}

function arrive(game: GameState, f: Fleet) {
  const owner = game.players[f.owner];
  const wp = f.waypoints[1];
  // wormhole traversal (needs the "Navigation des anomalies" technology)
  if (wp.target === 'wormhole' && wp.targetId !== undefined) {
    const w = game.wormholes.find(x => x.id === wp.targetId);
    const dest = w ? game.wormholes.find(x => x.id === w.destId) : undefined;
    if (w?.sealed) {
      // 0.3.7: the wormhole of the hidden cluster, sealed until an empire studies it open
      msg(game, owner, `${f.name} est arrivé au trou de ver, mais il est scellé : rien ne le traverse. Une flotte équipée d'un scanner qui reste à son embouchure peut l'étudier pour l'ouvrir (il faut « ${WORMHOLE_NAV.name} »).`, f, 'wormhole');
    } else if (w && dest && !canUseWormholes(owner)) {
      msg(game, owner, `${f.name} est arrivé au trou de ver mais ne peut pas le franchir sans la technologie « ${WORMHOLE_NAV.name} » (${specialReqText(WORMHOLE_NAV)}).`, f, 'wormhole');
    } else if (w && dest) {
      f.x = dest.x; f.y = dest.y;
      const intel = owner.intel;
      intel.wormholes[w.id] = { id: w.id, x: w.x, y: w.y, year: game.year, destId: dest.id, stability: w.stability };
      intel.wormholes[dest.id] = { id: dest.id, x: dest.x, y: dest.y, year: game.year, destId: w.id, stability: dest.stability };
      msg(game, owner, `${f.name} a franchi un trou de ver et ressort en (${Math.round(dest.x)}, ${Math.round(dest.y)}).`, f, 'wormhole');
      if (game.secrets) secretArrival(game, f);
    }
  }
  const planet = game.planets.find(p => p.x === f.x && p.y === f.y);
  f.orbiting = planet ? planet.id : -1;
  // shift waypoints
  f.waypoints.shift();
  f.waypoints[0] = { ...f.waypoints[0], x: f.x, y: f.y, processed: false };
  if (f.waypoints.length === 1 && f.repeat && f.route && f.route.length > 1) {
    // repeat orders: append the whole route again (skipping the point we are on)
    const loop = f.route.map(w => ({ ...w, transport: w.transport ? { ...w.transport } : undefined, processed: false }));
    while (loop.length && loop[0].x === f.x && loop[0].y === f.y) loop.shift();
    // the route's starting point was recorded with warp 0: give it a real speed
    const ideal = fleetSpec(game, f).idealSpeed || 5;
    for (const w of loop) if (!(w.warp > 0)) w.warp = ideal;
    f.waypoints.push(...loop);
  }
  if (planet && canRefuelAt(game, owner, planet)) f.fuel = fleetSpec(game, f).fuelCapacity;
}

/**
 * 0.3.8.7: can leg `i` of this fleet's route be a stargate jump, and at what risk? The same rules as gateFleet: a
 * gate (yours or an ally's) where the leg starts and where it ends; the range is the departure gate's, the safe
 * mass the smaller of the two; beyond 5 times either, the gate refuses; between 1 and 5 times, the ships are damaged
 * (and, for every race but Interstellar Travelers, some may be lost). Only IT can take cargo through.
 */
export interface GateCheck {
  src?: Planet; dst?: Planet;
  /** the departure has a gate this fleet may use (the speed bar then offers the jump) */
  srcGate: boolean;
  /** why the jump is impossible, if it is */
  problem?: string;
  /** what makes it risky (empty: a safe jump) */
  risks: string[];
  /** share of its armor the worst-hit ship may lose (0 to 0.98) */
  damage: number;
  lossRisk: boolean;
  dist: number; heaviest: number; safeMass: number; safeRange: number;
  /** the cargo would be left at the departure (not an IT race) */
  dropsCargo: boolean;
}
export function gateCheck(game: GameState, f: Fleet, i: number): GateCheck {
  const owner = game.players[f.owner];
  const rs = raceSpec(owner.race);
  const prev = f.waypoints[i - 1], wp = f.waypoints[i];
  const src = i === 1 ? (f.orbiting >= 0 ? game.planets[f.orbiting] : undefined) : prev?.target === 'planet' && prev.targetId !== undefined ? game.planets[prev.targetId] : undefined;
  const dst = wp?.target === 'planet' && wp.targetId !== undefined ? game.planets[wp.targetId] : undefined;
  const foreign = (p: Planet) => p.owner !== owner.id && owner.relations[p.owner] !== 'friend';
  const gateOf = (p?: Planet) => p && p.starbase && !foreign(p) ? specOf(game, p.starbase.designId).gate : null;
  const sg = gateOf(src), dg = gateOf(dst);
  const heaviest = Math.max(0, ...f.tokens.map(t => specOf(game, t.designId).mass));
  const out: GateCheck = { src, dst, srcGate: !!sg, risks: [], damage: 0, lossRisk: false, dist: src && dst ? distance(src, dst) : 0, heaviest, safeMass: 0, safeRange: 0, dropsCargo: false };
  const hasGate = (p: Planet) => !!(p.starbase && specOf(game, p.starbase.designId).gate);
  if (!src) out.problem = 'il faut partir d\'une planète qui a une porte stellaire';
  else if (!hasGate(src)) out.problem = `${src.name} n'a pas de porte stellaire`;
  else if (foreign(src)) out.problem = `la porte de ${src.name} appartient aux ${game.players[src.owner].name}, qui ne sont pas vos alliés`;
  else if (!dst) out.problem = 'la destination n\'est pas une planète';
  else if (!hasGate(dst)) out.problem = `${dst.name} n'a pas de porte stellaire`;
  else if (foreign(dst)) out.problem = `la porte de ${dst.name} appartient aux ${game.players[dst.owner].name}, qui ne sont pas vos alliés`;
  if (out.problem || !sg || !dg) return out;
  out.safeRange = sg.safeRange; out.safeMass = Math.min(sg.safeMass, dg.safeMass);
  const inf = (v: number) => v >= 1e9;
  if (!inf(out.safeRange) && out.dist > out.safeRange * 5) { out.problem = `${Math.round(out.dist)} al, plus de cinq fois la portée sûre de la porte de ${src!.name} (${out.safeRange} al)`; return out; }
  if (!inf(out.safeMass) && heaviest > out.safeMass * 5) { out.problem = `le plus lourd de vos vaisseaux (${heaviest} kt) dépasse cinq fois la masse sûre des portes (${out.safeMass} kt)`; return out; }
  if (!inf(out.safeRange) && out.dist > out.safeRange) out.risks.push(`${Math.round(out.dist)} al pour une portée sûre de ${out.safeRange} al`);
  if (!inf(out.safeMass) && heaviest > out.safeMass) out.risks.push(`le plus lourd de vos vaisseaux pèse ${heaviest} kt pour une masse sûre de ${out.safeMass} kt`);
  for (const t of f.tokens) {
    const s = specOf(game, t.designId);
    const rangeF = inf(out.safeRange) || out.dist <= out.safeRange ? 0 : (out.dist - out.safeRange) / (4 * out.safeRange);
    const fm = (safe: number) => s.mass > safe && !inf(safe) ? (5 * safe - s.mass) / (4 * safe) : 1;
    const massF = 1 - fm(sg.safeMass) * fm(dg.safeMass);
    out.damage = Math.max(out.damage, Math.min(0.98, massF + (1 - massF) * rangeF));
  }
  out.lossRisk = out.damage > 0 && rs.shipsVanishInVoid;
  out.dropsCargo = !rs.canGateCargo && cargoMass(f.cargo) > 0 && src!.owner === owner.id;
  return out;
}

function gateFleet(game: GameState, rng: Rng, f: Fleet, wp: Waypoint) {
  const owner = game.players[f.owner];
  const src = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
  const dst = wp.target === 'planet' && wp.targetId !== undefined ? game.planets[wp.targetId] : undefined;
  const gateOf = (p?: Planet) => {
    if (!p || !p.starbase) return null;
    if (p.owner !== owner.id && owner.relations[p.owner] !== 'friend') return null;
    return specOf(game, p.starbase.designId).gate;
  };
  const sg = gateOf(src), dg = gateOf(dst);
  if (!sg || !dg || !src || !dst) {
    msg(game, owner, `${f.name} ne peut pas utiliser de porte stellaire : il faut une porte au départ et à l'arrivée.`, f);
    wp.warp = fleetSpec(game, f).idealSpeed || 5;
    return;
  }
  const dist = distance(src, dst);
  const rs = raceSpec(owner.race);
  // cargo: only IT may gate cargo (others dump it on the source planet)
  if (!rs.canGateCargo && cargoMass(f.cargo) > 0) {
    if (src.owner === owner.id) {
      for (const m of MINERALS) { src.surface[m] += f.cargo[m]; f.cargo[m] = 0; }
      src.pop += f.cargo.colonists * 100; f.cargo.colonists = 0;
    }
  }
  const safeRange = sg.safeRange, safeMass = Math.min(sg.safeMass, dg.safeMass);
  if (safeRange < 1e9 && dist > safeRange * 5) { msg(game, owner, `${f.name} : destination trop lointaine pour la porte (portée ${safeRange} al).`, f); return; }
  for (const t of f.tokens) {
    const s = specOf(game, t.designId);
    if (safeMass < 1e9 && s.mass > safeMass * 5) { msg(game, owner, `${f.name} : un vaisseau est trop lourd pour la porte.`, f); return; }
  }
  // overgating damage / loss
  for (const t of f.tokens) {
    const s = specOf(game, t.designId);
    const rangeF = safeRange >= 1e9 || dist <= safeRange ? 0 : (dist - safeRange) / (4 * safeRange);
    const fm = (safe: number) => s.mass > safe && safe < 1e9 ? (5 * safe - s.mass) / (4 * safe) : 1;
    const massF = 1 - fm(sg.safeMass) * fm(dg.safeMass);
    const total = Math.min(0.98, massF + (1 - massF) * rangeF);
    if (total > 0) {
      if (rs.shipsVanishInVoid) {
        const rangeChance = Math.floor(100 * rangeF / 3) / 100;
        const massChance = s.mass > sg.safeMass ? Math.floor(100 / 3 * (1 - ((5 * sg.safeMass - s.mass) ** 2) / ((4 * sg.safeMass) ** 2))) / 100 : 0;
        const p = 1 - (1 - rangeChance) * (1 - Math.max(0, massChance));
        let lost = 0;
        for (let i = 0; i < t.qty; i++) if (rng.chance(p)) lost++;
        t.qty -= lost;
        if (lost) msg(game, owner, `${lost} vaisseau(x) de ${f.name} se sont perdus dans le vide en franchissant la porte.`, f);
      }
      const perShip = Math.round(total * s.armor);
      if (t.qty > 0 && perShip > 0) { t.damage = Math.min(s.armor - 1, t.damage + perShip); t.qtyDamaged = t.qty; }
    }
  }
  f.tokens = f.tokens.filter(t => t.qty > 0);
  if (!f.tokens.length) { game.fleets.splice(game.fleets.indexOf(f), 1); return; }
  f.heading = { x: (dst.x - src.x) / (dist || 1), y: (dst.y - src.y) / (dist || 1) };
  f.lastWarp = 11;
  f.x = dst.x; f.y = dst.y;
  f.orbiting = dst.id;
  f.waypoints.shift();
  f.waypoints[0] = { ...f.waypoints[0], x: f.x, y: f.y, processed: false };
}

/**
 * Returns the position where the fleet was stopped by a mine hit, or null. Applies damage. 0.3.9.16 (Stars!, "Guts of
 * Minefields"): fields of the same kind that overlap are rolled once for each light-year of the path, not once each
 * (which doubled the risk where they overlap), and in the order the fleet meets them; the field struck is the one whose
 * centre is nearest.
 */
function checkMinefields(game: GameState, rng: Rng, f: Fleet, a: { x: number; y: number }, b: { x: number; y: number }, warp: number): { x: number; y: number } | null {
  const owner = game.players[f.owner];
  const rs = raceSpec(owner.race);
  const dx = b.x - a.x, dy = b.y - a.y;
  const A = dx * dx + dy * dy;
  if (A === 0) return null;
  const len = Math.sqrt(A);
  // the fields that can strike this fleet on this leg, with the stretch of the path they cover
  const near: { m: Minefield; t1: number; t2: number; chance: number }[] = [];
  for (const m of game.minefields) {
    if (m.owner === f.owner) continue;
    const mo = game.players[m.owner];
    if (owner.relations[m.owner] === 'friend' && mo.relations[f.owner] === 'friend') continue;
    if (mo.relations[f.owner] === 'friend') continue;
    if (diplomacyOn(game) && !mo.monster && !owner.monster && statusOf(game, m.owner, f.owner) !== 'war') continue; // 3.4: mines spare empires at peace
    const st = MINE_STATS[m.type];
    const safe = st.maxSpeed + rs.mineSafeWarpBonus;
    if (warp <= safe) continue;
    const radius = Math.sqrt(m.mines);
    // segment-circle intersection
    const fx = a.x - m.x, fy = a.y - m.y;
    const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - radius * radius;
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
    if (t2 < 0 || t1 > 1) continue;
    near.push({ m, t1: Math.max(0, t1), t2: Math.min(1, t2), chance: st.chanceOfHit * (warp - safe) });
  }
  if (!near.length) return null;
  const steps = Math.ceil(len - 1e-9);
  for (let ly = 0; ly < steps; ly++) {
    const t = Math.min(1, (ly + 1) / len);
    const pt = { x: a.x + dx * t, y: a.y + dy * t };
    // one roll per kind of field covering this light-year
    const kinds = new Map<string, { m: Minefield; chance: number }[]>();
    for (const n of near) if (t > n.t1 - 1e-9 && t - 1 / len < n.t2 + 1e-9) { const l = kinds.get(n.m.type) ?? []; l.push(n); kinds.set(n.m.type, l); }
    for (const list of kinds.values()) {
      if (!rng.chance(Math.max(...list.map(x => x.chance)))) continue;
      const m = list.map(x => x.m).sort((p, q) => distance(p, pt) - distance(q, pt))[0];
      const pos = { x: Math.round(pt.x), y: Math.round(pt.y) };
      mineDamage(game, f, m, false, pos);
      // reduce minefield
      reduceOnImpact(m);
      msg(game, owner, `${f.name} a heurté un champ de mines ${m.type === 'speedBump' ? 'ralentisseur' : ''} en (${pos.x}, ${pos.y}).`, f, 'minefield');
      game.players[m.owner].messages.push({ year: game.year, kind: 'minefield', text: `Une flotte ${owner.name} a heurté votre champ de mines en (${Math.round(m.x)}, ${Math.round(m.y)}).`, target: { kind: 'minefield', id: m.id } });
      return pos;
    }
  }
  return null;
}

/** Mines lost by a field each time a fleet strikes it (Stars!: 10 under 200 mines, 5 % up to 1 000, 50 up to 5 000, 1 % beyond). */
export function reduceOnImpact(m: Minefield) {
  if (m.mines <= 10) m.mines = 0;
  else if (m.mines <= 200) m.mines -= 10;
  else if (m.mines <= 1000) m.mines = Math.trunc(m.mines * 0.95);
  else if (m.mines <= 5000) m.mines -= 50;
  else m.mines = Math.trunc(m.mines * 0.99);
}

/**
 * Damage of a mine hit, as in Stars! ("Guts of Minefields"; 0.3.9.16): each ship takes its share, by engine, and a fleet of
 * five ships or fewer takes at least the minimum of the field (times the engines of its ships); a stack's shields (all of
 * them) absorb up to half of what it takes, the rest is shared equally by its ships: they all survive damaged, or all go
 * if that is more than their armour. Before, one ship's shields counted for the whole stack and the damage killed ships
 * one armour's worth at a time (10 destroyers hit for 1,000 lost 5; they all survive, at 100 damage each). The ships lost
 * take their share of the cargo with them: its minerals are left at the point of impact (on the planet, in orbit).
 */
export function mineDamage(game: GameState, f: Fleet, m: Minefield, detonation: boolean, at?: { x: number; y: number }) {
  const st = MINE_STATS[m.type];
  if (m.type === 'speedBump') return;
  const owner = game.players[f.owner];
  const specs = f.tokens.map(t => ({ t, s: specOf(game, t.designId) }));
  if (detonation && specs.some(x => game.designs.find(d => d.id === x.t.designId)?.owner === m.owner)) return;
  const scoop = specs.some(x => x.s.freeSpeed > 1);
  const minDmg = scoop ? st.minDamagePerFleetRS : st.minDamagePerFleet;
  const perEngine = scoop ? st.damagePerEngineRS : st.damagePerEngine;
  const ships = f.tokens.reduce((a, t) => a + t.qty, 0);
  // a small fleet: the minimum, spread over its ships (upstream craig-stars, matching the "Guts": 500 x engines per ship)
  const extra = ships < 5 ? Math.max(0, minDmg - perEngine * ships) : 0;
  const before = f.tokens.map(t => ({ t, qty: t.qty }));
  let lostShips = 0;
  specs.forEach(({ t, s }, i) => {
    const engines = Math.max(1, s.numEngines);
    const dmg = (perEngine * t.qty + (i === 0 ? extra : 0)) * (s.numEngines > 0 ? engines : 1);
    if (dmg <= 0 || t.qty <= 0) return;
    const absorbed = Math.min(s.shields * t.qty, dmg / 2);
    const per = (dmg - absorbed) / t.qty;
    // the damaged ships of the stack, then all of it, go if their share is more than the armour they have left
    const damaged = t.qtyDamaged > 0 ? t.damage : 0;
    let killed = 0;
    if (per >= s.armor) killed = t.qty;
    else if (damaged > 0 && damaged + per >= s.armor) killed = t.qtyDamaged;
    if (killed >= t.qty) { t.qty = 0; t.qtyDamaged = 0; t.damage = 0; }
    else {
      const keptDamaged = killed ? 0 : t.qtyDamaged;
      t.qty -= killed;
      const avg = per + (keptDamaged > 0 ? damaged * keptDamaged / t.qty : 0);
      t.damage = Math.min(s.armor - 1, Math.floor(avg));
      t.qtyDamaged = t.damage > 0 ? t.qty : 0;
    }
    lostShips += killed;
  });
  if (lostShips) { owner.stats.shipsLost += lostShips; owner.messages.push({ year: game.year, kind: 'minefield', text: `${lostShips} vaisseau(x) de ${f.name} ont été détruits par des mines.`, target: { kind: 'fleet', id: f.id } }); }
  // the cargo of the ships lost
  const cap0 = before.reduce((a, b) => a + specOf(game, b.t.designId).cargoCapacity * b.qty, 0);
  const cap1 = before.reduce((a, b) => a + specOf(game, b.t.designId).cargoCapacity * b.t.qty, 0);
  if (cap0 > 0 && cap1 < cap0) {
    const share = (cap0 - cap1) / cap0;
    const left = { ironium: 0, boranium: 0, germanium: 0 };
    for (const k of ['ironium', 'boranium', 'germanium'] as const) { const n = cap1 > 0 ? Math.ceil(f.cargo[k] * share - 1e-9) : f.cargo[k]; left[k] = n; f.cargo[k] -= n; }
    f.cargo.colonists -= cap1 > 0 ? Math.ceil(f.cargo.colonists * share - 1e-9) : f.cargo.colonists;
    if (left.ironium + left.boranium + left.germanium > 0) {
      const p = at ?? { x: f.x, y: f.y };
      const pl = game.planets.find(q => q.x === Math.round(p.x) && q.y === Math.round(p.y));
      if (pl) { pl.surface.ironium += left.ironium; pl.surface.boranium += left.boranium; pl.surface.germanium += left.germanium; }
      else game.salvage.push({ id: game.nextId++, owner: -1, x: Math.round(p.x), y: Math.round(p.y), cargo: left, age: 0 });
    }
  }
  const fuel0 = before.reduce((a, b) => a + specOf(game, b.t.designId).fuelCapacity * b.qty, 0);
  const fuel1 = before.reduce((a, b) => a + specOf(game, b.t.designId).fuelCapacity * b.t.qty, 0);
  if (fuel0 > 0 && fuel1 < fuel0) f.fuel = Math.floor(f.fuel * fuel1 / fuel0);
  f.tokens = f.tokens.filter(t => t.qty > 0);
  if (!f.tokens.length) game.fleets.splice(game.fleets.indexOf(f), 1);
  else clampFleetHold(game, f);
}

/** SD remote detonation */
export function detonateMinefields(game: GameState) {
  for (const m of game.minefields) {
    if (!m.detonate || m.type !== 'standard') continue;
    const r = Math.sqrt(m.mines);
    for (const f of [...game.fleets]) if (distance(f, m) <= r && f.owner !== m.owner) mineDamage(game, f, m, true);
    // the field pays for it with an extra 25 % decay (see minefieldDecay)
  }
}

/**
 * Yearly decay of a minefield, as in Stars! ("Guts of Minefields"): 2 % a year, plus 4 % for every planet inside
 * the field (1 % for Space Demolition), plus 25 % while an SD field is set to detonate; at most 50 % a year and at
 * least 10 mines (2 for speed bumps). A bigger field covers more planets, so it wears faster.
 */
export function minefieldDecay(game: GameState, m: { x: number; y: number; mines: number; type: string; owner: number; detonate?: boolean }): { lost: number; rate: number; planets: number } {
  const rs = raceSpec(game.players[m.owner].race);
  const r = Math.sqrt(m.mines);
  const planets = game.planets.filter(p => distance(p, m) <= r).length;
  const rate = Math.min(0.5, 0.02 + 0.04 * rs.minefieldDecayFactor * planets + (m.detonate ? 0.25 : 0));
  const lost = Math.min(m.mines, Math.max(m.type === 'speedBump' ? 2 : 10, Math.trunc(m.mines * rate + 0.5)));
  return { lost, rate, planets };
}

/** Years before a field left alone falls apart (decay only). */
export function minefieldLifetime(game: GameState, m: { x: number; y: number; mines: number; type: string; owner: number; detonate?: boolean }): number {
  const f = { ...m };
  for (let y = 1; y <= 500; y++) { f.mines -= minefieldDecay(game, f).lost; if (f.mines <= 10) return y; }
  return Infinity;
}

/**
 * 0.3.8.1: the fleets that will lay mines into this field at the end of the year, as processMineLaying does (after
 * the decay, a fleet that lays where it stands feeds the first field of its type whose radius covers it). Fleets
 * laying on the move (Space Demolition) are left out: where they will be is not known yet.
 */
export function minefieldLayers(game: GameState, fieldId: number): { fleet: Fleet; rate: number; years?: number }[] {
  const out: { fleet: Fleet; rate: number; years?: number }[] = [];
  const after = new Map(game.minefields.map(m => [m.id, m.mines - minefieldDecay(game, m).lost]));
  for (const f of game.fleets) {
    const wp = f.waypoints[0];
    if (wp?.task !== 'layMines' || f.waypoints.length !== 1) continue;
    const spec = fleetSpec(game, f);
    for (const type of ['standard', 'heavy', 'speedBump'] as const) {
      const rate = spec.mineLaying[type];
      if (rate <= 0) continue;
      const field = game.minefields.find(m => m.owner === f.owner && m.type === type && after.get(m.id)! > 10 && distance(m, f) <= Math.sqrt(after.get(m.id)!));
      if (field?.id === fieldId) out.push({ fleet: f, rate, years: wp.layYears || undefined });
    }
  }
  return out;
}

/**
 * 0.3.8.1: where a field goes with the fleets laying into it: each year the decay, then the new mines (the centre
 * drifts toward the layers, as in layMines). A bigger field covers more planets and wears faster, so a growing field
 * levels off where the decay equals what is laid. `final` is that level (0 if the field dies, `gone` years from now),
 * `years` when it gets within a few percent of it.
 */
export function minefieldOutlook(game: GameState, m: { x: number; y: number; mines: number; type: string; owner: number; detonate?: boolean }, layers: { fleet: { x: number; y: number }; rate: number; years?: number }[]): { final: number; years: number; gone?: number } {
  const f = { ...m };
  const traj: number[] = [];
  for (let y = 1; y <= 300; y++) {
    f.mines -= minefieldDecay(game, f).lost;
    if (f.mines <= 10) f.mines = 0; // the field is gone; a fleet still laying starts a new one where it stands
    for (const l of layers) {
      if (l.years !== undefined && l.years < y) continue;
      f.mines += l.rate;
      const k = Math.min(1, l.rate / f.mines);
      f.x += (l.fleet.x - f.x) * k; f.y += (l.fleet.y - f.y) * k;
    }
    if (f.mines <= 10) return { final: 0, years: y, gone: y };
    traj.push(f.mines);
  }
  const final = traj[traj.length - 1];
  const near = Math.max(10, final * 0.03);
  let years = traj.length;
  while (years > 0 && Math.abs(traj[years - 1] - final) <= near) years--;
  return { final, years: years + 1 };
}

export function decayMinefields(game: GameState) {
  for (const m of game.minefields) m.mines -= minefieldDecay(game, m).lost;
  game.minefields = game.minefields.filter(m => m.mines > 10);
}

export function layMines(game: GameState, f: Fleet, moving: boolean) {
  const owner = game.players[f.owner];
  const rs = raceSpec(owner.race);
  const spec = fleetSpec(game, f);
  for (const type of ['standard', 'heavy', 'speedBump'] as const) {
    let rate = spec.mineLaying[type];
    if (moving) rate = Math.trunc(rate * rs.minefieldMoveFactor);
    if (rate <= 0) continue;
    let field = game.minefields.find(m => m.owner === f.owner && m.type === type && distance(m, f) <= Math.sqrt(m.mines));
    if (!field) {
      field = { id: game.nextId++, owner: f.owner, x: f.x, y: f.y, mines: 0, type, detonate: false };
      game.minefields.push(field);
    }
    const before = field.mines;
    field.mines += rate;
    const d = distance(field, f);
    if (d > 0) {
      const k = Math.min(1, rate / field.mines);
      field.x += (f.x - field.x) * k; field.y += (f.y - field.y) * k;
    }
    void before;
  }
}

export function sweepMines(game: GameState) {
  for (const f of game.fleets) {
    const spec = fleetSpec(game, f);
    if (spec.mineSweep <= 0) continue;
    const owner = game.players[f.owner];
    const plan = owner.battlePlans.find(b => b.id === f.battlePlan) ?? owner.battlePlans[0];
    for (const m of game.minefields) {
      if (m.owner === f.owner || !willAttack(game, owner, plan, m.owner)) continue;
      const d = distance(f, m);
      if (d > Math.sqrt(m.mines)) continue;
      const sweepable = m.mines - Math.ceil(d * d);
      const swept = Math.max(0, Math.min(sweepable, Math.trunc(spec.mineSweep * (m.type === 'speedBump' ? 1 / 3 : 1))));
      if (swept > 0) {
        m.mines -= swept;
        owner.messages.push({ year: game.year, kind: 'minefield', text: `${f.name} a balayé ${swept} mines.`, target: { kind: 'fleet', id: f.id } });
      }
    }
  }
  // starbases sweep too
  for (const p of game.planets) {
    if (!p.starbase || p.owner < 0) continue;
    const s = specOf(game, p.starbase.designId);
    if (s.mineSweep <= 0) continue;
    const owner = game.players[p.owner];
    for (const m of game.minefields) {
      if (m.owner === p.owner || !willAttack(game, owner, owner.battlePlans[0], m.owner)) continue;
      const d = distance(p, m);
      if (d > Math.sqrt(m.mines)) continue;
      m.mines -= Math.max(0, Math.min(m.mines - Math.ceil(d * d), Math.trunc(s.mineSweep)));
    }
  }
  game.minefields = game.minefields.filter(m => m.mines > 10);
}

// ------------------------------------------------------------------ packets

export function launchPacket(game: GameState, planet: Planet, cargo: { ironium: number; boranium: number; germanium: number }) {
  if (planet.packetTarget === undefined || !planet.starbase) return;
  const s = specOf(game, planet.starbase.designId);
  if (!s.driver) return;
  const existing = game.packets.find(k => k.sourceId === planet.id && k.newThisTurn);
  if (existing) { existing.cargo.ironium += cargo.ironium; existing.cargo.boranium += cargo.boranium; existing.cargo.germanium += cargo.germanium; return; }
  const warp = Math.min(planet.packetWarp, s.driver.safeSpeed + 3);
  game.packets.push({ id: game.nextId++, owner: planet.owner, x: planet.x, y: planet.y, targetId: planet.packetTarget, warp, safeWarp: s.driver.safeSpeed, cargo: { ...cargo }, newThisTurn: true, sourceId: planet.id });
}

export function movePackets(game: GameState, rng: Rng, newOnes: boolean) {
  for (const k of [...game.packets]) {
    if (k.newThisTurn !== newOnes) continue;
    const target = game.planets[k.targetId];
    const per = k.warp * k.warp * (newOnes ? 0.5 : 1);
    const d = distance(k, target);
    // decay when over safe speed
    const owner = game.players[k.owner];
    const rs = raceSpec(owner.race);
    const travelled = Math.min(d, per);
    // 3.6: a packet flies straight: a dark cloud on its way swallows it
    if (hasWalls(game)) {
      const end = d <= per ? target : { x: k.x + (target.x - k.x) / d * per, y: k.y + (target.y - k.y) / d * per };
      if (segmentBlocked(game, k, end)) {
        let cloud = 'un nuage sombre';
        for (let t = 0.05; t <= 1; t += 0.05) { const nm = wallAt(game, k.x + (end.x - k.x) * t, k.y + (end.y - k.y) * t); if (nm) { cloud = nm; break; } }
        if (!owner.ai) owner.messages.push({ year: game.year, kind: 'packet', text: `Un paquet de minerais lancé vers ${target.name} s'est perdu dans ${cloud} : les nuages sombres sont infranchissables.`, target: { kind: 'planet', id: target.id } });
        game.packets.splice(game.packets.indexOf(k), 1);
        continue;
      }
    }
    if (k.warp > k.safeWarp || rs.packetOverSafePenalty > 0) {
      const over = Math.min(Math.min(k.warp - k.safeWarp, 3) + rs.packetOverSafePenalty, 3);
      if (over > 0) {
        const rate = ({ 1: 0.1, 2: 0.25, 3: 0.5 } as Record<number, number>)[over] * rs.packetDecayFactor * travelled / (k.warp * k.warp);
        for (const m of MINERALS) k.cargo[m] = Math.max(0, k.cargo[m] - Math.max(Math.trunc(rate * k.cargo[m]), Math.trunc(10 * rs.packetDecayFactor)));
      }
    }
    if (d <= per) {
      packetArrive(game, rng, k, target);
      game.packets.splice(game.packets.indexOf(k), 1);
    } else {
      k.x += (target.x - k.x) / d * per; k.y += (target.y - k.y) / d * per;
    }
    k.newThisTurn = false;
  }
  game.packets = game.packets.filter(k => k.cargo.ironium + k.cargo.boranium + k.cargo.germanium > 0);
}

function packetArrive(game: GameState, rng: Rng, k: Packet, planet: Planet) {
  const weight = k.cargo.ironium + k.cargo.boranium + k.cargo.germanium;
  const owner = game.players[k.owner];
  let caughtFrac = 1, damage = 0;
  if (planet.owner >= 0) {
    const sb = planet.starbase ? specOf(game, planet.starbase.designId) : null;
    const recvSafe = sb?.driver ? sb.driver.safeSpeed * raceSpec(game.players[planet.owner].race).packetReceiverFactor : 0;
    if (recvSafe < k.warp) {
      const vP = k.warp * k.warp, vR = recvSafe * recvSafe;
      caughtFrac = vR / vP;
      const spec = planetSpec(game, planet);
      const raw = (vP - vR) * weight / 160;
      damage = raw * (1 - spec.defenseCoverage);
    }
  } else caughtFrac = 0;
  const deliveredFrac = planet.owner < 0 ? 1 : caughtFrac + (1 - caughtFrac) / 3;
  for (const m of MINERALS) planet.surface[m] += Math.trunc(k.cargo[m] * deliveredFrac);
  if (damage > 0 && planet.owner >= 0 && planet.pop > 0) {
    const killed = Math.min(planet.pop, Math.round(Math.max(damage * planet.pop / 1000, damage * 100) / 100) * 100);
    const defLost = Math.min(planet.defenses, Math.trunc(Math.max(planet.defenses * damage / 1000, damage / 20)));
    planet.pop -= killed; planet.defenses -= defLost;
    const po = game.players[planet.owner];
    po.messages.push({ year: game.year, kind: 'packet', text: `Un paquet de minerais non intercepté a frappé ${planet.name} : ${people(game, killed)} colons tués, ${defLost} défenses détruites.`, target: { kind: 'planet', id: planet.id } });
    if (k.owner !== planet.owner) owner.messages.push({ year: game.year, kind: 'packet', text: `Votre paquet a frappé ${planet.name} : ${people(game, killed)} colons tués.`, target: { kind: 'planet', id: planet.id } });
    if (planet.pop <= 0) { planet.pop = 0; planet.owner = -1; planet.queue = []; planet.starbase = null; resetPlanetPolicies(planet); }
  } else if (planet.owner === k.owner || planet.owner < 0) {
    owner.messages.push({ year: game.year, kind: 'packet', text: `Un paquet de ${weight} kt est arrivé sur ${planet.name}.`, target: { kind: 'planet', id: planet.id } });
  }
  // PP terraforming from uncaught packets
  if (raceSpec(owner.race).packetTerraform && caughtFrac < 1 && planet.owner >= 0) {
    for (let i = 0; i < 3; i++) {
      const m = MINERALS[i];
      const chance = 0.5 * k.cargo[m] / 100;
      if (rng.chance(Math.min(1, chance))) {
        const center = raceSpec(owner.race).habCenter[i];
        if (planet.hab[i] !== center) planet.hab[i] += Math.sign(center - planet.hab[i]);
      }
    }
  }
}

// ------------------------------------------------------------------ wormholes

const STAB_ORDER = ['rockSolid', 'stable', 'mostlyStable', 'average', 'slightlyVolatile', 'volatile', 'extremelyVolatile'] as const;
export function updateWormholes(game: GameState, rng: Rng) {
  const stats: Record<string, { yearsToDegrade: number; chanceToJump: number; jiggleDistance: number }> = RULES_RAW.wormholeStats;
  const keyOf = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  for (const w of game.wormholes) {
    if (w.fixed) continue; // 0.3.7: the wormhole of the hidden cluster
    const st = stats[keyOf(w.stability)] ?? { yearsToDegrade: 5, chanceToJump: 0.03, jiggleDistance: 10 };
    const J = st.jiggleDistance;
    const jx = Math.max(10, Math.min(game.width - 10, w.x + rng.int(J + 1) - J / 2));
    const jy = Math.max(10, Math.min(game.height - 10, w.y + rng.int(J + 1) - J / 2));
    // 0.3.7: never into a dark cloud (no ship could reach it there)
    if (!inWall(game, jx, jy)) { w.x = jx; w.y = jy; }
    w.yearsAtStability++;
    if (st.yearsToDegrade > 0 && w.yearsAtStability > st.yearsToDegrade && w.stability !== 'extremelyVolatile') {
      w.stability = STAB_ORDER[STAB_ORDER.indexOf(w.stability as typeof STAB_ORDER[number]) + 1];
      w.yearsAtStability = 0;
    }
    if (rng.chance(st.chanceToJump)) {
      if (game.shape) { let pt = pointInGalaxy(game, rng, 20, 0.12); for (let t = 0; t < 20 && inWall(game, pt.x, pt.y); t++) pt = pointInGalaxy(game, rng, 20, 0.12); w.x = pt.x; w.y = pt.y; }
      else { w.x = 20 + rng.int(game.width - 40); w.y = 20 + rng.int(game.height - 40); }
      w.stability = 'rockSolid'; w.yearsAtStability = 0;
      // the jump makes previous knowledge of the link stale
      for (const p of game.players) {
        if (p.intel.wormholes[w.id]) delete p.intel.wormholes[w.id];
        const other = p.intel.wormholes[w.destId];
        if (other) other.destId = undefined;
      }
    }
  }
}

export { bestWarpForLeg };
