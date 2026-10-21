// Turn generation: the Stars! order of events, adapted.
import { people } from './words';
import type { Fleet, GameState, Planet, Player, QueueItem } from './types';
import { FIELDS, MINERALS } from './types';
import { Rng, seedFromString } from './rng';
import { planetSpec, applyMining, terraformRemaining } from './planet';
import { runProduction, itemLabel, advanceTemplates, stuckWarnings } from './production';
import { doResearch, addResearch, researchCost as researchCostOf, type ResearchEvent } from './research';
import { raceSpec } from './race';
import { fleetSpec, canRefuelAt, distance } from './fleet';
import { specOf, designSpec } from './design';
import { resolveBattles, willAttack } from './battle';
import { moveFleets, movePackets, launchPacket, updateWormholes, detonateMinefields, decayMinefields, sweepMines } from './movement';
import { battleTechTrades } from './techtrade';
import { greenhouse } from './greenhouse';
import { processWaypointTask, processMineLaying, remoteMining, mergeArrivingMiners , patrolFuel, escortWarnings, chaseChecks, resolveLandings } from './tasks';
import { updateIntel } from './scan';
import { computeScore, checkVictory } from './score';
import { newFleet } from './newgame';
import { runAI } from './ai';
import { runAutomation, threatWarnings } from './automation';
import { SPECIALS, hasSpecial, ensureSpecialShift } from './specials';
import { TECH_DATA } from '../data/techs';
import { HULL_DATA } from '../data/hulls';
import { hasTech, FIELD_NAMES, effReq } from './tech';
import { resolveGoal, goalReached } from './goals';
import { tl } from '../data/labels';
import { applyBuiltMission } from './missions';
import { randomHab, randomConcentrations } from './universe';
import { moveTraders, meetTraders, spawnTraders, traderHails } from './trader';
import { driftStorms } from './terrain';
import { resetPlanetPolicies, updateCapitals, ADMIN_RADIUS } from './empire';
import { hasDoctrine, doctrineNews, pendingIds } from './doctrines';
import { hasMega, megaNews } from './megaprojects';
import { runLogistics, crowdingAdvice } from './logistics';
import { applyRefit, pendingRefit } from './refit';
import { checkObjectives } from './objectives';
import { runPursuits, runTraderMeets } from './intercept';
import { researchFactor } from './relics';
import { runStudies, discoverAnomalies, isStudying } from './anomalies';
import { checkGuardians, regenGuardians, guardianWarnings, guardianAssessments } from './guardians';
import { originYear } from './origins';
import { runRefuels, runTankers, defaultTankerRange } from './refuel';
import { upgradeTargets } from './upgrade';
import { runCulture, ensureBeaconCarrier } from './culture';
import { refuelFactions } from './factions';
import { runPirates } from './pirates';
import { runCrisis } from './crisis';
import { runDiplomacy, recordWarLosses, researchBonus } from './diplomacy';
import { updateDossiers } from './espionage';
import { studyDebris } from './debris';
import { runSecrets, secretBonus, secretStudyOf } from './secrets';
import { startChronicle, addChronicle, recordFrame, worldMilestones } from './chronicle';
import { runNemesis } from './nemesis';
import { runActs } from './acts';
import { runCataclysms } from './cataclysms';
import { runDiaspora, survivesWithoutWorld } from './diaspora';
import { runGoldenAges, inGoldenAge, GOLDEN_BONUS } from './golden';
import { runDilemmas } from './dilemmas';
import { runChains } from './chains';
import { runSecret } from './ancients';
import { runOriginWins } from './originwins';
import { runGovernors } from './governors';
import { lairAssessments } from './pirates';
import { runOperations, builtForOp } from './operations';
import { runBorders } from './borders';

const AUTO_SUMMARY: Partial<Record<QueueItem['kind'], string>> = {
  factory: 'factory', mine: 'mine', defenses: 'defense', autoFactories: 'factory', autoMines: 'mine', autoDefenses: 'defense', autoMinTerraform: 'terraform', autoMaxTerraform: 'terraform', autoAlchemy: 'alchemy', autoPackets: 'packet',
};
/** singular and plural of each kind of automatic construction */
const AUTO_WORDS: Record<string, [string, string]> = {
  factory: ['usine', 'usines'], mine: ['mine', 'mines'], defense: ['défense', 'défenses'], terraform: ['terraformation', 'terraformations'], alchemy: ['conversion alchimique', 'conversions alchimiques'], packet: ['paquet', 'paquets'],
};

/** 0.3.9.14: for the AI arena (scripts/ai-arena.ts): another AI may play some computers (true: it played this one). */
export const aiHooks: { run?: (game: GameState, p: Player, rng: Rng) => boolean } = {};

/** The research pool of the year from the resources given to research: relics, alliances, golden age. */
export function researchPool(game: GameState, p: Player, resources: number): number {
  return Math.floor(resources * researchFactor(p) * (1 + researchBonus(game, p.id)) * (inGoldenAge(game, p) ? 1 + GOLDEN_BONUS : 1));
}

/**
 * 0.3.9.21: the research points of next year as the turn will count them (the pages applied the GR factor twice to
 * last year's points, and none of the bonuses to the budget).
 */
export function researchPerYear(game: GameState, p: Player, budget: number): number {
  const pts = Math.trunc(researchPool(game, p, budget) * raceSpec(p.race).researchFactor + 0.5);
  return Math.max(pts, p.researchLastYear);
}

