// 0.3.9: the secret of the Ancients. Every game draws what the Breach is (a prison, a forbidden experiment, a seed), and
// the empires can find out: clues in the ruins and anomalies they study (one chapter of a dig, often an anomaly, three
// in the Ancients' vault), in the observation of the Breach once it is announced, in the wrecks of the Harvesters.
// Six clues reveal the truth and the way to seal the Breach: the Seal of the Ancients, a work of six years whose place
// depends on what the Breach is. Its completion closes the Breach (or keeps it from ever opening) and wins the game.
import type { GameState, Planet, Player } from './types';
import { Rng, seedFromString } from './rng';
import { distance, fleetSpec } from './fleet';
import { addChronicle } from './chronicle';

export const secretOn = (game: GameState) => !!game.settings.ancientSecret && !!game.settings.crisis;
export const CLUES_NEEDED = 6;
export const SEAL_NEAR = 150;

export type BreachKind = 'prison' | 'experiment' | 'seed';
export const BREACH_KINDS: Record<BreachKind, { name: string; lore: string; where: string }> = {
  prison: {
    name: 'La prison des Anciens',
    lore: 'Les Moissonneurs ne viennent pas d\'ailleurs : les Anciens les avaient vaincus, puis enfermés derrière la Brèche, sous un sceau qui s\'use depuis des millénaires. Ce qui s\'ouvre est une porte de cellule.',
    where: 'Le Sceau se rebâtit sur le monde même de la Brèche, avant qu\'elle ne s\'ouvre : il faut le coloniser pendant les présages.',
  },
  experiment: {
    name: 'L\'expérience interdite',
    lore: 'Les Anciens ont percé eux-mêmes la Brèche, pour atteindre un autre univers. Ce qui en sortit les a balayés. Leur dernier ouvrage, un contre-résonateur, n\'a jamais été achevé.',
    where: `Le Sceau, un contre-résonateur, se bâtit sur n'importe lequel de vos mondes à moins de ${SEAL_NEAR} al de la Brèche, pendant les présages ou une fois la Brèche ouverte.`,
  },
  seed: {
    name: 'La graine',
    lore: 'La Brèche est une graine plantée par une intelligence étrangère, qui pousse vers notre galaxie le long d\'une racine. Les Anciens avaient trouvé l\'ancre de cette racine, sur un autre monde.',
    where: 'Le Sceau se bâtit sur le monde-ancre, que révèle l\'enquête une fois la Brèche annoncée, pendant les présages ou une fois la Brèche ouverte.',
  },
};

/** What the Breach is in this game (drawn once). */
export function breachKind(game: GameState): BreachKind {
  if (!game.breachSecret) {
    const rng = new Rng(seedFromString(game.settings.seed + '|breach-kind'));
    game.breachSecret = { kind: (['prison', 'experiment', 'seed'] as BreachKind[])[rng.int(3)] };
  }
  return game.breachSecret.kind as BreachKind;
}

/** The anchor world of the seed (chosen when the Breach is announced): a free world 120 to 260 ly from it. */
export function anchorOf(game: GameState): Planet | undefined {
  const s = game.breachSecret;
  if (s?.anchor !== undefined) return game.planets[s.anchor];
  if (breachKind(game) !== 'seed' || game.crisis?.planetId === undefined) return undefined;
  const b = game.planets[game.crisis.planetId];
  const rng = new Rng(seedFromString(game.settings.seed + '|anchor'));
  const cands = game.planets.filter(p => !p.hidden && p.id !== b.id && distance(p, b) >= 120 && distance(p, b) <= 260);
  const pick = cands[rng.int(cands.length)];
  if (pick) game.breachSecret!.anchor = pick.id;
  return pick;
}

export const knowsSecret = (p: Player) => p.secretKnown !== undefined;

/** A clue found (anomaly, dig, the Breach, the Harvesters): told, and the truth once there are enough. */
export function addClue(game: GameState, p: Player, from: string) {
  if (!secretOn(game) || p.monster || p.dead || knowsSecret(p)) return;
  p.clues = (p.clues ?? 0) + 1;
  p.clueLog = [...(p.clueLog ?? []), `${game.year} : ${from}`].slice(-12);
  if (p.clues < CLUES_NEEDED) {
    p.messages.push({ year: game.year, kind: 'event', text: `Un indice sur l'origine de la Brèche (${p.clues} sur ${CLUES_NEEDED}) : ${from}.`, target: { kind: 'colonies', id: 0 } });
    return;
  }
  reveal(game, p);
}

function reveal(game: GameState, p: Player) {
  p.secretKnown = game.year;
  const k = BREACH_KINDS[breachKind(game)];
  const anchor = game.crisis && game.crisis.phase !== 'dormant' ? anchorOf(game) : undefined;
  p.messages.unshift({ year: game.year, kind: 'event', text: anchor ? `Le secret des Anciens est percé : ${k.name}. ${k.lore} ${k.where} Le monde-ancre est ${anchor.name}. Achevé, le Sceau des Anciens referme la Brèche et donne la victoire.` : `Le secret des Anciens est percé : ${k.name}. ${k.lore} ${k.where} Achevé, le Sceau des Anciens referme la Brèche et donne la victoire.`, target: anchor ? { kind: 'planet', id: anchor.id } : { kind: 'colonies', id: 0 } });
  addChronicle(game, 'secret', `Les ${p.name} percent le secret des Anciens (${k.name}).`, [p.id]);
}

