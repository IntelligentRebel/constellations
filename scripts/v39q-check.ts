// Constellations 0.3.9.21 checks: the bugs found by the full review of the code, each one held down
// (run: npx tsx scripts/v39q-check.ts).
import { quickGame, addDesign, newFleet } from '../src/engine/newgame';
import { PREDEFINED_RACES, sanitizeRace, advantagePoints } from '../src/engine/race';
import { resolveBattles } from '../src/engine/battle';
import { battleTechTrades } from '../src/engine/techtrade';
import { autoDesign, designSpec, specOf } from '../src/engine/design';
import { fleetSpec, estimateRoute, damageEvery } from '../src/engine/fleet';
import { betterPart, upgradeDesigns } from '../src/engine/upgrade';
import { setOperation, runOperations } from '../src/engine/operations';
import { canBuildShip } from '../src/engine/production';
import { queueRefit, applyRefit } from '../src/engine/refit';
import { ownPositions } from '../src/engine/intercept';
import * as MV from '../src/engine/movement';
import { researchPerYear, generateTurn } from '../src/engine/turn';
import { prospectiveMaxPop, maxPopulation } from '../src/engine/planet';
import { TECHS } from '../src/engine/tech';
import { sourcesKey } from '../src/engine/culture';
import { studyBlockerSeen } from '../src/engine/anomalies';
import { Rng, seedFromString } from '../src/engine/rng';
import type { GameState } from '../src/engine/types';

let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

const level = { energy: 5, weapons: 6, propulsion: 5, construction: 5, electronics: 5, biotechnology: 5 };
function arena(seed: string, n: number, opts: Record<string, unknown> = {}) {
  const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Tiny', n, 'standard', seed, opts as any);
  g.fleets = [];
  for (const p of g.players) { p.ai = null; p.tech = { ...level }; }
  const hw = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const put = (pid: number, qty: number, purpose: any = 'beamWarship', hull = 'Destroyer') => {
    const d = addDesign(g, autoDesign(g.players[pid], hull, purpose, `D${pid}${purpose}`)!);
    const f = newFleet(g, g.players[pid], d.id, qty, hw);
    f.x = 333.3; f.y = 222.2; f.orbiting = -1; f.waypoints = [{ x: f.x, y: f.y, target: 'space', warp: 0, task: 'none' }];
    return f;
  };
  return { g, hw, put };
}

console.log('--- battles: each empire is credited with what it destroyed, and learns only from those it fought');
{
  // 0 and 1 at war; 2, at peace with both, has an armed fleet parked there
  const { g, put } = arena('q-kc', 2, { veterans: true });
  g.diplomacy!.pairs['0-1'].status = 'war';
  put(0, 6); put(1, 2); const by = put(2, 2);
  const [r] = resolveBattles(g, new Rng(seedFromString('r')));
  const lost1 = r.losses[1] ?? 0;
  check(lost1 > 0, `the battle took place (${lost1} ships of empire 1 lost)`);
  check(g.players[2].stats.shipsDestroyed === 0, `the bystander is credited with nothing (${g.players[2].stats.shipsDestroyed})`);
  check(g.players[0].stats.shipsDestroyed === lost1, `the victor is credited with the losses it inflicted (${g.players[0].stats.shipsDestroyed} = ${lost1})`);
  check(!by.battles && !by.xp, `the bystander's fleet gains no experience (battles ${by.battles ?? 0}, xp ${by.xp ?? 0})`);
  const t2 = g.players[2].messages.filter(m => m.kind === 'battle').map(m => m.text)[0] ?? '';
  check(/0 vaisseaux adverses détruits/.test(t2), `its report counts no enemy losses ("${t2}")`);
}
{
  // allies 0 and 2 against 1: 2's ships ahead in technology; 0 must not learn from its ally's ships
  const zero = { energy: 0, weapons: 0, propulsion: 0, construction: 0, electronics: 0, biotechnology: 0 };
  let tries = 0, fromAlly = 0;
  for (let k = 0; k < 20; k++) {
    const { g, put } = arena('q-ta' + k, 3);
    for (const p of g.players) p.tech = { ...zero };
    g.players[2].tech = { ...zero, weapons: 10, construction: 9, propulsion: 7, energy: 6, electronics: 6 };
    const D = g.diplomacy!.pairs;
    D['0-1'].status = 'war'; D['1-2'].status = 'war'; D['0-2'].status = 'alliance';
    put(0, 2, 'armedScout', 'Scout'); put(1, 2, 'armedScout', 'Scout'); put(2, 2, 'beamWarship', 'Cruiser');
    g.battles = resolveBattles(g, new Rng(seedFromString('b' + k)));
    if (!g.battles.length) continue;
    tries++;
    const before = JSON.stringify(g.players[0].tech);
    battleTechTrades(g);
    if (JSON.stringify(g.players[0].tech) !== before) fromAlly++;
  }
  check(tries > 5 && fromAlly === 0, `no technology learned from an ally's ships (${fromAlly} in ${tries} battles)`);
}

