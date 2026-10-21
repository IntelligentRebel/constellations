// User actions that modify the game (each one is undoable).
import { store, type ObjRef } from './store';
import type { BattlePlan, Fleet, GameState, Planet, QueueKind, ShipDesign, ShipRole, TransportKey, Waypoint, WaypointTask } from '../engine/types';
import { DEFAULT_IN, DEFAULT_OUT, DEFAULT_RESERVE, joinNetwork, leaveNetwork , autoImmigration } from '../engine/logistics';
import { chooseDoctrine } from '../engine/doctrines';
import { setRule } from '../engine/rules';
import { queueRefit, refitRoom } from '../engine/refit';
import { planIntercept, applyIntercept, applyTraderMeet, type TraderOffer } from '../engine/intercept';
import { startRefuel, defaultTankerRange } from '../engine/refuel';
import { safeGoto } from '../engine/ai';
import { upgradeDesigns } from '../engine/upgrade';
import { endOperation } from '../engine/operations';
import type { ConstellationsRule } from '../engine/newgame';
import { fleetSpec, estimateRoute, bestWarpForLeg } from '../engine/fleet';
import { gateCheck } from '../engine/movement';
import { minefieldSpans } from '../engine/movement';
import { zeroCost, installationRoom, roomWhy, availableItems, isAuto, applyTemplate } from '../engine/production';
import { transferWithPlanet, transferBetweenFleets, splitFleet, splitIntoSingles, mergeFleets, hasOrders } from '../engine/tasks';
import { habitability } from '../engine/race';
import { autoExplore, canAutoExplore, AUTO_EXPLORE } from '../engine/automation';
import { canUseWormholes, WORMHOLE_NAV, specialReqText, specialLevelText } from '../engine/specials';
import { wallAt, nearestOutside, regionOf, openFor } from '../engine/walls';
import { pocketGate } from '../engine/secrets';
import { closersOf, exitOrder, routeEntries } from '../engine/borders';
import { upperFirst } from '../engine/words';

export function commandedFleet(): Fleet | undefined {
  const g = store.game;
  if (!g || store.commanded?.kind !== 'fleet') return undefined;
  return g.fleets.find(f => f.id === store.commanded!.id);
}

function syncRoute(f: Fleet) { if (f.repeat) f.route = f.waypoints.map(w => ({ ...w, processed: false })); }
/** The player gives orders by hand: a standing pursuit stops. */
function manual(f: Fleet) {
  // 0.3.9.11: caught inside closed borders, it no longer gets out by itself: the player decides
  if (f.borderExit?.auto) delete f.borderExit.auto;
  if (f.meetTrader !== undefined) { f.meetTrader = undefined; store.notify(`${f.name} : rendez-vous avec le Marchand nomade annulé`); }
  if (f.pursue !== undefined) { f.pursue = undefined; store.notify(f.refuelFor !== undefined ? `${f.name} : ravitaillement annulé` : `${f.name} : poursuite annulée`); f.refuelFor = undefined; f.tankerPost = undefined; }
  // 0.3.9: a reinforcement given orders by hand leaves its operation
  if (f.joinOp !== undefined) { f.joinOp = undefined; store.notify(`${f.name} ne rejoint plus l'opération : elle suit vos ordres.`); } }

function makeWaypoint(ref: ObjRef, pos: { x: number; y: number }): Waypoint | null {
  const g = store.game; if (!g) return null;
  if (ref.kind === 'planet') return { x: g.planets[ref.id].x, y: g.planets[ref.id].y, target: 'planet', targetId: ref.id, warp: 0, task: 'none' };
  if (ref.kind === 'fleet') return { x: pos.x, y: pos.y, target: 'fleet', targetId: ref.id, warp: 0, task: 'none' };
  if (ref.kind === 'wormhole') return { x: pos.x, y: pos.y, target: 'wormhole', targetId: ref.id, warp: 0, task: 'none' };
  if (ref.kind === 'trader') return { x: pos.x, y: pos.y, target: 'trader', targetId: ref.id, warp: 0, task: 'none' };
  let at = { x: Math.round(pos.x), y: Math.round(pos.y) };
  const me = store.me!;
  // 0.3.7: beyond the edge of the map there is only the void (and, for those who found it, the hidden cluster)
  const reg = regionOf(g, at);
  if (reg < 0 || (reg === 1 && !g.secrets?.some(s => s.kind === 'pocket' && s.known.includes(me.id)))) {
    at = { x: Math.max(1, Math.min(g.width - 1, at.x)), y: Math.max(1, Math.min(g.height - 1, at.y)) };
    store.notify('Au-delà du bord de la galaxie, il n\'y a que le vide : étape placée au bord.');
  }
  // 3.6: no step inside a dark cloud: it goes to the nearest edge (0.3.7: but on the way into a veiled star found)
  const cloud = wallAt(g, at.x, at.y);
  if (cloud && !openFor(g, me.id, at.x, at.y)) { at = nearestOutside(g, at); store.notify(`${upperFirst(cloud)} est infranchissable : étape placée à son bord.`); }
  return { x: at.x, y: at.y, target: 'space', warp: 0, task: 'none' };
}

type LegState = 'ok' | 'slowed' | 'warp1' | 'dry';

/** Fuel-aware warp for leg i (waypoint i): the fastest warp that still arrives with fuel. */
function fixLegWarp(f: Fleet, i: number): LegState {
  const g = store.game!;
  if (i <= 0 || i >= f.waypoints.length) return 'ok';
  const wp = f.waypoints[i];
  if (wp.warp >= 11) return 'ok';
  const spec = fleetSpec(g, f);
  if (!wp.warp) wp.warp = spec.idealSpeed || 5;
  let est = estimateRoute(g, f);
  if (est[i - 1]?.ok) return 'ok';
  wp.warp = bestWarpForLeg(g, f, i, Math.max(wp.warp, 1));
  est = estimateRoute(g, f);
  if (!est[i - 1]?.ok) return 'dry';
  return wp.warp <= 1 && (spec.idealSpeed || 2) > 1 && spec.freeSpeed < 2 ? 'warp1' : 'slowed';
}

/**
 * A leg whose end (or start) moved: its warp is computed again from scratch, the ideal speed of the engines if the
 * fuel allows it, else the fastest that still arrives (a speed chosen for another destination is not kept).
 */
