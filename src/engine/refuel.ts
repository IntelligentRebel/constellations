// Refuelling in flight (Constellations 3.2): a fleet crawling on an empty tank can be met by another of your
// fleets carrying fuel to spare. The tanker uses the interception planner on the dry fleet's known route, hands
// over what it can spare once both end a year at the same point (keeping enough to get back to a dock), then
// heads home. The dry fleet's legs are given back their best warp.
//
// Standing order 'refuel' (3.2.3): a tanker posted at a waypoint serves, one after the other, the fleets of its
// owner that run short of fuel within a radius of that post, then comes back to it (through a dock first when its
// own tank is too low). It never leaves on a trip it could not come back from: what it hands over always leaves it
// enough to reach a dock from the meeting point, and the meeting is given up as soon as that no longer holds.
import type { Fleet, GameState, Planet, Player, Waypoint } from './types';
import { bestWarpForLeg, canRefuelAt, distance, estimateRoute, fleetSpec, fuelUsageExact } from './fleet';
import { planIntercept, applyIntercept, type InterceptPlan } from './intercept';
import { safeGoto } from './ai';

/** Is this fleet short of fuel (low tank, or legs crawling for want of fuel)? */
export function needsFuel(game: GameState, f: Fleet): boolean {
  const sp = fleetSpec(game, f);
  if (!sp.hasEngines || sp.fuelCapacity <= 0 || f.fuel >= sp.fuelCapacity * 0.95) return false;
  if (f.orbiting >= 0 && canRefuelAt(game, game.players[f.owner], game.planets[f.orbiting])) return false;
  if (f.fuel < sp.fuelCapacity * 0.35) return true;
  if (f.waypoints.length < 2) return false;
  const est = estimateRoute(game, f);
  return est.some(l => !l.ok) || (sp.idealSpeed >= 4 && f.waypoints.slice(1).some(w => w.warp > 0 && w.warp <= 2));
}

/** Short of fuel and actually stuck: a leg it cannot fly, a crawl, or an empty tank. */
function urgent(game: GameState, f: Fleet): boolean {
  const sp = fleetSpec(game, f);
  if (f.fuel < sp.fuelCapacity * 0.05) return true;
  if (f.waypoints.length < 2) return false;
  const est = estimateRoute(game, f);
  return est.some(l => !l.ok) || (sp.idealSpeed >= 4 && f.waypoints.slice(1).some(w => w.warp > 0 && w.warp <= 2));
}

/** Low on fuel but already on its way to a dock it will reach at a decent speed: no need to send it a tanker. */
function headingToDock(game: GameState, f: Fleet): boolean {
  if (f.waypoints.length < 2) return false;
  const p = game.players[f.owner];
  const est = estimateRoute(game, f);
  if (!est.every(l => l.ok)) return false;
  for (let i = 1; i < f.waypoints.length; i++) {
    const w = f.waypoints[i];
    if (w.warp <= 2 && w.warp < (fleetSpec(game, f).idealSpeed || 5)) return false;
    if (w.target === 'planet' && w.targetId !== undefined && canRefuelAt(game, p, game.planets[w.targetId])) return true;
  }
  return false;
}

function nearestDock(game: GameState, p: Player, from: { x: number; y: number }): Planet | undefined {
  let best: Planet | undefined, bd = Infinity;
  for (const pl of game.planets) { if (!canRefuelAt(game, p, pl)) continue; const d = distance(pl, from); if (d < bd) { bd = d; best = pl; } }
  return best;
}

/** Fuel the tanker must keep at a point to get back to a dock afterwards. */
export function reserveFor(game: GameState, tanker: Fleet, at: { x: number; y: number }): number {
  const dock = nearestDock(game, game.players[tanker.owner], at);
  const sp = fleetSpec(game, tanker);
  if (!dock) return Math.round(sp.fuelCapacity * 0.25);
  const w = Math.max(1, Math.min(sp.idealSpeed || 5, sp.maxSafeSpeed || 9));
  return Math.ceil(fuelUsageExact(game, tanker, w, distance(at, dock)) * 1.15);
}

/** Smallest delivery worth the trip. */
const minGift = (game: GameState, dry: Fleet) => Math.max(5, fleetSpec(game, dry).fuelCapacity * 0.1);

/** What the tanker could hand over at the meeting of this plan, keeping its way back to a dock (−1: it cannot get there). */
function giftFor(game: GameState, t: Fleet, dry: Fleet, plan: InterceptPlan): number {
  const missing = Math.max(0, fleetSpec(game, dry).fuelCapacity - dry.fuel);
  let fuelThere = t.fuel;
  if (plan.ourYears > 0) {
    const here: Waypoint = { ...t.waypoints[0], x: t.x, y: t.y, task: 'none', transport: undefined, processed: true };
    const leg = estimateRoute(game, t, [here, { x: plan.x, y: plan.y, target: 'space', warp: plan.warp, task: 'none', stop: true }])[0];
    if (!leg || !leg.ok) return -1;
    fuelThere = leg.fuelArrive;
  } else if (t.orbiting >= 0 && canRefuelAt(game, game.players[t.owner], game.planets[t.orbiting])) fuelThere = fleetSpec(game, t).fuelCapacity;
  return Math.min(missing, Math.max(0, Math.floor(fuelThere - reserveFor(game, t, plan))));
}

