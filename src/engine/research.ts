// Research: six fields, 26 levels, Stars! cost table.
import type { Field, GameState, Player, TechLevels } from './types';
import { FIELDS } from './types';
import { RULES_RAW } from '../data/rules-raw';
import { researchCostFactor, raceSpec } from './race';
import { TECH_DATA } from '../data/techs';
import { HULL_DATA } from '../data/hulls';
import { FIELD_KEYS, FIELD_NAMES, canLearn, mainField, effReq } from './tech';
import { Rng, seedFromString } from './rng';
import type { TechReq } from '../data/types';
import { actOf } from './acts';

export const MAX_TECH = 26;
const BASE: number[] = RULES_RAW.techBaseCost;

export function totalLevels(t: TechLevels): number { return FIELDS.reduce((a, f) => a + t[f], 0); }

export function researchCost(game: GameState | null, player: Player, field: Field, level = player.tech[field]): number {
  if (level >= MAX_TECH) return 0;
  // 0.3.9: the third act makes research 15 % cheaper
  const f = researchCostFactor(player.race.researchCost[field]) * (game?.settings.slowTech ? 2 : 1) * (game && actOf(game) === 3 && game.settings.acts ? 0.85 : 1);
  return Math.trunc((BASE[level + 1] + totalLevels(player.tech) * 10) * f);
}

export function lowestField(player: Player): Field | null {
  let best: Field | null = null;
  for (const f of FIELDS) if (player.tech[f] < MAX_TECH && (best === null || player.tech[f] < player.tech[best])) best = f;
  return best;
}

export interface ResearchEvent { field: Field; level: number; /** share of the cost spent when the breakthrough came (random research) */ ratio?: number }

/**
 * Random research (in the spirit of Master of Orion 2): from half of a level's cost on, each year
 * gives a chance of breakthrough that grows with the points accumulated, reaching certainty at 130 %.
 * Points beyond the cost carry over to the next level, so luck changes timing, not long-run speed.
 */
export function breakthroughChance(r: number): number {
  return Math.min(1, Math.max(0, (r - 0.5) / 0.8)) ** 1.6;
}

function luckOn(game: GameState | null): boolean { return !!game?.settings.randomResearch; }

/** Deterministic random stream when no turn generator is at hand (artifacts, stealing). */
function fallbackRng(game: GameState, player: Player, field: Field): Rng {
  return new Rng(seedFromString(`${game.settings.seed}|${game.year}|${player.id}|${field}|${player.researchSpent[field]}`));
}

/** Random mode: add points to a field, then roll for breakthroughs (several if far beyond the cost). */
function addAndRoll(game: GameState, player: Player, field: Field, amount: number, events: ResearchEvent[], rng: Rng) {
  if (player.tech[field] >= MAX_TECH) return;
  player.researchSpent[field] += amount;
  for (let guard = 0; guard < 12 && player.tech[field] < MAX_TECH; guard++) {
    const cost = researchCost(game, player, field);
    const r = cost > 0 ? player.researchSpent[field] / cost : 1;
    if (rng.random() >= breakthroughChance(r)) break;
    player.researchSpent[field] = Math.max(0, player.researchSpent[field] - cost);
    player.tech[field] += 1;
    events.push({ field, level: player.tech[field], ratio: r });
  }
}

function spendOnce(game: GameState, player: Player, field: Field, amount: number, events: ResearchEvent[]): number {
  // returns leftover after possibly gaining a level
  if (player.tech[field] >= MAX_TECH) return amount;
  const cost = researchCost(game, player, field);
  if (player.researchSpent[field] + amount >= cost) {
    const leftover = player.researchSpent[field] + amount - cost;
    player.tech[field] += 1;
    player.researchSpent[field] = 0;
    events.push({ field, level: player.tech[field] });
    return leftover;
  }
  player.researchSpent[field] += amount;
  return 0;
}

