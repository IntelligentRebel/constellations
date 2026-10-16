// Constellations 0.3.8 checks: minefield outlook, mission fuel (run: npx tsx scripts/v38-check.ts).
import { quickGame, newFleet, addDesign, tutorialGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import type { Fleet, GameState } from '../src/engine/types';
import { designAtTech } from '../src/engine/guardians';
import { capitalOf } from '../src/engine/empire';
import { fleetSpec, distance } from '../src/engine/fleet';
import { minefieldDecay, minefieldLayers, minefieldOutlook } from '../src/engine/movement';
import { sendOptions } from '../src/engine/missions';
import { estimateSpeed, estimateCourse, updateIntel } from '../src/engine/scan';
import { crowdedNoEmigration, migrationTargets, autoImmigration, joinNetwork } from '../src/engine/logistics';
import { gateCheck } from '../src/engine/movement';
import { knowSecret } from '../src/engine/secrets';
import { planIntercept } from '../src/engine/intercept';
import { specOf, isScoutDesign, designSpec } from '../src/engine/design';
import { missionDesigns, isPureScout } from '../src/engine/missions';
import { mergeFleets, splitFleet } from '../src/engine/tasks';
const A_rename = (f: Fleet, name: string) => { f.name = name; f.customName = true; };
import { planetSpec } from '../src/engine/planet';
import { TECHS, hasTech } from '../src/engine/tech';
import { researchCost } from '../src/engine/research';

let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
const quiet = (g: GameState) => { for (const p of g.players) if (!p.monster) p.ai = null; return g; };

/** a mine layer of `owner` laying where it stands (x, y) */
function layer(g: GameState, owner: number, x: number, y: number, qty = 1, tech = 12): Fleet {
  const p = g.players[owner];
  const d = addDesign(g, designAtTech(p, tech, 'Destroyer', 'mineLayer', `Mouilleur test ${g.nextId}`)!);
  const f = newFleet(g, p, d.id, qty, capitalOf(g, p)!);
  f.x = x; f.y = y; f.orbiting = -1;
  f.waypoints = [{ x, y, target: 'space', warp: 0, task: 'layMines', processed: false }];
  f.fuel = fleetSpec(g, f).fuelCapacity;
  return f;
}

console.log('--- minefield: laying against decay');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-mines', { shape: 'arm' }));
  for (const p of g.players) if (!p.monster) p.ai = null;
  const hw = capitalOf(g, g.players[0])!;
  // a point 40 ly from home, away from the other empires
  const x = hw.x + 40, y = hw.y;
  const field = { id: g.nextId++, owner: 0, x, y, mines: 600, type: 'standard' as const, detonate: false };
  g.minefields.push(field);
  const f = layer(g, 0, x, y);
  const rate = fleetSpec(g, f).mineLaying.standard;
  check(rate > 0, `the test layer lays ${rate} mines a year`);
  const ls = minefieldLayers(g, field.id);
  check(ls.length === 1 && ls[0].fleet === f && ls[0].rate === rate, 'the layer standing in the field is counted');
  const lost = minefieldDecay(g, field).lost;
  const before = field.mines;
  generateTurn(g);
  const after = g.minefields.find(m => m.id === field.id)?.mines;
  check(after === before - lost + rate, `one year: ${before} − ${lost} + ${rate} = ${after}`);
  // where it goes: the outlook matches the turns
  const out = minefieldOutlook(g, g.minefields.find(m => m.id === field.id)!, minefieldLayers(g, field.id));
  for (let i = 0; i < 60; i++) generateTurn(g);
  const m60 = g.minefields.find(m => m.id === field.id)?.mines ?? 0;
  const o60 = (() => { const o = { ...g.minefields.find(m => m.id === field.id)! }; return o; })();
  check(Math.abs(m60 - out.final) <= Math.max(15, out.final * 0.05) || out.years > 60, `after 60 years: ${m60} mines, outlook said ≈ ${Math.round(out.final)} in ${out.years} years`);
  // over two years (a planet at the edge of the radius can make it swing between two sizes)
  const l1 = minefieldDecay(g, o60).lost, l2 = minefieldDecay(g, { ...o60, mines: o60.mines - l1 + rate }).lost;
  const net = rate - (l1 + l2) / 2;
  check(Math.abs(net) <= Math.max(10, rate * 0.3), `at that size the decay about matches the laying (net ${net} a year on average)`);
  // a field nobody lays into
  const lone = { id: g.nextId++, owner: 0, x: hw.x - 60, y: hw.y + 30, mines: 400, type: 'standard' as const, detonate: false };
  g.minefields.push(lone);
  check(minefieldLayers(g, lone.id).length === 0, 'a field without a layer has no laying');
  // a layer that stops after 3 years: the field dies afterwards
  const f2 = layer(g, 0, lone.x, lone.y);
  f2.waypoints[0].layYears = 3;
  const o2 = minefieldOutlook(g, lone, minefieldLayers(g, lone.id));
  check(o2.gone !== undefined && o2.gone > 3, `laying for 3 years only: the field dies in ${o2.gone} years`);
  // the laying of another empire's field is not shown (fleets unknown): engine side, only the owner's fleets lay into it
  const enemy = { id: g.nextId++, owner: 1, x: hw.x + 40, y: hw.y + 2, mines: 300, type: 'standard' as const, detonate: false };
  g.minefields.push(enemy);
  check(minefieldLayers(g, enemy.id).length === 0, "my layer does not feed another empire's field");
}

