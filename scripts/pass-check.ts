// Pass-through waypoints: the estimate and the real movement agree, turns cost no time, sweeps reveal planets.
import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { estimateRoute, distance, fleetSpec } from '../src/engine/fleet';
import type { Waypoint } from '../src/engine/types';
import { sweptBy } from '../src/engine/scan';
import { Rng, seedFromString } from '../src/engine/rng';

let bad = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };

for (const stop of [undefined, true] as const) {
  const g = quickGame(undefined, 'Small', 3, 'standard', 'pass-' + stop);
  const me = g.players[g.human];
  const scout = g.fleets.find(f => f.owner === me.id && fleetSpec(g, f).scanRange >= 0 && fleetSpec(g, f).cargoCapacity === 0 && fleetSpec(g, f).hasEngines)!;
  const sp = fleetSpec(g, scout);
  const w = sp.idealSpeed;
  // a dog-leg: 0.4 year east, then 1.5 years north
  const a: Waypoint = { x: scout.x + Math.round(w * w * 0.4), y: scout.y, target: 'space', warp: w, task: 'none', stop };
  const b: Waypoint = { x: a.x, y: a.y + Math.round(w * w * 1.5), target: 'space', warp: w, task: 'none' };
  scout.waypoints = [{ ...scout.waypoints[0], processed: true }, a, b];
  const est = estimateRoute(g, scout);
  const scoutWps = scout.waypoints.map(x => ({ ...x }));
  const fuelEst = est.reduce((t, l) => t + l.fuel, 0);
  console.log('stop =', stop, 'estimate', est.map(l => `${l.arrival}a pass=${l.pass} fuel=${l.fuel} ends=${l.yearEnds.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`));
  const fuel0 = scout.fuel;
  let years = 0, ends: string[] = [];
  while (scout.waypoints.length > 1 && years < 10) { generateTurn(g); years++; ends.push(`${scout.x},${scout.y}`); }
  console.log('  flew', years, 'years, positions', ends.join(' '), 'fuel', fuel0, '->', scout.fuel);
  check(fuel0 - scout.fuel === fuelEst, `stop=${stop}: fuel used ${fuel0 - scout.fuel} = estimate ${fuelEst}`);
  check(years === est[est.length - 1].arrival, `stop=${stop}: real arrival ${years} = estimate ${est[est.length - 1].arrival}`);
  check(stop ? years === 3 : years === 2, `stop=${stop}: ${stop ? 'stopping costs a year' : 'turning costs no time'}`);
  const predicted = est.flatMap((l, k) => [...l.yearEnds, ...(l.pass ? [] : [scoutWps[k + 1]])].map(p => `${Math.round(p.x)},${Math.round(p.y)}`));
  check(ends.slice(0, predicted.length).every((p, k) => { const [x, y] = p.split(',').map(Number); const [px, py] = predicted[k].split(',').map(Number); return Math.hypot(x - px, y - py) <= 1.5; }), `stop=${stop}: year-end positions match chevrons (${predicted.join(' ')})`);
}

// a planet is always a stop (orbit), even if asked otherwise
{
  const g = quickGame(undefined, 'Small', 3, 'standard', 'sweep');
  const me = g.players[g.human];
  const f = g.fleets.find(x => x.owner === me.id && fleetSpec(g, x).hasEngines && fleetSpec(g, x).cargoCapacity === 0)!;
  const unknown = g.planets.filter(p => me.intel.planets[p.id].year === undefined).sort((p, q) => distance(p, f) - distance(q, f));
  const p1 = unknown[0], p2 = unknown.find(p => p !== p1 && distance(p, p1) > 20)!;
  f.waypoints = [{ ...f.waypoints[0], processed: true },
    { x: p1.x, y: p1.y, target: 'planet', targetId: p1.id, warp: fleetSpec(g, f).idealSpeed, task: 'none', stop: false },
    { x: p2.x, y: p2.y, target: 'planet', targetId: p2.id, warp: fleetSpec(g, f).idealSpeed, task: 'none' }];
  f.fuel = fleetSpec(g, f).fuelCapacity;
  const est = estimateRoute(g, f);
  check(!est[0].pass, 'planet waypoint is never crossed without stopping');
  let y = 0;
  while (!(f.x === p1.x && f.y === p1.y) && y < 8) { generateTurn(g); y++; }
  check(f.x === p1.x && f.y === p1.y && f.orbiting === p1.id && y === est[0].arrival, `fleet ends a year in orbit of the planet (year ${y}, estimate ${est[0].arrival})`);
}