/** Spend research resources; returns the list of levels gained. */
export function doResearch(game: GameState, player: Player, pool: number, rng?: Rng): ResearchEvent[] {
  const rs = raceSpec(player.race);
  const events: ResearchEvent[] = [];
  const toSpend = Math.trunc(pool * rs.researchFactor + 0.5);
  if (luckOn(game)) {
    if (player.tech[player.researching] >= MAX_TECH) player.researching = lowestField(player) ?? player.researching;
    const f = player.researching;
    const before = player.tech[f];
    addAndRoll(game, player, f, toSpend, events, rng ?? fallbackRng(game, player, f));
    if (player.tech[f] > before) {
      if (player.nextField === 'lowest') player.researching = lowestField(player) ?? player.researching;
      else if (player.nextField !== 'same') { player.researching = player.nextField; player.nextField = 'same'; }
      if (player.tech[player.researching] >= MAX_TECH) player.researching = lowestField(player) ?? player.researching;
    }
    if (rs.researchSplash > 0) {
      const splash = Math.trunc(pool * rs.researchSplash + 0.5); // 0.3.8: 15 % of the whole budget, as in Stars! (125 % in all)
      for (const o of FIELDS) if (o !== f && player.tech[o] < MAX_TECH) addAndRoll(game, player, o, splash, events, rng ?? fallbackRng(game, player, o));
    }
    player.researchLastYear = toSpend;
    return events;
  }
  let left = toSpend;
  let guard = 0;
  while (left > 0 && guard++ < 50) {
    if (player.tech[player.researching] >= MAX_TECH) {
      const lf = lowestField(player);
      if (!lf) break;
      player.researching = lf;
    }
    const before = player.tech[player.researching];
    left = spendOnce(game, player, player.researching, left, events);
    if (player.tech[player.researching] > before) {
      // choose next field
      if (player.nextField === 'lowest') player.researching = lowestField(player) ?? player.researching;
      else if (player.nextField !== 'same') { player.researching = player.nextField; player.nextField = 'same'; }
      if (player.tech[player.researching] >= MAX_TECH) player.researching = lowestField(player) ?? player.researching;
    }
  }
  if (rs.researchSplash > 0) {
    const splash = Math.trunc(pool * rs.researchSplash + 0.5); // 0.3.8: 15 % of the whole budget, as in Stars! (125 % in all)
    for (const f of FIELDS) if (f !== player.researching && player.tech[f] < MAX_TECH) {
      let l = splash, g = 0;
      while (l > 0 && g++ < 10 && player.tech[f] < MAX_TECH) l = spendOnce(game, player, f, l, events);
    }
  }
  player.researchLastYear = toSpend;
  return events;
}

/** Add research points directly to a field (artifacts, Mystery Trader, stealing). */
export function addResearch(game: GameState, player: Player, field: Field, amount: number, rng?: Rng): ResearchEvent[] {
  const events: ResearchEvent[] = [];
  if (luckOn(game)) { addAndRoll(game, player, field, amount, events, rng ?? fallbackRng(game, player, field)); return events; }
  let l = amount, g = 0;
  while (l > 0 && g++ < 20 && player.tech[field] < MAX_TECH) l = spendOnce(game, player, field, l, events);
  return events;
}

/** Items unlocked when a field reaches `level` (other requirements already met or not). */
export function benefitsAt(player: Player, field: Field, level: number): string[] {
  const key = FIELD_KEYS[field];
  const res: string[] = [];
  for (const t of [...TECH_DATA, ...HULL_DATA]) {
    if ((t.req[key] as number) !== level) continue;
    if (!canLearn(player.race, t.req)) continue;
    if (t.req.acquirable) continue;
    res.push(t.name);
  }
  return res;
}

/** Items that the next few levels of a field would make available (all other fields at current level). */
export function expectedBenefits(player: Player, field: Field, levels = 3): { name: string; level: number; ready: boolean }[] {
  const res: { name: string; level: number; ready: boolean }[] = [];
  const key = FIELD_KEYS[field];
  for (let l = player.tech[field] + 1; l <= Math.min(MAX_TECH, player.tech[field] + levels); l++) {
    for (const t of [...TECH_DATA, ...HULL_DATA]) {
      if ((t.req[key] as number) !== l || t.req.acquirable || !canLearn(player.race, t.req)) continue;
      const ready = FIELDS.every(f => f === field || player.tech[f] >= (t.req[FIELD_KEYS[f]] as number));
      res.push({ name: t.name, level: l, ready });
    }
  }
  return res;
}

export function yearsToNextLevel(game: GameState, player: Player, field: Field, budget: number): number {
  const rs = raceSpec(player.race);
  const perYear = Math.trunc(budget * rs.researchFactor + 0.5);
  if (perYear <= 0) return Infinity;
  const need = researchCost(game, player, field) - player.researchSpent[field];
  return Math.max(1, Math.ceil(need / perYear));
}

export { FIELD_NAMES };

// ------------------------------------------------------------------ estimates and the hidden tech tree

export interface YearsEstimate { years: number; low: number; high: number; chanceThisYear: number }

/** Years before the next level of a field at `perYear` points a year: exact, or expected with a 10–90 % range. */
export type Pace = (year: number) => number;

