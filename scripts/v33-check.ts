// Constellations 3.3 checks: culture, territory, assimilation, cultural buildings (run: npx tsx scripts/v33-check.ts).
import { quickGame, newFleet } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import type { GameState, Planet } from '../src/engine/types';
import { radiusOf, radius, cultureGain, territoryOwner, colonyBlocker, runCulture, assimilation, initCulture, RADIUS_MAX, ASSIM_NEEDED, CORE_RADIUS, miningBlocker, beaconBlocker, plantBeacon, beaconAt, BEACON_RADIUS, beaconAllowance, ensureBeaconCarrier } from '../src/engine/culture';
import { fleetSpec } from '../src/engine/fleet';
import { remoteMining, processWaypointTask, mergeFleets } from '../src/engine/tasks';
import { resolveBattles, simulateBattle } from '../src/engine/battle';
import { Rng } from '../src/engine/rng';
import { autoDesign } from '../src/engine/design';
import { addDesign } from '../src/engine/newgame';
import { colonize } from '../src/engine/tasks';
import { setRule } from '../src/engine/rules';
import { runProduction } from '../src/engine/production';
import { distance } from '../src/engine/fleet';
import { unitCost, availableItems } from '../src/engine/production';
import { refitTargets } from '../src/engine/refit';
import { designCost, specOf } from '../src/engine/design';
import { HULLS as HULLS_ } from '../src/engine/tech';
import { resolveGoal, goalReached } from '../src/engine/goals';
import { goalTarget } from '../src/engine/research';
import { AUTO_EXPLORE, WORMHOLE_NAV, specialReq, canAutoExplore, ensureSpecialShift } from '../src/engine/specials';
import { MEGAPROJECTS } from '../src/engine/megaprojects';

let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
const quiet = (g: GameState) => { for (const p of g.players) if (!p.monster) p.ai = null; return g; };
/** 3.4: these checks predate negotiated diplomacy: every empire is hostile to every other, as in Stars! */
const noDiplo = (g: GameState) => { g.settings.diplomacy = false; g.diplomacy = undefined; for (const p of g.players) for (const o of g.players) if (p.id !== o.id && !p.monster && !o.monster) p.relations[o.id] = 'enemy'; return g; };
const game = (seed: string) => noDiplo(quiet(quickGame(undefined, 'Small', 3, 'standard', seed)));
const own = (g: GameState, pl: Planet, owner: number, pop: number, culture: number) => { pl.owner = owner; pl.pop = pop; pl.culture = culture; pl.cultureOwner = owner; pl.colonizedYear = g.year - 30; pl.cultureGrace = undefined; pl.queue = []; };

console.log('--- radiance');
check(radiusOf(0) === 16 && radiusOf(100) > radiusOf(50) && radiusOf(1e6) === RADIUS_MAX, `radius grows like a square root and stops at ${RADIUS_MAX} al (0 → ${radiusOf(0)}, 100 → ${radiusOf(100).toFixed(0)}, 1000 → ${radiusOf(1000).toFixed(0)})`);
const g = game('cul-1');
check(!!g.settings.culture, 'culture on in new games');
const hw = g.planets.find(p => p.owner === 0 && p.homeworld)!;
check(Math.abs(radius(hw) - radiusOf(60)) < 0.01 && radius(hw) > 40 && radius(hw) < 60, `a homeworld starts with ${radius(hw).toFixed(0)} al`);
const g10 = cultureGain(g, hw);
check(g10.capital === 3 && g10.pop > 1, `homeworld: +${g10.total.toFixed(1)} a year (population ${g10.pop.toFixed(1)}, capital ${g10.capital})`);