function retuneLeg(f: Fleet, i: number): LegState {
  if (i <= 0 || i >= f.waypoints.length || f.waypoints[i].warp >= 11) return 'ok';
  f.waypoints[i].warp = 0;
  return fixLegWarp(f, i);
}

/**
 * 0.3.9.21: the route a drag of waypoint i would give, with the speeds the order will set (the preview showed the
 * arrival at the old speed of the leg, then the order retuned it: another year).
 */
export function retunedRoute(f: Fleet, wps: Waypoint[], i: number, keepGate: boolean): Waypoint[] {
  const tmp: Fleet = { ...f, waypoints: wps.map(w => ({ ...w })) };
  // as the orders do: an inserted step, or a gate step dropped on another kind of target, flies at a speed again
  if (tmp.waypoints[i] && (!keepGate || tmp.waypoints[i].warp < 11)) tmp.waypoints[i].warp = 0;
  retuneLeg(tmp, i); retuneLeg(tmp, i + 1);
  return tmp.waypoints;
}

/** Loud warning when a leg can only be flown at Warp 1 (or not at all with the fuel on board). */
export function warnSlowLegs(f: Fleet, legs: number[]) {
  const g = store.game; if (!g) return;
  const est = estimateRoute(g, f);
  const spec = fleetSpec(g, f);
  const bad = legs.filter(i => i > 0 && i < f.waypoints.length && f.waypoints[i].warp < 11 && (!est[i - 1]?.ok || (f.waypoints[i].warp <= 1 && (spec.idealSpeed || 2) > 1 && spec.freeSpeed < 2)));
  if (!bad.length) return;
  const i = bad[0];
  const leg = est[i - 1];
  const dest = wpLabel(f.waypoints[i]);
  const message = leg && !leg.ok
    ? `${f.name} n'a pas assez de carburant pour atteindre ${dest}, même à Warp 1 : elle tombera en panne sèche en route et finira le trajet à Warp 1, sans pouvoir se ravitailler avant d'arriver.`
    : `Pour atteindre ${dest} avec son carburant, ${f.name} devra voyager à Warp 1 : ${leg ? `${Math.round(leg.dist)} années-lumière en ${leg.years} ans` : 'un trajet très long'}. Une escale à un chantier ami permettrait de refaire le plein.`;
  store.open('warn', { title: 'Trajet à Warp 1', message, actions: [{ label: 'Annuler cet ordre', run: () => store.undoLast() }, { label: 'Garder le trajet', primary: true, run: () => {} }] });
}

function wpLabel(w: Waypoint): string {
  const g = store.game!;
  if (w.target === 'planet' && w.targetId !== undefined) return g.planets[w.targetId].name;
  return w.target === 'space' ? `(${Math.round(w.x)}, ${Math.round(w.y)})` : 'cette destination';
}

/** Colonizer without colonists heading for a colonization: offer to load them. */
export function checkEmptyArk(f: Fleet) {
  const g = store.game, me = store.me; if (!g || !me) return;
  const spec = fleetSpec(g, f);
  if (!spec.colonizer || f.cargo.colonists > 0 || f.waypoints.length < 2) return;
  if (arkLoadPlanned(f) || !arkHeadsToColonize(f)) return;
  const here = f.orbiting >= 0 ? g.planets[f.orbiting] : undefined;
  const actions: { label: string; primary?: boolean; run: () => void }[] = [];
  if (here && here.owner === me.id && here.pop > 1000) actions.push({ label: `Embarquer les colons à ${here.name}`, primary: true, run: () => loadColonistsHere(f) });
  else {
    const src = nearestColonySource(f);
    if (src) actions.push({ label: `Faire escale à ${src.name} pour les embarquer`, primary: true, run: () => addColonistStop(f, src.id) });
  }
  actions.unshift({ label: 'Partir sans colons', run: () => {} });
  store.open('warn', { title: 'Arche sans colons', message: `${f.name} n'a aucun colon à bord : arrivée à destination, elle ne pourra pas fonder de colonie.${actions.length > 1 ? '' : ' Aucune de vos planètes ne peut fournir de colons pour l\'instant.'}`, actions });
}

/** Is the route meant to found a colony (Colonize task, or ending on a free world)? */
export function arkHeadsToColonize(f: Fleet): boolean {
  const me = store.me!;
  if (f.waypoints.some((w, i) => i > 0 && w.task === 'colonize')) return true;
  const last = f.waypoints[f.waypoints.length - 1];
  return f.waypoints.length > 1 && last.target === 'planet' && last.targetId !== undefined && (me.intel.planets[last.targetId].owner ?? -1) < 0;
}

/** After a colonist pick-up was added: the free destination gets the Colonize task. */
function colonizeAtEnd(f: Fleet) {
  const me = store.me!;
  if (f.waypoints.some((w, i) => i > 0 && w.task === 'colonize')) return;
  const last = f.waypoints[f.waypoints.length - 1];
  if (f.waypoints.length < 2 || last.target !== 'planet' || last.targetId === undefined || last.task !== 'none') return;
  const intel = me.intel.planets[last.targetId];
  if ((intel.owner ?? -1) < 0 && (!intel.hab || habitability(me.race, intel.hab) > 0)) last.task = 'colonize';
}

/** Is a colonist pick-up ordered before the first colonization step? */
export function arkLoadPlanned(f: Fleet): boolean {
  const k = f.waypoints.findIndex(w => w.task === 'colonize');
  const until = k < 0 ? f.waypoints.length : k;
  return f.waypoints.slice(0, until).some((w, i) => (i > 0 || !w.processed) && w.task === 'transport' && ['loadAll', 'loadAmount', 'fillPercent', 'waitPercent', 'setAmount'].includes(w.transport?.colonists?.action ?? ''));
}

export function nearestColonySource(f: Fleet) {
  const g = store.game!, me = store.me!;
  return g.planets.filter(p => p.owner === me.id && p.pop > 3000).sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0];
}

export function loadColonistsHere(f: Fleet) {
  store.checkpoint();
  const w0 = f.waypoints[0];
  w0.task = 'transport'; w0.transport = { ...(w0.transport ?? {}), colonists: { action: 'loadAll', amount: 0 } }; w0.processed = false;
  const g = store.game!;
  for (let i = 1; i < f.waypoints.length; i++) fixLegWarp(f, i);
  colonizeAtEnd(f);
  syncRoute(f);
  store.notify(`${f.name} embarquera ses colons avant de partir`);
  store.bump();
  void g;
}