console.log('--- stations decide to fire with the plan they fight with');
{
  const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Tiny', 1, 'standard', 'q-stp');
  g.fleets = [];
  g.diplomacy!.pairs['0-1'].status = 'war';
  const hw = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const foe = g.players[1];
  const f = newFleet(g, foe, addDesign(g, autoDesign(foe, 'Scout', 'scout', 'Spy')!).id, 1, hw);
  g.players[0].battlePlans[0].primary = 'none';
  const recs = resolveBattles(g, new Rng(seedFromString('x')));
  check(specOf(g, hw.starbase!.designId).hasWeapons, 'the homeworld station is armed');
  // (the scout starts out of the station's reach and slips away: what matters is that the station engages)
  check(recs.length === 1 && recs[0].players.includes(0), `with a default plan aiming at nothing, the station still engages an enemy in orbit (battles ${recs.length}${g.fleets.includes(f) ? '' : ', scout destroyed'})`);
}

console.log('--- designs: doctrine cloak, Retro Bomb, upgrades followed by operations and refits');
{
  const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Tiny', 1, 'standard', 'q-ewar', { doctrines: true } as any);
  const me = g.players[g.human];
  me.tech = { energy: 4, weapons: 0, propulsion: 3, construction: 0, electronics: 6, biotechnology: 0 };
  me.doctrines = { electronics: 'b' };
  const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
  const d = addDesign(g, { id: -1, owner: me.id, name: 'S', hull: 'Scout', starbase: false, built: 0, slots: [{ slot: 1, part: 'Long Hump 6', qty: 1 }, { slot: 2, part: 'Bat Scanner', qty: 1 }] });
  const f = newFleet(g, me, d.id, 1, hw);
  check(fleetSpec(g, f).cloakPercent === designSpec(me, d).cloakPercent && fleetSpec(g, f).cloakPercent >= 10, `Guerre électronique: the fleet is as cloaked as its design says (${fleetSpec(g, f).cloakPercent} %)`);
}
check(!betterPart(TECHS.get('Retro Bomb')!, TECHS.get('M-70 Bomb')!), 'a Retro Bomb is no upgrade of an ordinary bomb');
check(betterPart(TECHS.get('M-80 Bomb')!, TECHS.get('M-70 Bomb')!), 'an M-80 still is one of the M-70');
{
  const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Tiny', 1, 'standard', 'q-upf');
  const me = g.players[g.human];
  me.tech = { energy: 3, weapons: 3, propulsion: 5, construction: 3, electronics: 3, biotechnology: 0 };
  const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
  const war = addDesign(g, { ...autoDesign(me, 'Destroyer', 'beamWarship', 'Garde')!, scout: true });
  const opf = newFleet(g, me, war.id, 1, hw);
  check(setOperation(g, opf, { kind: 'defend', planetId: hw.id, designId: war.id, target: 4 } as any) === null, 'an operation reinforced with the design');
  const other = newFleet(g, me, war.id, 1, hw);
  other.waypoints = [other.waypoints[0], { x: hw.x + 30, y: hw.y, target: 'space', warp: 5, task: 'refit', refitTo: { 999: war.id } } as any];
  me.tech.weapons = 6;
  const done = upgradeDesigns(g, me, 'Yakimora Light Phaser');
  const nd = done.find(x => x.from.id === war.id)?.to;
  check(!!nd, `the design is upgraded (${nd?.name})`);
  check(opf.op?.designId === nd?.id, 'the operation now builds the new design');
  check(other.waypoints[1].refitTo?.[999] === nd?.id, 'a refit order aimed at the old design aims at the new one');
  check(nd?.scout === true, 'the new design is still counted as a scout');
  // a withdrawn design is not ordered by an operation still aiming at it
  const opg = newFleet(g, me, nd!.id, 1, hw);
  opg.op = { kind: 'defend', planetId: hw.id, designId: war.id, target: 5, since: g.year } as any;
  const q0 = hw.queue.length;
  runOperations(g);
  check(!hw.queue.slice(0, hw.queue.length - q0 + 1).some(q => q.forOp === opg.id && q.designId === war.id), 'an operation never orders a withdrawn design');
  check(setOperation(g, opg, { kind: 'defend', planetId: hw.id, designId: war.id, target: 4 } as any) !== null, 'nor can one be given it');
}
{
  const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Tiny', 1, 'standard', 'q-rfc');
  const me = g.players[g.human];
  me.tech = { ...me.tech, construction: 3 };
  const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
  const mk = (name: string, part: string) => addDesign(g, { id: -1, owner: me.id, name, hull: 'Medium Freighter', starbase: false, built: 0, slots: [{ slot: 1, part: 'Quick Jump 5', qty: 1 }, { slot: 2, part, qty: 1 }] });
  const A = mk('Cargo', 'Cargo Pod'), B = mk('Tanker', 'Fuel Tank');
  const f = newFleet(g, me, A.id, 2, hw);
  f.cargo = { ironium: 300, boranium: 0, germanium: 0, colonists: 220 };
  const fe0 = hw.surface.ironium, pop0 = hw.pop;
  check(queueRefit(g, f, A.id, B.id, 2) === null, 'refit to a design with a smaller hold queued');
  applyRefit(g, hw, hw.queue.find(q => q.kind === 'refit')!, 2);
  const cap = fleetSpec(g, f).cargoCapacity;
  const unloadedFe = hw.surface.ironium - fe0, unloadedPop = hw.pop - pop0;
  check(unloadedFe + f.cargo.ironium === 300 && unloadedPop + f.cargo.colonists * 100 === 22000, `nothing lost: ${unloadedFe} kt and ${unloadedPop} colonists left on the world, the rest in the hold (${cap} kt)`);
}