console.log('--- territory');
const hw1 = g.planets.find(p => p.owner === 1 && p.homeworld)!;
hw.culture = 600; // a few decades of history: about 58 al
check(territoryOwner(g, hw) === 0 && territoryOwner(g, hw1) === 1, 'each homeworld holds its own space');
const free = g.planets.filter(p => p.owner < 0).sort((a, b) => distance(a, hw) - distance(b, hw));
const nearMine = free.find(p => distance(p, hw) < radius(hw) - 2)!;
const farAway = free.find(p => g.players.every(o => o.monster || g.planets.filter(q => q.owner === o.id).every(q => distance(q, p) > radius(q) + 5)))!;
check(!!nearMine && territoryOwner(g, nearMine) === 0 && colonyBlocker(g, g.players[1], nearMine) === 0 && colonyBlocker(g, g.players[0], nearMine) === null, `${nearMine?.name} (${distance(nearMine, hw).toFixed(0)} al from the homeworld): ours, closed to the others`);
check(!!farAway && territoryOwner(g, farAway) === -1 && colonyBlocker(g, g.players[1], farAway) === null, `${farAway?.name}: neutral, open to all`);
// colonizing inside another's territory fails, in neutral space it works
const colD = g.designs.find(d => d.owner === 1 && d.purpose === 'colonizer')!;
const arkA = newFleet(g, g.players[1], colD.id, 1, hw1);
arkA.x = nearMine.x; arkA.y = nearMine.y; arkA.orbiting = nearMine.id; arkA.cargo.colonists = 25;
check(!colonize(g, arkA, nearMine) && nearMine.owner < 0 && g.players[1].messages.some(m => m.text.includes('territoire des')), 'an ark of another empire is refused, with the reason');
const arkB = newFleet(g, g.players[1], colD.id, 1, hw1);
arkB.x = farAway.x; arkB.y = farAway.y; arkB.orbiting = farAway.id; arkB.cargo.colonists = 25;
check(colonize(g, arkB, farAway) && farAway.owner === 1, 'in neutral space it settles');
// the core of a colonized world is irreducible
const tiny = free.find(p => p !== nearMine && distance(p, hw) < radius(hw) - 3 && p.owner < 0)!;
own(g, tiny, 1, 2500, 5);
check(territoryOwner(g, tiny) === 1 && territoryOwner(g, { x: tiny.x + CORE_RADIUS * 0.9, y: tiny.y }) === 1, `a small foreign colony inside our territory keeps its ${CORE_RADIUS} al core`);

console.log('--- assimilation');
const g2 = game('cul-2');
const cap = g2.planets.find(p => p.owner === 0 && p.homeworld)!;
cap.culture = 4000; // a big old culture (radius 90)
const cand = g2.planets.filter(p => p.owner < 0 && distance(p, cap) < 70).sort((a, b) => distance(a, cap) - distance(b, cap));
const victim = cand[0], other = cand[1];
own(g2, victim, 1, 20000, 10);
own(g2, other, 0, 60000, 300);
const a0 = assimilation(g2, victim);
check(a0.by === 0 && a0.ratio > 2 && a0.rate > 0, `${victim.name}, colony of the ${g2.players[1].name} ${distance(victim, cap).toFixed(0)} al from our capital: our culture ${a0.ratio.toFixed(1)}× theirs, ${a0.rate.toFixed(2)} pt/yr, ≈ ${a0.years} years`);
let y = 0;
while (victim.owner === 1 && y < 80) { g2.year++; for (const p of g2.players) p.messages = []; runCulture(g2); y++; }
check(victim.owner === 0 && y >= 10 && y <= 60, `turned after ${y} years (a few decades)`);
check(victim.pop === 20000 && (victim.cultureGrace ?? 0) > g2.year, 'its population follows, with years of grace before it could turn again');
check(g2.players[0].stats.culturalGains === 1, 'counted');
// a capital never turns
const capB = g2.planets.find(p => p.owner === 1 && p.homeworld)!;
check(assimilation(g2, capB).immune === 'capitale', 'capitals are immune');
// a station in orbit halves the pace
const v2 = g2.planets.filter(p => p.owner < 0 && distance(p, cap) < 80 && p !== other)[0];
own(g2, v2, 1, 20000, 10);
const r1 = assimilation(g2, v2).rate;
v2.starbase = { designId: g2.designs.find(d => d.owner === 1 && d.starbase)!.id, damage: 0 };
check(Math.abs(assimilation(g2, v2).rate - r1 / 2) < 1e-9 && r1 > 0, `a station in orbit halves it (${r1.toFixed(2)} → ${(r1 / 2).toFixed(2)})`);
// grace after a conquest
v2.starbase = null;
v2.conqueredYear = g2.year + 1; v2.owner = 2; g2.year++;
runCulture(g2);
check((v2.cultureGrace ?? 0) >= g2.year + 20 && assimilation(g2, v2).rate === 0, 'a world just conquered gets years of grace');

