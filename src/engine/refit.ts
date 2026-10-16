// Refitting ships (Constellations): a design can be withdrawn without destroying the ships built with it, and ships
// in orbit of a shipyard can be rebuilt to another design of the same hull, through the planet's production queue.
import type { Fleet, GameState, Planet, Player, ShipDesign } from './types';
import { refitCost } from './design';
import { canBuildShip, isAuto, zeroCost } from './production';
import { clampFleetHold, fleetSpec } from './fleet';

export const designOf = (game: GameState, id: number) => game.designs.find(d => d.id === id);

/** A design that can no longer be built (withdrawn by its owner). */
export const isObsolete = (game: GameState, designId: number) => !!designOf(game, designId)?.deleted;

export function fleetHasObsolete(game: GameState, f: Fleet): boolean {
  return f.tokens.some(t => isObsolete(game, t.designId));
}

/**
 * 0.3.6.7: the refit waiting for this fleet in the queue of the shipyard it orbits (it holds its orbit for it: it is
 * not idle), or null.
 */
export function pendingRefit(game: GameState, f: Fleet): { planet: Planet; to: string; qty: number } | null {
  if (f.orbiting < 0) return null;
  const planet = game.planets[f.orbiting];
  const items = planet?.queue.filter(q => q.kind === 'refit' && q.fleetId === f.id) ?? [];
  if (!items.length) return null;
  const names = [...new Set(items.map(q => designOf(game, q.designId!)?.name ?? '?'))];
  return { planet, to: names.join(', '), qty: items.reduce((a, q) => a + q.qty, 0) };
}

/** Designs the ships of `fromId` can be refitted to: same hull, same owner, buildable. */
export function refitTargets(game: GameState, player: Player, fromId: number): ShipDesign[] {
  const from = designOf(game, fromId);
  if (!from || from.starbase) return [];
  return game.designs.filter(d => d.owner === player.id && !d.deleted && !d.alien && !d.starbase && d.id !== fromId && d.hull === from.hull);
}

/** 3.6: the newest design of the same hull a design can be refitted to (or undefined). */
export function newestRefit(game: GameState, player: Player, fromId: number): ShipDesign | undefined {
  return refitTargets(game, player, fromId).filter(d => d.id > fromId).sort((a, b) => b.id - a.id)[0];
}

/** 3.6 (task "Moderniser la flotte"): on arrival, a refit is queued for each design of the fleet that has a newer one. */
export function refitOnArrival(game: GameState, f: Fleet, map: Record<number, number> = {}): void {
  const owner = game.players[f.owner];
  const say = (text: string) => { if (!owner.ai) owner.messages.push({ year: game.year, kind: 'fleet', text, target: { kind: 'fleet', id: f.id } }); };
  const y = refitYard(game, f);
  if (!y.planet) { say(`${f.name} ne peut pas être modernisée ici : ${y.why}.`); return; }
  const done: string[] = [], failed: string[] = [];
  for (const t of [...f.tokens]) {
    const toId = map[t.designId] ?? newestRefit(game, owner, t.designId)?.id;
    if (toId === undefined || toId === t.designId || toId < 0) continue;
    const from = designOf(game, t.designId)!, to = designOf(game, toId);
    const why = refitBlocker(game, f, t.designId, toId);
    if (why) { failed.push(`${from.name} → ${to?.name ?? '?'} : ${why}`); continue; }
    const planet = y.planet, i = planet.queue.findIndex(q => isAuto(q.kind));
    planet.queue.splice(i < 0 ? planet.queue.length : i, 0, { kind: 'refit', designId: toId, fromDesignId: t.designId, fleetId: f.id, qty: t.qty, allocated: zeroCost() });
    done.push(`${t.qty} ${from.name} → ${to!.name}`);
  }
  if (done.length) { f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }]; f.repeat = false; f.route = undefined; }
  if (done.length) say(`${f.name} est arrivée à ${y.planet.name} : modernisation en tête de file (${done.join(', ')}). La flotte reste en orbite jusqu'à la fin des travaux.`);
  if (failed.length) say(`${f.name} : modernisation impossible pour ${failed.join(' ; ')}.`);
  if (!done.length && !failed.length) say(`${f.name} est arrivée à ${y.planet.name} : aucun modèle plus récent pour ses vaisseaux, rien à moderniser.`);
}

/** The planet where this fleet could be refitted now (own world with a shipyard), or why not. */
export function refitYard(game: GameState, f: Fleet): { planet: Planet | null; why: string | null } {
  const planet = f.orbiting >= 0 ? game.planets[f.orbiting] : null;
  if (!planet) return { planet: null, why: 'la flotte doit être en orbite d\'un de vos chantiers' };
  if (planet.owner !== f.owner) return { planet: null, why: `${planet.name} ne vous appartient pas` };
  if (!planet.starbase) return { planet: null, why: `${planet.name} n'a pas de station` };
  return { planet, why: null };
}

