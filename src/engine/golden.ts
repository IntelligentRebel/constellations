// 0.3.9: golden ages. The culture an empire radiates every year (its worlds, its capital, its stations, its cultural
// buildings, its patronage) becomes inspiration; when enough of it has gathered, a golden age begins: for ten years,
// 15 % more resources and 15 % more research. The next one asks for more inspiration (×1.7).
import type { GameState, Player } from './types';
import { cultureGain, cultureOn } from './culture';
import { addChronicle } from './chronicle';

export const goldenOn = (game: GameState) => !!game.settings.goldenAges && cultureOn(game);
export const GOLDEN_YEARS = 10;
export const GOLDEN_BONUS = 0.15;
export const GOLDEN_FIRST = 1200, GOLDEN_GROWTH = 1.7;

/** Is this empire in a golden age this year? */
export const inGoldenAge = (game: GameState, p: Player) => goldenOn(game) && (p.golden?.until ?? 0) >= game.year;

/** Inspiration gathered this year (what its worlds radiate). */
export function inspirationGain(game: GameState, p: Player): number {
  let total = 0;
  for (const pl of game.planets) if (pl.owner === p.id) total += cultureGain(game, pl).total;
  return total;
}

/** Yearly: inspiration gathers, golden ages begin and end. */
export function runGoldenAges(game: GameState) {
  if (!goldenOn(game)) return;
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    const g = p.golden ?? (p.golden = { inspiration: 0, next: GOLDEN_FIRST, count: 0 });
    if (g.until !== undefined && g.until === game.year - 1) {
      p.messages.push({ year: game.year, kind: 'event', text: `Votre âge d'or s'achève. L'inspiration recommence à s'accumuler : il en faudra ${Math.round(g.next)} pour le prochain.`, target: { kind: 'colonies', id: 0 } });
    }
    if (inGoldenAge(game, p)) continue;
    g.inspiration += inspirationGain(game, p);
    if (g.inspiration < g.next) continue;
    g.inspiration = 0;
    g.count++;
    // (0.3.9.21: the age starts after this year's production: ten productions, from next year to `until`; it gave nine)
    g.until = game.year + GOLDEN_YEARS;
    g.next = Math.round(g.next * GOLDEN_GROWTH);
    p.messages.unshift({ year: game.year, kind: 'event', text: `Un âge d'or commence ! Vos mondes rayonnent : jusqu'en ${g.until}, ${Math.round(GOLDEN_BONUS * 100)} % de ressources et de recherche en plus.`, target: { kind: 'colonies', id: 0 } });
    for (const o of game.players) if (o !== p && !o.monster && !o.dead && o.intel.met.includes(p.id)) o.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${p.name} entrent dans un âge d'or.`, target: { kind: 'player', id: p.id } });
    addChronicle(game, 'golden', g.count > 1 ? `Les ${p.name} entrent dans un nouvel âge d'or.` : `Les ${p.name} entrent dans un âge d'or.`, [p.id]);
  }
}

/** Patronage counts as inspiration too (the points bought at once). */
export function patronageInspiration(game: GameState, p: Player, points: number) {
  if (!goldenOn(game) || inGoldenAge(game, p)) return;
  const g = p.golden ?? (p.golden = { inspiration: 0, next: GOLDEN_FIRST, count: 0 });
  g.inspiration += points;
}
