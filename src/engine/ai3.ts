// Computer players and the Constellations 3 rules: regional capitals, logistics network, megaprojects (building the
// Portail, and ganging up on whoever builds one), battle roles and retreat thresholds.
import type { GameState, Planet, Player, QueueItem } from './types';
import { planetSpec } from './planet';
import { ADMIN_RADIUS, adminFactor, distanceCostOn, regionalBlocker, seatsOf } from './empire';
import { logisticsOn, DEFAULT_IN, joinNetwork, canServe } from './logistics';
import { MEGA, megaBlocker, megaOn, portalThreat, relaysOn, relaysOf, RELAYS_NEEDED, type MegaId } from './megaprojects';
import { canBuildShip, isAuto, zeroCost } from './production';
import { designSpec } from './design';
import { raceSpec } from './race';
import { distance, fleetSpec } from './fleet';
import { aiStudies } from './anomalies';
import { guardianStrength } from './guardians';
import { safeGoto, decentLeg } from './ai';
import { mergeFleets } from './tasks';
import { piratesActive, raidsAgainst, etaYears, liveLairs, lairStrength, bountyBlocker, BOUNTY_UNIT } from './pirates';
import { fleetStrength } from './factions';
import { warOnPortal } from './diplomacy';
import { intelOn, agencyBlocker, agencyOf, spyBlocker } from './espionage';
import { capitalOf } from './empire';
import { pendingRefit } from './refit';

const has = (game: GameState, p: Player, pred: (q: QueueItem) => boolean) => game.planets.some(pl => pl.owner === p.id && pl.queue.some(pred));
const insertBeforeAuto = (pl: Planet, item: QueueItem) => { const i = pl.queue.findIndex(q => isAuto(q.kind)); pl.queue.splice(i < 0 ? pl.queue.length : i, 0, item); };

export function runAI3(game: GameState, p: Player) {
  aiGuardians(game, p);
  aiPirates(game, p);
  aiIntel(game, p);
  aiBeacons(game, p);
  aiStudies(game, p);
  aiObjectives(game, p);
  aiCapitals(game, p);
  aiLogistics(game, p);
  aiMegaprojects(game, p);
  aiCombatRules(game, p);
}

/** Constellations 3.5: an intelligence agency once the economy allows it; spies on the enemy at war (the Super Stealth on their neighbours too). */
function aiIntel(game: GameState, p: Player) {
  if (!intelOn(game) || p.ai === 'easy') return;
  const cap = capitalOf(game, p) ?? game.planets.filter(x => x.owner === p.id).sort((a, b) => b.pop - a.pop)[0];
  if (!cap) return;
  const res = planetSpec(game, cap, p).resources;
  if (game.year >= 2430 && res > 500 && !agencyOf(game, p.id) && !agencyBlocker(game, cap) && !has(game, p, q => q.kind === 'agency')) insertBeforeAuto(cap, { kind: 'agency', qty: 1, allocated: zeroCost() });
  if (res < 300 || (game.year + p.id * 5) % 6 !== 0) return;
  const st = p.aiState;
  let target = st?.phase === 'war' ? st.targetPlayer : undefined;
  if (target === undefined && p.race.prt === 'SS') {
    const mine = game.planets.filter(x => x.owner === p.id);
    let best = Infinity;
    for (const pi of p.intel.planets) {
      if (pi.owner === undefined || pi.owner < 0 || pi.owner === p.id || game.players[pi.owner]?.monster) continue;
      const d = Math.min(...mine.map(m => distance(m, game.planets[pi.id])));
      if (d < best) { best = d; target = pi.owner; }
    }
  }
  if (target === undefined || spyBlocker(game, p, target) || (p.intel.dossiers?.[target]?.network ?? 0) >= 30) return;
  if (has(game, p, q => q.kind === 'spy' && q.bountyOn === target)) return;
  insertBeforeAuto(cap, { kind: 'spy', bountyOn: target, qty: 2, allocated: zeroCost() });
}

const wants = (game: GameState, p: Player, id: string) => !!game.settings.secretObjectives && !!p.objectives?.some(o => o.id === id && o.done === undefined && o.failed === undefined);

