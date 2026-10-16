// Interception (Constellations 3.2): one click on a foreign fleet, and the commanded fleet works out where it can
// meet it. Destinations are never revealed, so the plan rests on the trajectory estimated from the last two
// observations ("if it keeps course and speed"). A battle only happens between fleets that end the year at the
// same point: the target is therefore the first year-end position of the foreign fleet that we can reach in time,
// where we stop and wait. The order stands: it is worked out again every year while the target stays in sight,
// and once the target is within a year's reach the fleet steers straight for it (pursuers move after their
// targets, see moveFleets), which catches it even if the estimate was a little off.
import type { Fleet, GameState, Planet, Player, Waypoint } from './types';
import { MINERALS } from './types';
import { estimateRoute, fleetSpec, distance, cargoMass } from './fleet';
import { estimateTrajectory } from './scan';
import { hasWalls, inWall, routePoints, wallAt } from './walls';

export const INTERCEPT_HORIZON = 15;

export interface InterceptPlan {
  ok: true;
  /** meeting point and the year (from now) the foreign fleet should be there */
  x: number; y: number; years: number;
  /** years we need to get there (<= years: we wait on the spot) */
  ourYears: number;
  warp: number;
  /** steer straight at the fleet this year (it is within reach) */
  direct: boolean;
  /** the target does not move */
  stationary: boolean;
  /** the plan relies on an estimated trajectory */
  estimated: boolean;
}
export interface InterceptFail { ok: false; reason: string }

/** Year-end positions of one of your own fleets, from its orders (index 0 = 1 year from now). */
export function ownPositions(game: GameState, f: Fleet, years = INTERCEPT_HORIZON): { pts: { x: number; y: number }[]; stationary: boolean } {
  const pts: { x: number; y: number }[] = [];
  if (f.waypoints.length > 1 && !f.waiting) {
    for (const leg of estimateRoute(game, f)) {
      if (!Number.isFinite(leg.arrival)) break;
      for (const p of leg.yearEnds) pts.push({ x: Math.round(p.x), y: Math.round(p.y) });
      if (!leg.pass) { const w = f.waypoints[leg.index]; pts.push({ x: Math.round(w.x), y: Math.round(w.y) }); }
      if (pts.length >= years) break;
    }
  }
  const last = pts[pts.length - 1] ?? { x: Math.round(f.x), y: Math.round(f.y) };
  while (pts.length < years) pts.push(last);
  return { pts: pts.slice(0, years), stationary: f.waypoints.length <= 1 };
}

/** Where a foreign fleet should be at the end of each of the next years (index 0 = 1 year from now). */
export function predictedPositions(game: GameState, me: Player, targetId: number, years = INTERCEPT_HORIZON): { pts: { x: number; y: number }[]; stationary: boolean; estimated: boolean } | null {
  // one of our own fleets (a tanker meeting it): its orders are known
  const own = game.fleets.find(x => x.id === targetId && x.owner === me.id);
  if (own) return { ...ownPositions(game, own, years), estimated: false };
  const fi = me.intel.fleets.find(x => x.id === targetId);
  if (!fi) return null;
  const tr = estimateTrajectory(me, targetId, years);
  if (tr) return { pts: tr.ahead.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })), stationary: false, estimated: true };
  // one observation only: the heading and the speed seen by a penetrating scanner, if any
  if (fi.heading && fi.warp && fi.warp > 0 && fi.orbiting === undefined) {
    const v = fi.warp * fi.warp;
    const pts = [];
    for (let k = 1; k <= years; k++) pts.push({ x: Math.round(fi.x + fi.heading.x * v * k), y: Math.round(fi.y + fi.heading.y * v * k) });
    return { pts, stationary: false, estimated: true };
  }
  // seen once, standing still (or in orbit): assume it stays
  return { pts: Array.from({ length: years }, () => ({ x: Math.round(fi.x), y: Math.round(fi.y) })), stationary: true, estimated: false };
}