export function addColonistStop(f: Fleet, planetId: number) {
  const g = store.game!;
  store.checkpoint();
  const p = g.planets[planetId];
  f.waypoints.splice(1, 0, { x: p.x, y: p.y, target: 'planet', targetId: p.id, warp: 0, task: 'transport', transport: { colonists: { action: 'loadAll', amount: 0 } } });
  fixLegWarp(f, 1); fixLegWarp(f, 2);
  colonizeAtEnd(f);
  syncRoute(f);
  store.waypointIndex = 1;
  store.notify(`Escale ajoutée : ${f.name} embarquera des colons à ${p.name}`);
  store.bump();
  warnSlowLegs(f, [1, 2]);
}

export function addWaypoint(ref: ObjRef, pos: { x: number; y: number }) {
  const g = store.game, f = commandedFleet();
  if (!g || !f) return;
  if (f.beaconOf !== undefined) { store.notify('Une balise de souveraineté ne se déplace pas.'); return; }
  const wp = makeWaypoint(ref, pos); if (!wp) return;
  store.checkpoint();
  const me = store.me!;
  let at = Math.min(Math.max(store.waypointIndex, 0), f.waypoints.length - 1) + 1;
  const prev = f.waypoints[at - 1];
  if (prev && prev.x === wp.x && prev.y === wp.y) { store.notify('Cette étape est déjà la position précédente'); store.undo.pop(); return; }
  if (f.auto === 'logistics') { leaveNetwork(f); store.notify(`${f.name} quitte le réseau logistique pour suivre vos ordres.`); }
  manual(f);
  // 0.3.7: between the hidden cluster and the galaxy, the route goes through its wormhole
  const gate = prev ? pocketGate(g, me, prev, wp) : null;
  if (gate) {
    f.waypoints.splice(at, 0, { x: gate.x, y: gate.y, target: 'wormhole', targetId: gate.id, warp: fleetSpec(g, f).idealSpeed || 5, task: 'none' });
    at++;
    store.notify('Étape ajoutée au trou de ver : c\'est le seul passage entre l\'amas et la galaxie.');
  }
  f.waypoints.splice(at, 0, wp);
  const spec = fleetSpec(g, f);
  // QoL: colonizers heading to a free habitable world get the Colonize task
  if (ref.kind === 'planet' && spec.colonizer && f.cargo.colonists > 0) {
    const intel = me.intel.planets[ref.id];
    if (intel.owner === undefined || intel.owner < 0) {
      if (!intel.hab || habitability(me.race, intel.hab) > 0) { wp.task = 'colonize'; store.notify('Tâche « Coloniser » assignée'); }
    }
  }
  if (ref.kind === 'planet' && spec.colonizer && f.cargo.colonists === 0 && at === 1 && f.orbiting >= 0 && g.planets[f.orbiting].owner === me.id && g.planets[f.orbiting].pop > 1000) {
    const intel = me.intel.planets[ref.id];
    if ((intel.owner === undefined || intel.owner < 0) && (!intel.hab || habitability(me.race, intel.hab) > 0)) {
      // QoL: load colonists before leaving (executed this year, before movement)
      const w0 = f.waypoints[0];
      w0.task = 'transport'; w0.transport = { ...(w0.transport ?? {}), colonists: { action: 'loadAll', amount: 0 } }; w0.processed = false;
      wp.task = 'colonize';
      store.notify('Colons embarqués au départ, puis colonisation à l\'arrivée');
    }
  }
  if (ref.kind === 'wormhole' && !canUseWormholes(me)) store.notify(`Trou de ver : traversée impossible sans « ${WORMHOLE_NAV.name} » (${specialReqText(WORMHOLE_NAV)}). La flotte s'arrêtera devant.`);
  wp.warp = spec.idealSpeed || 5;
  const st = fixLegWarp(f, at);
  if (at + 1 < f.waypoints.length) fixLegWarp(f, at + 1);
  if (st === 'slowed') store.notify(`Vitesse réduite à Warp ${wp.warp} pour économiser le carburant`);
  store.waypointIndex = at;
  syncRoute(f);
  store.bump();
  if (st === 'warp1' || st === 'dry') warnSlowLegs(f, [at]);
  else if (ref.kind === 'planet') {
    const intel = me.intel.planets[ref.id];
    if (spec.colonizer && f.cargo.colonists === 0 && (intel.owner === undefined || intel.owner < 0)) checkEmptyArk(f);
  }
}

/** Drag of a waypoint marker: the step moves to a new place (planet, fleet, point of space). */
export function moveWaypoint(i: number, ref: ObjRef, pos: { x: number; y: number }) {
  const f = commandedFleet(); if (!f || i <= 0 || i >= f.waypoints.length) return;
  const w = makeWaypoint(ref, pos); if (!w) return;
  const prev = f.waypoints[i - 1];
  if (prev.x === w.x && prev.y === w.y) return;
  store.checkpoint();
  manual(f);
  const old = f.waypoints[i];
  const sameTarget = old.target === w.target && old.targetId === w.targetId;
  f.waypoints[i] = { ...w, warp: old.warp >= 11 && w.target === old.target ? old.warp : 0, task: sameTarget ? old.task : (old.task === 'colonize' && w.target !== 'planet' ? 'none' : old.task), transport: old.transport, processed: false };
  const a = retuneLeg(f, i), b = retuneLeg(f, i + 1);
  if (a === 'slowed') store.notify(`Vitesse réduite à Warp ${f.waypoints[i].warp} pour économiser le carburant`);
  syncRoute(f);
  store.waypointIndex = i;
  store.bump();
  if (a === 'warp1' || a === 'dry' || b === 'warp1' || b === 'dry') warnSlowLegs(f, [i, i + 1]);
}

