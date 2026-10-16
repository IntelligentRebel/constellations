// Megaprojects (Constellations 3): very long constructions with a lasting effect. The Portail de l'Ascension
// wins the game when it is completed, and the whole galaxy follows its progress: every rival knows where it
// stands and has a few years to take it or burn it.
import { people } from './words';
import type { Cost, Field, GameState, Planet, Player } from './types';
import { revealPlanet } from './scan';
import { addChronicle } from './chronicle';
import { actOf } from './acts';
import { secretOn, sealBlocker, sealBreach } from './ancients';

export type MegaId = 'observatory' | 'shipyard' | 'shield' | 'portal' | 'relay' | 'seal';

export interface MegaInfo {
  id: MegaId;
  name: string;
  effect: string;
  cost: Cost;
  /** the construction cannot go faster: at most cost / minYears is spent per year */
  minYears: number;
  req: Partial<Record<Field, number>>;
  minPop: number;
  victory?: boolean;
}

export const MEGAPROJECTS: MegaInfo[] = [
  {
    id: 'observatory', name: 'Grand Observatoire', minYears: 5, minPop: 50_000, req: { electronics: 9 },
    effect: 'Cette planète voit à 650 al et perce les camouflages et les planètes jusqu\'à 325 al.',
    cost: { resources: 3500, ironium: 200, boranium: 200, germanium: 1000 },
  },
  {
    id: 'shipyard', name: 'Chantier stellaire', minYears: 6, minPop: 100_000, req: { construction: 10 },
    effect: 'Les vaisseaux construits ici coûtent 20 % de ressources en moins et la station n\'a plus de limite de masse.',
    cost: { resources: 4500, ironium: 1500, boranium: 500, germanium: 500 },
  },
  {
    id: 'shield', name: 'Bouclier planétaire', minYears: 5, minPop: 50_000, req: { energy: 10 },
    effect: 'Sur cette planète, les bombardements tuent 75 % de colons en moins et les défenseurs comptent double contre les invasions.',
    cost: { resources: 4000, ironium: 800, boranium: 800, germanium: 800 },
  },
  {
    // 0.3.9 (rule portalRelays): three on three different worlds before the Portal can rise, and while it does
    id: 'relay', name: 'Relais de l\'Ascension', minYears: 4, minPop: 30_000,
    req: { energy: 11, electronics: 11 },
    effect: 'Il en faut trois, sur trois mondes différents, pour bâtir le Portail de l\'Ascension et pour que son chantier avance. Toute la galaxie apprend où chacun s\'élève.',
    cost: { resources: 3000, ironium: 300, boranium: 300, germanium: 900 },
  },
  {
    // 0.3.9 (rule ancientSecret): only for an empire that found the secret; its place depends on what the Breach is
    id: 'seal', name: 'Sceau des Anciens', minYears: 6, minPop: 20_000, victory: true, req: {},
    effect: 'Achevé, il referme la Brèche (ou l\'empêche de s\'ouvrir) et donne la victoire. Toute la galaxie suit son avancement.',
    cost: { resources: 12000, ironium: 1500, boranium: 1500, germanium: 3000 },
  },
  {
    id: 'portal', name: 'Portail de l\'Ascension', minYears: 12, minPop: 150_000, victory: true,
    req: { energy: 12, propulsion: 12, construction: 12, electronics: 12 },
    effect: 'Achevé, il donne la victoire. Toute la galaxie est prévenue de son avancement (10, 25, 50, 75 et 90 %).',
    cost: { resources: 25000, ironium: 3000, boranium: 3000, germanium: 5000 },
  },
];

export const MEGA = Object.fromEntries(MEGAPROJECTS.map(m => [m.id, m])) as Record<MegaId, MegaInfo>;

/** Like technologies, a megaproject can only be imagined once every field it needs is within reach. */
export const MEGA_HORIZON = 5;
export function megaVisible(player: Player, m: MegaInfo): boolean {
  return (Object.keys(m.req) as Field[]).every(f => player.tech[f] >= (m.req[f] ?? 0) - MEGA_HORIZON);
}
export const megaOn = (game: GameState) => !!game.settings.megaprojects;
export const relaysOn = (game: GameState) => megaOn(game) && !!game.settings.portalRelays;
/** The megaprojects of this game (the relays only with their rule). */
export const megaList = (game: GameState) => MEGAPROJECTS.filter(m => (m.id !== 'relay' || relaysOn(game)) && (m.id !== 'seal' || secretOn(game)));
/** Relays of the Ascension an empire holds. */
export const relaysOf = (game: GameState, owner: number) => game.planets.filter(p => p.owner === owner && hasMega(p, 'relay'));
export const RELAYS_NEEDED = 3;
export const hasMega = (planet: Planet, id: MegaId) => !!planet.megaprojects?.includes(id);

