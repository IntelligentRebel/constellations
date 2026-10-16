// Negotiated diplomacy (Constellations 3.4). Between two empires: war, peace or alliance, plus two treaties (trade:
// +4 % resources, research: +5 % research, per partner, three partners at most). Every computer empire holds an
// opinion of every other, built from visible reasons (borders, wars, betrayals, gifts, treaties, a common enemy...),
// and answers proposals for reasons the player can read before asking (0.3.7: with odds, not a certainty). Computers propose, demand, declare war and make
// peace among themselves and with the player. Fleets only fight empires they are at war with.
import { timesWord } from './words';
import type { DiploMemory, DiploPair, DiploStatus, DiplomacyState, GameState, Planet, Player, Proposal, ProposalKind, Relation } from './types';
import { MINERALS } from './types';
import { Rng, seedFromString } from './rng';
import { distance, fleetSpec } from './fleet';
import { navyStrength } from './crisis';
import { portalThreat } from './megaprojects';
import { capitalOf } from './empire';
import { meet, revealPlanet } from './scan';
import { specOf } from './design';
import { intelOn, perception, levelOf } from './espionage';
import { addChronicle } from './chronicle';
import { actOf } from './acts';
import { worldGrudge, warGrudge, isNemesis, swornAgainst } from './nemesis';
import { bordersGrievance, bordersWarPush, closedTo, bordersOn, setBorders, openForAllies, hindrance } from './borders';