// random routes: the estimate must predict the real arrival year and the fuel burned
{
  const g = quickGame(undefined, 'Small', 3, 'standard', 'random-routes');
  const me = g.players[g.human];
  let n = 0, arrOk = 0, fuelOk = 0;

  const rng = new Rng(seedFromString('routes'));
  for (let trial = 0; trial < 40; trial++) {
    const fleets = g.fleets.filter(f => f.owner === me.id && fleetSpec(g, f).hasEngines);
    if (!fleets.length) break; // all lost on the way (battles)
    const f = fleets[trial % fleets.length];
    const sp = fleetSpec(g, f);
    f.fuel = sp.fuelCapacity;
    const legs = 1 + rng.int(4);
    const wps: Waypoint[] = [{ x: f.x, y: f.y, target: 'space', warp: 0, task: 'none', processed: true }];
    let px = f.x, py = f.y;
    for (let k = 0; k < legs; k++) {
      px = Math.max(5, Math.min(g.width - 5, px + rng.int(160) - 80)); py = Math.max(5, Math.min(g.height - 5, py + rng.int(160) - 80));
      wps.push({ x: px, y: py, target: 'space', warp: 3 + rng.int(Math.max(1, sp.idealSpeed - 2)), task: 'none', stop: rng.chance(0.3) ? true : undefined });
    }
    f.waypoints = wps;
    const est = estimateRoute(g, f);
    if (!est.every(l => l.ok)) continue;
    const fuel0 = f.fuel, want = est[est.length - 1].arrival, wantFuel = est.reduce((t, l) => t + l.fuel, 0);
    let years = 0;
    while (f.waypoints.length > 1 && years < 40 && g.fleets.includes(f)) { generateTurn(g); years++; }
    if (!g.fleets.includes(f)) continue; // destroyed on the way (battle)
    n++;
    if (years === want) arrOk++; else console.log('  arrival mismatch', years, 'vs', want, est.map(l => `${l.pass ? 'P' : 'S'}${l.arrival}`).join(' '), JSON.stringify({ x: f.x, y: f.y, waiting: f.waiting, fuel: f.fuel, wps: f.waypoints.map(w => [w.x, w.y, w.warp, w.task, w.stop]), alive: g.fleets.includes(f), name: f.name }));
    if (Math.abs((fuel0 - f.fuel) - wantFuel) <= legs) fuelOk++; else console.log('  fuel mismatch', fuel0 - f.fuel, 'vs', wantFuel);
  }
  check(arrOk === n, `random routes: arrival predicted ${arrOk}/${n}`);
  check(fuelOk === n, `random routes: fuel predicted within rounding ${fuelOk}/${n}`);
}
// wormholes need "Navigation des anomalies"
for (const lvl of [0, 12]) {
  const g = quickGame(undefined, 'Small', 3, 'standard', 'worm');
  const me = g.players[g.human];
  me.tech.propulsion = Math.max(lvl, lvl ? me.tech.propulsion : 0); me.tech.electronics = Math.max(lvl, lvl ? me.tech.electronics : 0);
  if (!lvl) { me.tech.propulsion = 0; me.tech.electronics = 0; }
  const f = g.fleets.find(x => x.owner === me.id && fleetSpec(g, x).hasEngines)!;
  const w = g.wormholes[0];
  f.x = w.x + 3; f.y = w.y; f.orbiting = -1; f.fuel = fleetSpec(g, f).fuelCapacity;
  f.waypoints = [{ x: f.x, y: f.y, target: 'space', warp: 0, task: 'none', processed: true }, { x: w.x, y: w.y, target: 'wormhole', targetId: w.id, warp: 4, task: 'none' }];
  generateTurn(g);
  const exit = g.wormholes.find(x => x.id === w.destId)!;
  const jumped = Math.hypot(f.x - exit.x, f.y - exit.y) < 15;
  check(lvl ? jumped : !jumped, lvl ? 'with Propulsion 12 / Électronique 12 the fleet goes through the wormhole' : 'without the technology the fleet stops in front of the wormhole');
}
{
  const trail = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  check(sweptBy(trail, 30, { x: 50, y: 25 }), 'pen sweep: planet 25 al from the first segment is seen (pen 30)');
  check(!sweptBy(trail, 30, { x: 50, y: 40 }), 'pen sweep: planet 40 al away is not seen');
  check(!sweptBy(trail, -1, { x: 100, y: 0 }), 'no penetrating scanner: nothing is analysed on the way');
}
console.log(bad ? `${bad} failure(s)` : 'all good');
process.exit(bad ? 1 : 0);
