// Secret objectives (Constellations 3): every empire, computers included, receives two hidden goals at the start.
// Each one achieved is worth points of score. Nobody knows the others' goals until the end of the game, so an
// empire's behaviour can be hard to read: why does it want that particular world?
import { people } from './words';
import type { GameState, Player, SecretObjective } from './types';
import { FIELDS } from './types';
import { Rng, seedFromString } from './rng';

export const OBJECTIVE_POINTS = 120;

export interface ObjectiveDef {
  id: string;
  name: string;
  /** text with {n} for the parameter, {who} for a rival */
  text: string;
  needs?: 'logistics' | 'distanceCost' | 'megaprojects';
  param?: (game: GameState, player: Player, rng: Rng) => number;
  /** done now? (checked every year) */
  check: (game: GameState, player: Player, o: SecretObjective) => boolean;
  /** failed for good? */
  fails?: (game: GameState, player: Player, o: SecretObjective) => boolean;
  progress?: (game: GameState, player: Player, o: SecretObjective) => string;
}

const perEmpire = (game: GameState) => game.planets.length / Math.max(1, game.players.filter(p => !p.monster).length);
const owned = (game: GameState, p: Player) => game.planets.filter(x => x.owner === p.id);
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

export const OBJECTIVES: ObjectiveDef[] = [
  {
    id: 'cartographer', name: 'Cartographe', text: 'Avoir exploré {n} planètes.',
    param: g => Math.round(perEmpire(g) * 1.1),
    check: (g, p, o) => p.intel.planets.filter(x => x.year !== undefined).length >= (o.param ?? 30),
    progress: (g, p) => `${p.intel.planets.filter(x => x.year !== undefined).length}`,
  },
  {
    id: 'settler', name: 'Bâtisseur d\'empire', text: 'Posséder {n} planètes.',
    param: g => Math.max(8, Math.round(perEmpire(g) * 0.45)),
    check: (g, p, o) => owned(g, p).length >= (o.param ?? 10),
    progress: (g, p) => `${owned(g, p).length}`,
  },
  {
    id: 'demographer', name: 'Démographe', text: 'Atteindre {n} habitants.',
    param: g => Math.round(perEmpire(g) * 60_000 / 100_000) * 100_000,
    check: (g, p, o) => owned(g, p).reduce((a, x) => a + x.pop, 0) >= (o.param ?? 3e6),
    progress: (g, p) => people(g, owned(g, p).reduce((a, x) => a + x.pop, 0)),
  },
  {
    id: 'conqueror', name: 'Conquérant', text: 'Prendre {n} planètes par la force.',
    param: () => 3,
    check: (g, p, o) => (p.stats.planetsCaptured ?? 0) >= (o.param ?? 3),
    progress: (g, p) => `${p.stats.planetsCaptured ?? 0}`,
  },
  {
    id: 'hunter', name: 'Chasseur', text: 'Détruire {n} vaisseaux adverses.',
    param: () => 25,
    check: (g, p, o) => p.stats.shipsDestroyed >= (o.param ?? 40),
    progress: (g, p) => `${p.stats.shipsDestroyed}`,
  },
  {
    id: 'corsair', name: 'Corsaire', text: 'Détruire {n} convois ou cargos adverses.', needs: 'logistics',
    param: () => 2,
    check: (g, p, o) => (p.stats.convoysDestroyed ?? 0) >= (o.param ?? 2),
    progress: (g, p) => `${p.stats.convoysDestroyed ?? 0}`,
  },
  {
    id: 'scholar', name: 'Savant', text: 'Atteindre le niveau {n} dans un domaine de recherche.',
    param: () => 16,
    check: (g, p, o) => FIELDS.some(f => p.tech[f] >= (o.param ?? 16)),
    progress: (g, p) => `niveau ${Math.max(...FIELDS.map(f => p.tech[f]))}`,
  },
  {
    id: 'polymath', name: 'Encyclopédiste', text: 'Atteindre le niveau {n} dans les six domaines.',
    param: () => 10,
    check: (g, p, o) => FIELDS.every(f => p.tech[f] >= (o.param ?? 10)),
    progress: (g, p) => `plus bas : ${Math.min(...FIELDS.map(f => p.tech[f]))}`,
  },
  {
    id: 'architect', name: 'Architecte', text: 'Achever un mégaprojet.', needs: 'megaprojects',
    check: (g, p) => owned(g, p).some(x => (x.megaprojects?.length ?? 0) > 0),
  },
  {
    id: 'vendetta', name: 'Vendetta', text: 'Prendre {n} planète{s} aux {who}.',
    param: () => 1,
    check: (g, p, o) => (p.stats.capturedFrom ?? []).filter(v => v === rivalOf(g, p, o)).length >= (o.param ?? 2),
    fails: (g, p, o) => !!g.players[rivalOf(g, p, o)]?.dead && (p.stats.capturedFrom ?? []).filter(v => v === rivalOf(g, p, o)).length < (o.param ?? 2),
    progress: (g, p, o) => `${(p.stats.capturedFrom ?? []).filter(v => v === rivalOf(g, p, o)).length}`,
  },
  {
    id: 'fortress', name: 'Forteresse', text: 'Ne perdre aucune planète par invasion avant l\'an {n}.',
    param: g => g.year + 100,
    check: (g, p, o) => g.year >= (o.param ?? 2500) && !(p.stats.planetsLost ?? 0),
    fails: (g, p) => (p.stats.planetsLost ?? 0) > 0,
  },
  {
    id: 'magnate', name: 'Magnat', text: 'Avoir en stock {n} kt de minerais en surface, toutes vos planètes et tous minerais confondus.',
    param: g => Math.round(perEmpire(g) * 400 / 1000) * 1000,
    check: (g, p, o) => owned(g, p).reduce((a, x) => a + x.surface.ironium + x.surface.boranium + x.surface.germanium, 0) >= (o.param ?? 12000),
    progress: (g, p) => `${fmt(owned(g, p).reduce((a, x) => a + x.surface.ironium + x.surface.boranium + x.surface.germanium, 0))} kt`,
  },
  {
    id: 'governor', name: 'Gouverneur', text: 'Fonder {n} capitales régionales.', needs: 'distanceCost',
    param: () => 2,
    check: (g, p, o) => owned(g, p).filter(x => x.regionalCapital).length >= (o.param ?? 2),
    progress: (g, p) => `${owned(g, p).filter(x => x.regionalCapital).length}`,
  },
  {
    id: 'quartermaster', name: 'Intendant', text: 'Livrer {n} colons par le réseau logistique.', needs: 'logistics',
    param: () => 400_000,
    check: (g, p, o) => (p.logStats?.colonists ?? 0) >= (o.param ?? 400_000),
    progress: (g, p) => people(g, p.logStats?.colonists ?? 0),
  },
];