/**
 * Research points expected in each coming year (1 = next year): the current pace, growing as fast as
 * the empire's resources grew over the last ten years (12 % a year when there is no history yet),
 * for 25 years at most.
 */
export function researchPace(player: Player, perYear: number): Pace {
  const sc = player.scores;
  let g = 0.12;
  if (sc.length >= 3) {
    const last = sc[sc.length - 1], first = sc[Math.max(0, sc.length - 11)];
    const n = last.year - first.year;
    if (n > 0 && first.resources > 0 && last.resources > 0) g = Math.pow(last.resources / first.resources, 1 / n) - 1;
  }
  g = Math.max(0, Math.min(0.2, g));
  return y => perYear * Math.pow(1 + g, Math.min(Math.max(0, y - 1), 25));
}

/** Years needed to gather `points` research points at this pace (Infinity if never). */
export function yearsFor(points: number, pace: Pace): number {
  if (points <= 0) return 1;
  let acc = 0;
  for (let y = 1; y <= 400; y++) { acc += pace(y); if (acc >= points) return y; }
  return Infinity;
}

export function estimateNextLevel(game: GameState, player: Player, field: Field, pace: Pace): YearsEstimate {
  if (player.tech[field] >= MAX_TECH) return { years: 0, low: 0, high: 0, chanceThisYear: 0 };
  const cost = researchCost(game, player, field);
  const spent = player.researchSpent[field];
  if (pace(1) <= 0) return { years: Infinity, low: Infinity, high: Infinity, chanceThisYear: luckOn(game) ? breakthroughChance((spent) / cost) : 0 };
  if (!luckOn(game)) {
    const y = yearsFor(cost - spent, pace);
    return { years: y, low: y, high: y, chanceThisYear: spent + pace(1) >= cost ? 1 : 0 };
  }
  let surv = 1, mean = 0, cum = 0, low = 0, high = 0, acc = 0;
  for (let y = 1; y <= 400 && surv > 1e-6; y++) {
    acc += pace(y);
    const q = breakthroughChance((spent + acc) / cost);
    const f = surv * q;
    mean += f * y; cum += f;
    if (!low && cum >= 0.1) low = y;
    if (!high && cum >= 0.9) high = y;
    surv -= f;
  }
  return { years: Math.max(1, Math.round(mean)), low: low || 1, high: high || low || 1, chanceThisYear: breakthroughChance((spent + pace(1)) / cost) };
}

/** Research points still needed to bring every field up to `target` (costs grow with each level gained). */
export function pointsToReach(game: GameState, player: Player, target: Partial<Record<Field, number>>): number {
  const sim: Player = { ...player, tech: { ...player.tech }, researchSpent: { ...player.researchSpent } };
  let total = 0;
  for (let guard = 0; guard < 200; guard++) {
    // cheapest missing level first (as the goal automation does)
    let best: Field | null = null;
    for (const f of FIELDS) if ((target[f] ?? 0) > sim.tech[f] && (!best || researchCost(game, sim, f) < researchCost(game, sim, best))) best = f;
    if (!best) break;
    total += Math.max(0, researchCost(game, sim, best) - sim.researchSpent[best]);
    sim.researchSpent[best] = 0;
    sim.tech[best] += 1;
  }
  return total;
}

/** Hidden per-game shift of the technology tree: up to two levels either way, order kept within a family. */
export const SHIFT_WEIGHTS: [number, number][] = [[-2, 0.1], [-1, 0.25], [0, 0.3], [1, 0.25], [2, 0.1]];

/** How many levels ahead scientists can foresee technologies (and megaprojects). */
export const TECH_HORIZON = 5;

export function makeTechShift(rng: Rng): Record<string, number> {
  const groups = new Map<string, { name: string; nominal: number; i: number }[]>();
  const items: { name: string; req: TechReq; family: string }[] = [
    ...TECH_DATA.filter(t => t.origin !== 'deception' && t.origin !== 'culture').map(t => ({ name: t.name, req: t.req, family: 'c:' + t.cat })),
    ...HULL_DATA.map(h => ({ name: h.name, req: h.req, family: 'h:' + h.type + (h.starbase ? ':sb' : '') })),
  ];
  items.forEach((t, i) => {
    if (t.req.acquirable) return;
    const f = mainField(t.req);
    if (!f) return;
    const key = `${t.family}|${f}`;
    const list = groups.get(key) ?? [];
    list.push({ name: t.name, nominal: t.req[FIELD_KEYS[f]] as number, i });
    groups.set(key, list);
  });
  const res: Record<string, number> = {};
  for (const list of groups.values()) {
    list.sort((a, b) => a.nominal - b.nominal || a.i - b.i);
    const drawn = list.map(t => {
      let x = rng.random(), d = 0;
      for (const [s, w] of SHIFT_WEIGHTS) { if (x < w) { d = s; break; } x -= w; }
      return Math.max(1, Math.min(26, t.nominal + d));
    }).sort((a, b) => a - b);
    // a better engine (or laser, or hull) never comes before the one it replaces
    list.forEach((t, k) => { const d = drawn[k] - t.nominal; if (d) res[t.name] = d; });
  }
  return res;
}

