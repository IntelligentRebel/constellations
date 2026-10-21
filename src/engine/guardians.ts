// Guardians (Constellations 3.2): very strong, immobile fleets watching over rich worlds far from the homeworlds.
// They attack anything that stops at their planet, mend 40 % of their damage every year, and never come back once
// destroyed. Beating one pays: research, the minerals piled up on its planet, sometimes a relic.
// Technically they belong to a pseudo-player, "the Guardians", marked dead so that it never plays, researches,
// scores or wins; every empire is its enemy.
import { shareOf } from './words';
import type { BattlePlan, Fleet, GameState, Guardian, Planet, Player, ShipDesign } from './types';
import { FIELDS } from './types';
import { Rng, seedFromString } from './rng';
import { autoDesign, type Purpose } from './design';
import { fleetSpec, distance, emptyCargo } from './fleet';
import { researchCost } from './research';
import { researchStory } from './tales';
import { FIELD_NAMES } from './tech';
import { giveRelic, missingRelic, RELICS } from './relics';
import { PREDEFINED_RACES } from './race';
import { addChronicle } from './chronicle';

export interface GuardianKind { id: string; name: string; tier: 1 | 2 | 3; hull: string; purpose: Purpose; qty: number; tech: number; text: string; unique?: boolean; /** French article and gender, for the messages */ art: 'le ' | 'la ' | 'l\''; fem?: boolean }

export const GUARDIAN_KINDS: Record<string, GuardianKind> = {
  sentinel: { art: 'la ', fem: true, id: 'sentinel', name: 'Sentinelle cristalline', tier: 1, hull: 'Cruiser', purpose: 'beamWarship', qty: 2, tech: 9, text: 'Une structure de cristal vivant, plantée en orbite depuis des millénaires. Elle tire sur tout ce qui s\'arrête près d\'elle.' },
  swarm: { art: 'l\'', id: 'swarm', name: 'Essaim dormant', tier: 1, hull: 'Frigate', purpose: 'torpedoWarship', qty: 7, tech: 8, text: 'Des centaines de petites coques endormies dans les anneaux de la planète. Elles se réveillent ensemble.' },
  dreadnought: { art: 'le ', id: 'dreadnought', name: 'Cuirassé fantôme', tier: 2, hull: 'Battleship', purpose: 'beamWarship', qty: 2, tech: 14, text: 'Le dernier navire d\'une flotte disparue. Son équipage est mort depuis longtemps ; ses canons, non.' },
  hive: { art: 'la ', fem: true, id: 'hive', name: 'Ruche du vide', tier: 2, hull: 'Destroyer', purpose: 'torpedoWarship', qty: 16, tech: 13, text: 'Une colonie d\'organismes spatiaux qui défend son nid avec une rage aveugle.' },
  leviathan: { art: 'le ', id: 'leviathan', name: 'Léviathan', tier: 3, hull: 'Battleship', purpose: 'beamWarship', qty: 5, tech: 19, text: 'Une créature de la taille d\'une lune, endormie au-dessus d\'un monde qu\'elle considère comme le sien.' },
  warden: { art: 'le ', id: 'warden', name: 'Colosse primordial', tier: 3, hull: 'Battleship', purpose: 'beamWarship', qty: 6, tech: 20, unique: true, text: 'Une machine de guerre d\'un autre âge, la plus puissante jamais observée. Personne ne sait ce qu\'elle protège.' },
  // 0.3.7: the guardians of the hidden stars (never placed at random)
  shepherd: { art: 'le ', id: 'shepherd', name: 'Berger de poussière', tier: 2, hull: 'Cruiser', purpose: 'beamWarship', qty: 4, tech: 14, unique: true, text: 'Une créature diffuse, faite de poussière et de champs magnétiques, qui rassemble le nuage autour de l\'étoile voilée comme un troupeau et le défend.' },
  mind: { art: 'l\'', id: 'mind', name: 'Esprit de l\'essaim', tier: 3, hull: 'Battleship', purpose: 'beamWarship', qty: 4, tech: 19, unique: true, text: 'La conscience répartie dans les milliards de collecteurs qui enferment l\'étoile. Elle ne tolère aucun intrus.' },
  dragon: { art: 'le ', id: 'dragon', name: 'Wyrm de l\'amas', tier: 3, hull: 'Battleship', purpose: 'beamWarship', qty: 5, tech: 20, unique: true, text: 'Un prédateur colossal, seul dans l\'amas depuis des millénaires, couché sur un monde jonché de minerais.' },
  nest: { art: 'le ', id: 'nest', name: 'Nid de la nuée', tier: 2, hull: 'Destroyer', purpose: 'torpedoWarship', qty: 14, tech: 13, unique: true, text: 'Une ruche-mère qui produit sans fin des chasseurs. Tant qu\'elle vit, des nuées sortent de l\'amas par le trou de ver.' },
  raider: { art: 'la ', fem: true, id: 'raider', name: 'Nuée de l\'amas', tier: 1, hull: 'Destroyer', purpose: 'torpedoWarship', qty: 6, tech: 12, unique: true, text: 'Des chasseurs sortis du Nid de la nuée, lancés contre les mondes les plus proches du trou de ver.' },
};

