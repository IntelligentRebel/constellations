// Production queues (Stars! rules: per-planet queue, auto-build items, partial builds, alchemy).
import type { Cost, GameState, Planet, Player, QueueItem, QueueKind, ShipDesign } from './types';
import { MINERALS } from './types';
import { raceSpec } from './race';
import { designCost, designSpec, starbaseUpgradeCost } from './design';
import { planetSpec, terraformOneStep, terraformRemaining, bestPlanetaryTech } from './planet';
import { hasTech, TECHS } from './tech';
import { REGIONAL_COST, regionalBlocker, distanceCostOn } from './empire';
import { MEGA, megaList, megaBlocker, megaCompleted, megaOn, megaYearCap, hasMega, megaVisible, portalPaused, relaysOf, RELAYS_NEEDED, type MegaId } from './megaprojects';
import { refitStatus, refitUnitCost } from './refit';
import { BOUNTY_UNIT, bountyBlocker, placeBounty } from './pirates';
import { SPY_UNIT, SPY_MAX, AGENCY_COST, spyBlocker, spyGain, placeSpies, agencyBlocker, buildAgency, intelOn } from './espionage';
import { CULTURE_BUILDING, CULTURE_BUILDINGS, PATRONAGE, cultureOn, hasReq, reqText, type CultureBuildingId } from './culture';
import { patronageInspiration } from './golden';
import { people } from './words';
import { govBonus, governed } from './governors';

export const QUEUE_LABELS: Record<QueueKind, string> = {
  ship: 'Vaisseau', starbase: 'Station orbitale', factory: 'Usine', mine: 'Mine', defenses: 'Défenses', alchemy: 'Alchimie minérale',
  terraform: 'Terraformation', scanner: 'Scanner planétaire', packetI: 'Paquet d\'Ironium', packetB: 'Paquet de Boranium',
  packetG: 'Paquet de Germanium', packetMixed: 'Paquet mixte', genesis: 'Créateur de mondes',
  autoFactories: 'Usines (auto)', autoMines: 'Mines (auto)', autoDefenses: 'Défenses (auto)', autoAlchemy: 'Alchimie (auto)',
  autoMinTerraform: 'Terraformation min. (auto)', autoMaxTerraform: 'Terraformation max. (auto)', autoPackets: 'Paquets (auto)',
  capital: 'Capitale régionale', mega: 'Mégaprojet', refit: 'Modernisation',
  culture: 'Bâtiment culturel', patronage: 'Mécénat', autoPatronage: 'Mécénat (auto)',
  bounty: 'Prime',
  spy: 'Réseau d\'espions', agency: 'Agence de renseignement',
};

export const AUTO_KINDS: QueueKind[] = ['autoFactories', 'autoMines', 'autoDefenses', 'autoAlchemy', 'autoMinTerraform', 'autoMaxTerraform', 'autoPackets', 'autoPatronage'];
export const isAuto = (k: QueueKind) => AUTO_KINDS.includes(k);
/** 3.6: an automatic item only starts a unit the world can finish within this many years of production. */
export const AUTO_PATIENCE = 5;

export const zeroCost = (): Cost => ({ ironium: 0, boranium: 0, germanium: 0, resources: 0 });

export function itemLabel(game: GameState, item: { kind: QueueKind; designId?: number; megaId?: string; fromDesignId?: number; cultureId?: string; bountyOn?: number }): string {
  if (item.kind === 'bounty') return `Prime contre les ${game.players[item.bountyOn ?? -1]?.name ?? '?'}`;
  if (item.kind === 'spy') return `Espions chez les ${game.players[item.bountyOn ?? -1]?.name ?? '?'}`;
  if (item.kind === 'culture') return CULTURE_BUILDING[item.cultureId as CultureBuildingId]?.name ?? QUEUE_LABELS.culture;
  if (item.kind === 'mega') return MEGA[item.megaId as MegaId]?.name ?? QUEUE_LABELS.mega;
  if (item.kind === 'refit') {
    const a = game.designs.find(x => x.id === item.fromDesignId), b = game.designs.find(x => x.id === item.designId);
    return `Modernisation ${a?.name ?? '?'} → ${b?.name ?? '?'}`;
  }
  if ((item.kind === 'ship' || item.kind === 'starbase') && item.designId !== undefined) {
    const d = game.designs.find(x => x.id === item.designId);
    return d ? d.name : '(modèle supprimé)';
  }
  return QUEUE_LABELS[item.kind];
}

/** Cost of one unit of a production item for the owner of a planet. */
export function unitCost(game: GameState, planet: Planet, player: Player, item: { kind: QueueKind; designId?: number; megaId?: string; fromDesignId?: number; cultureId?: string }): Cost {
  const c = baseUnitCost(game, planet, player, item);
  // 0.3.9: the talents of a sector governor (governors.ts)
  if (game.settings.governors && planet.sector !== undefined) {
    const k = item.kind;
    const b = k === 'factory' || k === 'autoFactories' || k === 'mine' || k === 'autoMines' ? govBonus(game, planet, 'builder')
      : k === 'defenses' || k === 'autoDefenses' || k === 'starbase' ? govBonus(game, planet, 'warden') : 0;
    if (b > 0) return { ironium: Math.round(c.ironium * (1 - b)), boranium: Math.round(c.boranium * (1 - b)), germanium: Math.round(c.germanium * (1 - b)), resources: Math.max(1, Math.round(c.resources * (1 - b))) };
  }
  return c;
}

