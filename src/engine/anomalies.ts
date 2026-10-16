// Discoveries (Constellations 3.2): anomalies, archaeological sites and the Ancients' vault.
// An anomaly is found when a planet is analysed (orbit or penetrating scan). It is studied by ships carrying a
// scanner that stay in orbit (or by your colony, if the world is yours); the first empire to finish gets the
// result. Some results are a choice. Archaeological sites are read chapter by chapter and end with a relic.
// Fragments of an old map, scattered across the galaxy, lead to the Ancients' vault and its relic.
import { people } from './words';
import type { Anomaly, Decision, Field, Fleet, GameState, Hab, Planet, Player } from './types';
import { FIELDS, MINERALS } from './types';
import { Rng, seedFromString } from './rng';
import { fleetSpec, distance, emptyCargo } from './fleet';
import { revealPlanet } from './scan';
import { addResearch, researchCost } from './research';
import { FIELD_NAMES } from './tech';
import { RELICS, giveRelic, missingRelic, type RelicId } from './relics';
import { researchStory } from './tales';
import { raceSpec, habitability } from './race';
import { safeGoto, decentLeg } from './ai';
import { designAtTech, guardianAt, guardiansOn, spawnGuardian, theGuardian, hoard } from './guardians';
import { followClue, ancientsMap, joinEnclave } from './secrets';
import { addClue } from './ancients';

export const anomaliesOn = (game: GameState) => !!game.settings.anomalies;
/** Study points needed by difficulty (1..5). */
export const STUDY_NEED = [0, 4, 8, 13, 19, 26];

interface Ctx { game: GameState; p: Player; planet: Planet; a: Anomaly; fleet?: Fleet; rng: Rng }
interface Choice { label: string; hint: string; apply: (c: Ctx) => string }
export interface AnomalyDef {
  id: string; name: string; text: string;
  levels: [number, number]; weight: number;
  /** an archaeological site: its chapters, and the relic at the end (none: a last big reward instead) */
  site?: { chapters: number; relic?: RelicId; chapters_: string[] };
  apply?: (c: Ctx) => string;
  choice?: { a: Choice; b: Choice; ai: (c: Ctx) => 'a' | 'b' };
}

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const pickField = (c: Ctx, from: Field[] = FIELDS) => from[c.rng.int(from.length)];

/**
 * Research worth a share of the next level of a field, told as what was studied and what it led to
 * ("les mémoires de la sonde ... (+240 points de recherche en Électronique)").
 */
function research(c: Ctx, share: number, field = pickField(c)): string {
  return researchStory(c.game, c.p, field, Math.max(10, Math.round(researchCost(c.game, c.p, field) * share)), c.a.kind, c.rng);
}

