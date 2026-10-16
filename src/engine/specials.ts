// Constellations technologies that are not ship components: they unlock an ability at fixed levels.
import type { Field, GameState, Player } from './types';
import { Rng, seedFromString } from './rng';
import { SHIFT_WEIGHTS } from './research';

export interface SpecialTech {
  id: 'autoExplore' | 'wormholeNav' | 'infrared' | 'lensing';
  name: string;
  /** field shown in the research table */
  field: Field;
  req: Partial<Record<Field, number>>;
  /** short line under the name */
  what: string;
  /** hover explanation */
  explain: string;
  /** message when it is unlocked */
  unlocked: string;
  /** with the "hidden tree" rule, the level of its field moves like any technology's (±2, per game) */
  fuzzy?: boolean;
  /** only in the games where it means something (0.3.7: the hidden stars) */
  when?: (game: GameState) => boolean;
}

/** Automatic exploration: Électronique 9 nominal, 7 to 11 depending on the game with the hidden tree (4 until 3.3.1, 12 until 3.5). */
export const AUTO_EXPLORE: SpecialTech & { level: number } = {
  id: 'autoExplore', name: 'Protocoles d\'exploration autonome', field: 'electronics', level: 9, req: { electronics: 9 }, fuzzy: true,
  what: 'exploration automatique des éclaireurs',
  explain: 'Ajoute la case « Exploration automatique » à l\'itinéraire des flottes : chaque année, la flotte part d\'elle-même vers la planète inexplorée la plus proche qu\'elle peut atteindre sans tomber en panne, et rentre faire le plein quand il le faut.',
  unlocked: 'vos éclaireurs peuvent désormais explorer seuls (case « Exploration automatique » dans l\'itinéraire d\'une flotte).',
};

/** Wormhole traversal: Propulsion 10 and Électronique 10 (12 and 12 until 3.5). */
export const WORMHOLE_NAV: SpecialTech = {
  id: 'wormholeNav', name: 'Navigation des anomalies', field: 'propulsion', req: { propulsion: 10, electronics: 10 },
  what: 'traversée des trous de ver',
  explain: 'Permet de franchir les trous de ver et de cartographier leur sortie. Sans elle, une flotte peut s\'approcher d\'un trou de ver et l\'observer, mais pas y entrer. La traversée ne coûte aucun carburant.',
  unlocked: 'vos flottes peuvent désormais franchir les trous de ver (sortie découverte au premier passage).',
};

const withSecrets = (game: GameState) => !!game.settings.anomalies && !!game.secrets?.length;

/** 0.3.7: brown dwarfs and the infrared glow of a Dyson swarm. */
export const INFRARED: SpecialTech = {
  id: 'infrared', name: 'Relevé infrarouge profond', field: 'electronics', req: { electronics: 6 }, when: withSecrets,
  what: 'détection des étoiles froides et des sources infrarouges',
  explain: 'Vos colonies scrutent le ciel en infrarouge : chaque année, elles repèrent les naines brunes (trop froides pour briller) à moins de 450 al et les sources infrarouges sans étoile visible à moins de 700 al. Les étoiles ainsi trouvées apparaissent sur la carte, inexplorées.',
  unlocked: 'vos colonies repèrent désormais les naines brunes et les sources infrarouges invisibles jusqu\'ici.',
};

/** 0.3.7: isolated black holes, seen by the light they bend. */
export const LENSING: SpecialTech = {
  id: 'lensing', name: 'Interférométrie gravitationnelle', field: 'electronics', req: { electronics: 14, energy: 8 }, when: withSecrets,
  what: 'détection des trous noirs isolés',
  explain: 'Des réseaux d\'antennes mesurent la lumière des étoiles lointaines déviée par une masse invisible : chaque année, vos colonies repèrent les trous noirs isolés à moins de 600 al. Le Grand Observatoire les voit aussi, jusqu\'à 1 000 al.',
  unlocked: 'vos colonies repèrent désormais les trous noirs isolés par la lumière qu\'ils dévient.',
};

export const SPECIALS: SpecialTech[] = [AUTO_EXPLORE, WORMHOLE_NAV, INFRARED, LENSING];
/** The special technologies of this game. */
export const specialsOf = (game: GameState) => SPECIALS.filter(s => !s.when || s.when(game));

/** Levels actually required in this game (the hidden shift of the tree applies to the main field). */
export function specialReq(p: Player, s: SpecialTech): Partial<Record<Field, number>> {
  const d = s.fuzzy ? p.techShift?.[s.name] ?? 0 : 0;
  if (!d) return s.req;
  return { ...s.req, [s.field]: Math.max(1, Math.min(26, (s.req[s.field] ?? 0) + d)) };
}

export function hasSpecial(p: Player, s: SpecialTech): boolean {
  if (p.freeSpecials?.includes(s.id)) return true;
  return (Object.entries(specialReq(p, s)) as [Field, number][]).every(([f, l]) => p.tech[f] >= l);
}

/**
 * Draws the hidden shift of the special technologies that follow the tree (same odds as a component), once per game,
 * from the seed: games created before 3.3.3 get theirs on their next turn, the same as a new game would have.
 */
export function ensureSpecialShift(game: GameState) {
  if (!game.settings.fuzzyTechTree) return;
  for (const sp of SPECIALS) {
    if (!sp.fuzzy) continue;
    const rng = new Rng(seedFromString(game.settings.seed + '|special|' + sp.id));
    let x = rng.random(), d = 0;
    for (const [sh, w] of SHIFT_WEIGHTS) { if (x < w) { d = sh; break; } x -= w; }
    for (const p of game.players) {
      p.techShift ??= {};
      if (!(sp.name in p.techShift)) p.techShift[sp.name] = d;
    }
  }
}
export function canAutoExplore(p: Player): boolean { return hasSpecial(p, AUTO_EXPLORE); }
export function canUseWormholes(p: Player): boolean { return hasSpecial(p, WORMHOLE_NAV); }

const FIELD_FR: Record<Field, string> = { energy: 'Énergie', weapons: 'Armement', propulsion: 'Propulsion', construction: 'Construction', electronics: 'Électronique', biotechnology: 'Biotechnologie' };
/** "Propulsion 3, Électronique 3" */
export function specialReqText(s: SpecialTech): string {
  return (Object.entries(s.req) as [Field, number][]).map(([f, l]) => `${FIELD_FR[f]} ${l}`).join(', ');
}
/** "Électronique 12" or, when the level varies with the game, "Électronique 10 à 14 selon la partie (12 le plus souvent)". */
export function specialLevelText(game: GameState, s: SpecialTech): string {
  if (!(s.fuzzy && game.settings.fuzzyTechTree)) return specialReqText(s);
  const n = s.req[s.field] ?? 0;
  const others = (Object.entries(s.req) as [Field, number][]).filter(([f]) => f !== s.field).map(([f, l]) => `, avec ${FIELD_FR[f]} ${l}`).join('');
  return `${FIELD_FR[s.field]} ${Math.max(1, n - 2)} à ${Math.min(26, n + 2)} selon la partie (${n} le plus souvent)${others}`;
}