/** Drag of a point of the route: a new step is inserted before waypoint i. */
export function insertWaypoint(i: number, ref: ObjRef, pos: { x: number; y: number }) {
  const f = commandedFleet(); if (!f || i <= 0 || i > f.waypoints.length) return;
  const w = makeWaypoint(ref, pos); if (!w) return;
  store.checkpoint();
  manual(f);
  w.warp = 0;
  f.waypoints.splice(i, 0, w);
  const a = retuneLeg(f, i), b = retuneLeg(f, i + 1);
  syncRoute(f);
  store.waypointIndex = i;
  store.notify('Étape ajoutée');
  store.bump();
  if (a === 'warp1' || a === 'dry' || b === 'warp1' || b === 'dry') warnSlowLegs(f, [i, i + 1]);
}

export function deleteWaypoint(i: number) {
  const f = commandedFleet();
  if (!f || i <= 0 || i >= f.waypoints.length) return;
  store.checkpoint();
  manual(f);
  f.waypoints.splice(i, 1);
  // the following step now starts from the previous one: its speed is computed again
  const st = retuneLeg(f, i);
  store.waypointIndex = Math.min(i, f.waypoints.length - 1);
  syncRoute(f);
  store.bump();
  if (st === 'warp1' || st === 'dry') warnSlowLegs(f, [i]);
}

/** 0.3.9.11: caught inside closed borders: out by the shortest way, as fast as the fuel allows. */
export function leaveTerritory() {
  const f = commandedFleet(), g = store.game; if (!f || !g) return;
  const wp = exitOrder(g, f); if (!wp) return;
  store.checkpoint();
  manual(f);
  f.waiting = false;
  f.waypoints = [f.waypoints[0], wp];
  f.repeat = false; f.route = undefined;
  store.waypointIndex = 1;
  store.notify(`${f.name} quitte le territoire par la frontière la plus proche, à Warp ${wp.warp}.`);
  store.bump();
}

export function clearRoute() {
  const f = commandedFleet(); if (!f) return;
  store.checkpoint();
  manual(f);
  f.waypoints = [f.waypoints[0]];
  f.repeat = false; f.route = undefined;
  store.waypointIndex = 0;
  store.bump();
}

export function setWarp(i: number, warp: number) {
  const f = commandedFleet(); if (!f || !f.waypoints[i]) return;
  store.checkpoint();
  f.waypoints[i].warp = warp;
  syncRoute(f);
  store.bump();
}

/**
 * 0.3.9.6: slows down only inside the known minefields of leg i: a waypoint (crossed without stopping) where the
 * leg enters a field and one where it leaves it; safe warp between them, the leg's own warp before and after.
 */
export function slowInMinefields(i: number) {
  const g = store.game, f = commandedFleet();
  if (!g || !f || !f.waypoints[i] || i < 1) return;
  const wp = f.waypoints[i], prev = f.waypoints[i - 1];
  const a = { x: prev.x, y: prev.y }, b = { x: wp.x, y: wp.y };
  const spans = minefieldSpans(g, store.me!, a, b, wp.warp);
  if (!spans.length) return;
  store.checkpoint();
  const speed = wp.warp;
  const at = (t: number) => ({ x: Math.round((a.x + (b.x - a.x) * t) * 10) / 10, y: Math.round((a.y + (b.y - a.y) * t) * 10) / 10 });
  const added: Waypoint[] = [];
  let finalWarp = speed;
  spans.forEach(s => {
    // entering the field (unless the leg starts inside it): the leg's speed up to there
    if (s.t0 > 0.001) added.push({ ...at(s.t0), target: 'space', warp: speed, task: 'none' });
    // leaving it (unless the destination is inside): the safe speed up to there
    if (s.t1 < 0.999) added.push({ ...at(s.t1), target: 'space', warp: s.safe, task: 'none' });
    else finalWarp = s.safe;
  });
  // the warp of a waypoint is the speed used to reach it: the destination keeps the leg's speed after the last field
  wp.warp = finalWarp;
  f.waypoints.splice(i, 0, ...added);
  syncRoute(f);
  store.waypointIndex = i + added.length;
  const safe = Math.min(...spans.map(s => s.safe));
  if (!added.length) { store.notify(`Warp ${finalWarp} : le trajet reste tout entier dans le champ de mines.`); store.bump(); return; }
  store.notify(spans.length > 1 ? `Warp ${safe} dans les ${spans.length} champs de mines, Warp ${speed} ailleurs : ${added.length} étapes ajoutées, franchies sans s'arrêter.`
    : added.length > 1 ? `Warp ${safe} dans le champ de mines, Warp ${speed} avant et après : deux étapes ajoutées, franchies sans s'arrêter.`
      : `Warp ${safe} dans le champ de mines, Warp ${speed} en dehors : une étape ajoutée, franchie sans s'arrêter.`);
  store.bump();
}

export function applyWarpToAll(warp: number) {
  const f = commandedFleet(); if (!f) return;
  store.checkpoint();
  for (let i = 1; i < f.waypoints.length; i++) if (f.waypoints[i].warp < 11) f.waypoints[i].warp = warp;
  syncRoute(f); store.bump();
}

export function autoWarps() {
  const g = store.game, f = commandedFleet(); if (!g || !f) return;
  store.checkpoint();
  const spec = fleetSpec(g, f);
  for (let i = 1; i < f.waypoints.length; i++) if (f.waypoints[i].warp < 11) f.waypoints[i].warp = spec.idealSpeed || 5;
  for (let i = 1; i < f.waypoints.length; i++) {
    const est = estimateRoute(g, f);
    if (est[i - 1] && !est[i - 1].ok) f.waypoints[i].warp = bestWarpForLeg(g, f, i, f.waypoints[i].warp);
  }
  // 0.3.8.7: a stargate jump when it is faster and safe (no damage, no cargo left behind)
  for (let i = 1; i < f.waypoints.length; i++) {
    if (f.waypoints[i].warp >= 11) continue;
    const c = gateCheck(g, f, i);
    if (c.problem || c.risks.length || c.dropsCargo) continue;
    const leg = estimateRoute(g, f)[i - 1];
    if (leg && leg.years > 1) f.waypoints[i].warp = 11;
  }
  syncRoute(f); store.bump();
  warnSlowLegs(f, f.waypoints.map((_, i) => i));
}

/**
 * The waypoint just placed on a chevron of a foreign fleet's estimated trajectory: it becomes a stop (to be
 * there at the end of the year) and the timing is reported.
 */