console.log('--- movement: year-end positions through a waypoint reached as the year ends');
{
  const g: any = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 1, 'standard', 'q-own', { cataclysms: false, terrain: false, secrets: false } as any);
  const p = g.players[0];
  for (const k of Object.keys(p.tech)) p.tech[k] = 12;
  const d = addDesign(g, { id: 0, owner: 0, name: 'Eclaireur', hull: 'Scout', slots: [{ slot: 1, part: 'Long Hump 6', qty: 1 }], starbase: false, built: 0 } as any);
  const home = g.planets.find((x: any) => x.owner === 0 && x.homeworld);
  const f = newFleet(g, p, d.id, 1, home);
  g.fleets = [f];
  f.orbiting = -1; f.x = 300; f.y = 300; f.fuel = 1000;
  f.waypoints = [
    { x: 300, y: 300, target: 'space', warp: 0, task: 'none', processed: true },
    { x: 325, y: 300, target: 'space', warp: 5, task: 'none' },
    { x: 325, y: 350, target: 'space', warp: 5, task: 'none' },
  ];
  const pred = ownPositions(g, f, 3).pts.map((q: any) => `${q.x},${q.y}`);
  const real: string[] = [];
  for (let y = 1; y <= 3; y++) { MV.moveFleets(g, new Rng(seedFromString('o' + y))); real.push(`${Math.round(f.x)},${Math.round(f.y)}`); }
  check(pred.join(' ') === real.join(' '), `the planned positions are the flown ones (${pred.join(' ')} / ${real.join(' ')})`);
  check(estimateRoute(g, f).length >= 0, 'the estimate still runs');
}

