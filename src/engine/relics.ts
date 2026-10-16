// Relics (Constellations 3.2): permanent bonuses found at the end of an archaeological dig, on a guardian's
// remains or in the Ancients' vault. Small on their own (5 to 15 %), they add up over a long game.
import type { Player } from './types';

export type RelicId = 'codex' | 'seed' | 'forge' | 'eye' | 'compass' | 'heart' | 'horizon';

export const RELICS: Record<RelicId, { name: string; effect: string }> = {
  codex: { name: 'Codex des Bâtisseurs', effect: '+10 % de points de recherche' },
  seed: { name: 'Semences de Vael', effect: '+15 % de croissance démographique' },
  forge: { name: 'Forge froide', effect: '+10 % de minerais extraits par vos mines' },
  eye: { name: 'Œil du Veilleur', effect: 'portée des scanners planétaires +25 %' },
  compass: { name: 'Compas des Navigateurs', effect: '−15 % de carburant consommé' },
  heart: { name: 'Cœur des Anciens', effect: '+10 % de ressources et +10 % de recherche' },
  // 0.3.7: only at the end of the study of a black hole's horizon
  horizon: { name: 'Équations de l\'horizon', effect: '+10 % de points de recherche' },
};
export const RELIC_IDS = Object.keys(RELICS) as RelicId[];

export const hasRelic = (p: Player | undefined, id: RelicId) => !!p?.relics?.includes(id);

/** Multiplier of the research points of an empire (relics, origins). */
export function researchFactor(p: Player): number {
  let k = 1;
  if (hasRelic(p, 'codex')) k += 0.1;
  if (hasRelic(p, 'heart')) k += 0.1;
  if (hasRelic(p, 'horizon')) k += 0.1;
  if (p.origin === 'proteges') k -= 0.1;
  return k;
}

/** Gives a relic (false if already owned). */
export function giveRelic(p: Player, id: RelicId): boolean {
  if (hasRelic(p, id)) return false;
  p.relics = [...(p.relics ?? []), id];
  return true;
}

/** A relic the player does not have yet (deterministic pick from a number), or null if they have them all. */
export function missingRelic(p: Player, n: number, exclude: RelicId[] = ['heart']): RelicId | null {
  // the horizon's relic is only found at a black hole
  const left = RELIC_IDS.filter(r => r !== 'horizon' && !hasRelic(p, r) && !exclude.includes(r));
  return left.length ? left[Math.abs(Math.trunc(n)) % left.length] : null;
}
