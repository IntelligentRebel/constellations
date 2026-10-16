// 0.3.9.10: closed borders. With the Culture and Diplomacy rules, an empire may close its territory (the space its
// culture holds) to any empire it is at peace with. That empire's fleets may no longer go in: one that does declares
// war by doing so. Fleets already inside may leave freely. A policy decides for the empires met from then on (open or
// closed, as in Stellaris); allies always keep their borders open to each other.
//
// What a fleet may not enter is the territory as its owner knows it (the colonies it has seen): nobody trespasses on
// borders it cannot see. The routes go around closed territories as they go around the dark clouds; when there is
// no way around (or the destination lies inside), the straight line goes in, and for the player's own orders that is
// a declaration of war. The computers and every automatic order (exploration, missions, the logistics network,
// pursuits, tankers) stop at the border instead.
//
// The computers measure how much another empire's closed borders hinder them: the share of the worlds within their
// reach (to explore or to settle) that lie behind those borders. The more they are hemmed in, the more they resent
// it, the more often they ask for the borders to be opened, and the readier they are for war.
import type { Fleet, GameState, Planet, Player, Waypoint } from './types';
import { cultureOn, knownSources, territoryOwner } from './culture';
import { diplomacyOn, statusOf, opinion, aggression, declareWar } from './diplomacy';
import { gridCell, withDetours, type Obstacles } from './walls';
import { distance } from './fleet';

export const bordersOn = (game: GameState) => cultureOn(game) && diplomacyOn(game);
const isEmp = (game: GameState, id: number) => !!game.players[id] && !game.players[id].monster;
const nm = (game: GameState, id: number) => game.players[id]?.name ?? '?';

/** Are `owner`'s borders closed to `who`, and does it count (they are at peace)? */
export function closedTo(game: GameState, owner: number, who: number): boolean {
  if (!bordersOn(game) || owner === who || !isEmp(game, owner) || !isEmp(game, who)) return false;
  const o = game.players[owner];
  if (o.dead || !o.closed?.includes(who)) return false;
  return statusOf(game, owner, who) === 'peace';
}
/** Has `owner` closed its borders to `who` (whatever their status: at war, it does not matter)? */
export const hasClosed = (game: GameState, owner: number, who: number) => !!game.players[owner]?.closed?.includes(who);

/** The empires whose borders are closed to `who`. */
export function closersOf(game: GameState, who: number): number[] {
  if (!bordersOn(game)) return [];
  const out: number[] = [];
  for (const o of game.players) if (o.id !== who && o.closed?.length && closedTo(game, o.id, who)) out.push(o.id);
  return out;
}

/** Why `owner` cannot close its borders to `who` (null: it can). */
export function closeBlocker(game: GameState, owner: number, who: number): string | null {
  if (!bordersOn(game)) return 'il faut les règles Culture et Diplomatie';
  const st = statusOf(game, owner, who);
  if (!st) return 'pas de diplomatie avec eux';
  if (st === 'alliance') return 'entre alliés, les frontières restent ouvertes';
  return null;
}

function tell(game: GameState, to: number, text: string, about: number) {
  const p = game.players[to];
  if (p && !p.dead) p.messages.push({ year: game.year, kind: 'diplomacy', text, target: { kind: 'player', id: about } });
}
function log(game: GameState, a: number, b: number, text: string) {
  const l = game.diplomacy?.log;
  if (!l) return;
  l.push({ year: game.year, a, b, text });
  if (l.length > 300) l.splice(0, l.length - 300);
}

/** Closes or opens `owner`'s borders to `who`, and tells `who`. `quiet`: tells nobody (an alliance opens them). */
export function setBorders(game: GameState, owner: number, who: number, closed: boolean, quiet = false) {
  const o = game.players[owner];
  if (!o || !isEmp(game, who)) return;
  (o.bordersSet ??= []).includes(who) || o.bordersSet.push(who);
  const was = !!o.closed?.includes(who);
  if (closed === was) return;
  if (closed) {
    if (closeBlocker(game, owner, who)) return;
    (o.closed ??= []).push(who);
  } else o.closed = (o.closed ?? []).filter(id => id !== who);
  if (quiet) return;
  if (closed) {
    tell(game, who, `Les ${o.name} ferment leurs frontières à vos vaisseaux : entrer dans leur territoire leur déclarerait la guerre. Vos flottes qui s'y trouvent déjà peuvent en sortir librement.`, owner);
    log(game, owner, who, `Les ${o.name} ferment leurs frontières aux ${nm(game, who)}.`);
  } else {
    tell(game, who, `Les ${o.name} rouvrent leurs frontières à vos vaisseaux.`, owner);
    log(game, owner, who, `Les ${o.name} rouvrent leurs frontières aux ${nm(game, who)}.`);
  }
}

/** An alliance opens the borders both ways. */
export function openForAllies(game: GameState, a: number, b: number) {
  setBorders(game, a, b, false, true);
  setBorders(game, b, a, false, true);
}

// ------------------------------------------------------------------------------------------- where it is closed

/** The territories closed to one empire, on the routing grid: the closer per cell (−1: open). */
export interface ClosedMask extends Obstacles { owner: Int16Array }
const masks = new Map<string, ClosedMask>();

