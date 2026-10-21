// 0.3.9.10: closed borders. With the Culture and Diplomacy rules, an empire may close its territory (the space its
// culture holds) to any empire it is at peace with. That empire's fleets may no longer go in: one that does declares
// war by doing so. Fleets already inside are given a delay to get out (0.3.9.11, below). A policy decides for the empires met from then on (open or
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
import { cultureOn, knownSources, sourcesKey, territoryOwner, CORE_RADIUS } from './culture';
import { diplomacyOn, statusOf, opinion, aggression, declareWar } from './diplomacy';
import { gridCell, withDetours, hasWalls, inWall, type Obstacles } from './walls';
import { distance, fleetSpec, fuelForYear, fuelGenerated, travelYears } from './fleet';
import { scrapFleet } from './tasks';

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
    tell(game, who, `Les ${o.name} ferment leurs frontières à vos vaisseaux : entrer dans leur territoire leur déclarerait la guerre. Vos flottes qui s'y trouvent déjà ont un délai pour en sortir.`, owner);
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
  // 0.3.9.21: the key is what the mask is made of (closers, sources, grid). It held only the year and the number of
  // sources, so a mask made earlier in the year (or in the turn before, after the year changed) was used again after
  // the territories had moved: a turn differed between a game continued and the same game reloaded.
  const key = `${game.width}|${game.height}|${cl.join(',')}|${sourcesKey(srcs)}`;
  const hit = masks.get(key);
  if (hit) return hit;
  const cell = gridCell(game), cols = Math.ceil(game.width / cell), rows = Math.ceil(game.height / cell);
  const owner = new Int16Array(cols * rows).fill(-1), hard = new Uint8Array(cols * rows), seen = new Uint8Array(cols * rows);
  const closers = new Set(cl);
  for (const s of srcs) {
    if (!closers.has(s.owner)) continue;
    // 0.3.9.21: only the sources that can reach this source's square decide its cells (same owners, same order: the
    // same answer as all of them, without going through every world of the galaxy for each cell)
    const near = srcs.filter(t => Math.hypot(t.x - s.x, t.y - s.y) <= s.r + 2 * cell + Math.max(t.r, CORE_RADIUS));
    const i0 = Math.max(0, Math.floor((s.x - s.r) / cell)), i1 = Math.min(cols - 1, Math.floor((s.x + s.r) / cell));
    const j0 = Math.max(0, Math.floor((s.y - s.r) / cell)), j1 = Math.min(rows - 1, Math.floor((s.y + s.r) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * cols + i;
      if (seen[c]) continue;
      const at = { x: (i + 0.5) * cell, y: (j + 0.5) * cell };
      if (Math.hypot(at.x - s.x, at.y - s.y) > s.r + cell) continue;
      seen[c] = 1;
      const o = territoryOwner(game, at, near);
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

// ------------------------------------------------------------------------------------------- fleets caught inside
//
// 0.3.9.11. A fleet inside a territory closed to its empire (the borders closed around it, the territory grew over
// it, or its empire just learnt of it) has a delay to get out: the years its fuel lets it take to the nearest way
// out, flying as fast as it can, plus one to give the order. Past that delay it is warned; if it is still inside the
// year after, its empire is at war with the closer. A fleet short of fuel to get out in reasonable time (or with no
// engines) has the delay its engines would need, plus two years, to be refuelled; if it is still stranded inside
// then, it is dismantled on the spot. The computers' fleets and the automatic orders get out by themselves (they
// never go to war on their own); a fleet orbiting one of its own worlds is at home and need not leave.

/** The way out of a closed territory, and what it takes. */
export interface ExitPlan {
  closer: number;
  x: number;
  y: number;
  /** light-years to the nearest point out */
  dist: number;
  /** fastest warp its fuel allows (0: none), and the years at that warp */
  warp: number;
  years: number;
  /** years its engines would need with enough fuel */
  fast: number;
  stranded: boolean;
}

/** The nearest point out of the territories closed to `who` (as it knows them), from a point inside one. */
function wayOut(game: GameState, m: ClosedMask, at: { x: number; y: number }, who: number): { x: number; y: number; dist: number } | null {
  const { cell, cols, rows } = m;
  const ci = Math.min(cols - 1, Math.max(0, Math.floor(at.x / cell))), cj = Math.min(rows - 1, Math.max(0, Math.floor(at.y / cell)));
  const walls = hasWalls(game);
  let best: { x: number; y: number; dist: number } | null = null;
  for (let r = 1, R = Math.max(cols, rows); r <= R; r++) {
    if (best && (r - 1) * cell >= best.dist) break;
    for (let j = cj - r; j <= cj + r; j++) {
      if (j < 0 || j >= rows) continue;
      const edge = j === cj - r || j === cj + r;
      for (let i = ci - r; i <= ci + r; i += edge ? 1 : 2 * r) {
        if (i < 0 || i >= cols || m.owner[j * cols + i] >= 0) continue;
        // the point of that cell nearest to the fleet, a light-year inside it (positions are rounded)
        const x = Math.round(Math.min((i + 1) * cell - 1, Math.max(i * cell + 1, at.x))), y = Math.round(Math.min((j + 1) * cell - 1, Math.max(j * cell + 1, at.y)));
        if (x < 0 || y < 0 || x > game.width || y > game.height) continue;
        const d = Math.hypot(x - at.x, y - at.y);
        if (best && d >= best.dist) continue;
        if (walls && inWall(game, x, y, who)) continue;
        best = { x, y, dist: d };
      }
    }
  }
  return best;
}

/** Is the fleet at home (orbiting one of its own worlds), or one that never moves (a beacon, a fort)? */
const atHome = (game: GameState, f: Fleet) => f.beaconOf !== undefined || !!f.immobile || (f.orbiting >= 0 && game.planets[f.orbiting]?.owner === f.owner);

/** How a fleet inside a territory closed to its empire gets out (null: it is not inside one, or skims its edge). */
export function exitPlan(game: GameState, f: Fleet, m: ClosedMask | null = closedMask(game, f.owner)): ExitPlan | null {
  if (!m) return null;
  const closer = closedAt(m, f.x, f.y);
  if (closer < 0) return null;
  const out = wayOut(game, m, f, f.owner);
  if (out && out.dist <= SKIM) return null;
  const spec = fleetSpec(game, f);
  if (!out || !spec.hasEngines) return { closer, x: out?.x ?? f.x, y: out?.y ?? f.y, dist: out?.dist ?? 0, warp: 0, years: Infinity, fast: 1, stranded: true };
  const limit = Math.min(10, spec.maxSafeSpeed || 9);
  const fast = travelYears(out.dist, limit);
  let warp = 0, years = Infinity;
  for (let w = limit; w >= 1; w--) {
    if (fuelForYear(game, f, w, out.dist) - fuelGenerated(game, f, w, out.dist) > f.fuel) continue;
    warp = w; years = travelYears(out.dist, w); break;
  }
  return { closer, ...out, warp, years, fast, stranded: !(years <= Math.max(2 * fast, fast + 3)) };
}

/** A computer's fleet, or one under an automatic order, caught inside: it flies out this year (movement.ts). */
export function leaveNow(game: GameState, f: Fleet) {
  const e = f.borderExit;
  if (!e || !(e.auto || automaticFleet(game, f)) || closedFor(game, f.owner, f) < 0) return;
  f.waiting = false;
  f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y }, { x: e.x, y: e.y, target: 'space', warp: Math.max(1, e.warp), task: 'none' }];
}

/** The way out for a fleet of the player, as an order (the fleet panel's button). */
export function exitOrder(game: GameState, f: Fleet): Waypoint | null {
  const p = exitPlan(game, f);
  return p ? { x: p.x, y: p.y, target: 'space', warp: Math.max(1, p.warp), task: 'none' } : null;
}

function fleetNote(game: GameState, f: Fleet, text: string, kind: 'diplomacy' | 'warning' | 'fleet' = 'diplomacy') {
  const p = game.players[f.owner];
  if (!p.ai) p.messages.push({ year: game.year, kind, text, target: { kind: 'fleet', id: f.id } });
}

/** It could not get out: dismantled where it is (its wreck drifts there, or its minerals go to the world below). */
function dismantle(game: GameState, f: Fleet, closer: number) {
  const p = game.players[f.owner], n = p.messages.length;
  scrapFleet(game, f);
  p.messages.splice(n);
  if (!p.ai) p.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} n'a pas pu sortir à temps du territoire des ${nm(game, closer)}, dont les frontières vous sont fermées : elle a été démantelée sur place.` });
}