export function markIntercept(name: string, year: number) {
  const g = store.game, f = commandedFleet(); if (!g || !f) return;
  const i = store.waypointIndex;
  const wp = f.waypoints[i]; if (!wp || i <= 0) return;
  if (wp.target === 'space') wp.stop = true;
  syncRoute(f);
  const arr = estimateRoute(g, f)[i - 1]?.arrival;
  if (arr === undefined || !Number.isFinite(arr)) { store.bump(); return; }
  const mine = g.year + arr;
  store.notify(mine === year ? `Interception : ${name} et votre flotte y sont attendus en ${year}` : mine < year ? `Point d'interception : vous y serez en ${mine}, ${name} en ${year} (attente sur place)` : `Trop tard : vous y serez en ${mine}, ${name} y est attendu en ${year}`);
  store.bump();
}

/** One click: the commanded fleet intercepts a foreign fleet (standing order, worked out again every year). */
export function intercept(targetId: number) {
  const g = store.game, f = commandedFleet(); if (!g || !f) return;
  const plan = planIntercept(g, f, targetId);
  const name = store.me!.intel.fleets.find(x => x.id === targetId)?.name ?? 'la flotte';
  if (!plan.ok) { store.notify(`Interception impossible : ${plan.reason}`); return; }
  store.checkpoint();
  if (f.auto === 'logistics') leaveNetwork(f);
  applyIntercept(g, f, targetId, plan);
  store.waypointIndex = f.waypoints.length - 1;
  store.notify(plan.ourYears === 0 ? `${f.name} attend ${name} sur place` : plan.direct ? `${f.name} fonce sur ${name} à Warp ${plan.warp} : contact attendu cette année` : `${f.name} interceptera ${name} en ${g.year + plan.years} (Warp ${plan.warp}${plan.ourYears < plan.years ? `, arrivée en ${g.year + plan.ourYears} puis attente` : ''})`);
  store.bump();
}

/** 3.6: a fleet goes to meet the Mystery Trader (loading minerals first when the offer says so). */
export function meetTrader(o: TraderOffer, traderId: number) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const f = o.fleet;
  if (f.auto === 'logistics') leaveNetwork(f);
  applyTraderMeet(g, f, traderId, o.plan, o.load);
  store.waypointIndex = f.waypoints.length - 1;
  const loadTxt = o.load ? `charge ${fmtKt(o.total - o.carried)} kt de minerais à ${o.from!.name}, puis ` : '';
  store.notify(o.plan.ourYears === 0 && !o.load ? `${f.name} attend le Marchand nomade sur place (${g.year + o.plan.years})` : `${f.name} ${loadTxt}rejoindra le Marchand nomade en ${g.year + o.plan.years} (Warp ${o.plan.warp}${o.plan.ourYears < o.plan.years ? `, arrivée en ${g.year + o.plan.ourYears} puis attente` : ''})`);
  store.bump();
}
export function stopTraderMeet(f: Fleet) {
  store.checkpoint();
  f.meetTrader = undefined;
  store.notify(`${f.name} : rendez-vous avec le Marchand nomade annulé (la flotte garde sa route actuelle)`);
  store.bump();
}
const fmtKt = (n: number) => Math.round(n).toLocaleString('fr-FR');

/** 3.6: patrol radius (or a tanker's), dragged on the map */
export function setPatrolRange(f: Fleet, i: number, range: number) {
  store.checkpoint();
  f.waypoints[i].patrolRange = range;
  store.notify(`${f.name} : rayon d'action ${range} al`);
  store.bump();
}

export function stopPursuit(f: Fleet) {
  store.checkpoint();
  const refuel = f.refuelFor !== undefined;
  const post = f.tankerPost !== undefined;
  f.pursue = undefined; f.refuelFor = undefined; f.tankerPost = undefined;
  store.notify(refuel ? `${f.name} : ravitaillement annulé (la flotte garde sa route actuelle${post ? ' et quitte son poste de ravitailleur' : ''})` : `${f.name} : poursuite annulée (la flotte garde sa route actuelle)`);
  store.bump();
}

/** Sends a tanker to refuel a fleet short of fuel (immediate transfer if they are together). */
export function refuel(tanker: Fleet, dry: Fleet) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const together = tanker.x === dry.x && tanker.y === dry.y;
  const before = dry.fuel;
  if (tanker.auto === 'logistics') leaveNetwork(tanker);
  if (!startRefuel(g, tanker, dry)) { store.undo.pop(); store.notify(`${tanker.name} ne peut pas ravitailler ${dry.name}`); return; }
  store.notify(together ? `${tanker.name} transfère ${Math.round(dry.fuel - before)} mg de carburant à ${dry.name}` : `${tanker.name} part ravitailler ${dry.name} (rencontre prévue en ${tanker.refuelYear})`);
  store.bump();
}

/** Stop at deep-space waypoint i, or cross it without slowing down (default). */
export function setStop(i: number, stop: boolean) {
  const f = commandedFleet(); if (!f || !f.waypoints[i] || f.waypoints[i].target !== 'space') return;
  store.checkpoint();
  f.waypoints[i].stop = stop ? true : undefined;
  syncRoute(f); store.bump();
}

export function setTask(i: number, task: WaypointTask) {
  const f = commandedFleet(); if (!f || !f.waypoints[i]) return;
  store.checkpoint();
  const wp = f.waypoints[i];
  wp.task = task;
  wp.processed = false;
  if (task === 'transport' && !wp.transport) wp.transport = {};
  if (task === 'patrol') { wp.patrolRange = wp.patrolRange ?? 50; }
  if (task === 'refuel') { wp.patrolRange = wp.patrolRange ?? defaultTankerRange(store.game!, f); }
  syncRoute(f); store.bump();
}

export function setTransport(i: number, key: TransportKey, action: string, amount: number) {
  const f = commandedFleet(); if (!f || !f.waypoints[i]) return;
  store.checkpoint();
  const wp = f.waypoints[i];
  wp.transport = wp.transport ?? {};
  wp.transport[key] = { action: action as any, amount };
  wp.processed = false;
  syncRoute(f); store.bump();
}

export function setRepeat(on: boolean) {
  const f = commandedFleet(); if (!f) return;
  store.checkpoint();
  f.repeat = on;
  f.route = on ? f.waypoints.map(w => ({ ...w, processed: false })) : undefined;
  store.bump();
}

