// Constellations 0.3.7 checks: the hidden stars (run: npx tsx scripts/v37-check.ts).
import { quickGame, newFleet, addDesign } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import type { Fleet, GameState, Planet, Player, Secret } from '../src/engine/types';
import { designAtTech, guardianAt } from '../src/engine/guardians';
import { capitalOf } from '../src/engine/empire';
import { fleetSpec, canRefuelAt, estimateRoute, distance } from '../src/engine/fleet';
import { inWall, withDetours, routePoints, laneT, regionOf, voidStop, wallStop } from '../src/engine/walls';
import { generateSecrets, knowSecret, runSecrets, secretBonus, slingshot, reachable, PROBE_NEED, OPEN_NEED, followClue, IR_DWARF } from '../src/engine/secrets';
import { ANOMALIES, discoverAnomalies } from '../src/engine/anomalies';
import { autoExplore } from '../src/engine/automation';
import { updateIntel } from '../src/engine/scan';
import { updateWormholes } from '../src/engine/movement';
import { shieldFactorAt, effectiveWarp } from '../src/engine/terrain';
import { INFRARED, LENSING, specialsOf } from '../src/engine/specials';
import { decide } from '../src/engine/anomalies';
import { Rng, seedFromString } from '../src/engine/rng';
import { planetSpec } from '../src/engine/planet';
import * as DIP from '../src/engine/diplomacy';

let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
const quiet = (g: GameState) => { for (const p of g.players) if (!p.monster) p.ai = null; return g; };
const game = (seed: string, size: GameState['settings']['size'] = 'Medium', shape: GameState['settings']['shape'] = 'arm') => quiet(quickGame(undefined, size, 3, 'standard', seed, shape ? { shape } : {}));
const msgs = (g: GameState, id = 0) => g.players[id].messages.map(m => m.text);
const sec = (g: GameState, kind: Secret['kind']) => g.secrets!.find(s => s.kind === kind)!;
const design = (g: GameState, owner: number, tech: number, hull: string, purpose: Parameters<typeof designAtTech>[3]) => addDesign(g, designAtTech(g.players[owner], tech, hull, purpose, `Test ${hull} ${tech}`)!);
/** a fleet of `owner` put at a point (made at its capital, then moved) */
function fleetAt(g: GameState, owner: number, x: number, y: number, hull = 'Scout', purpose: Parameters<typeof designAtTech>[3] = 'scout', tech = 10): Fleet {
  const p = g.players[owner];
  const d = design(g, owner, tech, hull, purpose);
  const f = newFleet(g, p, d.id, 1, capitalOf(g, p)!);
  f.x = x; f.y = y; f.orbiting = -1;
  f.waypoints = [{ x, y, target: 'space', warp: 0, task: 'none', processed: true }];
  f.fuel = fleetSpec(g, f).fuelCapacity;
  return f;
}
function goTo(g: GameState, f: Fleet, pl: { x: number; y: number; id?: number }, warp = 9) {
  f.waypoints = [f.waypoints[0], { x: pl.x, y: pl.y, target: pl.id !== undefined ? 'planet' : 'space', targetId: pl.id, warp, task: 'none' }];
}
/** one year for these fleets only: the others stay put (quiet games: humans with no orders) */
const turn = (g: GameState) => generateTurn(g);
const colonyAt = (g: GameState, p: Player, near: { x: number; y: number }, max: number): Planet | undefined => {
  const pl = g.planets.filter(x => x.owner < 0 && !x.hidden && distance(x, near) <= max).sort((a, b) => distance(b, near) - distance(a, near))[0];
  if (!pl) return undefined;
  pl.owner = p.id; pl.pop = 20000; pl.colonizedYear = g.year;
  return pl;
};

