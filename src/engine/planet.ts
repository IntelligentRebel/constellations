// Planet economics: habitability, population, resources, mining, defenses, scanners, terraforming.
import type { GameState, Hab, Minerals, Planet, Player } from './types';
import { MINERALS } from './types';
import { habitability, raceSpec } from './race';
import { TECH_DATA } from '../data/techs';
import { hasTech } from './tech';
import { designSpec, getDesign, type DesignSpec } from './design';
import { efficiency, type Efficiency } from './empire';
import { hasDoctrine } from './doctrines';
import { megaScanner } from './megaprojects';
import { hasRelic } from './relics';
import { govBonus } from './governors';

export const MAX_POP = 1_000_000;
const roundTo100Floor = (x: number) => Math.floor(x / 100) * 100;
const roundTo100 = (x: number) => Math.round(x / 100) * 100;

export function planetHab(player: Player, planet: { hab: Hab }): number {
  return habitability(player.race, planet.hab);
}

export function maxPopulation(game: GameState, player: Player, planet: Planet, hab = planetHab(player, planet)): number {
  const rs = raceSpec(player.race);
  if (rs.livesOnStarbases && planet.owner === player.id) {
    if (!planet.starbase) return 0;
    const spec = starbaseSpec(game, planet);
    return roundTo100Floor((spec?.maxPop ?? 0) * rs.maxPopFactor);
  }
  const h = Math.max(hab, rs.minHabFloor);
  return roundTo100Floor(MAX_POP * h * rs.maxPopFactor * (hasDoctrine(player, 'arcology') ? 1.1 : 1) / 100);
}

/** Yearly population change for the planet owner (may be negative). */
export function growthAmount(game: GameState, player: Player, planet: Planet): number {
  const pop = planet.pop;
  if (pop <= 0) return 0;
  const hab = planetHab(player, planet);
  if (hab < 0 && !raceSpec(player.race).livesOnStarbases) return Math.round(pop * hab / 1000);
  const maxPop = maxPopulation(game, player, planet, hab);
  if (maxPop <= 0) return -pop;
  const capacity = pop / maxPop;
  if (capacity > 1) {
    const dieoff = Math.max(0, Math.min((capacity - 1) * 0.04, 0.12));
    return Math.round(pop * -dieoff);
  }
  const rs = raceSpec(player.race);
  const bonus = (hasDoctrine(player, 'natality') ? 1.15 : 1) * (hasRelic(player, 'seed') ? 1.15 : 1) * ((player.origin === 'doomed' || player.origin === 'exiles') && game.year < 2450 ? 1.25 : 1);
  let growth = Math.round(pop * player.race.growthRate * Math.max(hab, rs.livesOnStarbases ? rs.minHabFloor : 0) * rs.growthFactor * bonus / 10000);
  if (capacity > 0.25) growth = growth * (1 - capacity) * (1 - capacity) * 16 / 9;
  return Math.trunc(growth);
}

/**
 * 0.3.6.6: what taking `taken` colonists (population units) from one's own world costs it, in years of growth. Below a
 * quarter of its capacity a world grows in proportion to its population (each colonist taken is a year's interest
 * lost, compounded); above, crowding slows it down and a colonist taken costs nearly nothing (it will grow faster on
 * a new world). Null when the world has nothing to lose (it does not grow, or the colonists come from its crowded part).
 */
export function colonistSetback(game: GameState, player: Player, planet: Planet, taken: number): number | null {
  const pop = planet.pop, after = pop - taken;
  if (taken <= 0 || pop <= 0) return null;
  const hab = planetHab(player, planet);
  const maxPop = maxPopulation(game, player, planet, hab);
  if (hab <= 0 || maxPop <= 0) return null;
  // only what is taken below a quarter of the capacity counts
  const lost = Math.min(taken, Math.max(0, maxPop / 4 - after));
  if (lost <= 0) return null;
  if (after <= 0) return Infinity;
  const rs = raceSpec(player.race);
  const bonus = (hasDoctrine(player, 'natality') ? 1.15 : 1) * (hasRelic(player, 'seed') ? 1.15 : 1) * ((player.origin === 'doomed' || player.origin === 'exiles') && game.year < 2450 ? 1.25 : 1);
  const rate = player.race.growthRate * hab * rs.growthFactor * bonus / 10000;
  if (rate <= 0) return null;
  return Math.log((after + lost) / after) / Math.log(1 + rate);
}

