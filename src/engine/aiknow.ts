// 0.3.9.15: what a computer empire knows of the others, and nothing more. Its decisions about other empires (how strong
// a fleet it sees is, what an invasion takes, who leads the game) go through these estimates, built from its own
// intelligence the way a player would build them from the same screens.
import type { FleetIntel, GameState, Planet, Player } from './types';
import { HULLS, canLearn, meetsLevels } from './tech';
import { TECH_DATA } from '../data/techs';
import { autoDesign, designSpec, specOf } from './design';
import { raceSpec } from './race';

export interface SeenMight { hp: number; pow: number; bomber: boolean }

/** What a ship of this hull is probably worth, as if the other empire had built it with the observer's technology. */
const hullCache = new Map<string, SeenMight>();
function hullGuess(game: GameState, p: Player, hullName: string): SeenMight {
  // (0.3.9.21: what the guess is made of: the observer's technology and race, in this game; the year and the player id
  // alone let another game, or the same year before a level, answer)
  const t = p.tech;
  const key = `${game.settings.seed}:${p.id}:${t.energy},${t.weapons},${t.propulsion},${t.construction},${t.electronics},${t.biotechnology}:${p.race.prt}${(p.race.lrts ?? []).join('')}:${p.doctrines ? JSON.stringify(p.doctrines) : ''}:${(p.acquiredTechs ?? []).join(',')}:${game.settings.fuzzyTechTree ? 'f' : ''}:${hullName}`; // (0.3.9.21: a part from the trader, the shifted tree, change the guess too)
  const known = hullCache.get(key);
  if (known) return known;
  if (hullCache.size > 2000) hullCache.clear();
  const h = HULLS.get(hullName);
  let g: SeenMight = { hp: 50, pow: 0, bomber: false };
  if (h?.starbase) {
    // a station: as the observer would arm that hull itself
    const d = autoDesign(p, h.name, 'starbase', '?');
    const s = d ? designSpec(p, d) : null;
    g = s ? { hp: s.armor + s.shields, pow: s.powerRating, bomber: false } : { hp: h.armor, pow: 0, bomber: false };
  } else if (h && h.type === 'Bomber') g = { hp: h.armor * 1.5, pow: 0, bomber: true };
  else if (h && (h.type === 'Fighter' || h.type === 'CapitalShip' || h.type === 'MultiPurposeFreighter')) {
    // warships for sure; the armed freighters (Privateer, Galleon…) carry cargo as often as guns: half the guns
    const d = autoDesign(p, h.name, 'beamWarship', '?');
    const s = d ? designSpec(p, d) : null;
    g = s ? { hp: s.armor + s.shields, pow: s.powerRating * (h.type === 'MultiPurposeFreighter' ? 0.5 : 1), bomber: false } : { hp: h.armor * 1.5, pow: h.mass * 4, bomber: false };
  } else if (h) g = { hp: h.armor, pow: 0, bomber: false };
  hullCache.set(key, g);
  return g;
}

/**
 * The strength of a fleet this empire has in its scanners: exact for the designs it knows (met in battle, or read by a
 * race whose scanners see inside), a guess from the hull otherwise, and from the mass for a contact it cannot make out.
 */
export function seenMight(game: GameState, p: Player, fi: FleetIntel): SeenMight {
  if (fi.uncertain || fi.detail !== 'full' || !fi.tokens?.length) {
    const m = fi.mass ?? 60;
    return { hp: m * 3, pow: m * 4, bomber: false };
  }
  const out: SeenMight = { hp: 0, pow: 0, bomber: false };
  for (const t of fi.tokens) {
    const g = seenDesign(game, p, t.designId);
    out.hp += g.hp * t.qty; out.pow += g.pow * t.qty; out.bomber ||= g.bomber;
  }
  return out;
}
/** One ship (or station) of a design of another empire, as far as this empire knows it. */
export function seenDesign(game: GameState, p: Player, designId: number): SeenMight {
  const di = p.intel.designs[designId], d = game.designs.find(x => x.id === designId);
  if (d && (di?.slots || d.owner === p.id)) { const s = specOf(game, designId); return { hp: s.armor + s.shields, pow: s.powerRating, bomber: s.bomber }; }
  return hullGuess(game, p, di?.hull ?? d?.hull ?? '');
}
/** The same, as one number (hit points × firepower, the way the computers weigh fleets). */
export const seenStrength = (game: GameState, p: Player, fi: FleetIntel) => { const m = seenMight(game, p, fi); return Math.max(1, m.hp) * Math.max(1, m.pow); };

/** Shields and armor of the warships of an empire whose designs this empire knows inside out (for choosing its weapons). */
export function seenProtection(game: GameState, p: Player, of: number): { shields: number; armor: number } {
  let shields = 0, armor = 0;
  for (const fi of p.intel.fleets) {
    if (fi.owner !== of || fi.uncertain || !fi.tokens) continue;
    for (const t of fi.tokens) {
      const d = game.designs.find(x => x.id === t.designId);
      if (!d || !(p.intel.designs[t.designId]?.slots || d.owner === p.id)) continue;
      const s = specOf(game, t.designId);
      if (!s.hasWeapons || s.starbase) continue;
      shields += s.shields * t.qty; armor += s.armor * t.qty;
    }
  }
  return { shields, armor };
}

/**
 * The defense coverage of another empire's world as this empire can estimate it: the defenses it has counted there (a
 * few more each year since), of the best kind that race could build with the observer's own technology.
 */
export function seenCoverage(game: GameState, p: Player, planet: Planet): number {
  const pi = p.intel.planets[planet.id];
  const owner = pi?.owner !== undefined && pi.owner >= 0 ? game.players[pi.owner] : undefined;
  if (!owner || !raceSpec(owner.race).canBuildDefenses) return 0;
  let def = null as (typeof TECH_DATA)[number] | null;
  for (const t of TECH_DATA) if (t.cat === 'PlanetaryDefense' && canLearn(owner.race, t.req) && meetsLevels(p.tech, t.req)) def = t; // data ordered by strength
  const c = (def?.stats?.defenseCoverage ?? 0) / 100;
  const n = Math.min(100, (pi.defenses ?? 100) + 4 * Math.max(0, game.year - (pi.year ?? game.year)));
  return 1 - Math.pow(1 - c, n);
}

/**
 * The score of another empire as this empire knows it: the real one when scores are public, its intelligence's estimate
 * otherwise, and failing that a guess from the worlds of that empire it has seen (each worth one of its own).
 */
export function knownScore(game: GameState, p: Player, id: number): number {
  const last = (q: Player) => q.scores[q.scores.length - 1]?.score ?? 0;
  const them = game.players[id];
  if (!them) return 0;
  if (id === p.id || game.settings.publicScores || game.victor !== null) return last(them);
  const f = p.intel.dossiers?.[id]?.facts.score;
  if (f) return f.v;
  const mine = Math.max(1, game.planets.filter(x => x.owner === p.id).length);
  const seen = p.intel.planets.filter(pi => pi.owner === id).length;
  return Math.round(last(p) * seen / mine);
}