/** Why the Seal cannot rise on this world (null: it can). */
export function sealBlocker(game: GameState, planet: Planet): string | null {
  if (!secretOn(game)) return 'règle désactivée';
  const p = game.players[planet.owner];
  if (!p || !knowsSecret(p)) return 'il faut d\'abord percer le secret des Anciens';
  const C = game.crisis;
  if (!C || C.phase === 'dormant') return 'la Brèche ne s\'est pas encore annoncée';
  if (C.phase === 'ended') return 'la Brèche est refermée';
  const breach = C.planetId !== undefined ? game.planets[C.planetId] : undefined;
  const kind = breachKind(game);
  if (kind === 'prison') {
    if (C.phase !== 'omen') return 'trop tard : la Brèche est ouverte';
    if (planet.id !== breach?.id) return `seulement sur le monde de la Brèche, ${breach?.name}`;
  } else if (kind === 'experiment') {
    if (!breach || distance(planet, breach) > SEAL_NEAR) return `seulement à moins de ${SEAL_NEAR} al de la Brèche`;
  } else {
    const a = anchorOf(game);
    if (!a || planet.id !== a.id) return `seulement sur le monde-ancre, ${a?.name ?? '?'}`;
  }
  return null;
}

/** The Seal is complete: the Breach closes or never opens; the empire wins. */
export function sealBreach(game: GameState, planet: Planet, p: Player) {
  const C = game.crisis!;
  const wasOpen = C.phase === 'active';
  C.phase = 'ended'; C.endedYear = game.year; C.endedBy = p.id; C.sealed = true;
  for (const f of game.fleets) if (game.players[f.owner]?.faction === 'crisis') f.tokens = [];
  game.fleets = game.fleets.filter(f => f.tokens.length > 0);
  const breach = C.planetId !== undefined ? game.planets[C.planetId] : planet;
  for (const o of game.players) {
    if (o.monster || o.dead) continue;
    const pi = o.intel.planets[breach.id];
    if (pi) pi.lair = undefined;
    const text = o.id === p.id
      ? (wasOpen ? `Victoire ! Le Sceau des Anciens de ${planet.name} est achevé : la Brèche se referme et les Moissonneurs disparaissent.` : `Victoire ! Le Sceau des Anciens de ${planet.name} est achevé : la Brèche ne s'ouvrira jamais.`)
      : (wasOpen ? `Les ${p.name} ont achevé le Sceau des Anciens sur ${planet.name} : la Brèche se referme, et ils remportent la partie. Elle peut continuer.` : `Les ${p.name} ont achevé le Sceau des Anciens sur ${planet.name} : la Brèche ne s'ouvrira jamais, et ils remportent la partie. Elle peut continuer.`);
    o.messages.unshift({ year: game.year, kind: 'victory', text, target: { kind: 'planet', id: planet.id } });
  }
  addChronicle(game, 'crisis', wasOpen ? `Les ${p.name} achèvent le Sceau des Anciens : la Brèche se referme.` : `Les ${p.name} achèvent le Sceau des Anciens : la Brèche ne s'ouvrira jamais.`, [p.id], planet);
  // the heirs of the threshold fulfil their origin when the Breach never opened
  if (game.victor === null) { game.victor = p.id; game.victoryKind = p.origin === 'heirs' && !wasOpen && game.settings.originVictories ? 'origin' : 'seal'; }
}

/** Yearly: observing the announced Breach from close by gives clues (one a year, a ship with a scanner within 40 ly). */
export function runSecret(game: GameState) {
  if (!secretOn(game)) return;
  breachKind(game);
  const C = game.crisis;
  if (!C || (C.phase !== 'omen' && C.phase !== 'active') || C.planetId === undefined) return;
  const b = game.planets[C.planetId];
  if (breachKind(game) === 'seed') anchorOf(game);
  for (const p of game.players) {
    if (p.monster || p.dead || knowsSecret(p)) continue;
    const watcher = game.fleets.find(f => f.owner === p.id && distance(f, b) <= 40 && fleetSpec(game, f).scanRange > 0);
    if (watcher && (p.lastBreachClue ?? 0) < game.year) { p.lastBreachClue = game.year; addClue(game, p, `${watcher.name} a observé la Brèche de ${b.name}`); }
  }
  // the wrecks of the Harvesters speak too (a clue every 12 destroyed)
  for (const p of game.players) {
    if (p.monster || p.dead || knowsSecret(p)) continue;
    const k = p.stats.crisisKills ?? 0, seen = p.crisisKillsSeen ?? 0;
    if (Math.floor(k / 12) > Math.floor(seen / 12)) addClue(game, p, 'les épaves des Moissonneurs abattus');
    p.crisisKillsSeen = k;
  }
  // those who know the secret learn where the anchor is, once the Breach is announced
  const a = breachKind(game) === 'seed' ? anchorOf(game) : undefined;
  if (a) for (const p of game.players) if (knowsSecret(p) && !(p.anchorTold)) { p.anchorTold = true; p.messages.push({ year: game.year, kind: 'event', text: `La Brèche s'est annoncée : la racine de la graine plonge vers ${a.name}. C'est là que le Sceau des Anciens doit s'élever.`, target: { kind: 'planet', id: a.id } }); }
}