export const guardiansOn = (game: GameState) => !!game.settings.guardians;
/** "la Sentinelle cristalline", "l'Essaim dormant" (capitalised at the start of a sentence). */
export function theGuardian(kindId: string | undefined, cap = false): string {
  const k = kindId ? GUARDIAN_KINDS[kindId] : undefined;
  if (!k) return cap ? 'Un gardien' : 'un gardien';
  // whole phrases (each language puts its own article)
  if (k.art === 'la ') return cap ? `La ${k.name}` : `la ${k.name}`;
  if (k.art === 'le ') return cap ? `Le ${k.name}` : `le ${k.name}`;
  return cap ? `L'${k.name}` : `l'${k.name}`;
}
const destroyed = (kindId: string) => GUARDIAN_KINDS[kindId]?.fem ? 'détruite' : 'détruit';
export const monster = (game: GameState): Player | undefined => game.monsterId !== undefined ? game.players[game.monsterId] : undefined;
export const isMonster = (game: GameState, owner: number) => game.monsterId !== undefined && owner === game.monsterId;
export const kindOfFleet = (f: Fleet): GuardianKind | undefined => f.purpose?.startsWith('guardian:') ? GUARDIAN_KINDS[f.purpose.slice(9)] : undefined;

/** The guardian watching over a planet (alive), if any. */
export function guardianAt(game: GameState, planetId: number): Guardian | undefined {
  return game.guardians?.find(g => g.alive && g.planetId === planetId && game.fleets.some(f => f.id === g.fleetId));
}

/** The pseudo-player of the guardians (created once). */
export function ensureMonster(game: GameState): Player {
  const m = monster(game);
  if (m) return m;
  const id = game.players.length;
  const race = { ...PREDEFINED_RACES.Humanoid(), name: 'Gardien', pluralName: 'Gardiens', prt: 'JoaT' as const, lrts: [] };
  const plan: BattlePlan = { id: 0, name: 'Gardien', primary: 'armed', secondary: 'any', tactic: 'maximizeDamage', attackWho: 'everyone', dumpCargo: false, retreatAt: 0 };
  const p: Player = {
    id, name: 'Gardiens', race, color: '#c78bff', ai: 'standard', monster: true, dead: true,
    tech: { energy: 26, weapons: 26, propulsion: 26, construction: 26, electronics: 26, biotechnology: 26 },
    researchSpent: { energy: 0, weapons: 0, propulsion: 0, construction: 0, electronics: 0, biotechnology: 0 },
    researching: 'energy', nextField: 'same', researchPct: 0, researchLastYear: 0,
    relations: [], battlePlans: [plan], templates: [], defaultTemplate: -1, acquiredTechs: [], fleetNum: 0,
    intel: { planets: game.planets.map(pl => ({ id: pl.id })), fleets: [], tracks: {}, designs: {}, met: [], wormholes: {}, minefields: {}, packets: [], salvage: [], traders: [] },
    messages: [], scores: [], stats: { shipsBuilt: 0, shipsLost: 0, shipsDestroyed: 0, planetsColonized: 0 }, traderRewards: [], victoryMet: 0,
  };
  game.players.push(p);
  // monsters leave each other alone (3.4: the pirates, the crisis)
  for (const o of game.players) o.relations[id] = o.id === id || o.monster ? 'friend' : 'enemy';
  p.relations = game.players.map(o => o.id === id || o.monster ? 'friend' : 'enemy');
  game.monsterId = id;
  return p;
}

