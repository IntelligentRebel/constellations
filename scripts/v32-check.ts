// Constellations 3.2: interception, fog of war, splitting, discoveries, guardians, origins
// (run: npx tsx scripts/v32-check.ts [section...]).
import { quickGame, newFleet } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { fleetSpec, distance } from '../src/engine/fleet';
import { updateIntel } from '../src/engine/scan';
import type { DesignSlot, Fleet, GameState, ShipDesign } from '../src/engine/types';
import { planIntercept, applyIntercept, runPursuits } from '../src/engine/intercept';
import { splitIntoSingles } from '../src/engine/tasks';
import { planetSpec, growthAmount } from '../src/engine/planet';
import { createGame, defaultSettings, CONSTELLATIONS_RULES } from '../src/engine/newgame';
import { PREDEFINED_RACES, habitability } from '../src/engine/race';
import { AI_RACES } from '../src/engine/airaces';
import { ANOMALIES, discoverAnomalies, runStudies, studyRate, studyBlocker, pointsNeeded, decide, fragmentsNeeded, vaultOf, aiStudies, defOf } from '../src/engine/anomalies';
import { GUARDIAN_KINDS, spawnGuardian, guardianAt, regenGuardians, checkGuardians, isMonster, guardianStrength } from '../src/engine/guardians';
import { ORIGINS, originYear, DOOM_START, DOOM_FLOOR } from '../src/engine/origins';
import { researchFactor, hasRelic } from '../src/engine/relics';
import { Rng } from '../src/engine/rng';
import { resolveBattles } from '../src/engine/battle';
import { checkVictory } from '../src/engine/score';
import { setRule } from '../src/engine/rules';
import { assignObjectives } from '../src/engine/objectives';
import { runAI3 } from '../src/engine/ai3';
import { slowTrip } from '../src/engine/missions';
import { needsFuel, refuelOptions, startRefuel, runTankers, tankerTargets, defaultTankerRange } from '../src/engine/refuel';
import { minefieldDecay, minefieldLifetime, decayMinefields, detonateMinefields, reduceOnImpact } from '../src/engine/movement';
import { mergeFleets, hasOrders, mergeArrivingMiners, techTrade } from '../src/engine/tasks';
import { meet } from '../src/engine/scan';
import { travel } from '../src/engine/ai';
import { betterPart, upgradeTargets, upgradeDesigns, nextDesignName } from '../src/engine/upgrade';
import { TECHS } from '../src/engine/tech';
import { autoDesign, designSpec } from '../src/engine/design';
import { spawnTraders, traderHails, TRADER_HAIL } from '../src/engine/trader';
const fleetSees = (g: any, me: any, t: any) => g.fleets.some((f: any) => f.owner === me.id && Math.hypot(f.x - t.x, f.y - t.y) <= 300);
import { raceSpec } from '../src/engine/race';

import { revealPlanet } from '../src/engine/scan';
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
const only = process.argv.slice(2);
const want = (s: string) => !only.length || only.includes(s);
/** 3.4: these checks predate negotiated diplomacy: every empire is hostile to every other, as in Stars! */
const noDiplo = (g: GameState) => { g.settings.diplomacy = false; g.diplomacy = undefined; for (const p of g.players) for (const o of g.players) if (p.id !== o.id && !p.monster && !o.monster) p.relations[o.id] = 'enemy'; return g; };
const game = (seed: string, size: 'Tiny' | 'Small' | 'Medium' = 'Small') => noDiplo(quickGame(undefined, size, 3, 'standard', seed));
const quiet = (g: GameState) => { for (const p of g.players) if (!p.monster) p.ai = null; return g; };
let did = 0;
function design(g: GameState, owner: number, hull: string, slots: DesignSlot[], name = 'Test'): ShipDesign {
  const d: ShipDesign = { id: g.nextId++, owner, name: `${name} ${++did}`, hull, slots, starbase: false, built: 0 };
  g.designs.push(d);
  return d;
}
function fleetAt(g: GameState, owner: number, d: ShipDesign, qty: number, pos: { x: number; y: number }): Fleet {
  const home = g.planets.find(p => p.owner === owner)!;
  const f = newFleet(g, g.players[owner], d.id, qty, home);
  f.x = pos.x; f.y = pos.y; f.orbiting = -1;
  f.waypoints = [{ x: pos.x, y: pos.y, target: 'space', warp: 0, task: 'none' }];
  return f;
}
const warship = (engine: string): DesignSlot[] => [{ slot: 1, part: engine, qty: 1 }, { slot: 2, part: 'Laser', qty: 1 }, { slot: 3, part: 'Laser', qty: 1 }, { slot: 5, part: 'Tritanium', qty: 2 }];
/** Empties the map around a point: planets owned by nobody far away, other fleets removed (keeps the test clean). */
function clearFleets(g: GameState, keep: Fleet[]) { g.fleets = g.fleets.filter(f => keep.includes(f)); }

if (want('split')) {
  console.log('--- split into single ships');
  const g = quiet(game('split-1'));
  const d = design(g, 0, 'Destroyer', warship('Long Hump 6'));
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const f = newFleet(g, g.players[0], d.id, 5, home);
  f.tokens[0].damage = 10; f.tokens[0].qtyDamaged = 2;
  f.fuel = 500;
  const fuelBefore = f.fuel, n0 = g.fleets.length;
  const out = splitIntoSingles(g, f);
  const all = [f, ...out];
  check(out.length === 4 && g.fleets.length === n0 + 4, `5 ships give 5 fleets (${out.length + 1})`);
  check(all.every(x => x.tokens.length === 1 && x.tokens[0].qty === 1), 'one ship each');
  check(all.reduce((a, x) => a + x.fuel, 0) === fuelBefore, 'fuel shared out, none lost');
  check(all.filter(x => x.tokens[0].qtyDamaged === 1).length === 2, 'the two damaged ships stay damaged');
  check(out.every(x => x.x === f.x && x.y === f.y && x.waypoints.length === 1), 'new fleets stay put');
  const two = design(g, 0, 'Scout', [{ slot: 1, part: 'Long Hump 6', qty: 1 }]);
  const mixed = newFleet(g, g.players[0], d.id, 2, home);
  mixed.tokens.push({ designId: two.id, qty: 3, damage: 0, qtyDamaged: 0 });
  check(splitIntoSingles(g, mixed).length === 4 && mixed.tokens.reduce((a, t) => a + t.qty, 0) === 1, 'mixed fleet: 2 + 3 ships give 5 fleets');
}