export function renameFleet(f: Fleet, name: string) {
  store.checkpoint();
  f.name = name.trim() || f.name; f.customName = true; store.bump();
}

export function setBattlePlan(f: Fleet, id: number) { store.checkpoint(); f.battlePlan = id; store.bump(); }

// ---------------------------------------------------------------- production queue

export function queueAdd(planetId: number, kind: QueueKind, designId: number | undefined, qty: number, index?: number, megaId?: string, cultureId?: string, bountyOn?: number) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const r = queueAddTo(g, g.planets[planetId], kind, designId, qty, index, megaId, cultureId, bountyOn);
  if (!r.ok) store.undo.pop();
  if (r.note) store.notify(r.note);
  store.bump();
}

/** Adds an item to a planet's queue (no undo point, no redraw); the note says what was cut down or refused. */
function queueAddTo(g: GameState, pl: Planet, kind: QueueKind, designId: number | undefined, qty: number, index?: number, megaId?: string, cultureId?: string, bountyOn?: number): { ok: boolean; note?: string } {
  // 0.3.9.21: whole units, at least one, on a world of one's own (2.5 ships built half a ship)
  qty = Math.floor(qty);
  if (!(qty >= 1) || pl.owner !== g.human) return { ok: false };
  // 3.4: bounties, one line per target
  if (kind === 'bounty' || kind === 'spy') {
    const same = pl.queue.find(q => q.kind === kind && q.bountyOn === bountyOn);
    if (same) same.qty += qty; else pl.queue.splice(index ?? pl.queue.length, 0, { kind, bountyOn, qty, allocated: zeroCost() });
    return { ok: true };
  }
  // 3.6: no more factories, mines or defenses than the planet can hold
  let note: string | undefined;
  const room = installationRoom(g, pl, kind);
  if (room) {
    if (room.left <= 0) return { ok: false, note: `Plus de place : ${roomWhy(kind, room.max)}${room.queued ? ` (${room.queued} déjà en file)` : ''}.` };
    if (qty > room.left) { note = `${room.left} seulement : ${roomWhy(kind, room.max)}${room.queued ? ` (${room.queued} déjà en file)` : ''}.`; qty = room.left; }
  }
  // regional capitals and megaprojects: one at a time
  if (kind === 'capital' || kind === 'mega' || kind === 'culture' || kind === 'agency') { pl.queue.splice(index ?? pl.queue.length, 0, { kind, megaId, cultureId, qty: 1, allocated: zeroCost() }); return { ok: true, note }; }
  // merge with the same item if it is the last one
  const last = pl.queue[pl.queue.length - 1];
  if (index === undefined && last && last.kind === kind && last.designId === designId && !last.mission) last.qty += qty;
  else pl.queue.splice(index ?? pl.queue.length, 0, { kind, designId, qty, allocated: zeroCost() });
  return { ok: true, note };
}

/** 3.6: the same item added to several colonies at once (one undo point); returns how many took it. */
export function queueAddMany(planetIds: number[], item: { kind: QueueKind; designId?: number; megaId?: string; cultureId?: string; bountyOn?: number }, qty: number, atStart: boolean): number {
  const g = store.game; if (!g) return 0;
  store.checkpoint();
  let n = 0;
  for (const id of planetIds) {
    const pl = g.planets[id];
    const av = availableItems(g, pl).find(a => a.kind === item.kind && a.designId === item.designId && a.megaId === item.megaId && a.cultureId === item.cultureId && a.bountyOn === item.bountyOn);
    if (!av || av.disabled) continue;
    const single = ['starbase', 'scanner', 'genesis', 'capital', 'mega', 'culture', 'agency'].includes(item.kind);
    if (queueAddTo(g, pl, item.kind, item.designId, single ? 1 : qty, atStart ? firstManualSlot(pl) : undefined, item.megaId, item.cultureId, item.bountyOn).ok) n++;
  }
  if (!n) store.undo.pop();
  store.bump();
  return n;
}
/** Head of the queue, but after nothing: automatic items stay at the end anyway. */
const firstManualSlot = (_pl: Planet) => 0;

/** 3.6: a production template applied to several colonies at once. */
export function applyTemplateMany(planetIds: number[], templateId: number, replace: boolean) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  for (const id of planetIds) {
    const pl = g.planets[id];
    if (replace) pl.queue = pl.queue.filter(q => !isAuto(q.kind));
    applyTemplate(g, pl, templateId);
  }
  store.bump();
}

/** 3.6: empties the queues of several colonies (one undo point). */
export function clearQueues(planetIds: number[]) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  // (0.3.9.21: the minerals already put into the lines come back, as for one queue emptied)
  for (const id of planetIds) { const pl = g.planets[id]; for (const it of pl.queue) { pl.surface.ironium += it.allocated.ironium; pl.surface.boranium += it.allocated.boranium; pl.surface.germanium += it.allocated.germanium; } pl.queue = []; }
  store.bump();
}

export function queueRemove(planetId: number, i: number) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const pl = g.planets[planetId];
  const it = pl.queue[i];
  if (it) {
    // refund minerals already allocated
    pl.surface.ironium += it.allocated.ironium; pl.surface.boranium += it.allocated.boranium; pl.surface.germanium += it.allocated.germanium;
    pl.queue.splice(i, 1);
  }
  store.bump();
}

export function queueMove(planetId: number, i: number, to: number) {
  const g = store.game; if (!g) return;
  const pl = g.planets[planetId];
  if (to < 0 || to >= pl.queue.length || i === to) return;
  store.checkpoint();
  const [it] = pl.queue.splice(i, 1);
  pl.queue.splice(to, 0, it);
  store.bump();
}

export function queueSetQty(planetId: number, i: number, qty: number) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const it = g.planets[planetId].queue[i];
  if (it) it.qty = Math.max(0, Math.round(qty));
  // 0.3.9.13: a refit takes at most the ships of its fleet the other refits do not already take
  if (it?.kind === 'refit' && it.qty > 0) { const room = refitRoom(g, g.planets[planetId], it); if (it.qty > room) { it.qty = Math.max(1, room); store.notify(`Vaisseaux à moderniser sur cette ligne : ${it.qty} au plus (les autres sont déjà en chantier ou n'existent pas).`); } }
  // (0.3.9.21: removed here, within the same undo point: queueRemove made a second one)
  if (it && it.qty === 0) { const pl = g.planets[planetId]; pl.surface.ironium += it.allocated.ironium; pl.surface.boranium += it.allocated.boranium; pl.surface.germanium += it.allocated.germanium; pl.queue.splice(i, 1); }
  store.bump();
}