export interface TechOdds {
  field: Field;
  /** cumulative chance that the item is unlocked once the main field reaches each level */
  byLevel: { level: number; chance: number }[];
  /** level at which the chance passes one half */
  median: number;
  /** lowest and highest possible level of the main field */
  min: number;
  max: number;
  /** other fields still required (exact) */
  others: { field: Field; level: number }[];
}

/** What the player can infer about a technology not yet available (the per-game shift stays hidden). */
export function techOdds(game: GameState, player: Player, item: { name: string; req: TechReq }, upTo: number): TechOdds | null {
  const f = mainField(item.req);
  if (!f) return null;
  const nominal = item.req[FIELD_KEYS[f]] as number;
  const cur = player.tech[f];
  const others = FIELDS.filter(o => o !== f && (item.req[FIELD_KEYS[o]] as number) > player.tech[o]).map(o => ({ field: o, level: item.req[FIELD_KEYS[o]] as number }));
  const weights: [number, number][] = game.settings.fuzzyTechTree ? SHIFT_WEIGHTS : [[0, 1]];
  // if nothing else is missing, the item not being available tells us its level is above the current one
  let dist = weights.map(([d, w]) => ({ level: Math.max(1, Math.min(26, nominal + d)), p: w }));
  if (!others.length) dist = dist.filter(x => x.level > cur);
  const tot = dist.reduce((a, x) => a + x.p, 0);
  if (tot <= 0) return { field: f, byLevel: [], median: cur, others, min: cur, max: cur };
  dist = dist.map(x => ({ ...x, p: x.p / tot }));
  const byLevel: { level: number; chance: number }[] = [];
  for (let L = cur + 1; L <= upTo; L++) byLevel.push({ level: L, chance: dist.filter(x => x.level <= L).reduce((a, x) => a + x.p, 0) });
  let acc = 0, median = cur;
  for (const x of [...dist].sort((a, b) => a.level - b.level)) { acc += x.p; median = x.level; if (acc >= 0.5) break; }
  const levels = dist.map(x => x.level);
  return { field: f, byLevel, median: Math.max(median, cur), others, min: Math.min(...levels), max: Math.max(...levels) };
}

/** Lowest level of the main field at which the item might appear (for the research horizon). */
export function earliestLevel(game: GameState, item: { req: TechReq }): number {
  const f = mainField(item.req);
  if (!f) return 0;
  const nominal = item.req[FIELD_KEYS[f]] as number;
  return game.settings.fuzzyTechTree ? Math.max(1, nominal - 2) : nominal;
}

export { effReq };

/** Levels the player should aim for to get the item: the most likely level of its field, plus the other prerequisites. */
export function goalTarget(game: GameState, player: Player, item: { name: string; req: TechReq; exact?: boolean }, horizon = 5): Partial<Record<Field, number>> | null {
  // technologies without a component and megaprojects: fixed, known levels
  if (item.exact) {
    const t: Partial<Record<Field, number>> = {};
    for (const f of FIELDS) { const l = item.req[FIELD_KEYS[f]] as number; if (l > player.tech[f]) t[f] = l; }
    return t;
  }
  const f = mainField(item.req);
  if (!f) return null;
  const o = techOdds(game, player, item, player.tech[f] + horizon);
  if (!o) return null;
  const target: Partial<Record<Field, number>> = { [o.field]: o.median };
  for (const x of o.others) target[x.field] = x.level;
  return target;
}

/** Progress toward the research goal (0..1), from the points still needed versus when it was set. */
export function goalProgress(game: GameState, player: Player, item: { name: string; req: TechReq; exact?: boolean }): number {
  const target = goalTarget(game, player, item);
  if (!target) return 0;
  const left = pointsToReach(game, player, target);
  const start = Math.max(player.researchGoalStart ?? left, left, 1);
  return Math.max(0, Math.min(0.99, 1 - left / start));
}