/** The year's fleets caught inside closed borders (runBorders, after the movement and the scans). */
function caughtInside(game: GameState) {
  const told = new Map<string, { closer: number; who: number; n: number; by: number }>();
  for (const f of [...game.fleets]) {
    if (!game.fleets.includes(f)) continue;
    const owner = game.players[f.owner];
    const plan = isEmp(game, f.owner) && !owner.dead && !atHome(game, f) ? exitPlan(game, f) : null;
    if (!plan) { if (f.borderExit) delete f.borderExit; continue; }
    const c = plan.closer, d = Math.round(plan.dist);
    let e = f.borderExit;
    const auto = automaticFleet(game, f) || !!e?.auto;
    if (!e) {
      const by = game.year + (plan.stranded ? Math.min(plan.fast, 6) + 2 : plan.years + 1);
      e = f.borderExit = { closer: c, by, x: plan.x, y: plan.y, warp: plan.warp, ...(plan.stranded ? { stranded: true } : {}), ...(auto ? { auto: true } : {}) };
      fleetNote(game, f, auto && !plan.stranded
        ? `${f.name} se trouve dans le territoire des ${nm(game, c)}, dont les frontières vous sont fermées : sous un ordre automatique, elle en sort par la frontière la plus proche (${d} al).`
        : plan.stranded
          ? `${f.name} se trouve dans le territoire des ${nm(game, c)}, dont les frontières vous sont fermées, et n'a pas assez de carburant pour en sortir à temps (la frontière la plus proche est à ${d} al). Ravitaillez-la d'ici l'an ${by}, sinon elle sera démantelée.`
          : `${f.name} se trouve dans le territoire des ${nm(game, c)}, dont les frontières vous sont fermées : elle a jusqu'à l'an ${by} pour en sortir (la frontière la plus proche est à ${d} al, Warp ${plan.warp}). Y rester au-delà leur déclarera la guerre.`);
      const closer = game.players[c];
      if (!closer.ai && closer.intel.fleets.some(x => x.id === f.id)) {
        const k = `${c}|${f.owner}`, t = told.get(k);
        if (t) { t.n++; t.by = Math.max(t.by, by); } else told.set(k, { closer: c, who: f.owner, n: 1, by });
      }
      continue;
    }
    // 0.3.9.14: the territory grew over the way out the fleet was taking: a new delay from where it is now
    const ways = [{ x: e.x, y: e.y }, ...(e.ways ?? [])];
    const goal = f.waypoints.length > 1 ? f.waypoints[f.waypoints.length - 1] : f;
    const following = ways.find(w => Math.round(goal.x) === w.x && Math.round(goal.y) === w.y);
    if (following && closedFor(game, f.owner, following) >= 0 && game.year + plan.years + 1 > e.by) {
      ways.splice(ways.indexOf(following), 1); // once per way out: parked there, it gets no more time
      e.by = game.year + (plan.stranded ? Math.min(plan.fast, 6) + 2 : plan.years + 1);
      delete e.warned;
      if (!auto) fleetNote(game, f, `La frontière des ${nm(game, c)} a avancé jusqu'à la sortie que prenait ${f.name} : la frontière la plus proche est désormais à ${d} al, et elle a jusqu'à l'an ${e.by} pour la franchir.`);
    }
    e.ways = (plan.x !== e.x || plan.y !== e.y ? ways : ways.slice(1)).filter(w => w.x !== plan.x || w.y !== plan.y).slice(0, 4);
    if (!e.ways.length) delete e.ways;
    e.closer = c; e.x = plan.x; e.y = plan.y; e.warp = plan.warp;
    if (plan.stranded) e.stranded = true; else delete e.stranded;
    if (game.year < e.by) continue;
    // the delay is over
    if (plan.stranded || (auto && game.year > e.by)) { dismantle(game, f, c); continue; }
    if (auto) continue; // flying out at its best (movement.ts): one more year
    if (e.warned === undefined) {
      e.warned = game.year;
      fleetNote(game, f, `${f.name} est toujours dans le territoire des ${nm(game, c)}, dont les frontières vous sont fermées, et le délai pour en sortir est écoulé : si elle s'y trouve encore l'an prochain, ce sera une déclaration de guerre.`, 'warning');
      continue;
    }
    if (game.year <= e.warned) continue;
    delete f.borderExit;
    owner.messages.push({ year: game.year, kind: 'diplomacy', text: `${f.name} est restée dans le territoire des ${nm(game, c)} malgré leurs frontières fermées : vous êtes en guerre contre eux.`, target: { kind: 'fleet', id: f.id } });
    declareWar(game, f.owner, c, 'en restant dans leur territoire malgré leurs frontières fermées');
  }
  for (const t of told.values()) tell(game, t.closer, `Flottes des ${nm(game, t.who)} repérées dans votre territoire, dont les frontières leur sont fermées : ${t.n}. Elles ont jusqu'à l'an ${t.by} au plus tard pour en sortir.`, t.who);
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
 * close or open their borders by opinion, every empire measures how the others' borders hinder it, and the fleets
 * caught inside closed borders are given their delay (warned, at war or dismantled once it is over).
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
  caughtInside(game);
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