export const diplomacyOn = (game: GameState) => !!game.settings.diplomacy && !!game.diplomacy;
const isEmp = (game: GameState, id: number) => !!game.players[id] && !game.players[id].monster;
const key = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`;
const D = (game: GameState) => game.diplomacy!;
const name = (game: GameState, id: number) => game.players[id]?.name ?? '?';
/** Treaties: bonus per partner, and partners counted at most. */
export const TRADE_BONUS = 0.04, RESEARCH_BONUS = 0.05, MAX_PARTNERS = 3;
/** Opinions needed. */
export const NEED = { embassy: -20, trade: 0, research: 15, alliance: 30 } as const;

export const STATUS_NAMES: Record<DiploStatus, string> = { war: 'Guerre', peace: 'Paix', alliance: 'Alliance' };
/** What an empire proposes to you ("Les X vous proposent ..."). */
export const KIND_NAMES: Record<ProposalKind, string> = { peace: 'la paix', trade: 'un accord commercial', research: 'une coopération scientifique', alliance: 'une alliance', tribute: 'un tribut', embassy: 'd\'ouvrir des ambassades entre vos deux empires', borders: 'd\'ouvrir vos frontières à leurs vaisseaux' };
/** 0.3.8: your own proposal, as the answer names it ("Les X refusent ..."), so that nobody reads a general refusal. */
export const OFFER_NAMES: Record<ProposalKind, string> = { peace: 'votre offre de paix', trade: 'votre proposition d\'accord commercial', research: 'votre proposition de coopération scientifique', alliance: 'votre proposition d\'alliance', tribute: 'votre demande de tribut', embassy: 'votre proposition d\'ouvrir des ambassades entre vos deux empires', borders: 'votre demande d\'ouvrir leurs frontières à vos vaisseaux' };

/** Temper of a computer empire, by its primary trait (0 peaceful, 1 warlike). */
const AGGRESSION: Record<string, number> = { WM: 0.9, SD: 0.7, SS: 0.6, IT: 0.5, PP: 0.5, JoaT: 0.5, AR: 0.4, HE: 0.35, IS: 0.3, CA: 0.3 };
export const aggression = (p: Player) => AGGRESSION[p.race.prt] ?? 0.5;
/** Year the computers start thinking of war (by difficulty), earlier for the warlike. */
const WAR_YEAR: Record<string, number> = { easy: 60, standard: 40, harder: 30, expert: 25 };

// ---------------------------------------------------------------------------------------------------- state

export function initDiplomacy(game: GameState) {
  if (!game.diplomacy) game.diplomacy = { pairs: {}, memory: [], proposals: [], bonus: {}, log: [] };
  // computers allied by the old option start allied
  if (game.settings.aiAlliances) for (const a of game.players) for (const b of game.players) {
    if (a.id < b.id && a.ai && b.ai && isEmp(game, a.id) && isEmp(game, b.id)) pairOf(game, a.id, b.id)!.status = 'alliance';
  }
  syncRelations(game);
}

/** Rule switched off: the relations stay as they were, editable by hand again. */
export function removeDiplomacy(game: GameState) { game.diplomacy = undefined; }

/** The state between two empires (peace until someone declares war). */
export function pairOf(game: GameState, a: number, b: number): DiploPair | undefined {
  if (!diplomacyOn(game) || a === b || !isEmp(game, a) || !isEmp(game, b)) return undefined;
  return D(game).pairs[key(a, b)] ??= { status: 'peace', since: game.year, wars: 0 };
}
export function statusOf(game: GameState, a: number, b: number): DiploStatus | null { return pairOf(game, a, b)?.status ?? null; }
/** With diplomacy, empires fight only when at war (monsters are always fair game). */
export function atWar(game: GameState, a: number, b: number): boolean {
  if (!diplomacyOn(game) || !isEmp(game, a) || !isEmp(game, b)) return true;
  return statusOf(game, a, b) === 'war';
}

/** The relations used by the rest of the engine follow the statuses: war = enemy, peace = neutral, alliance = friend. */
export function syncRelations(game: GameState) {
  if (!diplomacyOn(game)) return;
  for (const a of game.players) for (const b of game.players) {
    if (a.id >= b.id || !isEmp(game, a.id) || !isEmp(game, b.id)) continue;
    const st = statusOf(game, a.id, b.id)!;
    const r: Relation = st === 'war' ? 'enemy' : st === 'alliance' ? 'friend' : 'neutral';
    a.relations[b.id] = r; b.relations[a.id] = r;
  }
  refreshBonus(game);
}

function refreshBonus(game: GameState) {
  const bonus: DiplomacyState['bonus'] = {};
  for (const [k, pr] of Object.entries(D(game).pairs)) {
    const [a, b] = k.split('-').map(Number);
    if (game.players[a]?.dead || game.players[b]?.dead || pr.status === 'war') continue;
    for (const id of [a, b]) {
      const e = bonus[id] ??= { trade: 0, research: 0 };
      if (pr.trade !== undefined) e.trade += 1;
      if (pr.research !== undefined) e.research += 1;
    }
  }
  for (const e of Object.values(bonus)) { e.trade = Math.min(MAX_PARTNERS, e.trade) * TRADE_BONUS; e.research = Math.min(MAX_PARTNERS, e.research) * RESEARCH_BONUS; }
  D(game).bonus = bonus;
}
export const tradeBonus = (game: GameState, id: number) => game.diplomacy?.bonus?.[id]?.trade ?? 0;
export const researchBonus = (game: GameState, id: number) => game.diplomacy?.bonus?.[id]?.research ?? 0;

export function remember(game: GameState, by: number, about: number, kind: DiploMemory['kind'], value: number, decay: number) {
  if (!isEmp(game, by) || !isEmp(game, about) || by === about) return;
  D(game).memory.push({ by, about, kind, value, year: game.year, decay });
}
const memValue = (game: GameState, m: DiploMemory) => {
  const left = Math.abs(m.value) - m.decay * (game.year - m.year);
  return left > 0 ? Math.sign(m.value) * left : 0;
};
function log(game: GameState, a: number, b: number, text: string) {
  const l = D(game).log;
  l.push({ year: game.year, a, b, text });
  if (l.length > 300) l.splice(0, l.length - 300);
}
/** Talking makes acquaintance: both empires know each other from then on. */
function acquaint(game: GameState, a: number, b: number) {
  meet(game, game.players[a], b, { target: { kind: 'player', id: b }, how: 'par un message diplomatique' });
  meet(game, game.players[b], a, { target: { kind: 'player', id: a }, how: 'par un message diplomatique' });
}
function tell(game: GameState, to: number, text: string, about: number) {
  const p = game.players[to];
  if (p && !p.dead) p.messages.push({ year: game.year, kind: 'diplomacy', text, target: { kind: 'player', id: about } });
}

// ---------------------------------------------------------------------------------------------------- opinion

export interface OpinionLine { label: string; value: number }
const MEMORY_LABELS: Record<DiploMemory['kind'], string> = {
  war: 'Guerres passées', betrayal: 'Trahison', dishonor: 'Votre parole non tenue envers d\'autres empires', gift: 'Cadeaux', demand: 'Tributs exigés ou refusés par vous', broken: 'Accords rompus par vous',
  conquest: 'Leurs mondes conquis par vous', assimilation: 'Leurs mondes assimilés par votre culture', ally: 'Aide d\'un allié', refused: 'Leurs propositions refusées par vous',
  spying: 'Vos espions démasqués chez eux',
  choice: 'Vos décisions à leur égard',
};
const score = (p: Player) => p.scores[p.scores.length - 1]?.score ?? 0;
/** Military weight (proportional to the size of the navy). */
export const power = (game: GameState, id: number) => Math.sqrt(navyStrength(game, id));
/** Constellations 3.5: the military weight of `about` as `of` believes it (exact with good intelligence). */
export const perceivedPower = (game: GameState, of: number, about: number) => power(game, about) * perception(game, of, about).factor;
/** 0.3.7.1: the warships of `about` that `of` has in its scanners this year (strength, counted as navyStrength does). */
function seenNavy(game: GameState, of: number, about: number): number {
  let hp = 0, pow = 0;
  for (const fi of game.players[of]?.intel.fleets ?? []) {
    if (fi.owner !== about || !fi.tokens) continue;
    for (const t of fi.tokens) {
      const sp = specOf(game, t.designId);
      if (!sp.hasWeapons) continue;
      hp += (sp.armor + sp.shields) * t.qty; pow += sp.powerRating * t.qty;
    }
  }
  return hp * pow;
}
/**
 * 0.3.7.1: the navy of `about` as `of` can credit it when it is threatened: the warships in its scanners, and of the
 * rest only what its intelligence tells (half of the intelligence scale to believe it all; nothing at first contact).
 */
export function crediblePower(game: GameState, of: number, about: number): number {
  if (!intelOn(game)) return perceivedPower(game, of, about);
  const trust = Math.min(1, levelOf(game, of, about) / 50);
  return Math.max(Math.sqrt(seenNavy(game, of, about)), power(game, about) * trust) * perception(game, of, about).factor;
}
/**
 * 0.3.7.1: what defends an empire's worlds against a threat: its warships, and the station of the world that would be
 * attacked (its strongest armed one: a fleet threatens one world at a time).
 */
export function homeGuard(game: GameState, id: number): number {
  let hp = 0, pow = 0, best = { hp: 0, pow: 0 };
  for (const f of game.fleets) {
    if (f.owner !== id || !f.tokens.length) continue;
    const sp = fleetSpec(game, f);
    if (!sp.hasWeapons) continue;
    hp += sp.armor + sp.shields; pow += sp.powerRating;
  }
  for (const pl of game.planets) {
    if (pl.owner !== id || !pl.starbase) continue;
    const sp = specOf(game, pl.starbase.designId);
    if (sp.powerRating > 0 && (sp.armor + sp.shields) * sp.powerRating > best.hp * best.pow) best = { hp: sp.armor + sp.shields, pow: sp.powerRating };
  }
  return Math.sqrt((hp + best.hp) * (pow + best.pow));
}

/** " (estimée)" when the belief is uncertain. */
const guess = (game: GameState, of: number, about: number) => perception(game, of, about).err > 0.02 ? ' estimée' : '';

/** What `of` thinks of `about`, line by line (−100 to 100). */
export function opinion(game: GameState, of: number, about: number): { total: number; lines: OpinionLine[] } {
  const lines: OpinionLine[] = [];
  const a = game.players[of], b = game.players[about];
  const add = (label: string, value: number) => { value = Math.round(value); if (value) lines.push({ label, value }); };
  add('Tempérament', 10 - 30 * aggression(a));
  // borders
  const mine = game.planets.filter(pl => pl.owner === of), theirs = game.planets.filter(pl => pl.owner === about);
  let near = 0;
  for (const t of theirs) if (mine.some(m => distance(m, t) <= 120)) near++;
  add('Frontières communes', -Math.min(16, 2 * near));
  const pr = pairOf(game, of, about);
  if (pr) {
    if (pr.status === 'war') add('En guerre', -25);
    else {
      add('Paix durable', Math.min(10, Math.floor((game.year - pr.since) / 5)));
      if (pr.status === 'alliance') add('Alliance', 15);
    }
    if (pr.embassy !== undefined && pr.status !== 'war') add('Ambassades', 5);
    if (pr.trade !== undefined) add('Accord commercial', 8);
    if (pr.research !== undefined) add('Coopération scientifique', 8);
  }
  // a common enemy, the crisis
  const common = game.players.some(c => c.id !== of && c.id !== about && isEmp(game, c.id) && !c.dead && statusOf(game, of, c.id) === 'war' && statusOf(game, about, c.id) === 'war');
  if (common) add('Ennemi commun', 12);
  if (game.crisis?.phase === 'active') add('Les Moissonneurs', 15);
  if (score(b) > 1.5 * Math.max(1, score(a))) add('Votre puissance les inquiète', -10);
  const portal = game.settings.megaprojects ? portalThreat(game) : null;
  if (portal && portal.owner === about && portal.announced > 0) add('Vous construisez le Portail', -40);
  if (isNemesis(game, of, about)) add('Ils ont juré votre perte', -60);
  // 0.3.9.10: your borders closed to them, the more resented the more they hem them in
  add(hindrance(game, of, about) >= 0.25 ? 'Vos frontières fermées étouffent leur expansion' : 'Vos frontières leur sont fermées', bordersGrievance(game, of, about));
  // memories
  const byKind = new Map<DiploMemory['kind'], number>();
  for (const m of D(game).memory) if (m.by === of && m.about === about) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + memValue(game, m));
  for (const [k, v] of byKind) add(MEMORY_LABELS[k], k === 'gift' ? Math.min(30, v) : Math.max(-60, v));
  const total = Math.max(-100, Math.min(100, lines.reduce((s, l) => s + l.value, 0)));
  return { total, lines };
}

/** How tired of this war an empire is (0 fresh, 60 and more exhausted). */
export function exhaustion(game: GameState, of: number, other: number): number {
  const pr = pairOf(game, of, other);
  if (!pr || pr.status !== 'war') return 0;
  const years = game.year - pr.since;
  // 3.6: by the value of the ships lost when known (a hundred scouts against ten battleships), else by their number
  const byValue = pr.lossValue && (pr.lossValue[of] || pr.lossValue[other]);
  const lost = byValue ? pr.lossValue![of] ?? 0 : pr.losses?.[of] ?? 0, killed = byValue ? pr.lossValue![other] ?? 0 : pr.losses?.[other] ?? 0;
  const ratio = (lost + (byValue ? 200 : 2)) / (killed + (byValue ? 200 : 2));
  let e = Math.min(30, 2 * years);
  if (ratio > 3) e += 20; else if (ratio > 1.5) e += 10; else if (ratio < 0.67) e -= 10;
  e += 6 * (pr.planets?.[of] ?? 0) - 4 * (pr.planets?.[other] ?? 0);
  return e;
}

// ---------------------------------------------------------------------------------------------------- answers

/**
 * What a computer empire thinks of a proposal. `ok`: the likelier answer; `chance`: the odds it accepts (kept secret:
 * the player only reads « probablement », « peut-être »...); `sure`: a firm rule, no odds (a war just begun...).
 */
export interface Answer { ok: boolean; why: string; score: number; chance?: number; sure?: boolean }

/** 0.3.7: a computer's answer is not certain: the odds grow with the margin (half at 0, four in five at +10). */
export const acceptChance = (score: number) => 1 / (1 + Math.exp(-score / 7));
/** How the odds are told (never as a number). */
export function likelihood(chance: number): string {
  return chance >= 0.9 ? 'accepterait très probablement' : chance >= 0.65 ? 'accepterait probablement' : chance >= 0.35 ? 'accepterait peut-être' : chance >= 0.1 ? 'refuserait probablement' : 'refuserait très probablement';
}
/** A firm answer (a rule, not a mood). */
const firm = (why: string, score = -100): Answer => ({ ok: false, why, score, chance: 0, sure: true });
/** An answer with odds, from a margin, and the reasons shown in brackets. */
const weighed = (sc: number, reasons: string): Answer => { const chance = acceptChance(sc); return { ok: chance >= 0.5, why: `${likelihood(chance)} (${reasons})`, score: sc, chance }; };

/**
 * The answer actually given: the odds of `evaluate`, drawn once a year for the same two empires and kind of proposal
 * (asking again the same year gets the same answer, unless the offer is better). Firm rules are firm.
 */
export function decideAnswer(game: GameState, ai: number, from: number, kind: ProposalKind, ans: Answer): boolean {
  if (ans.sure || ans.chance === undefined) return ans.ok;
  const u = new Rng(seedFromString(`${game.settings.seed}|answer|${ai}|${from}|${kind}|${game.year}`)).random();
  return u < ans.chance;
}

/** 0.3.7: one tribute every three years from the same empire. */
export const TRIBUTE_YEARS = 3;
export function tributeWait(game: GameState, from: number, to: number): number {
  const last = pairOf(game, from, to)?.tribute?.[from];
  return last === undefined ? 0 : Math.max(0, last + TRIBUTE_YEARS - game.year);
}
function markTribute(game: GameState, from: number, to: number) {
  const pr = pairOf(game, from, to);
  if (pr) (pr.tribute ??= {})[from] = game.year;
}

/**
 * What a computer empire would answer, with its reasons. `minerals` change hands with the proposal; `payer` is who
 * pays them.
 */
export function evaluate(game: GameState, ai: number, from: number, kind: ProposalKind, minerals = 0, payer?: number): Answer {
  const st = statusOf(game, ai, from);
  if (!st) return firm('pas de diplomatie');
  const op = opinion(game, ai, from).total;
  const sweet = minerals > 0 ? (payer === from ? minerals / 40 : -minerals / 40) : 0;
  const fmtOp = `opinion ${op > 0 ? '+' : ''}${op}`;
  switch (kind) {
    case 'peace': {
      if (st !== 'war') return firm('vous n\'êtes pas en guerre', 0);
      const portal = game.settings.megaprojects ? portalThreat(game) : null;
      if (portal && portal.owner === from && portal.announced > 0) return firm('pas de paix avec qui construit le Portail');
      if (isNemesis(game, ai, from)) return firm('ils ont juré votre perte : pas de paix tant que leur empire n\'est pas brisé');
      const pr = pairOf(game, ai, from)!;
      if (game.year - pr.since < 3 && game.crisis?.phase !== 'active') return firm('la guerre vient de commencer (pas de paix avant 3 ans de guerre)', -50);
      const ex = exhaustion(game, ai, from);
      const ratio = Math.max(0.1, crediblePower(game, ai, from)) / Math.max(0.1, power(game, ai));
      const strength = 25 * Math.max(-1.5, Math.min(1.5, Math.log2(ratio)));
      const crisis = game.crisis?.phase === 'active' ? 40 : 0;
      const sc = Math.round(op + 20 + ex + strength + crisis + sweet);
      const parts = [fmtOp, `lassitude +${ex}`, strength >= 0 ? `votre force${guess(game, ai, from)} +${Math.round(strength)}` : `leur force ${Math.round(strength)}`];
      if (crisis) parts.push('les Moissonneurs +40');
      if (sweet) parts.push(`minerais ${sweet > 0 ? '+' : ''}${Math.round(sweet)}`);
      return weighed(sc, parts.join(', '));
    }
    case 'embassy': {
      if (st === 'war') return firm('en guerre');
      if (pairOf(game, ai, from)!.embassy !== undefined) return firm('ambassades déjà ouvertes', 0);
      const sc = Math.round(op + sweet - NEED.embassy);
      return weighed(sc, `${fmtOp}, il faudrait une opinion d'au moins ${NEED.embassy}${sweet ? `, minerais +${Math.round(sweet)}` : ''}`);
    }
    case 'trade': case 'research': {
      if (st === 'war') return firm('en guerre');
      const pr = pairOf(game, ai, from)!;
      if (pr[kind] !== undefined) return firm('déjà signé', 0);
      const sc = Math.round(op + sweet - NEED[kind]);
      return weighed(sc, `${fmtOp}, il faudrait une opinion d'au moins ${NEED[kind]}${sweet ? `, minerais +${Math.round(sweet)}` : ''}`);
    }
    case 'alliance': {
      if (st === 'war') return firm('en guerre');
      if (st === 'alliance') return firm('déjà alliés', 0);
      const common = game.players.some(c => c.id !== ai && c.id !== from && isEmp(game, c.id) && !c.dead && statusOf(game, ai, c.id) === 'war' && statusOf(game, from, c.id) === 'war');
      const need = common || game.crisis?.phase === 'active' ? NEED.alliance : NEED.alliance + 20;
      const sc = Math.round(op + sweet - need);
      return weighed(sc, `${fmtOp}, il faudrait une opinion d'au moins ${need}${common ? ', ennemi commun' : ''}`);
    }
    case 'borders': {
      // 0.3.9.10: `from` asks `ai` to open its borders to it; the peaceful open them more readily
      if (st === 'war') return firm('en guerre');
      if (!closedTo(game, ai, from)) return firm('leurs frontières vous sont déjà ouvertes', 0);
      const need = Math.round(30 * aggression(game.players[ai]) - 15);
      const sc = Math.round(op + sweet - need);
      return weighed(sc, `${fmtOp}, il faudrait une opinion d'au moins ${need}${sweet ? `, minerais +${Math.round(sweet)}` : ''}`);
    }
    case 'tribute': {
      // `from` demands `minerals` from `ai`: fear against pride, hatred and greed. 0.3.7.1: the fear is of what they
      // know of your navy (the warships in their scanners, and what their intelligence tells), against what defends
      // their worlds (warships and stations); at first contact they know nothing and fear nothing.
      const have = richest(game, ai)?.total ?? 0;
      if (minerals > have) return firm(`ils n'ont pas ${minerals} kt en réserve`);
      const known = intelOn(game) ? Math.max(levelOf(game, ai, from), seenNavy(game, ai, from) > 0 ? 10 : 0) : 100;
      if (known < 10) return firm('ils ne savent presque rien de votre flotte : aucune raison de vous craindre');
      const ratio = Math.max(0.05, crediblePower(game, ai, from)) / Math.max(1, homeGuard(game, ai));
      const cap = Math.max(200, have * 0.3);
      const fear = Math.min(40, 30 * Math.log2(ratio / 2)), hate = op < -40 ? op + 40 : 0, greed = -8 * Math.min(1, minerals / cap) - 25 * Math.max(0, minerals / cap - 1);
      const sc = Math.round(fear + hate + greed + 5);
      const reasons = [`à leurs yeux, votre flotte pèse ${timesWord(ratio)} ce qui défend leurs mondes${ratio < 2 ? ' : il faudrait qu\'elle pèse au moins deux fois ce qui les défend' : ''}`];
      if (intelOn(game) && levelOf(game, ai, from) < 50) reasons.push('ils connaissent mal votre flotte');
      if (hate) reasons.push(`ils vous haïssent (${fmtOp})`);
      if (minerals > cap) reasons.push('c\'est beaucoup demander (plus de 30 % de leur réserve)');
      const chance = acceptChance(sc);
      const verb = chance >= 0.9 ? 'paierait très probablement' : chance >= 0.65 ? 'paierait probablement' : chance >= 0.35 ? 'paierait peut-être' : chance >= 0.1 ? 'refuserait probablement de payer' : 'refuserait très probablement de payer';
      return { ok: chance >= 0.5, why: `${verb} (${reasons.join(', ')})`, score: sc, chance };
    }
  }
}