function baseUnitCost(game: GameState, planet: Planet, player: Player, item: { kind: QueueKind; designId?: number; megaId?: string; fromDesignId?: number; cultureId?: string }): Cost {
  const rs = raceSpec(player.race);
  const race = player.race;
  const defOffset = 1 + (rs.techCostOffset['Defense'] ?? 0);
  switch (item.kind) {
    case 'ship': {
      const d = game.designs.find(x => x.id === item.designId);
      if (!d) return zeroCost();
      const c = designCost(player, d);
      // Constellations 3: the Chantier stellaire megaproject
      return hasMega(planet, 'shipyard') ? { ...c, resources: Math.ceil(c.resources * 0.8) } : c;
    }
    case 'starbase': {
      const d = game.designs.find(x => x.id === item.designId);
      if (!d) return zeroCost();
      if (planet.starbase) {
        const old = game.designs.find(x => x.id === planet.starbase!.designId);
        if (old) return starbaseUpgradeCost(player, old, d);
      }
      return designCost(player, d);
    }
    case 'factory': case 'autoFactories': return { ironium: 0, boranium: 0, germanium: race.factoriesCostLess ? 3 : 4, resources: race.factoryCost };
    case 'mine': case 'autoMines': return { ironium: 0, boranium: 0, germanium: 0, resources: race.mineCost };
    case 'defenses': case 'autoDefenses': return { ironium: Math.trunc(5 * defOffset), boranium: Math.trunc(5 * defOffset), germanium: Math.trunc(5 * defOffset), resources: Math.trunc(15 * defOffset) };
    case 'alchemy': case 'autoAlchemy': return { ironium: 0, boranium: 0, germanium: 0, resources: rs.alchemyCost };
    case 'terraform': case 'autoMinTerraform': case 'autoMaxTerraform': return { ironium: 0, boranium: 0, germanium: 0, resources: Math.trunc(100 * (1 + (rs.techCostOffset['Terraforming'] ?? 0))) };
    case 'scanner': return { ironium: 10, boranium: 10, germanium: 70, resources: 100 };
    case 'packetI': return { ironium: Math.trunc(rs.packetMineralsSingle * rs.packetMineralCostFactor), boranium: 0, germanium: 0, resources: rs.packetResourceCost };
    case 'packetB': return { ironium: 0, boranium: Math.trunc(rs.packetMineralsSingle * rs.packetMineralCostFactor), germanium: 0, resources: rs.packetResourceCost };
    case 'packetG': return { ironium: 0, boranium: 0, germanium: Math.trunc(rs.packetMineralsSingle * rs.packetMineralCostFactor), resources: rs.packetResourceCost };
    case 'packetMixed': case 'autoPackets': {
      const m = Math.trunc(rs.packetMineralsMixed * rs.packetMineralCostFactor);
      return { ironium: m, boranium: m, germanium: m, resources: rs.packetResourceCost };
    }
    case 'genesis': return { ironium: 0, boranium: 0, germanium: 0, resources: 5000 };
    case 'capital': return { ...REGIONAL_COST };
    case 'mega': { const m = MEGA[item.megaId as MegaId]; return m ? { ...m.cost } : zeroCost(); }
    case 'refit': return refitUnitCost(game, player, item.fromDesignId ?? -1, item.designId ?? -1);
    case 'culture': { const b = CULTURE_BUILDING[item.cultureId as CultureBuildingId]; return b ? { ...b.cost } : zeroCost(); }
    case 'patronage': case 'autoPatronage': return { ...PATRONAGE.cost };
    case 'bounty': return { ironium: 0, boranium: 0, germanium: 0, resources: BOUNTY_UNIT };
    case 'spy': return { ironium: 0, boranium: 0, germanium: 0, resources: SPY_UNIT };
    case 'agency': return { ...AGENCY_COST };
  }
}

export function canBuildShip(game: GameState, planet: Planet, design: ShipDesign): string | null {
  if (design.alien) return 'modèle impossible à reproduire';
  if (!planet.starbase) return 'aucune station avec chantier';
  const sb = game.designs.find(x => x.id === planet.starbase!.designId);
  if (!sb) return 'base inconnue';
  const sbs = designSpec(game.players[planet.owner], sb);
  if (sbs.dock === 0) return 'la station n\'a pas de chantier spatial';
  const ds = designSpec(game.players[planet.owner], design);
  if (sbs.dock > 0 && ds.mass > sbs.dock && !hasMega(planet, 'shipyard')) return `masse ${ds.mass} kt > capacité du chantier ${sbs.dock} kt`;
  return null;
}

export function hasMassDriver(game: GameState, planet: Planet): boolean {
  if (!planet.starbase) return false;
  const sb = game.designs.find(x => x.id === planet.starbase!.designId);
  return !!sb && !!designSpec(game.players[planet.owner], sb).driver;
}

