// New game creation: universe, players, homeworlds, starting designs and fleets.
import { makeShape } from './shape';
import type { TechReq } from '../data/types';
import type { AIDifficulty, BattlePlan, Fleet, GameSettings, GameState, Hab, Intel, Planet, Player, Race, ShipDesign, TechLevels } from './types';
import { initCulture, ensureBeaconCarrier } from './culture';
import { initGovernors } from './governors';
import { START_DESIGN_LABELS } from '../data/labels';
import { FIELDS } from './types';
import { Rng, seedFromString } from './rng';
import { makeTechShift } from './research';
import { ensureSpecialShift } from './specials';
import { generatePlanets, chooseHomeworlds, generateWormholes, UNIVERSE_SIZES, WORMHOLE_PAIRS, randomConcentrations } from './universe';
import { raceSpec, advantagePoints, PREDEFINED_RACES, habitability as habitabilityOf } from './race';
import { autoDesign, designSpec, type Purpose } from './design';
import { HULLS, TECHS, canLearn, meetsLevels, partFitsSlot } from './tech';
import { defaultTemplates } from './production';
import { emptyCargo } from './fleet';
import { updateIntel } from './scan';
import { AI_RACES } from './airaces';
import { generateTerrain } from './terrain';
import { assignObjectives } from './objectives';
import { generateAnomalies, discoverAnomalies } from './anomalies';
import { placeGuardians, removeGuardians } from './guardians';
import { generateSecrets } from './secrets';
import { initPirates, removePirates } from './pirates';
import { initCrisis, removeCrisis } from './crisis';
import { initDiplomacy, removeDiplomacy } from './diplomacy';
import { applyOrigins, originIntel } from './origins';
import { logFleet } from './veterans';

export const PLAYER_COLORS = ['#4fb3ff', '#ff5d5d', '#ffd24a', '#5dde7a', '#c77dff', '#ff9a3d', '#35e0d0', '#ff7ac8', '#a3a3ff', '#b5e35d', '#e0a070', '#70c0e0', '#ff4040', '#40ff90', '#9090ff', '#ffff80'];

export interface NewPlayerConfig { name?: string; race: Race; ai: AIDifficulty | null; /** Constellations 3.2 */ origin?: string }

export interface NewGameOptions {
  name: string;
  settings: GameSettings;
  players: NewPlayerConfig[];
}

export function defaultSettings(): GameSettings {
  return {
    size: 'Small', density: 'Normal', positions: 'Moderate', maxMinerals: false, slowTech: false, accelerated: false,
    randomEvents: true, aiAlliances: false, publicScores: false, clumping: false, anonymousContacts: true, randomResearch: true, fuzzyTechTree: true,
    terrain: true, distanceCost: true, logistics: true, combatRoles: true, doctrines: true, megaprojects: true, secretObjectives: true, deception: true,
    anomalies: true, guardians: true, origins: true, culture: true, pirates: true, crisis: true, diplomacy: true, espionage: true, debris: true,
    veterans: true, nemesis: true, acts: true, portalRelays: true, diaspora: true, cataclysms: true,
    goldenAges: true, dilemmas: true, eventChains: true, ancientSecret: true, originVictories: true, governors: true,
    victory: { ownPlanets: 60, attainTech: { level: 22, fields: 4 }, exceedScore: null, exceedSecond: 100, production: null, capitalShips: null, highestAfter: null, numCriteria: 1, minYears: 30 },
    seed: Math.random().toString(36).slice(2, 10),
  };
}

/** The rules Constellations adds on top of Stars! (each one can be switched off). */
export const CONSTELLATIONS_RULES = ['randomResearch', 'fuzzyTechTree', 'terrain', 'distanceCost', 'logistics', 'combatRoles', 'doctrines', 'megaprojects', 'secretObjectives', 'deception', 'anomalies', 'guardians', 'origins', 'culture', 'pirates', 'crisis', 'diplomacy', 'espionage', 'debris', 'veterans', 'nemesis', 'acts', 'portalRelays', 'diaspora', 'cataclysms', 'goldenAges', 'dilemmas', 'eventChains', 'ancientSecret', 'originVictories', 'governors'] as const;
export type ConstellationsRule = typeof CONSTELLATIONS_RULES[number];

/** 3.6: the last version of Stars! (2.60j / 2.70j RC4, December 2000), whose experience the classic preset recreates. */
export const STARS_LAST = { version: '2.7j', year: 2000 };

