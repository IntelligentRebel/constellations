// Scores and victory conditions.
import type { GameState, Player, ScoreEntry } from './types';
import { FIELDS } from './types';
import { planetSpec } from './planet';
import { specOf } from './design';
import { objectivePoints } from './objectives';

/** The three classes of ships the score counts (by power rating). */
export type ShipClass = 'unarmed' | 'escort' | 'capital';
export function shipClass(game: GameState, designId: number): ShipClass {
  const s = specOf(game, designId);
  return s.powerRating <= 0 ? 'unarmed' : s.powerRating < 2000 ? 'escort' : 'capital';
}

export function computeScore(game: GameState, player: Player): ScoreEntry {
  let planets = 0, starbases = 0, score = 0, resources = 0, unarmed = 0, escort = 0, capital = 0, techLevels = 0;
  for (const p of game.planets) {
    if (p.owner !== player.id) continue;
    planets++;
    if (p.starbase) starbases++;
    score += Math.min(Math.trunc(p.pop / 100000), 6);
    resources += planetSpec(game, p, player).resources;
  }
  for (const f of game.fleets) {
    if (f.owner !== player.id) continue;
    for (const t of f.tokens) {
      const c = shipClass(game, t.designId);
      if (c === 'unarmed') unarmed += t.qty; else if (c === 'escort') escort += t.qty; else capital += t.qty;
    }
  }
  for (const f of FIELDS) {
    const lvl = player.tech[f];
    techLevels += lvl;
    for (let l = 1; l <= lvl; l++) score += l <= 3 ? 1 : l <= 6 ? 2 : l <= 9 ? 3 : 4;
  }
  score += Math.trunc(resources / 30) + starbases * 3;
  score += Math.trunc(Math.min(unarmed * 0.5, planets));
  score += Math.trunc(Math.min(escort * 2, planets));
  if (capital + planets > 0) score += Math.trunc(8 * capital * planets / (capital + planets));
  if (game.settings.secretObjectives) score += objectivePoints(player);
  return { year: game.year, score, planets, starbases, unarmed, escort, capital, techLevels, resources };
}

export const VICTORY_LABELS = [
  'Possède {ownPlanets} % des planètes',
  'Atteint le niveau {level} dans {fields} domaines',
  'Dépasse un score de {exceedScore}',
  'A un score supérieur d\'au moins {exceedSecond} % à celui du deuxième',
  'Produit {production} milliers de ressources par an',
  'Possède {capitalShips} vaisseaux capitaux',
  'Meilleur score après {highestAfter} ans',
];

/** Returns bitmask of victory conditions met by each player. */
export function checkVictory(game: GameState): number | null {
  const v = game.settings.victory;
  const scores = game.players.map(p => p.scores[p.scores.length - 1]);
  const total = game.planets.length;
  const years = game.year - 2400;
  let victor: number | null = null;
  for (const p of game.players) {
    if (p.dead) { p.victoryMet = 0; continue; }
    const s = scores[p.id];
    if (!s) continue;
    let mask = 0;
    if (v.ownPlanets !== null && s.planets >= total * v.ownPlanets / 100) mask |= 1;
    if (v.attainTech && FIELDS.filter(f => p.tech[f] >= v.attainTech!.level).length >= v.attainTech.fields) mask |= 2;
    if (v.exceedScore !== null && s.score > v.exceedScore) mask |= 4;
    if (v.exceedSecond !== null) {
      const others = scores.filter((x, i) => i !== p.id && x && !game.players[i].dead).map(x => x!.score);
      const second = Math.max(1, ...others);
      if (others.length && s.score * 100 / second >= 100 + v.exceedSecond) mask |= 8;
    }
    if (v.production !== null && s.resources >= v.production * 1000) mask |= 16;
    if (v.capitalShips !== null && s.capital >= v.capitalShips) mask |= 32;
    if (v.highestAfter !== null && years >= v.highestAfter && scores.every((x, i) => i === p.id || !x || x.score < s.score)) mask |= 64;
    p.victoryMet = mask;
    const n = countBits(mask);
    if (n >= v.numCriteria && years >= v.minYears && victor === null) victor = p.id;
  }
  // last player standing
  const alive = game.players.filter(p => !p.dead);
  if (alive.length === 1 && game.players.filter(p => !p.monster).length > 1) victor = alive[0].id;
  return victor;
}

export function countBits(n: number): number { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; }