export function queueClear(planetId: number) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const pl = g.planets[planetId];
  for (const it of pl.queue) { pl.surface.ironium += it.allocated.ironium; pl.surface.boranium += it.allocated.boranium; pl.surface.germanium += it.allocated.germanium; }
  pl.queue = [];
  store.bump();
}

// ---------------------------------------------------------------- cargo, split, merge

export function transferPlanet(f: Fleet, planetId: number, key: TransportKey, amount: number) {
  const g = store.game; if (!g) return;
  // 0.3.9.21: only a fleet of this game, at the planet (a cargo dialog left open over a turn, or over an undo, moved
  // cargo across any distance, or into a copy of the game no longer played)
  const pl = g.planets[planetId];
  if (!pl || !g.fleets.includes(f) || !(f.orbiting === planetId || (Math.abs(f.x - pl.x) < 1 && Math.abs(f.y - pl.y) < 1))) return 0;
  store.checkpoint();
  const moved = transferWithPlanet(g, f, g.planets[planetId], key, amount);
  if (moved === 0) store.undo.pop();
  store.bump();
  return moved;
}

export function transferFleets(from: Fleet, to: Fleet, key: TransportKey, amount: number, by = to.owner) {
  const g = store.game; if (!g) return;
  if (!g.fleets.includes(from) || !g.fleets.includes(to) || Math.abs(from.x - to.x) >= 1 || Math.abs(from.y - to.y) >= 1) return 0; // (0.3.9.21, as above)
  store.checkpoint();
  const moved = transferBetweenFleets(g, from, to, key, amount, by);
  if (moved === 0) store.undo.pop();
  store.bump();
  return moved;
}

export function split(f: Fleet, parts: { designId: number; qty: number }[]) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const nf = splitFleet(g, f, parts);
  if (!nf) { store.undo.pop(); store.notify('Séparation impossible'); }
  store.bump();
  return nf;
}

export function splitAll(f: Fleet) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const designs = f.tokens.map(t => ({ designId: t.designId, qty: t.qty }));
  for (const d of designs.slice(1)) splitFleet(g, f, [d]);
  // also split ships of the same design one by one? Stars! "Split All" = one fleet per design
  store.bump();
}

/** One fleet per ship. */
export function splitSingles(f: Fleet) {
  const g = store.game; if (!g) return [];
  store.checkpoint();
  const out = splitIntoSingles(g, f);
  if (!out.length) store.undo.pop();
  else store.notify(`${out.length + 1} flottes d'un vaisseau`);
  store.bump();
  return out;
}

/** The merged fleet keeps the orders under way: its own, or else those of the fleet it absorbs. */
export function merge(into: Fleet, from: Fleet) {
  const g = store.game; if (!g) return;
  if (into.beaconOf !== undefined || from.beaconOf !== undefined) { store.notify('Une balise de souveraineté ne fusionne avec aucune flotte.'); return; }
  store.checkpoint();
  const busyBoth = hasOrders(into) && hasOrders(from);
  const name = from.name;
  if (mergeFleets(g, into, from, true)) store.notify(`${into.name} reprend les ordres de ${name}.`);
  else if (busyBoth) store.notify(`${into.name} garde ses ordres ; ceux de ${name} sont abandonnés.`);
  store.bump();
}

/** Standing order: explore automatically (assigns the first destination right away). */
export function setAutoExplore(f: Fleet, on: boolean) {
  const g = store.game, me = store.me; if (!g || !me) return;
  if (on && !canAutoExplore(me)) { store.notify(`L'exploration automatique demande la technologie « ${AUTO_EXPLORE.name} » (${specialLevelText(store.game!, AUTO_EXPLORE)}).`); return; }
  store.checkpoint();
  f.auto = on ? 'explore' : undefined; f.job = undefined;
  if (on) { f.pursue = undefined; f.refuelFor = undefined; }
  if (on && f.waypoints.length <= 1) {
    const targeted = new Set<number>();
    for (const o of g.fleets) if (o.owner === me.id && o !== f && o.waypoints.length > 1) { const w = o.waypoints[o.waypoints.length - 1]; if (w.target === 'planet' && w.targetId !== undefined) targeted.add(w.targetId); }
    const before = me.messages.length;
    if (!autoExplore(g, me, f, targeted)) store.notify(me.messages.length > before ? me.messages[me.messages.length - 1].text : 'Rien à explorer');
    else { store.waypointIndex = 1; store.notify(`${f.name} explore désormais automatiquement.`); }
  }
  store.bump();
}

// ---------------------------------------------------------------- Constellations 3

export function setMigration(p: Planet, mode: 'none' | 'out' | 'in', target?: number) {
  store.checkpoint();
  if (mode === 'none') p.migration = undefined;
  else p.migration = { mode, target: Math.max(5, Math.min(100, Math.round(target ?? p.migration?.target ?? (mode === 'out' ? DEFAULT_OUT : DEFAULT_IN)))) };
  store.bump();
}

/** 0.3.8.7: emigrants also go to habitable colonies without a policy, under upTo % of their capacity. */
export function setAutoImmigration(on: boolean, upTo?: number) {
  const me = store.me; if (!me) return;
  store.checkpoint();
  const cur = autoImmigration(me);
  me.autoImmigration = { on, upTo: Math.max(5, Math.min(100, Math.round(upTo ?? cur.upTo))) };
  store.bump();
}

export function setMineralPolicy(p: Planet, mode: 'none' | 'export' | 'import', reserve?: number) {
  store.checkpoint();
  if (mode === 'none') p.mineralPolicy = undefined;
  else p.mineralPolicy = { mode, reserve: Math.max(0, Math.round(reserve ?? p.mineralPolicy?.reserve ?? DEFAULT_RESERVE)) };
  store.bump();
}