export const OBJ = Object.fromEntries(OBJECTIVES.map(o => [o.id, o])) as Record<string, ObjectiveDef>;
export const objectivesOn = (game: GameState) => !!game.settings.secretObjectives;

function rivalOf(_game: GameState, _p: Player, o: SecretObjective): number {
  return o.param2 ?? -1;
}

export function objectiveText(game: GameState, o: SecretObjective): string {
  const d = OBJ[o.id];
  if (!d) return o.id;
  const n = o.param ?? 0;
  const who = o.param2 !== undefined ? game.players[o.param2]?.name ?? '?' : '?';
  return d.text.replace('{n}', d.id === 'fortress' ? String(n) : d.id === 'demographer' || d.id === 'quartermaster' ? people(game, n) : fmt(n)).replace('{s}', n > 1 ? 's' : '').replace('{who}', who);
}

/** Two objectives per empire, drawn on their own random stream (the rest of the game does not change). */
export function assignObjectives(game: GameState) {
  for (const p of game.players) {
    if (p.objectives?.length || p.monster) continue;
    const rng = new Rng(seedFromString(`${game.settings.seed}|obj|${p.id}`));
    const pool = OBJECTIVES.filter(d => !d.needs || (game.settings as any)[d.needs]);
    const picks: SecretObjective[] = [];
    const ids = rng.shuffle(pool.map(d => d.id));
    for (const id of ids) {
      if (picks.length >= 2) break;
      // never two warlike goals, never two technology goals
      const war = ['conqueror', 'hunter', 'corsair', 'vendetta'];
      const tech = ['scholar', 'polymath'];
      if (picks.some(x => (war.includes(x.id) && war.includes(id)) || (tech.includes(x.id) && tech.includes(id)))) continue;
      const d = OBJ[id];
      const o: SecretObjective = { id };
      if (d.param) o.param = d.param(game, p, rng);
      if (id === 'vendetta') {
        const others = game.players.filter(x => x.id !== p.id && !x.monster);
        if (!others.length) continue;
        o.param2 = rng.pick(others).id;
      }
      picks.push(o);
    }
    p.objectives = picks;
  }
}

/** Yearly check: completed objectives give points; the others learn that something was achieved, not what. */
export function checkObjectives(game: GameState) {
  if (!objectivesOn(game)) return;
  for (const p of game.players) {
    if (p.dead || !p.objectives) continue;
    for (const o of p.objectives) {
      if (o.done !== undefined || o.failed !== undefined) continue;
      const d = OBJ[o.id];
      if (!d) continue;
      if (d.fails?.(game, p, o)) {
        o.failed = game.year;
        if (!p.ai) p.messages.push({ year: game.year, kind: 'warning', text: `Objectif secret manqué : ${d.name} (${objectiveText(game, o)})`, target: { kind: 'score', id: 0 } });
        continue;
      }
      if (!d.check(game, p, o)) continue;
      o.done = game.year;
      p.messages.push({ year: game.year, kind: 'event', text: `Objectif secret accompli : ${d.name}. ${objectiveText(game, o)} (+${OBJECTIVE_POINTS} points de score)`, target: { kind: 'score', id: 0 } });
      for (const other of game.players) {
        if (other.id === p.id || other.dead || !other.intel.met.includes(p.id)) continue;
        other.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${p.name} ont accompli un de leurs objectifs secrets.`, target: { kind: 'player', id: p.id } });
      }
    }
  }
}

export function objectivePoints(p: Player): number {
  return (p.objectives ?? []).filter(o => o.done !== undefined).length * OBJECTIVE_POINTS;
}

export function objectiveProgress(game: GameState, p: Player, o: SecretObjective): string {
  const d = OBJ[o.id];
  return d?.progress ? d.progress(game, p, o) : '';
}
