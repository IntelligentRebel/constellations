// 0.3.9: the three acts. A game is told in three acts, each opened by a title card and changing a few rules:
// I « L'Éveil » (the computers make no war, no megaproject), II « Les Rivalités » (wars, megaprojects except the
// Portal, cataclysms), III « L'Apothéose » (the Portal, research 15 % cheaper, the Breach). The next act comes with
// time, or earlier when the galaxy moves on (a third of the worlds settled, a first war; a third relay of the
// Ascension or the Portal within reach, the omens of the Breach).
import type { GameState, Player } from './types';
import { addChronicle } from './chronicle';

export const actsOn = (game: GameState) => !!game.settings.acts;
/** The current act (3 when the rule is off: nothing is held back). */
export const actOf = (game: GameState): 1 | 2 | 3 => actsOn(game) ? (game.act?.n ?? 1) : 3;

/** Latest years of the acts (from 2400). */
export const ACT2_BY = 30, ACT3_BY = 75;

export const ACT_INFO: Record<1 | 2 | 3, { title: string; text: string }> = {
  1: { title: 'L\'Éveil', text: 'Les empires découvrent leur voisinage et se disputent les premiers mondes.' },
  2: { title: 'Les Rivalités', text: 'Les frontières se touchent. Les ambitions aussi.' },
  3: { title: 'L\'Apothéose', text: 'Le temps des grands desseins : qui laissera son nom aux étoiles ?' },
};

/** What an act changes, for its title card and the header (only the rules of this game). */
export function actRules(game: GameState, n: 1 | 2 | 3): string[] {
  const s = game.settings, out: string[] = [];
  if (n === 1) {
    out.push('Les ordinateurs ne déclarent aucune guerre.');
    if (s.megaprojects) out.push('Aucun mégaprojet ne peut être lancé.');
  } else if (n === 2) {
    out.push('Les ordinateurs peuvent déclarer la guerre.');
    if (s.megaprojects) out.push('Les mégaprojets peuvent être lancés, sauf le Portail de l\'Ascension.');
    if (s.cataclysms) out.push('Des cataclysmes peuvent être annoncés.');
  } else {
    if (s.megaprojects) out.push('Le Portail de l\'Ascension peut être bâti.');
    out.push('La recherche coûte 15 % de moins : les savoirs s\'emballent.');
    if (s.crisis) out.push('La Brèche peut s\'ouvrir.');
  }
  return out;
}

/** What brings the next act, told in the header. */
export function nextActText(game: GameState): string | null {
  const n = actOf(game);
  if (!actsOn(game) || n === 3) return null;
  if (n === 1) return `L'acte II commence au plus tard en ${2400 + ACT2_BY}, plus tôt quand un tiers des mondes est colonisé ou qu'une première guerre éclate.`;
  return game.settings.megaprojects && game.settings.portalRelays
    ? `L'acte III commence au plus tard en ${2400 + ACT3_BY}, plus tôt quand un empire achève son troisième relais de l'Ascension, ou quand la Brèche s'annonce.`
    : game.settings.megaprojects ? `L'acte III commence au plus tard en ${2400 + ACT3_BY}, plus tôt quand un empire a la technologie du Portail de l'Ascension, ou quand la Brèche s'annonce.`
      : `L'acte III commence au plus tard en ${2400 + ACT3_BY}, plus tôt quand la Brèche s'annonce.`;
}

const relaysOf = (game: GameState, p: Player) => game.planets.filter(pl => pl.owner === p.id && pl.megaprojects?.includes('relay')).length;
const portalTech = (p: Player) => p.tech.energy >= 12 && p.tech.propulsion >= 12 && p.tech.construction >= 12 && p.tech.electronics >= 12;

/** Yearly: the next act when its time has come. */
export function runActs(game: GameState) {
  if (!actsOn(game)) return;
  const act = game.act ?? (game.act = { n: 1, since: 2400 });
  const emp = game.players.filter(p => !p.monster && !p.dead);
  let why: string | undefined;
  if (act.n === 1) {
    const settled = game.planets.filter(p => p.owner >= 0 && !game.players[p.owner].monster).length / Math.max(1, game.planets.filter(p => !p.hidden).length);
    const war = (game.chronicle?.events ?? []).some(e => e.kind === 'war');
    if (game.year >= 2400 + ACT2_BY) why = 'le temps des découvertes s\'achève';
    else if (settled >= 1 / 3) why = 'un tiers des mondes est colonisé';
    else if (war) why = 'une première guerre a éclaté';
    if (why) advance(game, 2, why);
    return;
  }
  if (act.n === 2) {
    const relay = game.settings.megaprojects && game.settings.portalRelays ? emp.find(p => relaysOf(game, p) >= 3) : undefined;
    const tech = game.settings.megaprojects && !game.settings.portalRelays ? emp.find(portalTech) : undefined;
    if (game.year >= 2400 + ACT3_BY) why = 'le siècle avance';
    else if (relay) why = `les ${relay.name} ont bâti leur troisième relais de l'Ascension`;
    else if (tech) why = `les ${tech.name} ont la technologie du Portail de l'Ascension`;
    else if (game.settings.crisis && game.crisis && game.crisis.phase !== 'dormant') why = 'la Brèche s\'annonce';
    if (why) advance(game, 3, why);
  }
}

function advance(game: GameState, n: 2 | 3, why: string) {
  game.act = { n, since: game.year, why };
  const info = ACT_INFO[n];
  for (const p of game.players) {
    if (p.monster || p.dead) continue;
    p.messages.unshift({ year: game.year, kind: 'event', text: `Acte ${n === 2 ? 'II' : 'III'} : ${info.title}. ${info.text} (${why}.) ${actRules(game, n).join(' ')}`, target: { kind: 'score', id: 0 } });
  }
  addChronicle(game, 'act', `Acte ${n === 2 ? 'II' : 'III'} : ${info.title} (${why}).`, []);
}

/** Turned on during a game: the act the galaxy is already in. */
export function initActs(game: GameState) {
  game.act = { n: 1, since: 2400 };
  runActs(game);
  if (actOf(game) === 2) runActs(game);
}