const cap1 = (t: string) => t ? t[0].toUpperCase() + t.slice(1) : t;
function minerals(planet: Planet, kt: number): string {
  for (const m of MINERALS) planet.surface[m] += kt;
  return `${fmt(kt)} kt de chaque minerai déposés à la surface de ${planet.name}`;
}
function veins(planet: Planet, amount: number, rng: Rng): string {
  const m = MINERALS[rng.int(3)];
  planet.conc[m] = Math.min(160, planet.conc[m] + amount);
  const label = { ironium: 'ironium', boranium: 'boranium', germanium: 'germanium' }[m];
  return `la concentration en ${label} de ${planet.name} monte à ${planet.conc[m]}`;
}
function revealAround(c: Ctx, r: number): string {
  let n = 0;
  for (const pl of c.game.planets) if (distance(pl, c.planet) <= r && pl.owner !== c.p.id && !c.p.intel.planets[pl.id].explored) { revealPlanet(c.game, c.p, pl, false); n++; }
  let w = 0;
  for (const wh of c.game.wormholes) {
    if (distance(wh, c.planet) > r) continue;
    const dest = c.game.wormholes.find(x => x.id === wh.destId);
    c.p.intel.wormholes[wh.id] = { id: wh.id, x: wh.x, y: wh.y, year: c.game.year, destId: wh.destId, stability: wh.stability };
    if (dest) c.p.intel.wormholes[dest.id] = { id: dest.id, x: dest.x, y: dest.y, year: c.game.year, destId: dest.destId, stability: dest.stability };
    w++;
  }
  return `${n} planète${n > 1 ? 's' : ''} analysée${n > 1 ? 's' : ''} dans un rayon de ${r} al${w ? `, ${w} trou${w > 1 ? 's' : ''} de ver cartographié${w > 1 ? 's' : ''}` : ''}`;
}
function nearestOwn(c: Ctx): Planet | undefined {
  if (c.planet.owner === c.p.id) return c.planet;
  return c.game.planets.filter(x => x.owner === c.p.id && x.pop > 0).sort((a, b) => distance(a, c.planet) - distance(b, c.planet))[0];
}
function colonists(c: Ctx, n: number): string {
  const to = nearestOwn(c);
  if (!to) return 'mais aucune colonie ne peut les accueillir';
  to.pop += Math.round(n / 100) * 100;
  return `${people(c.game, n)} colons réveillés et installés sur ${to.name}`;
}
function damage(c: Ctx, frac: number): string {
  const f = c.fleet && c.game.fleets.includes(c.fleet) ? c.fleet : undefined;
  if (!f) return 'heureusement, plus aucun vaisseau n\'était sur place';
  for (const t of f.tokens) {
    const armor = fleetSpecArmor(c.game, t.designId);
    t.damage = Math.min(Math.max(1, armor - 1), t.damage + Math.round(armor * frac));
    t.qtyDamaged = t.qty;
  }
  return `${f.name} est endommagé`;
}
function fleetSpecArmor(game: GameState, designId: number): number {
  const d = game.designs.find(x => x.id === designId);
  if (!d) return 10;
  const probe: Fleet = { id: -1, owner: d.owner, num: 0, name: '', x: 0, y: 0, orbiting: -1, tokens: [{ designId, qty: 1, damage: 0, qtyDamaged: 0 }], cargo: emptyCargo(), fuel: 0, waypoints: [], repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0 };
  return fleetSpec(game, probe).armor;
}
function destroyFleet(c: Ctx): string {
  const f = c.fleet && c.game.fleets.includes(c.fleet) ? c.fleet : undefined;
  if (!f) return 'heureusement, plus aucun vaisseau n\'était sur place';
  c.game.fleets.splice(c.game.fleets.indexOf(f), 1);
  c.p.stats.shipsLost += f.tokens.reduce((a, t) => a + t.qty, 0);
  return `${f.name} est perdu corps et biens`;
}
function refit(c: Ctx): string {
  const fleets = c.game.fleets.filter(f => f.owner === c.p.id && f.orbiting === c.planet.id);
  for (const f of fleets) { f.fuel = fleetSpec(c.game, f).fuelCapacity; for (const t of f.tokens) { t.damage = 0; t.qtyDamaged = 0; } }
  return fleets.length ? `${fleets.length > 1 ? 'vos vaisseaux en orbite sont réparés et ravitaillés' : `${fleets[0].name} est réparé et ravitaillé`}` : 'aucun vaisseau à ravitailler';
}
function derelict(c: Ctx): string {
  const tech = Math.max(...FIELDS.map(f => c.p.tech[f])) + 3;
  const hull = c.a.level >= 4 ? 'Battleship' : c.a.level >= 3 ? 'Cruiser' : 'Destroyer';
  const label = 'Épave restaurée'; // a variable: the extractor skips designAtTech's arguments
  const d = designAtTech(c.p, Math.min(26, tech), hull, 'beamWarship', label);
  if (!d) return 'une épave, hélas irréparable';
  d.alien = true; d.id = c.game.nextId++;
  c.game.designs.push(d);
  c.p.fleetNum++;
  const sp = { armor: fleetSpecArmor(c.game, d.id) };
  const f: Fleet = {
    id: c.game.nextId++, owner: c.p.id, num: c.p.fleetNum, name: `Épave restaurée #${c.p.fleetNum}`, x: c.planet.x, y: c.planet.y, orbiting: c.planet.id,
    tokens: [{ designId: d.id, qty: 1, damage: Math.round(sp.armor * 0.5), qtyDamaged: 1 }], cargo: emptyCargo(), fuel: 0,
    waypoints: [{ x: c.planet.x, y: c.planet.y, target: 'planet', targetId: c.planet.id, warp: 0, task: 'none' }], repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0,
  };
  c.game.fleets.push(f);
  f.fuel = Math.round(fleetSpec(c.game, f).fuelCapacity * 0.5);
  return `un vaisseau de guerre d'une technologie supérieure, à moitié détruit mais remis en état de voler (${f.name}, modèle impossible à reproduire)`;
}
function towardIdeal(c: Ctx, clicks: number): string {
  const center = raceSpec(c.p.race).habCenter;
  const before = habitability(c.p.race, c.planet.hab);
  for (let i = 0; i < 3; i++) {
    if (c.p.race.immune[i]) continue;
    const d = Math.sign(center[i] - c.planet.baseHab[i]) * Math.min(clicks, Math.abs(center[i] - c.planet.baseHab[i]));
    c.planet.baseHab[i] = Math.max(0, Math.min(100, c.planet.baseHab[i] + d));
    c.planet.hab[i] = Math.max(0, Math.min(100, c.planet.hab[i] + d));
  }
  c.planet.hab = c.planet.hab.map(Math.round) as Hab;
  return `le climat de ${c.planet.name} se rapproche de votre idéal (habitabilité ${before} % → ${habitability(c.p.race, c.planet.hab)} %)`;
}
function fragment(c: Ctx): string {
  c.p.fragments = (c.p.fragments ?? 0) + 1;
  const need = fragmentsNeeded(c.game);
  // 0.3.7: the sanctuary stands on a star of its own, hidden until the map is complete
  if (c.game.secrets?.some(s => s.kind === 'ancients')) {
    const t = c.p.fragments >= need ? ancientsMap(c.game, c.p) : null;
    return t ?? `un fragment de la carte des Anciens (${Math.min(c.p.fragments, need)} sur ${need})`;
  }
  const vault = vaultOf(c.game);
  if (!vault) return 'un fragment de carte stellaire, dont l\'original semble perdu';
  if (c.p.fragments >= need && !vault.known.includes(c.p.id)) {
    vault.known.push(c.p.id);
    const pl = c.game.planets[vault.planetId];
    revealPlanet(c.game, c.p, pl, false);
    return `le dernier fragment manquant : la carte des Anciens est complète. Leur sanctuaire se trouve sur ${pl.name}`;
  }
  return `un fragment de la carte des Anciens (${Math.min(c.p.fragments, need)} sur ${need})`;
}
function awaken(c: Ctx, tier: number): string {
  if (!guardiansOn(c.game)) return research(c, 0.4);
  const kind = tier >= 3 ? 'leviathan' : tier === 2 ? 'dreadnought' : 'sentinel';
  hoard(c.planet, tier);
  spawnGuardian(c.game, c.planet, kind);
  return `${theGuardian(kind)} se réveille et prend la planète sous sa garde`;
}