/** A design at a given technology level (built for a throwaway copy of the owner with those levels). */
export function designAtTech(owner: Player, tech: number, hull: string, purpose: Purpose, name: string): ShipDesign | null {
  const fake: Player = { ...owner, tech: { energy: tech, weapons: tech, propulsion: tech, construction: tech, electronics: tech, biotechnology: tech }, techShift: undefined, acquiredTechs: [] };
  const d = autoDesign(fake, hull, purpose, name);
  if (d) d.owner = owner.id;
  return d;
}

/** Puts a guardian of this kind on the planet (its fleet and its record). */
export function spawnGuardian(game: GameState, planet: Planet, kindId: string): Guardian | null {
  const kind = GUARDIAN_KINDS[kindId];
  if (!kind) return null;
  const m = ensureMonster(game);
  let d = game.designs.find(x => x.owner === m.id && x.purpose === 'guardian:' + kind.id);
  if (!d) {
    const nd = designAtTech(m, kind.tech, kind.hull, kind.purpose, kind.name);
    if (!nd) return null;
    nd.purpose = 'guardian:' + kind.id; nd.alien = true; nd.id = game.nextId++;
    game.designs.push(nd);
    d = nd;
  }
  m.fleetNum++;
  const f: Fleet = {
    id: game.nextId++, owner: m.id, num: m.fleetNum, name: kind.name, customName: true, x: planet.x, y: planet.y, orbiting: planet.id,
    tokens: [{ designId: d.id, qty: kind.qty, damage: 0, qtyDamaged: 0 }], cargo: emptyCargo(), fuel: 0,
    waypoints: [{ x: planet.x, y: planet.y, target: 'planet', targetId: planet.id, warp: 0, task: 'none' }],
    repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0, purpose: 'guardian:' + kind.id,
  };
  game.fleets.push(f);
  const g: Guardian = { id: game.nextId++, planetId: planet.id, kind: kind.id, tier: kind.tier, fleetId: f.id, alive: true };
  (game.guardians ??= []).push(g);
  return g;
}

/** How many guardians of each tier, by size of galaxy. */
const TIERS: Record<string, [number, number, number]> = { Tiny: [1, 0, 0], Small: [2, 1, 0], Medium: [2, 2, 1], Large: [3, 2, 2], Huge: [3, 3, 3] };