const inside = (game: GameState, p: { x: number; y: number }) => p.x >= -20 && p.y >= -20 && p.x <= game.width + 20 && p.y <= game.height + 20;

/**
 * The plan for fleet f to meet the fleet targetId (as seen by f's owner). With `want` (a tanker: the fuel it would
 * like to have left on arrival), the earliest meeting that leaves that much in the tank, or else, within a few
 * years of the earliest one, the meeting that burns the least fuel.
 */
export function planIntercept(game: GameState, f: Fleet, targetId: number, want?: number): InterceptPlan | InterceptFail {
  const me = game.players[f.owner];
  if (!fleetSpec(game, f).hasEngines) return { ok: false, reason: 'cette flotte n\'a pas de moteur' };
  const pred = predictedPositions(game, me, targetId);
  if (!pred) return { ok: false, reason: 'la cible n\'est plus visible' };
  return planOn(game, f, pred, want);
}

/** The meeting plan along predicted year-end positions (a foreign fleet, or the Mystery Trader). */
function planOn(game: GameState, f: Fleet, pred: { pts: { x: number; y: number }[]; stationary: boolean; estimated: boolean }, want?: number): InterceptPlan | InterceptFail {
  const thrifty = want !== undefined;
  const sp = fleetSpec(game, f);
  const here: Waypoint = { ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true };
  const maxWarp = Math.max(1, Math.min(10, sp.maxSafeSpeed || 9));
  const probe = (pt: { x: number; y: number }, w: number) => estimateRoute(game, f, [here, { x: pt.x, y: pt.y, target: 'space', warp: w, task: 'none', stop: true }])[0];
  // 0.3.8.8: a meeting point inside a dark cloud, or beyond one with no way round (a veiled star without its known
  // way in), cannot be reached: the estimate would stop at the edge of the cloud and promise a meeting that never comes
  const walls = hasWalls(game);
  let blocked: { x: number; y: number } | null = null;
  const walled = (pt: { x: number; y: number }) => walls && (inWall(game, pt.x, pt.y, f.owner) || routePoints(game, f, pt, f.owner) === null);
  for (let k = 1; k <= pred.pts.length; k++) {
    const pt = pred.pts[k - 1];
    if (!inside(game, pt)) break; // it will have stopped somewhere before
    if (walled(pt)) { blocked ??= pt; continue; }
    if (distance(f, pt) < 0.5) return { ok: true, x: pt.x, y: pt.y, years: k, ourYears: 0, warp: 0, direct: false, stationary: pred.stationary, estimated: pred.estimated };
    // the slowest warp that still gets there in time (saves fuel; the plan is worked out again every year)
    let best: { w: number; arrival: number } | null = null;
    for (let w = 1; w <= maxWarp; w++) {
      const leg = probe(pt, w);
      if (leg && leg.ok && leg.arrival <= k) { best = { w, arrival: leg.arrival }; break; }
    }
    if (!best) continue;
    if (thrifty && !pred.stationary) {
      // later meetings may cost less fuel: keep the one that leaves the most in the tank
      let pick = { k, w: best.w, arrival: best.arrival, left: probe(pt, best.w)?.fuelArrive ?? 0 };
      for (let k2 = k; k2 <= Math.min(pred.pts.length, k + 8) && pick.left < want!; k2++) {
        const p2 = pred.pts[k2 - 1];
        if (!inside(game, p2)) break;
        if (walled(p2)) continue;
        for (let w = 1; w <= maxWarp; w++) {
          const leg = probe(p2, w);
          if (leg && leg.ok && leg.arrival <= k2 && leg.fuelArrive > pick.left + 0.5) { pick = { k: k2, w, arrival: leg.arrival, left: leg.fuelArrive }; break; }
        }
      }
      if (pick.k !== k || pick.w !== best.w) {
        const pp = pred.pts[pick.k - 1];
        return { ok: true, x: pp.x, y: pp.y, years: pick.k, ourYears: pick.arrival, warp: pick.w, direct: false, stationary: false, estimated: pred.estimated };
      }
    }
    // within a year: full speed straight at the fleet, wherever it really ends the year
    if (best.arrival <= 1 && !pred.stationary) {
      let wFast = best.w;
      for (let w = maxWarp; w > best.w; w--) { const leg = probe(pt, w); if (leg && leg.ok) { wFast = w; break; } }
      return { ok: true, x: pt.x, y: pt.y, years: k, ourYears: 1, warp: wFast, direct: true, stationary: false, estimated: pred.estimated };
    }
    return { ok: true, x: pt.x, y: pt.y, years: k, ourYears: best.arrival, warp: best.w, direct: false, stationary: pred.stationary, estimated: pred.estimated };
  }
  // would it work with a full tank of any size? then fuel is the problem, not speed
  for (let k = 1; k <= pred.pts.length; k++) {
    const pt = pred.pts[k - 1];
    if (!inside(game, pt)) break;
    if (walled(pt)) continue;
    const leg = estimateRoute(game, f, [here, { x: pt.x, y: pt.y, target: 'space', warp: maxWarp, task: 'none', stop: true }], 1e9)[0];
    if (leg && leg.arrival <= k) return { ok: false, reason: 'pas assez de carburant pour la rattraper' };
  }
  if (blocked) { const c = wallAt(game, blocked.x, blocked.y); return { ok: false, reason: c ? `${c} barre la route, et aucun passage connu n'y mène` : 'un nuage sombre barre la route, et aucun passage connu n\'y mène' }; }
  return { ok: false, reason: pred.stationary ? 'hors de portée avec le carburant disponible' : `inatteignable dans les ${INTERCEPT_HORIZON} ans : elle va trop vite ou s'éloigne` };
}