export const ANOMALIES: Record<string, AnomalyDef> = {
  probe: {
    id: 'probe', name: 'Sonde à la dérive', levels: [1, 2], weight: 10,
    text: 'Une petite sonde d\'origine inconnue tourne autour de la planète, ses mémoires encore alimentées.',
    apply: c => `ses mémoires sont décodées, et ${research(c, 0.35)}.`,
  },
  vein: {
    id: 'vein', name: 'Filon affleurant', levels: [1, 3], weight: 10,
    text: 'Des relevés gravimétriques étranges trahissent un filon exceptionnel juste sous la croûte.',
    apply: c => `${veins(c.planet, 20 + 10 * c.a.level, c.rng)}, et ${minerals(c.planet, 150 * c.a.level)}.`,
  },
  cache: {
    id: 'cache', name: 'Entrepôt abandonné', levels: [1, 2], weight: 8,
    text: 'Des silos scellés, enfouis par une civilisation minière disparue.',
    apply: c => `${minerals(c.planet, 350 * c.a.level)}.`,
  },
  charts: {
    id: 'charts', name: 'Archives stellaires', levels: [2, 3], weight: 7,
    text: 'Une station-relais en ruine émet encore un catalogue d\'étoiles en boucle.',
    apply: c => `${revealAround(c, 140 + 40 * c.a.level)}.`,
  },
  cryo: {
    id: 'cryo', name: 'Capsules cryogéniques', levels: [2, 3], weight: 6,
    text: 'Des milliers de capsules de sommeil, dont certaines fonctionnent encore.',
    apply: c => `${colonists(c, 4000 * c.a.level)}.`,
  },
  storm: {
    id: 'storm', name: 'Nuage d\'ions', levels: [1, 2], weight: 6,
    text: 'Un nuage de particules chargées enveloppe la planète. Les mesures sont précieuses, l\'approche dangereuse.',
    apply: c => `${damage(c, 0.4)}, mais les mesures sont précieuses : ${research(c, 0.3, 'energy')}.`,
  },
  well: {
    id: 'well', name: 'Puits de deutérium', levels: [1, 3], weight: 6,
    text: 'Une poche de gaz lourds remonte à la surface en geysers réguliers.',
    apply: c => `${refit(c)}. ${cap1(research(c, 0.25, 'propulsion'))}.`,
  },
  wreck: {
    id: 'wreck', name: 'Épave extraterrestre', levels: [3, 5], weight: 5,
    text: 'Un vaisseau de guerre inconnu, éventré mais presque intact, dérive en orbite basse.',
    apply: c => `${derelict(c)}.`,
  },
  lab: {
    id: 'lab', name: 'Laboratoire abandonné', levels: [3, 5], weight: 5,
    text: 'Un complexe de recherche souterrain, déserté en hâte. Les serveurs répondent encore.',
    apply: c => `${research(c, 0.9)}.`,
  },
  climate: {
    id: 'climate', name: 'Moteur climatique', levels: [3, 4], weight: 5,
    text: 'Une machine colossale enfouie sous les pôles peut encore modifier l\'atmosphère de la planète.',
    choice: {
      a: { label: 'Le remettre en marche', hint: 'la planète se rapproche durablement de l\'idéal de votre race', apply: c => `${towardIdeal(c, 6 + 2 * c.a.level)}.` },
      b: { label: 'Le démonter pour l\'étudier', hint: 'recherche en Biotechnologie et en Construction', apply: c => `${research(c, 0.6, 'biotechnology')}. ${cap1(research(c, 0.4, 'construction'))}.` },
      ai: c => habitability(c.p.race, c.planet.hab) > -15 ? 'a' : 'b',
    },
  },
  tomb: {
    id: 'tomb', name: 'Vaisseau-tombeau', levels: [2, 4], weight: 6,
    text: 'Un navire funéraire, couvert d\'inscriptions d\'avertissement dans une langue morte.',
    choice: {
      a: { label: 'Fouiller les soutes', hint: 'beaucoup de recherche, mais un risque sur trois de perdre la flotte qui l\'a étudié', apply: c => c.rng.chance(1 / 3) ? `${destroyFleet(c)} : les avertissements étaient sérieux. Ses dernières transmissions sauvent l'essentiel : ${research(c, 0.3)}.` : `${research(c, 1)}.` },
      b: { label: 'Le laisser en paix', hint: 'un peu de recherche, aucun risque', apply: c => `${research(c, 0.3)}.` },
      ai: c => c.p.ai === 'easy' ? 'b' : 'a',
    },
  },
  beacon: {
    id: 'beacon', name: 'Balise de détresse', levels: [1, 3], weight: 6,
    text: 'Un appel au secours automatique, émis en boucle depuis la surface.',
    choice: {
      a: { label: 'Envoyer une équipe', hint: 'des survivants à recueillir, ou un piège', apply: c => c.rng.chance(0.65) ? `${colonists(c, 3000 + 2000 * c.a.level)}.` : `C'était une embuscade : ${damage(c, 0.7)}.` },
      b: { label: 'Ignorer l\'appel', hint: 'rien ne se passe', apply: () => 'La balise s\'éteint quelques mois plus tard.' },
      ai: () => 'a',
    },
  },
  crystals: {
    id: 'crystals', name: 'Cristaux chantants', levels: [2, 4], weight: 5,
    text: 'Des formations cristallines géantes vibrent au rythme de l\'étoile.',
    choice: {
      a: { label: 'Les extraire', hint: 'des minerais en quantité, les cristaux disparaissent', apply: c => `${minerals(c.planet, 500 * c.a.level)}.` },
      b: { label: 'Les étudier sur place', hint: 'recherche en Énergie et en Électronique', apply: c => `${research(c, 0.5, 'energy')}. ${cap1(research(c, 0.5, 'electronics'))}.` },
      ai: c => c.rng.chance(0.5) ? 'a' : 'b',
    },
  },
  sarcophagus: {
    id: 'sarcophagus', name: 'Sarcophage scellé', levels: [3, 5], weight: 4,
    text: 'Une chambre close, gardée par des mécanismes encore actifs. Quelque chose y dort.',
    choice: {
      a: { label: 'Briser le sceau', hint: 'une chance sur deux de trouver une relique, sinon un gardien se réveille', apply: c => {
        const r = c.rng.chance(0.5) ? missingRelic(c.p, c.rng.int(100)) : null;
        if (r && giveRelic(c.p, r)) return `Le sarcophage contenait une relique : ${RELICS[r].name} (${RELICS[r].effect}).`;
        return `${awaken(c, Math.min(3, c.a.level - 1))}.`;
      } },
      b: { label: 'Laisser le sceau intact', hint: 'un peu de recherche', apply: c => `${research(c, 0.35)}.` },
      ai: c => c.p.ai === 'easy' ? 'b' : 'a',
    },
  },
  fragment: {
    id: 'fragment', name: 'Fragment des Anciens', levels: [2, 4], weight: 0,
    text: 'Une tablette de métal gravée de positions d\'étoiles : un morceau d\'une carte plus grande.',
    apply: c => `${fragment(c)}.`,
  },
  // 0.3.7: the hidden stars (their clues, and what waits there)
  echo: {
    id: 'echo', name: 'Écho dans la poussière', levels: [2, 2], weight: 0,
    text: 'Les antennes de la planète captent un écho régulier venu du nuage sombre voisin, d\'une source qui ne devrait pas s\'y trouver.',
    apply: c => `${followClue(c.game, c.p, c.planet.id)}.`,
  },
  drift: {
    id: 'drift', name: 'Horloges dérivantes', levels: [2, 2], weight: 0,
    text: 'Les horloges atomiques d\'une station abandonnée avancent et retardent selon un rythme parfaitement régulier, comme poussées par une main invisible.',
    apply: c => `${followClue(c.game, c.p, c.planet.id)}.`,
  },
  timing: {
    id: 'timing', name: 'Horloge du pulsar', levels: [3, 3], weight: 0,
    text: 'Le pulsar tourne sur lui-même plus régulièrement que n\'importe quelle horloge construite : une référence pour la navigation et pour la physique.',
    apply: c => `${research(c, 0.7, 'electronics')}. ${cap1(research(c, 0.5, 'propulsion'))}.`,
  },
  enclave: {
    id: 'enclave', name: 'Enclave des Exilés', levels: [3, 3], weight: 0,
    text: 'Un peuple coupé du reste de la galaxie depuis des millénaires vit encore ici, dans des cités sous dôme. Ils acceptent de parlementer.',
    choice: {
      a: { label: 'Échanger avec eux', hint: 'beaucoup de recherche, dans deux domaines', apply: c => `${research(c, 0.8)}. ${cap1(research(c, 0.8))}.` },
      b: { label: 'Les accueillir dans votre empire', hint: 'la planète devient une de vos colonies, avec 40 000 habitants', apply: c => { const t = joinEnclave(c.game, c.p, c.planet); return t ? `${cap1(t)}.` : `${c.planet.name} est déjà occupée : les Exilés partagent seulement leur savoir. ${cap1(research(c, 0.8))}.`; } },
      ai: () => 'b',
    },
  },
  horizon: {
    id: 'horizon', name: 'Horizon des événements', levels: [4, 4], weight: 0,
    text: 'Au bord du trou noir, le temps ralentit et la lumière s\'enroule. Chaque mesure demande des années, et un vaisseau qui s\'approche trop ne revient pas.',
    site: { chapters: 3, relic: 'horizon', chapters_: ['Les premières sondes atteignent le disque d\'accrétion', 'Le ralentissement du temps près de l\'horizon est mesuré', 'Une théorie complète de l\'horizon'] },
  },
  // archaeological sites (chapter by chapter, then a relic)
  builders: {
    id: 'builders', name: 'Ruines des Bâtisseurs', levels: [3, 4], weight: 0,
    text: 'Les restes d\'une cité-fonderie, sur des kilomètres. Les fouilles prendront des années.',
    site: { chapters: 3, relic: 'forge', chapters_: ['Les ateliers de surface livrent leurs outils', 'Les galeries profondes révèlent les hauts-fourneaux', 'Au cœur de la fonderie, une forge encore tiède'] },
  },
  seers: {
    id: 'seers', name: 'Observatoire des Voyants', levels: [3, 4], weight: 0,
    text: 'Un réseau d\'antennes de pierre orientées vers des étoiles qui n\'existent plus.',
    site: { chapters: 3, relic: 'eye', chapters_: ['Les premières antennes sont dégagées', 'Les registres d\'observation sont déchiffrés', 'Dans la salle centrale, l\'œil du veilleur'] },
  },
  gardens: {
    id: 'gardens', name: 'Jardins de Vael', levels: [3, 4], weight: 0,
    text: 'Des serres immenses, fossilisées, où poussent encore quelques plantes inconnues.',
    site: { chapters: 3, relic: 'seed', chapters_: ['Les serres extérieures sont cartographiées', 'La banque de semences est localisée', 'Les semences de Vael sont intactes'] },
  },
  navigators: {
    id: 'navigators', name: 'Port des Navigateurs', levels: [3, 4], weight: 0,
    text: 'Un spatioport en ruine, dont les quais pouvaient accueillir des milliers de vaisseaux.',
    site: { chapters: 3, relic: 'compass', chapters_: ['Les quais sont déblayés', 'Les journaux de bord parlent d\'un instrument', 'Le compas des Navigateurs est retrouvé'] },
  },
  library: {
    id: 'library', name: 'Bibliothèque engloutie', levels: [3, 4], weight: 0,
    text: 'Sous un océan gelé, les salles d\'une bibliothèque de cristal.',
    site: { chapters: 3, relic: 'codex', chapters_: ['Les premières salles sont pompées', 'Les index de la bibliothèque sont reconstitués', 'Le codex des Bâtisseurs est déchiffré'] },
  },
  catacombs: {
    id: 'catacombs', name: 'Catacombes de la capitale', levels: [2, 2], weight: 0,
    text: 'Sous votre propre capitale, les ruines de la cité qui l\'a précédée.',
    site: { chapters: 3, chapters_: ['Les premiers niveaux sont sécurisés', 'Les archives de l\'ancienne cité sont retrouvées', 'La bibliothèque des fondateurs est ouverte'] },
  },
  vault: {
    id: 'vault', name: 'Sanctuaire des Anciens', levels: [5, 5], weight: 0,
    text: 'Le lieu que désignait la carte des Anciens : une citadelle enfouie, presque intacte.',
    site: { chapters: 3, relic: 'heart', chapters_: ['La porte du sanctuaire cède', 'Les salles des cartes livrent la galaxie telle qu\'elle était', 'Au centre, le Cœur des Anciens'] },
  },
};
const SITES = ['builders', 'seers', 'gardens', 'navigators', 'library'];

