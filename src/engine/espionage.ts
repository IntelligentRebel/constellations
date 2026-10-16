// Constellations 3.5: intelligence on the other empires. Every empire holds, on every other one it has met, an
// intelligence level (0-100) rebuilt each year from sources it can see: the other's worlds under its penetrating
// scanners or with its ships in orbit, the other's ships it identified, treaties, an alliance, embassies, a spy
// network, recent battles and worlds taken; allies share part of what they know. The level unlocks, step by step,
// estimates then exact figures (score, planets, resources, technology, navy), then the research in progress, the
// victory conditions met and the secret objectives: the dossier. Computers judge the strength of the others through
// the same lens, so an embassy also shows them what you are worth.
import type { Dossier, FactKey, GameState, Planet, Player } from './types';
import { FIELDS } from './types';
import { Rng, seedFromString } from './rng';
import { revealPlanet } from './scan';
import { capitalOf } from './empire';
import { countBits, shipClass, type ShipClass } from './score';
import { pairOf, statusOf, remember, diplomacyOn } from './diplomacy';
import { FIELD_NAMES } from './tech';

export const intelOn = (game: GameState) => !!game.settings.espionage;
const isEmp = (game: GameState, id: number) => !!game.players[id] && !game.players[id].monster;

/** The figures of the score table: estimated from `approx`, exact from `exact`. */
export const FACTS: { key: FactKey; label: string; approx: number; exact: number }[] = [
  { key: 'planets', label: 'Planètes', approx: 10, exact: 40 },
  { key: 'score', label: 'Score', approx: 20, exact: 60 },
  { key: 'techLevels', label: 'Niveaux de technologie', approx: 20, exact: 55 },
  { key: 'resources', label: 'Ressources', approx: 30, exact: 65 },
  { key: 'starbases', label: 'Stations', approx: 30, exact: 70 },
  { key: 'unarmed', label: 'Vaisseaux non armés', approx: 40, exact: 80 },
  { key: 'escort', label: 'Vaisseaux d\'escorte', approx: 40, exact: 80 },
  { key: 'capital', label: 'Vaisseaux capitaux', approx: 40, exact: 80 },
];
export const FACT = Object.fromEntries(FACTS.map(f => [f.key, f])) as Record<FactKey, typeof FACTS[number]>;
/** Beyond the figures. */
export const STEPS = { techs: 55, research: 65, victory: 75, objectives: 90 } as const;
/** Margin of error of an estimate at its first step. */
const ERR0 = 0.3;

/** Spy networks: cost of a unit, strength it adds, yearly decay, ceiling, most it counts for. */
export const SPY_UNIT = 150, SPY_GAIN = 8, SPY_DECAY = 0.2, SPY_MAX = 60, SPY_CAP = 45;
export const EMBASSY = 25;
export const TREATY = { trade: 10, research: 10, alliance: 20 } as const;
const SHARE = 0.5, SHARE_CAP = 20;
/** Fresh knowledge: per battle (at most per year), per world taken, the archives of an agency; kept from year to year. */
const BATTLE = 6, BATTLE_CAP = 15, WORLD = 15, ARCHIVES = 40, FRESH_KEEP = 0.6, FRESH_MAX = 50;
export const AGENCY_COST = { ironium: 30, boranium: 0, germanium: 60, resources: 400 };
export const AGENCY_REQ = { electronics: 5 } as const;

export function dossierOf(p: Player, target: number): Dossier {
  const all = p.intel.dossiers ??= {};
  return all[target] ??= { level: 0, lines: [], facts: {} };
}
/** Intelligence level of `of` on `about` (as of the end of last year). */
export const levelOf = (game: GameState, of: number, about: number): number => intelOn(game) ? game.players[of]?.intel.dossiers?.[about]?.level ?? 0 : 0;
export const agencyOf = (game: GameState, pid: number): Planet | undefined => game.planets.find(pl => pl.owner === pid && pl.agency);
const bornSpies = (p: Player) => p.race.prt === 'SS';

/** Strength one unit adds to a network (an agency and the Super Stealth trait make it go further). */
export function spyGain(game: GameState, p: Player): number {
  return Math.round(SPY_GAIN * (agencyOf(game, p.id) ? 1.5 : 1) * (bornSpies(p) ? 1.5 : 1));
}
/** Yearly chance that a network is uncovered. */
export function detectChance(game: GameState, spy: Player, target: number, network: number): number {
  if (network <= 0) return 0;
  return Math.min(0.5, (0.03 + network / 600) * (agencyOf(game, target) ? 2 : 1) * (bornSpies(spy) ? 0.5 : 1));
}