/**
 * 3.6: "Expérience proche de Stars!": every Constellations rule off, the square galaxy, fleets identified as soon as
 * they are seen, the default victory of Stars! (50 years at least); at creation, wormholes need no research and
 * production templates do not follow each other. The interface helps (automation, reports, planners) stay.
 */
export function classicPreset(s: GameSettings): GameSettings {
  for (const k of CONSTELLATIONS_RULES) (s as any)[k] = false;
  s.shape = 'square'; s.anonymousContacts = false; s.clumping = false; s.classic = true; delete s.popUnits;
  s.victory = { ...s.victory, minYears: 50 };
  return s;
}
/** Back to the Constellations defaults (natural galaxy, every rule). */
export function constellationsPreset(s: GameSettings): GameSettings {
  for (const k of CONSTELLATIONS_RULES) (s as any)[k] = true;
  s.shape = 'arm'; s.anonymousContacts = true; s.classic = false; s.popUnits = 'millions';
  s.victory = { ...s.victory, minYears: defaultSettings().victory.minYears };
  return s;
}

/** Turns every Constellations rule off: the game plays by the original Stars! rules (used by the fidelity tests). */
export function classicRules(game: GameState): GameState {
  for (const k of CONSTELLATIONS_RULES) (game.settings as any)[k] = false;
  game.settings.classic = true;
  game.terrain = [];
  for (const p of game.players) p.techShift = undefined;
  // 3.2: no discoveries, no guardians (the origins only act at creation: classic tests start from a plain game)
  game.anomalies = [];
  removeGuardians(game);
  removePirates(game);
  removeCrisis(game);
  removeDiplomacy(game);
  for (const p of game.players) for (const o of game.players) if (o.id !== p.id && !p.monster && !o.monster) p.relations[o.id] = 'enemy';
  return game;
}

export function defaultBattlePlans(): BattlePlan[] {
  return [
    { id: 0, name: 'Par défaut', primary: 'armed', secondary: 'any', tactic: 'maximizeDamageRatio', attackWho: 'enemiesAndNeutrals', dumpCargo: false },
    { id: 1, name: 'Tuer la base', primary: 'starbase', secondary: 'armed', tactic: 'maximizeDamageRatio', attackWho: 'enemiesAndNeutrals', dumpCargo: false },
    { id: 2, name: 'Défense maximale', primary: 'armed', secondary: 'any', tactic: 'minimizeDamage', attackWho: 'enemiesAndNeutrals', dumpCargo: false },
    { id: 3, name: 'Tireur d\'élite', primary: 'unarmed', secondary: 'bomberFreighter', tactic: 'maximizeNetDamage', attackWho: 'enemiesAndNeutrals', dumpCargo: false },
    { id: 4, name: 'Poule mouillée', primary: 'any', secondary: 'none', tactic: 'disengage', attackWho: 'enemiesAndNeutrals', dumpCargo: false },
  ];
}

export function emptyIntel(game: GameState): Intel {
  return {
    planets: game.planets.map(p => ({ id: p.id })),
    fleets: [], tracks: {}, designs: {}, met: [], wormholes: {}, minefields: {}, packets: [], salvage: [], traders: [],
  };
}