/** Places the guardians at the start of the game, on rich worlds far from every homeworld (own random stream). */
export function placeGuardians(game: GameState) {
  const rng = new Rng(seedFromString(game.settings.seed + '|guard'));
  const homes = game.planets.filter(p => p.owner >= 0);
  const W = game.width;
  const homeDist = (p: Planet) => Math.min(...homes.map(h => distance(h, p)));
  const taken: Planet[] = [];
  const counts = TIERS[game.settings.size] ?? [2, 1, 0];
  const min = [0, 0.2, 0.28, 0.36];
  const pickFor = (tier: 1 | 2 | 3): Planet | null => {
    const cands = game.planets.filter(p => p.owner < 0 && homeDist(p) >= W * min[tier] && taken.every(t => distance(t, p) >= W * 0.1));
    if (!cands.length) return null;
    // richest worlds first, a little chance in the order
    const score = (p: Planet) => (p.conc.ironium + p.conc.boranium + p.conc.germanium) * (0.75 + rng.random() * 0.5);
    return cands.map(p => ({ p, s: score(p) })).sort((a, b) => b.s - a.s)[Math.min(cands.length - 1, rng.int(3))].p;
  };
  // the Ancients' vault has its own guardian
  const vault = game.anomalies?.find(a => a.kind === 'vault');
  if (vault && vault.doneBy === undefined && !game.guardians?.some(g => g.kind === 'warden')) { const pl = game.planets[vault.planetId]; taken.push(pl); hoard(pl, 3); spawnGuardian(game, pl, 'warden'); }
  const kinds = { 1: ['sentinel', 'swarm'], 2: ['dreadnought', 'hive'], 3: ['leviathan'] } as Record<number, string[]>;
  for (const tier of [3, 2, 1] as const) {
    for (let i = 0; i < counts[tier - 1]; i++) {
      const pl = pickFor(tier);
      if (!pl) continue;
      taken.push(pl);
      hoard(pl, tier);
      spawnGuardian(game, pl, kinds[tier][i % kinds[tier].length]);
    }
  }
}

/** What a guardian keeps on its world: richer veins and minerals piled up on the surface. */
export function hoard(pl: Planet, tier: number) {
  for (const k of ['ironium', 'boranium', 'germanium'] as const) {
    pl.conc[k] = Math.min(150, pl.conc[k] + 20 + 10 * tier);
    pl.surface[k] += 400 * tier;
  }
}

/** Yearly: guardians mend 40 % of their damage. */
export function regenGuardians(game: GameState) {
  for (const f of game.fleets) {
    if (!isMonster(game, f.owner)) continue;
    for (const t of f.tokens) { t.damage = Math.floor(t.damage * 0.6); if (t.damage <= 0) { t.damage = 0; t.qtyDamaged = 0; } }
  }
}

/** After the battles: guardians destroyed this year reward the empires that fought them. */
export function checkGuardians(game: GameState, rng: Rng) {
  for (const g of game.guardians ?? []) {
    if (!g.alive || game.fleets.some(f => f.id === g.fleetId)) continue;
    g.alive = false; g.killedYear = game.year;
    const pl = game.planets[g.planetId];
    const kind = GUARDIAN_KINDS[g.kind];
    const battle = game.battles.find(b => b.planetId === pl.id || (Math.round(b.x) === pl.x && Math.round(b.y) === pl.y));
    const winners = (battle?.players ?? []).filter(id => !isMonster(game, id) && !game.players[id].dead);
    // the empire left with the most ships on the spot holds the field
    const held = winners.map(id => ({ id, n: game.fleets.filter(f => f.owner === id && f.x === pl.x && f.y === pl.y).reduce((a, f) => a + f.tokens.reduce((s, t) => s + t.qty, 0), 0) })).sort((a, b) => b.n - a.n || a.id - b.id);
    if (held.length) g.killedBy = held[0].id;
    if (held.length) addChronicle(game, 'guardian', `Les ${game.players[held[0].id].name} abattent le gardien de ${pl.name} (${kind.name}).`, [held[0].id], pl);
    for (const id of winners) {
      const p = game.players[id];
      const field = FIELDS[rng.int(FIELDS.length)];
      const pts = Math.round(researchCost(game, p, field) * (0.3 + 0.3 * g.tier));
      const story = researchStory(game, p, field, pts, 'guardian', rng);
      p.finds = { anomalies: 0, chapters: 0, guardians: 0, ...p.finds }; p.finds.guardians++;
      // (0.3.9.21: what really lies on the surface: the hoard told was not always there, nor of that size)
      const kt = Math.min(pl.surface.ironium, pl.surface.boranium, pl.surface.germanium);
      let text = `${theGuardian(g.kind, true)} de ${pl.name} est ${destroyed(g.kind)}. Vos équipes fouillent ses restes : ${story}.${kt >= 100 ? ` ${kind.fem ? 'Elle' : 'Il'} gardait au moins ${Math.round(kt)} kt de chaque minerai, restés à la surface.` : ''}`;
      if (id === g.killedBy) {
        const chance = [0, 0.2, 0.5, 1][g.tier];
        const relic = rng.chance(chance) ? missingRelic(p, rng.int(100), g.kind === 'warden' ? [] : ['heart']) : null;
        if (relic && giveRelic(p, relic)) text += ` Dans l'épave, vos équipes trouvent une relique : ${RELICS[relic].name} (${RELICS[relic].effect}).`;
      }
      p.messages.push({ year: game.year, kind: 'event', text, target: { kind: 'planet', id: pl.id } });
    }
    for (const p of game.players) {
      const knew = !!p.intel.planets[pl.id]?.guardian;
      if (p.intel.planets[pl.id]) p.intel.planets[pl.id].guardian = undefined;
      if (p.dead || winners.includes(p.id) || !knew) continue;
      p.messages.push({ year: game.year, kind: 'event', text: `${theGuardian(g.kind, true)} de ${pl.name} a été ${destroyed(g.kind)}${held.length ? ` par les ${game.players[held[0].id].name}` : ''}.`, target: { kind: 'planet', id: pl.id } });
    }
  }
}