console.log('--- creation');
{
  const g = game('v37-a');
  const kinds = g.secrets!.map(s => s.kind);
  check(['ancients', 'veiled', 'dwarf', 'pulsar', 'blackhole', 'dyson', 'pocket'].every(k => kinds.includes(k as Secret['kind'])), `a Medium arm has every kind of hidden star (${kinds.join(', ')})`);
  check(g.secrets!.every(s => s.pending?.length && !s.ids.length), 'their worlds are not in the galaxy until found');
  check(!g.planets.some(p => p.hidden), 'no hidden world among the planets at the start');
  check(!g.anomalies!.some(a => a.kind === 'vault') && !g.guardians!.some(x => x.kind === 'warden'), 'the sanctuary of the Ancients moved to its hidden star (no vault, no warden on an ordinary planet)');
  check(g.anomalies!.filter(a => a.kind === 'fragment').length >= 3, 'the fragments of the map are still scattered');
  const same = game('v37-a');
  check(JSON.stringify(same.secrets) === JSON.stringify(g.secrets), 'the same seed makes the same hidden stars');
  const off = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v37-a', { shape: 'arm', anomalies: false }));
  check(!off.secrets && off.planets.length === g.planets.length && off.planets.every((p, i) => p.x === g.planets[i].x && p.y === g.planets[i].y && p.name === g.planets[i].name), 'without discoveries: no hidden stars, and the rest of the galaxy is the same');
  for (const s of g.secrets!) {
    if (s.kind === 'veiled' || s.kind === 'pocket') continue;
    check(!inWall(g, s.x, s.y) && g.planets.every(p => distance(p, s) >= 20), `${s.kind} at (${s.x}, ${s.y}): outside the clouds, clear of the other stars`);
  }
  const v = sec(g, 'veiled');
  check(inWall(g, v.x, v.y) && !inWall(g, v.lane![0].x, v.lane![0].y), 'the veiled star is inside a cloud, the mouth of its way in outside');
  check(g.anomalies!.some(a => a.kind === 'echo' && a.planetId === v.clueAt) && g.anomalies!.some(a => a.kind === 'drift' && a.planetId === sec(g, 'pulsar').clueAt), 'the echo and the drifting clocks wait on ordinary worlds');
  const pk = sec(g, 'pocket');
  const mouth = g.wormholes.find(w => w.id === pk.mouthId)!, end = g.wormholes.find(w => w.id === pk.endId)!;
  check(mouth.sealed && end.sealed && mouth.fixed && regionOf(g, mouth) === 0 && regionOf(g, end) === 1 && pk.pending!.every(p => regionOf(g, p) === 1), `the cluster: ${pk.pending!.length} stars in a box off the map, a sealed wormhole (${pk.outcome})`);
  const sq = game('v37-sq', 'Small', 'square');
  check(!sq.secrets!.some(s => s.kind === 'veiled') && sq.secrets!.some(s => s.kind === 'pocket'), 'a square galaxy: no veiled star (no clouds), a hidden cluster');
  const tiny = game('v37-tiny', 'Tiny');
  check(!tiny.secrets!.some(s => s.kind === 'pocket' || s.kind === 'dyson') && tiny.secrets!.some(s => s.kind === 'dwarf'), `a tiny galaxy: a few of them (${tiny.secrets!.map(s => s.kind).join(', ')})`);
  check(specialsOf(g).includes(INFRARED) && !specialsOf(off).includes(INFRARED), 'the infrared survey is a technology only where there are hidden stars');
}

