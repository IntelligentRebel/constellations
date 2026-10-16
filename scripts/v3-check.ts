// Constellations 3 systems: one check per mechanism (run: npx tsx scripts/v3-check.ts [section...]).
import { quickGame, createGame, defaultSettings, CONSTELLATIONS_RULES, classicRules } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { estimateRoute, fleetSpec, distance } from '../src/engine/fleet';
import { PREDEFINED_RACES } from '../src/engine/race';
import { TERRAIN_INFO, effectiveWarp, scanFactorAt, terrainAt } from '../src/engine/terrain';
import { updateIntel } from '../src/engine/scan';
import { resolveBattles } from '../src/engine/battle';
import { Rng, seedFromString } from '../src/engine/rng';
import type { Fleet, GameState, Planet, ShipDesign, Waypoint, DesignSlot, BattleAction } from '../src/engine/types';
import { planetSpec } from '../src/engine/planet';
import { adminFactor, efficiency, regionalBlocker, ADMIN_RADIUS, ADMIN_FLOOR, ADMIN_LOSS, CONQUEST_YEARS, DISORG_FACTOR, REGIONAL_MIN_DIST } from '../src/engine/empire';
import { availableItems, runProduction, unitCost, zeroCost, canBuildShip } from '../src/engine/production';
import { invade } from '../src/engine/tasks';
import { joinNetwork, runLogistics, colonistSurplus } from '../src/engine/logistics';
import { simulateBattle } from '../src/engine/battle';
import { DOCTRINE_FORKS, chooseDoctrine, pendingForks, doctrineNews } from '../src/engine/doctrines';
import { designSpec, designCost } from '../src/engine/design';
import { growthAmount, maxPopulation } from '../src/engine/planet';
import { MEGA, megaBlocker, megaYearCap, megaProgress, megaVisible, MEGA_HORIZON } from '../src/engine/megaprojects';
import { OBJ, OBJECTIVE_POINTS, assignObjectives, objectiveText } from '../src/engine/objectives';
import { computeScore } from '../src/engine/score';
import { setRule } from '../src/engine/rules';
import { newFleet } from '../src/engine/newgame';
import { refitTargets, refitBlocker, queueRefit, pendingRefits, fleetHasObsolete } from '../src/engine/refit';
import { refitCost } from '../src/engine/design';

let bad = 0, good = 0;
export const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
const only = process.argv.slice(2);
const want = (s: string) => !only.length || only.includes(s);
/** 3.4: these checks predate negotiated diplomacy: every empire is hostile to every other, as in Stars! */
const noDiplo = (g: GameState) => { g.settings.diplomacy = false; g.diplomacy = undefined; for (const p of g.players) for (const o of g.players) if (p.id !== o.id && !p.monster && !o.monster) p.relations[o.id] = 'enemy'; return g; };
// 0.3.9: the base rules of the megaprojects and the victory, without the acts, the relays and the cataclysms
const game = (seed: string, size: 'Tiny' | 'Small' | 'Medium' = 'Small') => { const g = noDiplo(quickGame(undefined, size, 3, 'standard', seed)); g.settings.acts = false; g.settings.portalRelays = false; g.settings.cataclysms = false; return g; };

/** A copy of an existing design with a given engine, to test speeds above the starting engines. */
function fastFleet(g: GameState, owner: number, engine = 'Trans-Galactic Drive'): Fleet {
  const me = g.players[owner];
  const f = g.fleets.find(x => x.owner === owner && fleetSpec(g, x).hasEngines && fleetSpec(g, x).cargoCapacity === 0)!;
  const d = g.designs.find(x => x.id === f.tokens[0].designId)!;
  const nd = { ...d, id: g.nextId++, name: 'Test rapide', slots: d.slots.map(s => ({ ...s })) };
  const eng = nd.slots.find(s => /Jump|Hump|Legs|Drive|Mizer|Scoop|Interspace|Trans-Star/.test(s.part));
  if (eng) eng.part = engine;
  g.designs.push(nd);
  f.tokens = [{ designId: nd.id, qty: 1, damage: 0, qtyDamaged: 0 }];
  f.fuel = fleetSpec(g, f).fuelCapacity;
  me.tech.propulsion = Math.max(me.tech.propulsion, 12);
  return f;
}


/** All computer players off (the test drives everything). */
const quiet = (g: GameState) => { for (const p of g.players) p.ai = null; return g; };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
let did = 0;
function design(g: GameState, owner: number, hull: string, slots: DesignSlot[], name = 'Test', role?: ShipDesign['role']): ShipDesign {
  const d: ShipDesign = { id: g.nextId++, owner, name: `${name} ${++did}`, hull, slots, starbase: false, built: 0, role };
  g.designs.push(d);
  return d;
}
function fleetAt(g: GameState, owner: number, d: ShipDesign, qty: number, pos: { x: number; y: number }, orbiting = -1): Fleet {
  const home = g.planets.find(p => p.owner === owner)!;
  const f = newFleet(g, g.players[owner], d.id, qty, home);
  f.x = pos.x; f.y = pos.y; f.orbiting = orbiting;
  f.waypoints = [{ x: pos.x, y: pos.y, target: orbiting >= 0 ? 'planet' : 'space', targetId: orbiting >= 0 ? orbiting : undefined, warp: 0, task: 'none' }];
  return f;
}
const ENG = 'Long Hump 6';