export function spyBlocker(game: GameState, p: Player, target?: number): string | null {
  if (!intelOn(game)) return 'règle Renseignement désactivée';
  const t = target !== undefined ? game.players[target] : undefined;
  if (!t || t.monster || t.id === p.id) return 'empire inconnu';
  if (!p.intel.met.includes(t.id)) return 'empire jamais rencontré';
  if (t.dead) return 'empire anéanti';
  if ((p.intel.dossiers?.[t.id]?.network ?? 0) >= SPY_MAX) return `réseau à son maximum (${SPY_MAX})`;
  return null;
}

/** Spies bought by the production of `planet`. */
export function placeSpies(game: GameState, p: Player, target: number, units: number, planet?: Planet) {
  if (spyBlocker(game, p, target) || units <= 0) return;
  const d = dossierOf(p, target);
  const before = Math.round(d.network ?? 0);
  d.network = Math.min(SPY_MAX, (d.network ?? 0) + units * spyGain(game, p));
  const t = game.players[target];
  p.messages.push({ year: game.year, kind: 'production', text: `${planet ? `${planet.name} a financé` : 'Vous avez financé'} ${units} unité${units > 1 ? 's' : ''} d'espions chez les ${t.name} : réseau ${before} → ${Math.round(d.network)}.`, target: { kind: 'player', id: target } });
}

export function agencyBlocker(game: GameState, planet: Planet): string | null {
  if (!intelOn(game)) return 'règle Renseignement désactivée';
  const p = game.players[planet.owner];
  if (!p) return 'aucun propriétaire';
  if (p.tech.electronics < AGENCY_REQ.electronics) return `il faut ${FIELD_NAMES.electronics} ${AGENCY_REQ.electronics}`;
  const here = agencyOf(game, p.id);
  if (here) return here.id === planet.id ? 'déjà construite' : `une seule par empire (sur ${here.name})`;
  const queued = game.planets.find(pl => pl.owner === p.id && pl.id !== planet.id && pl.queue.some(q => q.kind === 'agency'));
  if (queued) return `déjà en construction sur ${queued.name}`;
  return null;
}

export function buildAgency(game: GameState, planet: Planet) {
  if (agencyBlocker(game, planet)) return;
  planet.agency = true;
  game.players[planet.owner].messages.push({ year: game.year, kind: 'production', text: `L'Agence de renseignement est ouverte sur ${planet.name} : vos réseaux d'espions se renforcent moitié plus vite, et les réseaux des autres empires chez vous sont démasqués deux fois plus souvent.`, target: { kind: 'planet', id: planet.id } });
}

/** A world changes hands: what was found there (the archives of an agency are a windfall). */
export function seizeArchives(game: GameState, winner: number, loser: number, planet: Planet) {
  if (!intelOn(game) || !isEmp(game, winner) || !isEmp(game, loser)) return;
  const w = game.players[winner];
  const d = dossierOf(w, loser);
  const gain = planet.agency ? ARCHIVES : WORLD;
  d.fresh = Math.min(FRESH_MAX, (d.fresh ?? 0) + gain);
  if (planet.agency) {
    w.messages.push({ year: game.year, kind: 'event', text: `Les archives de l'Agence de renseignement des ${game.players[loser].name} sont tombées entre vos mains sur ${planet.name}.`, target: { kind: 'player', id: loser } });
    game.players[loser].messages.push({ year: game.year, kind: 'warning', text: `Votre Agence de renseignement est perdue avec ${planet.name}, et ses archives avec elle.`, target: { kind: 'planet', id: planet.id } });
  }
  planet.agency = undefined;
}

/**
 * Ships of an empire a player sees right now in its scanners, by class of the score (composition as identified);
 * contacts whose size is only estimated (decoys and uncertainty) are counted apart, as their estimated number.
 */
export function visibleShips(game: GameState, p: Player, pid: number): Record<ShipClass, number> & { unsure: number; fleets: number } {
  const r = { unarmed: 0, escort: 0, capital: 0, unsure: 0, fleets: 0 };
  for (const fi of p.intel.fleets) {
    if (fi.owner !== pid) continue;
    r.fleets++;
    if (fi.tokens && !fi.uncertain) for (const t of fi.tokens) r[shipClass(game, t.designId)] += t.qty;
    else r.unsure += fi.count ?? 0;
  }
  return r;
}