console.log('--- damage spread on every ship of a stack');
{
  const t = { designId: 0, qty: 4, damage: 30, qtyDamaged: 2 };
  damageEvery(t as any, 100, 10);
  check(t.qtyDamaged === 4 && Math.abs(t.damage - 25) < 1e-9, `4 ships, 2 with 30 damage, +10 each: 4 damaged at 25 on average (${t.qtyDamaged} at ${t.damage})`);
  const u = { designId: 0, qty: 3, damage: 0, qtyDamaged: 0 };
  damageEvery(u as any, 50, 500);
  check(u.qty === 3 && u.damage === 49, `a blow beyond the armour leaves each ship at 1 point, none destroyed here (${u.qty} at ${u.damage})`);
}

console.log('--- races read from outside');
{
  const r = PREDEFINED_RACES.Humanoid();
  const x = sanitizeRace({ ...r, popEfficiency: 7.01 });
  check(typeof x !== 'string' && x.popEfficiency === 7, 'a popEfficiency of 7.01 becomes 7');
  check(typeof x !== 'string' && advantagePoints(x) === advantagePoints({ ...r, popEfficiency: 7 }), 'and costs the points of 7');
  check(typeof sanitizeRace({ ...r, prt: 'XX' }) === 'string', 'an unknown primary trait is refused');
  const y = sanitizeRace({ ...r, lrts: ['ARM', 'OBRM', 'ZZ', 'ARM'], habLow: [90, -5, 200], habHigh: [10, 50, 300], growthRate: 99 });
  check(typeof y !== 'string' && y.lrts.join() === 'OBRM' && y.habLow.join() === '10,0,100' && y.habHigh.join() === '90,50,100' && y.growthRate === 20, `traits, hab ranges and growth held to the wizard (${typeof y !== 'string' ? `${y.lrts} ${y.habLow}/${y.habHigh} ${y.growthRate}` : y})`);
}

console.log('--- research points a year, as the turn counts them');
{
  const g = quickGame({ ...PREDEFINED_RACES.Humanoid(), lrts: ['GR'] }, 'Tiny', 1, 'standard', 'q-gr');
  const me = g.players[g.human];
  me.researchLastYear = 0;
  check(researchPerYear(g, me, 200) === 100, `GR: 200 resources give 100 points to the field (${researchPerYear(g, me, 200)}), not 50`);
  me.researchLastYear = 100;
  check(researchPerYear(g, me, 100) === 100, `last year's points are not halved again (${researchPerYear(g, me, 100)})`);
}

console.log('--- the population a free world would hold, for a race living on its stations');
{
  const g = quickGame({ ...PREDEFINED_RACES.Humanoid(), prt: 'AR' }, 'Tiny', 1, 'standard', 'q-ar');
  const me = g.players[g.human];
  const free = g.planets.find(p => p.owner < 0)!;
  const best = Math.max(...g.designs.filter(d => d.owner === me.id && d.starbase).map(d => designSpec(me, d).maxPop));
  const v = prospectiveMaxPop(g, me, free, 50);
  check(v > 0 && v <= best, `from its best station (${v}, station room ${best}), not from the habitability (${maxPopulation(g, me, free, 50)})`);
}

console.log('--- texts and keys');
check(sourcesKey([{ owner: 0, id: 1, x: 10, y: 20, r: 30 }] as any) !== sourcesKey([{ owner: 0, id: 1, x: 11, y: 20, r: 30 }] as any), 'the territory cache key changes when a source moves');
{
  const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 2, 'standard', 'q-anom', { anomalies: true, guardians: true } as any);
  const me = g.players[g.human];
  const a = (g.anomalies ?? [])[0];
  if (a) {
    a.known = [me.id];
    const pl = g.planets[a.planetId];
    const owner0 = pl.owner;
    pl.owner = 1; // settled by a rival, not seen yet
    const it = me.intel.planets[pl.id];
    const seenOwner = it.owner ?? -1;
    check(seenOwner >= 0 ? studyBlockerSeen(g, me, a) !== null : studyBlockerSeen(g, me, a) === null, 'the study panel says only what the player knows of the world');
    pl.owner = owner0;
  } else check(true, '(no anomaly in this galaxy)');
}

