// 0.3.9: operations. A fleet is given a mission (hold one of your worlds, or take a world) and a strength (a number
// of ships). Every year the shipyards closest to it build the ships it lacks, of the design chosen, and the new ships
// fly to join it on their own; an attack can wait until the fleet is complete, then leave for its target. Existing
// fleets can be sent to reinforce an operation too.
import type { GameState, Fleet, Operation, Planet, Player, ShipDesign } from './types';
import { distance, fleetSpec } from './fleet';
import { canBuildShip, zeroCost } from './production';
import { mergeFleets } from './tasks';
import { designSpec } from './design';

/** Shipyards that take part each year (the closest ones). */
export const OP_YARDS = 3;

export const shipsIn = (f: Fleet) => f.tokens.reduce((a, t) => a + t.qty, 0);

export interface OpStatus { ships: number; enRoute: number; queued: number; total: number; missing: number; reinforcements: Fleet[]; yards: Planet[] }

export function opStatus(game: GameState, f: Fleet): OpStatus {
  const reinforcements = game.fleets.filter(x => x.joinOp === f.id && x.owner === f.owner);
  const enRoute = reinforcements.reduce((a, x) => a + shipsIn(x), 0);
  let queued = 0;
  const yards: Planet[] = [];
  for (const pl of game.planets) {
    if (pl.owner !== f.owner) continue;
    const q = pl.queue.filter(i => i.forOp === f.id).reduce((a, i) => a + i.qty, 0);
    if (q) { queued += q; yards.push(pl); }
  }
  const ships = shipsIn(f);
  const total = ships + enRoute + queued;
  return { ships, enRoute, queued, total, missing: Math.max(0, (f.op?.target ?? 0) - total), reinforcements, yards };
}

/** Armed designs an empire can have built for an operation (with the worlds able to build each). */
export function opDesigns(game: GameState, p: Player): ShipDesign[] {
  const yards = game.planets.filter(pl => pl.owner === p.id && pl.starbase);
  return game.designs.filter(d => d.owner === p.id && !d.starbase && !d.deleted && !d.alien && designSpec(p, d).weapons.length > 0 && yards.some(pl => canBuildShip(game, pl, d) === null));
}

/** Gives (or changes) the operation of a fleet. Returns an error or null. */
export function setOperation(game: GameState, f: Fleet, op: Omit<Operation, 'since'>): string | null {
  const p = game.players[f.owner];
  const pl = game.planets[op.planetId];
  if (!pl) return 'la cible n\'existe pas';
  if (op.kind === 'defend' && pl.owner !== p.id) return 'on ne peut défendre qu\'un de ses mondes';
  if (op.kind === 'attack' && pl.owner === p.id) return 'ce monde est déjà à vous';
  if (!game.designs.some(d => d.id === op.designId && d.owner === p.id)) return 'modèle inconnu';
  if (game.designs.some(d => d.id === op.designId && d.deleted)) return 'modèle retiré';
  if (op.target < 1 || op.target > 200) return 'entre 1 et 200 vaisseaux';
  const was = f.op;
  f.op = { ...op, since: was?.since ?? game.year, launched: was && was.kind === op.kind && was.planetId === op.planetId ? was.launched : undefined };
  f.joinOp = undefined;
  // a defense goes to its world at once; an attack without waiting leaves at once
  if (op.kind === 'defend' || !op.launch) sendTo(game, f, pl);
  if (op.kind === 'attack' && !op.launch) f.op.launched = game.year;
  return null;
}

/** Ends an operation: the ships under construction stay in the queues, as ordinary ships. */
export function endOperation(game: GameState, f: Fleet) {
  f.op = undefined;
  for (const pl of game.planets) for (const q of pl.queue) if (q.forOp === f.id) q.forOp = undefined;
  for (const x of game.fleets) if (x.joinOp === f.id) { x.joinOp = undefined; x.waypoints = [x.waypoints[0]]; }
}

/** Sends an existing fleet to reinforce an operation. */
export function joinOperation(game: GameState, f: Fleet, opFleet: Fleet): string | null {
  if (!opFleet.op || opFleet.owner !== f.owner || opFleet === f) return 'pas d\'opération';
  if (f.op) return 'cette flotte mène déjà une opération';
  f.joinOp = opFleet.id;
  steer(game, f, opFleet);
  return null;
}