/** How far apart two figures are (small numbers smoothed: 0 against 2 ships is not a gigantic gap). */
export type Gap = 'equal' | 'tiny' | 'small' | 'medium' | 'large' | 'huge';
export const GAP_WORDS: Record<Exclude<Gap, 'equal'>, string> = { tiny: 'de très peu', small: 'de peu', medium: 'd\'un écart moyen', large: 'de beaucoup', huge: 'd\'un écart gigantesque' };
export function gapOf(a: number, b: number): Gap {
  if (Math.round(a) === Math.round(b)) return 'equal';
  const r = (Math.max(a, b) + 2) / (Math.min(a, b) + 2);
  return r < 1.05 ? 'tiny' : r < 1.15 ? 'small' : r < 1.4 ? 'medium' : r < 2.5 ? 'large' : 'huge';
}

/** How a computer (or anyone) perceives the strength of another: the less it knows, the wider the error (±35 %). */
export function perception(game: GameState, of: number, about: number): { factor: number; err: number } {
  if (!intelOn(game) || of === about || !isEmp(game, of) || !isEmp(game, about)) return { factor: 1, err: 0 };
  const err = Math.max(0, 0.35 * (80 - levelOf(game, of, about)) / 80);
  return { factor: 1 + err * (2 * noise(game.settings.seed, of, about, game.year, 'power') - 1), err };
}

// ---------------------------------------------------------------------------------------------------- the year

interface Ctx { owned: Map<number, Planet[]>; ships: Map<number, number> }

/** The sources of a level, before what allies share. */
function sources(game: GameState, o: Player, t: Player, d: Dossier, ctx: Ctx): Dossier['lines'] {
  const lines: Dossier['lines'] = [];
  const add = (key: string, label: string, value: number) => { value = Math.round(value); if (value > 0) lines.push({ key, label, value }); };
  const theirs = ctx.owned.get(t.id) ?? [];
  const seen = theirs.filter(pl => { const pi = o.intel.planets[pl.id]; return pi.year === game.year && pi.owner === t.id; });
  if (theirs.length && seen.length) add('worlds', `Mondes sous vos scanners pénétrants ou vos vaisseaux en orbite : ${seen.length}`, 35 * Math.sqrt(seen.length / theirs.length));
  const cap = capitalOf(game, t);
  if (cap && seen.includes(cap)) add('capital', `Capitale observée (${cap.name})`, 5);
  let id = 0;
  for (const fi of o.intel.fleets) if (fi.owner === t.id && fi.detail === 'full' && fi.identYear === undefined && !fi.uncertain) id += fi.tokens?.reduce((a, x) => a + x.qty, 0) ?? 0;
  const total = ctx.ships.get(t.id) ?? 0;
  if (id > 0 && total > 0) add('fleets', `Vaisseaux identifiés : ${id}`, 10 * Math.sqrt(Math.min(1, id / total)));
  const pr = pairOf(game, o.id, t.id);
  if (pr && pr.status !== 'war') {
    if (pr.embassy !== undefined) add('embassy', 'Ambassade', EMBASSY);
    if (pr.status === 'alliance') add('alliance', 'Alliance', TREATY.alliance);
    if (pr.trade !== undefined) add('trade', 'Accord commercial', TREATY.trade);
    if (pr.research !== undefined) add('research', 'Coopération scientifique', TREATY.research);
  }
  if ((d.network ?? 0) >= 1) add('network', `Réseau d'espions (force ${Math.round(d.network!)})`, Math.min(SPY_CAP, d.network!));
  if ((d.fresh ?? 0) >= 1) add('fresh', 'Combats et conquêtes récents', d.fresh!);
  if (bornSpies(o)) add('race', 'Espions-nés (Furtivité)', 10);
  if (agencyOf(game, o.id)) add('agency', 'Analystes de votre Agence', 5);
  return lines;
}

const sum = (lines: Dossier['lines']) => lines.reduce((a, l) => a + l.value, 0);

/** Rounds an estimate to two significant digits. */
function blur(v: number, err: number): number {
  if (err <= 0 || Math.abs(v) < 20) return Math.round(v);
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / step) * step;
}