console.log('--- cultural buildings and patronage');
const g3 = game('cul-3');
const h3 = g3.planets.find(p => p.owner === 0 && p.homeworld)!;
const me3 = g3.players[0];
me3.tech.biotechnology = 4;
h3.queue = [{ kind: 'culture', cultureId: 'center', qty: 1, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }, { kind: 'patronage', qty: 2, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }];
h3.surface.ironium += 500; h3.surface.germanium += 500;
const c0 = h3.culture!;
for (let i = 0; i < 25 && h3.queue.length; i++) runProduction(g3, h3, () => {});
check((h3.cultureBld ?? []).includes('center'), 'a Centre culturel is built');
check(Math.abs(h3.culture! - (c0 + 6)) < 1e-9 && h3.queue.length === 0, `patronage: 2 × 100 R → +6 culture points (${c0} → ${h3.culture})`);
check(cultureGain(g3, h3).buildings === 2, 'the centre adds 2 a year');

console.log('--- rule switched on during a game');
const g4 = game('cul-4');
setRule(g4, 'culture', false);
for (let i = 0; i < 30; i++) generateTurn(g4);
check(colonyBlocker(g4, g4.players[1], g4.planets.find(p => p.owner === 0 && p.homeworld)!) === null, 'rule off: no territory');
setRule(g4, 'culture', true);
const h4 = g4.planets.find(p => p.owner === 0 && p.homeworld)!;
check(radius(h4) > radiusOf(60), `switched on at year 30: the homeworld's radiance reflects its history (${radius(h4).toFixed(0)} al)`);
initCulture(g4);

console.log('--- a whole game');
const g5 = quickGame(undefined, 'Small', 3, 'standard', 'cul-5');
g5.players[0].ai = 'standard';
let illegal = 0;
for (let i = 0; i < 80; i++) {
  const before = new Map(g5.planets.map(p => [p.id, p.owner]));
  const terr = new Map(g5.planets.filter(p => p.owner < 0).map(p => [p.id, territoryOwner(g5, p)]));
  generateTurn(g5);
  for (const p of g5.planets) if (before.get(p.id)! < 0 && p.owner >= 0) { const t = terr.get(p.id)!; if (t >= 0 && t !== p.owner) illegal++; }
}
check(illegal === 0, 'in 80 years of AI play, no colony was founded in another empire\'s territory');
const blds = g5.planets.reduce((a, p) => a + (p.cultureBld ?? []).length, 0);
check(blds > 0, `the AIs build cultural buildings (${blds})`);