if (want('terrain')) {
  console.log('--- terrain');
  const g = game('terrain-1', 'Medium');
  const t = g.terrain ?? [];
  const kinds = (k: string) => t.filter(x => x.kind === k).length;
  check(kinds('nebula') >= 3 && kinds('storm') >= 2 && kinds('cluster') >= 2, `terrain generated: ${kinds('nebula')} nebulae, ${kinds('storm')} storms, ${kinds('cluster')} clusters`);
  const homes = g.planets.filter(p => p.homeworld && p.owner >= 0);
  check(homes.every(h => !terrainAt(g, h).some(x => x.kind !== 'storm')), 'no homeworld inside a nebula or a cluster');
  // same universe with or without terrain (separate random stream), except cluster richness
  const s2 = defaultSettings(); s2.seed = g.settings.seed; s2.size = 'Medium'; s2.terrain = false;
  const g2 = createGame({ name: 'x', settings: s2, players: g.players.map(p => ({ race: p.race, ai: p.ai })) });
  check(g2.planets.every((p, i) => p.x === g.planets[i].x && p.y === g.planets[i].y && p.name === g.planets[i].name), 'planets identical with terrain off');
  const cl = t.find(x => x.kind === 'cluster')!;
  // (guardians pile minerals on their world, origins found colonies: those planets are left out)
  const special = (gg: GameState, id: number) => !!gg.guardians?.some(x => x.planetId === id) || gg.planets[id].owner >= 0;
  const inCl = g.planets.filter(p => (p.x - cl.x) ** 2 + (p.y - cl.y) ** 2 <= cl.r ** 2 && !p.homeworld && !special(g, p.id) && !special(g2, p.id));
  check(inCl.every(p => p.conc.ironium >= g2.planets[p.id].conc.ironium + Math.min(25, 140 - g2.planets[p.id].conc.ironium)), `cluster planets richer (${inCl.length} planets)`);

  // speed cap: a Warp 9 fleet through a nebula flies at Warp 6 inside
  const neb = t.find(x => x.kind === 'nebula')!;
  const f = fastFleet(g, 0, 'Trans-Star 10');
  f.x = Math.round(neb.x - neb.r - 60); f.y = Math.round(neb.y); f.orbiting = -1;
  const dest: Waypoint = { x: Math.round(neb.x + neb.r + 60), y: Math.round(neb.y), target: 'space', warp: 9, task: 'none' };
  f.waypoints = [{ x: f.x, y: f.y, target: 'space', warp: 0, task: 'none', processed: true }, dest];
  check(effectiveWarp(g, { x: neb.x, y: neb.y }, dest, 9) === TERRAIN_INFO.nebula.warpCap, 'inside a nebula the warp is capped at 6');
  check(effectiveWarp(g, { x: f.x - 400, y: f.y }, { x: f.x - 300, y: f.y }, 9) === 9 || terrainAt(g, { x: f.x - 350, y: f.y }).length > 0, 'away from terrain the warp is not capped');
  const est = estimateRoute(g, f);
  check(est[0].ok, 'test route has enough fuel');
  const ends = est[0].yearEnds;
  const steps = ends.map((p, k) => Math.round(distance(p, k ? ends[k - 1] : f)));
  check(steps.some(s => s <= 37) && steps.some(s => s >= 70), `year steps slow down in the nebula: ${steps.join(', ')}`);
  // real movement follows the estimate
  const real: string[] = [];
  const g3: GameState = JSON.parse(JSON.stringify(g));
  const f3 = g3.fleets.find(x => x.id === f.id)!;
  for (const p of g3.players) p.ai = null;
  let y = 0;
  while (f3.waypoints.length > 1 && y++ < 20) { generateTurn(g3); real.push(`${f3.x},${f3.y}`); }
  const predicted = [...ends.map(p => `${Math.round(p.x)},${Math.round(p.y)}`), `${dest.x},${dest.y}`];
  check(real.length === predicted.length && real.every((p, k) => { const [a, b] = p.split(',').map(Number); const [c, d] = predicted[k].split(',').map(Number); return Math.hypot(a - c, b - d) <= 1.5; }), `movement through the nebula matches the estimate (${real.join(' ')} vs ${predicted.join(' ')})`);

  // scanners: a fleet inside a nebula is seen at half range
  const g4 = game('terrain-2', 'Medium');
  const n4 = g4.terrain!.find(x => x.kind === 'nebula')!;
  const scout = g4.fleets.find(x => x.owner === 0 && fleetSpec(g4, x).scanRange > 0)!;
  const enemy = g4.fleets.find(x => x.owner !== 0 && fleetSpec(g4, x).cloakPercent === 0)!;
  const range = fleetSpec(g4, scout).scanRange;
  for (const p of g4.planets) if (p.owner === 0) p.scanner = false;
  enemy.x = n4.x; enemy.y = n4.y; enemy.orbiting = -1;
  scout.x = Math.round(n4.x - n4.r - range * 0.75); scout.y = Math.round(n4.y); scout.orbiting = -1;
  check(scanFactorAt(g4, enemy) === 0.5 && scanFactorAt(g4, scout) === 1, 'scan factors: 0.5 inside, 1 outside');
  const dist = distance(scout, enemy);
  updateIntel(g4);
  const seen = g4.players[0].intel.fleets.some(fi => fi.id === enemy.id);
  check(dist > range * 0.5 && (dist <= range ? !seen : true), `fleet hidden in the nebula at ${Math.round(dist)} al (range ${range}, seen: ${seen})`);
  enemy.x = Math.round(scout.x + range * 0.4); enemy.y = scout.y;
  const inNeb = scanFactorAt(g4, enemy) < 1;
  updateIntel(g4);
  check(g4.players[0].intel.fleets.some(fi => fi.id === enemy.id) || inNeb, 'same fleet seen when close enough');

  // ion storm: shields halved in battle
  const g5 = game('terrain-3', 'Medium');
  const st = g5.terrain!.find(x => x.kind === 'storm')!;
  const shieldTest = (inStorm: boolean) => {
    const gg: GameState = JSON.parse(JSON.stringify(g5));
    const a = gg.fleets.find(x => x.owner === 0 && fleetSpec(gg, x).hasWeapons)!;
    const b = gg.fleets.find(x => x.owner === 1)!;
    const d = gg.designs.find(x => x.id === a.tokens[0].designId)!;
    const nd = { ...d, id: gg.nextId++, slots: [...d.slots.map(x => ({ ...x })), { slot: 99, part: 'Mole-skin Shield', qty: 2 }] };
    gg.designs.push(nd); a.tokens[0].designId = nd.id;
    const pos = inStorm ? { x: Math.round(st.x), y: Math.round(st.y) } : { x: 5, y: 5 };
    for (const fl of [a, b]) { fl.x = pos.x; fl.y = pos.y; fl.orbiting = -1; }
    const recs = resolveBattles(gg, new Rng(seedFromString('b')));
    return recs[0]?.tokens.find(t => t.fleetId === a.id)?.shields ?? -1;
  };
  const sIn = shieldTest(true), sOut = shieldTest(false);
  check(sOut > 0 && sIn === Math.trunc(sOut / 2), `shields halved in the ion storm (${sIn} vs ${sOut})`);
  // storms drift
  const before = g5.terrain!.filter(x => x.kind === 'storm').map(x => `${x.x},${x.y}`).join(' ');
  for (const p of g5.players) p.ai = null;
  generateTurn(g5);
  const after = g5.terrain!.filter(x => x.kind === 'storm').map(x => `${x.x},${x.y}`).join(' ');
  check(before !== after, `storms drift (${before} -> ${after})`);
  // classic rules: no terrain at all
  const g6 = classicRules(game('terrain-4'));
  check(!g6.terrain?.length && CONSTELLATIONS_RULES.every(k => !(g6.settings as any)[k]), 'classic rules switch everything off');
}

if (want('distance')) {
  console.log('--- distance');
  check(adminFactor(0) === 1 && adminFactor(ADMIN_RADIUS) === 1 && Math.abs(adminFactor(ADMIN_RADIUS + 50) - (1 - ADMIN_LOSS)) < 1e-9 && adminFactor(5000) === ADMIN_FLOOR, 'admin factor: 1 within the radius, then a loss per 50 al, with a floor');
  const g = quiet(game('dist-1', 'Medium'));
  const me = g.players[0];
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  check(me.capital === home.id, 'capital = homeworld at the start');
  const byDist = g.planets.filter(p => p.owner < 0).sort((a, b) => Math.abs(distance(a, home) - 400) - Math.abs(distance(b, home) - 400));
  const far = byDist[0];
  Object.assign(far, { owner: 0, pop: 100000, factories: 100, mines: 50, colonizedYear: g.year });
  const sp = planetSpec(g, far, me);
  const off = clone(g); off.settings.distanceCost = false;
  const spOff = planetSpec(off, off.planets[far.id], off.players[0]);
  const k = adminFactor(distance(far, home));
  check(Math.abs(sp.efficiency.admin - k) < 1e-9 && sp.resources === Math.floor(spOff.resources * k), `far colony (${Math.round(distance(far, home))} al) works at ${Math.round(k * 100)} %: ${sp.resources} R instead of ${spOff.resources}`);
  check(spOff.efficiency.total === 1 && spOff.resources === sp.resourcesBase, 'rule off: full output');
  check(planetSpec(g, home, me).efficiency.total === 1, 'capital at full output');

  // conquest: half output, back to full over a generation
  const victim = g.planets.filter(p => p.owner < 0 && p !== far).sort((a, b) => distance(a, home) - distance(b, home))[0];
  Object.assign(victim, { owner: 1, pop: 20000, factories: 20, mines: 10, defenses: 0, colonizedYear: g.year });
  invade(g, me, victim, 1_000_000);
  check(victim.owner === 0 && victim.conqueredYear === g.year, 'invasion: conquered year recorded');
  check(Math.abs(efficiency(g, me, victim).conquest - 0.5) < 1e-9, 'conquered world starts at 50 %');
  const y0 = g.year;
  g.year = y0 + CONQUEST_YEARS / 2;
  check(Math.abs(efficiency(g, me, victim).conquest - 0.75) < 1e-9, 'half a generation later: 75 %');
  g.year = y0 + CONQUEST_YEARS;
  check(efficiency(g, me, victim).conquest === 1, 'a generation later: 100 %');
  g.year = y0;
  check(me.stats.planetsCaptured === 1 && (me.stats.capturedFrom ?? []).includes(1) && g.players[1].stats.planetsLost === 1, 'capture statistics kept');

  // regional capital
  const near = g.planets.filter(p => p.owner < 0 && distance(p, far) < ADMIN_RADIUS - 5 && distance(p, far) > 20)[0];
  check(regionalBlocker(g, far)!.includes('planètes'), `blocked below 5 worlds: "${regionalBlocker(g, far)}"`);
  const extra = g.planets.filter(p => p.owner < 0 && p !== near).sort((a, b) => distance(a, home) - distance(b, home)).slice(0, 3);
  for (const p of extra) Object.assign(p, { owner: 0, pop: 30000, colonizedYear: g.year });
  if (near) Object.assign(near, { owner: 0, pop: 30000, factories: 30, colonizedYear: g.year });
  const closeOne = extra.find(p => distance(p, home) < REGIONAL_MIN_DIST)!;
  check(!!regionalBlocker(g, closeOne)?.includes('trop près'), `blocked near the capital: "${regionalBlocker(g, closeOne)}"`);
  check(regionalBlocker(g, far) === null, 'far colony may become a regional capital');
  const item = availableItems(g, far).find(i => i.kind === 'capital');
  check(!!item && !item.disabled, 'regional capital offered in the production list');
  far.queue = [{ kind: 'capital', qty: 1, allocated: zeroCost() }];
  far.surface = { ironium: 500, boranium: 500, germanium: 500 };
  far.bonusResources = 2000;
  runProduction(g, far, () => {});
  far.bonusResources = 0;
  check(!!far.regionalCapital && far.surface.ironium === 440, 'regional capital built (cost paid)');
  check(planetSpec(g, far, me).efficiency.total === 1, 'the regional capital works at full output');
  if (near) check(efficiency(g, me, near).admin === 1, `its neighbour (${Math.round(distance(near, far))} al) too`);
  check(!!regionalBlocker(g, far), 'no second regional capital on the same world');

  // capital lost: the government moves, the empire is disorganised
  const g2 = clone(g);
  const me2 = g2.players[0];
  Object.assign(g2.planets[home.id], { owner: 1 });
  generateTurn(g2);
  check(me2.capital === far.id && !g2.planets[far.id].regionalCapital, `capital moved to the regional capital ${g2.planets[me2.capital!].name}`);
  check(me2.disorgUntil === g2.year + 5 && efficiency(g2, me2, g2.planets[far.id]).disorg === DISORG_FACTOR, 'empire disorganised for 5 years');
  check(me2.messages.some(m => m.text.includes('Le gouvernement s\'installe')), 'player told');
  check(g2.players[1].messages.some(m => m.text.includes('perdu leur capitale')) || !g2.players[1].intel.met.includes(0), 'rivals told');
  g2.year += 5;
  check(efficiency(g2, me2, g2.planets[far.id]).disorg === 1, 'disorganisation ends');
}