/** Items the owner can add to this planet's queue. */
export function availableItems(game: GameState, planet: Planet): { kind: QueueKind; designId?: number; megaId?: string; cultureId?: string; bountyOn?: number; label: string; disabled?: string }[] {
  const player = game.players[planet.owner];
  const rs = raceSpec(player.race);
  const res: { kind: QueueKind; designId?: number; megaId?: string; cultureId?: string; bountyOn?: number; label: string; disabled?: string }[] = [];
  // designs one cannot reproduce (restored wrecks, captured or alien ships) are flown, never built (3.3.8)
  for (const d of game.designs.filter(x => x.owner === player.id && !x.deleted && !x.alien && !x.starbase)) {
    res.push({ kind: 'ship', designId: d.id, label: d.name, disabled: canBuildShip(game, planet, d) ?? undefined });
  }
  for (const d of game.designs.filter(x => x.owner === player.id && !x.deleted && !x.alien && x.starbase && x.purpose !== 'beacon')) {
    res.push({ kind: 'starbase', designId: d.id, label: d.name, disabled: planet.starbase?.designId === d.id ? 'déjà en place' : undefined });
  }
  if (!rs.livesOnStarbases) {
    // 3.6: greyed out once the planet holds all it can (what is already queued included)
    for (const kind of ['factory', 'mine', 'defenses'] as const) {
      const r = installationRoom(game, planet, kind)!;
      res.push({ kind, label: QUEUE_LABELS[kind], disabled: r.left > 0 ? undefined : r.have >= r.max ? `maximum atteint (${r.max})` : `${r.queued} déjà en file : la planète n'en accueille pas plus de ${r.max}, existants compris` });
    }
  }
  res.push({ kind: 'alchemy', label: QUEUE_LABELS.alchemy });
  const spec = planetSpec(game, planet);
  if (spec.canTerraform || terraformAnyAbility(player)) res.push({ kind: 'terraform', label: QUEUE_LABELS.terraform, disabled: spec.canTerraform ? undefined : 'aucune amélioration possible' });
  if (!rs.livesOnStarbases) res.push({ kind: 'scanner', label: QUEUE_LABELS.scanner, disabled: planet.scanner ? 'déjà construit' : (bestPlanetaryTech(player, 'PlanetaryScanner') ? undefined : 'technologie manquante') });
  if (hasMassDriver(game, planet)) {
    res.push({ kind: 'packetI', label: QUEUE_LABELS.packetI }, { kind: 'packetB', label: QUEUE_LABELS.packetB }, { kind: 'packetG', label: QUEUE_LABELS.packetG }, { kind: 'packetMixed', label: QUEUE_LABELS.packetMixed });
  }
  const genesis = TECHS.get('Genesis Device');
  if (genesis && hasTech(player, genesis)) res.push({ kind: 'genesis', label: QUEUE_LABELS.genesis });
  if (!rs.livesOnStarbases) res.push({ kind: 'autoFactories', label: QUEUE_LABELS.autoFactories }, { kind: 'autoMines', label: QUEUE_LABELS.autoMines }, { kind: 'autoDefenses', label: QUEUE_LABELS.autoDefenses });
  res.push({ kind: 'autoAlchemy', label: QUEUE_LABELS.autoAlchemy });
  res.push({ kind: 'autoMinTerraform', label: QUEUE_LABELS.autoMinTerraform }, { kind: 'autoMaxTerraform', label: QUEUE_LABELS.autoMaxTerraform });
  if (hasMassDriver(game, planet)) res.push({ kind: 'autoPackets', label: QUEUE_LABELS.autoPackets });
  // Constellations 3
  if (distanceCostOn(game) && !planet.queue.some(q => q.kind === 'capital')) res.push({ kind: 'capital', label: QUEUE_LABELS.capital, disabled: regionalBlocker(game, planet) ?? undefined });
  if (megaOn(game)) for (const m of megaList(game)) {
    if (hasMega(planet, m.id) || !megaVisible(player, m)) continue;
    if (m.id === 'seal' && player.secretKnown === undefined) continue;
    res.push({ kind: 'mega', megaId: m.id, label: m.name, disabled: megaBlocker(game, planet, m.id) ?? undefined });
  }
  // Constellations 3.3: culture
  if (cultureOn(game)) {
    for (const b of CULTURE_BUILDINGS) {
      if ((planet.cultureBld ?? []).includes(b.id)) continue;
      res.push({ kind: 'culture', cultureId: b.id, label: b.name, disabled: !hasReq(player, b.req) ? `il faut ${reqText(b.req)}` : planet.queue.some(q => q.kind === 'culture' && q.cultureId === b.id) ? 'déjà dans la file' : undefined });
    }
    const pat = hasReq(player, PATRONAGE.req) ? undefined : `il faut ${reqText(PATRONAGE.req)}`;
    res.push({ kind: 'patronage', label: QUEUE_LABELS.patronage, disabled: pat }, { kind: 'autoPatronage', label: QUEUE_LABELS.autoPatronage, disabled: pat });
  }
  // Constellations 3.4: bounties for the pirates
  for (const o of game.players) {
    if (o.id === player.id || o.monster || o.dead || !player.intel.met.includes(o.id) || !game.pirates?.emerged || game.pirates.ended) continue;
    res.push({ kind: 'bounty', bountyOn: o.id, label: itemLabel(game, { kind: 'bounty', bountyOn: o.id }), disabled: bountyBlocker(game, player, o.id) ?? undefined });
  }
  // Constellations 3.5: intelligence
  if (intelOn(game)) {
    if (!planet.agency) res.push({ kind: 'agency', label: QUEUE_LABELS.agency, disabled: agencyBlocker(game, planet) ?? (planet.queue.some(q => q.kind === 'agency') ? 'déjà dans la file' : undefined) });
    for (const o of game.players) {
      if (o.id === player.id || o.monster || o.dead || !player.intel.met.includes(o.id)) continue;
      res.push({ kind: 'spy', bountyOn: o.id, label: itemLabel(game, { kind: 'spy', bountyOn: o.id }), disabled: spyBlocker(game, player, o.id) ?? undefined });
    }
  }
  return res;
}

function terraformAnyAbility(player: Player): boolean {
  return [...TECHS.values()].some(t => t.cat === 'Terraforming' && hasTech(player, t));
}

/** Constellations 3.6: factories, mines and defenses a planet can hold, and how many more may still be queued. */
export function installationRoom(game: GameState, planet: Planet, kind: QueueKind): { max: number; have: number; queued: number; left: number; what: string } | null {
  if (kind !== 'factory' && kind !== 'mine' && kind !== 'defenses') return null;
  const spec = planetSpec(game, planet, game.players[planet.owner]);
  const max = kind === 'factory' ? spec.maxPossibleFactories : kind === 'mine' ? spec.maxPossibleMines : spec.maxDefenses;
  const have = kind === 'factory' ? planet.factories : kind === 'mine' ? planet.mines : planet.defenses;
  const queued = planet.queue.filter(q => q.kind === kind).reduce((a, q) => a + q.qty, 0);
  return { max, have, queued, left: Math.max(0, max - have - queued), what: kind === 'factory' ? 'usines' : kind === 'mine' ? 'mines' : 'défenses' };
}
/** Why the planet holds no more (factories and mines: its maximum population; defenses: 100 at most, fewer on a poor world). */
export const roomWhy = (kind: QueueKind, max: number) => kind === 'defenses' ? (max >= 100 ? '100 défenses au plus' : `${max} défenses au plus sur ce monde peu habitable (100 sur un bon monde)`) : `${max} ${kind === 'factory' ? 'usines' : 'mines'} au plus sur ce monde, selon sa population maximale`;