console.log('--- mining mission: fuel');
{
  const g = tutorialGame();
  const me = g.players[0];
  const hw = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  const gl = g.fleets.find(f => f.owner === 0 && fleetSpec(g, f).miningRate > 0)!;
  const sp = fleetSpec(g, gl);
  const far = g.planets.filter(p => p.owner < 0).sort((a, b) => Math.abs(distance(a, hw) - 110) - Math.abs(distance(b, hw) - 110))[0];
  gl.x = far.x; gl.y = far.y; gl.orbiting = far.id; gl.waypoints = [{ x: far.x, y: far.y, target: 'planet', targetId: far.id, warp: 0, task: 'none' }];
  gl.fuel = Math.round(sp.fuelCapacity * 0.35);
  const near = g.planets.filter(p => p.owner < 0 && p !== far).sort((a, b) => distance(a, gl) - distance(b, gl))[0];
  me.intel.planets[near.id].year = 2400; me.intel.planets[near.id].hab = near.hab; me.intel.planets[near.id].conc = near.conc;
  const o = sendOptions(g, me, near.id, 'mine')[0];
  check(!!o && o.warp === Math.min(sp.idealSpeed, sp.maxSafeSpeed || 9), `a third of a tank, ${Math.round(distance(near, gl))} ly: Warp ${o?.warp} (${o?.years} y), not a crawl`);
}

console.log('--- speed of a foreign fleet');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-speed', { shape: 'arm' }));
  const hw = capitalOf(g, g.players[0])!;
  // a fleet of empire 1 crossing in front of our home world at Warp 6, then one that stops halfway through a year
  const mk = (dx: number, dy: number, to: number, warp: number) => {
    const p = g.players[1];
    const d = addDesign(g, designAtTech(p, 10, 'Scout', 'scout', `Éclaireur test ${g.nextId}`)!);
    const f = newFleet(g, p, d.id, 1, capitalOf(g, p)!);
    f.x = hw.x + dx; f.y = hw.y + dy; f.orbiting = -1; f.fuel = fleetSpec(g, f).fuelCapacity;
    f.waypoints = [{ x: f.x, y: f.y, target: 'space', warp: 0, task: 'none', processed: true }, { x: hw.x + to, y: hw.y + dy, target: 'space', warp, task: 'none' }];
    return f;
  };
  const a = mk(-40, 5, 200, 6);
  const b = mk(-30, -5, -30 + 20, 7); // 20 ly away at Warp 7 (49 ly a year): there in the first year, then still
  const c = mk(-20, 12, 400, 9);
  updateIntel(g);
  check(estimateSpeed(g.players[0], a.id) === null, 'seen once: speed unknown');
  generateTurn(g); generateTurn(g);
  const sa = estimateSpeed(g.players[0], a.id), sb = estimateSpeed(g.players[0], b.id), sc = estimateSpeed(g.players[0], c.id);
  check(!!sa && sa.warp === 6 && sa.exact, `Warp 6 fleet: estimated Warp ${sa?.warp} (${sa?.ly.toFixed(1)} ly a year)${sa?.exact ? '' : ' (at least)'}`);
  check(!!sc && sc.warp === 9 && sc.exact, `Warp 9 fleet: estimated Warp ${sc?.warp} (${sc?.ly.toFixed(1)} ly a year)`);
  check(!!sb && sb.warp === 0, `a fleet that has arrived is seen as stationary (${sb?.ly.toFixed(1)} ly)`);
  // the year it arrived: 20 ly at Warp 7 shows as "at least Warp 5", never more than its real speed
  const tr = g.players[0].intel.tracks[b.id];
  const first = { ...g.players[0], intel: { ...g.players[0].intel, tracks: { [b.id]: tr.slice(0, 2) } } };
  const s1 = estimateSpeed(first as any, b.id);
  check(!!s1 && !s1.exact && s1.warp <= 7, `the year it arrived: "Warp ${s1?.warp} at least" (${s1?.ly.toFixed(1)} ly), not more than Warp 7`);
}