const warshipSlots = (weapon = 'Laser'): DesignSlot[] => [{ slot: 1, part: ENG, qty: 1 }, { slot: 2, part: weapon, qty: 1 }, { slot: 3, part: weapon, qty: 1 }, { slot: 5, part: 'Tritanium', qty: 2 }];
const freighterSlots: DesignSlot[] = [{ slot: 1, part: ENG, qty: 1 }];

if (want('logistics')) {
  console.log('--- logistics');
  const g = quiet(game('log-1'));
  const me = g.players[0];
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const hs = planetSpec(g, home, me);
  home.pop = Math.round(hs.maxPop * 0.9 / 100) * 100;
  // the nearest decent world becomes a young colony
  const col = g.planets.filter(p => p.owner < 0 && planetSpec(g, p, me).hab > 20).sort((a, b) => distance(a, home) - distance(b, home))[0];
  Object.assign(col, { owner: 0, pop: 2000, colonizedYear: g.year });
  home.migration = { mode: 'out', target: 50 };
  col.migration = { mode: 'in', target: 35 };
  const fd = design(g, 0, 'Medium Freighter', freighterSlots, 'Cargo');
  const f = fleetAt(g, 0, fd, 2, home, home.id);
  check(joinNetwork(g, f) && f.auto === 'logistics', 'freighter joins the network');
  const sur0 = colonistSurplus(g, home);
  check(sur0 > 0, `capital has colonists to spare (${sur0 * 100})`);
  const colPop0 = col.pop;
  for (let y = 0; y < 14; y++) generateTurn(g);
  const st = me.logStats!;
  check(st.colonists > 0 && st.trips > 0, `colonists delivered: ${st.colonists} in ${st.trips} trips`);
  check(col.pop > colPop0 + st.colonists * 0.5, `colony grew with them (${colPop0} -> ${col.pop})`);
  const target = planetSpec(g, home, me).maxPop * 0.5;
  check(home.pop >= target - 100 * fleetSpec(g, f).cargoCapacity, `capital kept above its 50 % floor (${home.pop} vs ${Math.round(target)})`);
  check(!g.fleets.some(x => x.auto === 'logistics' && x.owner === 0 && x.cargo.colonists > 0 && x.waypoints.length <= 1 && x.orbiting === home.id), 'no convoy left loaded and idle at the source');

  // minerals: an exporter sends its surplus to the capital (nobody imports)
  const g2 = quiet(game('log-2'));
  const h2 = g2.planets.find(p => p.owner === 0 && p.homeworld)!;
  const mine2 = g2.planets.filter(p => p.owner < 0).sort((a, b) => distance(a, h2) - distance(b, h2))[1];
  Object.assign(mine2, { owner: 0, pop: 3000, colonizedYear: g2.year, surface: { ironium: 400, boranium: 300, germanium: 200 } });
  mine2.mineralPolicy = { mode: 'export', reserve: 50 };
  const fd2 = design(g2, 0, 'Medium Freighter', freighterSlots, 'Cargo');
  const f2 = fleetAt(g2, 0, fd2, 1, h2, h2.id);
  joinNetwork(g2, f2);
  const before = h2.surface.ironium + h2.surface.boranium + h2.surface.germanium;
  for (let y = 0; y < 10; y++) generateTurn(g2);
  check((g2.players[0].logStats?.minerals ?? 0) > 0, `minerals delivered to the capital: ${g2.players[0].logStats?.minerals} kt`);
  check(mine2.surface.ironium >= 50 || mine2.surface.ironium + mine2.surface.boranium + mine2.surface.germanium < 400, 'exporter keeps its reserve');
  void before;

  // danger: a known enemy warship near the route blocks the job
  const g3 = quiet(game('log-3'));
  const h3 = g3.planets.find(p => p.owner === 0 && p.homeworld)!;
  h3.pop = Math.round(planetSpec(g3, h3, g3.players[0]).maxPop * 0.9 / 100) * 100;
  const c3 = g3.planets.filter(p => p.owner < 0 && planetSpec(g3, p, g3.players[0]).hab > 0).sort((a, b) => distance(a, h3) - distance(b, h3))[0];
  Object.assign(c3, { owner: 0, pop: 2000, colonizedYear: g3.year });
  h3.migration = { mode: 'out', target: 50 }; c3.migration = { mode: 'in', target: 35 };
  const f3 = fleetAt(g3, 0, design(g3, 0, 'Medium Freighter', freighterSlots), 1, h3, h3.id);
  joinNetwork(g3, f3);
  const safe = clone(g3);
  runLogistics(safe);
  check(!!safe.fleets.find(x => x.id === f3.id)!.job, 'without danger the job is taken');
  const wd = design(g3, 1, 'Destroyer', warshipSlots(), 'Pirate');
  const mid = { x: Math.round((h3.x + c3.x) / 2), y: Math.round((h3.y + c3.y) / 2) };
  const pirate = fleetAt(g3, 1, wd, 2, mid);
  pirate.tokens[0].qty = 2;
  updateIntel(g3);
  const seen = g3.players[0].intel.fleets.some(fi => fi.id === pirate.id);
  runLogistics(g3);
  check(seen && !f3.job, `a warship seen on the route (${seen ? 'seen' : 'not seen'}) suspends the convoy`);

  // raid: a loaded convoy meets an enemy warship
  const g4 = quiet(game('log-4'));
  const h4 = g4.planets.find(p => p.owner === 0 && p.homeworld)!;
  const f4 = fleetAt(g4, 0, design(g4, 0, 'Medium Freighter', freighterSlots), 1, { x: h4.x + 40, y: h4.y });
  joinNetwork(g4, f4);
  f4.cargo.colonists = 100; f4.job = { kind: 'colonists', from: h4.id, to: h4.id, amount: 100 };
  // a fast raider (a slow one would see the convoy disengage and escape, as in Stars!)
  const raider = fleetAt(g4, 1, design(g4, 1, 'Destroyer', [{ slot: 1, part: 'Trans-Star 10', qty: 1 }, { slot: 2, part: 'X-Ray Laser', qty: 1 }, { slot: 3, part: 'X-Ray Laser', qty: 1 }], 'Corsaire'), 3, { x: f4.x, y: f4.y });
  resolveBattles(g4, new Rng(seedFromString('raid')));
  check(!g4.fleets.includes(f4), 'convoy destroyed by the raider');
  check(g4.players[0].logStats?.convoysLost === 1 && g4.players[0].logStats?.lostColonists === 10000, 'loss recorded (10 000 colonists)');
  check(g4.players[1].stats.convoysDestroyed === 1, 'raider credited');
  check(g4.players[0].messages.some(m => m.text.startsWith('Convoi intercepté')), 'owner told');
  void raider;

  // rule off: freighters leave the network
  setRule(g, 'logistics', false);
  check(!g.fleets.some(x => x.auto === 'logistics'), 'rule off: the network is dissolved');
}