// ---------------------------------------------------------------------------------------------------- acts

/** The world with the most minerals on the surface. */
function richest(game: GameState, id: number): { pl: Planet; total: number } | undefined {
  let best: { pl: Planet; total: number } | undefined;
  for (const pl of game.planets) {
    if (pl.owner !== id) continue;
    const t = pl.surface.ironium + pl.surface.boranium + pl.surface.germanium;
    if (!best || t > best.total) best = { pl, total: t };
  }
  return best;
}

/** 0.3.7: what a transfer of minerals moved, mineral by mineral, from which world to which. */
export interface Transfer { moved: number; parts: Record<'ironium' | 'boranium' | 'germanium', number>; from?: Planet; to?: Planet }
let lastTransfer: Transfer = { moved: 0, parts: { ironium: 0, boranium: 0, germanium: 0 } };

/** Moves minerals from the giver's richest world to the receiver's capital; returns what was moved. */
export function transferMinerals(game: GameState, from: number, to: number, kt: number): number {
  const src = richest(game, from);
  const dst = capitalOf(game, game.players[to]) ?? game.planets.filter(pl => pl.owner === to).sort((a, b) => b.pop - a.pop)[0];
  lastTransfer = { moved: 0, parts: { ironium: 0, boranium: 0, germanium: 0 }, from: src?.pl, to: dst };
  if (!src || !dst || kt <= 0) return 0;
  const give = Math.min(kt, src.total);
  let moved = 0;
  for (const m of MINERALS) {
    const part = Math.min(src.pl.surface[m], Math.round(give * src.pl.surface[m] / Math.max(1, src.total)));
    src.pl.surface[m] -= part; dst.surface[m] += part; moved += part;
    lastTransfer.parts[m] = part;
  }
  lastTransfer.moved = moved;
  return moved;
}
const kt = (n: number) => Math.round(n).toLocaleString('fr-FR');
/** "1 200 kt (ironium 500, boranium 400, germanium 300)" */
const detail = (t: Transfer) => `${kt(t.moved)} kt (ironium ${kt(t.parts.ironium)}, boranium ${kt(t.parts.boranium)}, germanium ${kt(t.parts.germanium)})`;
/** The receiver is told what arrived and where; the giver what left and from where. */
function tellTransfer(game: GameState, t: Transfer, giver: number, receiver: number, toReceiver: string, toGiver: string) {
  if (t.moved <= 0) return;
  const r = game.players[receiver], g = game.players[giver];
  if (r && !r.dead) r.messages.push({ year: game.year, kind: 'diplomacy', text: `${toReceiver} ${detail(t)}, déposés à la surface de ${t.to?.name ?? '?'}.`, target: t.to ? { kind: 'planet', id: t.to.id } : { kind: 'player', id: giver } });
  if (g && !g.dead) g.messages.push({ year: game.year, kind: 'diplomacy', text: `${toGiver} ${detail(t)}, pris sur ${t.from?.name ?? '?'}.`, target: t.from ? { kind: 'planet', id: t.from.id } : { kind: 'player', id: receiver } });
}