/** Observatory scanner of a planet (null if none). */
export function megaScanner(game: GameState, planet: Planet): { range: number; pen: number } | null {
  return hasMega(planet, 'observatory') ? { range: 650, pen: 325 } : null;
}

/** Yearly spending cap of a megaproject. */
export function megaYearCap(m: MegaInfo): Cost {
  const c = m.cost, y = m.minYears;
  return { resources: Math.ceil(c.resources / y), ironium: Math.ceil(c.ironium / y), boranium: Math.ceil(c.boranium / y), germanium: Math.ceil(c.germanium / y) };
}

export function megaProgress(item: { allocated: Cost; megaId?: string }): number {
  const m = MEGA[item.megaId as MegaId];
  if (!m) return 0;
  const keys = ['resources', 'ironium', 'boranium', 'germanium'] as const;
  let paid = 0, total = 0;
  for (const k of keys) { paid += Math.min(item.allocated[k], m.cost[k]); total += m.cost[k]; }
  return total ? paid / total : 0;
}

export function techMissing(player: Player, m: MegaInfo): string | null {
  const names: Record<Field, string> = { energy: 'Énergie', weapons: 'Armes', propulsion: 'Propulsion', construction: 'Construction', electronics: 'Électronique', biotechnology: 'Biotechnologie' };
  const miss = (Object.keys(m.req) as Field[]).filter(f => player.tech[f] < (m.req[f] ?? 0));
  return miss.length ? miss.map(f => `${names[f]} ${m.req[f]}`).join(', ') : null;
}

/** Why this megaproject cannot be started on this planet (null = it can). */
export function megaBlocker(game: GameState, planet: Planet, id: MegaId, ignoreQueue = false): string | null {
  if (!megaOn(game)) return 'règle désactivée';
  const m = MEGA[id];
  if (!m || planet.owner < 0) return 'impossible';
  if (id === 'relay' && !relaysOn(game)) return 'règle désactivée';
  if (id === 'seal') {
    const why = sealBlocker(game, planet);
    if (why) return why;
    if (game.victor !== null) return 'la partie est déjà gagnée';
    if (planet.pop < m.minPop) return `il faut ${people(game, m.minPop)} habitants`;
    if (!ignoreQueue && game.planets.some(p => p.owner === planet.owner && p.queue.some(q => q.kind === 'mega' && q.megaId === 'seal'))) return 'déjà en chantier';
    return null;
  }
  const player = game.players[planet.owner];
  if (!megaVisible(player, m)) return 'inconnu de vos scientifiques';
  const miss = techMissing(player, m);
  if (miss) return `technologie : ${miss}`;
  if (planet.pop < m.minPop) return `il faut ${people(game, m.minPop)} habitants`;
  if (hasMega(planet, id)) return 'déjà construit ici';
  // 0.3.9: the acts hold the great works back
  const act = actOf(game);
  if (act < 2) return 'aucun mégaprojet pendant l\'acte I';
  if (m.victory && act < 3) return 'le Portail attend l\'acte III';
  if (m.victory && game.victor !== null) return 'la partie est déjà gagnée';
  for (const p of game.planets) {
    if (p.owner !== player.id) continue;
    // relays: one per world, as many worlds as one likes
    if (id === 'relay') { if (p === planet && !ignoreQueue && p.queue.some(q => q.kind === 'mega' && q.megaId === id)) return 'déjà dans la file'; continue; }
    if (p !== planet && hasMega(p, id)) return `déjà construit sur ${p.name}`;
    if (!ignoreQueue && p.queue.some(q => q.kind === 'mega' && q.megaId === id)) return p === planet ? 'déjà dans la file' : `déjà en chantier sur ${p.name}`;
  }
  if (m.victory && relaysOn(game) && !ignoreQueue) {
    const n = relaysOf(game, player.id).length;
    if (n < RELAYS_NEEDED) return `il faut ${RELAYS_NEEDED} relais de l'Ascension sur trois mondes (vous en avez ${n})`;
  }
  return null;
}

/** A megaproject is finished (called by the production phase). */
export function megaCompleted(game: GameState, planet: Planet, player: Player, id: MegaId) {
  const m = MEGA[id];
  if (!m) return;
  if (id === 'seal') { sealBreach(game, planet, player); return; }
  if (m.victory) {
    if (game.victor === null) {
      game.victor = player.id;
      game.victoryKind = 'megaproject';
      addChronicle(game, 'victory', `Les ${player.name} achèvent le ${m.name} sur ${planet.name} et remportent la partie.`, [player.id], planet);
      for (const p of game.players) p.messages.unshift({ year: game.year, kind: 'victory', text: p.id === player.id ? `Victoire ! Le ${m.name} de ${planet.name} est achevé : les ${player.name} entrent dans l'histoire.` : `Les ${player.name} ont achevé le ${m.name} sur ${planet.name} : ils remportent la partie. Elle peut continuer.`, target: { kind: 'score', id: 0 } });
    }
    return;
  }
  planet.megaprojects = [...(planet.megaprojects ?? []), id];
  if (id === 'relay') { relayNews(game, planet, player); return; }
  addChronicle(game, 'mega', `Les ${player.name} achèvent le ${m.name} sur ${planet.name}.`, [player.id], planet);
  player.messages.push({ year: game.year, kind: 'production', text: `${planet.name} : ${m.name} achevé. ${m.effect}`, target: { kind: 'planet', id: planet.id } });
}