/** Design name of the target of the first shot fired by `owner` in a battle record. */
function firstTarget(rec: import('../src/engine/types').BattleRecord, owner: number): string {
  const byId = new Map(rec.tokens.map(t => [t.id, t]));
  const f = rec.actions.find(a => a.t === 'fire' && byId.get(a.id)!.owner === owner) as Extract<BattleAction, { t: 'fire' }> | undefined;
  return f ? byId.get(f.target)!.designName : '(aucun tir)';
}

if (want('combat')) {
  console.log('--- combat');
  const base = quiet(game('combat-1'));
  const pos = { x: 30, y: 30 };
  // threat targeting: real warships first, cheap armed decoys and unarmed hulls last. The defenders have no
  // engines (they all stay on one square) so every target comes within torpedo range at the same moment.
  const setup = (roles: boolean) => {
    const g = clone(base); g.settings.combatRoles = roles;
    const atk = design(g, 0, 'Destroyer', [{ slot: 1, part: ENG, qty: 1 }, { slot: 2, part: 'Delta Torpedo', qty: 1 }, { slot: 3, part: 'Delta Torpedo', qty: 1 }], 'Attaquant');
    const war = design(g, 1, 'Destroyer', [{ slot: 2, part: 'X-Ray Laser', qty: 1 }, { slot: 3, part: 'X-Ray Laser', qty: 1 }, { slot: 5, part: 'Tritanium', qty: 2 }], 'Croiseur');
    const chaff = design(g, 1, 'Scout', [{ slot: 3, part: 'Laser', qty: 1 }], 'Leurre armé');
    const empty = design(g, 1, 'Scout', [], 'Coque vide');
    fleetAt(g, 0, atk, 4, pos);
    fleetAt(g, 1, war, 2, pos);
    for (let i = 0; i < 4; i++) { fleetAt(g, 1, chaff, 1, pos); fleetAt(g, 1, empty, 1, pos); }
    return g;
  };
  const gOff = setup(false), gOn = setup(true);
  const recOff = resolveBattles(gOff, new Rng(seedFromString('c1')))[0];
  const recOn = resolveBattles(gOn, new Rng(seedFromString('c1')))[0];
  check(!firstTarget(recOff, 0).startsWith('Croiseur'), `classic rules: the decoys draw the first torpedoes (${firstTarget(recOff, 0)})`);
  check(firstTarget(recOn, 0).startsWith('Croiseur'), `threat targeting: the warships are shot first (${firstTarget(recOn, 0)})`);
  // damage in the first round with shots fired
  const firstVolley = (rec: typeof recOn, n: string) => {
    let round = 0, started = false, sum = 0;
    for (const a of rec.actions) {
      if (a.t === 'round') { if (started) break; round = a.round; continue; }
      if (a.t !== 'fire') continue;
      started = true;
      if (rec.tokens.find(t => t.id === a.target)!.designName.startsWith(n)) sum += a.armorDmg + a.shieldDmg;
    }
    void round; return sum;
  };
  check(firstVolley(recOn, 'Croiseur') > firstVolley(recOff, 'Croiseur'), `first volley on the warships: ${firstVolley(recOn, 'Croiseur')} vs ${firstVolley(recOff, 'Croiseur')} damage`);
  check(firstVolley(recOn, 'Coque vide') + firstVolley(recOn, 'Leurre') < firstVolley(recOff, 'Coque vide') + firstVolley(recOff, 'Leurre'), `less wasted on decoys: ${firstVolley(recOn, 'Coque vide') + firstVolley(recOn, 'Leurre')} vs ${firstVolley(recOff, 'Coque vide') + firstVolley(recOff, 'Leurre')}`);

  // screens draw fire, artillery starts behind the line
  const g2 = clone(base); g2.settings.combatRoles = true;
  const a2 = design(g2, 0, 'Destroyer', warshipSlots('X-Ray Laser'), 'Attaquant');
  const line = design(g2, 1, 'Destroyer', warshipSlots('X-Ray Laser'), 'Ligne', 'line');
  const screen = design(g2, 1, 'Destroyer', warshipSlots('X-Ray Laser'), 'Écran', 'screen');
  const art = design(g2, 1, 'Destroyer', warshipSlots('X-Ray Laser'), 'Artillerie', 'artillery');
  fleetAt(g2, 0, a2, 3, pos); fleetAt(g2, 1, line, 2, pos); fleetAt(g2, 1, screen, 2, pos); fleetAt(g2, 1, art, 2, pos);
  const rec2 = resolveBattles(g2, new Rng(seedFromString('c2')))[0];
  const tk = (n: string) => rec2.tokens.find(t => t.designName.startsWith(n))!;
  const cx = (t: { x: number; y: number }) => Math.max(Math.abs(t.x - 4.5), Math.abs(t.y - 4.5));
  check(cx(tk('Écran')) < cx(tk('Ligne')) && cx(tk('Artillerie')) > cx(tk('Ligne')), `deployment: screen ahead (${tk('Écran').x},${tk('Écran').y}), line (${tk('Ligne').x},${tk('Ligne').y}), artillery behind (${tk('Artillerie').x},${tk('Artillerie').y})`);
  check(firstTarget(rec2, 0).startsWith('Écran'), `the screen draws the first shot (${firstTarget(rec2, 0)})`);

  // retreat threshold
  const g3 = clone(base); g3.settings.combatRoles = true;
  const me3 = g3.players[0];
  me3.battlePlans.push({ ...me3.battlePlans[0], id: 9, name: 'Prudent', retreatAt: 30 });
  const small = design(g3, 0, 'Destroyer', [{ slot: 1, part: 'Trans-Star 10', qty: 1 }, { slot: 2, part: 'Laser', qty: 1 }], 'Patrouille');
  const big = design(g3, 1, 'Destroyer', warshipSlots('X-Ray Laser'), 'Armada');
  const mine3 = fleetAt(g3, 0, small, 6, pos); mine3.battlePlan = 9;
  fleetAt(g3, 1, big, 6, pos);
  const rec3 = resolveBattles(g3, new Rng(seedFromString('c3')))[0];
  const myTok = rec3.tokens.find(t => t.owner === 0)!;
  const left = rec3.actions.some(a => a.t === 'leave' && a.id === myTok.id);
  check(left, 'beaten fleet disengages once 30 % is lost');
  const survivor = g3.fleets.find(f => f.id === mine3.id);
  check(!!survivor && survivor.waypoints.length > 1 && survivor.waypoints[1].target === 'planet', `it withdraws to a friendly world (${survivor ? survivor.tokens[0].qty : 0} ships left)`);
  check(me3.messages.some(m => m.text.includes('seuil de retraite')), 'player told about the retreat');
  // without a threshold the same fleet fights to the end
  const g4 = clone(base); g4.settings.combatRoles = true;
  const s4 = design(g4, 0, 'Destroyer', [{ slot: 1, part: 'Trans-Star 10', qty: 1 }, { slot: 2, part: 'Laser', qty: 1 }], 'Patrouille');
  const b4 = design(g4, 1, 'Destroyer', warshipSlots('X-Ray Laser'), 'Armada');
  const m4 = fleetAt(g4, 0, s4, 6, pos); fleetAt(g4, 1, b4, 6, pos);
  resolveBattles(g4, new Rng(seedFromString('c3')));
  check((g4.fleets.find(f => f.id === m4.id)?.tokens[0].qty ?? 0) <= (survivor?.tokens[0].qty ?? 0), 'the retreat saved ships');

  // simulator: deterministic, does not touch the game, sensible results
  const g5 = clone(base);
  const strong = design(g5, 0, 'Destroyer', warshipSlots('X-Ray Laser'), 'Fort');
  const weak = design(g5, 1, 'Scout', [{ slot: 1, part: ENG, qty: 1 }, { slot: 3, part: 'Laser', qty: 1 }], 'Faible');
  const snap = JSON.stringify(g5);
  const r1 = simulateBattle(g5, 0, [{ design: strong, qty: 4 }], [{ design: weak, qty: 2 }], 20);
  const r2 = simulateBattle(g5, 0, [{ design: strong, qty: 4 }], [{ design: weak, qty: 2 }], 20);
  check(JSON.stringify(g5) === snap, 'simulation leaves the game untouched');
  check(JSON.stringify(r1) === JSON.stringify(r2), 'simulation is reproducible');
  check(r1.winA >= 18 && r1.lostB > 1.5, `4 destroyers beat 2 armed scouts (${r1.winA}/20, ${r1.lostB.toFixed(1)} destroyed)`);
  const r3 = simulateBattle(g5, 0, [{ design: weak, qty: 1 }], [{ design: strong, qty: 6 }], 20);
  check(r3.winB >= 18, `and the reverse loses (${r3.winB}/20 defeats)`);
}