console.log('--- research goal reached during the turn');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-goal', { shape: 'arm' }));
  g.settings.randomResearch = false;
  const p = g.players[0];
  // a technology that the next Electronics level unlocks
  const up = { ...p, tech: { ...p.tech, electronics: p.tech.electronics + 1 } } as typeof p;
  const t = [...TECHS.values()].find(x => !hasTech(p, x) && hasTech(up, x))!;
  check(!!t, `target: ${t?.name}, unlocked by Electronics ${up.tech.electronics}`);
  p.researchGoal = t.name;
  p.researching = 'electronics';
  p.researchSpent.electronics = researchCost(g, p, 'electronics') - 1;
  generateTurn(g);
  check(hasTech(p, t), 'found during the turn');
  check(p.researchGoal === undefined, `the goal is dropped at once, not at the next turn (goal: ${p.researchGoal ?? 'none'})`);
  check(p.messages.some(m => m.text.startsWith('Objectif atteint')), 'with its message');
}

console.log('--- course of a foreign fleet');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-course', { shape: 'arm' }));
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  // a fleet of empire 1 coming straight at our home world from 120 ly at Warp 6
  const p1 = g.players[1];
  const d = addDesign(g, designAtTech(p1, 10, 'Scout', 'scout', 'Éclaireur cap')!);
  const f = newFleet(g, p1, d.id, 1, capitalOf(g, p1)!);
  const ang = 0.7;
  f.x = hw.x + 120 * Math.cos(ang); f.y = hw.y + 120 * Math.sin(ang); f.orbiting = -1; f.fuel = fleetSpec(g, f).fuelCapacity;
  f.waypoints = [{ x: f.x, y: f.y, target: 'space', warp: 0, task: 'none', processed: true }, { x: hw.x, y: hw.y, target: 'planet', targetId: hw.id, warp: 6, task: 'none' }];
  updateIntel(g);
  check(estimateCourse(g, me, f.id).length === 0, 'seen once: no course');
  generateTurn(g); generateTurn(g);
  const c = estimateCourse(g, me, f.id);
  const left = Math.hypot(f.x - hw.x, f.y - hw.y);
  const mine = c.find(x => x.planet.id === hw.id);
  check(!!mine, `our home world is on its course (${c.map(x => `${x.planet.name} +${x.years}`).join(', ')})`);
  check(!!mine && mine.years === Math.ceil(left / 36 - 1e-9) && mine.exact, `arrival in ${mine?.years} years (${left.toFixed(0)} ly left at 36 ly a year)`);
  let y = 0; while (f.orbiting !== hw.id && y++ < 10) generateTurn(g);
  check(y === mine?.years, `it does arrive then (${y} years)`);
}

console.log('--- course around a dark cloud');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-speed', { shape: 'arm' }));
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  const p1 = g.players[1];
  const d = addDesign(g, designAtTech(p1, 10, 'Destroyer', 'beamWarship', 'Raid test')!);
  const f = newFleet(g, p1, d.id, 3, capitalOf(g, p1)!);
  f.x = hw.x + 150 * Math.cos(2.2); f.y = hw.y + 150 * Math.sin(2.2); f.orbiting = -1; f.fuel = fleetSpec(g, f).fuelCapacity;
  f.waypoints = [{ x: f.x, y: f.y, target: 'space', warp: 0, task: 'none', processed: true }, { x: hw.x, y: hw.y, target: 'planet', targetId: hw.id, warp: 5, task: 'none' }];
  updateIntel(g); generateTurn(g); generateTurn(g);
  const tr = me.intel.tracks[f.id];
  const a = tr[tr.length - 2], b = tr[tr.length - 1];
  const straight = Math.abs(((hw.x - a.x) * (b.y - a.y) - (hw.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y));
  const c = estimateCourse(g, me, f.id).find(x => x.planet.id === hw.id);
  check(straight > 10 && !!c, `it heads off the straight line (${straight.toFixed(0)} ly off) around a cloud, and our home world is still found on its course`);
  let y = 0; while (f.orbiting !== hw.id && y++ < 20) generateTurn(g);
  check(!!c && y === c.years, `arrival predicted in ${c?.years} years, real ${y}`);
}