export const defOf = (a: Anomaly): AnomalyDef => ANOMALIES[a.kind];
export const finished = (a: Anomaly) => a.doneBy !== undefined;
export const vaultOf = (game: GameState) => game.anomalies?.find(a => a.kind === 'vault');
export function fragmentsNeeded(game: GameState): number {
  const n = (game.anomalies ?? []).filter(a => a.kind === 'fragment').length;
  return Math.max(1, Math.min(3, n - 1));
}
export const isSite = (a: Anomaly) => !!defOf(a)?.site;
/** Points to finish the anomaly (for a site: each chapter, one level harder than the site itself). */
export const pointsNeeded = (a: Anomaly) => STUDY_NEED[Math.max(1, Math.min(5, a.level + (isSite(a) ? 1 : 0)))];

/** Places anomalies, sites, fragments and the vault (own random stream: the rest of the universe is unchanged). */
export function generateAnomalies(game: GameState) {
  const rng = new Rng(seedFromString(game.settings.seed + '|anom'));
  const homes = game.planets.filter(p => p.owner >= 0 && p.homeworld);
  const W = game.width;
  const homeDist = (p: Planet) => homes.length ? Math.min(...homes.map(h => distance(h, p))) : W;
  const free = rng.shuffle(game.planets.filter(p => p.owner < 0));
  const list: Anomaly[] = [];
  const used = new Set<number>();
  const add = (pl: Planet, kind: string, level?: number, hidden?: boolean) => {
    const d = ANOMALIES[kind];
    const byDist = 1 + Math.floor(homeDist(pl) / (W * 0.16)) + (rng.chance(0.3) ? -1 : 0);
    const lv = level ?? Math.max(d.levels[0], Math.min(d.levels[1], byDist));
    list.push({ id: game.nextId++, planetId: pl.id, kind, level: lv, known: [], progress: {}, hidden });
    used.add(pl.id);
  };
  // the vault: the free world farthest from every homeworld
  const vaultPl = [...free].sort((a, b) => homeDist(b) - homeDist(a))[0];
  const nF = Math.max(3, Math.min(6, Math.round(game.planets.length / 24)));
  if (vaultPl && game.planets.length >= 24) add(vaultPl, 'vault', 5, true);
  // fragments, spread out: one per sector of the map, as far as possible
  const fr = free.filter(p => !used.has(p.id) && homeDist(p) > W * 0.12);
  for (let i = 0; i < nF && fr.length && list.some(a => a.kind === 'vault'); i++) {
    const pl = fr.splice(rng.int(fr.length), 1)[0];
    if (list.some(a => a.kind === 'fragment' && distance(game.planets[a.planetId], pl) < W * 0.15) && fr.length > nF) { i--; continue; }
    add(pl, 'fragment');
  }
  // archaeological sites
  const nS = Math.max(1, Math.round(game.planets.length * 0.02));
  const sites = rng.shuffle([...SITES]);
  for (let i = 0; i < nS; i++) {
    const pl = free.find(p => !used.has(p.id) && homeDist(p) > W * 0.1);
    if (!pl) break;
    add(pl, sites[i % sites.length]);
  }
  // ordinary anomalies
  const pool = Object.values(ANOMALIES).filter(d => d.weight > 0);
  const total = pool.reduce((a, d) => a + d.weight, 0);
  const nA = Math.max(3, Math.round(game.planets.length * 0.08));
  for (let i = 0; i < nA; i++) {
    const pl = free.find(p => !used.has(p.id));
    if (!pl) break;
    let r = rng.random() * total, d = pool[0];
    for (const x of pool) { r -= x.weight; if (r <= 0) { d = x; break; } }
    add(pl, d.id);
  }
  game.anomalies = list;
}

