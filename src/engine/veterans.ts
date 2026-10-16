// 0.3.9: veterans. Crews that survive battles learn: a fleet gains experience (more for the enemy ships it destroys),
// climbs ranks, and fights a little better (damage and accuracy). Merging a fleet of recruits into a
// veteran one dilutes its experience. Every fleet keeps a log of its life (commissioning, battles, ranks, merges).
import type { Fleet, GameState } from './types';
import { addChronicle } from './chronicle';

export const veteransOn = (game: GameState) => !!game.settings.veterans;

/** Experience needed for each rank. */
export const RANKS: { min: number; name: string }[] = [
  { min: 0, name: 'Recrues' },
  { min: 15, name: 'Aguerris' },
  { min: 40, name: 'Vétérans' },
  { min: 90, name: 'Élite' },
  { min: 180, name: 'Légende' },
];

export function rankOf(f: Pick<Fleet, 'xp'>): number {
  const xp = f.xp ?? 0;
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].min) r = i;
  return r;
}

/** What a rank gives in battle: damage of beams, accuracy of torpedoes (no initiative: firing first decides too much). */
export function rankBonus(rank: number): { damage: number; accuracy: number } {
  return { damage: 1 + 0.04 * rank, accuracy: 0.03 * rank };
}

export function rankBonusText(rank: number): string {
  if (rank <= 0) return 'aucun bonus';
  const b = rankBonus(rank);
  return `+${Math.round((b.damage - 1) * 100)} % de dégâts des rayons, +${Math.round(b.accuracy * 100)} points de précision des torpilles`;
}

/** A line in the fleet's log (the first lines and the 40 last are kept). */
export function logFleet(game: GameState, f: Fleet, text: string) {
  if (!veteransOn(game) || game.players[f.owner]?.monster) return;
  const j = f.journal ?? (f.journal = []);
  j.push({ year: game.year, text });
  if (j.length > 45) j.splice(3, j.length - 45);
}

/** Experience gained in a battle (armed fleets that survive): 3 for being there, 4 per enemy ship destroyed. */
export function battleExperience(game: GameState, f: Fleet, kills: number, lost: number, where: string) {
  if (!veteransOn(game) || game.players[f.owner]?.monster || !f.tokens.length) return;
  const before = rankOf(f);
  f.xp = (f.xp ?? 0) + 3 + 4 * kills;
  f.battles = (f.battles ?? 0) + 1;
  f.kills = (f.kills ?? 0) + kills;
  logFleet(game, f, lost ? `Bataille à ${where} : ${kills} vaisseau${kills > 1 ? 'x' : ''} ennemi${kills > 1 ? 's' : ''} détruit${kills > 1 ? 's' : ''}, ${lost} perdu${lost > 1 ? 's' : ''}.` : `Bataille à ${where} : ${kills} vaisseau${kills > 1 ? 'x' : ''} ennemi${kills > 1 ? 's' : ''} détruit${kills > 1 ? 's' : ''}, aucune perte.`);
  const after = rankOf(f);
  if (after > before) {
    logFleet(game, f, `Promue au rang « ${RANKS[after].name} ».`);
    game.players[f.owner].messages.push({ year: game.year, kind: 'fleet', text: `${f.name} passe au rang « ${RANKS[after].name} » : ${rankBonusText(after)}.`, target: { kind: 'fleet', id: f.id } });
    if (after === RANKS.length - 1) addChronicle(game, 'veteran', `${f.name}, flotte des ${game.players[f.owner].name}, entre dans la légende après ${f.battles} batailles et ${f.kills} vaisseaux ennemis détruits.`, [f.owner], f);
  }
}

/** Ships count of a fleet. */
const ships = (f: Fleet) => f.tokens.reduce((a, t) => a + t.qty, 0);

/** Before `from` is merged into `into`: the experience becomes the average per ship, the logs are told. */
export function mergeExperience(game: GameState, into: Fleet, from: Fleet) {
  const a = ships(into), b = ships(from);
  if (a + b > 0 && ((into.xp ?? 0) > 0 || (from.xp ?? 0) > 0)) into.xp = Math.floor(((into.xp ?? 0) * a + (from.xp ?? 0) * b) / (a + b));
  into.battles = Math.max(into.battles ?? 0, from.battles ?? 0);
  into.kills = (into.kills ?? 0) + (from.kills ?? 0);
  if (into.born === undefined || (from.born !== undefined && from.born < into.born)) into.born = from.born ?? into.born;
  if (b > 0) logFleet(game, into, (from.xp ?? 0) > 0 ? `Renforcée par ${b} vaisseau${b > 1 ? 'x' : ''} de ${from.name}, au rang « ${RANKS[rankOf(from)].name} ».` : `Renforcée par ${b} vaisseau${b > 1 ? 'x' : ''} de ${from.name}.`);
}

/** A new fleet split from another keeps its experience and its log. */
export function splitExperience(game: GameState, from: Fleet, part: Fleet) {
  part.xp = from.xp; part.battles = from.battles; part.kills = 0; part.born = from.born;
  part.journal = from.journal ? [...from.journal] : undefined;
  logFleet(game, part, `Détachée de ${from.name}.`);
}
