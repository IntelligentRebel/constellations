// 0.3.9.18: the greenhouse effect of industry (a Constellations rule; it replaces the random climate changes of 0.3.9.17).
// The factories at work on a world release greenhouse gases, and the world warms toward a level set by its industry:
// a logarithmic response, as with carbon dioxide (each doubling of the output adds about the same warming), so that a
// world of 400 resources of factory output tends toward +11 °C, one of 1,000 toward +20 °C, one of 2,500 toward +32 °C.
// It warms slowly (a twentieth of the gap each year) and cools more slowly still (a fiftieth) once its industry is
// cleaner, idle or gone. Three technologies cut the emissions (Énergie décarbonée, Captage du carbone, Régulation
// climatique, the last one also cooling five times faster); temperature terraforming makes up for the rest, within
// its limits. The warming shifts the natural temperature of the world (its base), so that terraforming counts from it.
import type { GameState, Planet, Player } from './types';
import { planetSpec } from './planet';
import { habitability, habString, raceSpec } from './race';
import { hasSpecial, CLEAN_ENERGY, CARBON_CAPTURE, CLIMATE_CONTROL } from './specials';

/** Steps of temperature (4 °C each) per factor e of factory output. */
export const GH_STEPS = 4;
/** Factory output (resources a year) that gives the first factor e. */
export const GH_SCALE = 400;
const RISE = 1 / 20, FALL = 1 / 50, FALL_ACTIVE = 1 / 10;

export const greenhouseOn = (game: GameState) => !!game.settings.greenhouse;

/** Share of its emissions an empire's factories still release, given its technology. */
export function emissionFactor(p: Player): number {
  let f = 1;
  if (hasSpecial(p, CLEAN_ENERGY)) f *= 0.6;
  if (hasSpecial(p, CARBON_CAPTURE)) f *= 0.5;
  if (hasSpecial(p, CLIMATE_CONTROL)) f *= 0.5;
  return f;
}

/** Resources a year produced by the factories at work on this world (the measure of its industry). */
export function factoryOutput(game: GameState, planet: Planet): number {
  if (planet.owner < 0 || planet.pop <= 0 || planet.factories <= 0) return 0;
  const p = game.players[planet.owner];
  if (!p || p.monster || raceSpec(p.race).innate) return 0;
  const spec = planetSpec(game, planet, p);
  return Math.ceil(Math.min(planet.factories, spec.maxFactories) * p.race.factoryOutput / 10);
}

/** The warming (in steps of 4 °C) this world's industry pushes it toward. */
export function greenhouseTarget(game: GameState, planet: Planet): number {
  const out = factoryOutput(game, planet);
  if (out <= 0) return 0;
  return GH_STEPS * Math.log(1 + out * emissionFactor(game.players[planet.owner]) / GH_SCALE);
}

/** Every year, before the instaforming of the CA: each world moves toward the warming its industry sets. */
export function greenhouse(game: GameState) {
  if (!greenhouseOn(game)) return;
  for (const planet of game.planets) {
    const cur = planet.greenhouse ?? 0;
    const target = greenhouseTarget(game, planet);
    if (cur === 0 && target === 0) continue;
    const owner = planet.owner >= 0 ? game.players[planet.owner] : undefined;
    const rate = target >= cur ? RISE : owner && hasSpecial(owner, CLIMATE_CONTROL) ? FALL_ACTIVE : FALL;
    let next = cur + (target - cur) * rate;
    if (target === 0 && next < 0.05) next = 0;
    planet.greenhouse = next > 0 ? Math.round(next * 1000) / 1000 : undefined;
    shift(game, planet, Math.round(next));
  }
}

/** Applies the whole steps of warming to the world's temperature (its base and what it is now: terraforming is kept). */
function shift(game: GameState, planet: Planet, want: number) {
  const had = planet.ghShift ?? 0;
  if (want === had) return;
  const base = Math.max(1, Math.min(99, planet.baseHab[1] + want - had));
  const d = base - planet.baseHab[1];
  if (!d) return;
  const owner = planet.owner >= 0 ? game.players[planet.owner] : undefined;
  const before = owner ? habitability(owner.race, planet.hab) : 0;
  const was = planet.hab[1];
  planet.baseHab[1] = base;
  planet.hab[1] = Math.max(0, Math.min(100, planet.hab[1] + d));
  planet.ghShift = had + d || undefined;
  if (!owner || owner.monster) return;
  const after = habitability(owner.race, planet.hab);
  const n = planet.name, from = habString(1, was), to = habString(1, planet.hab[1]);
  // one whole sentence per case, so that every language can word it its own way
  const text = d > 0
    ? `Effet de serre sur ${n} : les rejets des usines ont réchauffé la planète, de ${from} à ${to}. Valeur pour votre race : ${Math.round(before)} % → ${Math.round(after)} %.`
    : `Effet de serre sur ${n} : l'atmosphère se purifie et la planète se refroidit, de ${from} à ${to}. Valeur pour votre race : ${Math.round(before)} % → ${Math.round(after)} %.`;
  owner.messages.push({ year: game.year, kind: 'event', text, target: { kind: 'planet', id: planet.id } });
}

/** Switching the rule off: the worlds get back their temperature without the warming of industry. */
export function clearGreenhouse(game: GameState) {
  for (const planet of game.planets) {
    const had = planet.ghShift ?? 0;
    if (had) {
      planet.baseHab[1] = Math.max(1, Math.min(99, planet.baseHab[1] - had));
      planet.hab[1] = Math.max(0, Math.min(100, planet.hab[1] - had));
    }
    planet.greenhouse = undefined; planet.ghShift = undefined;
  }
}