console.log('--- brown dwarf: infrared, nearby, fuel');
{
  const g = game('v37-b');
  const me = g.players[0];
  const s = sec(g, 'dwarf');
  const col = colonyAt(g, me, s, IR_DWARF * 0.9)!;
  me.tech.electronics = 5;
  runSecrets(g, new Rng(seedFromString('x')));
  check(!s.known.includes(0), 'without the infrared survey, a colony does not see it');
  me.tech.electronics = INFRARED.req.electronics!;
  me.messages = [];
  runSecrets(g, new Rng(seedFromString('x')));
  const pl = g.planets[s.ids[0]];
  check(s.known.includes(0) && !!pl && pl.hidden === 'dwarf' && msgs(g).some(t => t.includes('Relevé infrarouge') && t.includes(pl.name)), `infrared: a colony at ${Math.round(distance(col, s))} al finds it (${msgs(g)[0]})`);
  check(!me.intel.planets[pl.id].unknown && g.players.slice(1).filter(p => !p.monster).every(p => p.intel.planets[pl.id].unknown), 'known to this empire only');
  check(g.players.every(p => p.intel.planets.length === g.planets.length), 'every empire has a line for the new world');
  updateIntel(g);
  check(g.players[1].intel.planets[pl.id].year === undefined && g.players[1].intel.planets[pl.id].unknown === true, 'the scanners of the others ignore it');
  check(canRefuelAt(g, me, pl) && !canRefuelAt(g, g.players[1], pl), 'fuel is skimmed there by those who know it');
  // the others: by passing close
  const o = g.players[1];
  const f = fleetAt(g, 1, pl.x + 25, pl.y);
  runSecrets(g, new Rng(seedFromString('x')));
  check(s.known.includes(1), `a ship passing at 25 al finds it (${o.messages.map(m => m.text).find(t => t.includes(pl.name))})`);
  void f;
  // unknown stars are not explored by the automation
  const g2 = game('v37-b2');
  const s2 = sec(g2, 'dwarf');
  knowSecret(g2, s2, g2.players[1]);
  const pl2 = g2.planets[s2.ids[0]];
  const scout = fleetAt(g2, 0, pl2.x + 40, pl2.y + 40);
  autoExplore(g2, g2.players[0], scout);
  check(scout.waypoints[scout.waypoints.length - 1].targetId !== pl2.id, 'automatic exploration does not go to a star this empire does not know');
}

console.log('--- the veiled star');
{
  const g = game('v37-v');
  const me = g.players[0];
  const s = sec(g, 'veiled');
  const clue = g.planets[s.clueAt!];
  const a = g.anomalies!.find(x => x.kind === 'echo')!;
  const text = ANOMALIES.echo.apply!({ game: g, p: me, planet: clue, a, rng: new Rng(seedFromString('e')) } as never);
  const star = g.planets[s.ids[0]];
  check(s.known.includes(0) && text.includes(star.name) && me.intel.planets[star.id].year === undefined, `the echo shows the star (${text.slice(0, 90)}…)`);
  check(!!guardianAt(g, star.id) && guardianAt(g, star.id)!.kind === 'shepherd', 'the Shepherd of dust watches over it');
  check(!reachable(g, me, star) && inWall(g, s.lane![2].x, s.lane![2].y, 0), 'no way in yet');
  // a ship flying straight at it stops at the edge
  const f0 = fleetAt(g, 0, s.lane![0].x, s.lane![0].y, 'Destroyer', 'beamWarship', 8);
  goTo(g, f0, star);
  const est0 = estimateRoute(g, f0);
  check(!!wallStop(g, f0, star, 0), 'the way is blocked without the tunnel');
  // sounding the cloud
  const sc = fleetAt(g, 0, s.zone!.x, s.zone!.y);
  void est0;
  let years = 0;
  for (; years < 20 && !s.tunnel!.includes(0); years++) runSecrets(g, new Rng(seedFromString('p' + years)));
  check(s.tunnel!.includes(0) && years >= 2 && years <= 8, `a scout in the zone finds the way in ${years} years (${PROBE_NEED} points)`);
  check(reachable(g, me, star) && !inWall(g, s.lane![2].x, s.lane![2].y, 0) && inWall(g, s.lane![2].x, s.lane![2].y, 1) && inWall(g, s.lane![2].x, s.lane![2].y), 'the way is open to this empire only');
  const pts = routePoints(g, s.lane![0], star, 0)!;
  check(pts.length >= 3 && pts.every(q => !inWall(g, q.x, q.y, 0)), `the route goes along the channel (${pts.length} corners)`);
  const far = g.planets.filter(p => !p.hidden && p.owner < 0).sort((x, y) => distance(x, s.lane![0]) - distance(y, s.lane![0]))[3];
  const wps = withDetours(g, [{ x: far.x, y: far.y, target: 'planet', targetId: far.id, warp: 0, task: 'none' }, { x: star.x, y: star.y, target: 'planet', targetId: star.id, warp: 9, task: 'none' }], undefined, 0).list;
  check(wps.length > 3 && wps.slice(1, -1).every(w => w.detour), `from ${far.name}: ${wps.length - 2} pass-through points, the last ones in the channel`);
  check(effectiveWarp(g, s.lane![2], s.lane![3], 9) === 3 && effectiveWarp(g, far, s.lane![0], 9) === 9, 'Warp 3 at most in the cloud');
  // fly there
  const f = fleetAt(g, 0, far.x, far.y, 'Destroyer', 'beamWarship', 10);
  goTo(g, f, star, 8);
  const est = estimateRoute(g, f);
  check(est.length === 1 && Number.isFinite(est[0].arrival), `estimate: ${est[0]?.arrival} years`);
  let arrived = false, maxWarpIn = 0;
  for (let y = 0; y < 40 && !arrived; y++) {
    turn(g);
    if (!g.fleets.includes(f)) break;
    if (inWall(g, f.x, f.y) && f.lastWarp > maxWarpIn) maxWarpIn = f.lastWarp;
    if (f.x === star.x && f.y === star.y) arrived = true;
  }
  check(arrived || !g.fleets.includes(f), `the fleet reaches the veiled star (or dies fighting the Shepherd there) (${arrived ? 'arrived' : 'destroyed'})`);
  check(maxWarpIn <= 3, `never faster than Warp 3 inside the cloud (${maxWarpIn})`);
  // another empire knowing the star but not the way: stopped at the edge
  knowSecret(g, s, g.players[1]);
  const e = fleetAt(g, 1, s.lane![0].x + 1, s.lane![0].y, 'Destroyer', 'beamWarship', 10);
  goTo(g, e, star, 8);
  for (let y = 0; y < 4; y++) turn(g);
  check(!inWall(g, e.x, e.y) && !(e.x === star.x && e.y === star.y), 'an empire that has not found the way stays outside');
  void sc; void f0;
}