if (want('intercept')) {
  console.log('--- interception');
  const g = quiet(game('icp-1'));
  g.settings.terrain = false; g.terrain = [];
  const me = g.players[0];
  me.tech.propulsion = 12;
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const hs = planetSpec(g, home, me);
  // a raider crossing the homeworld's scanner range at Warp 5, an interceptor with a fast engine
  const raiderD = design(g, 1, 'Destroyer', warship('Long Hump 6'), 'Pillard');
  const fastD = design(g, 0, 'Destroyer', warship('Trans-Galactic Drive'), 'Intercepteur');
  const start = { x: Math.round(home.x - hs.scanRange * 0.8), y: Math.round(home.y + hs.scanRange * 0.5) };
  const raider = fleetAt(g, 1, raiderD, 1, start);
  raider.fuel = 5000;
  const far = { x: Math.round(home.x + 400), y: Math.round(home.y + hs.scanRange * 0.5) };
  raider.waypoints.push({ x: far.x, y: far.y, target: 'space', warp: 5, task: 'none' });
  const icp = fleetAt(g, 0, fastD, 2, { x: home.x, y: Math.round(home.y - 60) });
  icp.fuel = fleetSpec(g, icp).fuelCapacity;
  clearFleets(g, [raider, icp]);
  for (const p of g.players) p.battlePlans[0].attackWho = 'enemies';
  // two observations to estimate the trajectory
  updateIntel(g);
  check(!!me.intel.fleets.find(x => x.id === raider.id), 'the raider is in sight');
  const before = planIntercept(g, icp, raider.id);
  check(before.ok, `one observation only: a plan anyway (${before.ok ? 'ok' : (before as any).reason})`);
  generateTurn(g);
  const plan = planIntercept(g, icp, raider.id);
  check(plan.ok && plan.estimated && plan.years >= 1, `plan from the estimated trajectory: ${plan.ok ? `meeting in ${plan.years} y at Warp ${plan.warp}${plan.direct ? ' (direct)' : ''}` : (plan as any).reason}`);
  if (plan.ok) {
    applyIntercept(g, icp, raider.id, plan);
    check(icp.pursue === raider.id && icp.waypoints.length === 2, 'standing pursuit order given');
    const y0 = g.year;
    let met = 0;
    for (let y = 0; y < plan.years + 2 && !met; y++) {
      generateTurn(g);
      if (g.battles.some(b => b.players.includes(0) && b.players.includes(1))) met = g.year;
    }
    check(met > 0 && met <= y0 + plan.years + 1, `battle with the raider in ${met || 'never'} (planned ${y0 + plan.years})`);
  }
  // pursuer created before its target: still meets it (pursuers move after their targets)
  const g2 = quiet(game('icp-2'));
  g2.settings.terrain = false; g2.terrain = [];
  const h2 = g2.planets.find(p => p.owner === 0 && p.homeworld)!;
  const fd2 = design(g2, 0, 'Destroyer', warship('Trans-Galactic Drive'), 'Chasseur');
  const rd2 = design(g2, 1, 'Destroyer', warship('Long Hump 6'), 'Proie');
  const chaser = fleetAt(g2, 0, fd2, 1, { x: h2.x, y: h2.y - 40 });
  const prey = fleetAt(g2, 1, rd2, 1, { x: h2.x + 30, y: h2.y - 40 });
  prey.fuel = 5000; chaser.fuel = fleetSpec(g2, chaser).fuelCapacity;
  prey.waypoints.push({ x: h2.x + 330, y: h2.y - 40, target: 'space', warp: 5, task: 'none' });
  clearFleets(g2, [chaser, prey]);
  check(g2.fleets.indexOf(chaser) < g2.fleets.indexOf(prey), 'the pursuer comes first in the fleet list');
  chaser.waypoints.push({ x: prey.x, y: prey.y, target: 'fleet', targetId: prey.id, warp: 9, task: 'none' });
  for (const p of g2.players) p.battlePlans[0].attackWho = 'enemies';
  // (0.3.9.16: a fleet sent after another one follows it while it is in the scanners: the prey is seen first)
  updateIntel(g2);
  generateTurn(g2);
  check(g2.battles.length > 0 || (chaser.x === prey.x && chaser.y === prey.y), `steering at the fleet: caught it the same year (${chaser.x},${chaser.y} / ${prey.x},${prey.y})`);
  // a faster fleet running away cannot be caught
  const g3 = quiet(game('icp-3'));
  g3.settings.terrain = false; g3.terrain = [];
  const me3 = g3.players[0];
  const h3 = g3.planets.find(p => p.owner === 0 && p.homeworld)!;
  const hs3 = planetSpec(g3, h3, me3);
  const slowD = design(g3, 0, 'Destroyer', warship('Quick Jump 5'), 'Lent');
  const fastR = design(g3, 1, 'Destroyer', warship('Trans-Galactic Drive'), 'Fuyard');
  const slow = fleetAt(g3, 0, slowD, 1, { x: h3.x, y: h3.y });
  const runner = fleetAt(g3, 1, fastR, 1, { x: Math.round(h3.x + hs3.scanRange * 0.3), y: h3.y });
  runner.fuel = 9000;
  runner.waypoints.push({ x: h3.x + 2000, y: h3.y, target: 'space', warp: 9, task: 'none' });
  clearFleets(g3, [slow, runner]);
  updateIntel(g3); generateTurn(g3);
  const p3 = planIntercept(g3, slow, runner.id);
  check(!p3.ok, `a faster fleet running away: ${p3.ok ? 'plan found?!' : (p3 as any).reason}`);
  // the pursuit stops when the target is gone
  slow.pursue = runner.id;
  g3.fleets = g3.fleets.filter(f => f !== runner);
  runPursuits(g3);
  check(slow.pursue === undefined && me3.messages.some(m => m.text.includes('Poursuite terminée')), 'target gone: pursuit over, with a message');
}

if (want('fog')) {
  console.log('--- fog of war: identified contacts stay identified while followed');
  const g = quiet(game('fog-1'));
  g.settings.terrain = false; g.terrain = [];
  const me = g.players[0];
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const hs = planetSpec(g, home, me);
  const ed = design(g, 1, 'Destroyer', warship('Long Hump 6'), 'Croiseur');
  const enemy = fleetAt(g, 1, ed, 3, { x: Math.round(home.x + hs.scanRange * 0.6), y: home.y });
  const pd = design(g, 0, 'Scout', [{ slot: 1, part: 'Long Hump 6', qty: 1 }, { slot: 2, part: 'Mole Scanner', qty: 1 }], 'Sonde');
  const probe = fleetAt(g, 0, pd, 1, { x: enemy.x + 10, y: enemy.y });
  updateIntel(g);
  let fi = me.intel.fleets.find(x => x.id === enemy.id)!;
  check(fi.detail === 'full' && fi.tokens?.[0].qty === 3 && fi.identYear === undefined, 'penetrating scan: identified now');
  const idYear = g.year;
  probe.x = home.x - 400; probe.y = home.y; // out of range
  g.year += 2; enemy.tokens[0].qty = 5; // reinforced meanwhile
  updateIntel(g);
  fi = me.intel.fleets.find(x => x.id === enemy.id)!;
  check(fi.detail === 'full' && fi.owner === 1 && fi.identYear === idYear && fi.tokens?.[0].qty === 3, `followed by ordinary scanners: still identified, dated ${fi.identYear} (old composition: ${fi.tokens?.[0].qty})`);
  check(!fi.uncertain, 'not shown as an anonymous estimate');
  // lost for a year: a new, unknown contact
  const keep = { x: enemy.x, y: enemy.y };
  enemy.x = home.x + 2000; g.year++; updateIntel(g);
  check(!me.intel.fleets.find(x => x.id === enemy.id), 'out of every scanner: contact lost');
  enemy.x = keep.x; enemy.y = keep.y; g.year++; updateIntel(g);
  fi = me.intel.fleets.find(x => x.id === enemy.id)!;
  check(fi.detail === 'contact' && !fi.tokens && fi.identYear === undefined, 'back in range after a gap: unknown again');
  // classic rules: no change (ordinary scanners see everything)
  g.settings.deception = false; g.settings.anonymousContacts = false; updateIntel(g);
  fi = me.intel.fleets.find(x => x.id === enemy.id)!;
  check(fi.detail === 'full' && fi.tokens?.[0].qty === 5 && fi.identYear === undefined, 'classic rules: exact, current composition');
}

function custom(seed: string, origins: (string | undefined)[], size: 'Tiny' | 'Small' | 'Medium' = 'Small', tweak?: (st: ReturnType<typeof defaultSettings>) => void): GameState {
  const settings = defaultSettings(); settings.size = size; settings.seed = seed;
  tweak?.(settings);
  const players = origins.map((o, i) => ({ race: i === 0 ? PREDEFINED_RACES.Humanoid() : AI_RACES[i % AI_RACES.length](), ai: null, origin: o }));
  return createGame({ name: 't', settings, players });
}
const scoutDesign = (g: GameState, owner: number) => design(g, owner, 'Scout', [{ slot: 1, part: 'Long Hump 6', qty: 1 }, { slot: 2, part: 'Rhino Scanner', qty: 1 }], 'Sonde');
function orbitAt(g: GameState, owner: number, d: ShipDesign, qty: number, planetId: number): Fleet {
  const pl = g.planets[planetId];
  const f = fleetAt(g, owner, d, qty, { x: pl.x, y: pl.y });
  f.orbiting = planetId; f.waypoints = [{ x: pl.x, y: pl.y, target: 'planet', targetId: planetId, warp: 0, task: 'none' }];
  return f;
}

