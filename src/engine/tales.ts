// Research rewards told as stories (Constellations 3.2): what was studied, and what it led to.
import type { Field, GameState, Player } from './types';
import type { Rng } from './rng';
import { addResearch } from './research';
import { FIELD_NAMES } from './tech';
import { pickStory } from '../data/stories';

/** Adds the points and returns the sentence that explains them (lower case, no final full stop). */
export function researchStory(game: GameState, p: Player, field: Field, pts: number, kind: string, rng: Rng): string {
  const ev = addResearch(game, p, field, pts, rng);
  const st = pickStory(field, kind, rng.int(10_000), p.told);
  p.told = [...(p.told ?? []), st.index].slice(-60);
  return `${st.text} (+${Math.round(pts).toLocaleString('fr-FR')} points de recherche en ${FIELD_NAMES[field]}${ev.length ? `, niveau ${ev[ev.length - 1].level} atteint` : ''})`;
}