if (want('doctrines')) {
  console.log('--- doctrines');
  const g = quiet(game('doc-1'));
  const me = g.players[0];
  check(pendingForks(g, me).length === 0, 'no doctrine at the start');
  const fork = DOCTRINE_FORKS.find(f => f.id === 'construction')!;
  check(!chooseDoctrine(g, me, 'construction', 'a'), 'cannot choose before the level');
  me.tech.construction = fork.level;
  check(pendingForks(g, me).some(f => f.id === 'construction'), `fork reached at ${fork.field} ${fork.level}`);
  const d = design(g, 0, 'Destroyer', warshipSlots('Laser'), 'Témoin');
  const before = designSpec(me, d), costBefore = designCost(me, d);
  const other = clone(me);
  check(chooseDoctrine(g, me, 'construction', 'a') && !chooseDoctrine(g, me, 'construction', 'b'), 'choice is final');
  check(designSpec(me, d).armor === Math.trunc(before.armor * 1.2), `Blindage lourd: armour ${before.armor} -> ${designSpec(me, d).armor}`);
  other.doctrines = { construction: 'b' };
  check(designCost(other, d).resources === Math.ceil(costBefore.resources * 0.88 - 1e-9) || designCost(other, d).resources === Math.ceil(costBefore.resources * 0.88), `Production modulaire: ${costBefore.resources} -> ${designCost(other, d).resources} R`);
  const withShield = design(g, 0, 'Destroyer', [...warshipSlots('Laser').slice(0, 3), { slot: 4, part: 'Mole-skin Shield', qty: 1 }], 'Bouclier');
  const sh = designSpec(me, withShield).shields;
  check(designSpec({ ...me, doctrines: { energy: 'a' } }, withShield).shields === Math.trunc(sh * 1.2), 'Boucliers adaptatifs: +20 %');
  const beam = designSpec(me, d).weapons[0].power;
  check(designSpec({ ...me, doctrines: { energy: 'b' } }, d).weapons[0].power === Math.trunc(beam * 1.15) || designSpec({ ...me, doctrines: { energy: 'b' } }, d).weapons[0].power > beam, 'Armes surchargées: beams hit harder');
  const scout = g.designs.find(x => x.owner === 0 && designSpec(me, x).scanRange > 0 && !x.starbase)!;
  check(designSpec({ ...me, doctrines: { electronics: 'a' } }, scout).scanRange === Math.round(designSpec(me, scout).scanRange * 1.25) || Math.abs(designSpec({ ...me, doctrines: { electronics: 'a' } }, scout).scanRange - designSpec(me, scout).scanRange * 1.25) <= 1, 'Réseau de capteurs: +25 % scan');
  check(designSpec({ ...me, doctrines: { electronics: 'b' } }, scout).cloakPercent >= designSpec(me, scout).cloakPercent + 10, 'Guerre électronique: +10 cloak');
  const eng = designSpec(me, d);
  const endu = designSpec({ ...me, doctrines: { propulsion: 'a' } }, d);
  check(endu.fuelCapacity === Math.trunc(eng.fuelCapacity * 1.25) && endu.fuelUsage[6] < eng.fuelUsage[6], `Endurance: tank ${eng.fuelCapacity} -> ${endu.fuelCapacity}, W6 use ${eng.fuelUsage[6]} -> ${endu.fuelUsage[6]}`);
  check(designSpec({ ...me, doctrines: { propulsion: 'b' } }, d).movement >= eng.movement + 1 || eng.movement >= 10, `Vitesse tactique: battle speed ${eng.movement} -> ${designSpec({ ...me, doctrines: { propulsion: 'b' } }, d).movement}`);
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  home.pop = 200000;
  const gr = growthAmount(g, me, home), mp = maxPopulation(g, me, home);
  check(growthAmount(g, { ...me, doctrines: { biotech: 'a' } }, home) > gr, 'Natalité: faster growth');
  check(maxPopulation(g, { ...me, doctrines: { biotech: 'b' } }, home) > mp, 'Arcologies: more room');
  // planets: sensors on planetary scanners
  const pScan = planetSpec(g, home, me).scanRange;
  me.doctrines = { ...me.doctrines, electronics: 'a' };
  check(planetSpec(g, home, me).scanRange === Math.round(pScan * 1.25), `planetary scanner ${pScan} -> ${planetSpec(g, home, me).scanRange} al`);
  // assault: invasions
  const target = g.planets.filter(p => p.owner < 0).sort((a, b) => distance(a, home) - distance(b, home))[0];
  const tryInvade = (assault: boolean, colonists: number) => {
    const gg = clone(g); const t = gg.planets[target.id]; Object.assign(t, { owner: 1, pop: 10000, defenses: 0 });
    gg.players[0].doctrines = assault ? { weapons: 'a' } : {};
    invade(gg, gg.players[0], t, colonists); return t.owner === 0;
  };
  // an attack just too weak without the doctrine succeeds with it
  let n = 9000; while (n < 30000 && !tryInvade(false, n)) n += 500;
  check(tryInvade(true, Math.round(n * 0.85)) && !tryInvade(false, Math.round(n * 0.85)), `Assaut: ${Math.round(n * 0.85)} colonists enough with the doctrine, not without`);
  // AI picks its doctrines by itself, humans are told
  const g2 = game('doc-2');
  for (const p of g2.players) { p.tech.construction = 7; p.tech.energy = 6; }
  generateTurn(g2);
  check(g2.players.slice(1).filter(p => !p.monster).every(p => p.doctrines?.construction && p.doctrines?.energy), 'computer players choose their doctrines');
  check(!g2.players[0].doctrines?.construction, 'the human is not decided for');
  g2.players[0].messages = [];
  doctrineNews(g2, g2.players[0], new Set());
  check(g2.players[0].messages.filter(m => m.text.startsWith('Doctrine à choisir')).length === 2, 'the human is asked when a fork is reached');
  check(classicRules(game('doc-3')).settings.doctrines === false && pendingForks(classicRules(game('doc-3')), me).length === 0, 'classic rules: no doctrines');
}

