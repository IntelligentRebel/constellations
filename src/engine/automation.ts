// Quality-of-life automation for human players: standing orders and threat warnings.
import { reachable } from './secrets';
import type { Fleet, GameState, Planet, Player } from './types';
import { fleetSpec, distance, canRefuelAt } from './fleet';
import { safeGoto } from './ai';
import { estimateTrajectory } from './scan';

import { AUTO_EXPLORE, canAutoExplore } from './specials';
/** Automatic exploration is a technology: Électronique 6 ("Protocoles d'exploration autonome"). */
export { AUTO_EXPLORE, canAutoExplore };

/** Runs standing orders (auto-exploration) for every human player. */
export function runAutomation(game: GameState) {
  for (const p of game.players) {
    if (p.ai || p.dead) continue;
    if (!canAutoExplore(p)) { for (const f of game.fleets) if (f.owner === p.id && f.auto === 'explore') f.auto = undefined; continue; }
    const fleets = game.fleets.filter(f => f.owner === p.id && f.auto === 'explore' && f.waypoints.length <= 1);
    if (!fleets.length) continue;
    const targeted = new Set<number>();
    for (const f of game.fleets) {
      if (f.owner !== p.id || f.waypoints.length <= 1) continue;
      const w = f.waypoints[f.waypoints.length - 1];
      if (w.target === 'planet' && w.targetId !== undefined) targeted.add(w.targetId);
    }
    for (const f of fleets) autoExplore(game, p, f, targeted);
  }
}

/** Sends one fleet to the nearest unexplored planet it can reach safely. Returns false if nothing is left. */
export function autoExplore(game: GameState, p: Player, f: Fleet, targeted = new Set<number>()): boolean {
  const spec = fleetSpec(game, f);
  if (!spec.hasEngines) { f.auto = undefined; return false; }
  const candidates: Planet[] = p.intel.planets.filter(pi => pi.year === undefined && !pi.unknown && !targeted.has(pi.id)).map(pi => game.planets[pi.id]).filter(pl => !pl.hidden || reachable(game, p, pl)).sort((a, b) => distance(a, f) - distance(b, f));
  const docks = game.planets.filter(pl => canRefuelAt(game, p, pl)).sort((a, b) => distance(a, f) - distance(b, f));
  const lowFuel = f.fuel < spec.fuelCapacity * 0.35 && spec.freeSpeed < 4;
  if (!lowFuel || !docks.length) {
    for (const pl of candidates.slice(0, 10)) {
      // crawling at a very low warp is pointless: refuel instead
      if (safeGoto(game, f, { x: pl.x, y: pl.y, planetId: pl.id }) && f.waypoints[1].warp >= Math.min(5, spec.idealSpeed - 1)) { targeted.add(pl.id); return true; }
      f.waypoints = [f.waypoints[0]];
    }
  }
  // nothing reachable at a decent speed: refuel first if possible, otherwise stop
  if (candidates.length && docks.length && f.fuel < spec.fuelCapacity * 0.9 && distance(docks[0], f) > 0) {
    if (safeGoto(game, f, { x: docks[0].x, y: docks[0].y, planetId: docks[0].id }, 'none', false)) {
      p.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} retourne faire le plein à ${docks[0].name} avant de reprendre l'exploration.`, target: { kind: 'fleet', id: f.id } });
      return true;
    }
  }
  f.auto = undefined;
  p.messages.push({ year: game.year, kind: 'fleet', text: candidates.length ? `${f.name} : plus aucune planète inexplorée à portée. Exploration automatique arrêtée.` : `${f.name} : toutes les planètes connues ont été explorées. Exploration automatique arrêtée.`, target: { kind: 'fleet', id: f.id } });
  return false;
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Warns human players about foreign fleets whose observed course leads to one of their planets. */
export function threatWarnings(game: GameState) {
  for (const p of game.players) {
    if (p.ai || p.dead) continue;
    const mine = game.planets.filter(x => x.owner === p.id);
    if (!mine.length) continue;
    p.intel.warned ??= {};
    for (const [k, y] of Object.entries(p.intel.warned)) if (game.year - y > 5) delete p.intel.warned[k];
    let n = 0;
    for (const fi of p.intel.fleets) {
      if (n >= 6) break;
      if (fi.owner >= 0 && (fi.owner === p.id || p.relations[fi.owner] === 'friend')) continue;
      const tr = p.intel.tracks[fi.id];
      if (!tr || tr.length < 2 || tr[tr.length - 1].year !== game.year) continue;
      const est = estimateTrajectory(p, fi.id, 3);
      if (!est) continue;
      let prev = tr[tr.length - 1] as { x: number; y: number };
      let hit: { planet: Planet; years: number } | null = null;
      est.ahead.forEach((pt, i) => {
        if (hit) return;
        for (const pl of mine) if (distToSegment(pl, prev, pt) < 10 && distance(pl, tr[tr.length - 1]) > 1) { hit = { planet: pl, years: i + 1 }; break; }
        prev = pt;
      });
      if (!hit) continue;
      const h = hit as { planet: Planet; years: number };
      const key = `${fi.id}:${h.planet.id}`;
      if (p.intel.warned[key] !== undefined && game.year - p.intel.warned[key] < 3) continue;
      p.intel.warned[key] = game.year;
      // 3.4: the pirates' and the Harvesters' fleets carry their band in their name
      const who = fi.detail === 'full' && fi.owner >= 0 ? (game.players[fi.owner].faction ? `${game.players[fi.owner].faction === 'pirates' ? 'Le' : 'La'} ${fi.name}` : `La flotte ${fi.name} des ${game.players[fi.owner].name}`) : 'Un contact non identifié';
      p.messages.push({ year: game.year, kind: 'warning', text: `${who} semble se diriger vers ${h.planet.name} (arrivée estimée dans ${h.years} an${h.years > 1 ? 's' : ''}).`, target: { kind: 'fleet', id: fi.id } });
      n++;
    }
  }
}