/** The meeting this tanker would plan with the dry fleet, if it is worth it and leaves the tanker a way home. */
export function refuelPlan(game: GameState, t: Fleet, dry: Fleet): { plan: InterceptPlan; give: number } | null {
  const missing = Math.max(0, fleetSpec(game, dry).fuelCapacity - dry.fuel);
  if (missing <= 0) return null;
  const plan = planIntercept(game, t, dry.id, missing + reserveFor(game, t, dry));
  if (!plan.ok) return null;
  const give = giftFor(game, t, dry, plan);
  return give >= minGift(game, dry) ? { plan, give } : null;
}

export interface RefuelOption { tanker: Fleet; plan: InterceptPlan; give: number; meetYear: number }

/** Idle fleets of yours able to reach the dry fleet with fuel to spare, soonest first. */
export function refuelOptions(game: GameState, dry: Fleet): RefuelOption[] {
  const sp = fleetSpec(game, dry);
  if (sp.fuelCapacity - dry.fuel <= 0) return [];
  const cands = game.fleets.filter(t => t.owner === dry.owner && t !== dry && t.waypoints.length <= 1 && !t.auto && t.pursue === undefined && t.refuelFor === undefined
    && fleetSpec(game, t).hasEngines && fleetSpec(game, t).fuelCapacity > 0 && !fleetSpec(game, t).colonizer)
    .sort((a, b) => distance(a, dry) - distance(b, dry)).slice(0, 12);
  const out: RefuelOption[] = [];
  for (const t of cands) {
    const r = refuelPlan(game, t, dry);
    if (r) out.push({ tanker: t, plan: r.plan, give: r.give, meetYear: game.year + r.plan.years });
  }
  return out.sort((a, b) => a.plan.years - b.plan.years || b.give - a.give);
}

/** Fuel the tanker would like to have when it meets the dry fleet: what is missing plus its way home. */
const wanted = (game: GameState, t: Fleet, dry: Fleet) => Math.max(0, fleetSpec(game, dry).fuelCapacity - dry.fuel) + reserveFor(game, t, dry);

/** Moves fuel from the tanker to the dry fleet (what the tanker can spare); returns the amount. */
export function transferFuel(game: GameState, tanker: Fleet, dry: Fleet): number {
  const cap = fleetSpec(game, dry).fuelCapacity;
  const give = Math.min(cap - dry.fuel, Math.max(0, Math.floor(tanker.fuel - reserveFor(game, tanker, tanker))));
  if (give <= 0) return 0;
  tanker.fuel -= give; dry.fuel += give;
  // the dry fleet's crawling legs get their speed back
  const ideal = fleetSpec(game, dry).idealSpeed || 5;
  for (let i = 1; i < dry.waypoints.length; i++) {
    if (dry.waypoints[i].warp >= 11 || dry.waypoints[i].warp >= ideal) continue;
    const w = bestWarpForLeg(game, dry, i, ideal);
    if (w > dry.waypoints[i].warp) dry.waypoints[i].warp = w;
  }
  return give;
}

/** A tanker on standing duty keeps its post while it serves a fleet (the post is the order at its current waypoint). */
function rememberPost(t: Fleet) {
  const w0 = t.waypoints[0];
  if (t.waypoints.length === 1 && w0?.task === 'refuel') t.tankerPost = { ...w0, transport: undefined, processed: false };
}

/** Orders the tanker to meet the dry fleet (standing order, the meeting point is worked out again every year). */
export function startRefuel(game: GameState, tanker: Fleet, dry: Fleet): boolean {
  if (tanker.x === dry.x && tanker.y === dry.y) return transferFuel(game, tanker, dry) > 0;
  const plan = planIntercept(game, tanker, dry.id, wanted(game, tanker, dry));
  if (!plan.ok) return false;
  rememberPost(tanker);
  applyIntercept(game, tanker, dry.id, plan);
  tanker.refuelFor = dry.id; tanker.refuelYear = game.year + plan.years;
  return true;
}

const msg = (game: GameState, p: Player, f: Fleet, text: string) => p.messages.push({ year: game.year, kind: 'fleet', text, target: { kind: 'fleet', id: f.id } });