console.log('--- crowded capital: a word about emigration');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-crowd', { shape: 'arm' }));
  g.settings.logistics = true;
  const me = g.players[0];
  const cap = capitalOf(g, me)!;
  const max = planetSpec(g, cap, me).maxPop;
  cap.pop = Math.round(max * 0.3 / 100) * 100;
  check(!crowdedNoEmigration(g, me, cap), 'a capital at 30 % of its capacity: no advice');
  cap.pop = Math.round(max * 0.8 / 100) * 100;
  check(!crowdedNoEmigration(g, me, cap), 'at 80 %, but no other world to send colonists to: no advice');
  // a young colony on a habitable world
  const col = g.planets.filter(p => p.owner < 0 && planetSpec(g, p, me).hab > 0).sort((a, b) => Math.hypot(a.x - cap.x, a.y - cap.y) - Math.hypot(b.x - cap.x, b.y - cap.y))[0];
  col.owner = me.id; col.pop = 2500; col.colonizedYear = g.year;
  check(crowdedNoEmigration(g, me, cap), `at 80 % with ${col.name} nearly empty: advice in the planet panel`);
  generateTurn(g);
  const said = () => me.messages.filter(m => m.text.includes('Une émigration automatique pourrait être utile'));
  check(said().length === 1 && said()[0].target?.id === cap.id, `and once in the reports: "${said()[0]?.text}"`);
  generateTurn(g);
  check(said().length === 0 && me.hints?.includes('emigration'), 'not again the next year');
  cap.migration = { mode: 'out', target: 50 };
  check(!crowdedNoEmigration(g, me, cap), 'with an emigration policy: no advice');
}

console.log('--- stargates: why a leg can or cannot jump');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-gate', { shape: 'arm' }));
  const me = g.players[0]; const cap = capitalOf(g, me)!;
  const sb = addDesign(g, designAtTech(me, 12, 'Space Station', 'stargater', 'Station porte')!);
  const gate = specOf(g, sb.id).gate!;
  cap.starbase = { designId: sb.id, damage: 0 };
  const near = g.planets.filter(p => p.owner < 0).sort((a, b) => Math.hypot(a.x - cap.x, a.y - cap.y) - Math.hypot(b.x - cap.x, b.y - cap.y));
  const col = near[0]; col.owner = 0; col.pop = 50000; col.starbase = { designId: sb.id, damage: 0 };
  const far = near.find(p => Math.hypot(p.x - cap.x, p.y - cap.y) > 150)!; far.owner = 0; far.pop = 50000; far.starbase = { designId: sb.id, damage: 0 };
  const bare = near.find(p => p.owner < 0)!;
  const scout = g.fleets.find(x => x.owner === 0 && x.orbiting === cap.id)!;
  const go = (f: Fleet, p: { x: number; y: number; id: number }, warp: number) => { f.waypoints = [f.waypoints[0], { x: p.x, y: p.y, target: 'planet', targetId: p.id, warp, task: 'none' }]; };
  go(scout, col, 7);
  let c = gateCheck(g, scout, 1);
  check(c.srcGate && !c.problem && !c.risks.length, `gates at ${cap.name} and ${col.name}: a safe jump for a ${c.heaviest} kt ship (safe mass ${gate.safeMass} kt)`);
  go(scout, bare, 7);
  c = gateCheck(g, scout, 1);
  check(c.srcGate && c.problem === `${bare.name} n'a pas de porte stellaire`, `no gate at ${bare.name}: "${c.problem}"`);
  const bb = newFleet(g, me, addDesign(g, designAtTech(me, 12, 'Battleship', 'beamWarship', 'Cuirassé test')!).id, 1, cap);
  go(bb, col, 11);
  c = gateCheck(g, bb, 1);
  check(!!c.problem && c.problem.includes('cinq fois la masse sûre'), `a ${c.heaviest} kt battleship: refused ("${c.problem}")`);
  // the jump itself follows the same rules
  go(scout, far, 11);
  generateTurn(g);
  check(scout.orbiting === far.id, `the scout jumps to ${far.name} (${Math.round(Math.hypot(far.x - cap.x, far.y - cap.y))} ly) in one year`);
  check(bb.orbiting === cap.id && me.messages.some(m => m.text.includes('trop lourd pour la porte')), 'the battleship stays, with a message');
}