/** Declares war. Breaking a treaty is a betrayal everybody hears of; the victim's allies come to its help. */
export function declareWar(game: GameState, a: number, b: number, why?: string) {
  const pr = pairOf(game, a, b);
  if (!pr || pr.status === 'war') return;
  const treaty = pr.status === 'alliance' || pr.trade !== undefined || pr.research !== undefined;
  acquaint(game, a, b);
  const embassy = pr.embassy !== undefined;
  pr.status = 'war'; pr.since = game.year; pr.wars++; pr.losses = {}; pr.lossValue = {}; pr.planets = {}; pr.trade = undefined; pr.research = undefined; pr.embassy = undefined;
  D(game).proposals = D(game).proposals.filter(x => !((x.from === a && x.to === b) || (x.from === b && x.to === a)));
  if (treaty) {
    remember(game, b, a, 'betrayal', -35, 1);
    for (const o of game.players) if (o.id !== a && o.id !== b && isEmp(game, o.id) && o.intel.met.includes(a)) remember(game, o.id, a, 'dishonor', -10, 1);
  } else remember(game, b, a, 'war', -20, 0.5);
  remember(game, a, b, 'war', -10, 0.5);
  log(game, a, b, `Les ${name(game, a)} déclarent la guerre aux ${name(game, b)}${why ? ` (${why})` : ''}${treaty ? ', au mépris de leurs accords' : ''}.`);
  addChronicle(game, 'war', treaty ? `Les ${name(game, a)} déclarent la guerre aux ${name(game, b)}, au mépris de leurs accords.` : `Les ${name(game, a)} déclarent la guerre aux ${name(game, b)}.`, [a, b]);
  warGrudge(game, a, b);
  tell(game, b, `Les ${name(game, a)} vous déclarent la guerre${why ? ` (${why})` : ''}${treaty ? ', au mépris de vos accords' : ''}.`, a);
  tell(game, a, `Vous êtes désormais en guerre contre les ${name(game, b)}.${treaty ? ' Rompre vos accords vous vaut une réputation de traître.' : ''}${embassy ? ' Les ambassades entre vos deux empires sont fermées.' : ''}`, b);
  if (embassy) tell(game, b, `Les ambassades entre vous et les ${name(game, a)} sont fermées.`, a);
  for (const o of game.players) if (o.id !== a && o.id !== b && isEmp(game, o.id) && (o.intel.met.includes(a) || o.intel.met.includes(b))) tell(game, o.id, `Les ${name(game, a)} ont déclaré la guerre aux ${name(game, b)}.`, a);
  syncRelations(game);
  // the victim's allies
  for (const c of game.players) {
    if (c.id === a || c.id === b || !isEmp(game, c.id) || c.dead || statusOf(game, b, c.id) !== 'alliance') continue;
    if (c.ai) { if (statusOf(game, c.id, a) !== 'war') { declareWar(game, c.id, a, `pour défendre leurs alliés, les ${name(game, b)}`); remember(game, b, c.id, 'ally', 15, 0.5); } }
    else tell(game, c.id, `Vos alliés les ${name(game, b)} sont attaqués par les ${name(game, a)}. Rien ne vous oblige à entrer en guerre, mais vos alliés s'en souviendront.`, a);
  }
}