/** A player learns about the anomalies of the planets it has analysed. */
export function discoverAnomalies(game: GameState, quiet = false) {
  if (!anomaliesOn(game)) return;
  const need = fragmentsNeeded(game);
  for (const a of game.anomalies ?? []) {
    if (finished(a)) continue;
    const pl = game.planets[a.planetId];
    for (const p of game.players) {
      if (p.dead || p.monster || a.known.includes(p.id)) continue;
      if (a.hidden && (p.fragments ?? 0) < need) continue;
      if (!p.intel.planets[a.planetId]?.explored) continue;
      a.known.push(p.id);
      if (!quiet && !p.ai) {
        const d = defOf(a);
        p.messages.push({ year: game.year, kind: 'event', text: `${d.site ? 'Site archéologique' : 'Anomalie'} sur ${pl.name} : ${d.name}. ${d.text} ${d.site ? `${d.site.chapters} chapitres à déchiffrer` : `Difficulté ${a.level}`}. Un vaisseau équipé d'un scanner, laissé en orbite, peut l'étudier.`, target: { kind: 'planet', id: pl.id } });
      }
    }
  }
}

/** Any scanner will do, even one that only sees its own position (range 0). */
const hasScanner = (game: GameState, f: Fleet) => { const s = fleetSpec(game, f); return s.scanRange >= 0 || s.scanRangePen > 0; };