/** Gives the fleet the orders of the plan (in place). */
export function applyIntercept(game: GameState, f: Fleet, targetId: number, plan: InterceptPlan) {
  const here: Waypoint = { ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true };
  const target = game.fleets.find(x => x.id === targetId);
  const orbit = target && target.orbiting >= 0 && plan.stationary ? target.orbiting : -1;
  let wp: Waypoint;
  if (plan.ourYears === 0) { f.waypoints = [here]; }
  else {
    if (plan.direct) wp = { x: plan.x, y: plan.y, target: 'fleet', targetId, warp: plan.warp, task: 'none', stop: true };
    else if (orbit >= 0) { const pl = game.planets[orbit]; wp = { x: pl.x, y: pl.y, target: 'planet', targetId: orbit, warp: plan.warp, task: 'none' }; }
    else wp = { x: plan.x, y: plan.y, target: 'space', warp: plan.warp, task: 'none', stop: true };
    f.waypoints = [here, wp];
  }
  f.repeat = false; f.route = undefined; f.auto = undefined; f.job = undefined;
  f.pursue = targetId;
}

const msg = (game: GameState, p: Player, f: Fleet, text: string) => p.messages.push({ year: game.year, kind: 'fleet', text, target: { kind: 'fleet', id: f.id } });

/** Yearly update of the standing pursuit orders (after the scanners, before the players give their orders). */
export function runPursuits(game: GameState) {
  for (const f of game.fleets) {
    if (f.pursue === undefined || f.refuelFor !== undefined) continue; // tankers: see runRefuels
    const me = game.players[f.owner];
    const target = game.fleets.find(x => x.id === f.pursue);
    const ownTarget = !!target && target.owner === f.owner;
    const seen = ownTarget ? { name: target!.name } : me.intel.fleets.find(x => x.id === f.pursue);
    const name = seen?.name ?? 'la cible';
    if (!target) {
      f.pursue = undefined;
      if (f.refuelFor !== undefined) { f.refuelFor = undefined; if (!me.ai) msg(game, me, f, `${f.name} : la flotte à ravitailler n'existe plus. Mission annulée.`); continue; }
      if (!me.ai) msg(game, me, f, `${f.name} : la flotte poursuivie a disparu (détruite ou partie hors de portée). Poursuite terminée.`);
      continue;
    }
    if (!seen) {
      // keep flying to the last estimated point, then give up
      if (f.waypoints.length <= 1) {
        f.pursue = undefined;
        if (!me.ai) msg(game, me, f, `${f.name} a perdu ${name} de vue au point d'interception. Poursuite terminée.`);
      } else if (f.waypoints[1].target === 'fleet') {
        // no cheating: steering at an unseen fleet becomes a point in space (its last estimated position)
        const w = f.waypoints[1];
        f.waypoints[1] = { x: w.x, y: w.y, target: 'space', warp: w.warp, task: 'none', stop: true };
      }
      continue;
    }
    const plan = planIntercept(game, f, target.id);
    if (!plan.ok) {
      f.pursue = undefined;
      if (f.refuelFor !== undefined) { f.refuelFor = undefined; if (!me.ai) msg(game, me, f, `${f.name} ne peut plus rejoindre ${name} pour la ravitailler : ${plan.reason}.`); continue; }
      if (!me.ai) msg(game, me, f, `${f.name} abandonne la poursuite de ${name} : ${plan.reason}.`);
      continue;
    }
    const keep = f.refuelFor;
    applyIntercept(game, f, target.id, plan);
    f.refuelFor = keep;
  }
}