/** Default radius of the standing refuelling order: what the tanker can cover and still come back from. */
export function defaultTankerRange(game: GameState, f: Fleet): number {
  const r = fleetSpec(game, f).estimatedRange;
  if (!Number.isFinite(r) || r <= 0) return 200;
  return Math.max(50, Math.min(300, Math.round(r * 0.4 / 50) * 50));
}

/** Fuel a tanker on duty wants at its post: its way to a dock, plus half a tank to hand over. */
const dutyFuel = (game: GameState, t: Fleet, post: Waypoint) => reserveFor(game, t, post) + fleetSpec(game, t).fuelCapacity * 0.5;

/**
 * Route back to the post, through the nearest dock first when the tank would be too low to be of use there and a
 * stop at the dock actually brings it back fuller (no endless shuttling to a dock too far away).
 */
function backToPost(game: GameState, t: Fleet, post: Waypoint, force = false): string {
  const owner = game.players[t.owner];
  const sp = fleetSpec(game, t);
  const ideal = sp.idealSpeed || 5;
  const here: Waypoint = { ...t.waypoints[0], x: t.x, y: t.y, task: 'none', transport: undefined, processed: true };
  const back: Waypoint = { ...post, task: 'refuel', processed: false, transport: undefined, warp: ideal };
  const atPost = Math.abs(t.x - post.x) < 1 && Math.abs(t.y - post.y) < 1;
  const postIsDock = post.target === 'planet' && post.targetId !== undefined && canRefuelAt(game, owner, game.planets[post.targetId]);
  const direct = atPost ? null : estimateRoute(game, t, [here, back])[0];
  const fuelAtPost = atPost ? t.fuel : direct && direct.ok ? direct.fuelArrive : -1;
  const postName = post.target === 'planet' && post.targetId !== undefined ? game.planets[post.targetId].name : `(${Math.round(post.x)}, ${Math.round(post.y)})`;
  const dock = postIsDock ? undefined : nearestDock(game, owner, t);
  if (dock && t.orbiting !== dock.id && (force || fuelAtPost < dutyFuel(game, t, post))) {
    const fullAtPost = sp.fuelCapacity - fuelUsageExact(game, t, Math.max(1, Math.min(ideal, sp.maxSafeSpeed || 9)), distance(dock, post));
    if (fuelAtPost < 0 || fullAtPost > fuelAtPost + sp.fuelCapacity * 0.1) {
      t.waypoints = [here, { x: dock.x, y: dock.y, target: 'planet', targetId: dock.id, warp: ideal, task: 'none' }, back];
      for (let i = 1; i < t.waypoints.length; i++) t.waypoints[i].warp = bestWarpForLeg(game, t, i, ideal);
      return ` Elle fait le plein à ${dock.name} puis regagne son poste (${postName}).`;
    }
  }
  if (atPost) { t.waypoints = [{ ...back, x: t.x, y: t.y, warp: here.warp }]; return ''; }
  t.waypoints = [here, back];
  t.waypoints[1].warp = bestWarpForLeg(game, t, 1, ideal);
  return ` Elle regagne son poste (${postName}).`;
}

/** After the movement: tankers that reached their fleet hand over the fuel and go home (or back to their post). */
export function runRefuels(game: GameState) {
  for (const t of game.fleets) {
    if (t.refuelFor === undefined) continue;
    const owner = game.players[t.owner];
    const dry = game.fleets.find(f => f.id === t.refuelFor);
    const done = (text: string) => {
      t.refuelFor = undefined; t.pursue = undefined; t.refuelYear = undefined;
      const post = t.tankerPost; t.tankerPost = undefined;
      if (post) { const more = backToPost(game, t, post); if (!owner.ai) msg(game, owner, t, text + more); return; }
      const dock = nearestDock(game, owner, t);
      if (dock && distance(dock, t) > 0) { t.waypoints = [{ ...t.waypoints[0], x: t.x, y: t.y, task: 'none', transport: undefined, processed: true }]; safeGoto(game, t, { x: dock.x, y: dock.y, planetId: dock.id }, 'none', false); }
      if (!owner.ai) msg(game, owner, t, text + (dock && t.waypoints.length > 1 ? ` ${t.name} rentre à ${dock.name}.` : ''));
    };
    if (!dry) { done(`${t.name} : la flotte à ravitailler n'existe plus.`); continue; }
    const cap = fleetSpec(game, dry).fuelCapacity;
    if (dry.fuel >= cap * 0.95) { done(`${dry.name} a refait le plein par ses propres moyens : ${t.name} n'a plus rien à faire.`); continue; }
    if (t.x !== dry.x || t.y !== dry.y) {
      // not there yet: the meeting is worked out again from the dry fleet's current orders, now as early as
      // possible (a thrifty plan made again every year could put the meeting off for ever)
      let plan = planIntercept(game, t, dry.id);
      if (!plan.ok) { done(`${t.name} ne peut plus rejoindre ${dry.name} : ${plan.reason}.`); continue; }
      if (giftFor(game, t, dry, plan) < minGift(game, dry)) {
        // the earliest meeting burns too much: a thriftier one, or give up while the way home is still there
        const alt = refuelPlan(game, t, dry);
        if (!alt) { done(`${t.name} renonce à rejoindre ${dry.name} : elle n'aurait plus assez de carburant pour en céder et rentrer.`); continue; }
        plan = alt.plan;
      }
      applyIntercept(game, t, dry.id, plan);
      t.refuelFor = dry.id; t.refuelYear = game.year + plan.years;
      continue;
    }
    const give = transferFuel(game, t, dry);
    done(give > 0 ? `${t.name} a rejoint ${dry.name} et lui a transféré ${give} mg de carburant (${dry.name} a maintenant ${Math.round(dry.fuel)} / ${cap} mg).` : `${t.name} a rejoint ${dry.name} mais n'a plus de carburant à céder.`);
    if (give > 0 && !owner.ai && dry.waypoints.length > 1) msg(game, owner, dry, `${dry.name} est ravitaillée (${Math.round(dry.fuel)} / ${cap} mg) et repart à Warp ${dry.waypoints[1].warp}.`);
  }
}