/** Computer players pursue their secret objectives a little (explore more, pick the designated rival). */
function aiObjectives(game: GameState, p: Player) {
  if (!game.settings.secretObjectives || !p.objectives) return;
  const st = p.aiState;
  if (wants(game, p, 'vendetta') && st?.phase === 'war' && st.portalTarget === undefined) {
    const o = p.objectives.find(x => x.id === 'vendetta')!;
    const rival = o.param2 !== undefined ? game.players[o.param2] : undefined;
    if (rival && !rival.dead && p.intel.met.includes(rival.id) && p.relations[rival.id] === 'enemy') st.targetPlayer = rival.id;
  }
  if (wants(game, p, 'cartographer')) {
    const scouts = game.fleets.filter(f => f.owner === p.id && f.purpose === 'scout').length;
    const d = game.designs.filter(x => x.owner === p.id && !x.deleted && !x.alien && x.purpose === 'scout').sort((a, b) => b.id - a.id)[0];
    const queued = has(game, p, q => q.kind === 'ship' && q.designId === d?.id);
    const yard = d ? game.planets.filter(x => x.owner === p.id).sort((a, b) => b.pop - a.pop).find(x => !canBuildShip(game, x, d)) : undefined;
    if (d && yard && scouts < 3 && !queued) insertBeforeAuto(yard, { kind: 'ship', designId: d.id, qty: 1, allocated: zeroCost() });
  }
}

/** A regional capital where the most output is lost to distance. */
function aiCapitals(game: GameState, p: Player) {
  if (!distanceCostOn(game) || has(game, p, q => q.kind === 'capital')) return;
  const mine = game.planets.filter(x => x.owner === p.id);
  const seats = seatsOf(game, p);
  let best: Planet | null = null, gain = 0;
  for (const c of mine) {
    if (regionalBlocker(game, c)) continue;
    let g = 0;
    for (const o of mine) {
      const d = distance(o, c);
      if (d > ADMIN_RADIUS) continue;
      const now = seats.length ? adminFactor(Math.min(...seats.map(s => distance(s, o)))) : 1;
      g += planetSpec(game, o, p).resourcesBase * (1 - now);
    }
    if (g > gain) { gain = g; best = c; }
  }
  if (best && gain >= (wants(game, p, 'governor') ? 5 : 25)) best.queue.unshift({ kind: 'capital', qty: 1, allocated: zeroCost() });
}

/** Migration policies and a few freighters for the network. */
function aiLogistics(game: GameState, p: Player) {
  if (!logisticsOn(game) || raceSpec(p.race).livesOnStarbases) return;
  const mine = game.planets.filter(x => x.owner === p.id);
  if (mine.length < 3) return;
  const cap = seatsOf(game, p)[0];
  let receivers = 0;
  for (const pl of mine) {
    if (pl === cap) continue;
    const sp = planetSpec(game, pl, p);
    const fill = sp.maxPop > 0 ? pl.pop / sp.maxPop : 1;
    if (sp.hab > 0 && fill < 0.25 && sp.maxPop >= 200_000) { pl.migration = { mode: 'in', target: DEFAULT_IN }; receivers++; }
    else if (pl.migration?.mode === 'in' && fill >= pl.migration.target / 100) pl.migration = undefined;
    else if (pl.migration?.mode === 'in') receivers++;
  }
  if (cap) {
    const sp = planetSpec(game, cap, p);
    cap.migration = receivers && cap.pop > sp.maxPop * 0.6 ? { mode: 'out', target: 60 } : undefined;
  }
  // freighters: existing idle cargo ships join, else build a couple
  const net = game.fleets.filter(f => f.owner === p.id && f.auto === 'logistics');
  const want = receivers ? Math.min(4, 1 + Math.floor(receivers / 3)) : 0;
  if (net.length >= want || !cap) return;
  const spare = game.fleets.filter(f => f.owner === p.id && !f.auto && f.purpose === 'freighter' && f.waypoints.length <= 1 && f.cargo.colonists === 0 && canServe(game, f));
  for (const f of spare.slice(0, want - net.length)) { if (joinNetwork(game, f)) f.purpose = 'logistics'; }
  const after = game.fleets.filter(f => f.owner === p.id && f.auto === 'logistics').length;
  if (after >= want || has(game, p, q => q.mission?.kind === 'logistics')) return;
  const d = game.designs.filter(x => x.owner === p.id && !x.deleted && !x.alien && x.purpose === 'freighter').sort((a, b) => b.id - a.id)[0];
  const yard = [...mine].sort((a, b) => b.pop - a.pop).find(pl => d && !canBuildShip(game, pl, d));
  if (d && yard) insertBeforeAuto(yard, { kind: 'ship', designId: d.id, qty: 1, allocated: zeroCost(), mission: { kind: 'logistics', planetId: yard.id } });
}