/** Can this player study this anomaly right now (and why not)? */
export function studyBlocker(game: GameState, p: Player, a: Anomaly): string | null {
  if (finished(a)) return 'déjà étudiée';
  if (!a.known.includes(p.id)) return 'inconnue';
  const pl = game.planets[a.planetId];
  if (pl.owner >= 0 && pl.owner !== p.id) return `planète occupée par les ${game.players[pl.owner].name}`;
  const g = guardianAt(game, pl.id);
  if (g) return `${theGuardian(g.kind)} veille sur la planète`;
  return null;
}

/** Your fleets studying the anomaly this year: in orbit, carrying a scanner, with no further destination. */
export function studyingFleets(game: GameState, p: Player, a: Anomaly): Fleet[] {
  return game.fleets.filter(f => f.owner === p.id && f.orbiting === a.planetId && f.waypoints.length <= 1 && hasScanner(game, f));
}

/** Study points per year. */
export function studyRate(game: GameState, p: Player, ships: number, colony: boolean, pen: boolean): number {
  const n = ships + (colony ? 1 : 0);
  if (n <= 0) return 0;
  let r = 2 + Math.floor(p.tech.electronics / 4);
  if (n >= 2) r *= 1.5;
  if (pen) r *= 1.25;
  if (p.origin === 'explorers') r *= 2;
  return Math.round(r * 10) / 10;
}