// ---------------------------------------------------------------------------------------------------- 3.6: the Mystery Trader

/** Minerals the Mystery Trader asks for (5 000 kt), and what earns its best reward (9 800 kt). */
export const TRADER_MIN = 5000, TRADER_BEST = 9800;

/** Year-end positions of the Mystery Trader as we know it: it keeps its course until it leaves the galaxy. */
export function traderPositions(game: GameState, me: Player, traderId: number, years = INTERCEPT_HORIZON): { x: number; y: number }[] | null {
  const t = me.intel.traders.find(x => x.id === traderId);
  if (!t || !t.heading) return null;
  const v = t.warp * t.warp, pts: { x: number; y: number }[] = [];
  for (let k = 1; k <= years; k++) {
    const p = { x: Math.round(t.x + t.heading.x * v * k), y: Math.round(t.y + t.heading.y * v * k) };
    if (!inside(game, p)) break;
    pts.push(p);
  }
  return pts;
}

/** The plan for fleet f to meet the Mystery Trader (with `load` minerals taken on board first, if any). */
export function planTraderMeet(game: GameState, f: Fleet, traderId: number, load = 0): InterceptPlan | InterceptFail {
  if (!fleetSpec(game, f).hasEngines) return { ok: false, reason: 'cette flotte n\'a pas de moteur' };
  const pts = traderPositions(game, game.players[f.owner], traderId);
  if (!pts) return { ok: false, reason: 'le Marchand n\'est plus en vue' };
  if (!pts.length) return { ok: false, reason: 'le Marchand quitte la galaxie' };
  // heavier with its load: the fuel is worked out with it
  const saved = f.cargo.ironium;
  f.cargo.ironium += load;
  try { return planOn(game, f, { pts, stationary: false, estimated: true }); } finally { f.cargo.ironium = saved; }
}

export interface TraderOffer { fleet: Fleet; plan: InterceptPlan; carried: number; load?: Record<'ironium' | 'boranium' | 'germanium', number>; from?: Planet; total: number }