export function makePeace(game: GameState, a: number, b: number, minerals = 0, payer?: number) {
  const pr = pairOf(game, a, b);
  if (!pr || pr.status !== 'war') return;
  pr.status = 'peace'; pr.since = game.year;
  let paid = 0;
  if (minerals > 0 && payer !== undefined) paid = transferMinerals(game, payer, payer === a ? b : a, minerals);
  const t = lastTransfer;
  const terms = paid ? ` ; les ${name(game, payer!)} versent ${paid} kt de minerais` : '';
  log(game, a, b, `Paix entre les ${name(game, a)} et les ${name(game, b)}${terms}.`);
  addChronicle(game, 'peace', `Paix entre les ${name(game, a)} et les ${name(game, b)}.`, [a, b]);
  for (const id of [a, b]) tell(game, id, `La paix est signée avec les ${name(game, id === a ? b : a)}${terms}.`, id === a ? b : a);
  if (paid) tellTransfer(game, t, payer!, payer === a ? b : a, `Prix de la paix : les ${name(game, payer!)} vous versent`, `Prix de la paix : vous versez aux ${name(game, payer === a ? b : a)}`);
  syncRelations(game);
}

export function sign(game: GameState, a: number, b: number, kind: 'trade' | 'research' | 'alliance' | 'embassy', minerals = 0, payer?: number) {
  const pr = pairOf(game, a, b);
  if (!pr || pr.status === 'war') return;
  if (kind === 'alliance') { pr.status = 'alliance'; pr.since = game.year; addChronicle(game, 'alliance', `Alliance entre les ${name(game, a)} et les ${name(game, b)}.`, [a, b]); openForAllies(game, a, b); } else pr[kind] = game.year;
  let paid = 0;
  if (minerals > 0 && payer !== undefined) paid = transferMinerals(game, payer, payer === a ? b : a, minerals);
  if (paid) tellTransfer(game, lastTransfer, payer!, payer === a ? b : a, `Pour cet accord, les ${name(game, payer!)} vous versent`, `Pour cet accord, vous versez aux ${name(game, payer === a ? b : a)}`);
  const what = kind === 'trade' ? `Accord commercial (+${Math.round(TRADE_BONUS * 100)} % de ressources chacun)` : kind === 'research' ? `Coopération scientifique (+${Math.round(RESEARCH_BONUS * 100)} % de recherche chacun)` : kind === 'embassy' ? 'Ambassades' : 'Alliance (ravitaillement aux stations, portes, vision des flottes, défense mutuelle)';
  log(game, a, b, `${what} entre les ${name(game, a)} et les ${name(game, b)}.`);
  if (kind === 'embassy') for (const [x, y] of [[a, b], [b, a]]) {
    // the diplomats settle in the other's capital: it is known at once
    const cap = capitalOf(game, game.players[y]);
    if (cap) { game.players[x].intel.planets[cap.id].owner = y; revealPlanet(game, game.players[x], cap); }
  }
  if (kind === 'embassy') for (const id of [a, b]) tell(game, id, `Ambassades ouvertes avec les ${name(game, id === a ? b : a)}${paid ? ` (${paid} kt de minerais versés)` : ''} : chacun en apprendra davantage sur l'autre (renseignement +25 des deux côtés).`, id === a ? b : a);
  else for (const id of [a, b]) tell(game, id, `${what} signé avec les ${name(game, id === a ? b : a)}${paid ? ` (${paid} kt de minerais versés)` : ''}.`, id === a ? b : a);
  syncRelations(game);
}