if (want('anomalies')) {
  console.log('--- anomalies and archaeology');
  const g = quiet(game('anom-1'));
  const list = g.anomalies!;
  const sites = list.filter(a => defOf(a).site && a.kind !== 'vault');
  const frags = list.filter(a => a.kind === 'fragment');
  check(list.length >= 12 && sites.length >= 2 && frags.length >= 3 && (!!vaultOf(g) || !!g.secrets?.some(s => s.kind === 'ancients')), `${list.length} discoveries: ${sites.length} sites, ${frags.length} fragments, a vault`);
  check(list.every(a => a.level >= 1 && a.level <= 5 && !!ANOMALIES[a.kind]), 'levels 1..5, known kinds');
  check(new Set(list.map(a => a.planetId)).size === list.length, 'one discovery per planet');
  check(list.every(a => g.planets[a.planetId].owner < 0 || a.kind === 'catacombs'), 'none on an occupied world (but the relic world\'s own site)');
  const g2 = quiet(game('anom-1'));
  check(JSON.stringify(g2.anomalies!.map(a => [a.planetId, a.kind, a.level])) === JSON.stringify(list.map(a => [a.planetId, a.kind, a.level])), 'same seed, same discoveries');
  const off = custom('anom-x', [undefined, undefined], 'Small', st => { st.anomalies = false; st.guardians = false; st.origins = false; });
  const on = custom('anom-x', [undefined, undefined], 'Small', st => { st.guardians = false; st.origins = false; });
  check(JSON.stringify(off.planets.map(p => [p.x, p.y, p.hab, p.conc])) === JSON.stringify(on.planets.map(p => [p.x, p.y, p.hab, p.conc])), 'the universe is the same with or without discoveries');
  // discovery by orbit, study by a scout
  const me = g.players[0];
  const sd = scoutDesign(g, 0);
  const a = list.find(x => !defOf(x).site && !defOf(x).choice && x.kind !== 'fragment' && x.kind !== 'vault' && !guardianAt(g, x.planetId))!;
  const scout = orbitAt(g, 0, sd, 1, a.planetId);
  updateIntel(g); discoverAnomalies(g);
  check(a.known.includes(0) && me.messages.some(m => m.text.includes(defOf(a).name)), `in orbit: ${defOf(a).name} discovered, with a message`);
  check(!a.known.includes(1), 'the others do not know it');
  const rate = studyRate(g, me, 1, false, fleetSpec(g, scout).scanRangePen > 0);
  const rng = new Rng([1, 2, 3, 4]);
  runStudies(g, rng);
  check(a.progress[0] === rate, `one year of study: ${a.progress[0]} points (rate ${rate})`);
  let years = 1;
  while (a.doneBy === undefined && years < 30) { runStudies(g, rng); years++; }
  check(a.doneBy === 0 && years === Math.ceil(pointsNeeded(a) / rate), `finished in ${years} years (${pointsNeeded(a)} points)`);
  check(me.messages.some(m => m.text.startsWith(defOf(a).name)), 'result reported');
  // a moving ship does not study; a guardian blocks
  const b = list.find(x => x !== a && !defOf(x).site && x.kind !== 'vault' && x.kind !== 'fragment' && !guardianAt(g, x.planetId))!;
  const mover = orbitAt(g, 0, sd, 1, b.planetId);
  mover.waypoints.push({ x: mover.x + 100, y: mover.y, target: 'space', warp: 5, task: 'none' });
  updateIntel(g); discoverAnomalies(g); runStudies(g, rng);
  check(!(b.progress[0] > 0), 'a ship about to leave does not study');
  spawnGuardian(g, g.planets[b.planetId], 'sentinel');
  check(studyBlocker(g, me, b)?.includes('Sentinelle') === true, `guardian in orbit: "${studyBlocker(g, me, b)}"`);
  // a choice
  const c = list.find(x => defOf(x).choice && !guardianAt(g, x.planetId) && x.doneBy === undefined)!;
  if (c) {
    c.known.push(0); c.progress[0] = pointsNeeded(c) - 0.5;
    const sc = orbitAt(g, 0, sd, 1, c.planetId);
    runStudies(g, rng);
    const dec = me.decisions?.find(d => d.anomalyId === c.id);
    check(c.doneBy === 0 && !!dec, `${defOf(c).name}: a decision waits`);
    const txt = dec ? decide(g, me, dec.id, 'b') : null;
    check(!!txt && !me.decisions?.some(d => d.id === dec!.id), `decided: ${txt}`);
    void sc;
  }
  // 3.3.6: a decision that changes the world is seen at once in what the player knows of it
  {
    const cl = list.find(x => x.kind !== 'climate' && false) ?? (g.anomalies ?? []).find(x => x.doneBy === undefined && !guardianAt(g, x.planetId) && g.planets[x.planetId].owner < 0);
    if (cl) {
      cl.kind = 'climate' as any; cl.known.push(0); cl.progress = { 0: pointsNeeded(cl) - 0.5 };
      const pl = g.planets[cl.planetId];
      orbitAt(g, 0, sd, 1, cl.planetId);
      runStudies(g, rng);
      const dec = me.decisions?.find(d => d.anomalyId === cl.id);
      revealPlanet(g, me, pl, false);
      const before = JSON.stringify(me.intel.planets[pl.id].hab);
      const txt = dec ? decide(g, me, dec.id, 'a') : null;
      check(!!txt && before !== JSON.stringify(pl.hab) && JSON.stringify(me.intel.planets[pl.id].hab) === JSON.stringify(pl.hab) && JSON.stringify(me.intel.planets[pl.id].baseHab) === JSON.stringify(pl.baseHab), `climate engine: intel updated at once (${before} → ${JSON.stringify(pl.hab)})`);
    }
  }
  // competition: the first to finish wins, the other is told
  const d2 = list.find(x => !defOf(x).site && !defOf(x).choice && x.doneBy === undefined && x.kind !== 'fragment' && x.kind !== 'vault' && !guardianAt(g, x.planetId))!;
  d2.known.push(0, 1); d2.progress = { 0: 1, 1: pointsNeeded(d2) - 1 };
  orbitAt(g, 0, sd, 1, d2.planetId); orbitAt(g, 1, scoutDesign(g, 1), 1, d2.planetId);
  runStudies(g, rng);
  check(d2.doneBy === 1 && me.messages.some(m => m.text.includes('avant vous')), 'the rival finished first: you are told');
  // an archaeological site: three chapters, then a relic
  const site = sites.find(x => !guardianAt(g, x.planetId))!;
  site.known.push(0);
  orbitAt(g, 0, sd, 2, site.planetId);
  let y2 = 0;
  while (site.doneBy === undefined && y2 < 80) { runStudies(g, rng); y2++; }
  const relic = defOf(site).site!.relic;
  check(site.doneBy === 0 && site.chapter === 3 && hasRelic(me, relic), `${defOf(site).name}: 3 chapters in ${y2} years, relic ${relic}`);
  // relic effects
  const r0 = researchFactor(me);
  me.relics = [...(me.relics ?? []), 'codex'];
  check(Math.abs(researchFactor(me) - r0 - 0.1) < 1e-9, 'Codex: +10 % research');
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  home.pop = 200000;
  const g0 = growthAmount(g, me, home); me.relics.push('seed');
  check(growthAmount(g, me, home) > g0, `Semences: growth ${g0} → ${growthAmount(g, me, home)}`);
  const m0 = planetSpec(g, home, me).mining.ironium; me.relics.push('forge');
  check(planetSpec(g, home, me).mining.ironium === Math.floor(m0 * 1.1), 'Forge: +10 % mining');
  // fragments reveal the vault
  me.fragments = fragmentsNeeded(g) - 1;
  const fr = frags.find(x => x.doneBy === undefined && !guardianAt(g, x.planetId))!;
  fr.known.push(0); fr.progress[0] = pointsNeeded(fr);
  orbitAt(g, 0, sd, 1, fr.planetId);
  runStudies(g, rng);
  // 0.3.7: the sanctuary stands on a hidden star, that the complete map reveals
  const v = vaultOf(g)!;
  check(!!v && v.known.includes(0) && me.intel.planets[v.planetId].explored === true, `last fragment (${fragmentsNeeded(g)} needed): the vault on ${g.planets[v.planetId].name} is revealed`);
  check(!!guardianAt(g, v.planetId) && guardianAt(g, v.planetId)!.kind === 'warden', 'the vault is guarded');
  // computers send idle scouts
  const ai = g.players[2];
  const open = list.find(x => x.doneBy === undefined && !guardianAt(g, x.planetId) && x.kind !== 'vault')!;
  open.known.push(2);
  const aiScout = orbitAt(g, 2, scoutDesign(g, 2), 1, g.planets.find(p => p.owner === 2 && p.homeworld)!.id);
  aiScout.purpose = 'scout'; aiScout.fuel = 5000;
  ai.ai = 'standard';
  aiStudies(g, ai);
  check(aiScout.waypoints.length === 2 && aiScout.waypoints[1].targetId === open.planetId || distance(aiScout, g.planets[open.planetId]) > g.width * 0.35, 'a computer sends an idle scout to study');
}

