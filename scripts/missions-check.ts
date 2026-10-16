// Smoke test of one-click missions: send a scout, send an ark, build-and-send an ark.
import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { habitability } from '../src/engine/race';
import { sendOptions, sendFleet, buildOptions, queueMission, missionStatus, missionDesigns } from '../src/engine/missions';
import { distance } from '../src/engine/fleet';
import * as M from '../src/engine/missions';

const g = quickGame();
const me = g.players[g.human];
const hw = g.planets.find(p => p.owner === me.id && p.homeworld)!;
const unknown = g.planets.filter(p => me.intel.planets[p.id].year === undefined).sort((a, b) => distance(a, hw) - distance(b, hw));
const so = sendOptions(g, me, unknown[0].id, 'explore');
console.log('scout options', so.map(o => `${o.fleet.name} ${o.years}a W${o.warp}`));
if (so[0]) console.log('send scout', sendFleet(g, so[0].fleet, unknown[0].id, 'explore'), so[0].fleet.waypoints.length);
// pretend we know a nearby habitable world
const cand = g.planets.filter(p => p.owner < 0 && habitability(me.race, p.hab) > 20).sort((a, b) => distance(a, hw) - distance(b, hw));
const t1 = cand[0], t2 = cand[1];
for (const t of [t1, t2]) { const i = me.intel.planets[t.id]; i.year = g.year; i.hab = [...t.hab] as any; i.owner = -1; }
const ao = sendOptions(g, me, t1.id, 'colonize');
console.log('ark options', ao.map(o => `${o.fleet.name} ${o.years}a W${o.warp}`));
if (ao[0]) { console.log('send ark', sendFleet(g, ao[0].fleet, t1.id, 'colonize'), JSON.stringify(ao[0].fleet.waypoints.map(w => [w.task, w.transport?.colonists?.action, w.warp]))); }
console.log('designs', missionDesigns(g, me, 'colonize').map(d => d.name), missionDesigns(g, me, 'explore').map(d => d.name));
const bo = buildOptions(g, me, t2.id, 'colonize');
console.log('build options', bo.map(o => `${o.planet.name} build ${o.buildYears} + travel ${o.travelYears} reach ${o.reachable}`));
queueMission(g, bo[0].planet, bo[0].design, { kind: 'colonize', planetId: t2.id });
console.log('queue', bo[0].planet.queue.map(q => q.kind + (q.mission ? '*' : '')));
for (let y = 0; y < 12; y++) {
  generateTurn(g);
  const st1 = missionStatus(g, me, t2.id);
  const msgs = me.messages.filter(m => /coloni|construit .*part|hors de portée/.test(m.text)).map(m => m.text);
  if (msgs.length) console.log(g.year, msgs.join(' | '));
  if (g.planets[t1.id].owner === me.id && g.planets[t2.id].owner === me.id) { console.log('both colonized in', g.year); break; }
  void st1;
}
console.log('t1 owner', g.planets[t1.id].owner, 't2 owner', g.planets[t2.id].owner, 'pop', g.planets[t2.id].pop);

// remote mining mission: build a miner and send it to a rich free world
{
  const g2 = quickGame();
  const me2 = g2.players[g2.human];
  const hw2 = g2.planets.find(p => p.owner === me2.id && p.homeworld)!;
  const rich = g2.planets.filter(p => p.owner < 0).sort((a, b) => distance(a, hw2) - distance(b, hw2)).slice(0, 6).sort((a, b) => (b.conc.ironium + b.conc.boranium + b.conc.germanium) - (a.conc.ironium + a.conc.boranium + a.conc.germanium))[0];
  const i2 = me2.intel.planets[rich.id]; i2.year = g2.year; i2.hab = [...rich.hab] as any; i2.owner = -1; i2.conc = { ...rich.conc };
  console.log('can mine', M.canMineHere(g2, me2, rich.id), 'designs', M.missionDesigns(g2, me2, 'mine').map(d => d.name));
  const so2 = M.sendOptions(g2, me2, rich.id, 'mine');
  console.log('miner options', so2.map(o => `${o.fleet.name} ${o.years}a W${o.warp}`));
  if (so2[0]) M.sendFleet(g2, so2[0].fleet, rich.id, 'mine');
  const before = { ...rich.surface };
  for (let y = 0; y < 6; y++) generateTurn(g2);
  const st = M.missionStatus(g2, me2, rich.id);
  console.log('mining at', rich.name, 'fleets mining', st.mining.map(f => f.name), 'surface', before, '->', rich.surface);
}

// mineral shuttle: a freighter loads what the miner extracts and delivers it to the capital, repeatedly
{
  const g3 = quickGame();
  const me3 = g3.players[g3.human];
  const hw3 = g3.planets.find(p => p.owner === me3.id && p.homeworld)!;
  const rich = g3.planets.filter(p => p.owner < 0).sort((a, b) => distance(a, hw3) - distance(b, hw3))[1];
  const i3 = me3.intel.planets[rich.id]; i3.year = g3.year; i3.hab = [...rich.hab] as any; i3.owner = -1; i3.conc = { ...rich.conc }; i3.surface = { ...rich.surface };
  const so3 = M.sendOptions(g3, me3, rich.id, 'mine');
  if (so3[0]) M.sendFleet(g3, so3[0].fleet, rich.id, 'mine');
  for (let y = 0; y < 3; y++) generateTurn(g3);
  rich.surface.ironium += 300; // pretend some years of mining already
  const st0 = M.missionStatus(g3, me3, rich.id);
  const ho = M.sendOptions(g3, me3, rich.id, 'haul');
  console.log('haul options', ho.map(o => `${o.fleet.name} ${o.years}a`), 'mining', st0.mining.map(f => f.name));
  const before = hw3.surface.ironium;
  if (ho[0]) console.log('send shuttle', M.sendFleet(g3, ho[0].fleet, rich.id, 'haul'), JSON.stringify(ho[0].fleet.waypoints.map(w => [g3.planets.find(p => p.x === w.x && p.y === w.y)?.name, w.task, w.warp])), 'repeat', ho[0].fleet.repeat);
  let delivered = 0;
  for (let y = 0; y < 12; y++) {
    const b = hw3.surface.ironium + hw3.surface.boranium + hw3.surface.germanium;
    generateTurn(g3);
    const a = hw3.surface.ironium + hw3.surface.boranium + hw3.surface.germanium;
    if (ho[0] && ho[0].fleet.cargo.ironium === 0 && g3.fleets.includes(ho[0].fleet) && a - b > 250) delivered++;
  }
  const st = M.missionStatus(g3, me3, rich.id);
  console.log('shuttles', st.haulers.map(h => `${h.fleet.name} -> ${h.home.name}`), 'deliveries seen', delivered, 'hw ironium', before, '->', hw3.surface.ironium, 'rich surface', rich.surface);
  // build-and-send a shuttle with a custom port
  const other = g3.planets.find(p => p.owner === me3.id && p.id !== hw3.id);
  const d = M.missionDesigns(g3, me3, 'haul')[0];
  const bo = d ? M.buildOptions(g3, me3, rich.id, 'haul', d) : [];
  console.log('haul designs', M.missionDesigns(g3, me3, 'haul').map(x => x.name), 'build at', bo.slice(0, 2).map(o => o.planet.name), 'other colony', other?.name);
}
