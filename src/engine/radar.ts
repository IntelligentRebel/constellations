// Constellations 3.6: the radar. Of everything our scanners see, the hostile ships (empires at war with us, pirates,
// guardians, the crisis, unidentified contacts), and among them the threats: those inside our territory, and those
// whose course (observed over the last years) or announced raid leads them there.
import type { GameState, Planet, Player } from './types';
import { cultureOn, knownTerritoryOwner } from './culture';
import { estimateTrajectory } from './scan';
import { raidsAgainst } from './pirates';
import { waves } from './crisis';

/** Without territories (culture off), "ours" is this close to one of our worlds. */
export const RADAR_NEAR = 60;
/** How many years ahead a course is followed. */
export const RADAR_YEARS = 3;

export interface RadarContact {
  id: number;
  x: number;
  y: number;
  owner: number;
  /** 'inside': in our territory (or in orbit of one of our worlds); 'heading': on its way there; null: elsewhere */
  threat: 'inside' | 'heading' | null;
  /** where it is going: the world of ours it threatens, and in how many years */
  target?: Planet;
  eta?: number;
  /** the course followed to get there (map points) */
  path?: { x: number; y: number }[];
}

export function hostileTo(game: GameState, me: Player, owner: number): boolean {
  if (owner < 0) return true;
  if (owner === me.id) return false;
  if (game.players[owner]?.monster) return true;
  return me.relations[owner] === 'enemy';
}

/** Is this point ours (our territory, or near one of our worlds without territories)? */
export function ours(game: GameState, me: Player, at: { x: number; y: number }, mine?: Planet[]): boolean {
  if (cultureOn(game)) return knownTerritoryOwner(game, me, at) === me.id;
  const own = mine ?? game.planets.filter(p => p.owner === me.id);
  return own.some(p => Math.hypot(p.x - at.x, p.y - at.y) <= RADAR_NEAR);
}

export function radarContacts(game: GameState, me: Player): RadarContact[] {
  const mine = game.planets.filter(p => p.owner === me.id);
  const nearest = (at: { x: number; y: number }) => mine.reduce<Planet | undefined>((b, p) => !b || Math.hypot(p.x - at.x, p.y - at.y) < Math.hypot(b.x - at.x, b.y - at.y) ? p : b, undefined);
  // raids and waves announced against us (the informants name the target)
  const announced = new Map<number, Planet>();
  if (game.pirates?.emerged && !game.pirates.ended) for (const f of raidsAgainst(game, me.id)) announced.set(f.id, game.planets[f.raid!.target]);
  if (game.crisis?.phase === 'active') for (const f of waves(game)) if (f.raid!.empire === me.id) announced.set(f.id, game.planets[f.raid!.target]);
  const out: RadarContact[] = [];
  for (const fi of me.intel.fleets) {
    if (!hostileTo(game, me, fi.owner)) continue;
    const c: RadarContact = { id: fi.id, x: fi.x, y: fi.y, owner: fi.owner, threat: null };
    const orbitMine = fi.orbiting !== undefined && game.planets[fi.orbiting]?.owner === me.id;
    if (orbitMine || ours(game, me, fi, mine)) {
      c.threat = 'inside';
      c.target = orbitMine ? game.planets[fi.orbiting!] : nearest(fi);
    } else if (announced.has(fi.id)) {
      const t = announced.get(fi.id)!;
      c.threat = 'heading'; c.target = t; c.path = [{ x: fi.x, y: fi.y }, { x: t.x, y: t.y }];
    } else {
      // its course: from the positions observed over the years, or, seen for the first time, from its heading
      // and speed as the scanners measure them (Warp w covers w² al a year)
      const tr = estimateTrajectory(me, fi.id, RADAR_YEARS);
      const ahead = tr?.ahead ?? (fi.heading && fi.warp ? Array.from({ length: RADAR_YEARS }, (_, i) => ({ x: fi.x + fi.heading!.x * fi.warp! * fi.warp! * (i + 1), y: fi.y + fi.heading!.y * fi.warp! * fi.warp! * (i + 1) })) : null);
      const k = ahead ? ahead.findIndex(a => ours(game, me, a, mine)) : -1;
      if (ahead && k >= 0) {
        c.threat = 'heading'; c.eta = k + 1; c.target = nearest(ahead[k]);
        c.path = [{ x: fi.x, y: fi.y }, ...ahead.slice(0, k + 1)];
      }
    }
    out.push(c);
  }
  return out;
}