export function generateTurn(game: GameState) {
  const rng = new Rng(game.rng);
  startChronicle(game);
  // 0.3.9.10: what diplomacy tells at the start of the year (a war declared by a computer, its proposals, an expired
  // one) is kept for this year's reports: the reports were cleared just after, and those messages never showed
  const told = game.players.map(p => p.messages.length);
  runDiplomacy(game);
  for (const p of game.players) if (p.ai && !p.dead && !aiHooks.run?.(game, p, rng)) runAI(game, p, rng);
  const early = game.players.map((p, i) => p.messages.slice(told[i]).filter(m => m.kind === 'diplomacy'));
  const techBefore = game.players.map(p => new Set(availableTechNames(p)));
  const levelsBefore = game.players.map(p => ({ ...p.tech }));
  ensureSpecialShift(game);
  thinArtifacts(game);
  const specialsBefore = game.players.map(p => SPECIALS.map(sp => hasSpecial(p, sp)));
  const forksBefore = game.players.map(p => pendingIds(game, p));

  game.year++;
  for (const p of game.players) p.messages = (early[p.id] ?? []).map(m => ({ ...m, year: game.year }));
  game.battles = [];
  for (const f of game.fleets) f.age++;
  for (const p of game.planets) p.bonusResources = 0;
  secretBonus(game);

  refuelFactions(game);

  // ---- waypoint 0 tasks (orders given at the current location)
  for (const k of Object.keys(game.emptied ?? {})) if (game.emptied![+k].year < game.year) delete game.emptied![+k];
  for (const f of [...game.fleets]) if (game.fleets.includes(f)) processWaypointTask(game, f, rng);
  // 0.3.9.16: the troops landed (by hand during the orders, or by the tasks above) fight it out together
  resolveLandings(game);
  runTankers(game, true);

  // ---- movement
  movePackets(game, rng, false);
  moveTraders(game, rng);
  moveFleets(game, rng);
  freighterGrowth(game);
  decaySalvage(game);
  detonateMinefields(game);
  remoteMining(game, true);

  // ---- economy
  runGovernors(game);
  advanceTemplates(game);
  const pools = new Map<number, number>();
  const autoBuilt = new Map<number, { counts: Record<string, number>; planets: Set<number> }>();
  for (const planet of game.planets) {
    if (planet.owner < 0) continue;
    const player = game.players[planet.owner];
    const spec = planetSpec(game, planet, player);
    // mining
    const rs = raceSpec(player.race);
    const numMines = rs.innate ? Math.trunc(Math.sqrt(planet.pop) * 0.1) : Math.min(planet.mines, spec.maxMines);
    if (planet.pop > 0) applyMining(planet, spec.mining, numMines);
    // production
    const res = runProduction(game, planet, (item, qty) => onBuild(game, planet, player, item, qty, rng));
    pools.set(player.id, (pools.get(player.id) ?? 0) + res.leftover + spec.resourcesResearch);
    for (const b of res.built) {
      if (b.kind === 'ship' || b.kind === 'starbase' || b.kind === 'mega' || b.kind === 'refit' || b.kind === 'bounty' || b.kind === 'spy' || b.kind === 'agency') continue; // own message
      if (b.kind === 'capital') { player.messages.push({ year: game.year, kind: 'production', text: `${planet.name} devient capitale régionale : les planètes à moins de ${ADMIN_RADIUS} al retrouvent leur plein rendement.`, target: { kind: 'planet', id: planet.id } }); continue; }
      if (b.kind === 'autoAlchemy' && b.qty === 0) continue;
      if (!player.ai && AUTO_SUMMARY[b.kind]) {
        // humans get one yearly summary for routine automatic builds
        const agg = autoBuilt.get(player.id) ?? { counts: {}, planets: new Set<number>() };
        const key = AUTO_SUMMARY[b.kind]!;
        agg.counts[key] = (agg.counts[key] ?? 0) + b.qty; agg.planets.add(planet.id);
        autoBuilt.set(player.id, agg);
        continue;
      }
      player.messages.push({ year: game.year, kind: 'production', text: `${planet.name} : ${b.qty} × ${itemLabel(game, b)} construit${b.qty > 1 ? 's' : ''}.`, target: { kind: 'planet', id: planet.id } });
    }
    for (const m of res.messages) player.messages.push({ year: game.year, kind: 'production', text: `${planet.name} : ${m}`, target: { kind: 'planet', id: planet.id } });
    if (planet.queue.length === 0 && player.ai === null) {
      player.messages.push({ year: game.year, kind: 'warning', text: `La file de production de ${planet.name} est vide.`, target: { kind: 'planet', id: planet.id } });
    }
  }
  stuckWarnings(game);
  for (const [pid, agg] of autoBuilt) {
    const order = ['factory', 'mine', 'defense', 'terraform', 'alchemy', 'packet'];
    const parts = order.filter(k => agg.counts[k]).map(k => `${agg.counts[k]} ${AUTO_WORDS[k][agg.counts[k] > 1 ? 1 : 0]}`);
    const first = [...agg.planets][0];
    game.players[pid].messages.push({ year: game.year, kind: 'production', text: `Constructions de l'année : ${parts.join(', ')} sur ${agg.planets.size} planète${agg.planets.size > 1 ? 's' : ''}.`, target: agg.planets.size === 1 ? { kind: 'planet', id: first } : { kind: 'colonies', id: 0 } });
  }
  // research
  for (const p of game.players) {
    if (p.dead) continue;
    applyResearchGoal(game, p);
    const events = doResearch(game, p, researchPool(game, p, pools.get(p.id) ?? 0), rng);
    researchMessages(game, p, events);
  }
  stealResearch(game, pools);
  game.players.forEach((p, i) => { if (!p.dead) doctrineNews(game, p, forksBefore[i]); });
  megaNews(game);
  // CA permaform / instaform
  // 0.3.9.18: the greenhouse effect of industry, before the CA instaform (who make up for it at once)
  greenhouse(game);
  instaform(game, rng);
  originYear(game);
  // growth
  for (const planet of game.planets) {
    if (planet.owner < 0 || planet.pop <= 0) continue;
    const player = game.players[planet.owner];
    const spec = planetSpec(game, planet, player);
    planet.pop = Math.max(0, planet.pop + spec.growth);
    if (planet.pop <= 0 || (raceSpec(player.race).livesOnStarbases && !planet.starbase)) {
      player.messages.push({ year: game.year, kind: 'population', text: `La colonie de ${planet.name} s'est éteinte.`, target: { kind: 'planet', id: planet.id } });
      emptyPlanet(planet);
    }
  }
  updateWormholes(game, rng);
  driftStorms(game, rng);
  movePackets(game, rng, true);
  refuel(game);
  randomEvents(game, rng);
  runCataclysms(game);

  // ---- combat
  game.battles = resolveBattles(game, rng);
  recordWarLosses(game);
  escortWarnings(game);
  studyDebris(game);
  // 0.3.9.17 (Stars!): the empires that survive a battle may learn from the more advanced ships they fought
  battleTechTrades(game);
  checkGuardians(game, rng);
  runPirates(game);
  runCrisis(game);
  runSecret(game);
  bombing(game, rng);
  meetTraders(game, rng);
  spawnTraders(game, rng);
  traderHails(game);

  // ---- waypoint 1 tasks (arrivals)
  for (const f of [...game.fleets]) if (game.fleets.includes(f)) processWaypointTask(game, f, rng);
  resolveLandings(game);
  mergeArrivingMiners(game);
  runStudies(game, rng);
  runSecrets(game, rng);
  runRefuels(game);
  runTankers(game);
  remoteMining(game, false);
  decayMinefields(game);
  processMineLaying(game);
  sweepMines(game);
  repair(game);
  regenGuardians(game);
  remoteTerraform(game);
  idleMessages(game);
  updateCapitals(game);
  runCulture(game);
  runGoldenAges(game);
  runLogistics(game);
  crowdingAdvice(game);

  // 0.3.8.4: a goal reached this year (research, trade, theft, ruins...) is dropped now, not at the next turn
  for (const p of game.players) if (!p.dead) clearReachedGoal(game, p);

  // ---- knowledge, scores, victory
  updateIntel(game);
  // 0.3.9.10: closed borders (the policies for the empires just met, the computers' choices, the hindrance)
  runBorders(game);
  discoverAnomalies(game);
  threatWarnings(game);
  guardianWarnings(game);
  guardianAssessments(game);
  lairAssessments(game);
  runPursuits(game);
  runOperations(game);
  runTraderMeets(game);
  chaseChecks(game);
  patrolFuel(game);
  runAutomation(game);
  checkObjectives(game);
  for (const p of game.players) {
    if (p.dead) continue;
    p.scores.push(computeScore(game, p));
    if (p.scores.length > 400) p.scores.shift();
  }
  checkDeath(game);
  runDiaspora(game);
  runNemesis(game);
  worldMilestones(game);
  const victor = checkVictory(game);
  if (victor !== null && game.victor === null) {
    game.victor = victor;
    game.victoryKind = game.players.filter(p => !p.monster && !p.dead).length === 1 ? 'lastStanding' : 'conditions';
    for (const p of game.players) p.messages.unshift({ year: game.year, kind: 'victory', text: victor === p.id ? `Victoire ! Les ${p.name} ont atteint les conditions de victoire.` : `Les ${game.players[victor].name} ont atteint les conditions de victoire. La partie peut continuer.`, target: { kind: 'score', id: 0 } });
  }
  runOriginWins(game);
  victoryChronicle(game);
  runActs(game);
  runDilemmas(game);
  runChains(game);
  recordFrame(game, game.victor !== null && !game.chronicle?.events.some(e => e.kind === 'victory' && e.year < game.year));
  updateDossiers(game);
  // newly available technology
  game.players.forEach((p, i) => {
    if (p.dead) return;
    const now = availableTechNames(p);
    const fresh = now.filter(n => !techBefore[i].has(n));
    if (fresh.includes('Sovereignty Beacon')) ensureBeaconCarrier(game, p);
    if (fresh.length) {
      // 3.2.5: say which of them would improve the designs in production (one click in Research to put them in)
      const upg = p.ai ? [] : fresh.map(n => ({ n, k: upgradeTargets(game, p, n).length })).filter(x => x.k > 0);
      const hint = upg.length ? ` ${upg.map(x => `${tl(x.n)} peut améliorer ${x.k} de vos modèles`).join(' ; ')} (Recherche, Technologies déjà trouvées).` : '';
      // 3.3.6: say what brought them (several levels in a year, or a level that unlocks a cluster)
      const ups = FIELDS.filter(f => p.tech[f] > levelsBefore[i][f]).map(f => p.tech[f] - levelsBefore[i][f] > 1 ? `${FIELD_NAMES[f]} ${levelsBefore[i][f]} → ${p.tech[f]}` : `${FIELD_NAMES[f]} ${p.tech[f]}`);
      const why = ups.length ? ` (${ups.join(', ')})` : '';
      p.messages.push({ year: game.year, kind: 'research', text: `Nouvelles technologies disponibles${why} : ${fresh.map(tl).join(', ')}.${hint}`, target: { kind: 'research', id: upg.length ? 1 : 0 } });
    }
    SPECIALS.forEach((sp, k) => { if (!specialsBefore[i][k] && hasSpecial(p, sp) && !p.ai && (!sp.when || sp.when(game))) p.messages.push({ year: game.year, kind: 'research', text: `${sp.name} : ${sp.unlocked}`, target: { kind: 'research', id: 0 } }); });
  });
  // battle summary first
  for (const p of game.players) {
    const mine = game.battles.filter(b => b.players.includes(p.id));
    if (mine.length) p.messages.unshift({ year: game.year, kind: 'battle', text: `Vous avez reçu ${mine.length} enregistrement${mine.length > 1 ? 's' : ''} de bataille cette année.`, target: { kind: 'battle', id: mine[0].id } });
  }
  // important news first (stable order within a category)
  const PRIORITY: Record<string, number> = { victory: 0, battle: 1, combat: 2, warning: 3, diplomacy: 3, packet: 4, minefield: 4, colony: 5, population: 5, research: 6, event: 6, trader: 6, wormhole: 7, scan: 7, fleet: 8, info: 9, production: 10 };
  for (const p of game.players) {
    if (p.ai) continue;
    p.messages = p.messages.map((m, i) => ({ m, i })).sort((a, b) => (PRIORITY[a.m.kind] ?? 9) - (PRIORITY[b.m.kind] ?? 9) || a.i - b.i).map(x => x.m);
  }
}