console.log('--- emigrants go where colonists are lacking');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-mig', { shape: 'arm' }));
  g.settings.logistics = true;
  const me = g.players[0]; const cap = capitalOf(g, me)!;
  cap.pop = Math.round(planetSpec(g, cap, me).maxPop * 0.8 / 100) * 100;
  cap.migration = { mode: 'out', target: 50 };
  const col = g.planets.filter(p => p.owner < 0 && planetSpec(g, p, me).hab > 0).sort((a, b) => Math.hypot(a.x - cap.x, a.y - cap.y) - Math.hypot(b.x - cap.x, b.y - cap.y))[0];
  col.owner = me.id; col.pop = 2500; col.colonizedYear = g.year;
  const t = migrationTargets(g, me);
  check(t.length === 1 && t[0].planet === col && t[0].auto, `no Immigration world: ${col.name} (habitable, nearly empty, no policy) receives them by default`);
  me.autoImmigration = { on: false, upTo: 35 };
  check(migrationTargets(g, me).length === 0, 'option off: no destination');
  me.autoImmigration = { on: true, upTo: 35 };
  check(autoImmigration(g.players[1]).on === false || !g.players[1].ai, 'computer players keep their own Immigration worlds (option off for them)');
  // a freighter in the network carries them
  const fd = missionDesigns(g, me, 'haul')[0];
  const fr = newFleet(g, me, fd.id, 1, cap);
  joinNetwork(g, fr);
  const before = col.pop;
  for (let y = 0; y < 6; y++) generateTurn(g);
  check(col.pop > before + 10000 && (me.logStats?.colonists ?? 0) > 0, `${col.name}: ${before} → ${col.pop} colonists (${me.logStats?.colonists ?? 0} delivered)`);
}

console.log('--- the Shepherd of dust, in the heart of its cloud');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v37-v', { shape: 'arm' }));
  const me = g.players[0];
  const s = g.secrets!.find(x => x.kind === 'veiled')!;
  // another empire found it: the star joins the map, with its guardian
  knowSecret(g, s, g.players[1]);
  const star = g.planets[s.ids[0]];
  const shep = g.fleets.find(f => f.orbiting === star.id && f.owner === g.monsterId)!;
  check(!!shep, `the Shepherd orbits ${star.name}`);
  // a scout with a long-range scanner at the mouth of the way in, the star in range
  const p0 = g.players[0];
  const d = addDesign(g, designAtTech(p0, 16, 'Scout', 'scout', 'Éclaireur longue portée')!);
  const sc = newFleet(g, p0, d.id, 1, capitalOf(g, p0)!);
  const m = s.lane![0];
  sc.x = m.x; sc.y = m.y; sc.orbiting = -1; sc.fuel = fleetSpec(g, sc).fuelCapacity;
  sc.waypoints = [{ x: m.x, y: m.y, target: 'space', warp: 0, task: 'none', processed: true }];
  const range = fleetSpec(g, sc).scanRange;
  updateIntel(g);
  check(Math.hypot(star.x - m.x, star.y - m.y) < range && !me.intel.fleets.some(x => x.id === shep.id), `in scanner range (${Math.round(Math.hypot(star.x - m.x, star.y - m.y))} ly < ${range} ly) but the star is not found: the Shepherd stays hidden`);
  knowSecret(g, s, me);
  updateIntel(g);
  check(me.intel.fleets.some(x => x.id === shep.id), 'once the star is known (the echo), it is seen');
  const plan = planIntercept(g, sc, shep.id);
  check(!plan.ok && (plan as { reason: string }).reason.includes('barre la route'), `no way in yet: no interception offered ("${(plan as { reason: string }).reason}")`);
  (s.tunnel ??= []).push(me.id);
  const plan2 = planIntercept(g, sc, shep.id);
  check(plan2.ok || !(plan2 as { reason: string }).reason.includes('barre la route'), `the way in found: the interception is possible (${plan2.ok ? `in ${(plan2 as { years: number }).years} years` : (plan2 as { reason: string }).reason})`);
}