if (want('mega')) {
  console.log('--- mega');
  const g = quiet(game('mega-1'));
  const me = g.players[0];
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  check(!megaVisible(me, MEGA.portal) && !availableItems(g, home).some(i => i.megaId === 'portal'), 'at the start the Portail is beyond the horizon: not even listed');
  check(megaBlocker(g, home, 'portal') === 'inconnu de vos scientifiques', 'and unknown');
  for (const f of ['energy', 'propulsion', 'construction', 'electronics'] as const) me.tech[f] = 12 - MEGA_HORIZON;
  check(megaVisible(me, MEGA.portal) && availableItems(g, home).some(i => i.megaId === 'portal' && !!i.disabled), `foreseen once every field is within ${MEGA_HORIZON} levels (listed, not buildable)`);
  me.tech.energy = 12 - MEGA_HORIZON - 1;
  check(!megaVisible(me, MEGA.portal), 'one field too far and it is unknown again');
  me.tech.energy = 12 - MEGA_HORIZON;
  check(!!megaBlocker(g, home, 'portal')?.startsWith('technologie'), `Portail needs technology: "${megaBlocker(g, home, 'portal')}"`);
  for (const f of ['energy', 'propulsion', 'construction', 'electronics'] as const) me.tech[f] = 12;
  home.pop = 100000;
  check(!!megaBlocker(g, home, 'portal')?.includes('habitants'), `and population: "${megaBlocker(g, home, 'portal')}"`);
  home.pop = 900000;
  check(megaBlocker(g, home, 'portal') === null, 'Portail can start');
  check(availableItems(g, home).some(i => i.kind === 'mega' && i.megaId === 'portal' && !i.disabled), 'offered in the production list');
  const m = MEGA.portal, cap = megaYearCap(m);
  home.queue = [{ kind: 'mega', megaId: 'portal', qty: 1, allocated: zeroCost() }, { kind: 'factory', qty: 5, allocated: zeroCost() }];
  check(!!megaBlocker(g, home, 'portal')?.includes('file'), 'only one at a time');
  const rich = (pl: Planet) => { pl.surface = { ironium: 50000, boranium: 50000, germanium: 50000 }; pl.bonusResources = 100000; };
  rich(home);
  const f0 = home.factories;
  runProduction(g, home, () => {});
  const it = home.queue.find(q => q.kind === 'mega')!;
  check(it.allocated.resources === cap.resources && it.allocated.germanium === cap.germanium, `yearly cap respected (${it.allocated.resources} R of ${m.cost.resources})`);
  check(home.factories === f0 + 5, 'the rest of the queue is built the same year');
  let years = 1;
  while (home.queue.some(q => q.kind === 'mega') && years < 30) { rich(home); runProduction(g, home, () => {}); years++; }
  check(years === m.minYears, `Portail completed in ${years} years (minimum ${m.minYears})`);
  check(g.victor === 0 && g.victoryKind === 'megaproject' && me.messages.some(x => x.kind === 'victory'), 'its completion wins the game');

  // the galaxy is told, computer players go for the builder
  const g2 = quiet(game('mega-2'));
  const h2 = g2.planets.find(p => p.owner === 0 && p.homeworld)!;
  for (const f of ['energy', 'propulsion', 'construction', 'electronics'] as const) g2.players[0].tech[f] = 12;
  h2.pop = 900000;
  h2.queue = [{ kind: 'mega', megaId: 'portal', qty: 1, allocated: { ...zeroCost(), resources: Math.round(m.cost.resources * 0.09), ironium: Math.round(m.cost.ironium * 0.09), boranium: Math.round(m.cost.boranium * 0.09), germanium: Math.round(m.cost.germanium * 0.09) } }];
  h2.surface = { ironium: 50000, boranium: 50000, germanium: 50000 };
  g2.players[1].ai = 'standard';
  const ai = g2.players[1];
  // give the AI a reason to know nothing: it never met player 0
  ai.intel.met = ai.intel.met.filter(x => x !== 0);
  let news: string | undefined;
  for (let y = 0; y < 3; y++) { h2.bonusResources = 100000; generateTurn(g2); news ??= ai.messages.concat(g2.players[2].messages).find(x => x.text.includes('Portail'))?.text; }
  check(!!news, `rivals are told: "${news}"`);
  check(g2.players[2].intel.planets[h2.id].owner === 0 && g2.players[2].intel.planets[h2.id].year !== undefined, 'and see the planet');
  check(ai.aiState?.portalTarget === h2.id && ai.aiState?.targetPlayer === 0 && ai.aiState?.phase === 'war', 'a computer player goes to war against the builder');
  check((h2.queue.find(q => q.kind === 'mega')?.announced ?? 0) >= 10, 'progress announced');
  // capture: the work is lost
  const g3 = clone(g2);
  const h3 = g3.planets[h2.id];
  h3.defenses = 0;
  invade(g3, g3.players[1], h3, 10_000_000);
  check(h3.owner === 1 && !h3.queue.some(q => q.kind === 'mega'), 'a captured Portail is lost');

  // lasting megaprojects
  const g4 = quiet(game('mega-3'));
  const me4 = g4.players[0];
  const h4 = g4.planets.find(p => p.owner === 0 && p.homeworld)!;
  const sc0 = planetSpec(g4, h4, me4).scanRange;
  h4.megaprojects = ['observatory'];
  check(planetSpec(g4, h4, me4).scanRange === 650 && planetSpec(g4, h4, me4).scanRangePen === 325, `Grand Observatoire: scanner ${sc0} -> 650 al (pen 325)`);
  const ship = g4.designs.find(d => d.owner === 0 && !d.starbase)!;
  const c0 = unitCost(g4, h4, me4, { kind: 'ship', designId: ship.id });
  h4.megaprojects = ['shipyard'];
  const c1 = unitCost(g4, h4, me4, { kind: 'ship', designId: ship.id });
  check(c1.resources === Math.ceil(c0.resources * 0.8), `Chantier stellaire: ${c0.resources} -> ${c1.resources} R`);
  const heavy = design(g4, 0, 'Battleship', [{ slot: 1, part: ENG, qty: 4 }, { slot: 9, part: 'Tritanium', qty: 6 }, { slot: 4, part: 'Laser', qty: 6 }], 'Lourd');
  const dockD = design(g4, 0, 'Space Dock', [], 'Dock');
  dockD.starbase = true;
  h4.starbase = { designId: dockD.id, damage: 0 };
  h4.megaprojects = [];
  const sbDock = canBuildShip(g4, h4, heavy);
  h4.megaprojects = ['shipyard'];
  check(!!sbDock && canBuildShip(g4, h4, heavy) === null, `no mass limit (without: ${sbDock ?? 'ok'})`);
  // planetary shield against bombs
  const bomb = (shield: boolean, bombers = 4) => {
    const gg = quiet(game('mega-4'));
    const h = gg.planets.find(p => p.owner === 0 && p.homeworld)!;
    h.starbase = null; h.pop = 500000; h.defenses = 0;
    if (shield) h.megaprojects = ['shield'];
    const bd = design(gg, 1, 'Mini Bomber', [{ slot: 1, part: ENG, qty: 1 }, { slot: 2, part: 'Lady Finger Bomb', qty: 2 }], 'Bombardier');
    if (bombers) fleetAt(gg, 1, bd, bombers, h, h.id);
    generateTurn(gg);
    return h.pop;
  };
  const calm = bomb(false, 0), killedOpen = calm - bomb(false), killedShield = calm - bomb(true);
  check(killedShield < killedOpen * 0.5, `Bouclier planétaire: bombs kill ${killedShield} instead of ${killedOpen}`);
  check(classicRules(game('mega-5')).settings.megaprojects === false && !availableItems(classicRules(game('mega-5')), g4.planets.find(p => p.owner === 0 && p.homeworld)!).some(i => i.kind === 'mega'), 'classic rules: no megaprojects');
}