if (want('guardians')) {
  console.log('--- guardians');
  const g = quiet(game('guard-1'));
  const m = g.players[g.monsterId!];
  const gs = g.guardians!;
  check(!!m && m.monster === true && m.dead === true && m.name === 'Gardiens', 'pseudo-player of the guardians (marked dead)');
  check(gs.length === 3 && gs.filter(x => x.tier === 1).length === 2 && !gs.some(x => x.kind === 'warden') && !!g.secrets?.some(x => x.kind === 'ancients'), `Small galaxy: ${gs.map(x => x.kind).join(', ')} (the Colossus wakes with the hidden star of the Ancients)`);
  const homes = g.planets.filter(p => p.homeworld && p.owner >= 0 && !p.monster);
  check(gs.every(x => Math.min(...homes.map(h => distance(h, g.planets[x.planetId]))) >= g.width * 0.2), 'far from every homeworld');
  check(g.players.every(p => p.id === m.id || (p.relations[m.id] === 'enemy' && m.relations[p.id] === 'enemy')), 'everyone is its enemy');
  check(gs.every(x => g.fleets.some(f => f.id === x.fleetId && f.orbiting === x.planetId && isMonster(g, f.owner))), 'a fleet in orbit for each');
  // seen from afar by an ordinary scanner, never "met"
  const me = g.players[0];
  const gd = gs.find(x => x.tier === 1)!;
  const pl = g.planets[gd.planetId];
  const sd = scoutDesign(g, 0);
  const watcher = fleetAt(g, 0, sd, 1, { x: pl.x + 30, y: pl.y });
  updateIntel(g);
  const fi = me.intel.fleets.find(x => x.owner === m.id);
  check(!!fi && fi.detail === 'full' && me.intel.planets[pl.id].guardian === gd.kind, `seen at 30 al in orbit: ${fi?.name}`);
  check(!me.intel.met.includes(m.id), 'never in the diplomacy list');
  // a scout that stops there is attacked
  watcher.x = pl.x; watcher.y = pl.y; watcher.orbiting = pl.id;
  const hp0 = watcher.tokens[0].qty;
  const rec = resolveBattles(g, new Rng([5, 6, 7, 8]));
  check(rec.length === 1 && rec[0].players.includes(m.id), `a scout stopping at the guarded world is attacked (${g.fleets.includes(watcher) ? 'it escaped' : 'destroyed'})`);
  void hp0;
  // regeneration
  const gf = g.fleets.find(f => f.id === gd.fleetId)!;
  gf.tokens[0].damage = 100; gf.tokens[0].qtyDamaged = 1;
  regenGuardians(g);
  check(gf.tokens[0].damage === 60, 'mends 40 % of its damage each year');
  // a strong fleet wins and is rewarded
  const big = design(g, 0, 'Battleship', [{ slot: 1, part: 'Trans-Galactic Drive', qty: 4 }, { slot: 2, part: 'Neutronium', qty: 8 }, { slot: 3, part: 'Gorilla Delagator', qty: 8 }, { slot: 4, part: 'Heavy Blaster', qty: 6 }, { slot: 5, part: 'Heavy Blaster', qty: 6 }, { slot: 6, part: 'Heavy Blaster', qty: 6 }], 'Cuirassé');
  const army = orbitAt(g, 0, big, 6, pl.id);
  for (const p of g.players) p.battlePlans[0].attackWho = 'enemies';
  const before = { ...me.tech };
  const fs = fleetSpec(g, army);
  check((fs.armor + fs.shields) * fs.powerRating > guardianStrength(g, gd) * 3, 'test fleet much stronger than the guardian');
  g.battles = resolveBattles(g, new Rng([9, 9, 9, 9]));
  checkGuardians(g, new Rng([1, 1, 1, 1]));
  check(!gd.alive && gd.killedBy === 0, 'guardian destroyed by the empire holding the field');
  check(me.messages.some(m2 => m2.text.includes('est détruit')) && JSON.stringify(me.tech) !== JSON.stringify(before) || Object.values(me.researchSpent).some(v => v > 0), 'reward: research and a message');
  check(!me.intel.planets[pl.id].guardian, 'the world is no longer marked guarded');
  // computers keep their ships away from guarded worlds
  const ai = g.players[1];
  const other = gs.find(x => x.alive && x !== gd)!;
  const opl = g.planets[other.planetId];
  ai.intel.planets[opl.id].guardian = other.kind;
  const aiScout = fleetAt(g, 1, scoutDesign(g, 1), 1, { x: opl.x - 100, y: opl.y }); aiScout.purpose = 'scout';
  aiScout.waypoints.push({ x: opl.x, y: opl.y, target: 'planet', targetId: opl.id, warp: 6, task: 'none' });
  ai.ai = 'standard'; g.year = 2410;
  const rng = new Rng([3, 3, 3, 3]);
  // runAI3 is called inside runAI; only check the avoidance part
  runAI3(g, ai);
  check(aiScout.waypoints.length === 1, 'a computer scout heading for a guarded world turns back');
  void rng;
  // excluded from victory checks and objectives
  const g3 = quiet(game('guard-2', 'Tiny'));
  check(g3.guardians!.length >= 1, 'a guardian even in a tiny galaxy');
  for (const p of g3.players) if (!p.monster && p.id !== 0) p.dead = true;
  check(checkVictory(g3) === 0, 'last standing: the guardians do not count as an empire');
  const g4 = quiet(game('guard-3'));
  for (const p of g4.players) p.objectives = undefined;
  assignObjectives(g4);
  check(g4.players.every(p => p.monster ? !p.objectives : p.objectives!.every(o => o.param2 === undefined || !g4.players[o.param2].monster)), 'objectives: none for the guardians, never a vendetta against them');
  // switching the rule off removes them
  setRule(g4, 'guardians', false);
  check(!g4.fleets.some(f => isMonster(g4, f.owner)), 'rule off: guardians gone');
  setRule(g4, 'guardians', true);
  check(g4.guardians!.filter(x => x.alive).length >= 3, 'rule back on: guardians back');
  // a whole game: no crash, kills happen, nobody meets them
  const g5 = game('guard-sim', 'Small');
  g5.players[0].ai = 'standard';
  for (let y = 0; y < 130; y++) generateTurn(g5);
  check(g5.players.every(p => !p.intel.met.includes(g5.monsterId!)), '130 years: nobody "met" the guardians');
  check(!g5.players[g5.monsterId!].scores.length, 'no score for the guardians');
  console.log('     guardians killed by year 130:', g5.guardians!.filter(x => !x.alive).map(x => `${x.kind}@${x.killedYear}`).join(', ') || 'none');
}