/** Why `qty` ships of design `fromId` in fleet `f` cannot be refitted to `toId` here (null = they can). */
export function refitBlocker(game: GameState, f: Fleet, fromId: number, toId: number): string | null {
  const y = refitYard(game, f);
  if (!y.planet) return y.why;
  const to = designOf(game, toId), from = designOf(game, fromId);
  if (!to || to.deleted) return 'modèle introuvable';
  if (!from || from.hull !== to.hull) return 'il faut un modèle de la même coque';
  if (!f.tokens.some(t => t.designId === fromId && t.qty > 0)) return 'aucun vaisseau de ce modèle dans la flotte';
  return canBuildShip(game, y.planet, to);
}

export function refitUnitCost(game: GameState, player: Player, fromId: number, toId: number) {
  const from = designOf(game, fromId), to = designOf(game, toId);
  return from && to ? refitCost(player, from, to) : zeroCost();
}

/** Adds the refit to the shipyard's queue, before the automatic items; the fleet holds its orbit. */
export function queueRefit(game: GameState, f: Fleet, fromId: number, toId: number, qty: number): string | null {
  const why = refitBlocker(game, f, fromId, toId);
  if (why) return why;
  const planet = game.planets[f.orbiting];
  const have = f.tokens.find(t => t.designId === fromId)!.qty;
  const n = Math.max(1, Math.min(have, Math.round(qty)));
  const i = planet.queue.findIndex(q => isAuto(q.kind));
  planet.queue.splice(i < 0 ? planet.queue.length : i, 0, { kind: 'refit', designId: toId, fromDesignId: fromId, fleetId: f.id, qty: n, allocated: zeroCost() });
  f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }];
  f.repeat = false; f.route = undefined;
  return null;
}

/** Refits queued for this fleet (shown on the fleet panel). */
export function pendingRefits(game: GameState, f: Fleet): { planet: Planet; qty: number; from: number; to: number }[] {
  const res: { planet: Planet; qty: number; from: number; to: number }[] = [];
  for (const p of game.planets) for (const q of p.queue) if (q.kind === 'refit' && q.fleetId === f.id) res.push({ planet: p, qty: q.qty, from: q.fromDesignId!, to: q.designId! });
  return res;
}

/** Why a queued refit can no longer go on (null = it can), and how many ships it may still convert. */
export function refitStatus(game: GameState, planet: Planet, item: { designId?: number; fromDesignId?: number; fleetId?: number }): { why: string | null; max: number } {
  const f = game.fleets.find(x => x.id === item.fleetId);
  if (!f) return { why: 'la flotte n\'existe plus', max: 0 };
  if (f.orbiting !== planet.id) return { why: `${f.name} a quitté l'orbite`, max: 0 };
  const why = refitBlocker(game, f, item.fromDesignId ?? -1, item.designId ?? -1);
  if (why) return { why, max: 0 };
  return { why: null, max: f.tokens.find(t => t.designId === item.fromDesignId)?.qty ?? 0 };
}

/** The ships are rebuilt: `qty` ships of the old design become ships of the new one, repaired. */
export function applyRefit(game: GameState, planet: Planet, item: { designId?: number; fromDesignId?: number; fleetId?: number }, qty: number): Fleet | null {
  const f = game.fleets.find(x => x.id === item.fleetId);
  if (!f || f.orbiting !== planet.id) return null;
  const tk = f.tokens.find(t => t.designId === item.fromDesignId);
  if (!tk) return null;
  const n = Math.min(qty, tk.qty);
  if (tk.qtyDamaged > 0) {
    // damaged ships are refitted first
    const dmg = Math.min(n, tk.qtyDamaged);
    tk.qtyDamaged -= dmg; if (tk.qtyDamaged <= 0) { tk.qtyDamaged = 0; tk.damage = 0; }
  }
  tk.qty -= n;
  f.tokens = f.tokens.filter(t => t.qty > 0);
  const dest = f.tokens.find(t => t.designId === item.designId);
  if (dest) dest.qty += n; else f.tokens.push({ designId: item.designId!, qty: n, damage: 0, qtyDamaged: 0 });
  const d = designOf(game, item.designId!);
  if (d) d.built += n;
  f.fuel = Math.min(f.fuel, fleetSpec(game, f).fuelCapacity);
  clampFleetHold(game, f);
  return f;
}