console.log('--- remote mining in foreign territory');
{
  const g6 = game('cul-6');
  const hw6 = g6.planets.find(p => p.owner === 1 && p.homeworld)!;
  hw6.culture = 800;
  const spot = g6.planets.filter(p => p.owner < 0 && territoryOwner(g6, p) === 1).sort((a, b) => distance(a, hw6) - distance(b, hw6))[0];
  const me6 = g6.players[0];
  me6.relations[1] = 'friend';
  check(miningBlocker(g6, me6, spot) === 1, `friends: no mining in their territory (${spot.name})`);
  me6.relations[1] = 'neutral';
  check(miningBlocker(g6, me6, spot) === null, 'neutral: allowed');
  me6.relations[1] = 'enemy';
  check(miningBlocker(g6, me6, spot) === null, 'at war: allowed');
  // in the turn: a miner of a friend does not dig
  me6.relations[1] = 'friend';
  me6.tech.construction = 6; me6.tech.electronics = 3;
  const md = addDesign(g6, { ...autoDesign(me6, 'Mini-Miner', 'miner', 'Foreuse')!, name: 'Foreuse T' });
  const miner = newFleet(g6, me6, md.id, 1, g6.planets.find(p => p.owner === 0)!);
  miner.x = spot.x; miner.y = spot.y; miner.orbiting = spot.id; miner.prevX = spot.x; miner.prevY = spot.y;
  miner.waypoints = [{ x: spot.x, y: spot.y, target: 'planet', targetId: spot.id, warp: 0, task: 'remoteMine', processed: false }];
  const before = { ...spot.surface };
  remoteMining(g6, false);
  check(spot.surface.ironium === before.ironium && fleetSpec(g6, miner).miningRate > 0, 'the miner of a friend extracts nothing');
  me6.relations[1] = 'enemy';
  remoteMining(g6, false);
  check(spot.surface.ironium > before.ironium, 'at war it digs');
}

console.log('--- sovereignty beacons');
{
  const g7 = game('cul-7');
  const p0 = g7.players[0];
  p0.tech.construction = 4; p0.tech.electronics = 2; p0.tech.weapons = 4;
  const car = ensureBeaconCarrier(g7, p0);
  check(!!car && car.slots.some(x => x.part === 'Sovereignty Beacon'), `a Porte-balise design is made once the kit is known (${car?.name})`);
  const hw7 = g7.planets.find(p => p.owner === 0 && p.homeworld)!;
  const target = g7.planets.filter(p => p.owner < 0 && territoryOwner(g7, p) === -1 && !g7.guardians?.some(x => x.alive && x.planetId === p.id)).sort((a, b) => distance(a, hw7) - distance(b, hw7))[0];
  const ship = newFleet(g7, p0, car!.id, 2, hw7);
  ship.x = target.x; ship.y = target.y; ship.orbiting = target.id;
  ship.waypoints = [{ x: target.x, y: target.y, target: 'planet', targetId: target.id, warp: 0, task: 'beacon', processed: false }];
  check(beaconBlocker(g7, ship, target) === null, `${target.name} (neutral) can be claimed`);
  processWaypointTask(g7, ship, new Rng([1, 2, 3, 4]));
  const b = beaconAt(g7, target.id)!;
  check(!!b && b.owner === 0 && ship.tokens[0].qty === 1, 'the beacon stands, one carrier used up');
  check(territoryOwner(g7, target) === 0 && territoryOwner(g7, { x: target.x + BEACON_RADIUS - 3, y: target.y }) === 0, `the world and ${BEACON_RADIUS} al around are claimed`);
  check(colonyBlocker(g7, g7.players[1], target) === 0, 'another empire cannot settle there');
  check(fleetSpec(g7, b).hasWeapons && !fleetSpec(g7, b).hasEngines, 'an armed fort that never moves');
  check(!mergeFleets(g7, ship, b, true) && g7.fleets.includes(b), 'cannot be merged into a fleet');
  const ship2 = newFleet(g7, p0, car!.id, 1, hw7); ship2.x = target.x; ship2.y = target.y; ship2.orbiting = target.id;
  check(beaconBlocker(g7, ship2, target) === 'votre balise y est déjà', 'one beacon per world');
  // the beacon fights an enemy warship that stops there
  g7.players[1].relations[0] = 'enemy'; p0.relations[1] = 'enemy';
  const p1 = g7.players[1];
  p1.tech.weapons = 10; p1.tech.construction = 10; p1.tech.propulsion = 8; p1.tech.energy = 8;
  const wd = addDesign(g7, { ...autoDesign(p1, 'Destroyer', 'beamWarship', 'Briseur')!, name: 'Briseur T' });
  const raid = newFleet(g7, p1, wd.id, 6, g7.planets.find(p => p.owner === 1)!);
  raid.x = target.x; raid.y = target.y; raid.orbiting = target.id; raid.waypoints = [{ x: target.x, y: target.y, target: 'planet', targetId: target.id, warp: 0, task: 'none', processed: true }];
  let rounds = 0;
  while (beaconAt(g7, target.id) && rounds < 6) { resolveBattles(g7, new Rng([rounds + 3, 5, 7, 11])); g7.fleets = g7.fleets.filter(f => f.tokens.length); rounds++; }
  check(!beaconAt(g7, target.id), `six destroyers bring it down (${rounds} battle(s))`);
  check(colonyBlocker(g7, p1, target) === null || territoryOwner(g7, target) !== 0, 'then the world is open again');
  // the owner settling the world turns the beacon into its station
  const g8 = game('cul-8');
  const q0 = g8.players[0];
  q0.tech.construction = 4; q0.tech.electronics = 2;
  const car8 = ensureBeaconCarrier(g8, q0)!;
  const hw8 = g8.planets.find(p => p.owner === 0 && p.homeworld)!;
  const t8 = g8.planets.filter(p => p.owner < 0 && territoryOwner(g8, p) === -1 && !g8.guardians?.some(x => x.alive && x.planetId === p.id)).sort((a, b) => distance(a, hw8) - distance(b, hw8))[0];
  const s8 = newFleet(g8, q0, car8.id, 1, hw8); s8.x = t8.x; s8.y = t8.y; s8.orbiting = t8.id;
  const b8 = plantBeacon(g8, s8, t8)!;
  const colD = g8.designs.find(d => d.owner === 0 && d.purpose === 'colonizer')!;
  const ark = newFleet(g8, q0, colD.id, 1, hw8); ark.x = t8.x; ark.y = t8.y; ark.orbiting = t8.id; ark.cargo.colonists = 25;
  check(colonize(g8, ark, t8) && t8.owner === 0 && !g8.fleets.includes(b8) && t8.starbase?.designId === b8.tokens[0].designId, 'settling the claimed world: the beacon becomes its station');
  // allowance
  check(beaconAllowance(g8, q0) >= 2, `beacons allowed: ${beaconAllowance(g8, q0)} (one per colony, at least two)`);
}