if (want('origins')) {
  console.log('--- origins');
  const g = custom('orig-1', ['doomed', 'relicWorld', 'lostColony', 'explorers', 'proteges']);
  const [d, r, l, e, pr] = g.players;
  check(g.players.slice(0, 5).map(p => p.origin).join() === 'doomed,relicWorld,lostColony,explorers,proteges', 'origins applied as chosen');
  const ref = custom('orig-1', ['standard', 'standard', 'standard', 'standard', 'standard']);
  const arks = (gg: GameState, id: number) => gg.fleets.filter(f => f.owner === id && fleetSpec(gg, f).colonizer).length;
  check(arks(g, 0) === arks(ref, 0) + 2 && !!d.doomDir, `Monde condamné: ${arks(g, 0)} arks (standard ${arks(ref, 0)})`);
  const dh = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const hab0 = habitability(d.race, dh.hab);
  g.year = DOOM_START - 1; originYear(g);
  check(habitability(d.race, dh.hab) === hab0, 'nothing before 2430');
  let yrs = 0;
  for (g.year = DOOM_START; habitability(d.race, dh.hab) > DOOM_FLOOR && yrs < 120; g.year++, yrs++) originYear(g);
  check(habitability(d.race, dh.hab) <= DOOM_FLOOR && yrs >= 15 && yrs <= 80, `the homeworld becomes hostile in ${yrs} years (${hab0} % → ${habitability(d.race, dh.hab)} %)`);
  const hab1 = dh.hab.join(); originYear(g); g.year++; originYear(g);
  check(dh.hab.join() === hab1, 'then the drift stops');
  check(hasRelic(r, 'codex') && g.anomalies!.some(a => a.kind === 'catacombs' && a.known.includes(1)), 'Monde-relique: Codex and a site under the capital');
  const rh = g.planets.find(p => p.owner === 1 && p.homeworld)!, rr = ref.planets.find(p => p.owner === 1 && p.homeworld)!;
  check(rh.conc.ironium <= Math.max(15, Math.round(rr.conc.ironium * 0.5)), `poorer homeworld: conc ${rh.conc.ironium} (standard ${rr.conc.ironium})`);
  const lc = g.planets.filter(p => p.owner === 2 && !p.homeworld);
  const lh = g.planets.find(p => p.owner === 2 && p.homeworld)!;
  check(lc.length >= 1 && lc.some(p => p.pop === 6000 && distance(p, lh) >= 150 && distance(p, lh) <= 300), `Colonie perdue: ${lc.map(p => `${p.name} ${p.pop} hab. à ${Math.round(distance(p, lh))} al`).join(', ')}`);
  check(lh.pop < ref.planets.find(p => p.owner === 2 && p.homeworld)!.pop, 'fewer colonists at home');
  const scouts = (gg: GameState, id: number) => gg.fleets.filter(f => f.owner === id && gg.designs.find(x => x.id === f.tokens[0].designId)?.purpose === 'scout').length;
  const eh = g.planets.find(p => p.owner === 3 && p.homeworld)!;
  check(scouts(g, 3) === scouts(ref, 3) + 1 && e.fragments === 1, 'Explorateurs: one more scout, one fragment');
  check(g.planets.filter(p => distance(p, eh) <= 120 && p.owner !== 3).every(p => e.intel.planets[p.id].explored), 'Explorateurs: the neighbourhood is analysed');
  check(studyRate(g, e, 1, false, false) === 2 * studyRate(g, ref.players[3], 1, false, false), 'Explorateurs: study twice as fast');
  const esc = g.fleets.filter(f => f.owner === 4 && g.designs.find(x => x.id === f.tokens[0].designId)?.alien);
  check(esc.length === 1 && esc[0].tokens[0].qty === 2 && fleetSpec(g, esc[0]).hasWeapons, 'Protégés: an escort of two alien warships');
  check(Math.abs(researchFactor(pr) - 0.9) < 1e-9, 'Protégés: −10 % research');
  const cap = g.planets[pr.capital!];
  const s0 = cap.surface.ironium; g.year = 2420; originYear(g);
  check(cap.surface.ironium === s0 + 300, 'Protégés: the gift of 2420');
  const ai = custom('orig-2', [undefined, undefined, undefined]);
  const ai2 = custom('orig-2', [undefined, undefined, undefined]);
  check(ai.players.every(p => p.monster || !!p.origin) && ai.players.map(p => p.origin).join() === ai2.players.map(p => p.origin).join(), `origins drawn (same seed, same draw): ${ai.players.filter(p => !p.monster).map(p => p.origin).join(', ')}`);
  const offg = custom('orig-3', ['doomed'], 'Small', st => { st.origins = false; });
  check(!offg.players[0].origin && !offg.players[0].doomDir, 'rule off: no origin');
  check(ORIGINS.every(o => o.id === 'standard' || (o.pros.length > 0 && o.cons.length > 0)), 'every origin has an advantage and a price');
}