/** Rough strength of a guardian (armor × firepower, as the AI counts it). */
export function guardianStrength(game: GameState, g: Guardian): number {
  const f = game.fleets.find(x => x.id === g.fleetId);
  if (!f) return 0;
  const sp = fleetSpec(game, f);
  const dmg = f.tokens.reduce((a, t) => a + t.damage * t.qtyDamaged, 0);
  return Math.max(1, sp.armor + sp.shields - dmg) * Math.max(1, sp.powerRating);
}

/**
 * 3.6: a fleet that met a guardian (in orbit of its world, attacked or not) brings back an assessment: how our navy
 * compares with it. Once per guardian and year.
 */
/** A player's navy: all the warships together (armor and shields × firepower), and the strongest fleet. */
export function navyOf(game: GameState, pid: number): { navy: number; best: number; bestName: string } {
  let hp = 0, pow = 0, best = 0, bestName = '';
  for (const f of game.fleets) {
    if (f.owner !== pid || !f.tokens.length) continue;
    const sp = fleetSpec(game, f);
    if (!sp.hasWeapons) continue;
    hp += sp.armor + sp.shields; pow += sp.powerRating;
    const st = Math.max(1, sp.armor + sp.shields) * Math.max(1, sp.powerRating);
    if (st > best) { best = st; bestName = f.name; }
  }
  return { navy: hp * pow, best, bestName };
}