/** The targeted technology is in hand: the goal is dropped (with its message). True if there is no goal left. */
function clearReachedGoal(game: GameState, p: Player): boolean {
  if (!p.researchGoal) return true;
  const t = resolveGoal(game, p.researchGoal);
  if (t && !goalReached(p, t)) return false;
  if (t) p.messages.push({ year: game.year, kind: 'research', text: t.kind === 'mega' ? `Objectif atteint : le grand projet « ${t.name} » peut être lancé.` : `Objectif atteint : ${tl(t.name)} est disponible.`, target: { kind: 'research', id: 0 } });
  p.researchGoal = undefined; p.researchGoalStart = undefined;
  return true;
}

function applyResearchGoal(game: GameState, p: Player) {
  if (clearReachedGoal(game, p)) return;
  const t = resolveGoal(game, p.researchGoal)!;
  const keys: Record<string, keyof typeof t.req> = { energy: 'en', weapons: 'we', propulsion: 'pr', construction: 'co', electronics: 'el', biotechnology: 'bi' };
  let best: typeof FIELDS[number] | null = null;
  for (const f of FIELDS) {
    if (p.tech[f] >= (effReq(p, t)[keys[f]] as number)) continue;
    if (!best || researchCostOf(game, p, f) < researchCostOf(game, p, best)) best = f;
  }
  if (best) p.researching = best;
}