/** Builds megaprojects when rich enough; everybody turns on the builder of the Portail. */
function aiMegaprojects(game: GameState, p: Player) {
  if (!megaOn(game)) return;
  const st = p.aiState;
  // react: the Portail of someone else is a war target, whatever the phase
  const threat = portalThreat(game);
  if (st) {
    if (threat && threat.owner !== p.id && p.relations[threat.owner] !== 'friend') {
      // 0.3.9: a relay may be easier to take than the Portal itself, and stops it as well
      const targets = [threat.planet, ...(relaysOn(game) ? relaysOf(game, threat.owner) : [])];
      const mineW = game.planets.filter(x => x.owner === p.id);
      const near = (t: Planet) => Math.min(Infinity, ...mineW.map(m => Math.hypot(m.x - t.x, m.y - t.y)));
      st.portalTarget = targets.sort((a, b) => near(a) - near(b))[0].id;
      st.targetPlayer = threat.owner;
      warOnPortal(game, p.id, threat.owner);
      st.phase = 'war';
      if (!p.intel.met.includes(threat.owner)) p.intel.met.push(threat.owner);
    } else st.portalTarget = undefined;
  }
  const mine = game.planets.filter(x => x.owner === p.id).sort((a, b) => b.pop - a.pop);
  const home = mine[0];
  if (!home) return;
  const res = planetSpec(game, home, p).resources;
  const consider = (id: MegaId, pl: Planet, minRes: number) => {
    if (has(game, p, q => q.kind === 'mega' && q.megaId === id)) return;
    if (megaBlocker(game, pl, id) || res < minRes) return;
    insertBeforeAuto(pl, { kind: 'mega', megaId: id, qty: 1, allocated: zeroCost() });
  };
  const years = game.year - 2400;
  // 0.3.9: the relays first, on the three richest worlds that have none (one under way at a time)
  if (relaysOn(game) && p.ai !== 'easy' && years >= 50 && relaysOf(game, p.id).length < RELAYS_NEEDED && !has(game, p, q => q.kind === 'mega' && q.megaId === 'relay')) {
    const at = mine.slice(0, 6).find(pl => !megaBlocker(game, pl, 'relay'));
    if (at) consider('relay', at, MEGA.relay.cost.resources / MEGA.relay.minYears * 1.5);
  }
  // 0.3.9: the Seal of the Ancients, as soon as it can rise somewhere
  if (p.secretKnown !== undefined && !has(game, p, q => q.kind === 'mega' && q.megaId === 'seal')) {
    const at = game.planets.find(pl => pl.owner === p.id && !megaBlocker(game, pl, 'seal'));
    if (at) insertBeforeAuto(at, { kind: 'mega', megaId: 'seal', qty: 1, allocated: zeroCost() });
  }
  // the Portail: a strong empire not currently losing goes for it
  if (p.ai !== 'easy' && years >= 60) consider('portal', home, MEGA.portal.cost.resources / MEGA.portal.minYears);
  const eager = wants(game, p, 'architect') ? 0.4 : 1;
  if (st?.phase === 'war') consider('shield', home, MEGA.shield.cost.resources / MEGA.shield.minYears * 2.5 * eager);
  consider('shipyard', home, MEGA.shipyard.cost.resources / MEGA.shipyard.minYears * 3 * eager);
  if (eager < 1) consider('observatory', home, MEGA.observatory.cost.resources / MEGA.observatory.minYears);
}

/** Torpedo ships stay behind the line; harder computers withdraw beaten fleets. */
function aiCombatRules(game: GameState, p: Player) {
  if (!game.settings.combatRoles) return;
  for (const d of game.designs) {
    if (d.owner !== p.id || d.starbase || d.role) continue;
    const s = designSpec(p, d);
    if (!s.hasWeapons) continue;
    d.role = s.weapons.every(w => w.torpedo || w.range >= 3) ? 'artillery' : 'line';
  }
  const plan = p.battlePlans[0];
  if (plan && plan.retreatAt === undefined) plan.retreatAt = p.ai === 'easy' ? 0 : 70;
}

/**
 * Constellations 3.3: enemy sovereignty beacons near the AI's worlds (they block its colonies): idle warships at
 * home go and destroy one once clearly stronger than it.
 */
