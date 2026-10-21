// 0.3.9.17: technology trading, as in Stars! (help, "Salvage from Space Battles"; wiki, "Tech trading"): an empire that
// meets more advanced technology (the ships it fought and survived, the ships it took apart at its stations, the world it
// conquered) may learn from it: a 0.5 x (1 - 0.5^n) chance, n being the number of fields where that technology is ahead
// (so at most 50 %), one level in one of those fields, and no more than one such gain a year.
import type { BattleRecord, Field, GameState, Player, TechLevels } from './types';
import { FIELDS } from './types';
import { Rng, seedFromString } from './rng';
import { MAX_TECH, levelGained } from './research';
import { FIELD_NAMES, TECHS, HULLS, reqLevels } from './tech';

const NONE: TechLevels = { energy: 0, weapons: 0, propulsion: 0, construction: 0, electronics: 0, biotechnology: 0 };

/** The technology a design embodies: in each field, the highest requirement of its hull and of its parts. */
export function designLevels(game: GameState, designId: number): TechLevels {
  const d = game.designs.find(x => x.id === designId);
  const out = { ...NONE };
  if (!d) return out;
  const items = [HULLS.get(d.hull), ...d.slots.map(s => TECHS.get(s.part))];
  for (const t of items) {
    if (!t || t.req.acquirable) continue; // alien parts teach nothing (they are only seen, never understood)
    const l = reqLevels(t.req);
    for (const f of FIELDS) out[f] = Math.max(out[f], l[f]);
  }
  return out;
}

/** Field by field, the highest of several levels. */
export function maxLevels(list: TechLevels[]): TechLevels {
  const out = { ...NONE };
  for (const l of list) for (const f of FIELDS) out[f] = Math.max(out[f], l[f]);
  return out;
}

/** A level gained without research (trade, Mystery Trader): research then moves on as it would after a level. */
export function gainLevel(game: GameState, p: Player, f: Field) {
  if (p.tech[f] >= MAX_TECH) return;
  p.tech[f] += 1;
  levelGained(p, f);
  void game;
}

/** One tech trade attempt; `how` opens the message ("En étudiant les épaves de la bataille de X"). The field, or null. */
export function tradeTech(game: GameState, gainer: Player, source: TechLevels, rng: Rng, how: string): Field | null {
  if (gainer.monster || gainer.dead || gainer.techTradeYear === game.year) return null;
  const ahead = FIELDS.filter(f => source[f] > gainer.tech[f] && gainer.tech[f] < MAX_TECH);
  if (!ahead.length) return null;
  if (!rng.chance(0.5 * (1 - Math.pow(0.5, ahead.length)))) return null;
  const f = rng.pick(ahead);
  gainer.techTradeYear = game.year;
  gainLevel(game, gainer, f);
  gainer.messages.push({ year: game.year, kind: 'research', text: `${how}, vos scientifiques ont progressé en ${FIELD_NAMES[f]} : niveau ${gainer.tech[f]}.`, target: { kind: 'research', id: 0 } });
  return f;
}

/**
 * 0.3.9.21: the empires this one exchanged fire with in a battle (an ally's ships, or those of a bystander at peace
 * with everyone, are not "the enemy ships it fought").
 */
export function foughtWith(b: BattleRecord, pid: number): Set<number> {
  const owner = new Map(b.tokens.map(t => [t.id, t.owner]));
  const out = new Set<number>();
  for (const a of b.actions) {
    if (a.t !== 'fire') continue;
    const from = owner.get(a.id), to = owner.get(a.target);
    if (from === undefined || to === undefined) continue;
    if (from === pid && to !== pid) out.add(to);
    if (to === pid && from !== pid) out.add(from);
  }
  return out;
}

/** After the battles of the year: each empire still on the field may learn from the enemy ships it fought. */
export function battleTechTrades(game: GameState) {
  const rng = new Rng(seedFromString(`${game.settings.seed}|techtrade|${game.year}`));
  for (const b of game.battles) {
    const where = b.planetId !== undefined ? game.planets[b.planetId].name : `(${Math.round(b.x)}, ${Math.round(b.y)})`;
    for (const pid of b.players) {
      const p = game.players[pid];
      if (!p || p.monster || p.dead) continue;
      // survived the battle: ships still there, or the station of the world
      const here = game.fleets.some(f => f.owner === pid && f.tokens.length && Math.abs(f.x - b.x) < 0.5 && Math.abs(f.y - b.y) < 0.5)
        || (b.planetId !== undefined && game.planets[b.planetId].owner === pid && !!game.planets[b.planetId].starbase);
      if (!here) continue;
      const foes = foughtWith(b, pid);
      const theirs = b.tokens.filter(t => foes.has(t.owner) && !game.players[t.owner]?.monster).map(t => designLevels(game, t.designId));
      if (!theirs.length) continue;
      tradeTech(game, p, maxLevels(theirs), rng, `En étudiant les vaisseaux ennemis de la bataille de ${where}`);
    }
  }
}