export interface PlanetSpec {
  hab: number;
  terraformedHab: number;
  maxPop: number;
  growth: number;
  popNextYear: number;
  productivePop: number;
  resources: number;
  /** resources before the administrative efficiency (Constellations 3) */
  resourcesBase: number;
  /** administrative efficiency (distance to a capital, conquest, disorganisation) */
  efficiency: Efficiency;
  resourcesResearch: number;
  resourcesAvailable: number;
  maxFactories: number; // operable
  maxPossibleFactories: number;
  maxMines: number;
  maxPossibleMines: number;
  mining: Minerals;
  maxDefenses: number;
  defenseCoverage: number;
  defenseCoverageSmart: number;
  defenseName: string;
  scanRange: number; // -1 none
  scanRangePen: number;
  scannerName: string;
  starbase: DesignSpec | null;
  terraformRemaining: Hab;
  canTerraform: boolean;
}

export function bestPlanetaryTech(player: Player, cat: 'PlanetaryScanner' | 'PlanetaryDefense') {
  let best = null;
  for (const t of TECH_DATA) if (t.cat === cat && hasTech(player, t)) best = t; // data ordered by strength
  return best;
}

export function starbaseSpec(game: GameState, planet: Planet): DesignSpec | null {
  if (!planet.starbase) return null;
  const d = game.designs.find(x => x.id === planet.starbase!.designId);
  if (!d) return null;
  return designSpec(game.players[d.owner], d);
}

export function terraformAbility(player: Player): Hab {
  const ab: Hab = [0, 0, 0];
  for (const t of TECH_DATA) {
    if (t.cat !== 'Terraforming' || !hasTech(player, t)) continue;
    const a = t.stats?.ability ?? 0, ht = t.stats?.habType;
    if (ht === 'All') { for (let i = 0; i < 3; i++) ab[i] = Math.max(ab[i], a); }
    else { const i = ht === 'Grav' ? 0 : ht === 'Temp' ? 1 : 2; ab[i] = Math.max(ab[i], a); }
  }
  return ab;
}

/** Remaining terraforming (signed clicks per dimension) a player could still apply toward their ideal. */
export function terraformRemaining(player: Player, planet: Planet, enemy = false): Hab {
  const ab = terraformAbility(player);
  const center = raceSpec(player.race).habCenter;
  const res: Hab = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (player.race.immune[i] || ab[i] <= 0) continue;
    const fromIdealBase = center[i] - planet.baseHab[i];
    const fromIdeal = center[i] - planet.hab[i];
    if (enemy) {
      const left = ab[i] - Math.abs(fromIdealBase - fromIdeal);
      res[i] = fromIdeal >= 0 ? -left : left;
    } else if (fromIdeal > 0) res[i] = Math.max(0, Math.min(ab[i] - (fromIdealBase - fromIdeal), fromIdeal));
    else if (fromIdeal < 0) res[i] = Math.min(0, Math.max(-(ab[i] - (fromIdeal - fromIdealBase)), fromIdeal));
  }
  return res;
}

export function terraformedHabValue(player: Player, planet: Planet): number {
  const rem = terraformRemaining(player, planet);
  const h: Hab = [planet.hab[0] + rem[0], planet.hab[1] + rem[1], planet.hab[2] + rem[2]];
  return habitability(player.race, h);
}

/** Apply one click of terraforming toward the owner's ideal. Returns true if something changed. */
export function terraformOneStep(player: Player, planet: Planet): boolean {
  const ab = terraformAbility(player);
  const center = raceSpec(player.race).habCenter;
  let bestI = -1, bestDir = 0, bestScore = -Infinity, sawRed = false;
  const curHab = habitability(player.race, planet.hab);
  for (let i = 0; i < 3; i++) {
    if (player.race.immune[i] || ab[i] <= 0) continue;
    if (Math.abs(planet.terraformed[i]) >= ab[i] && Math.sign(center[i] - planet.hab[i]) === Math.sign(planet.terraformed[i])) continue;
    const diff = center[i] - planet.hab[i];
    if (diff === 0) continue;
    const dir = Math.sign(diff);
    const next = planet.terraformed[i] + dir;
    if (Math.abs(next) > ab[i]) continue;
    const lo = player.race.habLow[i], hi = player.race.habHigh[i];
    const red = planet.hab[i] < lo || planet.hab[i] > hi;
    const h: Hab = [...planet.hab] as Hab; h[i] += dir;
    const score = red ? 1000 - Math.min(Math.abs(planet.hab[i] - lo), Math.abs(planet.hab[i] - hi)) : habitability(player.race, h) - curHab + Math.abs(diff) / 1000;
    if (red && !sawRed) { sawRed = true; bestScore = -Infinity; }
    if (sawRed && !red) continue;
    if (score > bestScore) { bestScore = score; bestI = i; bestDir = dir; }
  }
  if (bestI < 0) return false;
  planet.terraformed[bestI] += bestDir;
  planet.hab[bestI] = Math.max(0, Math.min(100, planet.hab[bestI] + bestDir));
  return true;
}