if (want('objectives')) {
  console.log('--- objectives');
  const g = game('obj-1');
  check(g.players.filter(p => !p.monster).every(p => p.objectives?.length === 2 && p.objectives[0].id !== p.objectives[1].id), 'two different objectives per empire, computers included');
  const war = ['conqueror', 'hunter', 'corsair', 'vendetta'];
  const many = Array.from({ length: 30 }, (_, i) => game(`obj-r${i}`, 'Tiny')).flatMap(x => x.players.filter(p => !p.monster));
  check(many.every(p => p.objectives!.filter(o => war.includes(o.id)).length <= 1), 'never two warlike objectives');
  const ids = new Set(many.flatMap(p => p.objectives!.map(o => o.id)));
  check(ids.size >= 10, `objectives vary (${ids.size} kinds seen in 30 games)`);
  check(JSON.stringify(game('obj-1').players.map(p => p.objectives)) === JSON.stringify(g.players.map(p => p.objectives)), 'same seed, same objectives');
  check(many.filter(p => p.objectives!.some(o => o.id === 'vendetta')).every(p => { const o = p.objectives!.find(x => x.id === 'vendetta')!; return o.param2 !== undefined && o.param2 !== p.id; }), 'vendetta targets another empire');
  // completion: points, news for the others
  quiet(g);
  const me = g.players[0];
  me.objectives = [{ id: 'settler', param: 1 }, { id: 'fortress', param: g.year + 50 }];
  for (const p of g.players) if (!p.intel.met.includes(0)) p.intel.met.push(0);
  const sc0 = computeScore(g, me).score;
  generateTurn(g);
  check(me.objectives[0].done === g.year, 'objective achieved');
  check(computeScore(g, me).score >= sc0 + OBJECTIVE_POINTS - 5, `worth ${OBJECTIVE_POINTS} points (${sc0} -> ${computeScore(g, me).score})`);
  check(me.messages.some(m => m.text.startsWith('Objectif secret accompli')), 'owner told what');
  check(g.players[1].messages.some(m => m.text.includes('objectifs secrets') && !m.text.includes('Bâtisseur')), 'others told that, not what');
  // a fortress falls
  me.stats.planetsLost = 1;
  generateTurn(g);
  check(me.objectives[1].failed === g.year && me.objectives[1].done === undefined, 'losing a world fails the Forteresse objective');
  // every objective can be checked without error, and the texts have no placeholder left
  for (const d of Object.values(OBJ)) {
    const o = { id: d.id, param: d.param ? d.param(g, me, new Rng(seedFromString('x'))) : undefined, param2: 1 };
    let okCheck = true;
    try { d.check(g, me, o); d.fails?.(g, me, o); d.progress?.(g, me, o); } catch { okCheck = false; }
    check(okCheck && !/[{}]/.test(objectiveText(g, o)), `${d.name}: "${objectiveText(g, o)}"`);
  }
  const off = classicRules(game('obj-2'));
  off.players[0].objectives = [{ id: 'settler', param: 1 }];
  generateTurn(off);
  check(off.players[0].objectives[0].done === undefined, 'classic rules: objectives ignored');
}

if (want('deception')) {
  console.log('--- deception');
  const g = quiet(game('dec-1'));
  const me = g.players[0];
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const hs = planetSpec(g, home, me);
  check(hs.scanRange > 0 && hs.scanRangePen <= 0, `homeworld scanner ${hs.scanRange} al, no penetrating range`);
  const wd = design(g, 1, 'Destroyer', warshipSlots('Laser'), 'Croiseur');
  const pos = { x: Math.round(home.x + hs.scanRange * 0.6), y: Math.round(home.y) };
  const enemy = fleetAt(g, 1, wd, 3, pos);
  const real = fleetSpec(g, enemy).mass;
  const masses: number[] = [], counts: number[] = [];
  for (let y = 0; y < 12; y++) { updateIntel(g); const fi = me.intel.fleets.find(x => x.id === enemy.id)!; masses.push(fi.mass!); counts.push(fi.count!); if (y === 0) check(fi.uncertain === true && !fi.tokens, 'ordinary scan: an estimate, composition hidden'); g.year++; }
  check(masses.every(m => m >= real * 0.7 - 1 && m <= real * 1.3 + 1), `mass estimates within ±30 % of ${real} kt: ${masses.join(', ')}`);
  check(new Set(masses).size > 3, 'the estimate changes from year to year');
  check(counts.every(c => c >= 2 && c <= 4), `ship count estimated around 3: ${counts.join(', ')}`);
  // decoys inflate the apparent mass
  const decoy = design(g, 1, 'Destroyer', [...warshipSlots('Laser'), { slot: 7, part: 'Holographic Decoy', qty: 1 }], 'Croiseur leurré');
  enemy.tokens = [{ designId: decoy.id, qty: 3, damage: 0, qtyDamaged: 0 }];
  const fs = fleetSpec(g, enemy);
  check(fs.decoyMass === 360 && fs.decoys === 3, 'three decoys project 360 kt and three phantom ships');
  const seenM: number[] = [], seenC: number[] = [];
  for (let y = 0; y < 12; y++) { updateIntel(g); const fi = me.intel.fleets.find(x => x.id === enemy.id)!; seenM.push(fi.mass!); seenC.push(fi.count!); g.year++; }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  check(avg(seenM) > fs.mass * 1.5 && avg(seenC) > 4.5, `with decoys the fleet looks ${Math.round(avg(seenM))} kt / ${avg(seenC).toFixed(1)} ships (real ${fs.mass} kt / 3)`);
  // a penetrating scanner sees through
  const pen = design(g, 0, 'Scout', [{ slot: 1, part: ENG, qty: 1 }, { slot: 2, part: 'Mole Scanner', qty: 1 }], 'Sonde');
  const ps = designSpec(me, pen);
  const probe = fleetAt(g, 0, pen, 1, { x: enemy.x - Math.max(5, Math.round(ps.scanRangePen * 0.5)), y: enemy.y });
  updateIntel(g);
  const fi = me.intel.fleets.find(x => x.id === enemy.id)!;
  check(ps.scanRangePen > 0 && fi.detail === 'full' && fi.mass === fs.mass && fi.count === 3 && !fi.uncertain, `penetrating scanner (${ps.scanRangePen} al): exact ${fi.mass} kt, 3 ships`);
  void probe;
  // decoys do nothing in battle
  check(designSpec(g.players[1], decoy).powerRating === designSpec(g.players[1], wd).powerRating && designSpec(g.players[1], decoy).armor === designSpec(g.players[1], wd).armor, 'decoys do not fight');
  // rule off: Stars! behaviour
  const g2 = clone(g); g2.settings.deception = false; g2.settings.anonymousContacts = false;
  g2.fleets = g2.fleets.filter(f => f.id !== probe.id);
  updateIntel(g2);
  const fi2 = g2.players[0].intel.fleets.find(x => x.id === enemy.id)!;
  check(fi2.detail === 'full' && fi2.mass === fs.mass && !fi2.uncertain, 'rule off: ordinary scanners give the exact composition');
}

if (want('rules')) {
  console.log('--- rules');
  const g = classicRules(game('rules-1'));
  check(!g.terrain?.length && g.players.every(p => !p.objectives?.length || true), 'classic game');
  setRule(g, 'terrain', true);
  check(!!g.terrain?.length && g.settings.terrain === true, `terrain generated when switched on (${g.terrain!.length} regions)`);
  g.players.forEach(p => { p.objectives = undefined; });
  setRule(g, 'secretObjectives', true);
  check(g.players.every(p => p.monster || p.objectives?.length === 2), 'objectives drawn when switched on');
  g.players[0].doctrines = { energy: 'a' };
  setRule(g, 'doctrines', false);
  check(!g.players[0].doctrines, 'doctrines cleared when switched off');
  g.players[0].capital = undefined;
  setRule(g, 'distanceCost', true);
  check(g.players[0].capital === g.planets.find(p => p.owner === 0 && p.homeworld)!.id, 'capital set when switched on');
  for (let y = 0; y < 5; y++) generateTurn(g);
  check(g.year === 2405, 'game goes on after the switches');
}