console.log('--- tankers and fleet names');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-names', { shape: 'arm' }));
  const me = g.players[0]; const cap = capitalOf(g, me)!;
  const mk = (hull: string, purpose: Parameters<typeof designAtTech>[3], name: string, qty = 1) => newFleet(g, me, addDesign(g, designAtTech(me, 14, hull, purpose, name)!).id, qty, cap);
  const tanker = mk('Super-Fuel Xport', 'fuelFreighter', 'Grand ravitailleur');
  check(fleetSpec(g, tanker).scanRange > 0 && !isPureScout(fleetSpec(g, tanker)), `a tanker with a scanner (${fleetSpec(g, tanker).scanRange} ly) is not a scout`);
  const war = mk('Destroyer', 'beamWarship', 'Destroyer test', 3);
  A_rename(war, 'Garde de Carambole');
  mergeFleets(g, tanker, war);
  check(tanker.name === 'Garde de Carambole' && tanker.customName === true, `a default-named fleet merged with a renamed one takes its name (${tanker.name})`);
  const w2 = mk('Destroyer', 'beamWarship', 'Destroyer test 2', 2), c2 = mk('Large Freighter', 'freighter', 'Cargo test');
  mergeFleets(g, w2, c2);
  check(/^Flotte de guerre #\d+$/.test(w2.name) && !w2.customName, `two default names: a name from the composition (${w2.name})`);
  const c3 = mk('Large Freighter', 'freighter', 'Cargo test 3', 3), w3 = mk('Scout', 'armedScout', 'Escorte légère');
  mergeFleets(g, c3, w3);
  check(/^Convoi escorté #\d+$/.test(c3.name), `freighters with a small armed escort: ${c3.name}`);
  const r1 = mk('Destroyer', 'beamWarship', 'D1'), r2 = mk('Destroyer', 'beamWarship', 'D2');
  A_rename(r1, 'Première'); A_rename(r2, 'Seconde');
  mergeFleets(g, r1, r2);
  check(r1.name === 'Première', 'two renamed fleets: the absorbing one keeps its name');
  // splitting: the part that leaves is named after what it is, the rest too (unless renamed)
  const sp = splitFleet(g, w2, [{ designId: c2.tokens[0].designId, qty: 1 }])!;
  check(sp.name.startsWith('Cargo test #') && w2.name.startsWith('Destroyer test 2 #'), `split: ${sp.name} leaves, ${w2.name} stays`);
}

console.log('--- what is a scout');
{
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v38-scout', { shape: 'arm' }));
  const me = g.players[0]; const cap = capitalOf(g, me)!;
  const mkD = (hull: string, purpose: Parameters<typeof designAtTech>[3], name: string) => addDesign(g, designAtTech(me, 10, hull, purpose, name)!);
  const sd = mkD('Scout', 'scout', 'Sonde test'), wd = mkD('Destroyer', 'beamWarship', 'Destroyer scanner'), td = mkD('Super-Fuel Xport', 'fuelFreighter', 'Ravitailleur test');
  const f1 = newFleet(g, me, sd.id, 1, cap), f2 = newFleet(g, me, wd.id, 1, cap), f3 = newFleet(g, me, td.id, 1, cap);
  check(isPureScout(fleetSpec(g, f1)), 'a ship on the Scout hull is a scout by default');
  check(fleetSpec(g, f2).scanRange > 0 && !isPureScout(fleetSpec(g, f2)) && !isPureScout(fleetSpec(g, f3)), 'a destroyer or a tanker with a scanner is not');
  wd.scout = true;
  check(isPureScout(fleetSpec(g, f2)), 'ticked in the designer: the destroyer is a scout');
  sd.scout = false;
  check(!isPureScout(fleetSpec(g, f1)), 'unticked: the Scout-hull ship is not');
  const mixed = newFleet(g, me, sd.id, 1, cap); sd.scout = undefined;
  mergeFleets(g, mixed, newFleet(g, me, td.id, 1, cap));
  check(!isPureScout(fleetSpec(g, mixed)), 'a fleet is a scout only if all its ships are');
  check(missionDesigns(g, me, 'explore')[0]?.id === sd.id || isScoutDesign(missionDesigns(g, me, 'explore')[0], designSpec(me, missionDesigns(g, me, 'explore')[0])), `exploration builds a scout design (${missionDesigns(g, me, 'explore')[0]?.name})`);
}

console.log(`\n${good} ok, ${bad} échec(s)`);
if (bad) process.exit(1);