if (want('stories')) {
  console.log('--- research stories');
  const g = quiet(game('story-1'));
  const me = g.players[0];
  const sd = scoutDesign(g, 0);
  const texts: string[] = [];
  const rng = new Rng([4, 4, 4, 4]);
  for (const a of g.anomalies!.filter(x => ['probe', 'lab', 'storm', 'well', 'tomb', 'sarcophagus', 'crystals', 'climate'].includes(x.kind) || ANOMALIES[x.kind].site)) {
    a.known.push(0); a.progress[0] = pointsNeeded(a) - 0.1;
    orbitAt(g, 0, sd, 1, a.planetId);
  }
  for (let y = 0; y < 3; y++) runStudies(g, rng);
  for (const d of me.decisions ?? []) decide(g, me, d.id, 'b');
  for (const m of me.messages) if (m.text.includes('points de recherche')) texts.push(m.text);
  check(texts.length >= 3, `${texts.length} research rewards told`);
  check(texts.every(t => !t.includes('{') && !t.includes('—') && /\(\+[\d\u202f\u00a0 ]+ points de recherche en /.test(t)), 'each one says what was studied and how many points');
  for (const t of texts.slice(0, 6)) console.log('     ' + t);
  const told = me.told ?? [];
  check(new Set(told).size === told.length, `no story told twice (${told.length})`);
}

if (want('refuel')) {
  console.log('--- refuelling in flight');
  const g = quiet(game('ref-1'));
  g.settings.terrain = false; g.terrain = [];
  const me = g.players[0];
  me.tech.propulsion = 10;
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const dd = design(g, 0, 'Destroyer', warship('Long Hump 6'), 'Assoiffé');
  // toward the middle of the galaxy
  const dir = home.x > g.width / 2 ? -1 : 1;
  const dry = fleetAt(g, 0, dd, 1, { x: home.x + dir * 150, y: home.y });
  const cap = fleetSpec(g, dry).fuelCapacity;
  dry.fuel = Math.round(cap * 0.15);
  dry.waypoints.push({ x: home.x + dir * 400, y: home.y, target: 'space', warp: 2, task: 'none' });
  check(needsFuel(g, dry), `${dry.name}: ${dry.fuel}/${cap} mg, crawling at Warp 2: needs fuel`);
  const td = design(g, 0, 'Destroyer', [{ slot: 1, part: 'Trans-Galactic Drive', qty: 1 }, { slot: 4, part: 'Fuel Tank', qty: 2 }, { slot: 5, part: 'Fuel Tank', qty: 2 }], 'Citerne');
  const tanker = newFleet(g, me, td.id, 1, home);
  tanker.fuel = fleetSpec(g, tanker).fuelCapacity;
  const opts = refuelOptions(g, dry);
  check(opts.length >= 1 && opts[0].tanker === tanker, `options: ${opts.map(o => `${o.tanker.name} +${o.give} mg en ${o.meetYear}`).join(', ')}`);
  check(startRefuel(g, tanker, dry) && tanker.refuelFor === dry.id && tanker.pursue === dry.id, 'tanker sent');
  const before = dry.fuel;
  let y = 0;
  while (tanker.refuelFor !== undefined && y < 12) { generateTurn(g); y++; }
  check(tanker.refuelFor === undefined && dry.fuel > before + cap * 0.3, `met after ${y} year(s): ${before} → ${dry.fuel} mg`);
  check(dry.waypoints.length < 2 || dry.waypoints[1].warp > 2, `the dry fleet speeds up again (Warp ${dry.waypoints[1]?.warp ?? '-'})`);
  check(tanker.waypoints.length === 2 && tanker.waypoints[1].target === 'planet', 'the tanker heads back to a dock');
  check(me.messages.some(m => m.text.includes('transféré')), 'reported');
  // together: immediate transfer
  const d2 = fleetAt(g, 0, dd, 1, { x: home.x + dir * 60, y: home.y }); d2.fuel = 5;
  const t2 = fleetAt(g, 0, td, 1, { x: home.x + dir * 60, y: home.y }); t2.fuel = fleetSpec(g, t2).fuelCapacity;
  check(startRefuel(g, t2, d2) && d2.fuel > 5, `same place: immediate transfer (${d2.fuel} mg)`);
  check(!needsFuel(g, tanker) || tanker.orbiting < 0, 'a full fleet does not need fuel');
}

if (want('slow')) {
  console.log('--- slow trips flagged');
  check(slowTrip(53, 1, 6, 300), '53 years at Warp 1 for a Warp 6 ship: slow');
  check(!slowTrip(5, 6, 6, 170), '5 years at Warp 6: fine');
  check(slowTrip(30, 5, 6, 200), '30 years where 6 would do: slow');
  check(!slowTrip(3, 1, 1, 3), 'a Warp 1 ship crawling a short way: not flagged');
}

if (want('minefields')) {
  console.log('--- minefield decay (Stars! rules)');
  const g = quiet(game('mf-1'));
  const near = (p: { x: number; y: number }, r: number) => g.planets.filter(q => distance(q, p) <= r).length;
  // an empty spot: no planet within 32 ly
  let empty = { x: 0, y: 0 };
  for (let x = 40; x < g.width && !empty.x; x += 7) for (let y = 40; y < g.height; y += 7) if (near({ x, y }, 32)) continue; else { empty = { x, y }; break; }
  const f1 = { ...empty, mines: 1000, type: 'standard', owner: 0 };
  const d1 = minefieldDecay(g, f1);
  check(d1.planets === 0 && Math.abs(d1.rate - 0.02) < 1e-9 && d1.lost === 20, `1 000 mines in empty space: 2 % → −${d1.lost}`);
  const pl = g.planets.find(p => near(p, 100) >= 4)!;
  const small = { x: pl.x, y: pl.y, mines: 100, type: 'standard', owner: 0 };
  const big = { x: pl.x, y: pl.y, mines: 10000, type: 'standard', owner: 0 };
  const ds = minefieldDecay(g, small), db = minefieldDecay(g, big);
  check(Math.abs(ds.rate - Math.min(0.5, 0.02 + 0.04 * near(pl, 10))) < 1e-9, `small field over ${pl.name}: ${ds.planets} planet(s) → ${(ds.rate * 100).toFixed(0)} %`);
  check(db.planets > ds.planets && db.rate > ds.rate, `the same field grown to 10 000 mines covers ${db.planets} planets → ${(db.rate * 100).toFixed(0)} % a year (−${db.lost})`);
  check(db.rate <= 0.5, 'decay capped at 50 %');
  check(minefieldDecay(g, { ...empty, mines: 100, type: 'standard', owner: 0 }).lost === 10, 'at least 10 mines a year');
  check(minefieldDecay(g, { ...empty, mines: 50, type: 'speedBump', owner: 0 }).lost === 2, 'speed bumps: at least 2 mines a year');
  check(Math.abs(minefieldDecay(g, { ...f1, detonate: true }).rate - 0.27) < 1e-9, 'detonating: +25 %');
  const sd = g.players[0];
  sd.race = { ...sd.race, prt: 'SD' };
  check(raceSpec(sd.race).minefieldDecayFactor === 0.25, 'SD race');
  const dsd = minefieldDecay(g, { x: pl.x, y: pl.y, mines: 2500, type: 'standard', owner: 0 });
  check(Math.abs(dsd.rate - Math.min(0.5, 0.02 + 0.01 * dsd.planets)) < 1e-9 && dsd.planets > 0, `SD: 2 % + 1 % per planet (${dsd.planets}) → ${(dsd.rate * 100).toFixed(0)} %`);
  sd.race = { ...sd.race, prt: 'JoaT' };
  const lt = minefieldLifetime(g, f1);
  check(lt > 50 && lt < 200, `1 000 mines in empty space last ≈ ${lt} years`);
  // impacts: the bigger the field, the more mines a strike costs (in absolute terms)
  const hit = (n: number) => { const m = { id: 1, owner: 0, x: 0, y: 0, mines: n, type: 'standard' as const, detonate: false }; reduceOnImpact(m); return n - m.mines; };
  check(hit(150) === 10 && hit(600) === 30 && hit(3000) === 50 && hit(10000) === 100, `a strike costs 10 / 30 / 50 / 100 mines (150 / 600 / 3 000 / 10 000-mine fields)`);
  // in the turn: decay applied, detonation pays through decay only
  g.minefields = [{ id: g.nextId++, owner: 0, x: empty.x, y: empty.y, mines: 1000, type: 'standard', detonate: true }];
  detonateMinefields(g);
  check(g.minefields[0].mines === 1000, 'detonation itself takes no mines');
  decayMinefields(g);
  check(g.minefields[0].mines === 730, `then decay 27 % (${g.minefields[0].mines})`);
}

if (want('merge')) {
  console.log('--- merging keeps the orders under way');
  const g = quiet(game('mg-1'));
  const me = g.players[0];
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const dd = design(g, 0, 'Destroyer', warship('Long Hump 6'), 'Escorte');
  const dir = home.x > g.width / 2 ? -1 : 1;
  const a = orbitAt(g, 0, dd, 1, home.id), b = orbitAt(g, 0, dd, 2, home.id);
  b.waypoints.push({ x: home.x + dir * 100, y: home.y, target: 'space', warp: 6, task: 'none' });
  check(!hasOrders(a) && hasOrders(b), 'a idle, b on its way');
  check(mergeFleets(g, a, b, true) && a.waypoints.length === 2 && a.waypoints[1].x === home.x + dir * 100 && !g.fleets.includes(b), 'idle a absorbs b and takes over its route');
  check(a.tokens.reduce((s, t) => s + t.qty, 0) === 3, '3 ships');
  // both busy: the absorbing fleet keeps its own
  const c = orbitAt(g, 0, dd, 1, home.id);
  c.waypoints.push({ x: home.x, y: home.y + 80, target: 'space', warp: 6, task: 'none' });
  check(!mergeFleets(g, a, c, true) && a.waypoints[1].x === home.x + dir * 100, 'both busy: a keeps its route');
  // standing task at the current position (remote mining) is an order too
  const e = orbitAt(g, 0, dd, 1, home.id), m = orbitAt(g, 0, dd, 1, home.id);
  m.waypoints[0].task = 'remoteMine';
  check(mergeFleets(g, e, m, true) && e.waypoints[0].task === 'remoteMine', 'idle fleet takes over a standing task (mining)');
  // a processed transport is no longer an order
  const h = orbitAt(g, 0, dd, 1, home.id), k = orbitAt(g, 0, dd, 1, home.id);
  k.waypoints[0].task = 'transport'; k.waypoints[0].processed = true;
  check(!hasOrders(k) && !mergeFleets(g, h, k, true), 'a finished transport is not taken over');
  // others following the absorbed fleet now follow the merged one
  const p1 = orbitAt(g, 0, dd, 1, home.id), p2 = orbitAt(g, 0, dd, 1, home.id);
  const follower = fleetAt(g, 0, dd, 1, { x: home.x + dir * 50, y: home.y });
  follower.waypoints.push({ x: p2.x, y: p2.y, target: 'fleet', targetId: p2.id, warp: 5, task: 'merge', mergeWith: p2.id });
  mergeFleets(g, p1, p2, true);
  check(follower.waypoints[1].targetId === p1.id && follower.waypoints[1].mergeWith === p1.id, 'a fleet heading to merge with the absorbed one now heads for the merged fleet');
  // without the flag (AI), nothing is taken over
  const q1 = orbitAt(g, 0, dd, 1, home.id), q2 = orbitAt(g, 0, dd, 1, home.id);
  q2.waypoints.push({ x: home.x + dir * 30, y: home.y, target: 'space', warp: 6, task: 'none' });
  check(!mergeFleets(g, q1, q2) && q1.waypoints.length === 1, 'AI merges unchanged');
  // merge waypoint task: the remaining route of the arriving fleet goes to an idle target
  const t1 = orbitAt(g, 0, dd, 1, home.id);
  const t2 = orbitAt(g, 0, dd, 1, home.id);
  t2.waypoints = [{ ...t2.waypoints[0], task: 'merge', mergeWith: t1.id, processed: false }, { x: home.x, y: home.y - 90, target: 'space', warp: 6, task: 'none' }];
  generateTurn(g);
  check(!g.fleets.includes(t2) && t1.waypoints.some(w => Math.abs(w.y - (home.y - 90)) < 1 || (t1.y !== home.y)), 'merge task: the target takes over what came after the merge');
  void me;
}

if (want('tanker')) {
  console.log('--- standing refuelling order');
  const g = quiet(game('tk-1'));
  g.settings.terrain = false; g.terrain = [];
  const me = g.players[0];
  me.tech.propulsion = 10;
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  clearFleets(g, g.fleets.filter(f => f.owner !== 0));
  const dd = design(g, 0, 'Destroyer', warship('Long Hump 6'), 'Assoiffé');
  const td = design(g, 0, 'Destroyer', [{ slot: 1, part: 'Trans-Galactic Drive', qty: 1 }, { slot: 4, part: 'Fuel Tank', qty: 2 }, { slot: 5, part: 'Fuel Tank', qty: 2 }], 'Citerne');
  const dir = home.x > g.width / 2 ? -1 : 1;
  const tanker = orbitAt(g, 0, td, 1, home.id);
  tanker.fuel = fleetSpec(g, tanker).fuelCapacity;
  tanker.waypoints[0].task = 'refuel';
  tanker.waypoints[0].patrolRange = defaultTankerRange(g, tanker);
  check(tanker.waypoints[0].patrolRange! >= 50 && tanker.waypoints[0].patrolRange! <= 300, `default radius ${tanker.waypoints[0].patrolRange} al`);
  const dry = fleetAt(g, 0, dd, 1, { x: home.x + dir * 120, y: home.y });
  const cap = fleetSpec(g, dry).fuelCapacity;
  dry.fuel = Math.round(cap * 0.1);
  dry.waypoints.push({ x: home.x + dir * 350, y: home.y, target: 'space', warp: 2, task: 'none' });
  const far = fleetAt(g, 0, dd, 1, { x: home.x + dir * 600, y: home.y }); far.fuel = 3;
  check(tankerTargets(g, tanker).map(x => x.dry.id).join() === String(dry.id), 'only the fleet within the radius is a target');
  runTankers(g);
  check(tanker.refuelFor === dry.id && tanker.tankerPost?.task === 'refuel', `sets out for ${dry.name}, post remembered`);
  const before = dry.fuel;
  let y = 0;
  while (tanker.refuelFor !== undefined && y < 15) { generateTurn(g); y++; }
  check(dry.fuel > before + cap * 0.3, `served after ${y} year(s): ${before} → ${dry.fuel} mg`);
  const last = tanker.waypoints[tanker.waypoints.length - 1];
  check(last.task === 'refuel' && last.targetId === home.id, 'heads back to its post, still on duty');
  y = 0;
  while ((tanker.waypoints.length > 1 || tanker.orbiting !== home.id) && y < 15) { generateTurn(g); y++; }
  check(tanker.orbiting === home.id && tanker.waypoints.length === 1 && tanker.waypoints[0].task === 'refuel', `back at its post after ${y} year(s)`);
  check(!g.fleets.some(f => f.refuelFor === far.id), 'never went for the fleet out of range');
  // no suicide: a tanker whose spare fuel would not get it back stays put
  const g2 = quiet(game('tk-2'));
  g2.settings.terrain = false; g2.terrain = [];
  const h2 = g2.planets.find(p => p.owner === 0 && p.homeworld)!;
  clearFleets(g2, g2.fleets.filter(f => f.owner !== 0));
  const d2 = design(g2, 0, 'Destroyer', warship('Long Hump 6'), 'Assoiffé');
  const t2d = design(g2, 0, 'Destroyer', [{ slot: 1, part: 'Long Hump 6', qty: 1 }, { slot: 4, part: 'Fuel Tank', qty: 1 }], 'Petite citerne');
  const dir2 = h2.x > g2.width / 2 ? -1 : 1;
  const post = { x: h2.x + dir2 * 200, y: h2.y };
  const t2 = fleetAt(g2, 0, t2d, 1, post);
  t2.fuel = Math.round(fleetSpec(g2, t2).fuelCapacity * 0.3);
  t2.waypoints[0].task = 'refuel'; t2.waypoints[0].patrolRange = 400;
  const dry2 = fleetAt(g2, 0, d2, 1, { x: post.x + dir2 * 150, y: post.y }); dry2.fuel = 2;
  runTankers(g2);
  check(t2.refuelFor === undefined, 'a tanker with too little to spare does not set out');
  check(t2.waypoints.length > 1 && t2.waypoints[1].target === 'planet', 'it goes to fill up at a dock first');
  // the tanker's own move: a fleet already heading to a dock is left alone
  const g3 = quiet(game('tk-3'));
  const h3 = g3.planets.find(p => p.owner === 0 && p.homeworld)!;
  clearFleets(g3, g3.fleets.filter(f => f.owner !== 0));
  const t3 = orbitAt(g3, 0, design(g3, 0, 'Destroyer', [{ slot: 1, part: 'Trans-Galactic Drive', qty: 1 }, { slot: 4, part: 'Fuel Tank', qty: 2 }], 'Citerne'), 1, h3.id);
  t3.waypoints[0].task = 'refuel'; t3.waypoints[0].patrolRange = 300;
  const dir3 = h3.x > g3.width / 2 ? -1 : 1;
  const homebound = fleetAt(g3, 0, design(g3, 0, 'Destroyer', warship('Long Hump 6'), 'Rentre'), 1, { x: h3.x + dir3 * 60, y: h3.y });
  homebound.fuel = Math.round(fleetSpec(g3, homebound).fuelCapacity * 0.2);
  homebound.waypoints.push({ x: h3.x, y: h3.y, target: 'planet', targetId: h3.id, warp: 6, task: 'none' });
  check(needsFuel(g3, homebound) && !tankerTargets(g3, t3).length, 'a fleet already on its way to a dock is left alone');
  // merging a duty tanker into an idle fleet keeps the duty
  const idle = orbitAt(g3, 0, design(g3, 0, 'Destroyer', warship('Long Hump 6'), 'Garde'), 1, h3.id);
  check(mergeFleets(g3, idle, t3, true) && idle.waypoints[0].task === 'refuel', 'the duty survives a merge');
  void me;
}

if (want('nav')) {
  console.log('--- reports lead to their object');
  const g = quiet(game('nav-1'));
  const me = g.players[0], o = g.players[1];
  me.intel.met = me.intel.met.filter(x => x !== 1);
  const pl = g.planets.find(p => p.owner === 1)!;
  meet(g, me, 1, { target: { kind: 'planet', id: pl.id }, how: `qui occupent ${pl.name}` });
  const fc = me.messages[me.messages.length - 1];
  check(fc.text.startsWith('Premier contact') && fc.target?.kind === 'planet' && fc.target.id === pl.id && fc.text.includes(pl.name), `first contact leads to ${pl.name}: « ${fc.text} »`);
  // through the scanners: a fleet seen in space
  me.intel.met = me.intel.met.filter(x => x !== 2);
  const theirs = g.fleets.find(f => f.owner === 2)!;
  const mine = g.fleets.find(f => f.owner === 0)!;
  theirs.x = mine.x + 3; theirs.y = mine.y + 3; theirs.orbiting = -1;
  me.messages = [];
  updateIntel(g);
  const fc2 = me.messages.find(m => m.text.startsWith('Premier contact') && m.text.includes(g.players[2].name));
  check(!!fc2 && fc2.target?.kind === 'fleet' && fc2.target.id === theirs.id && fc2.target.x !== undefined, `first contact by a fleet: « ${fc2?.text} » → fleet, with its position`);
  // technology learnt from others: field names in French
  me.tech.energy = 1; o.tech.energy = 20; me.messages = [];
  for (let i = 0; i < 30 && !me.messages.length; i++) techTrade(g, me, o, new Rng([i + 1, 2, 3, 4]));
  check(me.messages.some(m => /progressé en (Énergie|Armement|Propulsion|Construction|Électronique|Biotechnologie)( : niveau \d+)?\./.test(m.text)), `field named in French: « ${me.messages[0]?.text} »`);
  // trader: the report points at it
  g.settings.randomEvents = true; g.year = 2440; g.traders = []; me.messages = [];
  for (let i = 0; i < 200 && !g.traders.length; i++) spawnTraders(g, new Rng([i + 7, 9, 11, 13]));
  check(!me.messages.some(m => m.kind === 'trader'), '3.3.8: no announcement to everyone when it appears at the edge');
  const tr = g.traders[0];
  const homeT = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  tr.x = homeT.x + TRADER_HAIL + 60; tr.y = homeT.y; tr.heading = { x: -1, y: 0 };
  traderHails(g); updateIntel(g);
  check(!me.messages.some(m => m.kind === 'trader') && !me.intel.traders.some(x => x.id === tr.id && !fleetSees(g, me, tr)), `beyond ${TRADER_HAIL} al of your worlds: silent, unseen without scanners`);
  tr.x = homeT.x + TRADER_HAIL - 20;
  traderHails(g); updateIntel(g);
  const tm = me.messages.find(m => m.kind === 'trader');
  check(!!tm && tm.target?.kind === 'trader' && tm.target.x !== undefined && tm.text.includes(homeT.name) && me.intel.traders.some(x => x.id === tr.id), `near your worlds it hails and shows itself: « ${tm?.text.slice(0, 90)}… »`);
  me.messages = []; traderHails(g);
  check(!me.messages.some(m => m.kind === 'trader'), 'only once per empire');
}

if (want('minersmerge')) {
  console.log('--- a miner arriving at a mined world joins the fleet there');
  const g = quiet(game('mm-1'));
  g.settings.terrain = false; g.terrain = [];
  const me = g.players[0];
  me.tech.construction = 6; me.tech.electronics = 3; me.tech.propulsion = 6;
  clearFleets(g, g.fleets.filter(f => f.owner !== 0));
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const target = g.planets.filter(p => p.owner < 0).sort((a, b) => distance(a, home) - distance(b, home))[0];
  const md = design(g, 0, 'Mini-Miner', [{ slot: 1, part: 'Long Hump 6', qty: 1 }, { slot: 3, part: 'Robo-Miner', qty: 1 }, { slot: 4, part: 'Robo-Miner', qty: 1 }], 'Glaneuse');
  const there = orbitAt(g, 0, md, 1, target.id);
  there.waypoints[0].task = 'remoteMine'; there.prevX = there.x; there.prevY = there.y;
  const coming = orbitAt(g, 0, md, 2, home.id);
  coming.fuel = fleetSpec(g, coming).fuelCapacity;
  coming.waypoints.push({ x: target.x, y: target.y, target: 'planet', targetId: target.id, warp: 6, task: 'remoteMine' });
  const rate1 = fleetSpec(g, there).miningRate;
  let y = 0;
  while (g.fleets.includes(coming) && y < 15) { generateTurn(g); y++; }
  check(!g.fleets.includes(coming) && g.fleets.includes(there), `arrived after ${y} year(s) and merged into ${there.name}`);
  check(fleetSpec(g, there).miningRate === rate1 * 3 && there.waypoints[0].task === 'remoteMine', `${fleetSpec(g, there).miningRate} robots mining`);
  check(me.messages.some(m => m.text.includes('qui fore déjà')), 'reported');
  // split there on purpose: the singles are not merged back
  const singles = splitIntoSingles(g, there);
  generateTurn(g);
  check(singles.length === 2 && singles.every(f => g.fleets.includes(f)), 'fleets split at the world stay split');
}

if (want('aifuel')) {
  console.log('--- AI fuel: long-range scouts, no crawling, tankers');
  const g0 = quiet(game('aif-0'));
  const p0 = g0.players[0];
  const lr = autoDesign(p0, 'Scout', 'longRangeScout', 'LR')!;
  const lrs = designSpec(p0, lr);
  const plain = designSpec(p0, autoDesign(p0, 'Scout', 'scout', 'S')!);
  check(lr.slots.some(x => /Fuel Tank/.test(x.part)) && lrs.scanRange > 0 && lrs.fuelCapacity >= plain.fuelCapacity + 250, `long-range scout: scanner + fuel tank, ${plain.fuelCapacity} → ${lrs.fuelCapacity} mg`);
  // travel: a crawl of years is replaced by a refuel stop
  const home = g0.planets.find(p => p.owner === 0 && p.homeworld)!;
  const dd = design(g0, 0, 'Destroyer', warship('Long Hump 6'), 'Patrouilleur');
  const dir = home.x > g0.width / 2 ? -1 : 1;
  const f = fleetAt(g0, 0, dd, 1, { x: home.x + dir * 60, y: home.y });
  f.fuel = Math.round(fleetSpec(g0, f).fuelCapacity * 0.2);
  const far = g0.planets.filter(p => p.owner < 0).sort((a, b) => distance(b, f) - distance(a, f))[0];
  const r = travel(g0, f, { x: far.x, y: far.y, planetId: far.id });
  check(r === 'refuel' && f.waypoints[1]?.targetId === home.id, `a long crawl → refuel first (${r}, heading to ${f.waypoints[1] ? g0.planets[f.waypoints[1].targetId!]?.name : '-'})`);
  // a whole AI game
  const g = game('aif-1');
  g.players[0].ai = 'standard';
  for (let y = 0; y < 70; y++) generateTurn(g);
  const ais = g.players.filter(p => p.ai && !p.monster && !p.dead);
  const scoutDs = g.designs.filter(d => ais.some(p => p.id === d.owner) && d.purpose === 'scout' && !d.deleted);
  check(scoutDs.length > 0 && scoutDs.every(d => d.slots.some(x => /Fuel Tank/.test(x.part))), `AI scout designs carry a fuel tank (${scoutDs.map(d => d.name).join(', ')})`);
  const tankDs = g.designs.filter(d => d.purpose === 'tanker' && ais.some(p => p.id === d.owner));
  check(tankDs.length > 0, `AI tanker designs: ${[...new Set(tankDs.map(d => `${d.name} (${d.hull})`))].join(', ')}`);
  const tankers = g.fleets.filter(x => x.purpose === 'tanker');
  check(tankers.length > 0 && tankers.some(x => x.waypoints.some(w => w.task === 'refuel') || x.refuelFor !== undefined), `${tankers.length} AI tanker(s), on duty or serving`);
  let moving = 0, crawl = 0;
  for (let y = 0; y < 20; y++) {
    generateTurn(g);
    for (const x of g.fleets) { const sp = fleetSpec(g, x); if (!g.players[x.owner].ai || g.players[x.owner].monster || x.waypoints.length < 2 || !sp.hasEngines) continue; moving++; if (x.lastWarp > 0 && x.lastWarp <= 2 && (sp.idealSpeed || 5) >= 5 && sp.freeSpeed < 2) crawl++; }
  }
  check(crawl / Math.max(1, moving) < 0.06, `AI fleets crawling at Warp 1-2: ${crawl} / ${moving} fleet-years (${(crawl / Math.max(1, moving) * 100).toFixed(1)} %)`);
}

if (want('upgrade')) {
  console.log('--- putting a new component in every design');
  const T = (n: string) => TECHS.get(n)!;
  check(betterPart(T('Daddy Long Legs 7'), T('Long Hump 6')) && !betterPart(T('Long Hump 6'), T('Daddy Long Legs 7')), 'engines: Daddy Long Legs 7 beats Long Hump 6');
  check(betterPart(T('X-Ray Laser'), T('Laser')) && !betterPart(T('Mini Gun'), T('Laser')) && !betterPart(T('Pulsed Sapper'), T('Laser')), 'beams: X-Ray over Laser; a gatling or a sapper is another role');
  check(betterPart(T('Super Fuel Tank'), T('Fuel Tank')) && !betterPart(T('Super Cargo Pod'), T('Fuel Tank')), 'fuel tanks upgrade, a cargo pod is not a fuel tank');
  check(betterPart(T('Rhino Scanner'), T('Bat Scanner')) && !betterPart(T('Pick Pocket Scanner'), T('Rhino Scanner')), 'scanners, thief scanners aside');
  check(!betterPart(T('Fielded Kelarium'), T('Tritanium')) && betterPart(T('Crobmnium'), T('Tritanium')), 'armour: pure armour only');
  const g = quiet(game('upg-1'));
  const me = g.players[0];
  check(nextDesignName(g, me, 'Croiseur IV') === 'Croiseur V' && nextDesignName(g, me, 'Sonde') === 'Sonde 2' && nextDesignName(g, me, 'Éclaireur 2') === 'Éclaireur 3', 'names: Croiseur IV → V, Sonde → Sonde 2, Éclaireur 2 → 3');
  me.tech.propulsion = 7;
  const d = design(g, 0, 'Destroyer', warship('Long Hump 6'), 'Escorteur');
  const sb = design(g, 0, 'Scout', [{ slot: 1, part: 'Long Hump 6', qty: 1 }, { slot: 2, part: 'Bat Scanner', qty: 1 }], 'Vigie');
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const ships = orbitAt(g, 0, d, 2, home.id);
  home.queue.push({ kind: 'ship', designId: d.id, qty: 3, allocated: { ironium: 5, boranium: 0, germanium: 0, resources: 10 } });
  const targets = upgradeTargets(g, me, 'Daddy Long Legs 7');
  check(targets.some(x => x.design === d) && targets.some(x => x.design === sb), `${targets.length} design(s) would take the new engine`);
  const done = upgradeDesigns(g, me, 'Daddy Long Legs 7');
  const nd = done.find(x => x.from === d)?.to;
  check(!!nd && nd.slots.some(x => x.part === 'Daddy Long Legs 7') && !nd.slots.some(x => x.part === 'Long Hump 6') && /Escorteur \d+ 2$|Escorteur .* 2$/.test(nd.name) || !!nd && nd.name !== d.name, `new version: ${nd?.name}`);
  check(d.deleted === true && g.fleets.includes(ships) && ships.tokens[0].designId === d.id, 'old design withdrawn, the ships built keep flying');
  check(home.queue.some(q => q.kind === 'ship' && q.designId === nd!.id && q.qty === 3) && !home.queue.some(q => q.designId === d.id), 'the ships under construction switch to the new design');
  check(upgradeTargets(g, me, 'Daddy Long Legs 7').length === 0, 'nothing left to upgrade with it');
  // only the designs ticked
  me.tech.propulsion = 8;
  const before = upgradeTargets(g, me, 'Alpha Drive 8');
  const keep = before[0].design;
  const picked = before.slice(1).map(x => x.design.id);
  const done2 = upgradeDesigns(g, me, 'Alpha Drive 8', picked);
  check(done2.length === before.length - 1 && !keep.deleted && upgradeTargets(g, me, 'Alpha Drive 8').map(x => x.design.id).join() === String(keep.id), `only the ${picked.length} ticked design(s) upgraded, ${keep.name} left as it is`);
}

console.log(bad ? `${bad} failure(s), ${good} ok` : `all good (${good})`);
process.exit(bad ? 1 : 0);