/** 0.3.9: a relay of the Ascension stands: everybody learns where (the builder's rivals will want it). */
function relayNews(game: GameState, planet: Planet, player: Player) {
  const n = relaysOf(game, player.id).length;
  addChronicle(game, 'mega', `Les ${player.name} bâtissent un relais de l'Ascension sur ${planet.name} (${n} sur ${RELAYS_NEEDED}).`, [player.id], planet);
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    if (p.id === player.id) {
      p.messages.push({ year: game.year, kind: 'production', text: n >= RELAYS_NEEDED ? `${planet.name} : relais de l'Ascension achevé (${n} sur ${RELAYS_NEEDED}). Le Portail de l'Ascension peut être bâti ; toute la galaxie sait où sont vos relais : défendez-les, en perdre un met le chantier en pause.` : `${planet.name} : relais de l'Ascension achevé (${n} sur ${RELAYS_NEEDED}). Toute la galaxie sait où il se dresse.`, target: { kind: 'planet', id: planet.id } });
      continue;
    }
    revealPlanet(game, p, planet, true);
    if (!p.intel.met.includes(player.id)) p.intel.met.push(player.id);
    p.messages.push({ year: game.year, kind: 'warning', text: n >= RELAYS_NEEDED ? `Les ${player.name} ont achevé leur troisième relais de l'Ascension, sur ${planet.name} : ils peuvent bâtir le Portail. Prendre ou dévaster un de leurs relais arrêtera son chantier.` : `Les ${player.name} ont bâti un relais de l'Ascension sur ${planet.name} (${n} sur ${RELAYS_NEEDED} avant de pouvoir bâtir le Portail).`, target: { kind: 'planet', id: planet.id } });
  }
}

/** The Portal under construction is paused while its builder holds fewer than three relays. */
export function portalPaused(game: GameState, owner: number): boolean {
  return relaysOn(game) && relaysOf(game, owner).length < RELAYS_NEEDED;
}

const STEPS = [10, 25, 50, 75, 90];

/** News of the Portail: every empire learns where it is built and how far along it is. */
export function megaNews(game: GameState) {
  if (!megaOn(game)) return;
  for (const planet of game.planets) {
    if (planet.owner < 0) continue;
    for (const item of planet.queue) {
      if (item.kind !== 'mega') continue;
      const m = MEGA[item.megaId as MegaId];
      if (!m?.victory) continue;
      const pct = Math.floor(megaProgress(item) * 100);
      const step = [...STEPS].reverse().find(s => pct >= s);
      if (!step || step <= (item.announced ?? 0)) continue;
      item.announced = step;
      const builder = game.players[planet.owner];
      const years = Math.ceil((1 - pct / 100) * m.minYears);
      for (const p of game.players) {
        if (p.dead) continue;
        if (p.id === builder.id) {
          p.messages.push({ year: game.year, kind: 'warning', text: `${m.name} de ${planet.name} : ${step} %. Toute la galaxie le sait : défendez la planète (achèvement dans ${years} an${years > 1 ? 's' : ''} au mieux).`, target: { kind: 'planet', id: planet.id } });
          continue;
        }
        revealPlanet(game, p, planet, true);
        if (!p.intel.met.includes(builder.id)) p.intel.met.push(builder.id);
        p.messages.push({ year: game.year, kind: 'warning', text: `Les ${builder.name} construisent le ${m.name} sur ${planet.name} : ${step} %. S'il est achevé (dans ${years} an${years > 1 ? 's' : ''} au mieux), ils gagnent la partie.`, target: { kind: 'planet', id: planet.id } });
      }
    }
  }
}

/** The Portail under construction (most advanced), if any: AIs react to it. */
export function portalThreat(game: GameState): { planet: Planet; owner: number; progress: number; announced: number } | null {
  let best: { planet: Planet; owner: number; progress: number; announced: number } | null = null;
  for (const planet of game.planets) {
    if (planet.owner < 0) continue;
    for (const item of planet.queue) {
      if (item.kind !== 'mega' || item.megaId !== 'portal' || !(item.announced ?? 0)) continue;
      const progress = megaProgress(item);
      if (!best || progress > best.progress) best = { planet, owner: planet.owner, progress, announced: item.announced ?? 0 };
    }
  }
  return best;
}