console.log('--- the Ancients');
{
  const g = game('v37-anc');
  const me = g.players[0];
  const s = sec(g, 'ancients');
  const frags = g.anomalies!.filter(a => a.kind === 'fragment');
  me.fragments = frags.length - 1;
  const a = frags[0];
  const text = ANOMALIES.fragment.apply!({ game: g, p: me, planet: g.planets[a.planetId], a, rng: new Rng(seedFromString('f')) } as never);
  const star = g.planets[s.ids[0]];
  check(!!star && text.includes(star.name) && s.known.includes(0), `the map complete, the star appears (${text.slice(0, 100)}…)`);
  const vault = g.anomalies!.find(x => x.kind === 'vault')!;
  check(vault.planetId === star.id && vault.known.includes(0) && me.intel.planets[star.id].explored === true, 'its sanctuary is known and analysed');
  check(guardianAt(g, star.id)?.kind === 'warden', 'the Colossus guards it');
  discoverAnomalies(g);
  check(!vault.known.includes(1), 'the others do not know it');
}

console.log('--- the mute pulsar');
{
  const g = game('v37-p');
  const me = g.players[0];
  const s = sec(g, 'pulsar');
  const clue = g.planets[s.clueAt!];
  const text = followClue(g, me, clue.id);
  const star = g.planets[s.ids[0]];
  check(s.known.includes(0) && text.includes(star.name), `the drifting clocks point at it (${text.slice(0, 80)}…)`);
  check(shieldFactorAt(g, { x: star.x + 30, y: star.y }) === 0.5 && shieldFactorAt(g, { x: star.x + 60, y: star.y }) === 1, 'shields at half strength within 40 al');
  check(g.anomalies!.some(x => x.kind === 'timing' && x.planetId === star.id), 'its clock can be studied on its world');
  const f = fleetAt(g, 1, star.x + 33, star.y, 'Destroyer', 'beamWarship', 8); // beyond what a ship notices by itself (30 al)
  s.nextFlare = g.year;
  runSecrets(g, new Rng(seedFromString('fl')));
  check(f.tokens[0].damage > 0 && s.known.includes(1) && g.players[1].messages.some(m => m.text.includes('rayonnement')), 'a flare damages a ship nearby, whose empire learns of the pulsar');
  check(s.nextFlare! >= g.year + 5, `next flare in ${s.nextFlare! - g.year} years`);
}