/** Points per year this player would put into the anomaly now. */
export function currentRate(game: GameState, p: Player, a: Anomaly): number {
  if (studyBlocker(game, p, a)) return 0;
  const fl = studyingFleets(game, p, a);
  const pl = game.planets[a.planetId];
  return studyRate(game, p, fl.length, pl.owner === p.id && pl.pop > 0, fl.some(f => fleetSpec(game, f).scanRangePen > 0));
}

/** Is this fleet studying something (the computer players and automation leave it alone)? */
export function isStudying(game: GameState, f: Fleet): boolean {
  if (!anomaliesOn(game) || f.orbiting < 0 || f.waypoints.length > 1) return false;
  const p = game.players[f.owner];
  return (game.anomalies ?? []).some(a => a.planetId === f.orbiting && !finished(a) && a.known.includes(p.id) && !studyBlocker(game, p, a) && hasScanner(game, f));
}

/** Yearly study: progress for everyone in orbit, results for the first to finish. */
export function runStudies(game: GameState, rng: Rng) {
  if (!anomaliesOn(game)) return;
  for (const a of game.anomalies ?? []) {
    if (finished(a)) continue;
    const need = pointsNeeded(a);
    const ready: { p: Player; fleet?: Fleet; pts: number }[] = [];
    for (const p of game.players) {
      if (p.dead || p.monster || !a.known.includes(p.id)) continue;
      const rate = currentRate(game, p, a);
      if (rate <= 0) continue;
      a.progress[p.id] = Math.round(((a.progress[p.id] ?? 0) + rate) * 10) / 10;
      if (a.progress[p.id] >= need) ready.push({ p, fleet: studyingFleets(game, p, a)[0], pts: a.progress[p.id] });
    }
    if (!ready.length) continue;
    ready.sort((x, y) => y.pts - x.pts || x.p.id - y.p.id);
    resolve(game, a, ready[0].p, ready[0].fleet, rng);
  }
}

function msg(game: GameState, p: Player, text: string, planetId: number) {
  p.messages.push({ year: game.year, kind: 'event', text, target: { kind: 'planet', id: planetId } });
}

function resolve(game: GameState, a: Anomaly, p: Player, fleet: Fleet | undefined, rng: Rng) {
  const d = defOf(a);
  const planet = game.planets[a.planetId];
  const c: Ctx = { game, p, planet, a, fleet, rng };
  p.finds = { anomalies: 0, chapters: 0, guardians: 0, ...p.finds };
  const others = game.players.filter(o => o.id !== p.id && (a.progress[o.id] ?? 0) > 0);
  if (d.site) {
    const ch = (a.chapter ?? 0) + 1;
    a.chapter = ch;
    p.finds.chapters++;
    const reward = ch % 2 ? research(c, 0.45) : minerals(planet, 300 * a.level);
    let text = `${d.name} (${planet.name}), chapitre ${ch} sur ${d.site.chapters} : ${d.site.chapters_[ch - 1] ?? ''}. ${reward[0].toUpperCase()}${reward.slice(1)}.`;
    if (ch >= d.site.chapters) {
      a.doneBy = p.id; a.doneYear = game.year;
      if (d.site.relic) {
        const relic = giveRelic(p, d.site.relic) ? d.site.relic : missingRelic(p, a.id, d.site.relic === 'heart' ? [] : ['heart']);
        if (relic && (relic === d.site.relic || giveRelic(p, relic))) text += ` Relique trouvée : ${RELICS[relic].name} (${RELICS[relic].effect}).`;
      } else text += ` Dernière trouvaille : ${research(c, 0.8)}.`;
      if (a.kind === 'vault') text += ` ${revealAround(c, 450)}.`;
      for (const o of game.players) if (o.id !== p.id && !o.dead && a.known.includes(o.id)) msg(game, o, `Les ${p.name} ont achevé les fouilles de ${d.name} sur ${planet.name}.`, planet.id);
    } else for (const o of others) msg(game, o, `Les ${p.name} ont déchiffré avant vous le chapitre ${ch} de ${d.name} (${planet.name}). Les fouilles continuent.`, planet.id);
    a.progress = {};
    msg(game, p, text, planet.id);
    // 0.3.9: every chapter speaks of the Breach; the vault, three times
    addClue(game, p, `${d.name} (${planet.name}), chapitre ${ch}`);
    if (a.kind === 'vault' && ch >= d.site.chapters) { addClue(game, p, `les salles du ${d.name}`); addClue(game, p, `le cœur du ${d.name}`); }
    return;
  }
  a.doneBy = p.id; a.doneYear = game.year;
  p.finds.anomalies++;
  if (rng.chance(0.35)) addClue(game, p, `${d.name} (${planet.name})`);
  for (const o of others) msg(game, o, `Les ${p.name} ont percé avant vous le mystère de ${d.name} sur ${planet.name}.`, planet.id);
  if (d.choice) {
    if (p.ai) { const k = d.choice.ai(c); d.choice[k].apply(c); return; }
    const dec: Decision = { id: game.nextId++, anomalyId: a.id, kind: a.kind, planetId: planet.id, year: game.year, fleetId: fleet?.id };
    (p.decisions ??= []).push(dec);
    p.messages.push({ year: game.year, kind: 'event', text: `${d.name} (${planet.name}) : l'étude est terminée. Une décision vous attend : ${d.choice.a.label.toLowerCase()} ou ${d.choice.b.label.toLowerCase()} ? (onglet Empire, Découvertes)`, target: { kind: 'anomaly', id: a.id } });
    return;
  }
  const out = d.apply ? d.apply(c) : '';
  msg(game, p, `${d.name} (${planet.name}) : ${out}`, planet.id);
}