export function availableTechNames(p: Player): string[] {
  return [...TECH_DATA, ...HULL_DATA].filter(t => hasTech(p, t)).map(t => t.name);
}

function researchMessages(game: GameState, p: Player, events: ResearchEvent[]) {
  for (const e of events) {
    const luck = e.ratio === undefined ? '' : e.ratio < 0.85 ? ' Percée en avance sur les prévisions !' : e.ratio > 1.35 ? ' La percée s\'est fait attendre.' : '';
    p.messages.push({ year: game.year, kind: 'research', text: `Vos scientifiques ont atteint le niveau ${e.level} en ${FIELD_NAMES[e.field]}.${luck}`, target: { kind: 'research', id: 0 } });
  }
}

function stealResearch(game: GameState, pools: Map<number, number>) {
  const thieves = game.players.filter(p => !p.dead && raceSpec(p.race).stealsResearch > 0);
  if (!thieves.length) return;
  const n = game.players.filter(p => !p.dead).length;
  for (const t of thieves) {
    for (const f of FIELDS) {
      let stolen = 0;
      for (const o of game.players) if (o !== t && !o.dead && o.researching === f) stolen += Math.trunc((pools.get(o.id) ?? 0) * 0.5);
      const amount = Math.trunc(stolen / Math.max(1, n));
      if (amount > 0) researchMessages(game, t, addResearch(game, t, f, amount));
    }
  }
}