console.log('--- the black hole');
{
  const g = game('v37-bh');
  const me = g.players[0];
  const s = sec(g, 'blackhole');
  colonyAt(g, me, s, 550);
  me.tech.electronics = 13; me.tech.energy = 8;
  runSecrets(g, new Rng(seedFromString('l')));
  check(!s.known.includes(0), 'not seen before gravitational interferometry');
  me.tech.electronics = LENSING.req.electronics!;
  runSecrets(g, new Rng(seedFromString('l')));
  const star = g.planets[s.ids[0]];
  check(s.known.includes(0) && msgs(g).some(t => t.includes('Interférométrie')), 'interferometry finds it within 600 al');
  check(g.anomalies!.some(x => x.kind === 'horizon' && x.planetId === star.id), 'its horizon can be studied (a relic at the end)');
  // the observatory
  const g2 = game('v37-bh2');
  const s2 = sec(g2, 'blackhole');
  const o = colonyAt(g2, g2.players[0], s2, 950)!;
  o.megaprojects = ['observatory'];
  runSecrets(g2, new Rng(seedFromString('o')));
  check(s2.known.includes(0), `the Grand Observatoire sees it at ${Math.round(distance(o, s2))} al`);
  // the slingshot
  check(slingshot(g, 0, { x: star.x + 30, y: star.y }) === 1.5 && slingshot(g, 1, { x: star.x + 30, y: star.y }) === 1 && slingshot(g, 0, { x: star.x + 60, y: star.y }) === 1, 'the slingshot: within 40 al, for those who know it');
  const a = fleetAt(g, 0, star.x + 30, star.y, 'Destroyer', 'beamWarship', 10), b = fleetAt(g, 1, star.x + 30, star.y + 1, 'Destroyer', 'beamWarship', 10);
  const far = { x: star.x + 30 + (star.x > g.width / 2 ? -400 : 400), y: star.y };
  goTo(g, a, far, 7); goTo(g, b, { x: far.x, y: far.y + 1 }, 7);
  turn(g);
  const da = distance(a, { x: star.x + 30, y: star.y }), db = distance(b, { x: star.x + 30, y: star.y + 1 });
  check(Math.abs(da / db - 1.5) < 0.05, `a ship slung by the black hole goes ${Math.round(da)} al, the other ${Math.round(db)} al`);
}

console.log('--- the Dyson swarm');
{
  const g = game('v37-d');
  const me = g.players[0];
  const s = sec(g, 'dyson');
  colonyAt(g, me, s, 650);
  me.tech.electronics = 6;
  runSecrets(g, new Rng(seedFromString('d')));
  const star = g.planets[s.ids[0]];
  check(s.known.includes(0) && msgs(g).some(t => t.includes('essaim de Dyson')), 'infrared: a strong source with no visible star, within 700 al');
  check(guardianAt(g, star.id)?.kind === 'mind', 'the Mind of the swarm guards it');
  star.owner = 0; star.pop = 10000;
  star.bonusResources = 0; secretBonus(g);
  check(star.bonusResources === 200, 'a colony there gets 200 resources a year');
}