export function planetSpec(game: GameState, planet: Planet, player: Player = game.players[planet.owner]): PlanetSpec {
  const rs = raceSpec(player.race);
  const race = player.race;
  const hab = planetHab(player, planet);
  const maxPop = maxPopulation(game, player, planet, hab);
  const pop = planet.owner === player.id ? planet.pop : 0;
  const growth = planet.owner === player.id ? growthAmount(game, player, planet) : 0;
  const popNextYear = roundTo100Floor(pop + growth);
  const popOver = pop + Math.max(0, (pop - maxPop) * 0.5);
  const productivePop = roundTo100Floor(Math.min(maxPop * 2, popOver));
  const installationPop = Math.min(pop, maxPop);
  let resources: number, maxFactories = 0, maxPossibleFactories = 0, maxMines = 0, maxPossibleMines = 0;
  let mining: Minerals = { ironium: 0, boranium: 0, germanium: 0 };
  if (rs.innate) {
    resources = Math.ceil(Math.max(hab, rs.minHabFloor) / 100 * Math.sqrt(productivePop * player.tech.energy / race.popEfficiency));
    const innateMines = Math.trunc(Math.sqrt(pop) * 0.1);
    mining = mineOutput(game, planet, innateMines, 10);
  } else {
    const fromPop = Math.trunc(productivePop / (race.popEfficiency * 100));
    maxFactories = Math.max(1, Math.trunc(installationPop * race.numFactories / 10000));
    maxPossibleFactories = Math.max(10, Math.trunc(maxPop * race.numFactories / 10000));
    const fromFactories = Math.ceil(Math.min(planet.factories, maxFactories) * race.factoryOutput / 10);
    resources = fromPop + fromFactories;
    maxMines = Math.max(1, Math.trunc(installationPop * race.numMines / 10000));
    maxPossibleMines = Math.max(10, Math.trunc(maxPop * race.numMines / 10000));
    mining = mineOutput(game, planet, Math.min(planet.mines, maxMines), race.mineOutput);
  }
  if (pop <= 0) { resources = 0; mining = { ironium: 0, boranium: 0, germanium: 0 }; }
  if (hasRelic(player, 'forge') && planet.owner === player.id) mining = { ironium: Math.floor(mining.ironium * 1.1), boranium: Math.floor(mining.boranium * 1.1), germanium: Math.floor(mining.germanium * 1.1) };
  if (hasRelic(player, 'heart') && planet.owner === player.id) resources = Math.floor(resources * 1.1);
  // 3.4: trade treaties
  const trade = planet.owner === player.id ? game.diplomacy?.bonus?.[player.id]?.trade : undefined;
  if (trade) resources = Math.floor(resources * (1 + trade));
  // 0.3.9: a golden age (golden.ts): 15 % more
  if (game.settings.goldenAges && game.settings.culture && planet.owner === player.id && (player.golden?.until ?? 0) >= game.year) resources = Math.floor(resources * 1.15);
  // 0.3.9: the talents of a sector governor (governors.ts)
  if (game.settings.governors && planet.owner === player.id && planet.sector !== undefined) {
    const st = govBonus(game, planet, 'steward'), pr = govBonus(game, planet, 'prospector');
    if (st) resources = Math.floor(resources * (1 + st));
    if (pr) mining = { ironium: Math.floor(mining.ironium * (1 + pr)), boranium: Math.floor(mining.boranium * (1 + pr)), germanium: Math.floor(mining.germanium * (1 + pr)) };
  }
  const resourcesBase = resources;
  const eff = efficiency(game, player, planet);
  if (eff.total < 1) resources = Math.floor(resources * eff.total);
  resources += planet.bonusResources ?? 0;
  const resourcesResearch = planet.leftoverOnly ? 0 : Math.trunc(resources * player.researchPct / 100);
  const def = rs.canBuildDefenses ? bestPlanetaryTech(player, 'PlanetaryDefense') : null;
  const maxDefenses = rs.canBuildDefenses ? Math.max(10, Math.min(100, 4 * hab)) : 0;
  const c = (def?.stats?.defenseCoverage ?? 0) / 100;
  const n = Math.max(0, Math.min(planet.defenses, maxDefenses));
  const defenseCoverage = 1 - Math.pow(1 - c, n);
  const defenseCoverageSmart = 1 - Math.pow(1 - c * 0.5, n);
  let scanRange = -1, scanRangePen = -1, scannerName = '';
  if (rs.innate) {
    scanRange = Math.trunc(Math.sqrt(productivePop * 0.1)) * rs.scanRangeFactor;
    scannerName = 'Organique';
    const sb = starbaseSpec(game, planet);
    const sbHull = sb ? sb.hull : '';
    if (sbHull === 'Ultra Station' || sbHull === 'Death Star') scanRangePen = rs.noAdvancedScanners ? -1 : Math.trunc(scanRange * 0.5);
  } else if (planet.scanner) {
    const sc = bestPlanetaryTech(player, 'PlanetaryScanner');
    if (sc) {
      scanRange = Math.trunc((sc.stats?.scanRange ?? 0) * rs.scanRangeFactor);
      scanRangePen = sc.stats?.scanRangePen ? sc.stats.scanRangePen : -1;
      scannerName = sc.name;
    }
  } else if (planet.owner === player.id) {
    scanRange = 0;
  }
  if (hasDoctrine(player, 'sensors') && planet.owner === player.id) {
    if (scanRange > 0) scanRange = Math.round(scanRange * 1.25);
    if (scanRangePen > 0) scanRangePen = Math.round(scanRangePen * 1.25);
  }
  if (hasRelic(player, 'eye') && planet.owner === player.id) {
    if (scanRange > 0) scanRange = Math.round(scanRange * 1.25);
    if (scanRangePen > 0) scanRangePen = Math.round(scanRangePen * 1.25);
  }
  const mega = planet.owner === player.id ? megaScanner(game, planet) : null;
  if (mega) { scanRange = Math.max(scanRange, mega.range); scanRangePen = Math.max(scanRangePen, mega.pen); if (!scannerName) scannerName = 'Grand Observatoire'; }
  const tr = terraformRemaining(player, planet);
  return {
    hab, terraformedHab: terraformedHabValue(player, planet), maxPop, growth, popNextYear, productivePop,
    resources, resourcesBase, efficiency: eff, resourcesResearch, resourcesAvailable: resources - resourcesResearch,
    maxFactories, maxPossibleFactories, maxMines, maxPossibleMines, mining,
    maxDefenses, defenseCoverage, defenseCoverageSmart, defenseName: def?.name ?? 'Aucune',
    scanRange, scanRangePen, scannerName,
    starbase: starbaseSpec(game, planet),
    terraformRemaining: tr, canTerraform: tr.some(x => x !== 0),
  };
}