function onBuild(game: GameState, planet: Planet, player: Player, item: QueueItem, qty: number, rng: Rng) {
  switch (item.kind) {
    case 'refit': {
      const label = itemLabel(game, item);
      const f = applyRefit(game, planet, item, qty);
      if (f) player.messages.push({ year: game.year, kind: 'production', text: `${planet.name} : ${qty} vaisseau${qty > 1 ? 'x' : ''} de ${f.name} modernisé${qty > 1 ? 's' : ''} (${label.replace('Modernisation ', '')}).`, target: { kind: 'fleet', id: f.id } });
      break;
    }
    case 'ship': {
      const d = game.designs.find(x => x.id === item.designId);
      if (!d) return;
      const f = newFleet(game, player, d.id, qty, planet);
      player.stats.shipsBuilt += qty;
      if (item.mission) {
        const dest = game.planets[item.mission.planetId];
        const ok = applyBuiltMission(game, f, item.mission);
        if (item.mission.kind === 'logistics') { player.messages.push({ year: game.year, kind: 'production', text: ok ? `${planet.name} a construit ${f.name}, qui rejoint le réseau logistique.` : `${planet.name} a construit ${f.name}.`, target: { kind: 'fleet', id: f.id } }); break; }
        player.messages.push({ year: game.year, kind: 'production', text: ok ? (item.mission.kind === 'haul' ? `${planet.name} a construit ${f.name}, qui commence ses allers-retours entre ${dest.name} et ${game.planets[f.waypoints[f.waypoints.length - 1].targetId ?? dest.id].name}.` : `${planet.name} a construit ${f.name}, qui part ${item.mission.kind === 'colonize' ? 'coloniser' : item.mission.kind === 'mine' ? 'forer' : 'explorer'} ${dest.name}.`) : `${planet.name} a construit ${f.name}, mais ${dest.name} est hors de portée avec son carburant : donnez-lui ses ordres.`, target: { kind: 'fleet', id: f.id } });
        break;
      }
      // 0.3.9: built to reinforce an operation (operations.ts)
      const opf = item.forOp !== undefined ? game.fleets.find(x => x.id === item.forOp && x.owner === player.id && x.op) : undefined;
      if (opf) {
        player.messages.push({ year: game.year, kind: 'production', text: `${planet.name} a construit ${qty} × ${d.name}, en renfort de ${opf.name}.`, target: { kind: 'fleet', id: opf.id } });
        builtForOp(game, f, opf.id);
        break;
      }
      player.messages.push({ year: game.year, kind: 'production', text: `${planet.name} a construit ${qty} × ${d.name} (${f.name}).`, target: { kind: 'fleet', id: f.id } });
      if (planet.route !== undefined && planet.route !== planet.id) {
        const dest = game.planets[planet.route];
        f.waypoints.push({ x: dest.x, y: dest.y, target: 'planet', targetId: dest.id, warp: fleetSpec(game, f).idealSpeed || 5, task: 'none' });
      }
      break;
    }
    case 'starbase': {
      const d = game.designs.find(x => x.id === item.designId);
      if (!d) return;
      let damage = 0;
      if (planet.starbase) {
        const old = specOf(game, planet.starbase.designId);
        const ns = designSpec(player, d);
        damage = old.armor > 0 ? planet.starbase.damage / old.armor * ns.armor : 0;
      }
      planet.starbase = { designId: d.id, damage };
      d.built++;
      player.messages.push({ year: game.year, kind: 'production', text: `La base ${d.name} est opérationnelle en orbite de ${planet.name}.`, target: { kind: 'planet', id: planet.id } });
      break;
    }
    case 'packetI': case 'packetB': case 'packetG': case 'packetMixed': case 'autoPackets': {
      const rs = raceSpec(player.race);
      const single = rs.packetMineralsSingle * qty, mixed = rs.packetMineralsMixed * qty;
      const cargo = item.kind === 'packetI' ? { ironium: single, boranium: 0, germanium: 0 } : item.kind === 'packetB' ? { ironium: 0, boranium: single, germanium: 0 } : item.kind === 'packetG' ? { ironium: 0, boranium: 0, germanium: single } : { ironium: mixed, boranium: mixed, germanium: mixed };
      launchPacket(game, planet, cargo);
      break;
    }
    case 'genesis': {
      planet.hab = randomHab(rng); planet.baseHab = [...planet.hab] as typeof planet.hab; planet.terraformed = [0, 0, 0];
      planet.greenhouse = undefined; planet.ghShift = undefined;
      planet.conc = randomConcentrations(rng, planet.hab[2], false);
      planet.mines = 0; planet.factories = 0; planet.defenses = 0; planet.scanner = false;
      player.messages.push({ year: game.year, kind: 'production', text: `Le Créateur de mondes a remodelé ${planet.name}.`, target: { kind: 'planet', id: planet.id } });
      break;
    }
  }
}

export function emptyPlanet(planet: Planet) {
  planet.owner = -1; planet.pop = 0; planet.queue = []; planet.mines = planet.mines; planet.defenses = 0; planet.scanner = false;
  planet.starbase = null; planet.route = undefined; planet.packetTarget = undefined;
  planet.conqueredYear = undefined; resetPlanetPolicies(planet);
}

function freighterGrowth(game: GameState) {
  for (const f of game.fleets) {
    const owner = game.players[f.owner];
    const fg = raceSpec(owner.race).freighterGrowth;
    if (!fg || f.cargo.colonists <= 0) continue;
    let g: number;
    if (fg.absolute) {
      if (!(f.lastWarp > 0) || f.cargo.colonists <= 10) continue;
      g = Math.round(fg.rate * f.cargo.colonists);
    } else g = Math.trunc(fg.rate * f.cargo.colonists * owner.race.growthRate / 100);
    const cap = fleetSpec(game, f).cargoCapacity;
    f.cargo.colonists = Math.max(0, f.cargo.colonists + g);
    const over = f.cargo.ironium + f.cargo.boranium + f.cargo.germanium + f.cargo.colonists - cap;
    if (over > 0) {
      f.cargo.colonists -= over;
      const pl = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
      if (pl && pl.owner === f.owner) pl.pop += over * 100;
    }
  }
}

function decaySalvage(game: GameState) {
  for (const s of game.salvage) {
    s.age++;
    for (const m of MINERALS) s.cargo[m] = Math.max(0, Math.min(s.cargo[m] - Math.trunc(s.cargo[m] * 0.1), s.cargo[m] - 10));
  }
  game.salvage = game.salvage.filter(s => s.cargo.ironium + s.cargo.boranium + s.cargo.germanium > 0);
}