console.log('--- the hidden cluster');
{
  const g = game('v37-c');
  const me = g.players[0];
  const s = sec(g, 'pocket');
  const mouth = g.wormholes.find(w => w.id === s.mouthId)!;
  const f = fleetAt(g, 0, mouth.x + 30, mouth.y);
  f.waypoints.push({ x: mouth.x, y: mouth.y, target: 'wormhole', targetId: mouth.id, warp: 6, task: 'none' });
  me.tech.propulsion = 10; me.tech.electronics = 10;
  me.messages = [];
  for (let y = 0; y < 3 && distance(f, mouth) > 0.5; y++) turn(g);
  check(distance(f, mouth) < 1 && regionOf(g, f) === 0 && msgs(g).some(t => t.includes('scellé')), 'a fleet at the sealed wormhole does not go through');
  let years = 0;
  for (; years < 20 && mouth.sealed; years++) turn(g);
  check(!mouth.sealed && s.openedBy === 0 && s.ids.length >= 3 && s.known.includes(0), `a ship with a scanner opens it in ${years} years (${OPEN_NEED} points)`);
  check(!!me.intel.wormholes[s.endId!] && me.intel.wormholes[mouth.id].destId === s.endId, 'its other end is known');
  // through
  f.waypoints = [f.waypoints[0], { x: mouth.x, y: mouth.y, target: 'wormhole', targetId: mouth.id, warp: 6, task: 'none' }];
  f.x = mouth.x + 2;
  turn(g);
  check(regionOf(g, f) === 1, `the fleet is in the cluster (${Math.round(f.x)}, ${Math.round(f.y)})`);
  // the void
  const out = { x: g.width - 50, y: f.y };
  check(!!voidStop(g, f, out) && regionOf(g, voidStop(g, f, out)!) === 1, 'the void between the cluster and the galaxy stops a straight flight');
  goTo(g, f, out, 9);
  for (let y = 0; y < 3; y++) turn(g);
  check(regionOf(g, f) === 1, 'a fleet ordered to fly out stays in the cluster');
  // the others: by going through
  const o = g.players[1];
  o.tech.propulsion = 10; o.tech.electronics = 10;
  const h = fleetAt(g, 1, mouth.x + 5, mouth.y);
  h.waypoints.push({ x: mouth.x, y: mouth.y, target: 'wormhole', targetId: mouth.id, warp: 6, task: 'none' });
  turn(g);
  check(regionOf(g, h) === 1 && s.known.includes(1), 'another empire finds the cluster by going through');
  // no scanner sees across the void
  const pl = g.planets[s.ids[0]];
  const p2 = g.players[2];
  const spy = fleetAt(g, 2, g.width - 5, pl.y, 'Scout', 'scout', 26);
  updateIntel(g);
  check(p2.intel.planets[pl.id].unknown === true && !p2.intel.fleets.some(x => x.id === f.id), `a scanner at the edge of the galaxy sees nothing of the cluster (range ${fleetSpec(g, spy).scanRange})`);
}
{
  // the outcomes
  const seen = new Set<string>();
  for (let k = 0; k < 24 && seen.size < 4; k++) {
    const g = game('v37-o' + k, 'Small');
    const s = sec(g, 'pocket');
    if (!s || seen.has(s.outcome!)) continue;
    seen.add(s.outcome!);
    const me = g.players[0];
    knowSecret(g, s, me);
    const worlds = s.ids.map(id => g.planets[id]);
    if (s.outcome === 'dragon') check(worlds.some(w => guardianAt(g, w.id)?.kind === 'dragon'), 'dragon: the Wyrm lies on its richest world');
    if (s.outcome === 'virgin') check(worlds.every(w => !guardianAt(g, w.id)) && worlds.every(w => w.hab.every(h => h >= 30 && h <= 65)), 'virgin: mild worlds, nobody');
    if (s.outcome === 'enclave') {
      const a = g.anomalies!.find(x => x.kind === 'enclave')!;
      const w = g.planets[a.planetId];
      (me.decisions ??= []).push({ id: 999, anomalyId: a.id, kind: 'enclave', planetId: w.id, year: g.year });
      const t = decide(g, me, 999, 'b');
      check(w.owner === 0 && w.pop === 40000 && !!t?.includes('Exilés'), `enclave: the Exiles join the empire (${t?.slice(0, 70)}…)`);
      check(planetSpec(g, w, me).resources > 0, 'their world produces');
    }
    if (s.outcome === 'swarm') {
      const nest = worlds.find(w => guardianAt(g, w.id)?.kind === 'nest');
      check(!!nest, 'swarm: the Nest of the swarm lies in the cluster');
      const mouth = g.wormholes.find(w => w.id === s.mouthId)!;
      mouth.sealed = false; s.openedBy = 0; s.nextRaid = g.year;
      const target = g.planets.filter(p => p.owner >= 0 && !g.players[p.owner].monster).sort((a, b) => distance(a, mouth) - distance(b, mouth))[0];
      const before = g.fleets.length;
      runSecrets(g, new Rng(seedFromString('r')));
      const raid = g.fleets[g.fleets.length - 1];
      const ok = distance(target, mouth) < 500;
      check(!ok || (g.fleets.length === before + 1 && raid.purpose === 'guardian:raider' && raid.waypoints[1].targetId === target.id), `swarm: a raid comes out of the wormhole toward ${target.name} (${Math.round(distance(target, mouth))} al)`);
      check(s.nextRaid! >= g.year + 6, 'and another one some years later');
    }
  }
  check(seen.size === 4, `the four outcomes of the cluster are drawn (${[...seen].join(', ')})`);
}