/** Maximum units of an item that may be built this year on the planet. */
export function maxBuildable(game: GameState, planet: Planet, kind: QueueKind): number {
  const player = game.players[planet.owner];
  const spec = planetSpec(game, planet, player);
  const race = player.race;
  const popNext = Math.min(spec.popNextYear, spec.maxPop);
  switch (kind) {
    // (0.3.9.21: at least one, unless the world takes none at all: an AR colony bought one of each)
    case 'autoMines': return Math.max(0, Math.min(spec.maxPossibleMines, Math.max(1, Math.trunc(race.numMines * popNext / 10000))) - planet.mines);
    case 'autoFactories': return Math.max(0, Math.min(spec.maxPossibleFactories, Math.max(1, Math.trunc(race.numFactories * popNext / 10000))) - planet.factories);
    case 'mine': return Math.max(0, spec.maxPossibleMines - planet.mines);
    case 'factory': return Math.max(0, spec.maxPossibleFactories - planet.factories);
    case 'autoDefenses': return Math.max(0, Math.min(spec.maxDefenses, Math.trunc((popNext + 2499) / 2500)) - planet.defenses);
    case 'defenses': return Math.max(0, spec.maxDefenses - planet.defenses);
    case 'terraform': case 'autoMaxTerraform': return spec.terraformRemaining.reduce((a, b) => a + Math.abs(b), 0);
    case 'autoMinTerraform': return (spec.hab <= 0 || spec.growth < 0) ? spec.terraformRemaining.reduce((a, b) => a + Math.abs(b), 0) : 0;
    case 'starbase': case 'genesis': return 1;
    case 'capital': return regionalBlocker(game, planet) ? 0 : 1;
    case 'mega': return 1;
    case 'scanner': return planet.scanner ? 0 : 1;
    case 'culture': return 1;
    // 0.3.9.21: the units the network can still take (the others were paid for nothing)
    case 'agency': return 1;
    case 'autoPackets': case 'packetI': case 'packetB': case 'packetG': case 'packetMixed':
      return hasMassDriver(game, planet) && planet.packetTarget !== undefined ? Infinity : 0;
    default: return Infinity;
  }
}

export interface ProductionResult {
  built: { kind: QueueKind; designId?: number; qty: number }[];
  leftover: number;
  messages: string[];
  packets: { kind: QueueKind; qty: number }[];
}

const divideCost = (funds: Cost, cost: Cost): number => {
  let n = Infinity;
  for (const k of ['ironium', 'boranium', 'germanium', 'resources'] as const) if (cost[k] > 0) n = Math.min(n, funds[k] / cost[k]);
  return n;
};
const sub = (a: Cost, b: Cost, mul = 1): Cost => ({ ironium: a.ironium - b.ironium * mul, boranium: a.boranium - b.boranium * mul, germanium: a.germanium - b.germanium * mul, resources: a.resources - b.resources * mul });
const add = (a: Cost, b: Cost): Cost => ({ ironium: a.ironium + b.ironium, boranium: a.boranium + b.boranium, germanium: a.germanium + b.germanium, resources: a.resources + b.resources });

/**
 * Runs one year of production on a planet. Mutates the planet's queue, surface minerals and installations.
 * `onBuild` is called for ships/starbases/packets so the caller can create objects.
 */