/** Our fleets that can meet the Mystery Trader with enough minerals: loaded already, or a freighter loading here first. */
export function traderOffers(game: GameState, me: Player, traderId: number): TraderOffer[] {
  const t = game.traders.find(x => x.id === traderId);
  if (!t || t.rewarded.includes(me.id)) return [];
  const out: TraderOffer[] = [];
  for (const f of game.fleets) {
    if (f.owner !== me.id) continue;
    const sp = fleetSpec(game, f);
    if (!sp.hasEngines) continue;
    const carried = f.cargo.ironium + f.cargo.boranium + f.cargo.germanium;
    if (carried >= TRADER_MIN) {
      const plan = planTraderMeet(game, f, traderId);
      if (plan.ok) out.push({ fleet: f, plan, carried, total: carried });
      continue;
    }
    const here = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
    if (!here || here.owner !== me.id) continue;
    const room = sp.cargoCapacity - cargoMass(f.cargo);
    const stock = here.surface.ironium + here.surface.boranium + here.surface.germanium;
    const take = Math.min(room, stock, TRADER_BEST - carried);
    if (carried + take < TRADER_MIN) continue;
    const load = { ironium: 0, boranium: 0, germanium: 0 };
    let left = take;
    for (const m of MINERALS) { const part = Math.min(here.surface[m], Math.floor(take * here.surface[m] / Math.max(1, stock))); load[m] = part; left -= part; }
    for (const m of MINERALS) { const more = Math.min(left, here.surface[m] - load[m]); load[m] += more; left -= more; }
    const plan = planTraderMeet(game, f, traderId, take);
    if (plan.ok) out.push({ fleet: f, plan, carried, load, from: here, total: carried + take });
  }
  return out.sort((a, b) => a.plan.years - b.plan.years || b.total - a.total);
}

/** Gives the fleet its orders to meet the Mystery Trader (loading first when the offer says so). */
export function applyTraderMeet(game: GameState, f: Fleet, traderId: number, plan: InterceptPlan, load?: TraderOffer['load']) {
  const here: Waypoint = { ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true };
  if (load) {
    here.task = 'transport'; here.processed = false;
    here.transport = Object.fromEntries(MINERALS.filter(m => load[m] > 0).map(m => [m, { action: 'loadAmount', amount: load[m] }])) as Waypoint['transport'];
  }
  f.waypoints = plan.ourYears === 0 && !load ? [here] : plan.ourYears === 0 ? [here] : [here, { x: plan.x, y: plan.y, target: 'space', warp: plan.warp, task: 'none', stop: true }];
  f.repeat = false; f.route = undefined; f.auto = undefined; f.job = undefined; f.pursue = undefined;
  f.meetTrader = traderId;
}

/** Yearly: the standing orders to meet the Mystery Trader are worked out again (after the scanners). */
export function runTraderMeets(game: GameState) {
  for (const f of game.fleets) {
    if (f.meetTrader === undefined) continue;
    const me = game.players[f.owner];
    const t = game.traders.find(x => x.id === f.meetTrader);
    const say = (text: string) => { if (!me.ai) msg(game, me, f, text); };
    if (!t) { f.meetTrader = undefined; say(`${f.name} : le Marchand nomade a quitté la galaxie. Rendez-vous annulé.`); continue; }
    if (t.rewarded.includes(me.id)) { f.meetTrader = undefined; continue; }
    if (f.cargo.ironium + f.cargo.boranium + f.cargo.germanium < TRADER_MIN && f.waypoints[0]?.task !== 'transport') { f.meetTrader = undefined; say(`${f.name} n'a plus les ${TRADER_MIN} kt de minerais que demande le Marchand nomade. Rendez-vous annulé.`); continue; }
    if (!me.intel.traders.some(x => x.id === t.id)) {
      if (f.waypoints.length <= 1) { f.meetTrader = undefined; say(`${f.name} a perdu la trace du Marchand nomade au point de rendez-vous. Rendez-vous annulé.`); }
      continue;
    }
    const plan = planTraderMeet(game, f, t.id);
    if (!plan.ok) { f.meetTrader = undefined; say(`${f.name} renonce à rejoindre le Marchand nomade : ${plan.reason}.`); continue; }
    applyTraderMeet(game, f, t.id, plan);
  }
}