console.log('--- wormholes and older saves');
{
  const g = game('v37-w', 'Medium', 'nursery');
  const rng = new Rng(seedFromString('wh'));
  let inCloud = 0;
  for (let y = 0; y < 300; y++) { updateWormholes(g, rng); for (const w of g.wormholes) if (inWall(g, w.x, w.y)) inCloud++; }
  check(inCloud === 0, 'the wormholes never drift into a dark cloud');
  const pk = sec(g, 'pocket');
  const m = g.wormholes.find(w => w.id === pk.mouthId)!;
  check(m.x === pk.x && m.y === pk.y, 'the sealed wormhole does not move');
  // an older save: no hidden stars yet, the vault where it was
  const old = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v37-old', { shape: 'arm' }));
  old.secrets = undefined;
  old.anomalies!.push({ id: old.nextId++, planetId: old.planets.find(p => p.owner < 0)!.id, kind: 'vault', level: 5, known: [], progress: {}, hidden: true });
  generateTurn(old);
  check(!!old.secrets?.length && !old.secrets.some(s => s.kind === 'ancients') && old.anomalies!.some(a => a.kind === 'vault'), `an older save gets its hidden stars on its next turn, its vault stays (${old.secrets?.map(s => s.kind).join(', ')})`);
  void generateSecrets;
}