console.log('--- play by e-mail: merges count each order once, minerals are kept');
{
  const PB = require('../src/engine/pbem') as typeof import('../src/engine/pbem');
  const { createGame, defaultSettings } = require('../src/engine/newgame') as typeof import('../src/engine/newgame');
  const mk = (seed: string) => {
    const host = createGame({ name: 'X', settings: { ...defaultSettings(), seed, size: 'Small' }, players: [
      { race: PREDEFINED_RACES.Humanoid(), ai: null }, { race: PREDEFINED_RACES.Insectoid(), ai: null, name: 'B' },
      { race: PREDEFINED_RACES.Rabbitoid(), ai: null, name: 'C' }, { race: PREDEFINED_RACES.Silicanoid(), ai: 'standard' },
    ] } as any);
    PB.startHosting(host);
    return host;
  };
  const open = (host: GameState, pid: number) => { const r = PB.readPbem(JSON.stringify(PB.turnFile(host, pid)))!; return PB.openTurn(r.file, r.game); };
  const send = (host: GameState, g: GameState) => { const r = PB.readPbem(JSON.stringify(PB.ordersFile(g)))!; return PB.mergeOrders(host, r.file, r.game); };
  {
    const host = mk('q-pb1');
    const hw = host.planets.find(p => p.owner === 1 && p.homeworld)!;
    const fl = host.fleets.find(f => f.owner === 1 && f.orbiting === hw.id)!;
    const s0 = hw.surface.ironium, c0 = fl.cargo.ironium;
    const g1 = open(host, 1);
    g1.planets[hw.id].surface.ironium -= 100; g1.fleets.find(f => f.id === fl.id)!.cargo.ironium += 100;
    send(host, g1);
    send(host, open(host, 2)); // a turn file made after that merge, no orders
    check(host.planets[hw.id].surface.ironium === s0 - 100 && host.fleets.find(f => f.id === fl.id)!.cargo.ironium === c0 + 100, 'a turn file made after a merge does not count that merge again');
  }
  {
    const host = mk('q-pb2');
    const free = host.planets.find(p => p.owner < 0)!;
    free.surface.ironium = 500; PB.prepareTurn(host);
    const g1 = open(host, 1), g2 = open(host, 2);
    const a = g1.fleets.find(f => f.owner === 1)!, b = g2.fleets.find(f => f.owner === 2)!;
    for (const f of [a, b]) { f.x = free.x; f.y = free.y; f.orbiting = free.id; }
    const a0 = a.cargo.ironium, b0 = b.cargo.ironium;
    g1.planets[free.id].surface.ironium = 0; a.cargo.ironium += 500;
    g2.planets[free.id].surface.ironium = 0; b.cargo.ironium += 500;
    send(host, g1); send(host, g2);
    const tot = host.planets[free.id].surface.ironium + host.fleets.find(f => f.id === a.id)!.cargo.ironium - a0 + host.fleets.find(f => f.id === b.id)!.cargo.ironium - b0;
    check(tot === 500, `two players loading the same 500 kt get 500 between them (${tot})`);
  }
  {
    // random orders on shared worlds (loads, unloads, cargo given to another's fleet, jettison, wreck pickup, merges
    // and splits), turn files made at any time, orders sent again: minerals are kept, never below zero
    const T = require('../src/engine/tasks') as typeof import('../src/engine/tasks');
    const { cargoMass } = require('../src/engine/fleet') as typeof import('../src/engine/fleet');
    const MM = ['ironium', 'boranium', 'germanium'] as const;
    const total = (g: GameState) => { let t = 0; for (const p of g.planets) for (const m of MM) t += p.surface[m]; for (const f of g.fleets) for (const m of MM) t += f.cargo[m]; for (const w of g.salvage ?? []) for (const m of MM) t += w.cargo[m]; return t; };
    let merges = 0, wrong = 0;
    for (let run = 0; run < 40 && !wrong; run++) {
      const rng = new Rng(seedFromString('q-pbf' + run));
      const host = mk('q-pbf' + run);
      const free = host.planets.find(p => p.owner < 0)!;
      free.surface = { ironium: 300, boranium: 200, germanium: 100 };
      const spots = [free, host.planets.find(p => p.owner === 0 && p.homeworld)!];
      for (const pid of [0, 1, 2]) host.fleets.filter(f => f.owner === pid && fleetSpec(host, f).cargoCapacity > 0).forEach((f, k) => { const at = spots[k % 2]; f.x = at.x; f.y = at.y; f.orbiting = at.id; f.waypoints = [{ x: at.x, y: at.y, target: 'planet', targetId: at.id, warp: 0, task: 'none' }]; });
      PB.prepareTurn(host);
      const T0 = total(host);
      const copies: Record<number, GameState | undefined> = {};
      for (let step = 0; step < 30; step++) {
        const pid = rng.int(3), r = rng.random();
        if (!copies[pid] || r < 0.3) { copies[pid] = open(host, pid); continue; }
        const g = copies[pid]!;
        if (r < 0.7) {
          const fl = g.fleets.filter(f => f.owner === pid && fleetSpec(g, f).cargoCapacity > 0 && f.orbiting >= 0);
          const f = fl[rng.int(Math.max(1, fl.length))]; if (!f) continue;
          const pl = g.planets[f.orbiting], m = MM[rng.int(3)], a = rng.random();
          if (a < 0.4) T.transferWithPlanet(g, f, pl, m, 1 + rng.int(200));
          else if (a < 0.75) T.transferWithPlanet(g, f, pl, m, -(1 + rng.int(200)));
          else if (a < 0.82 && cargoMass(f.cargo) > 0) { g.salvage.push({ id: g.nextId++, owner: pid, x: f.x, y: f.y, cargo: { ironium: f.cargo.ironium, boranium: f.cargo.boranium, germanium: f.cargo.germanium }, age: 0 }); f.cargo = { ...f.cargo, ironium: 0, boranium: 0, germanium: 0 }; }
          else if (a < 0.88) { const w = g.salvage.find(x => Math.abs(x.x - f.x) < 1 && Math.abs(x.y - f.y) < 1); if (w) { const k = Math.min(fleetSpec(g, f).cargoCapacity - cargoMass(f.cargo), w.cargo[m]); w.cargo[m] -= k; f.cargo[m] += k; } }
          else if (a < 0.94) { const o = g.fleets.find(x => x.owner !== pid && !g.players[x.owner].ai && Math.abs(x.x - f.x) < 1 && Math.abs(x.y - f.y) < 1 && fleetSpec(g, x).cargoCapacity > 0); if (o) T.transferBetweenFleets(g, f, o, m, 1 + rng.int(150), pid); }
          else if (a < 0.97) { const o = g.fleets.find(x => x !== f && x.owner === pid && Math.abs(x.x - f.x) < 1 && Math.abs(x.y - f.y) < 1); if (o) { T.mergeFleets(g, f, o, true); g.fleets = g.fleets.filter(x => x.tokens.length > 0); } }
          else if (f.tokens.reduce((n, t) => n + t.qty, 0) > 1) T.splitIntoSingles(g, f);
          continue;
        }
        const e = send(host, g);
        if (rng.chance(0.5)) copies[pid] = undefined;
        merges++;
        const neg = host.planets.some(p => MM.some(m => p.surface[m] < 0)) || host.fleets.some(f => MM.some(m => f.cargo[m] < 0));
        if (e || total(host) !== T0 || neg) { wrong++; console.log(`  run ${run} step ${step}: ${e ?? ''} ${total(host)} vs ${T0}`); break; }
      }
    }
    check(merges > 200 && !wrong, `${merges} random merges: no mineral made or lost`);
  }
}

function sanity(g: GameState) { return g.fleets.every(f => f.fuel <= fleetSpec(g, f).fuelCapacity + 1e-6); }
console.log('--- a few years of a full game');
{
  const g = quickGame(undefined, 'Small', 4, 'standard', 'q-sim', { cataclysms: true } as any);
  let ok = true;
  while (g.year < 2470) { generateTurn(g); if (!sanity(g)) { ok = false; break; } }
  check(ok, `70 years: no fleet carries more fuel than its tanks (${g.year})`);
}

console.log(`${bad} failure(s), ${good} ok`);
process.exit(bad ? 1 : 0);