/** Fleets this tanker on duty would serve now (within its radius, short of fuel, not already looked after), best first. */
export function tankerTargets(game: GameState, t: Fleet): { dry: Fleet; plan: InterceptPlan; give: number; urgent: boolean }[] {
  const post = t.waypoints.length === 1 && t.waypoints[0]?.task === 'refuel' ? t.waypoints[0] : t.tankerPost;
  if (!post) return [];
  const range = post.patrolRange ?? defaultTankerRange(game, t);
  const served = new Set(game.fleets.filter(o => o.refuelFor !== undefined && o !== t).map(o => o.refuelFor));
  const out: { dry: Fleet; plan: InterceptPlan; give: number; urgent: boolean }[] = [];
  for (const d of game.fleets) {
    if (d.owner !== t.owner || d === t || served.has(d.id) || d.refuelFor !== undefined) continue;
    if (d.waypoints[0]?.task === 'refuel' && d.waypoints.length === 1) continue; // another tanker on duty
    if (distance(d, post) > range || !needsFuel(game, d) || headingToDock(game, d)) continue;
    const r = refuelPlan(game, t, d);
    if (r) out.push({ dry: d, plan: r.plan, give: r.give, urgent: urgent(game, d) });
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.plan.years - b.plan.years || b.give - a.give);
}

/** Standing refuelling order: a tanker idle at its post sets out for the fleet that needs it most. */
export function runTankers(game: GameState) {
  for (const t of game.fleets) {
    const w0 = t.waypoints[0];
    if (!w0 || w0.task !== 'refuel' || t.waypoints.length > 1 || t.refuelFor !== undefined || t.pursue !== undefined) continue;
    const sp = fleetSpec(game, t);
    if (!sp.hasEngines || sp.fuelCapacity <= 0) continue;
    const owner = game.players[t.owner];
    const best = tankerTargets(game, t)[0];
    if (best) {
      rememberPost(t);
      applyIntercept(game, t, best.dry.id, best.plan);
      t.refuelFor = best.dry.id; t.refuelYear = game.year + best.plan.years;
      if (!owner.ai) msg(game, owner, t, best.plan.ourYears === 0
        ? `${t.name} ravitaille ${best.dry.name} sur place.`
        : `${t.name} quitte son poste pour ravitailler ${best.dry.name} (rencontre prévue en ${t.refuelYear}, environ ${best.give} mg à céder).`);
      if (best.plan.ourYears === 0 && t.x === best.dry.x && t.y === best.dry.y) {
        // already together: hand over right away and stay on duty
        const give = transferFuel(game, t, best.dry);
        t.refuelFor = undefined; t.pursue = undefined; t.refuelYear = undefined;
        const post = t.tankerPost; t.tankerPost = undefined;
        if (post) backToPost(game, t, post);
        if (!owner.ai && give > 0) msg(game, owner, best.dry, `${best.dry.name} a reçu ${give} mg de carburant de ${t.name}.`);
      }
      continue;
    }
    // nothing to do: a tanker posted away from any dock goes to fill up when its tank runs low (and only if the
    // trip actually brings it back fuller, see backToPost)
    const post: Waypoint = { ...w0, transport: undefined, processed: false };
    const atDock = t.orbiting >= 0 && canRefuelAt(game, owner, game.planets[t.orbiting]);
    if (!atDock && t.fuel < dutyFuel(game, t, post)) {
      const more = backToPost(game, t, post);
      if (t.waypoints.length > 1 && !owner.ai) msg(game, owner, t, `${t.name} n'a plus assez de carburant pour ravitailler qui que ce soit.${more}`);
    }
  }
}