/** Ends a treaty (an alliance becomes a plain peace). */
export function cancel(game: GameState, a: number, b: number, kind: 'trade' | 'research' | 'alliance' | 'embassy') {
  const pr = pairOf(game, a, b);
  if (!pr) return;
  if (kind === 'alliance') { if (pr.status !== 'alliance') return; pr.status = 'peace'; pr.since = game.year; } else { if (pr[kind] === undefined) return; pr[kind] = undefined; }
  remember(game, b, a, 'broken', kind === 'embassy' ? -5 : -10, 1);
  if (kind === 'embassy') {
    log(game, a, b, `Les ${name(game, a)} ferment les ambassades qui les liaient aux ${name(game, b)}.`);
    tell(game, b, `Les ${name(game, a)} ferment les ambassades entre vos deux empires.`, a);
    tell(game, a, `Vous avez fermé les ambassades avec les ${name(game, b)}.`, b);
    syncRelations(game);
    return;
  }
  const what = kind === 'trade' ? 'l\'accord commercial' : kind === 'research' ? 'la coopération scientifique' : 'l\'alliance';
  log(game, a, b, `Les ${name(game, a)} rompent ${what} avec les ${name(game, b)}.`);
  tell(game, b, `Les ${name(game, a)} rompent ${what} qui vous liait.`, a);
  tell(game, a, `Vous avez rompu ${what} avec les ${name(game, b)}.`, b);
  syncRelations(game);
}

export function gift(game: GameState, from: number, to: number, kt: number): number {
  const moved = transferMinerals(game, from, to, kt);
  if (moved <= 0) return 0;
  remember(game, to, from, 'gift', moved / 25, 2);
  log(game, from, to, `Les ${name(game, from)} offrent ${moved} kt de minerais aux ${name(game, to)}.`);
  tellTransfer(game, lastTransfer, from, to, `Cadeau des ${name(game, from)} :`, `Cadeau aux ${name(game, to)} :`);
  return moved;
}

function applyProposal(game: GameState, x: { from: number; to: number; kind: ProposalKind; minerals?: number; payer?: number }) {
  switch (x.kind) {
    case 'peace': makePeace(game, x.from, x.to, x.minerals ?? 0, x.payer); break;
    case 'trade': case 'research': case 'alliance': case 'embassy': sign(game, x.from, x.to, x.kind, x.minerals ?? 0, x.payer); break;
    case 'borders': {
      // the one asked opens its borders to the one who asked
      let paid = 0;
      if ((x.minerals ?? 0) > 0 && x.payer !== undefined) paid = transferMinerals(game, x.payer, x.payer === x.from ? x.to : x.from, x.minerals!);
      setBorders(game, x.to, x.from, false);
      if (paid) tellTransfer(game, lastTransfer, x.payer!, x.payer === x.from ? x.to : x.from, `Pour l'ouverture des frontières, les ${name(game, x.payer!)} vous versent`, `Pour l'ouverture des frontières, vous versez aux ${name(game, x.payer === x.from ? x.to : x.from)}`);
      break;
    }
    case 'tribute': {
      const moved = transferMinerals(game, x.to, x.from, x.minerals ?? 0);
      remember(game, x.to, x.from, 'demand', -15, 1);
      log(game, x.from, x.to, `Les ${name(game, x.to)} versent un tribut de ${moved} kt aux ${name(game, x.from)}.`);
      // 0.3.7: exactly what arrived, mineral by mineral, and where
      if (moved > 0) tellTransfer(game, lastTransfer, x.to, x.from, `Les ${name(game, x.to)} cèdent et paient le tribut :`, `Vous versez un tribut aux ${name(game, x.from)} :`);
      else tell(game, x.from, `Les ${name(game, x.to)} acceptent de vous payer le tribut, mais n'ont plus rien à verser.`, x.to);
      break;
    }
  }
}

/** Why a proposal cannot even be made (null: it can). */
export function proposalBlocker(game: GameState, from: number, to: number, kind: ProposalKind): string | null {
  const st = statusOf(game, from, to);
  if (!st) return 'diplomatie inactive';
  if (game.players[to].dead) return 'empire anéanti';
  if (kind === 'peace' && st !== 'war') return 'pas en guerre';
  if (kind !== 'peace' && kind !== 'tribute' && st === 'war') return 'en guerre';
  if ((kind === 'trade' || kind === 'research') && pairOf(game, from, to)![kind] !== undefined) return 'déjà signé';
  if (kind === 'embassy' && !intelOn(game)) return 'règle Renseignement désactivée';
  if (kind === 'embassy' && pairOf(game, from, to)!.embassy !== undefined) return 'ambassades déjà ouvertes';
  if (kind === 'alliance' && st === 'alliance') return 'déjà alliés';
  if (kind === 'borders' && !bordersOn(game)) return 'il faut les règles Culture et Diplomatie';
  if (kind === 'borders' && !closedTo(game, to, from)) return 'leurs frontières vous sont ouvertes';
  if (kind === 'tribute' && tributeWait(game, from, to) > 0) return `un tribut tous les ${TRIBUTE_YEARS} ans au plus (prochain en ${game.year + tributeWait(game, from, to)})`;
  if (D(game).proposals.some(x => x.from === from && x.to === to && x.kind === kind)) return 'proposition déjà en attente';
  return null;
}

/**
 * A proposal. To a computer: answered at once (with the odds `evaluate` tells, drawn by `decideAnswer`). To a human:
 * kept until answered or expired (two years). Returns the computer's answer, or null when it waits.
 */