console.log('--- research goals beyond components (3.3.2), automatic exploration on the hidden tree (3.3.3)');
{
  const gg = game('goal-1');
  const pg = gg.players[0];
  check(AUTO_EXPLORE.level === 9 && AUTO_EXPLORE.req.electronics === 9 && AUTO_EXPLORE.fuzzy === true, 'automatic exploration: Électronique 9 (3.6), on the hidden tree');
  check(!!gg.settings.fuzzyTechTree && pg.techShift !== undefined && AUTO_EXPLORE.name in pg.techShift, `new game: hidden shift drawn (${pg.techShift?.[AUTO_EXPLORE.name]})`);
  const need = specialReq(pg, AUTO_EXPLORE).electronics!;
  check(need >= 7 && need <= 11, `level needed in this game: ${need}`);
  pg.tech.electronics = need - 1;
  check(!canAutoExplore(pg), 'one level short: not yet');
  pg.tech.electronics = need;
  check(canAutoExplore(pg), 'at the drawn level: available');
  // the draw: same odds as a component, from the seed, the same for old saves
  const seen = new Map<number, number>();
  for (let i = 0; i < 400; i++) { const gx = { settings: { fuzzyTechTree: true, seed: 'sh' + i }, players: [{ techShift: {} }] } as any; ensureSpecialShift(gx); const d = gx.players[0].techShift[AUTO_EXPLORE.name]; seen.set(d, (seen.get(d) ?? 0) + 1); }
  check([-2, -1, 0, 1, 2].every(d => (seen.get(d) ?? 0) > 15) && (seen.get(0) ?? 0) > (seen.get(2) ?? 0), `shifts over 400 games: ${[-2, -1, 0, 1, 2].map(d => `${d}:${seen.get(d) ?? 0}`).join(' ')}`);
  const old = game('goal-1');
  for (const p of old.players) if (p.techShift) delete p.techShift[AUTO_EXPLORE.name];
  generateTurn(old);
  check(old.players[0].techShift![AUTO_EXPLORE.name] === pg.techShift![AUTO_EXPLORE.name], 'a save from before 3.3.3 gets the same draw on its next turn');
  // without the hidden tree: exactly 9
  const gn = game('goal-2'); gn.settings.fuzzyTechTree = false; for (const p of gn.players) p.techShift = undefined;
  const pn = gn.players[0]; pn.tech.electronics = 8;
  check(!canAutoExplore(pn) && (pn.tech.electronics = 9, canAutoExplore(pn)), 'fixed tree: exactly Électronique 9');
  pn.tech.electronics = 5;
  check(JSON.stringify(goalTarget(gn, pn, resolveGoal(gn, AUTO_EXPLORE.name)!)) === JSON.stringify({ electronics: 9 }), 'fixed tree: the goal aims at 9 exactly');
  // goal on the hidden tree: aims at the most likely level, research steered to Électronique
  pg.tech.electronics = 5; pg.tech.propulsion = 2;
  const it = resolveGoal(gg, AUTO_EXPLORE.name)!;
  check(!!it && it.kind === 'special' && !it.exact, 'on the hidden tree the goal works by odds, like a component');
  const tg = goalTarget(gg, pg, it)!;
  check(tg.electronics! >= 8 && tg.electronics! <= 10 && Object.keys(tg).length === 1, `goal target: ${JSON.stringify(tg)}`);
  pg.researchGoal = AUTO_EXPLORE.name; pg.researching = 'weapons';
  generateTurn(gg);
  check(pg.researching === 'electronics' || canAutoExplore(pg), `research steered to ${pg.researching}`);
  const wn = resolveGoal(gg, WORMHOLE_NAV.name)!;
  pg.tech.propulsion = 10; pg.tech.electronics = 5;
  check(wn.exact === true && !goalReached(pg, wn) && JSON.stringify(goalTarget(gg, pg, wn)) === JSON.stringify({ electronics: 10 }), 'wormhole navigation stays fixed: only the missing field is aimed at');
  pg.tech.electronics = 10;
  check(goalReached(pg, wn), 'reached once every field is there');
  pg.researchGoal = WORMHOLE_NAV.name; pg.messages = [];
  generateTurn(gg);
  check(pg.researchGoal === undefined && pg.messages.some(m => m.text.includes('Objectif atteint') && m.text.includes(WORMHOLE_NAV.name)), 'goal cleared with a message once reached');
  const mg = resolveGoal(gg, MEGAPROJECTS[0].name)!;
  check(!!mg && mg.kind === 'mega', `a megaproject resolves as a goal (${MEGAPROJECTS[0].name})`);
}