type StartFleet = { name: string; hull: string; purpose: Purpose; part?: string };
const START_FLEETS: Record<string, StartFleet[]> = {
  HE: [{ name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Spore Cloud', hull: 'Mini-Colony Ship', purpose: 'colonizer' }, { name: 'Spore Cloud', hull: 'Mini-Colony Ship', purpose: 'colonizer' }, { name: 'Spore Cloud', hull: 'Mini-Colony Ship', purpose: 'colonizer' }],
  SS: [{ name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Shadow Transport', hull: 'Small Freighter', purpose: 'freighter', part: 'Transport Cloaking' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }],
  WM: [{ name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }, { name: 'Armed Probe', hull: 'Scout', purpose: 'armedScout' }, { name: 'Stalwart Defender', hull: 'Destroyer', purpose: 'startingFighter' }, { name: 'Gadfly', hull: 'Mini Bomber', purpose: 'bomber' }],
  CA: [{ name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }, { name: 'Change of Heart', hull: 'Mini-Miner', purpose: 'terraformer' }],
  IS: [{ name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }],
  SD: [{ name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }, { name: 'Little Hen', hull: 'Mini Mine Layer', purpose: 'mineLayer' }, { name: 'Speed Turtle', hull: 'Mini Mine Layer', purpose: 'speedMineLayer' }],
  PP: [{ name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }],
  IT: [{ name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }, { name: 'Swashbuckler', hull: 'Privateer', purpose: 'startingFighter' }, { name: 'Stalwart Defender', hull: 'Destroyer', purpose: 'startingFighter' }],
  AR: [{ name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }],
  JoaT: [{ name: 'Armed Probe', hull: 'Scout', purpose: 'armedScout' }, { name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' }, { name: 'Teamster', hull: 'Medium Freighter', purpose: 'freighter' }, { name: 'Stalwart Defender', hull: 'Destroyer', purpose: 'startingFighter' }, { name: 'Cotton Picker', hull: 'Mini-Miner', purpose: 'miner' }],
};

export function addDesign(game: GameState, d: ShipDesign): ShipDesign {
  d.id = game.nextId++;
  game.designs.push(d);
  return d;
}

export function newFleet(game: GameState, owner: Player, designId: number, qty: number, planet: Planet, baseName?: string): Fleet {
  const d = game.designs.find(x => x.id === designId)!;
  owner.fleetNum += 1;
  const spec = designSpec(owner, d);
  const f: Fleet = {
    id: game.nextId++, owner: owner.id, num: owner.fleetNum, name: `${baseName ?? d.name} #${owner.fleetNum}`,
    x: planet.x, y: planet.y, orbiting: planet.id, tokens: [{ designId, qty, damage: 0, qtyDamaged: 0 }],
    cargo: emptyCargo(), fuel: spec.fuelCapacity * qty,
    waypoints: [{ x: planet.x, y: planet.y, target: 'planet', targetId: planet.id, warp: 0, task: 'none' }],
    repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0, born: game.year,
  };
  game.fleets.push(f);
  logFleet(game, f, `Mise en service à ${planet.name} : ${qty} × ${d.name}.`);
  d.built += qty;
  return f;
}

function initHomeworld(game: GameState, rng: Rng, player: Player, planet: Planet, conc: { ironium: number; boranium: number; germanium: number }, extra = false) {
  const rs = raceSpec(player.race);
  const center = rs.habCenter;
  if (!extra) {
    planet.hab = [0, 1, 2].map(i => player.race.immune[i] ? planet.hab[i] : center[i]) as Hab;
  } else {
    planet.hab = [0, 1, 2].map(i => {
      if (player.race.immune[i]) return planet.hab[i];
      const width = player.race.habHigh[i] - player.race.habLow[i];
      const off = Math.trunc((width - rng.int(Math.max(1, width - 1))) / 2);
      return Math.max(1, Math.min(99, center[i] + (rng.chance(0.5) ? off : -off) / 2));
    }) as Hab;
  }
  planet.hab = planet.hab.map(v => Math.round(v)) as Hab;
  planet.baseHab = [...planet.hab] as Hab;
  planet.terraformed = [0, 0, 0];
  planet.owner = player.id;
  planet.homeworld = !extra;
  planet.conc = extra ? randomConcentrations(rng, planet.hab[2], game.settings.accelerated) : { ...conc };
  const minSurf = game.settings.maxMinerals ? 5000 : 300;
  planet.surface = { ironium: minSurf + rng.int(1000), boranium: minSurf + rng.int(1000), germanium: minSurf + rng.int(1000) };
  // PP and IT give 5,000 colonists of their homeworld to their second world (none on a tiny map, where they have no second world)
  const twoWorlds = (player.race.prt === 'PP' || player.race.prt === 'IT') && game.settings.size !== 'Tiny';
  let pop = Math.trunc((extra ? 10000 : twoWorlds ? 20000 : 25000) * rs.startingPopFactor);
  if (game.settings.accelerated) pop += Math.trunc(pop * player.race.growthRate * rs.growthFactor / 5 / 100);
  planet.pop = Math.trunc(pop / 100) * 100;
  if (rs.livesOnStarbases) { planet.mines = 0; planet.factories = 0; planet.defenses = 0; }
  else { planet.mines = 10; planet.factories = extra ? 4 : 10; planet.defenses = extra ? 0 : 10; }
  planet.scanner = !rs.livesOnStarbases;
  planet.colonizedYear = game.year;
  planet.queue = [];
  planet.leftoverOnly = false;
}

function spendLeftover(player: Player, planet: Planet) {
  const pts = Math.max(0, Math.min(advantagePoints(player.race), 50));
  const rs = raceSpec(player.race);
  switch (player.race.leftover) {
    case 'defenses': if (pts >= 5 && !rs.livesOnStarbases) planet.defenses += Math.trunc((pts + 5) / 10); break;
    case 'factories': if (pts >= 5 && !rs.livesOnStarbases) planet.factories += Math.trunc(pts / 5); break;
    case 'mines': if (pts >= 2 && !rs.livesOnStarbases) planet.mines += Math.trunc(pts / 2); break;
    case 'mineralConcentrations': {
      const n = Math.max(Math.trunc(pts / 2), 1);
      const keys = ['ironium', 'boranium', 'germanium'] as const;
      let low: typeof keys[number] = keys[0];
      for (const k of keys) if (planet.conc[k] < planet.conc[low]) low = k;
      planet.conc[low] += n;
      for (const k of keys) planet.conc[k] += Math.trunc((n + 1) / 2);
      break;
    }
    default: {
      const kt = pts * 10;
      const keys = ['ironium', 'boranium', 'germanium'] as const;
      let low: typeof keys[number] = keys[0];
      for (const k of keys) if (planet.surface[k] < planet.surface[low]) low = k;
      planet.surface[low] += Math.trunc(kt / 4) + kt % 3;
      for (const k of keys) planet.surface[k] += Math.trunc(kt / 4);
    }
  }
}

export function makePlayer(game: GameState, id: number, cfg: NewPlayerConfig): Player {
  const rs = raceSpec(cfg.race);
  const tech: TechLevels = { ...rs.startingTech };
  return {
    id, name: cfg.name ?? cfg.race.pluralName, race: cfg.race, color: PLAYER_COLORS[id % PLAYER_COLORS.length], ai: cfg.ai,
    tech, researchSpent: { energy: 0, weapons: 0, propulsion: 0, construction: 0, electronics: 0, biotechnology: 0 },
    researching: 'energy', nextField: 'lowest', researchPct: 15, researchLastYear: 0,
    relations: [], battlePlans: defaultBattlePlans(), templates: defaultTemplates(), defaultTemplate: 1,
    acquiredTechs: [], fleetNum: 0, intel: emptyIntel(game), messages: [], scores: [], dead: false,
    stats: { shipsBuilt: 0, shipsLost: 0, shipsDestroyed: 0, planetsColonized: 0 }, traderRewards: [], victoryMet: 0,
  };
}

export function starbaseDesignFor(game: GameState, player: Player, hullName: string, purpose: Purpose, name: string): ShipDesign {
  const d = autoDesign(player, hullName, purpose, name);
  return addDesign(game, d ?? { id: -1, owner: player.id, name, hull: hullName, slots: [], starbase: true, built: 0 });
}

export function createGame(opts: NewGameOptions): GameState {
  const settings = opts.settings;
  const rngState = seedFromString(settings.seed);
  const rng = new Rng(rngState);
  const W = UNIVERSE_SIZES[settings.size];
  const game: GameState = {
    format: 'constellations-1', name: opts.name, year: 2400, settings, rng: rngState, width: W, height: W,
    planets: [], fleets: [], designs: [], players: [], minefields: [], packets: [], salvage: [], wormholes: [], traders: [], battles: [],
    nextId: 1, human: 0, victor: null, victoryAnnounced: false,
  };
  // 3.6: a region of a spiral arm (or a whole galaxy in the games of 0.3.5.8), or the square of Stars!
  game.shape = settings.shape ? makeShape(settings.seed, settings.shape, W) : undefined;
  if (!game.shape) delete game.shape;
  game.planets = generatePlanets(rng, settings.size, settings.density, settings.clumping, settings.accelerated, game.shape);
  game.nextId = 1000;
  game.players = opts.players.map((cfg, i) => { const p = makePlayer(game, i, cfg); if (cfg.origin) p.origin = cfg.origin; return p; });
  if (settings.fuzzyTechTree) {
    // one hidden tree per game, its own random stream so the rest of the universe does not depend on it
    const shift = makeTechShift(new Rng(seedFromString(settings.seed + '|tech')));
    for (const p of game.players) p.techShift = shift;
    ensureSpecialShift(game);
  }
  const n = game.players.length;
  for (const p of game.players) {
    p.relations = game.players.map(o => o.id === p.id ? 'friend' : (settings.aiAlliances && p.ai && o.ai) ? 'friend' : 'enemy');
  }
  if (settings.classic) for (const p of game.players) { p.tplChain = false; p.freeSpecials = ['wormholeNav']; }
  const homes = chooseHomeworlds(rng, game.planets, W, n, settings.positions, game.shape);
  const sharedConc = { ironium: 30 + rng.int(121), boranium: 30 + rng.int(121), germanium: 30 + rng.int(121) };
  if (settings.maxMinerals) { sharedConc.ironium = Math.max(sharedConc.ironium, 100); sharedConc.boranium = Math.max(sharedConc.boranium, 100); sharedConc.germanium = Math.max(sharedConc.germanium, 100); }
  game.players.forEach((player, i) => {
    const hw = homes[i];
    initHomeworld(game, rng, player, hw, sharedConc);
    spendLeftover(player, hw);
    const rs = raceSpec(player.race);
    // starting designs and starbase
    const sbDesign = starbaseDesignFor(game, player, 'Space Station', 'starterStarbase', START_DESIGN_LABELS.Starbase);
    if (player.race.prt === 'PP') {
      // mass driver on home starbase
      const md = autoDesign(player, 'Space Station', 'starterStarbase', START_DESIGN_LABELS.Starbase);
      if (md) {
        const orbital = md.slots.find(s => s.slot === 1);
        if (!orbital) md.slots.push({ slot: 1, part: 'Mass Driver 5', qty: 1 }); else { orbital.part = 'Mass Driver 5'; orbital.qty = 1; }
        sbDesign.slots = md.slots;
      }
    }
    if (player.race.prt === 'IT') {
      const s = sbDesign.slots.find(x => x.slot === 1);
      if (s) { s.part = 'Stargate 100-250'; s.qty = 1; } else sbDesign.slots.push({ slot: 1, part: 'Stargate 100-250', qty: 1 });
    }
    hw.starbase = { designId: sbDesign.id, damage: 0 };
    hw.packetWarp = 5;
    const made = new Map<string, number>();
    // 0.3.9.15 (as in Stars!, after craig-stars): a starting ship comes only if the race has the tech for its hull (WM's
    // Destroyer needs Construction 3, OBRM forbids the miner hulls), and some are better when the race starts higher
    // (the requirements of Stars!, before any shift of the tech tree: the starting fleet does not depend on the draw)
    const has = (t: { req: TechReq } | undefined) => !!t && canLearn(player.race, t.req) && meetsLevels(player.tech, t.req) && !t.req.acquirable;
    const canHull = (n: string) => has(HULLS.get(n));
    let fleets = [...(START_FLEETS[player.race.prt] ?? START_FLEETS.JoaT)];
    if (player.race.lrts.includes('ARM')) fleets.push({ name: 'Potato Bug', hull: 'Midget Miner', purpose: 'miner' }, { name: 'Potato Bug', hull: 'Midget Miner', purpose: 'miner' });
    if (player.race.prt === 'JoaT' && canHull('Privateer')) fleets = fleets.map(f => f.name === 'Teamster' ? { name: 'Swashbuckler', hull: 'Privateer', purpose: 'startingFighter' } : f);
    // the transport cloak does not fit a hull with room for weapons: a stealth scout gets a real cloak, if it has one
    if (player.race.prt === 'SS' && has(TECHS.get('Stealth Cloak'))) fleets = fleets.map(f => f.name === 'Long Range Scout' ? { name: 'Shadow Sleuth', hull: 'Scout', purpose: 'scout', part: 'Stealth Cloak' } : f);
    fleets = fleets.filter(f => canHull(f.hull));
    for (const sf of fleets) {
      let id = made.get(sf.name);
      if (id === undefined) {
        const label = START_DESIGN_LABELS[sf.name] ?? sf.name;
        const d = autoDesign(player, sf.hull, sf.purpose, label) ?? autoDesign(player, 'Scout', 'scout', label);
        if (!d) continue;
        const extra = sf.part ? TECHS.get(sf.part) : undefined;
        if (extra && has(extra)) {
          const h = HULLS.get(d.hull)!;
          const at = h.slots.findIndex(sl => !sl.types.includes('Engine') && partFitsSlot(extra, sl.types, h.name));
          if (at >= 0) { d.slots = d.slots.filter(x => x.slot !== at + 1); d.slots.push({ slot: at + 1, part: extra.name, qty: 1 }); }
        }
        id = addDesign(game, d).id;
        made.set(sf.name, id);
      }
      newFleet(game, player, id, 1, hw);
    }
    // a few extra useful designs (as in Stars!, a starting library)
    const extras: { name: string; hull: string; purpose: Purpose }[] = [
      { name: 'Long Range Scout', hull: 'Scout', purpose: 'scout' }, { name: 'Santa Maria', hull: 'Colony Ship', purpose: 'colonizer' },
      { name: 'Teamster', hull: 'Medium Freighter', purpose: 'freighter' }, { name: 'Cotton Picker', hull: 'Mini-Miner', purpose: 'miner' },
    ];
    for (const e of extras) {
      if (made.has(e.name)) continue;
      const d = autoDesign(player, e.hull, e.purpose, START_DESIGN_LABELS[e.name] ?? e.name);
      if (d) { addDesign(game, d); made.set(e.name, d.id); }
    }
    if (rs.livesOnStarbases) {
      starbaseDesignFor(game, player, 'Orbital Fort', 'starterColony', 'Colonie de départ');
    } else {
      starbaseDesignFor(game, player, 'Orbital Fort', 'fort', 'Fortin');
    }
    // default production
    hw.queue = [
      { kind: 'autoFactories', qty: 100, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } },
      { kind: 'autoMines', qty: 100, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } },
    ];
    if (rs.livesOnStarbases) hw.queue = [];
    // PP / IT second world
    if ((player.race.prt === 'PP' || player.race.prt === 'IT') && settings.size !== 'Tiny') {
      const min = W * 0.12, max = W * 0.35;
      const cands = game.planets.filter(p => p.owner < 0 && !homes.includes(p) && Math.hypot(p.x - hw.x, p.y - hw.y) >= min && Math.hypot(p.x - hw.x, p.y - hw.y) <= max);
      const second = cands.length ? rng.pick(cands) : null;
      if (second) {
        initHomeworld(game, rng, player, second, sharedConc, true);
        const name = player.race.prt === 'PP' ? 'Plateforme accélératrice' : 'Portail vers l\'au-delà';
        const sd = starbaseDesignFor(game, player, 'Orbital Fort', player.race.prt === 'PP' ? 'packetThrower' : 'stargater', name);
        second.starbase = { designId: sd.id, damage: 0 };
        newFleet(game, player, made.get('Long Range Scout')!, 1, second);
        second.queue = [{ kind: 'autoFactories', qty: 50, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }, { kind: 'autoMines', qty: 50, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }];
      }
    }
    // research: start on the lowest/cheapest field
    player.researching = FIELDS.reduce((a, f) => player.tech[f] < player.tech[a] ? f : a, 'energy' as typeof FIELDS[number]);
  });
  game.wormholes = generateWormholes(rng, game, WORMHOLE_PAIRS[settings.size]);
  // Constellations 3 terrain: its own random stream, so the rest of the universe is the same with or without it
  game.terrain = settings.terrain ? generateTerrain(game) : [];
  // Constellations 3: seats of government and secret objectives
  for (const p of game.players) { const hw = game.planets.find(pl => pl.owner === p.id && pl.homeworld); if (hw) p.capital = hw.id; }
  if (settings.secretObjectives) assignObjectives(game);
  // Constellations 3.2: discoveries, guardians, origins (own random streams)
  if (settings.anomalies) generateAnomalies(game);
  if (settings.guardians) placeGuardians(game);
  // 0.3.7: the hidden stars (own random stream; the sanctuary of the Ancients moves to one of them)
  if (settings.anomalies) generateSecrets(game);
  applyOrigins(game);
  if (settings.culture) initCulture(game);
  if (settings.governors) initGovernors(game);
  if (settings.culture) for (const p of game.players) ensureBeaconCarrier(game, p);
  // Constellations 3.4: the pirates (they appear later)
  if (settings.pirates) initPirates(game);
  if (settings.crisis) initCrisis(game);
  if (settings.diplomacy) initDiplomacy(game);
  // initial intel
  for (const p of game.players) {
    p.intel = emptyIntel(game);
    p.messages = [];
  }
  updateIntel(game, true);
  originIntel(game);
  discoverAnomalies(game, true);
  for (const p of game.players) {
    if (p.monster) continue;
    const hw = game.planets.find(pl => pl.owner === p.id && pl.homeworld);
    p.messages.unshift({ year: game.year, kind: 'info', text: `Bienvenue, ${p.name}. Votre monde natal ${hw?.name ?? ''} vous attend. Envoyez vos éclaireurs explorer la galaxie.`, target: hw ? { kind: 'planet', id: hw.id } : undefined });
  }
  return game;
}

export function aiRace(rng: Rng, i: number): Race {
  const r = AI_RACES[i % AI_RACES.length]();
  return r;
}

export function quickGame(humanRace: Race = PREDEFINED_RACES.Humanoid(), size: GameSettings['size'] = 'Small', aiCount = 3, difficulty: AIDifficulty = 'standard', seed?: string, extra?: Partial<GameSettings>): GameState {
  const settings = { ...defaultSettings(), ...extra };
  settings.size = size;
  if (seed) settings.seed = seed;
  const rng = new Rng(seedFromString(settings.seed + 'ai'));
  const players: NewPlayerConfig[] = [{ race: humanRace, ai: null }];
  const order = rng.shuffle(AI_RACES.map((_, i) => i));
  for (let i = 0; i < aiCount; i++) players.push({ race: AI_RACES[order[i % order.length]](), ai: difficulty });
  return createGame({ name: 'Partie rapide', settings, players });
}

/** 0.3.8: the tutorial always plays on this map (chosen for a habitable world next door and two more within reach). */
export const TUTORIAL_SEED = 'tutoriel-28';

/**
 * 0.3.8: the tutorial's game: the Terriens in a small spiral arm, two easy empires far away, every rule of
 * Constellations on (what the player learns is the real game). The worlds the steps point at are chosen here, from
 * the map itself: the best analysed world next door (first colony), then the two best unknown worlds within reach of
 * the scouts.
 */
export function tutorialGame(): GameState {
  const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 2, 'easy', TUTORIAL_SEED, { shape: 'arm', popUnits: 'millions', positions: 'Distant' });
  g.name = 'Tutoriel';
  const me = g.players[0];
  const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
  const dist = (p: Planet) => Math.hypot(p.x - hw.x, p.y - hw.y);
  const val = (p: Planet) => habitabilityOf(me.race, p.hab);
  const free = g.planets.filter(p => p.owner < 0 && !p.hidden && dist(p) <= 60);
  const known = (p: Planet) => me.intel.planets[p.id]?.year !== undefined;
  const colony = [...free.filter(known)].sort((a, b) => val(b) - val(a) || dist(a) - dist(b))[0] ?? free[0];
  const unknown = free.filter(p => !known(p) && p !== colony).sort((a, b) => (val(b) > 0 ? 1 : 0) - (val(a) > 0 ? 1 : 0) || dist(a) - dist(b));
  const scout = [...unknown].sort((a, b) => val(b) - val(a))[0] ?? free[1];
  const probe = unknown.filter(p => p !== scout).sort((a, b) => val(b) - val(a))[0] ?? free[2];
  const mine = g.fleets.filter(f => f.owner === me.id);
  const specOf = (f: Fleet) => designSpec(me, g.designs.find(d => d.id === f.tokens[0].designId)!);
  const scoutFleet = mine.find(f => { const s = specOf(f); return s.scanRange > 0 && !s.hasWeapons && !s.colonyModule && s.cargoCapacity === 0; }) ?? mine[0];
  // the other scout (the Humanoids' armed probe): the farthest-reaching ship with a scanner, after the scout
  const probeFleet = mine.filter(f => f !== scoutFleet && specOf(f).scanRange > 0 && specOf(f).cargoCapacity === 0 && !specOf(f).colonyModule && specOf(f).numEngines > 0)
    .sort((a, b) => specOf(b).estimatedRange - specOf(a).estimatedRange)[0] ?? scoutFleet;
  const arkFleet = mine.find(f => specOf(f).colonyModule) ?? mine[0];
  g.tutorial = { chapter: 'start', step: 0, done: [], targets: { colony: colony.id, scout: scout.id, probe: probe.id, scoutFleet: scoutFleet.id, probeFleet: probeFleet.id, arkFleet: arkFleet.id, startFleets: mine.map(f => f.id), startDesigns: g.designs.filter(d => d.owner === me.id).map(d => d.id) } };
  return g;
}