export function runProduction(game: GameState, planet: Planet, onBuild: (item: QueueItem, qty: number) => void, dryRun = false): ProductionResult {
  const player = game.players[planet.owner];
  const rs = raceSpec(player.race);
  const spec = planetSpec(game, planet, player);
  let available: Cost = { resources: spec.resourcesAvailable, ironium: planet.surface.ironium, boranium: planet.surface.boranium, germanium: planet.surface.germanium };
  const result: ProductionResult = { built: [], leftover: 0, messages: [], packets: [] };
  const queue = planet.queue;
  let alchemyNext = false;
  let i = 0;
  let stop = false;
  // 0.3.9.21: a line the production drops by itself gives back the minerals already put into it (only ships, alien
  // stations and refits did; a capped factory order, a scanner already there, an abandoned project kept them)
  const drop = (item: QueueItem) => {
    available = { ...available, ironium: available.ironium + item.allocated.ironium, boranium: available.boranium + item.allocated.boranium, germanium: available.germanium + item.allocated.germanium };
    queue.splice(i, 1);
  };
  while (i < queue.length && !stop) {
    const item = queue[i];
    if (item.qty <= 0 && !isAuto(item.kind)) { drop(item); continue; }
    if (item.kind === 'ship') {
      const d = game.designs.find(x => x.id === item.designId);
      const why = d ? canBuildShip(game, planet, d) : 'modèle inconnu';
      if (why) {
        result.messages.push(`${itemLabel(game, item)} ne peut pas être construit : ${why}.`);
        available = { ...available, ironium: available.ironium + item.allocated.ironium, boranium: available.boranium + item.allocated.boranium, germanium: available.germanium + item.allocated.germanium };
        queue.splice(i, 1); continue;
      }
    }
    if (item.kind === 'starbase' && game.designs.find(x => x.id === item.designId)?.alien) {
      result.messages.push(`${itemLabel(game, item)} ne peut pas être construit : modèle impossible à reproduire.`);
      available = { ...available, ironium: available.ironium + item.allocated.ironium, boranium: available.boranium + item.allocated.boranium, germanium: available.germanium + item.allocated.germanium };
      queue.splice(i, 1); continue;
    }
    if (item.kind === 'starbase' && planet.starbase?.designId === item.designId) { drop(item); continue; }
    if (item.kind === 'culture' && (!item.cultureId || (planet.cultureBld ?? []).includes(item.cultureId) || !cultureOn(game))) { drop(item); continue; }
    if ((item.kind === 'patronage' || item.kind === 'autoPatronage') && !cultureOn(game)) { drop(item); continue; }
    // 0.3.9.21: patronage needs its technology, also when a governor's order queues it
    if ((item.kind === 'patronage' || item.kind === 'autoPatronage') && !hasReq(player, PATRONAGE.req)) { if (item.kind === 'patronage') drop(item); else i++; continue; }
    if (item.kind === 'bounty' && bountyBlocker(game, player, item.bountyOn)) { result.messages.push(`${itemLabel(game, item)} annulée : ${bountyBlocker(game, player, item.bountyOn)}.`); drop(item); continue; }
    if (item.kind === 'spy' && spyBlocker(game, player, item.bountyOn)) { result.messages.push(`${itemLabel(game, item)} : commande annulée (${spyBlocker(game, player, item.bountyOn)}).`); drop(item); continue; }
    if (item.kind === 'agency' && agencyBlocker(game, planet)) { result.messages.push(`${itemLabel(game, item)} annulée : ${agencyBlocker(game, planet)}.`); drop(item); continue; }
    if (item.kind === 'refit') {
      // the fleet must still be in orbit, with ships of the old design, and the shipyard able to take the new one
      const st = refitStatus(game, planet, item);
      if (st.why || st.max <= 0) {
        result.messages.push(`${itemLabel(game, item)} annulée : ${st.why ?? 'plus aucun vaisseau à moderniser'}.`);
        available = { ...available, ironium: available.ironium + item.allocated.ironium, boranium: available.boranium + item.allocated.boranium, germanium: available.germanium + item.allocated.germanium };
        queue.splice(i, 1); continue;
      }
      if (item.qty > st.max) item.qty = st.max;
    }
    if (item.kind === 'autoAlchemy' && i < queue.length - 1) { alchemyNext = true; i++; continue; }
    if (item.kind === 'mega') {
      // Constellations 3: a megaproject absorbs at most its yearly share, the rest of the queue goes on
      const m = MEGA[item.megaId as MegaId];
      const why = !m ? 'inconnu' : megaBlocker(game, planet, m.id, true);
      if (why) { result.messages.push(`${itemLabel(game, item)} abandonné : ${why}.`); drop(item); continue; }
      // 0.3.9.21: a world that has fallen below the population the project needs (a raid, a bombing, colonists taken
      // away) pauses it, without losing what was paid; it was abandoned
      if (planet.pop < m!.minPop) {
        if (!dryRun) result.messages.push(`${itemLabel(game, item)} en pause : il faut ${people(game, m!.minPop)} habitants.`);
        i++; continue;
      }
      // 0.3.9: the Portal waits for its three relays (a relay lost pauses it)
      if (m!.id === 'portal' && portalPaused(game, player.id)) {
        if (!dryRun) result.messages.push(`${itemLabel(game, item)} en pause : il faut ${RELAYS_NEEDED} relais de l'Ascension (vous en avez ${relaysOf(game, player.id).length}).`);
        i++; continue;
      }
      const cap = megaYearCap(m!);
      let short = false;
      for (const k of ['resources', 'ironium', 'boranium', 'germanium'] as const) {
        const want = Math.max(0, Math.min(cap[k], m!.cost[k] - item.allocated[k]));
        const give = Math.max(0, Math.min(want, Math.floor(available[k])));
        if (give < want) short = true;
        item.allocated = { ...item.allocated, [k]: item.allocated[k] + give };
        available = { ...available, [k]: available[k] - give };
      }
      const done = (['resources', 'ironium', 'boranium', 'germanium'] as const).every(k => item.allocated[k] >= m!.cost[k]);
      if (done) {
        result.built.push({ kind: 'mega', qty: 1 });
        if (!dryRun) megaCompleted(game, planet, player, m!.id);
        queue.splice(i, 1); continue;
      }
      if (short) { stop = true; break; }
      i++; continue;
    }
    let mb = maxBuildable(game, planet, item.kind);
    // 0.3.9.21: spies, as many units as the network can still take (those beyond its ceiling were paid for nothing)
    if (item.kind === 'spy') mb = Math.max(1, Math.ceil((SPY_MAX - (player.intel.dossiers?.[item.bountyOn ?? -1]?.network ?? 0)) / Math.max(1, spyGain(game, player))));
    const room = installationRoom(game, planet, item.kind);
    if (!isAuto(item.kind) && mb === 0) {
      result.messages.push(room ? `${item.qty} ${room.what} retirée${item.qty > 1 ? 's' : ''} de la file : la planète n'en accueille pas davantage (${roomWhy(item.kind, room.max)}).` : `${itemLabel(game, item)} retiré de la file : plus rien à construire.`);
      drop(item); continue;
    }
    if (!isAuto(item.kind) && item.qty > mb) {
      if (room && !dryRun) result.messages.push(`${room.what[0].toUpperCase() + room.what.slice(1)} : commande ramenée de ${item.qty} à ${mb}, la planète n'en accueille pas davantage (${roomWhy(item.kind, room.max)}).`);
      item.qty = mb;
    }
    const cost = unitCost(game, planet, player, item);
    let quantity = Math.min(item.qty, mb);
    if (item.kind === 'autoAlchemy') quantity = Infinity;
    const auto = isAuto(item.kind);
    // build
    let numBuilt = 0;
    let paid: Cost = auto ? zeroCost() : { ...item.allocated };
    let remaining = quantity;
    let blocked = false;
    const isZero = cost.ironium + cost.boranium + cost.germanium + cost.resources === 0;
    if (isZero) { numBuilt = Number.isFinite(remaining) ? remaining : 0; remaining = 0; }
    let guard = 0;
    while (remaining > 0 && guard++ < 100) {
      const funds = add(available, paid);
      const n = Math.min(remaining, Math.floor(divideCost(funds, cost) + 1e-9));
      if (n > 0) {
        available = sub(funds, cost, n); paid = zeroCost(); numBuilt += n; remaining -= n;
        continue;
      }
      // limiting factor
      let limit: keyof Cost = 'resources', ratio = Infinity, mineralBlocked = false;
      for (const k of ['ironium', 'boranium', 'germanium', 'resources'] as const) {
        if (cost[k] <= 0) continue;
        const r = funds[k] / cost[k];
        if (r < ratio || (r === ratio && k !== 'resources')) { ratio = r; limit = k; mineralBlocked = k !== 'resources'; }
      }
      const mineralRatio = Math.min(...MINERALS.filter(m => cost[m] > 0).map(m => funds[m] / cost[m]), Infinity);
      if (auto && mineralRatio < 1 && !alchemyNext) { blocked = true; available = funds; paid = zeroCost(); break; }
      // partial allocation of the same fraction of every cost
      let frac = 1;
      for (const k of ['ironium', 'boranium', 'germanium', 'resources'] as const) if (cost[k] > 0) frac = Math.min(frac, Math.min(1, funds[k] / cost[k]));
      const alloc: Cost = { ironium: Math.trunc(cost.ironium * frac), boranium: Math.trunc(cost.boranium * frac), germanium: Math.trunc(cost.germanium * frac), resources: Math.trunc(cost.resources * frac) };
      if (!mineralBlocked || !alchemyNext) {
        paid = alloc; available = sub(funds, alloc); blocked = true; break;
      }
      // alchemy: convert resources into minerals for the limiting mineral
      paid = alloc; available = sub(funds, alloc);
      const needed = cost[limit] - paid[limit] - available[limit];
      const converted = Math.max(0, Math.min(needed, Math.trunc(available.resources / rs.alchemyCost)));
      available.resources -= converted * rs.alchemyCost;
      available.ironium += converted; available.boranium += converted; available.germanium += converted;
      if (converted < needed) { blocked = true; break; }
    }
    if (numBuilt > 0) {
      applyBuilt(game, planet, player, item, numBuilt, onBuild, result, dryRun);
    }
    // (0.3.9.21: what was set aside for an unfinished unit of alchemy is not lost: it goes on to research)
    if (item.kind === 'autoAlchemy') { available = add(available, paid); paid = zeroCost(); i++; continue; }
    if (!auto) {
      item.qty -= numBuilt;
      item.allocated = remaining > 0 ? paid : zeroCost();
      if (item.qty <= 0) { queue.splice(i, 1); alchemyNext = false; continue; }
      if (blocked) { stop = true; break; }
    } else {
      if (blocked && paid.resources + paid.ironium + paid.boranium + paid.germanium > 0) {
        // 3.6 (Constellations): a world too poor to finish one unit within a few years does not start it (it would
        // hold the whole queue for decades): the automatic item waits, the next items go on
        const yearly = spec.resourcesAvailable;
        if (!game.settings.classic && (yearly <= 0 || (cost.resources - paid.resources) / yearly > AUTO_PATIENCE)) {
          available = add(available, paid); paid = zeroCost();
          i++; continue;
        }
        // a partially built auto item becomes a concrete item at the front of the queue
        const concreteKind = autoToConcrete(item.kind);
        if (concreteKind) queue.splice(i, 0, { kind: concreteKind, qty: 1, allocated: paid, fromAuto: true });
        i++;
        stop = true; break;
      }
    }
    alchemyNext = false;
    i++;
  }
  planet.surface = { ironium: Math.max(0, Math.round(available.ironium)), boranium: Math.max(0, Math.round(available.boranium)), germanium: Math.max(0, Math.round(available.germanium)) };
  result.leftover = Math.max(0, Math.trunc(available.resources));
  return result;
}