export function guardianAssessments(game: GameState) {
  if (!game.guardians?.length || game.monsterId === undefined) return;
  for (const g of game.guardians) {
    if (!g.alive) continue;
    const gf = game.fleets.find(x => x.id === g.fleetId);
    if (!gf) continue;
    const theirs = guardianStrength(game, g);
    for (const p of game.players) {
      if (p.dead || p.ai || p.monster) continue;
      // our fleets there now, or in a battle there this year
      const there = game.fleets.filter(f => f.owner === p.id && Math.abs(f.x - gf.x) < 0.5 && Math.abs(f.y - gf.y) < 0.5);
      const fought = game.battles.find(b => b.players.includes(p.id) && b.players.includes(game.monsterId!) && Math.abs(b.x - gf.x) < 0.5 && Math.abs(b.y - gf.y) < 0.5);
      const witness = there[0]?.name ?? (fought ? fought.tokens.find(t => t.owner === p.id && t.fleetId >= 0)?.designName : undefined);
      if (!witness) continue;
      p.intel.warned ??= {};
      const key = `assess${g.id}`;
      if (p.intel.warned[key] === game.year) continue;
      p.intel.warned[key] = game.year;
      // our navy as a whole, and our strongest fleet
      const { navy, best, bestName } = navyOf(game, p.id);
      // 0.3.9.7: kept, for the guardian's panel
      (p.intel.guardianReports ??= {})[g.id] = { year: game.year, witness, strength: theirs, navy, best, bestName };
      // the crew saw it: its world is known to be guarded
      const pi = p.intel.planets[g.planetId];
      if (pi) { pi.guardian = g.kind; pi.guardianYear = game.year; }
      const word = (r: number) => r <= 0 ? 'infiniment moins' : Math.abs(Math.log(r)) < 0.15 ? 'à peu près aussi' : r > 1 ? (r < 2 ? 'un peu plus' : 'beaucoup plus') : (r > 0.5 ? 'un peu moins' : 'beaucoup moins');
      const pl = game.planets[g.planetId];
      p.messages.push({ year: game.year, kind: 'event', text: `D'après l'équipage de ${witness}, votre force de guerre totale est ${word(navy / Math.max(1, theirs))} puissante que ${theGuardian(g.kind)} de ${pl.name}${navy > 0 ? ` (l'ensemble de vos vaisseaux de guerre réunis : ${shareOf(navy / Math.max(1, theirs))} ; votre plus forte flotte, ${bestName} : ${shareOf(best / Math.max(1, theirs))})` : ' (vous n\'avez aucun vaisseau de guerre)'}.`, target: { kind: 'planet', id: pl.id } });
    }
  }
}

/** Warns human players whose fleets head for a world they know is guarded (once per fleet and world). */
export function guardianWarnings(game: GameState) {
  if (!game.guardians?.length && !game.pirates?.emerged && game.crisis?.phase !== 'active') return;
  for (const p of game.players) {
    if (p.dead || p.ai) continue;
    p.intel.warned ??= {};
    for (const f of game.fleets) {
      if (f.owner !== p.id || f.waypoints.length < 2) continue;
      const last = f.waypoints[f.waypoints.length - 1];
      if (last.target !== 'planet' || last.targetId === undefined) continue;
      const kindId = p.intel.planets[last.targetId]?.guardian;
      const lair = p.intel.planets[last.targetId]?.lair;
      if (!kindId && !lair) continue;
      const key = `g${f.id}:${last.targetId}`;
      if (p.intel.warned[key] !== undefined) continue;
      // 3.4: a pirate lair, the Breach
      if (!kindId) {
        const breach = lair === 'crisis';
        // (0.3.9.21: not marked as warned during the omens, or the warning never came once the Nexus is there)
        if (breach && game.crisis?.phase !== 'active') continue;
        p.intel.warned[key] = game.year;
        p.messages.push({ year: game.year, kind: 'warning', text: `${f.name} se dirige vers ${game.planets[last.targetId].name}, ${breach ? 'gardée par le Nexus des Moissonneurs' : 'repaire de pirates'}. Elle sera attaquée dès son arrivée.`, target: { kind: 'fleet', id: f.id } });
        continue;
      }
      const kind = GUARDIAN_KINDS[kindId];
      p.intel.warned[key] = game.year;
      p.messages.push({ year: game.year, kind: 'warning', text: `${f.name} se dirige vers ${game.planets[last.targetId].name}, gardée par ${theGuardian(kindId)} (palier ${kind?.tier ?? '?'}). Elle sera attaquée dès son arrivée.`, target: { kind: 'fleet', id: f.id } });
    }
  }
}

/** Removes every guardian (rule switched off during a game). */
export function removeGuardians(game: GameState) {
  game.fleets = game.fleets.filter(f => !isMonster(game, f.owner));
  for (const g of game.guardians ?? []) g.alive = false;
  for (const p of game.players) for (const pi of p.intel.planets) pi.guardian = undefined;
  for (const p of game.players) p.intel.fleets = p.intel.fleets.filter(fi => !isMonster(game, fi.owner));
}