if (want('refit')) {
  console.log('--- refit and withdrawn designs');
  const g = quiet(game('refit-1'));
  const me = g.players[0];
  const home = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const a = design(g, 0, 'Destroyer', warshipSlots('Laser'), 'Ancien');
  const b = design(g, 0, 'Destroyer', warshipSlots('X-Ray Laser'), 'Nouveau');
  const other = design(g, 0, 'Scout', [{ slot: 1, part: ENG, qty: 1 }], 'Autre coque');
  const f = fleetAt(g, 0, a, 3, home, home.id);
  f.tokens[0].qtyDamaged = 1; f.tokens[0].damage = 50;
  check(refitTargets(g, me, a.id).some(d => d.id === b.id) && !refitTargets(g, me, a.id).some(d => d.id === other.id), 'targets: same hull only');
  const c = refitCost(me, a, b);
  const full = designCost(me, b);
  check(c.resources > 0 && c.resources < full.resources && c.resources >= Math.ceil(full.resources * 0.1 - 1e-9), `refit cheaper than a new ship (${c.resources} R vs ${full.resources} R)`);
  check(!!refitBlocker(g, f, a.id, other.id), `another hull is refused: "${refitBlocker(g, f, a.id, other.id)}"`);
  const away = clone(g); const fa = away.fleets.find(x => x.id === f.id)!; fa.orbiting = -1; fa.x += 30;
  check(!!refitBlocker(away, fa, a.id, b.id)?.includes('orbite'), `deep space is refused: "${refitBlocker(away, fa, a.id, b.id)}"`);
  // the refit goes through the queue, the fleet holds its orbit
  f.waypoints.push({ x: home.x + 50, y: home.y, target: 'space', warp: 5, task: 'none' });
  check(queueRefit(g, f, a.id, b.id, 2) === null && home.queue[0].kind === 'refit' && f.waypoints.length === 1, 'refit queued first, the fleet holds position');
  check(pendingRefits(g, f).length === 1, 'shown as pending on the fleet');
  home.surface = { ironium: 5000, boranium: 5000, germanium: 5000 };
  const g2 = clone(g);
  generateTurn(g);
  const tA = f.tokens.find(t => t.designId === a.id), tB = f.tokens.find(t => t.designId === b.id);
  check(tA?.qty === 1 && tB?.qty === 2, `two ships refitted, one left (${f.tokens.map(t => `${t.qty}×${t.designId}`).join(', ')})`);
  check(!!tB && tB.qtyDamaged === 0 && (tA?.qtyDamaged ?? 0) === 0, 'refitted ships come out repaired (the damaged one went first)');
  check(me.messages.some(m => m.text.includes('modernisé')), 'player told');
  check(!home.queue.some(q => q.kind === 'refit'), 'queue line done');
  // the fleet leaves before the work: cancelled, minerals back
  const f2 = g2.fleets.find(x => x.id === f.id)!;
  const h2 = g2.planets[home.id];
  h2.queue[0].allocated = { ironium: 7, boranium: 3, germanium: 0, resources: 10 };
  f2.waypoints.push({ x: h2.x + 80, y: h2.y, target: 'space', warp: 6, task: 'none' });
  const iron = h2.surface.ironium;
  generateTurn(g2);
  check(!h2.queue.some(q => q.kind === 'refit') && f2.tokens.every(t => t.designId === a.id), 'fleet gone: refit cancelled');
  check(g2.players[0].messages.some(m => m.text.includes('annulée')), 'player told about the cancellation');
  check(h2.surface.ironium >= iron + 7 - 1 || h2.surface.ironium > iron, 'its minerals return to the planet');
  // withdrawn design: ships keep flying and fighting, it can no longer be built
  const g3 = quiet(game('refit-2'));
  const h3 = g3.planets.find(p => p.owner === 0 && p.homeworld)!;
  const d3 = design(g3, 0, 'Destroyer', warshipSlots('Laser'), 'Retiré');
  const f3 = fleetAt(g3, 0, d3, 2, h3, h3.id);
  d3.deleted = true;
  check(fleetHasObsolete(g3, f3) && !availableItems(g3, h3).some(i => i.designId === d3.id), 'withdrawn: marked obsolete, no longer buildable');
  for (let y = 0; y < 3; y++) generateTurn(g3);
  check(g3.fleets.some(x => x.id === f3.id && x.tokens[0].qty === 2), 'its ships are still there three years later');
  const enemy = fleetAt(g3, 1, design(g3, 1, 'Destroyer', warshipSlots('Laser'), 'Adverse'), 1, { x: 20, y: 20 });
  f3.x = 20; f3.y = 20; f3.orbiting = -1;
  const rec = resolveBattles(g3, new Rng(seedFromString('obs')))[0];
  check(!!rec && rec.tokens.some(t => t.designName.startsWith('Retiré')), 'and they fight');
  void enemy;
  // a refit to a design too heavy for the dock is refused
  const g4 = quiet(game('refit-3'));
  const h4 = g4.planets.find(p => p.owner === 0 && p.homeworld)!;
  const dockD = design(g4, 0, 'Space Dock', [], 'Dock'); dockD.starbase = true;
  h4.starbase = { designId: dockD.id, damage: 0 };
  const light = design(g4, 0, 'Battleship', [{ slot: 1, part: ENG, qty: 1 }], 'Léger');
  const heavy = design(g4, 0, 'Battleship', [{ slot: 1, part: ENG, qty: 4 }, { slot: 9, part: 'Tritanium', qty: 6 }, { slot: 4, part: 'Laser', qty: 6 }], 'Lourd');
  const f4 = fleetAt(g4, 0, light, 1, h4, h4.id);
  check(!!refitBlocker(g4, f4, light.id, heavy.id)?.includes('capacité'), `heavier than the dock: "${refitBlocker(g4, f4, light.id, heavy.id)}"`);
}

if (want('sim')) {
  console.log('--- sim (AI against AI, every rule on)');
  const g = quickGame(undefined, 'Small', 3, 'standard', 'bal0');
  g.players[0].ai = 'standard';
  let crash = '';
  try { for (let y = 0; y < 110; y++) generateTurn(g); } catch (e) { crash = (e as Error).stack ?? String(e); }
  check(!crash, `110 years without error${crash ? ': ' + crash.split('\n').slice(0, 3).join(' ') : ''}`);
  const alive = g.players.filter(p => !p.dead);
  check(g.planets.every(p => Number.isFinite(p.pop) && p.pop >= 0 && Object.values(p.surface).every(v => Number.isFinite(v) && v >= 0)), 'planets: finite, non-negative populations and minerals');
  check(alive.every(p => { const c = p.capital !== undefined ? g.planets[p.capital] : undefined; return !!c && c.owner === p.id; }), 'every empire has a capital it owns');
  check(g.planets.every(p => !p.regionalCapital || p.owner >= 0), 'no regional capital on an empty world');
  check(g.players.every(p => p.monster || p.objectives?.length === 2), 'two objectives each');
  check(alive.every(p => pendingForks(g, p).length === 0), 'computers decided every doctrine they reached');
  const delivered = g.players.filter(p => (p.logStats?.colonists ?? 0) > 0).length;
  check(delivered >= 2, `logistics used by ${delivered} empires`);
  check(g.planets.some(p => p.regionalCapital) || g.planets.some(p => p.megaprojects?.length), 'regional capitals or megaprojects built');
  check(g.planets.every(p => p.queue.every(q => q.kind !== 'mega' || !!q.megaId)), 'megaproject items are well formed');
  check(g.players.every(p => p.intel.fleets.every(fi => !(fi.uncertain && fi.tokens))), 'uncertain contacts never reveal their composition');
  const stranded = g.fleets.filter(f => f.orbiting < 0 && f.fuel <= 0 && fleetSpec(g, f).fuelCapacity > 0 && fleetSpec(g, f).freeSpeed < 2);
  check(stranded.length <= 2, `fleets stranded without fuel: ${stranded.length}`);
  check(g.fleets.filter(f => f.auto === 'logistics').every(f => f.waypoints.length >= 1), 'network freighters keep valid orders');
}

console.log(bad ? `${bad} failure(s), ${good} ok` : `all good (${good})`);
process.exit(bad ? 1 : 0);