function autoToConcrete(k: QueueKind): QueueKind | null {
  switch (k) {
    case 'autoFactories': return 'factory';
    case 'autoMines': return 'mine';
    case 'autoDefenses': return 'defenses';
    case 'autoMinTerraform': case 'autoMaxTerraform': return 'terraform';
    case 'autoPackets': return 'packetMixed';
    case 'autoPatronage': return 'patronage';
    default: return null;
  }
}

function applyBuilt(game: GameState, planet: Planet, player: Player, item: QueueItem, n: number, onBuild: (item: QueueItem, qty: number) => void, result: ProductionResult, dryRun: boolean) {
  result.built.push({ kind: item.kind, designId: item.designId, qty: n });
  switch (item.kind) {
    case 'factory': case 'autoFactories': planet.factories += n; break;
    case 'mine': case 'autoMines': planet.mines += n; break;
    case 'defenses': case 'autoDefenses': planet.defenses += n; break;
    case 'alchemy': case 'autoAlchemy':
      planet.surface.ironium += n; planet.surface.boranium += n; planet.surface.germanium += n; break;
    case 'terraform': case 'autoMinTerraform': case 'autoMaxTerraform':
      for (let k = 0; k < n; k++) if (!terraformOneStep(player, planet)) break;
      break;
    case 'scanner': planet.scanner = true; break;
    case 'capital': planet.regionalCapital = true; break;
    case 'culture': if (item.cultureId && !(planet.cultureBld ?? []).includes(item.cultureId)) planet.cultureBld = [...(planet.cultureBld ?? []), item.cultureId]; break;
    case 'patronage': case 'autoPatronage': planet.culture = (planet.culture ?? 0) + PATRONAGE.points * n; if (!dryRun) patronageInspiration(game, game.players[planet.owner], PATRONAGE.points * n); break; // (0.3.9.21: not in an estimate)
    case 'bounty': if (!dryRun) placeBounty(game, player, item.bountyOn ?? -1, BOUNTY_UNIT * n, planet); break;
    case 'spy': if (!dryRun) placeSpies(game, player, item.bountyOn ?? -1, n, planet); break;
    case 'agency': if (!dryRun) buildAgency(game, planet); break;
    default:
      if (!dryRun) onBuild(item, n);
      // (0.3.9.21: in an estimate, a station queued first is there for the ships queued after it)
      else if (item.kind === 'starbase' && item.designId !== undefined) planet.starbase = { designId: item.designId, damage: 0 };
  }
  void terraformRemaining;
}

export function queueTotalCost(game: GameState, planet: Planet): Cost {
  const player = game.players[planet.owner];
  let c = zeroCost();
  for (const it of planet.queue) {
    if (isAuto(it.kind)) continue;
    const u = unitCost(game, planet, player, it);
    c = add(c, { ironium: u.ironium * it.qty - it.allocated.ironium, boranium: u.boranium * it.qty - it.allocated.boranium, germanium: u.germanium * it.qty - it.allocated.germanium, resources: u.resources * it.qty - it.allocated.resources });
  }
  return c;
}

export interface QueueEstimate { firstYear: number | null; lastYear: number | null; doneThisYear: boolean; blocked: boolean; /** 0.3.9.21: the year the line leaves the queue with nothing to build (a scanner already there, the cap reached) */ dropped?: number }

/**
 * Projects the queue forward (growth and mining included, technology constant) to estimate completion years.
 * Returns one estimate per queue line (by index).
 */