/** The cells of the routing grid that lie in a territory closed to `who` (as `who` knows it), or null if none. */
export function closedMask(game: GameState, who: number): ClosedMask | null {
  const cl = closersOf(game, who);
  if (!cl.length) return null;
  const viewer = game.players[who];
  const srcs = knownSources(game, viewer);
  const key = `${game.settings.seed}|${game.year}|${who}|${cl.join(',')}|${srcs.length}|${game.width}`;
  const hit = masks.get(key);
  if (hit) return hit;
  const cell = gridCell(game), cols = Math.ceil(game.width / cell), rows = Math.ceil(game.height / cell);
  const owner = new Int16Array(cols * rows).fill(-1), hard = new Uint8Array(cols * rows), seen = new Uint8Array(cols * rows);
  const closers = new Set(cl);
  for (const s of srcs) {
    if (!closers.has(s.owner)) continue;
    const i0 = Math.max(0, Math.floor((s.x - s.r) / cell)), i1 = Math.min(cols - 1, Math.floor((s.x + s.r) / cell));
    const j0 = Math.max(0, Math.floor((s.y - s.r) / cell)), j1 = Math.min(rows - 1, Math.floor((s.y + s.r) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * cols + i;
      if (seen[c]) continue;
      const at = { x: (i + 0.5) * cell, y: (j + 0.5) * cell };
      if (Math.hypot(at.x - s.x, at.y - s.y) > s.r + cell) continue;
      seen[c] = 1;
      const o = territoryOwner(game, at, srcs);
      if (closers.has(o)) { owner[c] = o; hard[c] = 1; }
    }
  }
  const m: ClosedMask = { key, cell, cols, rows, hard, owner };
  if (masks.size > 32) masks.clear();
  masks.set(key, m);
  return m;
}

/** The empire whose closed territory this point lies in (−1: none). */
export function closedAt(m: ClosedMask | null, x: number, y: number): number {
  if (!m) return -1;
  const i = Math.floor(x / m.cell), j = Math.floor(y / m.cell);
  if (i < 0 || j < 0 || i >= m.cols || j >= m.rows) return -1;
  return m.owner[j * m.cols + i];
}
/** The closed territory (as `who` knows it) a point lies in, −1 none. */
export const closedFor = (game: GameState, who: number, at: { x: number; y: number }) => closedAt(closedMask(game, who), at.x, at.y);

/** The obstacles of the routes of `who` (its closed borders), for walls.ts. */
export const borderObstacles = (game: GameState, who: number): Obstacles | null => closedMask(game, who);

/** Distance flown inside before it counts (the ragged edge of a territory may be skimmed). */
const SKIM = 2.5;

/**
 * Where a straight flight from a to b goes into a territory closed to `who` (null when it does not). A flight that
 * starts inside one is leaving: it may cross it until it is out (going back in counts).
 */
export function entryOnLeg(game: GameState, who: number, a: { x: number; y: number }, b: { x: number; y: number }, m: ClosedMask | null = closedMask(game, who)): { closer: number; x: number; y: number; before: { x: number; y: number } } | null {
  if (!m) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const step = m.cell / 3, n = Math.max(1, Math.ceil(len / step));
  let leaving = closedAt(m, a.x, a.y) >= 0, run = 0, free = { x: a.x, y: a.y };
  for (let k = 1; k <= n; k++) {
    const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n;
    const o = closedAt(m, x, y);
    if (o < 0) { leaving = false; run = 0; free = { x, y }; continue; }
    if (leaving) continue;
    run++;
    if (run * (len / n) >= SKIM || k === n) return { closer: o, x, y, before: free };
  }
  return null;
}

/** The closed territories a route goes into (after its detours), with the first leg concerned. */
export function routeEntries(game: GameState, who: number, wps: Waypoint[]): { closer: number; leg: number }[] {
  const m = closedMask(game, who);
  if (!m || wps.length < 2) return [];
  const { list, map } = withDetours(game, wps, undefined, who, m);
  const out: { closer: number; leg: number }[] = [];
  for (let i = 1; i < list.length; i++) {
    const e = entryOnLeg(game, who, list[i - 1], list[i], m);
    if (!e || out.some(x => x.closer === e.closer)) continue;
    const leg = map.findIndex(k => k >= i);
    out.push({ closer: e.closer, leg: leg < 0 ? wps.length - 1 : leg });
  }
  return out;
}

/** Is this fleet moving on an automatic order (that never goes to war by itself)? */
export function automaticFleet(game: GameState, f: Fleet): boolean {
  return !!game.players[f.owner]?.ai || !!f.auto || f.pursue !== undefined || f.meetTrader !== undefined || f.refuelFor !== undefined || f.joinOp !== undefined || !!f.tankerPost;
}

/**
 * A leg flown this year (movement.ts). Going into a territory closed to its owner, a fleet under the player's own
 * orders declares war (the player chose it: the route warned); a computer's fleet or an automatic order stops at the
 * border. Returns where it stops, or null.
 */
export function trespass(game: GameState, f: Fleet, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; closer: number } | null {
  if (!bordersOn(game) || !isEmp(game, f.owner)) return null;
  const auto = automaticFleet(game, f);
  for (let guard = 0; guard < 4; guard++) {
    const e = entryOnLeg(game, f.owner, a, b);
    if (!e) return null;
    if (auto) return { x: Math.round(e.before.x), y: Math.round(e.before.y), closer: e.closer };
    crossed(game, f, e.closer);
  }
  return null;
}

/** A fleet of the player went into a closed territory: war. */
export function crossed(game: GameState, f: Fleet, closer: number) {
  const owner = game.players[f.owner];
  owner.messages.push({ year: game.year, kind: 'diplomacy', text: `${f.name} est entrée dans le territoire des ${nm(game, closer)}, dont les frontières vous étaient fermées : vous êtes en guerre contre eux.`, target: { kind: 'fleet', id: f.id } });
  declareWar(game, f.owner, closer, 'en franchissant des frontières fermées');
}

// ------------------------------------------------------------------------------------------- the computers' view

/** Worlds within reach of an empire: to explore (unknown) or to settle (free), not in another empire's territory. */
function interests(game: GameState, p: Player, mine: Planet[]): { pl: Planet; from: Planet }[] {
  const out: { pl: Planet; from: Planet }[] = [];
  const REACH = 320;
  for (const pi of p.intel.planets) {
    if (pi.unknown) continue;
    const pl = game.planets[pi.id];
    if (pl.owner === p.id || (pi.owner !== undefined && pi.owner >= 0)) continue;
    let from: Planet | undefined, bd = REACH;
    for (const m of mine) { const d = distance(m, pl); if (d < bd) { bd = d; from = m; } }
    if (from) out.push({ pl, from });
  }
  return out;
}

/**
 * How much each closed border hinders `who` (0 to 1): the share of the worlds within its reach whose straight way
 * from its nearest colony goes through that territory (worlds inside it are not counted: nobody settles there).
 */
export function measureHindrance(game: GameState, who: number): Record<number, number> {
  const m = closedMask(game, who);
  if (!m) return {};
  const p = game.players[who];
  const mine = game.planets.filter(pl => pl.owner === who);
  if (!mine.length) return {};
  const list = interests(game, p, mine);
  const per = new Map<number, number>();
  let total = 0;
  for (const { pl, from } of list) {
    if (closedAt(m, pl.x, pl.y) >= 0) continue;
    total++;
    const e = entryOnLeg(game, who, from, pl, m);
    if (e) per.set(e.closer, (per.get(e.closer) ?? 0) + 1);
  }
  const out: Record<number, number> = {};
  for (const [c, n] of per) out[c] = Math.round(n / Math.max(8, total) * 100) / 100;
  return out;
}
/** The hindrance `who` felt from `closer`'s borders, as measured this year. */
export const hindrance = (game: GameState, who: number, closer: number) => closedTo(game, closer, who) ? game.players[who]?.hindered?.[closer] ?? 0 : 0;

/** A computer's threshold: it closes its borders to an empire whose opinion falls this low (warlike ones sooner). */
export const closeAt = (p: Player) => Math.round(-32 + 30 * aggression(p));
/** ...and opens them again once the opinion is back this high. */
export const openAt = (p: Player) => closeAt(p) + 25;

/**
 * The year's borders (end of the turn, after the scans): the policies apply to the empires just met, the computers
 * close or open their borders by opinion, and every empire measures how the others' borders hinder it.
 */
export function runBorders(game: GameState) {
  if (!bordersOn(game)) return;
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    for (const id of p.intel.met) {
      if (!isEmp(game, id) || game.players[id].dead || p.bordersSet?.includes(id)) continue;
      // first contact: the policy for new contacts (a computer judges by its opinion)
      const close = p.ai ? opinion(game, p.id, id).total <= closeAt(p) : p.borderPolicy === 'closed';
      setBorders(game, p.id, id, close && !closeBlocker(game, p.id, id));
    }
    if (p.ai) for (const id of p.intel.met) {
      if (!isEmp(game, id) || game.players[id].dead || statusOf(game, p.id, id) !== 'peace') continue;
      const op = opinion(game, p.id, id).total;
      if (!hasClosed(game, p.id, id) && op <= closeAt(p)) setBorders(game, p.id, id, true);
      else if (hasClosed(game, p.id, id) && op >= openAt(p)) setBorders(game, p.id, id, false);
    }
  }
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    const h = measureHindrance(game, p.id);
    if (Object.keys(h).length) p.hindered = h; else delete p.hindered;
  }
}

/** For the opinion lines (diplomacy.ts): the weight of `about`'s borders closed to `of`. */
export function bordersGrievance(game: GameState, of: number, about: number): number {
  if (!closedTo(game, about, of)) return 0;
  return -(8 + 45 * Math.min(1, hindrance(game, of, about)));
}
/** For the computers' wars: how much `other`'s borders push `ai` to war. */
export function bordersWarPush(game: GameState, ai: number, other: number): number {
  if (!closedTo(game, other, ai)) return 0;
  return Math.round(5 + 40 * Math.min(1, hindrance(game, ai, other)));
}
