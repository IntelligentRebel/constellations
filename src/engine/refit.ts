// Refitting ships (Constellations): a design can be withdrawn without destroying the ships built with it, and ships
// in orbit of a shipyard can be rebuilt to another design of the same hull, through the planet's production queue.
import type { Fleet, GameState, Planet, Player, ShipDesign } from './types';
import { refitCost } from './design';
import { canBuildShip, isAuto, zeroCost } from './production';
import { cargoMass, clampFleetHold, fleetSpec } from './fleet';

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
    const n = refitFree(game, f, t.designId);
    if (n <= 0) continue; // already waiting for a refit
    enqueue(y.planet, f, t.designId, toId, n);
    done.push(`${n} ${from.name} → ${to!.name}`);
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

/**
 * 0.3.9.13: ships of design `fromId` in fleet `f` already in the refit queue of the yard it orbits (except `but`, an
 * item of that queue), and those still free to be queued.
 */
export function refitQueued(game: GameState, f: Fleet, fromId: number, but?: object): number {
  const planet = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
  return planet?.queue.reduce((a, q) => a + (q !== but && q.kind === 'refit' && q.fleetId === f.id && q.fromDesignId === fromId ? q.qty : 0), 0) ?? 0;
}
export function refitFree(game: GameState, f: Fleet, fromId: number): number {
  const have = f.tokens.find(t => t.designId === fromId)?.qty ?? 0;
  return Math.max(0, have - refitQueued(game, f, fromId));
}
/** Why no more ships of `fromId` can be queued for a refit (they all are), or null. */
export const refitFull = (game: GameState, f: Fleet, fromId: number): string | null =>
  refitFree(game, f, fromId) <= 0 && refitQueued(game, f, fromId) > 0 ? 'tous les vaisseaux de ce modèle sont déjà en modernisation' : null;

/** A refit queued: added to the item already waiting for the same ships and design, or a new item before the automatic ones. */
function enqueue(planet: Planet, f: Fleet, fromId: number, toId: number, n: number) {
  const same = planet.queue.find(q => q.kind === 'refit' && q.fleetId === f.id && q.fromDesignId === fromId && q.designId === toId);
  if (same) { same.qty += n; return; }
  const i = planet.queue.findIndex(q => isAuto(q.kind));
  planet.queue.splice(i < 0 ? planet.queue.length : i, 0, { kind: 'refit', designId: toId, fromDesignId: fromId, fleetId: f.id, qty: n, allocated: zeroCost() });
}

export function refitUnitCost(game: GameState, player: Player, fromId: number, toId: number) {
  const from = designOf(game, fromId), to = designOf(game, toId);
  return from && to ? refitCost(player, from, to) : zeroCost();
}

/** Adds the refit to the shipyard's queue, before the automatic items; the fleet holds its orbit. */
export function queueRefit(game: GameState, f: Fleet, fromId: number, toId: number, qty: number): string | null {
  const why = refitBlocker(game, f, fromId, toId) ?? refitFull(game, f, fromId);
  if (why) return why;
  const planet = game.planets[f.orbiting];
  // 0.3.9.13: only the ships not already waiting for a refit
  const n = Math.max(1, Math.min(refitFree(game, f, fromId), Math.round(qty)));
  enqueue(planet, f, fromId, toId, n);
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
  // 0.3.9.13: the ships the items before it in the queue already take are not this one's
  const k = planet.queue.indexOf(item as Planet['queue'][number]);
  const before = k < 0 ? 0 : planet.queue.slice(0, k).reduce((a, q) => a + (q.kind === 'refit' && q.fleetId === f.id && q.fromDesignId === item.fromDesignId ? q.qty : 0), 0);
  return { why: null, max: Math.max(0, (f.tokens.find(t => t.designId === item.fromDesignId)?.qty ?? 0) - before) };
}

/** How many ships a queued refit may take (the fleet's ships of that design, less those the other items take). */
export function refitRoom(game: GameState, planet: Planet, item: Planet['queue'][number]): number {
  const f = game.fleets.find(x => x.id === item.fleetId);
  if (!f) return 0;
  return Math.max(0, (f.tokens.find(t => t.designId === item.fromDesignId)?.qty ?? 0) - refitQueued(game, f, item.fromDesignId ?? -1, item));
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
  const sp = fleetSpec(game, f);
  f.fuel = Math.min(f.fuel, sp.fuelCapacity);
  // 0.3.9.21: a smaller hold leaves what no longer fits on the world (it used to be lost), minerals first
  let over = cargoMass(f.cargo) - sp.cargoCapacity;
  for (const m of ['germanium', 'boranium', 'ironium'] as const) {
    if (over <= 0) break;
    const k = Math.min(f.cargo[m], over);
    f.cargo[m] -= k; planet.surface[m] += k; over -= k;
  }
  if (over > 0 && f.cargo.colonists > 0) {
    const k = Math.min(f.cargo.colonists, over);
    f.cargo.colonists -= k; planet.pop += k * 100; over -= k;
  }
  clampFleetHold(game, f);
  return f;
}

/**
 * 0.3.9.13: a game saved before could queue the same ships for a refit several times (each click on the button added
 * an item, each paid for). On loading, the items are cut down to the ships there are, the minerals of those removed
 * go back to the planet, and the items for the same ships and design become one.
 */
export function tidyRefits(game: GameState) {
  for (const planet of game.planets) {
    if (!planet.queue.some(q => q.kind === 'refit')) continue;
    const used = new Map<string, number>();
    const back = (q: Planet['queue'][number]) => { planet.surface.ironium += q.allocated.ironium; planet.surface.boranium += q.allocated.boranium; planet.surface.germanium += q.allocated.germanium; };
    const kept: Planet['queue'] = [];
    for (const q of planet.queue) {
      const f = q.kind === 'refit' ? game.fleets.find(x => x.id === q.fleetId) : undefined;
      if (!f) { kept.push(q); continue; } // not a refit, or the production drops it
      const k = `${q.fleetId}|${q.fromDesignId}`;
      const room = (f.tokens.find(t => t.designId === q.fromDesignId)?.qty ?? 0) - (used.get(k) ?? 0);
      if (room <= 0) { back(q); continue; }
      if (q.qty > room) q.qty = room;
      used.set(k, (used.get(k) ?? 0) + q.qty);
      const same = kept.find(x => x.kind === 'refit' && x.fleetId === q.fleetId && x.fromDesignId === q.fromDesignId && x.designId === q.designId);
      if (same) {
        same.qty += q.qty;
        for (const m of ['ironium', 'boranium', 'germanium', 'resources'] as const) same.allocated[m] += q.allocated[m];
      } else kept.push(q);
    }
    planet.queue = kept;
  }
}