export function estimateQueue(game: GameState, planet: Planet, maxYears = 60): QueueEstimate[] {
  const clone: Planet = JSON.parse(JSON.stringify(planet));
  const g: GameState = { ...game, planets: game.planets.map(p => p.id === planet.id ? clone : p) };
  const tags = clone.queue.map((_, i) => i);
  (clone.queue as (QueueItem & { _tag?: number })[]).forEach((q, i) => (q._tag = i));
  const est: QueueEstimate[] = planet.queue.map(() => ({ firstYear: null, lastYear: null, doneThisYear: false, blocked: false }));
  const player = g.players[clone.owner];
  for (let y = 1; y <= maxYears; y++) {
    // 0.3.9.21: the year's mining comes before its production, as in the turn (it came after: a line waiting for the
    // minerals of the coming year was shown a year late)
    const spec0 = planetSpec(g, clone, player);
    for (const m of MINERALS) clone.surface[m] += spec0.mining[m];
    const res = runProduction(g, clone, () => {}, true);
    // attribute builds
    const remainingTags = new Set((clone.queue as (QueueItem & { _tag?: number })[]).map(q => q._tag));
    for (const t of tags) {
      const b = res.built.find(x => (planet.queue[t].kind === x.kind) && (planet.queue[t].designId === x.designId));
      if (b && est[t].firstYear === null) est[t].firstYear = y;
      // (0.3.9.21: a line that leaves the queue without anything built was dropped, not finished)
      if (!remainingTags.has(t) && est[t].lastYear === null && est[t].dropped === undefined && !isAuto(planet.queue[t].kind)) {
        if (est[t].firstYear !== null) est[t].lastYear = y; else est[t].dropped = y;
      }
    }
    if (clone.queue.every(q => isAuto(q.kind))) break;
    // growth for next year
    const spec = planetSpec(g, clone, player);
    clone.pop = Math.max(0, clone.pop + spec.growth);
  }
  for (const e of est) e.doneThisYear = e.lastYear === 1 || e.firstYear === 1;
  for (let t = 0; t < est.length; t++) if (est[t].firstYear === null && est[t].dropped === undefined && !isAuto(planet.queue[t].kind)) est[t].blocked = true;
  return est;
}

/**
 * Constellations 3.6: what holds a queue line back. Everything before it in the queue is paid first; each resource
 * (production, ironium, boranium, germanium) gives the years it needs from the stock and the yearly income. The
 * slowest is the bottleneck. A line stuck behind an impossible one says so.
 */
export interface Bottleneck {
  key: 'resources' | 'ironium' | 'boranium' | 'germanium' | 'ahead' | 'none';
  /** for the queue up to this line: what it costs, what is in stock, what comes in each year */
  need: number; have: number; perYear: number; years: number;
  /** the line ahead that blocks this one */
  ahead?: number;
  text: string;
}
const MIN_FR: Record<string, string> = { ironium: 'ironium', boranium: 'boranium', germanium: 'germanium' };
export function queueBottleneck(game: GameState, planet: Planet, index: number, est?: QueueEstimate[]): Bottleneck {
  const player = game.players[planet.owner];
  const spec = planetSpec(game, planet, player);
  const e = est ?? estimateQueue(game, planet, 60);
  // stuck behind a line that will never be built
  for (let i = 0; i < index; i++) if (e[i]?.blocked && !isAuto(planet.queue[i].kind)) {
    return { key: 'ahead', need: 0, have: 0, perYear: 0, years: Infinity, ahead: i, text: `bloqué derrière « ${itemLabel(game, planet.queue[i])} » (ligne ${i + 1}), qui n'avance pas : remontez cette commande au-dessus de la ligne ${i + 1}, ou débloquez d'abord la ligne ${i + 1}` };
  }
  const need = { resources: 0, ironium: 0, boranium: 0, germanium: 0 };
  for (let i = 0; i <= index; i++) {
    const it = planet.queue[i];
    if (isAuto(it.kind) && i !== index) continue;
    const c = unitCost(game, planet, player, it);
    const n = it.kind === 'mega' ? 1 : Math.max(1, it.qty);
    for (const k of ['resources', 'ironium', 'boranium', 'germanium'] as const) need[k] += Math.max(0, c[k] * n - it.allocated[k]);
  }
  const have = { resources: 0, ironium: planet.surface.ironium, boranium: planet.surface.boranium, germanium: planet.surface.germanium };
  const rate = { resources: spec.resourcesAvailable, ironium: spec.mining.ironium, boranium: spec.mining.boranium, germanium: spec.mining.germanium };
  let worst: Bottleneck = { key: 'none', need: 0, have: 0, perYear: 0, years: 0, text: '' };
  for (const k of ['resources', 'ironium', 'boranium', 'germanium'] as const) {
    const short = need[k] - have[k];
    if (short <= 0) continue;
    const years = rate[k] > 0 ? short / rate[k] : Infinity;
    if (years > worst.years) worst = { key: k, need: need[k], have: have[k], perYear: rate[k], years, text: '' };
  }
  const f = (n: number) => Math.round(n).toLocaleString('fr-FR');
  const yrs = (y: number) => !Number.isFinite(y) ? 'jamais à ce rythme' : y < 1.5 ? 'environ un an' : `environ ${Math.round(y)} ans`;
  if (worst.key === 'resources') worst.text = `les ressources : ${f(worst.need)} R à réunir jusqu'à cette ligne, ${f(worst.perYear)} R par an pour la production (après la part de la recherche) : ${yrs(worst.years)}`;
  else if (worst.key !== 'none') worst.text = `${worst.key === 'ironium' ? 'l\'' : 'le '}${MIN_FR[worst.key]} : ${f(worst.need)} kt à réunir jusqu'à cette ligne, ${f(worst.have)} kt en stock, ${worst.perYear > 0 ? `${f(worst.perYear)} kt extraits par an` : 'aucune extraction ici'} : ${yrs(worst.years)}`;
  return worst;
}

/** 3.6: a line at the head of a human's queue that will take decades says why, once. */
export function stuckWarnings(game: GameState) {
  for (const planet of game.planets) {
    if (planet.owner < 0 || game.players[planet.owner].ai) continue;
    const i = planet.queue.findIndex(q => !isAuto(q.kind));
    if (i < 0) continue;
    const it = planet.queue[i];
    // 3.6: the unfinished unit of an automatic item (older saves: a concrete item of the same kind as an automatic one
    // of the queue) is no order of the player's: rather than hold the queue for decades, it gives way to the automatic item
    const leftover = !game.settings.classic && (it.fromAuto || (it.qty === 1 && planet.queue.some(q => isAuto(q.kind) && autoToConcrete(q.kind) === it.kind)));
    if (it.warned && !leftover) continue;
    const b = queueBottleneck(game, planet, i, []);
    if (b.years < (leftover ? AUTO_PATIENCE : 25)) continue;
    if (leftover) {
      planet.surface.ironium += it.allocated.ironium; planet.surface.boranium += it.allocated.boranium; planet.surface.germanium += it.allocated.germanium;
      planet.queue.splice(i, 1);
      continue;
    }
    planet.queue[i].warned = true;
    game.players[planet.owner].messages.push({ year: game.year, kind: 'warning', text: `${planet.name} : « ${itemLabel(game, planet.queue[i])} » n'avance pas et retient toute la file. Ce qui manque : ${b.text}. Voir la file de production de la planète.`, target: { kind: 'planet', id: planet.id } });
  }
}