function aiBeacons(game: GameState, p: Player) {
  if (!game.settings.culture || p.ai === 'easy') return;
  const mine = game.planets.filter(pl => pl.owner === p.id);
  if (!mine.length) return;
  const beacons = game.fleets.filter(f => f.beaconOf !== undefined && f.owner !== p.id && p.relations[f.owner] === 'enemy' && p.intel.fleets.some(x => x.id === f.id && x.owner === f.owner)
    && mine.some(pl => distance(pl, f) <= 200));
  if (!beacons.length) return;
  for (const b of beacons) {
    const bs = fleetSpec(game, b);
    const strength = Math.max(1, bs.armor + bs.shields) * Math.max(1, bs.powerRating);
    const ships = game.fleets.filter(f => f.owner === p.id && f.purpose === 'warship' && f.waypoints.length <= 1 && f.orbiting >= 0 && game.planets[f.orbiting].owner === p.id && fleetSpec(game, f).hasWeapons && !f.aiGuard && !pendingRefit(game, f))
      .sort((a, c) => distance(a, b) - distance(c, b));
    let hp = 0, pow = 0;
    const group: typeof ships = [];
    for (const f of ships) { const sp = fleetSpec(game, f); hp += sp.armor + sp.shields; pow += sp.powerRating; group.push(f); if (hp * pow >= strength * 3) break; }
    if (hp * pow < strength * 3) continue;
    for (const f of group) {
      const home = f.waypoints[0];
      if (!safeGoto(game, f, { x: b.x, y: b.y, planetId: b.beaconOf }, 'none', true) || !decentLeg(game, f)) f.waypoints = [home]; // (0.3.9.21: with the fuel to come back)
    }
    return; // one at a time
  }
}

/** Guarded worlds: other ships keep away; idle warships go and beat a guardian once clearly stronger. */
function aiGuardians(game: GameState, p: Player) {
  const gs = (game.guardians ?? []).filter(g => g.alive && p.intel.planets[g.planetId]?.guardian);
  // 3.4: pirate lairs and the Breach are no place for a freighter either
  const lairs = p.intel.planets.filter(pi => pi.lair).map(pi => pi.id);
  if (!gs.length && !lairs.length) return;
  const guarded = new Set([...gs.map(g => g.planetId), ...lairs]);
  for (const f of game.fleets) {
    if (f.owner !== p.id || f.waypoints.length < 2 || f.purpose === 'warship' || f.purpose === 'bomber') continue;
    const last = f.waypoints[f.waypoints.length - 1];
    if (last.target === 'planet' && last.targetId !== undefined && guarded.has(last.targetId)) f.waypoints = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true }];
  }
  const st = p.aiState;
  if (!gs.length || p.ai === 'easy' || game.year < 2425 || st?.portalTarget !== undefined) return;
  const margin = st?.phase === 'war' ? 4 : 2.5;
  // idle warships, by the planet they guard
  const groups = new Map<number, typeof game.fleets>();
  for (const f of game.fleets) {
    if (f.owner !== p.id || f.purpose !== 'warship' || f.waypoints.length > 1 || f.orbiting < 0 || f.aiGuard || pendingRefit(game, f)) continue;
    if (game.planets[f.orbiting].owner !== p.id || !fleetSpec(game, f).hasWeapons) continue;
    const l = groups.get(f.orbiting) ?? []; l.push(f); groups.set(f.orbiting, l);
  }
  for (const [pid, fleets] of groups) {
    const at = game.planets[pid];
    const target = gs.filter(g => distance(game.planets[g.planetId], at) <= game.width * 0.35).sort((a, b) => distance(game.planets[a.planetId], at) - distance(game.planets[b.planetId], at))[0];
    if (!target) continue;
    let hp = 0, pow = 0;
    for (const f of fleets) { const sp = fleetSpec(game, f); hp += sp.armor + sp.shields; pow += sp.powerRating; }
    if (hp * pow < guardianStrength(game, target) * margin) continue;
    const lead = fleets[0];
    for (const f of fleets.slice(1)) mergeFleets(game, lead, f);
    const pl = game.planets[target.planetId];
    const home = lead.waypoints[0];
    if (!safeGoto(game, lead, { x: pl.x, y: pl.y, planetId: pl.id }, 'none', true) || !decentLeg(game, lead)) { lead.waypoints = [home]; continue; } // (0.3.9.21: with the fuel to come back: sent one way, they stayed stranded for decades)
    return; // one hunt at a time
  }
}

/**
 * Constellations 3.4, the pirates: idle warships meet a raid announced against one of the AI's worlds when they can
 * get there in time and are clearly stronger; otherwise the world raises its defenses. Once strong enough the AI
 * goes and destroys the nearest lair, and at war it pays the pirates to harass its enemy.
 */