function sendTo(game: GameState, f: Fleet, pl: Planet) {
  if (f.x === pl.x && f.y === pl.y) { f.waypoints = [f.waypoints[0]]; return; }
  f.waypoints = [f.waypoints[0], { x: pl.x, y: pl.y, target: 'planet', targetId: pl.id, warp: fleetSpec(game, f).idealSpeed || 6, task: 'none' }];
  f.repeat = false;
}

function steer(game: GameState, f: Fleet, to: Fleet) {
  f.pursue = undefined; f.auto = undefined; f.repeat = false;
  f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y }, { x: to.x, y: to.y, target: 'fleet', targetId: to.id, warp: fleetSpec(game, f).idealSpeed || 6, task: 'none' }];
}

const tell = (game: GameState, p: Player, text: string, f: Fleet) => { if (!p.ai) p.messages.push({ year: game.year, kind: 'fleet', text, target: { kind: 'fleet', id: f.id } }); };

/** Yearly, after movement: reinforcements that arrived join, the others are steered, the yards get their orders. */
export function runOperations(game: GameState) {
  // the reinforcements first
  for (const f of [...game.fleets]) {
    if (f.joinOp === undefined || !game.fleets.includes(f)) continue;
    const p = game.players[f.owner];
    const op = game.fleets.find(x => x.id === f.joinOp && x.owner === f.owner && x.op);
    if (!op) { f.joinOp = undefined; tell(game, p, `${f.name} : l'opération qu'elle devait renforcer est terminée. Donnez-lui ses ordres.`, f); continue; }
    if (distance(f, op) < 0.5) {
      const n = shipsIn(f);
      mergeFleets(game, op, f);
      const st = opStatus(game, op);
      tell(game, p, n > 1 ? `${n} renforts rejoignent ${op.name} : ${st.ships} vaisseaux sur ${op.op!.target}.` : `Un renfort rejoint ${op.name} : ${st.ships} vaisseaux sur ${op.op!.target}.`, op);
    } else steer(game, f, op);
  }
  for (const f of game.fleets) {
    const op = f.op;
    if (!op) continue;
    const p = game.players[f.owner];
    const target = game.planets[op.planetId];
    // a defended world lost, a world taken: the operation ends
    if (op.kind === 'defend' && target.owner !== p.id) { tell(game, p, `${f.name} : ${target.name} est perdue, l'opération de défense prend fin.`, f); endOperation(game, f); continue; }
    if (op.kind === 'attack' && target.owner === p.id) { tell(game, p, `${f.name} : ${target.name} est à vous, l'opération est accomplie.`, f); endOperation(game, f); continue; }
    const st = opStatus(game, f);
    // the attack leaves when the fleet is complete
    if (op.kind === 'attack' && op.launch && op.launched === undefined && st.ships >= op.target) {
      op.launched = game.year;
      sendTo(game, f, target);
      tell(game, p, `${f.name} est au complet (${st.ships} vaisseaux) et part pour ${target.name}.`, f);
    }
    if (st.missing <= 0) continue;
    const d = game.designs.find(x => x.id === op.designId);
    // (0.3.9.21: nor a design withdrawn since: the operation kept ordering it)
    if (!d || d.deleted) continue;
    // the closest yards able to build the design, the sector of the target first if asked
    let yards = game.planets.filter(pl => pl.owner === p.id && !pl.queue.some(q => q.forOp === f.id) && canBuildShip(game, pl, d) === null);
    if (op.sectorOnly && target.owner === p.id && target.sector !== undefined) yards = yards.filter(pl => pl.sector === target.sector);
    yards.sort((a, b) => distance(a, f) - distance(b, f));
    yards = yards.slice(0, Math.max(0, OP_YARDS - st.yards.length));
    if (!yards.length) continue;
    const per = Math.ceil(st.missing / yards.length);
    let left = st.missing;
    for (const pl of yards) {
      if (left <= 0) break;
      const qty = Math.min(per, left);
      left -= qty;
      pl.queue.unshift({ kind: 'ship', designId: d.id, qty, allocated: zeroCost(), forOp: f.id });
    }
  }
}

/** A ship built for an operation joins it (turn.ts, onBuild). */
export function builtForOp(game: GameState, built: Fleet, opId: number) {
  const op = game.fleets.find(x => x.id === opId && x.owner === built.owner && x.op);
  if (!op) return;
  built.joinOp = op.id;
  if (distance(built, op) < 0.5) { mergeFleets(game, op, built); return; }
  steer(game, built, op);
}
