// 0.3.9: the diaspora. An empire that loses its last world lives on while one of its arks still carries colonists:
// the people wait aboard (the arks gather a little fuel from the stars every year) for a world where to begin again.
// The first colony founded in exile becomes the new capital, with factories and mines brought in the holds.
import type { GameState, Planet, Player } from './types';
import { fleetSpec } from './fleet';
import { addChronicle } from './chronicle';
import { people } from './words';

export const diasporaOn = (game: GameState) => !!game.settings.diaspora;
/** Gifts of the exile to the new capital. */
export const REFOUND_FACTORIES = 20, REFOUND_MINES = 20;

export const loadedArks = (game: GameState, p: Player) => game.fleets.filter(f => f.owner === p.id && f.cargo.colonists > 0 && fleetSpec(game, f).colonizer);

/** Does an empire with no world live on? (Stars!: any colonizer; diaspora: an ark with colonists aboard.) */
export function survivesWithoutWorld(game: GameState, p: Player): boolean {
  if (diasporaOn(game)) return loadedArks(game, p).length > 0;
  return game.fleets.some(f => f.owner === p.id && fleetSpec(game, f).colonizer);
}

/** Yearly, after the deaths: the exile begins, the arks gather fuel. */
export function runDiaspora(game: GameState) {
  if (!diasporaOn(game)) return;
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    const worlds = game.planets.some(pl => pl.owner === p.id);
    if (worlds) { if (p.exile && !p.exile.refounded) p.exile = undefined; continue; }
    const arks = loadedArks(game, p);
    if (!arks.length) continue;
    if (!p.exile || p.exile.refounded) {
      p.exile = { since: game.year };
      const aboard = arks.reduce((a, f) => a + f.cargo.colonists, 0) * 100;
      p.messages.unshift({ year: game.year, kind: 'warning', text: `Votre dernier monde est tombé. Votre peuple survit à bord de ${arks.length} arche${arks.length > 1 ? 's' : ''} (${people(game, aboard)}) : tant qu'une arche chargée vole, l'empire vit. Fondez une colonie et elle deviendra votre nouvelle capitale, avec ${REFOUND_FACTORIES} usines et ${REFOUND_MINES} mines apportées dans les soutes.`, target: { kind: 'fleet', id: arks[0].id } });
      for (const o of game.players) if (o !== p && !o.monster && !o.dead && o.intel.met.includes(p.id)) o.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${p.name} ont perdu leur dernier monde, mais leur peuple erre encore à bord de ses arches.`, target: { kind: 'player', id: p.id } });
      addChronicle(game, 'diaspora', `Les ${p.name} perdent leur dernier monde : leur peuple prend la route des étoiles.`, [p.id]);
    }
    for (const f of arks) { const cap = fleetSpec(game, f).fuelCapacity; f.fuel = Math.min(cap, f.fuel + Math.ceil(cap * 0.1)); }
  }
}

/** A colony founded in exile: the new capital. Called by the colonisation. */
export function refound(game: GameState, p: Player, planet: Planet) {
  if (!p.exile || p.exile.refounded) return;
  const years = game.year - p.exile.since;
  p.exile.refounded = game.year;
  p.capital = planet.id;
  planet.factories += REFOUND_FACTORIES;
  planet.mines += REFOUND_MINES;
  p.stats.refounded = (p.stats.refounded ?? 0) + 1;
  p.messages.push({ year: game.year, kind: 'colony', text: years > 0 ? `Après ${years} an${years > 1 ? 's' : ''} d'exil, votre peuple refonde l'empire sur ${planet.name}, sa nouvelle capitale : les soutes des arches y déchargent ${REFOUND_FACTORIES} usines et ${REFOUND_MINES} mines.` : `Votre peuple refonde aussitôt l'empire sur ${planet.name}, sa nouvelle capitale : les soutes des arches y déchargent ${REFOUND_FACTORIES} usines et ${REFOUND_MINES} mines.`, target: { kind: 'planet', id: planet.id } });
  addChronicle(game, 'diaspora', `Après ${years} ans d'exil, les ${p.name} refondent leur empire sur ${planet.name}.`, [p.id], planet);
}