function instaform(game: GameState, rng: Rng) {
  for (const planet of game.planets) {
    if (planet.owner < 0) continue;
    const player = game.players[planet.owner];
    const rs = raceSpec(player.race);
    if (!rs.instaform) continue;
    // permaform
    if (planet.pop >= 100000 && rng.chance(rs.permaformChance)) {
      const center = rs.habCenter;
      const dims = [0, 1, 2].filter(i => !player.race.immune[i] && planet.baseHab[i] !== center[i]);
      if (dims.length) {
        const i = rng.pick(dims);
        planet.baseHab[i] += Math.sign(center[i] - planet.baseHab[i]);
        player.messages.push({ year: game.year, kind: 'colony', text: `L'environnement de ${planet.name} s'est amélioré de façon permanente.`, target: { kind: 'planet', id: planet.id } });
      }
    }
    planet.hab = [...planet.baseHab] as typeof planet.hab;
    planet.terraformed = [0, 0, 0];
    const rem = terraformRemaining(player, planet);
    for (let i = 0; i < 3; i++) { planet.hab[i] += rem[i]; planet.terraformed[i] = rem[i]; }
  }
}

function refuel(game: GameState) {
  for (const f of game.fleets) {
    const owner = game.players[f.owner];
    const spec = fleetSpec(game, f);
    if (spec.fuelGeneration > 0) f.fuel = Math.min(spec.fuelCapacity, f.fuel + spec.fuelGeneration);
    const pl = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
    if (canRefuelAt(game, owner, pl)) f.fuel = spec.fuelCapacity;
  }
}

/**
 * Bombing. 0.3.9.16, as in Stars! (2.70f: "multiple fleets bombing one planet act as one fleet"): each empire bombs once a
 * year with all its bombers in orbit together, against the defenses standing at the start of its strike (normal bombs,
 * then smart bombs, then retro-bombs); the minimum kill counts for the whole strike, smart bombs never kill the last 100
 * colonists ("smart bombs alone will not completely destroy a planet's population"), and the installations destroyed add
 * up to the strength of the bombs. Before, each fleet bombed on its own against the defenses the previous one had just
 * knocked down. A world emptied by bombs can still be taken by troops the same year (see resolveLandings).
 */
function bombing(game: GameState, rng: Rng) {
  for (const planet of game.planets) {
    if (planet.owner < 0 || planet.pop <= 0 || planet.starbase) continue;
    const defender = game.players[planet.owner];
    if (raceSpec(defender.race).livesOnStarbases) continue;
    const bombers = game.fleets.filter(f => f.orbiting === planet.id && f.owner !== planet.owner && fleetSpec(game, f).bomber);
    if (!bombers.length) continue;
    const by = new Map<number, Fleet[]>();
    for (const f of bombers) {
      const owner = game.players[f.owner];
      const plan = owner.battlePlans.find(b => b.id === f.battlePlan) ?? owner.battlePlans[0];
      if (!willAttack(game, owner, plan, planet.owner)) continue;
      const l = by.get(f.owner) ?? []; l.push(f); by.set(f.owner, l);
    }
    for (const [oid, fleets] of [...by].sort((a, b) => a[0] - b[0])) {
      const owner = game.players[oid];
      const spec = planetSpec(game, planet, defender);
      let killRate = 0, minKill = 0, structures = 0, survive = 1, smartMin = 0, unterra = 0;
      for (const f of fleets) for (const t of f.tokens) {
        const s = specOf(game, t.designId);
        for (const b of s.bombs) {
          const q = b.qty * t.qty;
          if (b.unterraform > 0) unterra += b.unterraform * q;
          else if (b.smart) { survive *= Math.pow(1 - b.killRate / 100, q); smartMin += b.minKill * q; }
          else { killRate += b.killRate * q; minKill += b.minKill * q; structures += b.structure * q; }
        }
      }
      // Constellations 3: siege doctrine, planetary shield megaproject
      const mult = (hasDoctrine(owner, 'siege') ? 1.3 : 1) * (hasMega(planet, 'shield') ? 0.25 : 1);
      const whoThem = `Les bombardiers des ${owner.name}`;
      const parts: string[] = [];
      if (killRate > 0 || structures > 0) {
        const cov = spec.defenseCoverage;
        const killed = Math.min(planet.pop, Math.max(Math.round(killRate * mult / 100 * (1 - cov) * planet.pop / 100) * 100, Math.round(minKill * mult * (1 - cov) / 100) * 100));
        const total = planet.mines + planet.factories + planet.defenses;
        const structs = Math.min(total, Math.trunc(structures * (1 - cov * 0.5)));
        const have = [planet.mines, planet.factories, planet.defenses];
        const destroyed = have.map(x => total > 0 ? Math.floor(structs * x / total) : 0);
        // what the rounding left goes to the largest remainders: the total destroyed is the strength of the bombs
        let rest = structs - destroyed.reduce((a, b) => a + b, 0);
        const order = [0, 1, 2].sort((a, b) => (structs * have[b] / Math.max(1, total) - destroyed[b]) - (structs * have[a] / Math.max(1, total) - destroyed[a]));
        for (const i of order) if (rest > 0 && destroyed[i] < have[i]) { destroyed[i]++; rest--; }
        planet.mines -= destroyed[0]; planet.factories -= destroyed[1]; planet.defenses -= destroyed[2];
        planet.pop -= killed;
        parts.push(`${people(game, killed)} colons tués, ${destroyed[0]} mines, ${destroyed[1]} usines et ${destroyed[2]} défenses détruites`);
      }
      if (survive < 1 && planet.pop > 100) {
        // smart bombs, against the defenses of the start of the strike (Stars!); they never kill the last 100 colonists
        const cov = spec.defenseCoverageSmart;
        const killed = Math.min(planet.pop - 100, Math.max(Math.round(planet.pop * (1 - cov) * Math.min(1, (1 - survive) * mult) / 100) * 100, Math.round(smartMin * mult * (1 - cov) / 100) * 100));
        if (killed > 0) { planet.pop -= killed; parts.push(`${people(game, killed)} colons tués par les bombes intelligentes`); }
      }
      if (unterra > 0) {
        let moved = 0;
        for (let k = 0; k < unterra; k++) {
          let bi = -1, bd = 0;
          for (let i = 0; i < 3; i++) { const d = Math.abs(planet.hab[i] - planet.baseHab[i]); if (d > bd) { bd = d; bi = i; } }
          if (bi < 0) break;
          const sg = Math.sign(planet.baseHab[bi] - planet.hab[bi]);
          planet.hab[bi] += sg; planet.terraformed[bi] += sg; moved++;
        }
        if (moved) parts.push('dé-terraformée');
      }
      if (parts.length) {
        owner.messages.push({ year: game.year, kind: 'combat', text: fleets.length > 1 ? `Vos ${fleets.length} flottes de bombardiers ont bombardé ${planet.name} : ${parts.join(' ; ')}.` : `${fleets[0].name} a bombardé ${planet.name} : ${parts.join(' ; ')}.`, target: { kind: 'planet', id: planet.id } });
        defender.messages.push({ year: game.year, kind: 'combat', text: `${whoThem} ont bombardé ${planet.name} : ${parts.join(' ; ')}.`, target: { kind: 'planet', id: planet.id } });
      }
      if (planet.pop <= 0) {
        report(game, owner, defender, planet, `${planet.name} a été entièrement dépeuplée par les bombardements.`);
        (game.emptied ??= {})[planet.id] = { owner: defender.id, year: game.year };
        emptyPlanet(planet);
        break;
      }
    }
  }
  void rng;
}