export function applyTemplate(game: GameState, planet: Planet, templateId: number) {
  const player = game.players[planet.owner];
  const t = player.templates.find(x => x.id === templateId);
  if (!t) return;
  for (const it of t.items) planet.queue.push({ kind: it.kind, designId: it.designId, qty: it.qty, allocated: zeroCost() });
  planet.tpl = templateId;
}

/**
 * Constellations 3.6: the three default templates form a chain. A colony on "Colonie standard" moves on to "Monde
 * développé" once its population reaches a third of its maximum, then to "Monde mature" at three quarters of it with
 * most of its factories built: the automatic items of the old template give way to those of the next one (manual
 * items stay).
 */
export const TEMPLATE_CHAIN: { from: number; to: number; fill: number; factories?: number }[] = [
  { from: 1, to: 2, fill: 1 / 3 },
  { from: 2, to: 3, fill: 0.75, factories: 0.8 },
];
export function nextTemplate(game: GameState, planet: Planet): { to: number; ready: boolean; fill: number; why: string } | null {
  const player = game.players[planet.owner];
  if (!player || player.tplChain === false || planet.tpl === undefined) return null;
  const step = TEMPLATE_CHAIN.find(c => c.from === planet.tpl);
  // (0.3.9.21: both ends must still exist: a deleted template stopped every turn)
  if (!step || !player.templates.some(t => t.id === step.to) || !player.templates.some(t => t.id === step.from)) return null;
  const sp = planetSpec(game, planet, player);
  const fill = sp.maxPop > 0 ? planet.pop / sp.maxPop : 0;
  const fac = sp.maxPossibleFactories > 0 ? planet.factories / sp.maxPossibleFactories : 1;
  const ready = fill >= step.fill && (step.factories === undefined || fac >= step.factories);
  const why = `population à ${Math.round(step.fill * 100)} % du maximum${step.factories ? `, ${Math.round(step.factories * 100)} % des usines possibles` : ''}`;
  return { to: step.to, ready, fill, why };
}
export function advanceTemplates(game: GameState) {
  for (const planet of game.planets) {
    if (planet.owner < 0) continue;
    const player = game.players[planet.owner];
    if (player.ai) continue;
    // 0.3.9: a world run by a sector governor follows the governor's order
    if (governed(game, planet)) continue;
    // a colony of an older save: recognised by its automatic items (those of one of the chained templates)
    if (planet.tpl === undefined && player.tplChain !== false) {
      const autos = planet.queue.filter(q => isAuto(q.kind)).map(q => `${q.kind}:${q.qty}`).sort().join('|');
      const hit = TEMPLATE_CHAIN.map(c => c.from).map(id => player.templates.find(t => t.id === id)).find(t => t && t.items.filter(i => isAuto(i.kind)).map(i => `${i.kind}:${i.qty}`).sort().join('|') === autos);
      if (hit && autos) planet.tpl = hit.id;
    }
    const nx = nextTemplate(game, planet);
    if (!nx?.ready) continue;
    const from = player.templates.find(t => t.id === planet.tpl), to = player.templates.find(t => t.id === nx.to);
    if (!from || !to) { planet.tpl = undefined; continue; }
    const oldKinds = new Set(from.items.map(i => i.kind).filter(k => isAuto(k)));
    // a queue emptied or rebuilt by hand is left alone
    if (!planet.queue.some(q => oldKinds.has(q.kind))) { planet.tpl = undefined; continue; }
    planet.queue = planet.queue.filter(q => !oldKinds.has(q.kind));
    for (const it of to.items) if (!planet.queue.some(q => q.kind === it.kind && isAuto(it.kind))) planet.queue.push({ kind: it.kind, designId: it.designId, qty: it.qty, allocated: zeroCost() });
    planet.tpl = to.id;
    player.messages.push({ year: game.year, kind: 'production', text: `${planet.name} passe du modèle « ${from.name} » au modèle « ${to.name} » (population à ${Math.round(nx.fill * 100)} % du maximum).`, target: { kind: 'planet', id: planet.id } });
  }
}

/**
 * 0.3.9.21: the id of a new template, never one used before: a deleted default template's id given to a new one put
 * the colonies of the chain on it.
 */
export function newTemplateId(game: GameState): number { return game.nextId++; }

/** 0.3.9.21: a template deleted: no colony keeps following it, and the new colonies no longer get it. */
export function forgetTemplate(game: GameState, player: Player, id: number) {
  player.templates = player.templates.filter(t => t.id !== id);
  for (const p of game.planets) if (p.owner === player.id && p.tpl === id) p.tpl = undefined;
  if (player.defaultTemplate === id) player.defaultTemplate = -1;
}

export function defaultTemplates(): import('./types').ProductionTemplate[] {
  return [
    { id: 1, name: 'Colonie standard', items: [{ kind: 'autoMinTerraform', qty: 3 }, { kind: 'autoFactories', qty: 100 }, { kind: 'autoMines', qty: 100 }, { kind: 'autoMaxTerraform', qty: 10 }] },
    { id: 2, name: 'Monde développé', items: [{ kind: 'autoFactories', qty: 250 }, { kind: 'autoMines', qty: 250 }, { kind: 'autoDefenses', qty: 20 }, { kind: 'autoMaxTerraform', qty: 50 }] },
    { id: 3, name: 'Monde mature', items: [{ kind: 'autoFactories', qty: 500 }, { kind: 'autoMines', qty: 500 }, { kind: 'autoDefenses', qty: 100 }, { kind: 'autoMaxTerraform', qty: 200 }, { kind: 'autoAlchemy', qty: 1 }] },
  ];
}