/** A human player decides (from the interface). Returns the result text. */
export function decide(game: GameState, p: Player, decisionId: number, choice: 'a' | 'b'): string | null {
  const i = (p.decisions ?? []).findIndex(x => x.id === decisionId);
  if (i < 0) return null;
  const dec = p.decisions![i];
  const a = (game.anomalies ?? []).find(x => x.id === dec.anomalyId);
  const d = ANOMALIES[dec.kind];
  if (!a || !d?.choice) { p.decisions!.splice(i, 1); return null; }
  const fleet = game.fleets.find(f => f.id === dec.fleetId);
  const rng = new Rng(seedFromString(`${game.settings.seed}|dec|${dec.id}|${game.year}`));
  const out = d.choice[choice].apply({ game, p, planet: game.planets[dec.planetId], a, fleet, rng });
  // the decision is taken between two turns: what it changed on the world (climate, minerals) is seen at once,
  // not at the next scan (3.3.6: the climate engine looked ineffective until then)
  revealPlanet(game, p, game.planets[dec.planetId], false);
  p.decisions!.splice(i, 1);
  const text = `${d.name} (${game.planets[dec.planetId].name}), ${d.choice[choice].label.toLowerCase()} : ${out}`;
  msg(game, p, text, dec.planetId);
  return text;
}

/** Anomalies known to a player, open ones first. */
export function knownAnomalies(game: GameState, p: Player): Anomaly[] {
  return (game.anomalies ?? []).filter(a => a.known.includes(p.id));
}

/** The open anomaly of a planet known to this player, if any. */
export function anomalyAt(game: GameState, p: Player, planetId: number): Anomaly | undefined {
  return (game.anomalies ?? []).find(a => a.planetId === planetId && a.known.includes(p.id) && !finished(a));
}

/** Computer players: idle scouts go and study the anomalies they know, nearest first. */
export function aiStudies(game: GameState, p: Player) {
  if (!anomaliesOn(game)) return;
  const open = knownAnomalies(game, p).filter(a => !finished(a) && !studyBlocker(game, p, a));
  if (!open.length) return;
  const busy = new Set<number>();
  for (const f of game.fleets) {
    if (f.owner !== p.id) continue;
    const last = f.waypoints[f.waypoints.length - 1];
    if (f.waypoints.length > 1 && last.target === 'planet' && last.targetId !== undefined && f.purpose === 'scout') busy.add(last.targetId);
    if (isStudying(game, f)) busy.add(f.orbiting);
  }
  const scouts = game.fleets.filter(f => f.owner === p.id && f.purpose === 'scout' && f.waypoints.length <= 1 && !isStudying(game, f) && hasScanner(game, f));
  for (const a of open) {
    if (busy.has(a.planetId) || !scouts.length) continue;
    const pl = game.planets[a.planetId];
    scouts.sort((x, y) => distance(x, pl) - distance(y, pl));
    const f = scouts[0];
    if (distance(f, pl) > game.width * 0.35) continue;
    const home = f.waypoints[0];
    if (!safeGoto(game, f, { x: pl.x, y: pl.y, planetId: pl.id })) continue;
    if (!decentLeg(game, f)) { f.waypoints = [home]; continue; } // not a crawl of decades to study it
    scouts.shift();
    busy.add(a.planetId);
  }
}

/** Monde-relique origin: a dig under the homeworld. */
export function addHomeSite(game: GameState, home: Planet, p: Player) {
  const a: Anomaly = { id: game.nextId++, planetId: home.id, kind: 'catacombs', level: 2, known: [p.id], progress: {} };
  (game.anomalies ??= []).push(a);
}