/** For the checks. */
export const repairForTests = (game: GameState) => repair(game);
/** For the checks. */
export const bombingForTests = (game: GameState, rng: Rng) => bombing(game, rng);

function report(game: GameState, attacker: Player, defender: Player, planet: Planet, text: string) {
  attacker.messages.push({ year: game.year, kind: 'combat', text, target: { kind: 'planet', id: planet.id } });
  defender.messages.push({ year: game.year, kind: 'combat', text, target: { kind: 'planet', id: planet.id } });
}

function repair(game: GameState) {
  // 0.3.9.17 (help, Damage Repair): a station under attack this year gives no repair bonus
  const fought = new Set(game.battles.map(b => b.planetId).filter((x): x is number => x !== undefined));
  for (const f of game.fleets) {
    if (!f.tokens.some(t => t.qtyDamaged > 0 && t.damage > 0)) continue;
    if (f.gatedYear === game.year) continue; // no repairs the year it went through a stargate
    const owner = game.players[f.owner];
    const spec = fleetSpec(game, f);
    const pl = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
    let rate: number;
    if (f.waypoints.length > 1) rate = 0.01;
    else if (!pl) rate = 0.02;
    else if (pl.owner === f.owner) rate = 0.05;
    // (0.3.9.21: the fleet's own battle plan, the one its bombing follows)
    else if (spec.bomber && pl.owner >= 0 && willAttack(game, owner, owner.battlePlans.find(b => b.id === f.battlePlan) ?? owner.battlePlans[0], pl.owner)) rate = 0;
    else rate = 0.03;
    if (rate > 0) rate += spec.repairBonus;
    if (pl && pl.owner === f.owner && pl.starbase && !fought.has(pl.id)) rate += specOf(game, pl.starbase.designId).repairBonus;
    if (rate <= 0) continue;
    for (const t of f.tokens) {
      if (t.qtyDamaged <= 0) continue;
      const s = specOf(game, t.designId);
      const r = Math.max(1, Math.trunc(s.armor * rate * raceSpec(owner.race).repairFactor));
      t.damage = Math.max(0, t.damage - r);
      if (t.damage === 0) t.qtyDamaged = 0;
    }
  }
  for (const p of game.planets) {
    if (!p.starbase || p.starbase.damage <= 0) continue;
    const s = specOf(game, p.starbase.designId);
    const r = Math.max(1, Math.trunc(s.armor * 0.1 * raceSpec(game.players[p.owner].race).starbaseRepairFactor));
    p.starbase.damage = Math.max(0, p.starbase.damage - r);
  }
}

function remoteTerraform(game: GameState) {
  for (const f of game.fleets) {
    const spec = fleetSpec(game, f);
    if (spec.terraformRate <= 0 || f.orbiting < 0) continue;
    const planet = game.planets[f.orbiting];
    if (planet.owner < 0) continue;
    const owner = game.players[f.owner];
    const target = game.players[planet.owner];
    if (planet.owner === f.owner || (owner.relations[planet.owner] === 'friend')) {
      for (let i = 0; i < spec.terraformRate; i++) {
        const rem = terraformRemaining(target, planet);
        const dim = rem.findIndex(x => x !== 0);
        if (dim < 0) break;
        planet.hab[dim] += Math.sign(rem[dim]); planet.terraformed[dim] += Math.sign(rem[dim]);
      }
    }
  }
}

