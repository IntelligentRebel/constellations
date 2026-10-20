// 0.3.9.20: what the interface computes again and again while nothing has changed. A render of the whole interface
// asks planetSpec for every colony (the header, the list of colonies) and estimates the route of every fleet (the
// list of fleets, the routes on the map) several times over: the answers are kept until the game changes, that is
// until the game may have changed: the next bump of the store or the next order (both move store.dataRev; a selection,
// a dialog or a tab does not). Only for rendering: an action that changes the game and reads it back at once calls
// the engine directly.
import { store } from './store';
import type { Fleet, GameState, Planet, Player } from '../engine/types';
import { planetSpec, type PlanetSpec } from '../engine/planet';
import { estimateRoute, fleetSpec, type FleetSpec, type LegEstimate } from '../engine/fleet';
import { scannersOf } from '../engine/scan';
import { estimateQueue, type QueueEstimate } from '../engine/production';

/** The state of the game as far as the caches are concerned (every bump of the game, and every order: store.checkpoint). */
const rev = () => store.dataRev;

const specs = new WeakMap<Planet, { rev: number; game: GameState; by: Map<number, PlanetSpec> }>();
/** planetSpec, kept while the game does not change. */
export function viewSpec(game: GameState, planet: Planet, player: Player = game.players[planet.owner]): PlanetSpec {
  const r = rev();
  let e = specs.get(planet);
  if (!e || e.rev !== r || e.game !== game) specs.set(planet, e = { rev: r, game, by: new Map() });
  let sp = e.by.get(player.id);
  if (!sp) e.by.set(player.id, sp = planetSpec(game, planet, player));
  return sp;
}

const routes = new WeakMap<Fleet, { rev: number; game: GameState; wps: Fleet['waypoints']; fuel: number; legs: LegEstimate[] }>();
/** estimateRoute along the fleet's own route, kept while the game does not change. */
export function viewRoute(game: GameState, fleet: Fleet): LegEstimate[] {
  const r = rev();
  const e = routes.get(fleet);
  if (e && e.rev === r && e.game === game && e.wps === fleet.waypoints && e.fuel === fleet.fuel) return e.legs;
  const legs = estimateRoute(game, fleet);
  routes.set(fleet, { rev: r, game, wps: fleet.waypoints, fuel: fleet.fuel, legs });
  return legs;
}

const memos = new Map<string, { rev: number; game: GameState; value: unknown }>();
let memosRev = -1;
/** Any value computed from the game for rendering, kept under a name while the game does not change. */
export function viewMemo<T>(name: string, game: GameState, compute: () => T): T {
  const r = rev();
  if (r !== memosRev) { memos.clear(); memosRev = r; } // (nothing older is of any use, nor kept alive)
  const e = memos.get(name);
  if (e && e.rev === r && e.game === game) return e.value as T;
  const value = compute();
  memos.set(name, { rev: r, game, value });
  return value;
}

const fleets = new WeakMap<Fleet, { rev: number; game: GameState; tokens: Fleet['tokens']; spec: FleetSpec }>();
/** fleetSpec, kept while the game does not change (and the fleet keeps its ships). */
export function viewFleet(game: GameState, fleet: Fleet): FleetSpec {
  const r = rev();
  const e = fleets.get(fleet);
  if (e && e.rev === r && e.game === game && e.tokens === fleet.tokens) return e.spec;
  const spec = fleetSpec(game, fleet);
  fleets.set(fleet, { rev: r, game, tokens: fleet.tokens, spec });
  return spec;
}

/** Every scanner of a player (the scanner wash of the map, the header of the map page). */
export const viewScanners = (game: GameState, player: Player) => viewMemo('scan:' + player.id, game, () => scannersOf(game, player));

const queues = new WeakMap<Planet, { rev: number; game: GameState; years: number; est: QueueEstimate[] }>();
/** estimateQueue (a simulation of the years to come: the costliest thing a render asks), kept while the game does not change. */
export function viewQueue(game: GameState, planet: Planet, maxYears: number): QueueEstimate[] {
  const r = rev();
  const e = queues.get(planet);
  if (e && e.rev === r && e.game === game && e.years === maxYears) return e.est;
  const est = estimateQueue(game, planet, maxYears);
  queues.set(planet, { rev: r, game, years: maxYears, est });
  return est;
}