export function propose(game: GameState, from: number, to: number, kind: ProposalKind, minerals = 0, payer?: number): Answer | null {
  if (proposalBlocker(game, from, to, kind)) return firm(proposalBlocker(game, from, to, kind)!);
  acquaint(game, from, to);
  const target = game.players[to];
  if (kind === 'tribute') markTribute(game, from, to);
  if (target.ai) {
    const ans = evaluate(game, to, from, kind, minerals, payer);
    const yes = decideAnswer(game, to, from, kind, ans);
    if (yes) applyProposal(game, { from, to, kind, minerals, payer });
    else {
      if (kind === 'tribute') { remember(game, to, from, 'demand', -15, 1); tell(game, from, `Les ${target.name} refusent de vous payer le tribut de ${minerals} kt.`, to); }
      else if (!game.players[from].ai) tell(game, from, ans.sure ? `Les ${target.name} refusent ${OFFER_NAMES[kind]} : ${ans.why}.` : `Les ${target.name} refusent ${OFFER_NAMES[kind]}.`, to);
    }
    return { ...ans, ok: yes };
  }
  const p: Proposal = { id: game.nextId++, from, to, kind, year: game.year, expires: game.year + 2, minerals: minerals || undefined, payer: minerals ? payer : undefined };
  D(game).proposals.push(p);
  const terms = minerals ? (payer === from ? ` (ils offrent ${minerals} kt de minerais)` : ` (ils demandent ${minerals} kt de minerais)`) : '';
  tell(game, to, kind === 'tribute' ? `Les ${name(game, from)} exigent de vous un tribut de ${minerals} kt de minerais. Refuser les mettra en colère.` : kind === 'borders' ? `Les ${name(game, from)} vous demandent d'ouvrir vos frontières à leurs vaisseaux${terms}. Répondez dans la page Diplomatie.` : `Les ${name(game, from)} vous proposent ${KIND_NAMES[kind]}${terms}. Répondez dans la page Diplomatie.`, from);
  return null;
}

/** A human answers a proposal. */
export function answer(game: GameState, id: number, yes: boolean) {
  const d = D(game);
  const p = d.proposals.find(x => x.id === id);
  if (!p) return;
  d.proposals = d.proposals.filter(x => x !== p);
  if (yes) {
    // (a tribute waiting for its answer is not blocked by its own three years)
    if (p.kind === 'tribute' ? game.players[p.from].dead : proposalBlocker(game, p.from, p.to, p.kind) && !(p.kind === 'peace' && statusOf(game, p.from, p.to) === 'war')) return;
    applyProposal(game, p);
  } else {
    remember(game, p.from, p.to, p.kind === 'tribute' ? 'demand' : 'refused', p.kind === 'tribute' ? -10 : -5, 1);
    tell(game, p.from, `Les ${name(game, p.to)} refusent ${OFFER_NAMES[p.kind]}.`, p.to);
  }
}

// ---------------------------------------------------------------------------------------------------- the year

/** After the battles: ships lost to each other count in the war. */
export function recordWarLosses(game: GameState) {
  if (!diplomacyOn(game)) return;
  for (const b of game.battles) {
    const emps = b.players.filter(id => isEmp(game, id));
    // 3.6: what the losses were worth (ten scouts are not a battleship): cost of each ship destroyed
    const value: Record<number, number> = {};
    const design = new Map(b.tokens.map(t => [t.id, t]));
    for (const a of b.actions) {
      if (a.t !== 'fire' || !a.killed) continue;
      const t = design.get(a.target);
      const d = t ? game.designs.find(x => x.id === t.designId) : undefined;
      if (!t || !d) continue;
      const c = specOf(game, d.id).cost;
      value[t.owner] = (value[t.owner] ?? 0) + a.killed * (c.resources + c.ironium + c.boranium + c.germanium);
    }
    for (const x of emps) for (const y of emps) {
      if (x >= y || statusOf(game, x, y) !== 'war') continue;
      const pr = pairOf(game, x, y)!;
      pr.losses ??= {}; pr.lossValue ??= {};
      for (const id of [x, y]) {
        if (b.losses[id]) pr.losses[id] = (pr.losses[id] ?? 0) + b.losses[id];
        if (value[id]) pr.lossValue[id] = (pr.lossValue[id] ?? 0) + value[id];
      }
    }
  }
}
/** A world changed hands (invasion, assimilation). */
export function worldTaken(game: GameState, loser: number, winner: number, how: 'conquest' | 'assimilation') {
  worldGrudge(game, loser, winner, how);
  if (!diplomacyOn(game) || !isEmp(game, loser) || !isEmp(game, winner)) return;
  remember(game, loser, winner, how, how === 'conquest' ? -15 : -8, 0.5);
  const pr = pairOf(game, loser, winner);
  if (pr && pr.status === 'war') { pr.planets ??= {}; pr.planets[loser] = (pr.planets[loser] ?? 0) + 1; }
}

/** Distance between the nearest worlds of two empires, as the first one knows them. */
const reachable = (game: GameState, a: number, b: number) => {
  const mine = game.planets.filter(pl => pl.owner === a), theirs = game.players[a].intel.planets.filter(pi => pi.owner === b).map(pi => game.planets[pi.id]);
  let best = Infinity;
  for (const m of mine) for (const t of theirs) best = Math.min(best, distance(m, t));
  return best;
};

/** How much a computer wants a war with another empire (≥ 45: it declares it, some year). */
export function warDesire(game: GameState, ai: number, other: number): number {
  const op = opinion(game, ai, other).total;
  const pr = pairOf(game, ai, other)!;
  const ratio = Math.max(0.1, power(game, ai)) / Math.max(0.1, perceivedPower(game, ai, other));
  let d = -op + 45 * aggression(game.players[ai]) + 20 * Math.max(-2, Math.min(1.5, Math.log2(ratio)));
  d -= 15 * ((pr.trade !== undefined ? 1 : 0) + (pr.research !== undefined ? 1 : 0)) + (pr.status === 'alliance' ? 60 : 0);
  const dist = reachable(game, ai, other);
  if (dist <= 150) d += 10; else if (dist > game.width * 0.5) d -= 30;
  if (score(game.players[other]) > 1.3 * Math.max(1, score(game.players[ai]))) d += 10;
  if (!game.players[other].ai) d += 5; // a little more often the player: livelier games
  if (isNemesis(game, ai, other)) d += 70;
  d += bordersWarPush(game, ai, other);
  return Math.round(d);
}