function idleMessages(game: GameState) {
  for (const f of game.fleets) {
    const owner = game.players[f.owner];
    if (owner.ai) continue;
    if (f.prevX !== undefined && (f.prevX !== f.x || f.prevY !== f.y) && f.waypoints.length === 1 && !f.auto) {
      const where = f.orbiting >= 0 ? game.planets[f.orbiting].name : `(${Math.round(f.x)}, ${Math.round(f.y)})`;
      // a standing order at the arrival point is not "waiting for orders"
      const task = f.waypoints[0]?.task;
      const text = task === 'remoteMine' ? `${f.name} est arrivée à ${where} et commence à forer (premiers minerais l'an prochain).`
        : task === 'layMines' ? `${f.name} est arrivée à ${where} et pose ses mines.`
        : task === 'patrol' ? `${f.name} est arrivée à ${where} et patrouille.`
        : task === 'stay' ? `${f.name} est arrivée à ${where} et reste en poste.`
        : task === 'refuel' ? `${f.name} est à son poste à ${where} : elle ravitaillera les flottes à court de carburant dans un rayon de ${f.waypoints[0].patrolRange ?? defaultTankerRange(game, f)} al.`
        : isStudying(game, f) ? `${f.name} est arrivée à ${where} et commence l'étude de l'anomalie.`
        : secretStudyOf(game, f)?.kind === 'probe' ? `${f.name} est arrivée dans la zone de sondage et cherche un passage dans le nuage.`
        : secretStudyOf(game, f)?.kind === 'seal' ? `${f.name} est arrivée au trou de ver scellé et commence à l'étudier.`
        : pendingRefit(game, f) ? `${f.name} est arrivée à ${where} : modernisation en chantier (${pendingRefit(game, f)!.to}).`
        : `${f.name} est arrivée à ${where} et attend des ordres.`;
      owner.messages.push({ year: game.year, kind: 'fleet', text, target: { kind: 'fleet', id: f.id } });
    }
  }
}

function randomEvents(game: GameState, rng: Rng) {
  if (!game.settings.randomEvents) return;
  const years = game.year - 2400;
  if (years > 10 && rng.chance(0.05)) {
    const candidates = game.planets.filter(p => years > 20 || p.owner < 0);
    if (!candidates.length) return;
    const p = rng.pick(candidates);
    const size = rng.int(4);
    const bonus = [50, 100, 200, 300][size] + rng.int([250, 500, 1000, 1500][size]);
    const m = MINERALS[rng.int(3)];
    p.surface[m] += bonus;
    p.conc[m] = Math.min(200, p.conc[m] + 10 + rng.int(20));
    const dim = rng.int(3);
    const delta = (rng.chance(0.5) ? 1 : -1) * (1 + rng.int(4));
    p.hab[dim] = Math.max(1, Math.min(99, p.hab[dim] + delta)); p.baseHab[dim] = Math.max(1, Math.min(99, p.baseHab[dim] + delta));
    let killed = 0;
    if (p.owner >= 0) { killed = Math.trunc(p.pop * [0.25, 0.45, 0.65, 0.85][size] / 100) * 100; p.pop -= killed; }
    const sz = ['petite', 'moyenne', 'grande', 'énorme'][size];
    const ore = ({ ironium: 'd\'ironium', boranium: 'de boranium', germanium: 'de germanium' } as const)[m];
    const text = killed
      ? `Une comète ${sz} a frappé ${p.name} : ${people(game, killed)} colons tués et ${bonus} kt ${ore} déposés en surface.`
      : `Une comète ${sz} a frappé ${p.name} : ${bonus} kt ${ore} déposés en surface.`;
    for (const pl of game.players) if (pl.intel.planets[p.id]?.year !== undefined || p.owner === pl.id) pl.messages.push({ year: game.year, kind: 'event', text, target: { kind: 'planet', id: p.id } });
  }
}

/** 0.3.9.18: a game created in 0.3.9.17 had artifacts on a third of the free worlds: one in ten is enough. */
function thinArtifacts(game: GameState) {
  if (game.artifactsThinned) return;
  game.artifactsThinned = true;
  const rng = new Rng(seedFromString(game.settings.seed + '|artifacts-thin'));
  for (const pl of game.planets) if (pl.artifact && pl.owner < 0 && !rng.chance(0.3)) pl.artifact = false;
}

function checkDeath(game: GameState) {
  for (const p of game.players) {
    if (p.dead) continue;
    const hasPlanet = game.planets.some(pl => pl.owner === p.id);
    // 0.3.9: with the diaspora, it takes an ark with colonists aboard (Stars!: any colonizer)
    if (!hasPlanet && !survivesWithoutWorld(game, p)) {
      p.dead = true;
      for (const f of game.fleets.filter(x => x.owner === p.id)) game.fleets.splice(game.fleets.indexOf(f), 1);
      for (const o of game.players) o.messages.push({ year: game.year, kind: 'diplomacy', text: o === p ? 'Votre empire a été anéanti.' : `L'empire des ${p.name} a été anéanti.`, target: { kind: 'score', id: 0 } });
      if (!p.monster) addChronicle(game, 'death', `L'empire des ${p.name} disparaît.`, [p.id]);
    }
  }
}

/** 0.3.9: the victory, once, in the chronicle. */
function victoryChronicle(game: GameState) {
  if (game.victor === null || game.chronicle?.events.some(e => e.kind === 'victory')) return;
  const w = game.players[game.victor];
  const how = game.victoryKind === 'megaproject' ? `Les ${w.name} achèvent le Portail de l'Ascension et remportent la partie.`
    : game.victoryKind === 'crisis' ? `Les ${w.name} abattent le Nexus et remportent la partie.`
      : game.victoryKind === 'seal' ? `Les ${w.name} scellent la Brèche et remportent la partie.`
      : game.victoryKind === 'origin' ? `Les ${w.name} accomplissent le destin de leur origine et remportent la partie.`
      : game.victoryKind === 'lastStanding' ? `Les ${w.name}, derniers debout, remportent la partie.`
        : `Les ${w.name} atteignent les conditions de victoire.`;
  addChronicle(game, 'victory', how, [w.id]);
}

export { distance };
export type { Fleet };