/** The steps announced when first reached: estimates (`est`), then figures and secrets (`full`). */
const ANNOUNCE: { at: number; est?: string[]; full?: string }[] = [
  { at: 10, est: ['de leur nombre de planètes'] },
  { at: 20, est: ['de leur score', 'de leur technologie'] },
  { at: 30, est: ['de leurs ressources', 'de leurs stations'] },
  { at: 40, est: ['de leur flotte'] },
  { at: 55, full: 'leurs niveaux de technologie, domaine par domaine' },
  { at: 60, full: 'leur score exact' },
  { at: 65, full: 'leurs recherches en cours' },
  { at: 75, full: 'les conditions de victoire qu\'ils remplissent' },
  { at: 80, full: 'la composition exacte de leur flotte' },
  { at: 90, full: 'leurs objectifs secrets' },
];
const list = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}` : xs[0] ?? '';
/** What a set of steps reveals, in words. */
function reveals(steps: typeof ANNOUNCE): string {
  const est = steps.flatMap(a => a.est ?? []);
  return list([...(est.length ? [`une estimation ${list(est)}`] : []), ...steps.flatMap(a => a.full ? [a.full] : [])]);
}

/**
 * End of the year (after the scores): networks uncovered, levels rebuilt, dossiers updated, then decay.
 * `refresh`: only rebuild the levels and dossiers (the rule switched on during a game), silently.
 */
export function updateDossiers(game: GameState, refresh = false) {
  if (!intelOn(game)) return;
  const emps = game.players.filter(p => !p.monster && !p.dead);
  const ctx: Ctx = { owned: new Map(), ships: new Map() };
  for (const pl of game.planets) if (pl.owner >= 0) { const l = ctx.owned.get(pl.owner); if (l) l.push(pl); else ctx.owned.set(pl.owner, [pl]); }
  for (const f of game.fleets) ctx.ships.set(f.owner, (ctx.ships.get(f.owner) ?? 0) + f.tokens.reduce((a, x) => a + x.qty, 0));
  const rng = new Rng(seedFromString(`${game.settings.seed}|spies|${game.year}`));
  // 1. networks uncovered
  if (!refresh) for (const o of emps) for (const t of emps) {
    if (o.id === t.id) continue;
    const d = o.intel.dossiers?.[t.id];
    if (!d || (d.network ?? 0) < 1) continue;
    if (t.dead) { d.network = 0; continue; }
    if (!rng.chance(detectChance(game, o, t.id, d.network!))) continue;
    const before = Math.round(d.network!);
    d.network = Math.round(d.network! * 0.4);
    if (diplomacyOn(game)) remember(game, t.id, o.id, 'spying', -12, 1);
    t.messages.push({ year: game.year, kind: 'diplomacy', text: `Votre contre-espionnage a démantelé un réseau d'espions des ${o.name}.${t.ai ? '' : ' Ils n\'en savent plus autant sur vous.'}`, target: { kind: 'player', id: o.id } });
    o.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${t.name} ont démasqué une partie de votre réseau d'espions chez eux (force ${before} → ${d.network}).${diplomacyOn(game) && t.ai ? ' Leur opinion de vous en pâtit.' : ''}`, target: { kind: 'player', id: t.id } });
  }
  // 2. fresh knowledge from this year's battles
  const fought = new Map<string, number>();
  if (!refresh) for (const b of game.battles) {
    const ids = [...new Set(b.players)].filter(id => isEmp(game, id));
    for (const x of ids) for (const y of ids) if (x !== y) fought.set(`${x}-${y}`, (fought.get(`${x}-${y}`) ?? 0) + BATTLE);
  }
  for (const [k, v] of fought) {
    const [x, y] = k.split('-').map(Number);
    const d = dossierOf(game.players[x], y);
    d.fresh = Math.min(FRESH_MAX, (d.fresh ?? 0) + Math.min(BATTLE_CAP, v));
  }
  // 3. embassies: diplomats sit in the capital
  if (diplomacyOn(game)) for (const o of emps) for (const t of emps) {
    if (o.id === t.id || pairOf(game, o.id, t.id)?.embassy === undefined || statusOf(game, o.id, t.id) === 'war') continue;
    const cap = capitalOf(game, t);
    if (!cap) continue;
    const pi = o.intel.planets[cap.id];
    if (pi.owner !== t.id && !o.ai) o.messages.push({ year: game.year, kind: 'scan', text: `Votre ambassade chez les ${t.name} est installée sur ${cap.name}, leur capitale.`, target: { kind: 'planet', id: cap.id } });
    pi.owner = t.id;
    revealPlanet(game, o, cap);
  }
  // 4. levels: own sources, then what allies share
  const base = new Map<string, Dossier['lines']>();
  for (const o of emps) for (const t of emps) {
    if (o.id === t.id || !o.intel.met.includes(t.id)) continue;
    base.set(`${o.id}-${t.id}`, sources(game, o, t, dossierOf(o, t.id), ctx));
  }
  for (const o of emps) for (const t of emps) {
    const lines = base.get(`${o.id}-${t.id}`);
    if (!lines) continue;
    let share = 0, by: Player | undefined;
    if (diplomacyOn(game)) for (const z of emps) {
      if (z.id === o.id || z.id === t.id || statusOf(game, o.id, z.id) !== 'alliance') continue;
      const zl = base.get(`${z.id}-${t.id}`);
      const v = zl ? Math.min(SHARE_CAP, Math.round(SHARE * Math.min(100, sum(zl)))) : 0;
      if (v > share) { share = v; by = z; }
    }
    if (share > 0 && by) lines.push({ key: 'shared', label: `Renseignements partagés par les ${by.name}`, value: share });
    const d = dossierOf(o, t.id);
    d.lines = lines;
    d.level = Math.max(0, Math.min(100, sum(lines)));
    if (!o.ai) learn(game, o, t, d, refresh);
  }
  if (refresh) return;
  // 5. decay
  for (const o of emps) for (const d of Object.values(o.intel.dossiers ?? {})) {
    if (d.network !== undefined) { d.network = d.network * (1 - SPY_DECAY); if (d.network < 1) d.network = undefined; }
    if (d.fresh !== undefined) { d.fresh = d.fresh * FRESH_KEEP; if (d.fresh < 1) d.fresh = undefined; }
  }
}