export function mineOutput(game: GameState, planet: Planet, numMines: number, output: number): Minerals {
  const res: Minerals = { ironium: 0, boranium: 0, germanium: 0 };
  for (const m of MINERALS) {
    let conc = planet.conc[m];
    if (planet.homeworld && planet.owner >= 0) conc = Math.max(conc, 30);
    res[m] = Math.trunc(conc * numMines * output / 1000);
  }
  return res;
}

/** Apply mining: adds minerals and slowly lowers concentrations. */
export function applyMining(planet: Planet, output: Minerals, numMines: number) {
  for (const m of MINERALS) {
    planet.surface[m] += output[m];
    planet.mineYears[m] += numMines;
    const conc = Math.max(planet.conc[m], 1);
    const rollover = 1_500_000 / (conc * conc);
    if (planet.mineYears[m] > rollover) {
      const newConc = Math.max(1, conc - Math.trunc(planet.mineYears[m] / rollover));
      planet.mineYears[m] = newConc === 1 ? 0 : planet.mineYears[m] % rollover;
      planet.conc[m] = planet.homeworld ? Math.max(newConc, 0) : newConc;
    }
  }
}

export function popDisplay(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

export function ownerSpecForPlanet(game: GameState, planet: Planet): PlanetSpec | null {
  if (planet.owner < 0) return null;
  return planetSpec(game, planet);
}

export { roundTo100, roundTo100Floor, getDesign };