/** Yearly, before the computers play: proposals expire, the computers talk, declare war, make peace. */
export function runDiplomacy(game: GameState) {
  if (!diplomacyOn(game)) { if (game.settings.diplomacy && !game.diplomacy) initDiplomacy(game); if (!diplomacyOn(game)) return; }
  const d = D(game);
  const rng = new Rng(seedFromString(`${game.settings.seed}|diplo|${game.year}`));
  // expired proposals: a refusal
  for (const p of d.proposals.filter(x => x.expires < game.year)) {
    remember(game, p.from, p.to, p.kind === 'tribute' ? 'demand' : 'refused', p.kind === 'tribute' ? -10 : -5, 1);
    tell(game, p.to, p.kind === 'tribute' ? `Les ${name(game, p.from)} exigeaient de vous un tribut : faute de réponse de votre part, la demande a expiré, et ils le prennent comme un refus.` : p.kind === 'borders' ? `Les ${name(game, p.from)} vous demandaient d'ouvrir vos frontières à leurs vaisseaux : faute de réponse de votre part, la demande a expiré, et ils le prennent comme un refus.` : `Les ${name(game, p.from)} vous proposaient ${KIND_NAMES[p.kind]} : faute de réponse de votre part, la proposition a expiré.`, p.from);
  }
  d.proposals = d.proposals.filter(x => x.expires >= game.year && !game.players[x.from].dead && !game.players[x.to].dead);
  d.memory = d.memory.filter(m => memValue(game, m) !== 0);
  const crisis = game.crisis?.phase === 'active';
  for (const p of game.players) {
    if (!p.ai || p.dead || p.monster) continue;
    const others = game.players.filter(o => o.id !== p.id && isEmp(game, o.id) && !o.dead && p.intel.met.includes(o.id));
    const pending = (o: number, kind?: ProposalKind) => d.proposals.some(x => x.from === p.id && x.to === o && (!kind || x.kind === kind));
    const refusedLately = (o: number) => d.memory.some(m => m.by === p.id && m.about === o && m.kind === 'refused' && game.year - m.year < 6);
    for (const o of others) {
      const st = statusOf(game, p.id, o.id);
      if (st === 'war') {
        if (isNemesis(game, p.id, o.id)) continue;
        const ans = evaluate(game, p.id, o.id, 'peace');
        if (ans.score < 15 && !crisis) continue; // not tired yet
        if (o.ai) { if (decideAnswer(game, o.id, p.id, 'peace', evaluate(game, o.id, p.id, 'peace'))) makePeace(game, p.id, o.id); }
        else if (!pending(o.id) && !refusedLately(o.id)) {
          // winning: asks for something; losing: offers something
          const ratio = Math.max(0.1, power(game, p.id)) / Math.max(0.1, perceivedPower(game, p.id, o.id));
          const kt = ratio >= 2 ? 300 : ratio <= 0.5 ? 200 : 0;
          propose(game, p.id, o.id, 'peace', kt, kt ? (ratio >= 2 ? o.id : p.id) : undefined);
        }
        continue;
      }
      // 0.3.9.10: hemmed in by closed borders, a computer asks for them to be opened
      if (closedTo(game, o.id, p.id) && hindrance(game, p.id, o.id) >= 0.1 && !proposalBlocker(game, p.id, o.id, 'borders')) {
        if (o.ai) { if (rng.chance(0.3) && decideAnswer(game, o.id, p.id, 'borders', evaluate(game, o.id, p.id, 'borders'))) applyProposal(game, { from: p.id, to: o.id, kind: 'borders' }); }
        else if (!pending(o.id) && !refusedLately(o.id) && rng.chance(0.35)) propose(game, p.id, o.id, 'borders');
      }
      // treaties
      const op = opinion(game, p.id, o.id).total;
      for (const kind of [...(intelOn(game) ? ['embassy'] as const : []), 'trade', 'research', 'alliance'] as const) {
        if (proposalBlocker(game, p.id, o.id, kind)) continue;
        if (op < NEED[kind] + 5) continue;
        if (o.ai) { if (rng.chance(0.5) && decideAnswer(game, o.id, p.id, kind, evaluate(game, o.id, p.id, kind))) sign(game, p.id, o.id, kind); }
        else if (!pending(o.id) && !refusedLately(o.id) && rng.chance(0.3)) propose(game, p.id, o.id, kind);
        break;
      }
    }
    // a new war (one at a time, two for the warlike; never against the Harvesters' backdrop)
    if (crisis) continue;
    // 0.3.9: a nemesis goes back to war four years after a peace (it never makes one, but a third party may)
    const sworn = swornAgainst(game, p.id).find(h => statusOf(game, p.id, h) !== 'war' && p.intel.met.includes(h) && (pairOf(game, p.id, h)!.wars === 0 || game.year - pairOf(game, p.id, h)!.since >= 4));
    if (sworn !== undefined) { declareWar(game, p.id, sworn, 'ils ont juré votre perte'); continue; }
    // 0.3.9: the first act is one of discovery: the computers make no war
    if (actOf(game) < 2) continue;
    const start = 2400 + (WAR_YEAR[p.ai] ?? 40) - Math.round(10 * aggression(p));
    if (game.year < start) continue;
    const wars = others.filter(o => statusOf(game, p.id, o.id) === 'war').length;
    if (wars >= (aggression(p) >= 0.8 ? 2 : 1)) continue;
    let best: Player | undefined, bd = -Infinity;
    for (const o of others) {
      const po = pairOf(game, p.id, o.id)!;
      if (po.status === 'war' || (po.wars > 0 && game.year - po.since < 10)) continue; // a peace holds ten years at least
      const w = warDesire(game, p.id, o.id);
      if (w > bd) { bd = w; best = o; }
    }
    if (best && bd >= 45 && rng.chance(0.35)) { declareWar(game, p.id, best.id, hindrance(game, p.id, best.id) >= 0.25 ? 'leur expansion était étouffée par des frontières fermées' : undefined); continue; }
    // a demand on a much weaker neighbour
    if (best && aggression(p) >= 0.6 && bd >= 25 && power(game, p.id) >= 2.5 * Math.max(0.1, perceivedPower(game, p.id, best.id)) && rng.chance(0.15) && !pending(best.id) && tributeWait(game, p.id, best.id) === 0) {
      const have = richest(game, best.id)?.total ?? 0;
      const kt = Math.round(Math.min(800, have * 0.25) / 50) * 50;
      if (kt >= 100) {
        if (best.ai) {
          const ans = evaluate(game, best.id, p.id, 'tribute', kt);
          markTribute(game, p.id, best.id);
          if (decideAnswer(game, best.id, p.id, 'tribute', ans)) applyProposal(game, { from: p.id, to: best.id, kind: 'tribute', minerals: kt });
          else { remember(game, best.id, p.id, 'demand', -15, 1); if (rng.chance(0.5)) declareWar(game, p.id, best.id, 'leur demande de tribut a été refusée'); }
        } else propose(game, p.id, best.id, 'tribute', kt, best.id);
      }
    }
  }
  // the crisis unites the galaxy: every war between computers ends (not the one against a Portail builder)
  const portal = game.settings.megaprojects ? portalThreat(game) : null;
  if (crisis) for (const a of game.players) for (const b of game.players) {
    if (a.id < b.id && a.ai && b.ai && !a.dead && !b.dead && statusOf(game, a.id, b.id) === 'war' && portal?.owner !== a.id && portal?.owner !== b.id) makePeace(game, a.id, b.id);
  }
  syncRelations(game);
}

/** The portal builder: every computer turns on it. */
export function warOnPortal(game: GameState, ai: number, builder: number) {
  if (!diplomacyOn(game) || statusOf(game, ai, builder) === 'war') return;
  declareWar(game, ai, builder, 'pour empêcher l\'achèvement du Portail');
}