function aiPirates(game: GameState, p: Player) {
  for (const f of game.fleets) if (f.owner === p.id && f.aiGuard && f.aiGuard.until < game.year) f.aiGuard = undefined;
  if (!piratesActive(game)) return;
  const st = p.aiState;
  const idleWar = () => game.fleets.filter(f => f.owner === p.id && f.purpose === 'warship' && !f.aiGuard && f.waypoints.length <= 1 && f.orbiting >= 0 && !pendingRefit(game, f)
    && game.planets[f.orbiting].owner === p.id && fleetSpec(game, f).hasWeapons && fleetSpec(game, f).hasEngines);
  // 1. raids announced against us
  for (const raid of raidsAgainst(game, p.id)) {
    const target = game.planets[raid.raid!.target];
    if (target.owner !== p.id || game.fleets.some(f => f.owner === p.id && f.aiGuard?.planetId === target.id)) continue;
    const need = fleetStrength(game, raid) * 1.5;
    const eta = etaYears(game, raid, target);
    const group: typeof game.fleets = [];
    let sum = 0;
    for (const f of idleWar().sort((a, b) => distance(a, target) - distance(b, target))) {
      if (distance(f, target) > 0 && etaYears(game, f, target) > eta + 1) continue;
      group.push(f); sum += fleetStrength(game, f);
      if (sum >= need) break;
    }
    if (sum >= need) {
      for (const f of group) {
        if (distance(f, target) > 0 && !safeGoto(game, f, { x: target.x, y: target.y, planetId: target.id }, 'none', false)) continue;
        f.aiGuard = { planetId: target.id, until: game.year + eta + 3 };
      }
    } else if (!raceSpec(p.race).livesOnStarbases && !target.queue.some(q => q.kind === 'defenses' || q.kind === 'autoDefenses') && planetSpec(game, target, p).maxDefenses > target.defenses) {
      target.queue.unshift({ kind: 'defenses', qty: Math.min(10, planetSpec(game, target, p).maxDefenses - target.defenses), allocated: zeroCost() });
    }
  }
  // 2. hunt the lairs once clearly stronger (one hunt at a time, not while chasing a Portail)
  const P = game.pirates!;
  if (p.ai !== 'easy' && game.year >= P.emergeYear + 4 && st?.portalTarget === undefined) {
    const margin = st?.phase === 'war' ? 4 : 2.5;
    const groups = new Map<number, typeof game.fleets>();
    for (const f of idleWar()) { const l = groups.get(f.orbiting) ?? []; l.push(f); groups.set(f.orbiting, l); }
    for (const [pid, fleets] of groups) {
      const at = game.planets[pid];
      const lair = liveLairs(game).filter(l => p.intel.planets[l.planetId]?.lair === 'pirates' && distance(game.planets[l.planetId], at) <= game.width * 0.45)
        .sort((a, b) => distance(game.planets[a.planetId], at) - distance(game.planets[b.planetId], at))[0];
      if (!lair) continue;
      const sum = fleets.reduce((a, f) => a + fleetStrength(game, f), 0);
      if (sum < lairStrength(game, lair) * margin) continue;
      const lead = fleets[0];
      for (const f of fleets.slice(1)) mergeFleets(game, lead, f);
      const pl = game.planets[lair.planetId];
      const home = lead.waypoints[0];
      if (!safeGoto(game, lead, { x: pl.x, y: pl.y, planetId: pl.id }, 'none', true) || !decentLeg(game, lead)) { lead.waypoints = [home]; continue; } // (0.3.9.21: with the fuel to come back: sent one way, they stayed stranded for decades)
      break;
    }
  }
  // 3. at war, now and then, a bounty on the enemy
  if (p.ai !== 'easy' && st?.phase === 'war' && st.targetPlayer !== undefined && (game.year + p.id * 7) % 12 === 0 && !bountyBlocker(game, p, st.targetPlayer)) {
    const cap = game.planets.filter(x => x.owner === p.id).sort((a, b) => b.pop - a.pop)[0];
    if (cap && planetSpec(game, cap, p).resources > 400 && !cap.queue.some(q => q.kind === 'bounty')) insertBeforeAuto(cap, { kind: 'bounty', bountyOn: st.targetPlayer, qty: 2, allocated: zeroCost() });
  }
  void BOUNTY_UNIT;
}