/** What the level reveals this year (figures already known stay, dated). */
function learn(game: GameState, o: Player, t: Player, d: Dossier, quiet = false) {
  const sc = t.scores[t.scores.length - 1];
  const level = d.level;
  if (sc) {
    for (const f of FACTS) {
      if (level < f.approx) continue;
      const err = level >= f.exact ? 0 : ERR0 * (f.exact - level) / (f.exact - f.approx);
      const v = blur(sc[f.key] * (1 + err * (2 * noise(game.settings.seed, o.id, t.id, game.year, f.key) - 1)), err);
      d.facts[f.key] = { v, err: Math.round(err * 100), year: game.year };
    }
    const s = d.facts.score;
    if (s && s.year === game.year) {
      const h = d.history ??= [];
      if (h[h.length - 1]?.year !== game.year) h.push({ year: game.year, v: s.v, err: s.err });
      if (h.length > 400) h.shift();
    }
  }
  if (level >= STEPS.techs) d.techs = { v: { ...t.tech }, year: game.year };
  if (level >= STEPS.research) d.research = { field: t.researching, year: game.year };
  if (level >= STEPS.victory) d.victory = { v: countBits(t.victoryMet), year: game.year };
  if (level >= STEPS.objectives && t.objectives?.length) d.objectives = { list: t.objectives.map(x => ({ ...x })), year: game.year };
  const best = d.best ?? 0;
  const fresh = ANNOUNCE.filter(a => a.at > best && a.at <= level);
  if (fresh.length && !quiet) o.messages.push({ year: game.year, kind: 'scan', text: `Renseignement sur les ${t.name} : ${level}/100. Vous connaissez désormais ${reveals(fresh)} (page Diplomatie).`, target: { kind: 'player', id: t.id } });
  d.best = Math.max(best, level);
}

/** The next steps a level has not reached yet. */
export function nextSteps(level: number): { at: number; what: string }[] {
  return ANNOUNCE.filter(a => a.at > level).map(a => ({ at: a.at, what: reveals([a]) }));
}

/** Field names (for the dossier). */
export const fieldName = (f: keyof typeof FIELD_NAMES) => FIELD_NAMES[f];
export { FIELDS };

/** Deterministic noise in [0, 1) for an observation (same answer for the whole year). */
function noise(seed: string, a: number, b: number, year: number, k: string): number {
  let h = 2166136261;
  const str = `${seed}|intel|${a}|${b}|${year}|${k}`;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
