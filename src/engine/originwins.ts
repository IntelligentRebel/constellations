// 0.3.9: a victory for each origin. Where an empire comes from gives it a goal of its own, that only it can reach and
// that wins the game like any other victory (from 2430, or the second act). Its progress is told on the Empire page.
import type { GameState, Planet, Player } from './types';
import { FIELDS } from './types';
import { distance } from './fleet';
import { people } from './words';
import { addChronicle } from './chronicle';
import { originsOn } from './origins';

export const originWinsOn = (game: GameState) => !!game.settings.originVictories && originsOn(game);
export const ORIGIN_WIN_FROM = 2430;

export interface OriginWin { name: string; text: (game: GameState) => string; progress: (game: GameState, p: Player) => { done: boolean; text: string; share: number } }

const own = (game: GameState, p: Player) => game.planets.filter(pl => pl.owner === p.id);
const BIG = 750_000;

export const ORIGIN_WINS: Record<string, OriginWin> = {
  standard: {
    name: 'L\'Ascendant',
    text: () => 'Être en tête des scores vingt-cinq années de suite.',
    progress: (g, p) => { const n = p.leadYears ?? 0; return { done: n >= 25, share: n / 25, text: `${n} année${n > 1 ? 's' : ''} de suite en tête` }; },
  },
  doomed: {
    name: 'L\'Exode accompli',
    text: g => `Faire d'un monde colonisé après 2420 un nouveau berceau de ${people(g, BIG)} habitants, et tenir 25 mondes.`,
    progress: (g, p) => {
      const best = own(g, p).filter(pl => (pl.colonizedYear ?? 2400) >= 2420).sort((a, b) => b.pop - a.pop)[0];
      const n = own(g, p).length;
      return { done: !!best && best.pop >= BIG && n >= 25, share: Math.min(1, (best?.pop ?? 0) / BIG) * 0.5 + Math.min(1, n / 25) * 0.5, text: `${best ? `${best.name} : ${people(g, best.pop)}` : 'aucun nouveau monde'} · ${n} mondes sur 25` };
    },
  },
  relicWorld: {
    name: 'Les Archives retrouvées',
    text: () => 'Réunir quatre reliques.',
    progress: (g, p) => { const n = p.relics?.length ?? 0; return { done: n >= 4, share: n / 4, text: `${n} relique${n > 1 ? 's' : ''} sur 4` }; },
  },
  lostColony: {
    name: 'Les Retrouvailles',
    text: g => `Que la colonie perdue et le monde natal comptent chacun ${people(g, 600_000)} habitants, et tenir 12 mondes à moins de 120 al de la colonie perdue.`,
    progress: (g, p) => {
      const col = p.originWorld !== undefined ? g.planets[p.originWorld] : undefined;
      const home = g.planets.find(pl => pl.homeworld && pl.owner === p.id);
      if (!col || col.owner !== p.id || !home) return { done: false, share: 0, text: !col || col.owner !== p.id ? 'la colonie perdue n\'est plus à vous' : 'le monde natal n\'est plus à vous' };
      const near = own(g, p).filter(pl => pl !== col && distance(pl, col) <= 120).length;
      const ok = col.pop >= 600_000 && home.pop >= 600_000 && near >= 12;
      return { done: ok, share: (Math.min(1, col.pop / 600_000) + Math.min(1, home.pop / 600_000) + Math.min(1, near / 12)) / 3, text: `${col.name} : ${people(g, col.pop)} · ${home.name} : ${people(g, home.pop)} · ${near} mondes sur 12 autour de ${col.name}` };
    },
  },
  explorers: {
    name: 'La Carte complète',
    text: () => 'Avoir analysé 90 % des systèmes de la galaxie.',
    progress: (g, p) => {
      const all = g.planets.filter(pl => !pl.hidden || p.intel.planets[pl.id]?.year !== undefined);
      const seen = all.filter(pl => p.intel.planets[pl.id]?.year !== undefined).length;
      const share = seen / Math.max(1, all.length);
      return { done: share >= 0.9, share: share / 0.9, text: `${Math.floor(share * 100)} % sur 90 %` };
    },
  },
  proteges: {
    name: 'L\'Émancipation',
    text: () => 'Dépasser les maîtres : le niveau 18 dans les six domaines.',
    progress: (g, p) => { const n = FIELDS.filter(f => p.tech[f] >= 18).length; return { done: n >= 6, share: FIELDS.reduce((a, f) => a + Math.min(18, p.tech[f]), 0) / 108, text: `${n} domaine${n > 1 ? 's' : ''} sur 6 au niveau 18` }; },
  },
  exiles: {
    name: 'La Terre promise',
    text: () => 'Refonder l\'empire, puis tenir 30 mondes.',
    progress: (g, p) => { const n = own(g, p).length; const ok = (p.stats.refounded ?? 0) > 0; return { done: ok && n >= 30, share: ok ? Math.min(1, n / 30) : 0, text: ok ? `${n} mondes sur 30` : 'pas encore refondé' }; },
  },
  heirs: {
    name: 'Les Gardiens du seuil',
    text: () => 'Sceller la Brèche avant qu\'elle ne s\'ouvre.',
    progress: (g, p) => {
      const C = g.crisis;
      const done = !!C?.sealed && C.endedBy === p.id && C.nexusFleetId === undefined;
      return { done, share: p.secretKnown !== undefined ? 0.5 : Math.min(0.5, (p.clues ?? 0) / 12), text: done ? 'la Brèche est scellée' : p.secretKnown !== undefined ? 'secret percé : il reste le Sceau' : `${p.clues ?? 0} indices sur 6` };
    },
  },
};

/** Yearly: the leader's streak, and the origin victories (the first one reached wins). */
export function runOriginWins(game: GameState) {
  if (!originWinsOn(game)) return;
  const alive = game.players.filter(p => !p.monster && !p.dead);
  const score = (p: Player) => p.scores[p.scores.length - 1]?.score ?? 0;
  const top = [...alive].sort((a, b) => score(b) - score(a))[0];
  for (const p of alive) p.leadYears = p === top && alive.length > 1 && score(p) > 0 ? (p.leadYears ?? 0) + 1 : 0;
  if (game.victor !== null || game.year < ORIGIN_WIN_FROM) return;
  for (const p of alive) {
    const w = p.origin ? ORIGIN_WINS[p.origin] : undefined;
    if (!w || !w.progress(game, p).done) continue;
    game.victor = p.id; game.victoryKind = 'origin';
    for (const o of game.players) {
      if (o.monster || o.dead) continue;
      o.messages.unshift({ year: game.year, kind: 'victory', text: o.id === p.id ? `Victoire ! ${w.name}. ${w.text(game)} Votre origine s'accomplit.` : `Les ${p.name} remportent la partie par la victoire de leur origine, ${w.name}. Elle peut continuer.`, target: { kind: 'score', id: 0 } });
    }
    addChronicle(game, 'victory', `Les ${p.name} accomplissent leur destin, ${w.name}, et remportent la partie.`, [p.id]);
    return;
  }
}

export type { Planet };