console.log('--- combat simulator against stations (3.3.6)');
{
  const gs = game('simsb');
  const ms = gs.players[0];
  Object.assign(ms.tech, { energy: 6, weapons: 8, propulsion: 6, construction: 8, electronics: 5, biotechnology: 3 });
  const sb = gs.designs.find(d => d.owner === 0 && d.starbase && gs.planets.some(p => p.starbase?.designId === d.id))!;
  const ds = addDesign(gs, { ...autoDesign(ms, 'Destroyer', 'beamWarship', 'Destroyer T')! });
  const few = simulateBattle(gs, 0, [{ design: ds, qty: 1 }], [], 20, undefined, ms.battlePlans[0], 'a', { side: 1, design: sb });
  const many = simulateBattle(gs, 0, [{ design: ds, qty: 20 }], [], 20, undefined, ms.battlePlans[0], 'b', { side: 1, design: sb });
  check(few.winB > few.winA && many.winA > many.winB, `attacking a station: 1 destroyer ${few.winA}/20, 20 destroyers ${many.winA}/20`);
  check(many.lostB <= 1 && many.costLostB > 0, `the station counts as one loss (${many.lostB.toFixed(2)}, ${Math.round(many.costLostB)} R)`);
  const def = simulateBattle(gs, 0, [], [{ design: ds, qty: 1 }], 20, undefined, ms.battlePlans[0], 'c', { side: 0, design: sb });
  check(def.winA > def.winB, `defending station beats a lone destroyer (${def.winA}/20)`);
  check(gs.planets.every(p => p.id !== 0 || p.name !== 'la station'), 'the real game is untouched');
}