export function setNetwork(f: Fleet, on: boolean) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  if (on) { if (!joinNetwork(g, f)) { store.undo.pop(); store.notify('Cette flotte ne peut pas servir le réseau (il faut une soute, sans module de colonisation ni robots foreurs).'); return; } store.notify(`${f.name} rejoint le réseau logistique.`); }
  else { leaveNetwork(f); store.notify(`${f.name} quitte le réseau logistique.`); }
  store.bump();
}

export function pickDoctrine(forkId: string, pick: 'a' | 'b') {
  const g = store.game, me = store.me; if (!g || !me) return;
  store.checkpoint();
  if (!chooseDoctrine(g, me, forkId, pick)) { store.undo.pop(); return; }
  store.bump();
}

export function setDesignRole(d: ShipDesign, role: ShipRole | undefined) { store.checkpoint(); d.role = role; store.bump(); }

/** 0.3.8.10: counted as a scout or not (stored only when it differs from the default: the Scout hull). */
export function setDesignScout(d: ShipDesign, on: boolean) { store.checkpoint(); d.scout = on === (d.hull === 'Scout') ? undefined : on; store.bump(); }

export function setRetreat(plan: BattlePlan, pct: number) { store.checkpoint(); plan.retreatAt = Math.max(0, Math.min(95, Math.round(pct))); store.bump(); }

/** Adds a rule during a game (3.6: a rule in force can no longer be removed). */
export function toggleRule(rule: ConstellationsRule, on: boolean) {
  const g = store.game; if (!g) return;
  if (!on) return;
  store.checkpoint();
  setRule(g, rule, on);
  store.bump();
}

// ---------------------------------------------------------------- designs and refits

/**
 * Withdraws a design: it can no longer be built, but the ships and stations already built keep flying (they are
 * shown as obsolete). Queue lines that build it, or refit to it, are removed (their minerals return to the planet).
 */
export function deleteDesign(d: ShipDesign) {
  const g = store.game, me = store.me; if (!g || !me) return;
  store.checkpoint();
  d.deleted = true;
  for (const p of g.planets) {
    if (p.owner !== me.id) continue;
    const keep = p.queue.filter(q => !((q.kind === 'ship' || q.kind === 'starbase' || q.kind === 'refit') && q.designId === d.id));
    for (const q of p.queue) if (!keep.includes(q)) { p.surface.ironium += q.allocated.ironium; p.surface.boranium += q.allocated.boranium; p.surface.germanium += q.allocated.germanium; }
    p.queue = keep;
  }
  // 0.3.9.21: an operation that had it built ends (it would otherwise stall, its design gone)
  for (const f of g.fleets) if (f.owner === me.id && f.op?.designId === d.id) endOperation(g, f);
  store.bump();
}

/** Puts a newly found component in every design it improves (new versions, old designs withdrawn). */
export function upgradeWith(partName: string, only?: number[]) {
  const g = store.game, me = store.me; if (!g || !me) return;
  store.checkpoint();
  const done = upgradeDesigns(g, me, partName, only);
  if (!done.length) { store.undo.pop(); store.notify('Aucun modèle à mettre à jour'); return; }
  store.notify(done.map(x => `${x.from.name} → ${x.to.name}`).join(' · '));
  store.bump();
}

/** Takes a sovereignty beacon down (the claim ends). */
export function dismantleBeacon(f: Fleet) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const i = g.fleets.indexOf(f);
  if (i >= 0) g.fleets.splice(i, 1);
  store.select(null);
  store.notify(`${f.name} démantelée : la revendication prend fin.`);
  store.bump();
}

/** Sends a fleet carrying a kit to set up a beacon at a planet. */
/**
 * 0.3.9.21: the years the beacon order would take, as sendBeacon plans it (speed the fuel allows, detours, stops);
 * null when it cannot get there. The button counted a straight leg at the engines' ideal speed.
 */
export function beaconTrip(f: Fleet, planetId: number): number | null {
  const g = store.game; if (!g) return null;
  const pl = g.planets[planetId];
  if (f.x === pl.x && f.y === pl.y) return 0;
  const tmp: Fleet = { ...f, waypoints: [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }] };
  if (!safeGoto(g, tmp, { x: pl.x, y: pl.y, planetId: pl.id }, 'beacon', false)) return null;
  const est = estimateRoute(g, tmp);
  const last = est[est.length - 1];
  return last && Number.isFinite(last.arrival) ? last.arrival : null;
}

export function sendBeacon(f: Fleet, planetId: number) {
  const g = store.game; if (!g) return;
  const pl = g.planets[planetId];
  store.checkpoint();
  if (f.x === pl.x && f.y === pl.y) { f.waypoints = [{ ...f.waypoints[0], task: 'beacon', processed: false }]; store.notify(`${f.name} posera la balise à ${pl.name} au prochain tour.`); store.bump(); return; }
  // (0.3.9.21: a refused order leaves the route as it was: it was wiped, with its undo point removed)
  const before = f.waypoints;
  f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }];
  if (!safeGoto(g, f, { x: pl.x, y: pl.y, planetId: pl.id }, 'beacon', false)) {
    f.waypoints = before; store.undo.pop();
    const shut = closersOf(g, f.owner).length > 0 && routeEntries(g, f.owner, [{ ...before[0], x: f.x, y: f.y }, { x: pl.x, y: pl.y, target: 'planet', targetId: pl.id, warp: 5, task: 'beacon' }]).length > 0;
    store.notify(shut ? `${f.name} ne peut pas atteindre ${pl.name} sans entrer dans un territoire fermé.` : `${f.name} ne peut pas atteindre ${pl.name} avec son carburant.`);
    store.bump(); return;
  }
  store.notify(`${f.name} part poser une balise à ${pl.name}.`);
  warnSlowLegs(f, [1]); // (the trip may be long: at Warp 1 when the fuel would not last)
  store.bump();
}

export function refit(f: Fleet, fromId: number, toId: number, qty: number) {
  const g = store.game; if (!g) return;
  store.checkpoint();
  const why = queueRefit(g, f, fromId, toId, qty);
  if (why) { store.undo.pop(); store.notify(`Modernisation impossible : ${why}.`); return; }
  const pl = g.planets[f.orbiting];
  store.notify(`Modernisation ajoutée à la file de ${pl.name} : ${f.name} reste en orbite jusqu'à la fin des travaux.`);
  store.bump();
}