console.log('--- diplomacy: odds, tribute');
{
  const g = quiet(quickGame(undefined, 'Small', 3, 'standard', 'v37-dip'));
  for (const p of g.players) if (!p.monster && p.id !== 0) p.ai = 'standard';
  for (const p of g.players) if (!p.monster) for (const o of g.players) if (!o.monster && o.id !== p.id && !p.intel.met.includes(o.id)) p.intel.met.push(o.id);
  const ai = 1;
  const t = DIP.evaluate(g, ai, 0, 'trade');
  check(t.chance !== undefined && t.chance > 0 && t.chance < 1 && /probablement|peut-être/.test(t.why) && !/: -?\d+\)$/.test(t.why), `an answer is told as odds, never as a sure thing (${t.why})`);
  check(Math.abs(DIP.acceptChance(0) - 0.5) < 1e-9 && DIP.acceptChance(10) > 0.75 && DIP.acceptChance(10) < 0.85 && DIP.acceptChance(-20) < 0.1, 'the odds: half at the threshold, four in five ten points above');
  const a1 = DIP.decideAnswer(g, ai, 0, 'trade', t), a2 = DIP.decideAnswer(g, ai, 0, 'trade', t);
  check(a1 === a2, 'asked twice the same year: the same answer');
  let yes = 0;
  for (let y = 0; y < 200; y++) { g.year++; if (DIP.decideAnswer(g, ai, 0, 'trade', { ...t, chance: 0.7 })) yes++; }
  check(yes > 110 && yes < 170, `over 200 years, a 70 % answer is yes ${yes} times`);
  g.year = 2400;
  const firm = DIP.evaluate(g, ai, 0, 'peace');
  check(firm.sure === true && !firm.ok, `a firm rule stays firm (${firm.why})`);
  // tribute: the computer pays, the report says what, where
  const hw0 = g.planets.find(x => x.owner === 0 && x.homeworld)!, hw1 = g.planets.find(x => x.owner === ai && x.homeworld)!;
  hw1.surface = { ironium: 1000, boranium: 600, germanium: 400 };
  const cap0 = { ...hw0.surface };
  // a navy that frightens them
  const navy = fleetAt(g, 0, hw0.x, hw0.y, 'Battleship', 'beamWarship', 16);
  navy.tokens[0].qty = 40;
  // 0.3.7.1: at first contact they know nothing of it, and fear nothing
  const blind = DIP.evaluate(g, ai, 0, 'tribute', 200);
  check(blind.sure === true && !blind.ok && blind.why.includes('presque rien'), `first contact: no fear of a navy they have never seen (${blind.why})`);
  // what their intelligence tells them
  (g.players[ai].intel.dossiers ??= {})[0] = { level: 60, lines: [], facts: {} };
  const big = DIP.evaluate(g, ai, 0, 'tribute', 1800);
  check(!big.ok && big.why.includes('beaucoup demander'), `even frightened, they will not give far more than they can spare (${big.why})`);
  const tr = DIP.evaluate(g, ai, 0, 'tribute', 200);
  const op0 = DIP.opinion(g, ai, 0).total;
  const r = DIP.propose(g, 0, ai, 'tribute', 200, ai)!;
  check(!!r && r.ok === DIP.decideAnswer(g, ai, 0, 'tribute', tr), `tribute demanded: ${tr.why} → ${r.ok ? 'paid' : 'refused'}`);
  check(DIP.opinion(g, ai, 0).total < op0 - 10, `their opinion falls clearly, whatever the answer (${op0} → ${DIP.opinion(g, ai, 0).total})`);
  if (r.ok) {
    const got = (['ironium', 'boranium', 'germanium'] as const).map(m => hw0.surface[m] - cap0[m]);
    const msg = g.players[0].messages.map(m => m.text).find(t => t.includes('paient le tribut'));
    check(got.reduce((a, b) => a + b, 0) === 200 && !!msg && msg.includes(`ironium ${got[0]}`) && msg.includes(`germanium ${got[2]}`) && msg.includes(hw0.name), `the report: ${msg}`);
  }
  check(!!DIP.proposalBlocker(g, 0, ai, 'tribute') && DIP.proposalBlocker(g, 0, ai, 'tribute')!.includes('3 ans'), `one tribute every three years (${DIP.proposalBlocker(g, 0, ai, 'tribute')})`);
  g.year += 3;
  check(!DIP.proposalBlocker(g, 0, ai, 'tribute'), 'three years later, again');
  // a gift: what, where
  hw0.surface = { ironium: 500, boranium: 500, germanium: 500 };
  DIP.gift(g, 0, 2, 300);
  check(g.players[2].messages.some(m => m.text.includes('Cadeau des') && m.text.includes('ironium 100') && m.text.includes('déposés à la surface de')), 'a gift says what arrived and where');
}

console.log('--- a long game');
{
  const g = quickGame(undefined, 'Medium', 4, 'standard', 'v37-long', { shape: 'arm' });
  const t0 = Date.now();
  for (let y = 0; y < 80; y++) generateTurn(g);
  const ms = (Date.now() - t0) / 80;
  const found = g.secrets!.filter(s => s.known.length);
  check(found.length >= 3, `after 80 years the computer players have found ${found.length} hidden stars (${found.map(s => s.kind).join(', ')})`);
  check(g.players.every(p => p.intel.planets.length === g.planets.length), 'every empire keeps a line per world');
  check(g.fleets.every(f => regionOf(g, f) >= 0) && g.fleets.filter(f => !g.players[f.owner].monster).every(f => !inWall(g, f.x, f.y, f.owner)), 'no fleet lost in the void or in a cloud');
  check(ms < 600, `${Math.round(ms)} ms per year`);
}

console.log(`\n${good} ok, ${bad} échec(s)`);
if (bad) process.exit(1);