console.log('--- a new station on a world that has one is an upgrade (3.3.7 check)');
{
  const gu = game('sbup');
  const pu = gu.players[0];
  Object.assign(pu.tech, { energy: 10, weapons: 10, propulsion: 10, construction: 10, electronics: 10, biotechnology: 10 });
  const hwu = gu.planets.find(p => p.owner === 0 && p.homeworld)!;
  const old = gu.designs.find(d => d.id === hwu.starbase!.designId)!;
  const hull = HULLS_.get(old.hull)!;
  const free = hull.slots.findIndex((sl, i) => sl.types.includes('Orbital') && !old.slots.some(x => x.slot === i + 1));
  const nd = addDesign(gu, { ...JSON.parse(JSON.stringify(old)), id: -1, name: 'Station portail', slots: [...old.slots.map(x => ({ ...x })), { slot: free + 1, part: 'Stargate 100-250', qty: 1 }], built: 0 });
  const item = { kind: 'starbase', designId: nd.id, qty: 1, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } } as any;
  const up = unitCost(gu, hwu, pu, item), full = designCost(pu, nd), gate = designCost(pu, { hull: old.hull, slots: [{ slot: free + 1, part: 'Stargate 100-250', qty: 1 }], starbase: true });
  check(up.resources < full.resources / 2 && up.resources <= gate.resources, `adding a gate: ${up.resources} R instead of ${full.resources} R for a new station (gate alone in the design ${gate.resources - designCost(pu, { hull: old.hull, slots: [], starbase: true }).resources} R)`);
  const armor0 = specOf(gu, old.id).armor;
  hwu.starbase!.damage = Math.round(armor0 * 0.6);
  hwu.queue = [item];
  hwu.surface = { ironium: 1e5, boranium: 1e5, germanium: 1e5 };
  let always = true, years = 0;
  while (hwu.starbase?.designId !== nd.id && years < 12) { generateTurn(gu); years++; if (!hwu.starbase) always = false; }
  check(hwu.starbase?.designId === nd.id && always, `upgraded in place after ${years} year(s), the old station serving until then`);
}

console.log('--- designs one cannot reproduce are never built (3.3.8)');
{
  const ga = game('alien');
  const pa = ga.players[0];
  const hwa = ga.planets.find(p => p.owner === 0 && p.homeworld)!;
  const base = ga.designs.find(d => d.owner === 0 && !d.starbase && !d.deleted)!;
  const wreck = addDesign(ga, { ...JSON.parse(JSON.stringify(base)), id: -1, name: 'Épave restaurée', alien: true, built: 0 });
  wreck.alien = true;
  check(!availableItems(ga, hwa).some(it => it.designId === wreck.id), 'a restored wreck is not offered in production');
  hwa.queue = [{ kind: 'ship', designId: wreck.id, qty: 1, allocated: { ironium: 5, boranium: 0, germanium: 0, resources: 0 } } as any];
  generateTurn(ga);
  check(!hwa.queue.some(q => q.designId === wreck.id) && !ga.fleets.some(f => f.owner === 0 && f.tokens.some(t => t.designId === wreck.id)), 'a wreck already in a queue is dropped, not built');
  check(refitTargets(ga, pa, base.id).every(d => !d.alien), 'nor a refit target');
}

console.log(bad ? `${bad} failure(s), ${good} ok` : `all good (${good})`);
process.exit(bad ? 1 : 0);
