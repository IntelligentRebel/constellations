// Constellations 3.6 checks: the feedback list (run: npx tsx scripts/v36-check.ts).
import { quickGame, newFleet, addDesign, createGame, classicPreset, constellationsPreset, defaultSettings, CONSTELLATIONS_RULES, STARS_LAST } from '../src/engine/newgame';
import { planetCount } from '../src/engine/universe';
import { galaxyDensity, cloudDepth, cloudName, cloudAt, unwarp, SHAPES_OFFERED } from '../src/engine/shape';
import { inWall, wallAt, wallStop, detourPoints, segmentBlocked, mainRegionTest, nearestOutside, withDetours } from '../src/engine/walls';
import { estimateRoute } from '../src/engine/fleet';
import { cloudRaster } from '../src/ui/clouds';
import { canUseWormholes } from '../src/engine/specials';
import { PREDEFINED_RACES } from '../src/engine/race';
import { generateTurn } from '../src/engine/turn';
import type { GameState, MysteryTrader, Planet } from '../src/engine/types';
import { designAtTech } from '../src/engine/guardians';
import { capitalOf } from '../src/engine/empire';
import { fleetSpec, canRefuelAt } from '../src/engine/fleet';
import { traderOffers, traderPositions, applyTraderMeet, TRADER_MIN } from '../src/engine/intercept';
import { availableItems, installationRoom, runProduction, applyTemplate, advanceTemplates, queueBottleneck, stuckWarnings } from '../src/engine/production';
import { planetSpec } from '../src/engine/planet';
import { initCrisis, OMEN_YEARS, runCrisis } from '../src/engine/crisis';
import { refitOnArrival, newestRefit } from '../src/engine/refit';
import { updateIntel } from '../src/engine/scan';
import { radiusOf, RADIUS_MAX } from '../src/engine/culture';
import { people, popScale } from '../src/engine/words';
import { radarContacts } from '../src/engine/radar';
import { AUTO_EXPLORE, WORMHOLE_NAV } from '../src/engine/specials';
import { autoRole, designSpec } from '../src/engine/design';
import { studyDebris } from '../src/engine/debris';
import { processWaypointTask, chaseChecks } from '../src/engine/tasks';
import { guardianAssessments, spawnGuardian } from '../src/engine/guardians';
import { recordWarLosses, declareWar, pairOf, exhaustion } from '../src/engine/diplomacy';
import { TECHS, HULLS, hasTech } from '../src/engine/tech';
import { Rng, seedFromString } from '../src/engine/rng';
import type { BattleRecord } from '../src/engine/types';

let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
const quiet = (g: GameState) => { for (const p of g.players) if (!p.monster) p.ai = null; return g; };
const game = (seed: string, size: GameState['settings']['size'] = 'Small') => quiet(quickGame(undefined, size, 3, 'standard', seed));
const msgs = (g: GameState, id = 0) => g.players[id].messages.map(m => m.text);
const design = (g: GameState, owner: number, tech: number, hull: string, purpose: Parameters<typeof designAtTech>[3]) => addDesign(g, designAtTech(g.players[owner], tech, hull, purpose, `Test ${hull} ${tech}`)!);
const freePlanet = (g: GameState, near: Planet, min = 60, max = 200) => g.planets.filter(x => x.owner < 0).map(x => ({ x, d: Math.hypot(x.x - near.x, x.y - near.y) })).filter(o => o.d >= min && o.d <= max).sort((a, b) => a.d - b.d)[0]?.x;

console.log('--- quick settings');
{
  check(AUTO_EXPLORE.req.electronics === 9 && WORMHOLE_NAV.req.propulsion === 10 && WORMHOLE_NAV.req.electronics === 10, 'automatic exploration at Électronique 9, wormholes at Propulsion 10 / Électronique 10');
  check(radiusOf(0) === 16 && RADIUS_MAX === 180, 'culture radiance doubled');
  const g = game('v36-a');
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  // a fort refuels
  const fortD = design(g, 0, 6, 'Orbital Fort', 'fort');
  hw.starbase = { designId: fortD.id, damage: 0 };
  check(canRefuelAt(g, me, hw), 'an orbital fort refuels ships');
  // installations
  const room = installationRoom(g, hw, 'defenses')!;
  hw.defenses = room.max;
  const it = availableItems(g, hw).find(i => i.kind === 'defenses');
  check(!!it?.disabled && it.disabled.includes('maximum'), `defenses greyed out at the maximum (${it?.disabled})`);
  hw.defenses = room.max - 5;
  hw.queue = [{ kind: 'defenses', qty: 40, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }];
  const r = runProduction(g, hw, () => {});
  check(r.messages.some(m => m.includes('ramenée de 40 à 5')), `a queued order beyond the room is cut down, with a report (${r.messages.find(m => m.includes('ramenée'))})`);
  // the crisis comes later, by galaxy size
  const sizes: [GameState['settings']['size'], number][] = [['Small', 2480], ['Medium', 2488], ['Large', 2496]];
  for (const [size, start] of sizes) {
    const c = quickGame(undefined, size, 2, 'standard', 'cr-' + size);
    check(c.crisis!.omenYear >= start && c.crisis!.omenYear < start + 8 && c.crisis!.openYear === c.crisis!.omenYear + OMEN_YEARS && OMEN_YEARS === 10, `${size}: omens in ${c.crisis!.omenYear}, Breach in ${c.crisis!.openYear}`);
  }
  const old = game('v36-old');
  old.crisis!.omenYear = 2467; old.crisis!.openYear = 2475; delete old.crisis!.sched;
  runCrisis(old);
  check(old.crisis!.omenYear >= 2480 && old.crisis!.sched === 1, `an older save's dormant crisis is postponed (${old.crisis!.omenYear})`);
  void initCrisis;
}

console.log('--- the Mystery Trader: route and interception');
{
  const g = game('v36-t');
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  // a trader crossing near the homeworld, heading east
  const t: MysteryTrader = { id: g.nextId++, x: hw.x - 150, y: hw.y + 30, destX: g.width + 20, destY: hw.y + 30, warp: 7, reward: 'research', heading: { x: 1, y: 0 }, rewarded: [] };
  g.traders.push(t);
  updateIntel(g);
  const seen = me.intel.traders.find(x => x.id === t.id);
  check(!!seen && !!seen.heading, 'the trader is known with its heading (it broadcasts near our worlds)');
  const path = traderPositions(g, me, t.id)!;
  check(path.length > 3 && Math.abs(path[0].x - (t.x + 49)) <= 1 && path[0].y === Math.round(t.y), `its year-end positions are predicted (${path.slice(0, 3).map(p => `${p.x},${p.y}`).join(' · ')})`);
  check(traderOffers(g, me, t.id).length === 0, 'no offer without a freighter and minerals');
  const fr = design(g, 0, 10, 'Large Freighter', 'freighter');
  const f = newFleet(g, me, fr.id, 5, hw);
  hw.surface = { ironium: 4000, boranium: 4000, germanium: 4000 };
  const sp = fleetSpec(g, f);
  const offers = traderOffers(g, me, t.id);
  const o = offers.find(x => x.fleet === f);
  check(sp.cargoCapacity >= TRADER_MIN && !!o && !!o.load && o.total >= TRADER_MIN, `a freighter at home is offered: load ${o ? o.total - o.carried : 0} kt, meet in ${o ? g.year + o.plan.years : '?'}`);
  if (o) {
    applyTraderMeet(g, f, t.id, o.plan, o.load);
    check(f.meetTrader === t.id && f.waypoints[0].task === 'transport', 'orders: load here, then the meeting point');
    let met = false;
    for (let y = 0; y < 12 && !met; y++) { generateTurn(g); met = t.rewarded.includes(me.id) || msgs(g).some(m => m.includes('a accepté vos') || m.includes('vous a cédé')); }
    check(met, `the trader is met and pays (${g.year}: ${msgs(g).find(m => m.includes('Marchand') || m.includes('accepté')) ?? 'nothing'})`);
    generateTurn(g);
    check(f.meetTrader === undefined, 'the standing order ends once rewarded');
  }
}

console.log('--- fleets: stay on post, refit on arrival, patrol fuel, escorts');
{
  const g = game('v36-f');
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  const sc = design(g, 0, 4, 'Scout', 'scout');
  const f = newFleet(g, me, sc.id, 1, hw);
  const dest = freePlanet(g, hw, 30, 120)!;
  f.waypoints = [{ x: f.x, y: f.y, target: 'planet', targetId: hw.id, warp: 0, task: 'none', processed: true }, { x: dest.x, y: dest.y, target: 'planet', targetId: dest.id, warp: 6, task: 'stay' }];
  for (let y = 0; y < 6 && f.orbiting !== dest.id; y++) generateTurn(g);
  check(f.orbiting === dest.id && msgs(g).some(m => m.includes(`${f.name} est arrivée à ${dest.name} et reste en poste`)), 'a sentinel arrives and stays on post (no "waiting for orders")');
  generateTurn(g);
  check(!msgs(g).some(m => m.includes(f.name) && m.includes('attend des ordres')), 'and is not reported as waiting');
  // refit on arrival
  const old = design(g, 0, 4, 'Destroyer', 'beamWarship');
  const neu = design(g, 0, 8, 'Destroyer', 'beamWarship');
  check(newestRefit(g, me, old.id)?.id === neu.id, 'the newest design of the same hull is proposed');
  const w = newFleet(g, me, old.id, 2, hw);
  hw.queue = [];
  refitOnArrival(g, w);
  check(hw.queue.some(q => q.kind === 'refit' && q.fromDesignId === old.id && q.designId === neu.id && q.qty === 2), 'on arrival at a shipyard, the refit is queued');
  // escorts
  const g2 = game('v36-e');
  const m2 = g2.players[0];
  m2.relations[1] = 'enemy'; g2.players[1].relations[0] = 'enemy';
  if (g2.diplomacy) { const DIP = require('../src/engine/diplomacy'); DIP.declareWar(g2, 0, 1); }
  const spot = g2.planets.find(x => x.owner < 0)!;
  const frD = design(g2, 0, 6, 'Medium Freighter', 'freighter');
  const warE = design(g2, 1, 14, 'Destroyer', 'beamWarship');
  const myW = design(g2, 0, 2, 'Scout', 'armedScout');
  newFleet(g2, m2, frD.id, 1, spot); newFleet(g2, m2, myW.id, 1, spot);
  newFleet(g2, g2.players[1], warE.id, 4, spot);
  generateTurn(g2);
  const fought = g2.battles.some(b => b.players.includes(0) && b.players.includes(1));
  const survivors = g2.fleets.filter(x => x.owner === 0 && Math.abs(x.x - spot.x) < 0.5 && Math.abs(x.y - spot.y) < 0.5);
  check(!fought || !survivors.length || survivors.some(x => fleetSpec(g2, x).hasWeapons) || msgs(g2).some(m => m.includes('sans escorte')), `unarmed survivors without escort are told to leave (${msgs(g2).find(m => m.includes('sans escorte')) ?? (survivors.length ? 'escort alive' : 'none survived')})`);
}

console.log('--- reports: new colonies under our scanners, arks taking many colonists');
{
  const g = game('v36-r');
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  const pl = freePlanet(g, hw, 20, 100)!;
  me.intel.planets[pl.id].owner = -1; me.intel.planets[pl.id].year = g.year;
  pl.owner = 1; pl.pop = 2000;
  const sc = design(g, 0, 10, 'Scout', 'scout');
  newFleet(g, me, sc.id, 1, pl);
  updateIntel(g);
  check(msgs(g).some(m => m.startsWith('Nouvelle colonie') && m.includes(pl.name)), `a new colony seen by our scanners is reported (${msgs(g).find(m => m.startsWith('Nouvelle colonie'))})`);
  const small = g.planets.find(x => x.owner === 0 && !x.homeworld) ?? hw;
  const colD = design(g, 0, 6, 'Colony Ship', 'colonizer');
  const dest = freePlanet(g, small, 20, 150)!;
  // 0.3.6.6: reported only when the world loses more than a year of growth
  const load = (pop: number, label: string) => {
    for (const f of g.fleets.filter(x => x.owner === 0 && x.name.startsWith('Test ark'))) g.fleets.splice(g.fleets.indexOf(f), 1);
    small.pop = pop; me.messages = [];
    const ark = newFleet(g, me, colD.id, 1, small);
    ark.name = 'Test ark ' + label;
    ark.cargo.colonists = 0;
    ark.waypoints = [{ x: ark.x, y: ark.y, target: 'planet', targetId: small.id, warp: 0, task: 'transport', transport: { colonists: { action: 'loadAll', amount: 0 } }, processed: false }, { x: dest.x, y: dest.y, target: 'planet', targetId: dest.id, warp: 6, task: 'colonize' }];
    const growth = planetSpec(g, small).growth;
    generateTurn(g);
    return { msg: msgs(g).find(m => m.includes('a embarqué')), taken: ark.cargo.colonists * 100, growth };
  };
  const a = load(6000, 'a');
  check(!!a.msg && a.taken > a.growth, `an ark taking more than a year of growth from a small world is reported (${a.taken} of 6000, growth ${a.growth}: ${a.msg})`);
  const b = load(47000, 'b');
  check(!b.msg && b.taken < b.growth, `an ark taking less than a year of growth is not (${b.taken} of 47 000, growth ${b.growth})`);
  const cap = planetSpec(g, small).maxPop;
  const c = load(Math.round(cap * 0.97 / 100) * 100, 'c');
  check(!c.msg && c.taken > c.growth, `nor one taking from a crowded world, whose growth it frees (${c.taken} of ${Math.round(cap * 0.97)}, growth ${c.growth})`);
}

console.log('--- production: template chain, what holds a line back');
{
  const g = game('v36-p');
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  const col = g.planets.find(x => x.owner < 0 && x.id !== hw.id)!;
  col.owner = 0; col.pop = 1000; col.queue = []; col.hab = [...hw.hab] as typeof col.hab; col.baseHab = [...hw.baseHab] as typeof col.baseHab;
  applyTemplate(g, col, 1);
  check(col.tpl === 1, 'a new colony is on "Colonie standard"');
  const sp = planetSpec(g, col, me);
  col.pop = Math.ceil(sp.maxPop * 0.4);
  advanceTemplates(g);
  check(col.tpl === 2 && col.queue.some(q => q.kind === 'autoDefenses') && msgs(g).some(m => m.includes('passe du modèle')), `at 40 % of its maximum population it moves on to "${me.templates.find(t => t.id === col.tpl)?.name}"`);
  me.tplChain = false; col.pop = sp.maxPop; col.factories = sp.maxPossibleFactories;
  advanceTemplates(g);
  check(col.tpl === 2, 'the chain can be switched off');
  me.tplChain = undefined;
  advanceTemplates(g);
  check(col.tpl === 3, `then to "${me.templates.find(t => t.id === 3)?.name}"`);
  // an older colony is recognised by its automatic items
  const old = g.planets.find(x => x.owner < 0 && x.id !== col.id)!;
  old.owner = 0; old.pop = 1000; old.queue = []; applyTemplate(g, old, 1); old.tpl = undefined;
  advanceTemplates(g);
  check(old.tpl === 1, 'a colony of an older save is recognised');
  // bottleneck
  hw.queue = [{ kind: 'ship', designId: design(g, 0, 6, 'Destroyer', 'beamWarship').id, qty: 40, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }];
  hw.surface = { ironium: 0, boranium: 0, germanium: 0 };
  const b = queueBottleneck(g, hw, 0, []);
  check(b.key !== 'none' && b.text.length > 10, `what holds it back: ${b.text}`);
  stuckWarnings(g);
  const n = msgs(g).filter(m => m.includes('n\'avance pas')).length;
  stuckWarnings(g);
  check(b.years < 25 || (n === 1 && msgs(g).filter(m => m.includes('n\'avance pas')).length === 1), 'a stuck head of queue is reported once');
}

console.log('--- lot 4: roles, debris, refused interceptions, guardians, war losses');
{
  const g = game('v36-l4');
  const me = g.players[0], foe = g.players[1];
  const torp = design(g, 0, 8, 'Destroyer', 'torpedoWarship'), beam = design(g, 0, 8, 'Destroyer', 'beamWarship');
  check(autoRole(designSpec(me, torp)) === 'artillery' && autoRole(designSpec(me, beam)) === 'line', 'automatic role: torpedoes go to artillery, beams to the line');
  // debris: a battle where we destroyed many enemy ships carrying a part we do not know
  const hw = capitalOf(g, me)!;
  const alien = design(g, 1, 16, 'Cruiser', 'beamWarship');
  const unknownPart = alien.slots.map(x => x.part).find(n => !hasTech(me, TECHS.get(n) ?? HULLS.get(n)!));
  newFleet(g, me, beam.id, 3, hw);
  const rec: BattleRecord = { id: 99, year: g.year, x: hw.x, y: hw.y, planetId: hw.id, players: [0, 1], rounds: 3, losses: { 1: 8 },
    tokens: [{ id: 1, owner: 0, fleetId: 1, designId: beam.id, designName: beam.name, hull: beam.hull, qty: 3, armor: 100, shields: 0, damage: 0, qtyDamaged: 0, x: 1, y: 4, initiative: 1, movement: 4, starbase: false },
      { id: 2, owner: 1, fleetId: 2, designId: alien.id, designName: alien.name, hull: alien.hull, qty: 8, armor: 100, shields: 0, damage: 0, qtyDamaged: 0, x: 8, y: 4, initiative: 1, movement: 4, starbase: false }],
    actions: [{ t: 'fire', id: 1, target: 2, weapon: 'Laser', torpedo: false, shieldDmg: 0, armorDmg: 800, killed: 8, fromX: 1, fromY: 4 }] };
  g.battles = [rec];
  const before = { ...me.tech }, spent = JSON.stringify(me.researchSpent ?? {});
  let hit = false;
  for (let i = 0; i < 12 && !hit; i++) { g.year++; studyDebris(g); hit = msgs(g).some(m => m.startsWith('Débris de la bataille')); }
  check(!!unknownPart && hit && (JSON.stringify(me.tech) !== JSON.stringify(before) || JSON.stringify(me.researchSpent ?? {}) !== spent), `wrecks of unknown components give research (${msgs(g).find(m => m.startsWith('Débris'))})`);
  g.settings.debris = false; me.messages = [];
  for (let i = 0; i < 5; i++) { g.year++; studyDebris(g); }
  check(!msgs(g).some(m => m.startsWith('Débris')), 'no debris study when the rule is off');
  g.battles = [];
  // a patrol refuses an obvious massacre
  me.relations[1] = 'enemy'; foe.relations[0] = 'enemy';
  const scout = design(g, 0, 3, 'Scout', 'beamWarship') ?? beam;
  const pf = newFleet(g, me, scout.id, 1, hw);
  pf.waypoints = [{ x: hw.x, y: hw.y, target: 'planet', targetId: hw.id, warp: 6, task: 'patrol', patrolRange: 80 }];
  const big = newFleet(g, foe, design(g, 1, 16, 'Battleship', 'beamWarship').id, 6, hw);
  big.x = hw.x + 30; big.y = hw.y; big.orbiting = -1;
  me.intel.fleets = me.intel.fleets.filter(x => x.id !== big.id);
  me.intel.fleets.push({ id: big.id, owner: 1, name: big.name, x: big.x, y: big.y, year: g.year, tokens: big.tokens.map(t => ({ designId: t.designId, qty: t.qty })), mass: 0 } as unknown as GameState['players'][0]['intel']['fleets'][0]);
  me.messages = [];
  processWaypointTask(g, pf, new Rng(1));
  check(pf.waypoints.length === 1 && (pf.shunned ?? []).includes(big.id) && msgs(g).some(m => m.includes('ne poursuit pas')), `the patrol does not chase a far stronger fleet (${msgs(g).find(m => m.includes('ne poursuit pas'))})`);
  // a chase that discovers the target too strong comes back
  pf.shunned = [];
  pf.waypoints = [{ x: hw.x, y: hw.y, warp: 6, task: 'none' }, { x: big.x, y: big.y, target: 'fleet', targetId: big.id, warp: 6, task: 'none', chase: true }, { x: hw.x, y: hw.y, target: 'planet', targetId: hw.id, warp: 6, task: 'patrol', patrolRange: 80 }];
  chaseChecks(g);
  check(pf.waypoints.length === 2 && pf.waypoints[1].task === 'patrol' && msgs(g).some(m => m.includes('renonce à intercepter')), 'a chase is called off when the target proves far too strong');
  // a manual interception (no chase flag) is obeyed
  pf.waypoints = [{ x: hw.x, y: hw.y, warp: 6, task: 'none' }, { x: big.x, y: big.y, target: 'fleet', targetId: big.id, warp: 6, task: 'none' }];
  chaseChecks(g);
  check(pf.waypoints.length === 2 && pf.waypoints[1].targetId === big.id, 'a manual interception is obeyed, however unwise');
  // war losses by value
  declareWar(g, 0, 1);
  const cheap = design(g, 0, 1, 'Scout', 'scout') ?? scout;
  const mk = (owner: number, did: number, qty: number, id: number) => ({ id, owner, fleetId: id, designId: did, designName: '', hull: g.designs.find(d => d.id === did)!.hull, qty, armor: 10, shields: 0, damage: 0, qtyDamaged: 0, x: 0, y: 0, initiative: 0, movement: 4, starbase: false });
  g.battles = [{ id: 1, year: g.year, x: 0, y: 0, players: [0, 1], rounds: 1, losses: { 0: 10, 1: 2 }, tokens: [mk(0, cheap.id, 10, 1), mk(1, design(g, 1, 16, 'Battleship', 'beamWarship').id, 2, 2)],
    actions: [{ t: 'fire', id: 2, target: 1, weapon: 'x', torpedo: false, shieldDmg: 0, armorDmg: 1, killed: 10, fromX: 0, fromY: 0 }, { t: 'fire', id: 1, target: 2, weapon: 'x', torpedo: false, shieldDmg: 0, armorDmg: 1, killed: 2, fromX: 0, fromY: 0 }] }];
  recordWarLosses(g);
  const pr = pairOf(g, 0, 1)!;
  check(pr.losses![0] === 10 && pr.losses![1] === 2 && pr.lossValue![1] > pr.lossValue![0], `losses are weighed by value: 10 scouts (${pr.lossValue![0]}) against 2 battleships (${pr.lossValue![1]})`);
  check(exhaustion(g, 1, 0) > exhaustion(g, 0, 1), 'the side that lost the battleships is the more tired of the war');
  g.battles = [];
}

console.log('--- guardian assessment');
{
  const g = game('v36-gd');
  g.settings.guardians = true;
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  const pl = freePlanet(g, hw, 30, 300)!;
  const gd = spawnGuardian(g, pl, 'sentinel')!;
  const sc = newFleet(g, me, design(g, 0, 6, 'Destroyer', 'beamWarship').id, 1, pl);
  me.messages = [];
  guardianAssessments(g);
  const m = msgs(g).find(x => x.startsWith('D\'après l\'équipage de'));
  check(!!gd && !!m && m.includes(sc.name) && /(moins|plus|aussi) puissante que/.test(m), `a fleet near a guardian reports on it (${m})`);
  guardianAssessments(g);
  check(msgs(g).filter(x => x.startsWith('D\'après l\'équipage de')).length === 1, 'once a year');
}

console.log('--- galaxy shapes and the classic preset');
{
  for (const [shape, size] of [['spiral', 'Small'], ['elliptical', 'Medium'], ['irregular', 'Small'], ['spiral', 'Huge']] as const) {
    const g = quickGame(undefined, size, 4, 'standard', 'shape-' + shape + size, { shape });
    const n = planetCount(size, 'Normal');
    let close = 0;
    for (const a of g.planets) for (const b of g.planets) if (a.id < b.id && Math.hypot(a.x - b.x, a.y - b.y) < 14) close++;
    const inside = g.planets.filter(p => galaxyDensity(g, p.x, p.y) > 0.02).length;
    check(!!g.shape && g.planets.length >= n * 0.97 && close === 0 && inside === g.planets.length, `${shape} ${size}: ${g.planets.length}/${n} planets, none closer than 14 al, all where stars are`);
    const homes = g.planets.filter(p => p.homeworld);
    const reach = g.width * 0.12;
    const nb = homes.map(h => g.planets.filter(p => Math.hypot(p.x - h.x, p.y - h.y) < reach).length);
    const minD = Math.min(...homes.flatMap(a => homes.filter(b => b !== a).map(b => Math.hypot(a.x - b.x, a.y - b.y))));
    check(homes.length === 5 && Math.min(...nb) >= 4 && minD > g.width * 0.12, `${shape} ${size}: homeworlds with neighbours (${nb.join(', ')}) and apart (${Math.round(minD)} al)`);
    check(g.wormholes.every(w => w.fixed || galaxyDensity(g, w.x, w.y) >= 0.12) && (g.terrain ?? []).every(t => galaxyDensity(g, t.x, t.y) >= 0.15), `${shape} ${size}: wormholes and terrain inside the galaxy`);
    const again = quickGame(undefined, size, 4, 'standard', 'shape-' + shape + size, { shape });
    check(JSON.stringify(again.planets.map(p => [p.x, p.y])) === JSON.stringify(g.planets.map(p => [p.x, p.y])), `${shape} ${size}: reproducible from the seed`);
  }
  const sq = quickGame(undefined, 'Small', 3, 'standard', 'v36-square');
  check(!sq.shape && sq.planets.length === planetCount('Small', 'Normal'), 'no shape: the square of Stars!, as before');
  // the preset
  const st = classicPreset(defaultSettings());
  check(CONSTELLATIONS_RULES.every(k => !st[k]) && st.shape === 'square' && !st.anonymousContacts && st.victory.minYears === 50 && STARS_LAST.year === 2000, 'classic preset: every Constellations rule off, square galaxy, identified contacts, 50 years');
  const cg = createGame({ name: 'classic', settings: { ...st, seed: 'v36-classic' }, players: [{ race: PREDEFINED_RACES.Humanoid(), ai: null }, { race: PREDEFINED_RACES.Humanoid(), ai: 'standard' }] });
  check(!cg.shape && cg.players.every(p => p.tplChain === false && canUseWormholes(p)) && !cg.terrain?.length, 'a classic game: no shape, no terrain, wormholes open from the start, no template chain');
  const back = constellationsPreset(classicPreset(defaultSettings()));
  check(CONSTELLATIONS_RULES.every(k => back[k]) && back.shape === 'arm' && !back.classic, 'unchecking the preset brings back every rule and a spiral arm');
}

console.log('--- populations in millions (display only)');
{
  const g = game('v36-pop');
  check(people(g, 25000).replace(/\D/g, '') === '25000', 'by default, the numbers of Stars!');
  g.settings.popUnits = 'millions';
  check(people(g, 25000).replace(/\D/g, '') === '25000000' && popScale(g) === 1000, `in millions: 25 000 colonists of the rules are ${people(g, 25000)} people`);
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  const before = hw.pop;
  generateTurn(g);
  check(hw.pop > before && hw.pop < before * 2, 'the rules do not change (growth in the units of Stars!)');
  check(classicPreset(defaultSettings()).popUnits === undefined && constellationsPreset(defaultSettings()).popUnits === 'millions', 'the classic preset keeps the numbers of Stars!');
}

console.log('--- automatic items on poor worlds');
{
  const g = game('v36-auto');
  const me = g.players[0];
  const col = g.planets.find(x => x.owner < 0)!;
  col.owner = 0; col.pop = 9000; col.factories = 0; col.mines = 0; col.queue = []; col.surface = { ironium: 500, boranium: 500, germanium: 500 };
  applyTemplate(g, col, 1);
  col.hab = [50, 50, 50]; col.baseHab = [40, 40, 40];
  const sp = planetSpec(g, col, me);
  for (let y = 0; y < 3; y++) runProduction(g, col, () => {});
  check(sp.resourcesAvailable > 2 && sp.resourcesAvailable < 20 && col.queue.every(q => q.kind !== 'terraform') && col.factories > 0, `a world of ${sp.resourcesAvailable} R a year does not start a terraforming it would take decades to pay, and builds factories instead (${col.factories})`);
  // an older save: a concrete terraforming at the head of the queue, behind which nothing is built
  col.queue.unshift({ kind: 'terraform', qty: 1, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 12 }, warned: true });
  me.messages = [];
  stuckWarnings(g);
  check(col.queue[0].kind !== 'terraform' && !msgs(g).some(m => m.includes('n\'avance pas')), 'an older stuck automatic leftover gives way, without a warning');
  // a manual order still warns
  col.queue.unshift({ kind: 'terraform', qty: 3, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } });
  stuckWarnings(g);
  check(col.queue[0].kind === 'terraform' && msgs(g).some(m => m.includes('n\'avance pas')), 'a manual order the world cannot pay is still reported');
}


console.log('--- regions of a spiral arm, dark clouds');
{
  const sizes = ['Tiny', 'Small', 'Medium', 'Large', 'Huge'] as const;
  check(SHAPES_OFFERED.join() === 'arm,nursery,bubble,square', 'the whole galaxies are no longer offered: arm, nursery, superbubble, square');
  {
    const nb = (shape: 'arm' | 'nursery' | 'bubble', size: GameState['settings']['size']) => (quickGame(undefined, size, 3, 'standard', 'v365-neb-' + shape + size, { shape }).terrain ?? []).filter(t => t.kind === 'nebula');
    const arm = nb('arm', 'Medium'), nur = nb('nursery', 'Medium'), g = quickGame(undefined, 'Medium', 3, 'standard', 'v365-neb-armMedium', { shape: 'arm' });
    const R = g.width / 2;
    const onClump = arm.every(t => g.shape!.clumps!.some(c => Math.hypot((c.x + 1) * R - t.x, (c.y + 1) * R - t.y) < c.r * R + 5));
    check(arm.length === 1 && nur.length === 3 && onClump, `bright nebulae are rare (${arm.length} in a Medium arm, ${nur.length} in a nursery), on a young association`);
  }
  for (const shape of ['arm', 'nursery', 'bubble'] as const) for (const size of sizes) {
    if (shape !== 'arm' && (size === 'Tiny' || size === 'Huge')) continue;
    const g = quickGame(undefined, size, 4, 'standard', `v363-${shape}-${size}`, { shape });
    const n = planetCount(size, 'Normal');
    const R = g.width / 2, walls = g.shape!.walls ?? [];
    const inCloud = g.planets.filter(p => cloudDepth(g.shape!, (p.x - R) / R, (p.y - R) / R) > -0.05).length;
    const main = mainRegionTest(g)!;
    const cut = g.planets.filter(p => !main(p.x, p.y)).length;
    check(walls.length >= (shape === 'nursery' ? 6 : 2) && g.planets.length >= n * 0.97 && inCloud === 0 && cut === 0, `${shape} ${size}: ${g.planets.length}/${n} worlds, ${walls.length} dark clouds, none in or right at a cloud, none shut away (${inCloud}, ${cut})`);
    let covered = 0;
    for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) if (inWall(g, (i + 0.5) * g.width / 60, (j + 0.5) * g.width / 60)) covered++;
    const pct = covered / 36, [lo, hi] = shape === 'nursery' ? [10, 33] : [1, 10];
    check(pct >= lo && pct <= hi, `${shape} ${size}: the clouds cover ${pct.toFixed(1)} % of the map (${lo} to ${hi} %: ${shape === 'nursery' ? 'a star-forming complex' : 'as around the Sun'})`);
    // a few long trips: there is always a way
    const rng = new Rng(seedFromString("v363-trips"));
    let ways = 0, blocked = 0;
    for (let k = 0; k < 12; k++) {
      const a = g.planets[rng.int(g.planets.length)], b = g.planets[rng.int(g.planets.length)];
      const d = detourPoints(g, a, b);
      if (d) ways++;
      if (segmentBlocked(g, a, b)) blocked++;
    }
    check(ways === 12, `${shape} ${size}: a way between any two worlds (${blocked}/12 straight lines cross a cloud)`);
    const cap = g.planets.find(p => p.homeworld)!, t1 = Date.now();
    const lost = g.planets.filter(p => detourPoints(g, cap, p) === null).map(p => p.name);
    check(!lost.length, `${shape} ${size}: every world can be reached from a capital (${lost.join(', ') || 'all'}, ${Date.now() - t1} ms)`);
    const homes = g.planets.filter(p => p.homeworld);
    const minD = Math.min(...homes.flatMap(a => homes.filter(b => b !== a).map(b => Math.hypot(a.x - b.x, a.y - b.y))));
    const nb = homes.map(h => g.planets.filter(p => Math.hypot(p.x - h.x, p.y - h.y) < g.width * 0.12).length);
    check(homes.length === 5 && Math.min(...nb) >= (size === 'Tiny' ? 2 : 3) && minD > g.width * 0.12, `${shape} ${size}: homeworlds with neighbours (${nb.join(', ')}) and apart (${Math.round(minD)} al)`);
    const room = homes.map(h => Math.round(-cloudAt(g.shape!, (h.x - R) / R, (h.y - R) / R).edge * R));
    check(Math.min(...room) >= Math.min(30, g.width * 0.04) - 1, `${shape} ${size}: no capital right against a cloud (${room.join(', ')} al of room)`);
    check(g.wormholes.every(w => w.fixed || (!inWall(g, w.x, w.y) && galaxyDensity(g, w.x, w.y) >= 0.12)) && (g.terrain ?? []).every(t => !inWall(g, t.x, t.y)), `${shape} ${size}: wormholes and terrain out of the clouds`);
    const again = quickGame(undefined, size, 4, 'standard', `v363-${shape}-${size}`, { shape });
    check(JSON.stringify(again.planets.map(p => [p.x, p.y])) === JSON.stringify(g.planets.map(p => [p.x, p.y])) && JSON.stringify(again.shape) === JSON.stringify(g.shape), `${shape} ${size}: reproducible from the seed`);
    if (size === 'Medium' || size === 'Tiny') {
      const t0 = Date.now(), r = cloudRaster(g, 700)!;
      const names = new Set(walls.map(cloudName));
      check(r.labels.length >= 3 && r.labels.every(l => names.has(l.name) && l.x > 0 && l.y > 0 && l.x < g.width && l.y < g.height && inWall(g, l.x, l.y)), `${shape} ${size}: the clouds are painted with their names inside the map (${r.labels.length} names, ${Date.now() - t0} ms)`);
    }
  }
  // 0.3.6.8: narrow passes carved through the clouds, open, and taken by the routes
  {
    let passes = 0, open = 0, taken = 0, tried = 0, maps = 0, withPass = 0;
    for (const [shape, size] of [['arm', 'Small'], ['arm', 'Medium'], ['arm', 'Large'], ['nursery', 'Medium'], ['nursery', 'Small'], ['arm', 'Huge']] as const) for (let k = 0; k < 3; k++) {
      const g = quickGame(undefined, size, 3, 'standard', `v368-pass-${shape}${size}${k}`, { shape });
      const R = g.width / 2, ps = g.shape!.passes ?? [];
      maps++; if (ps.length) withPass++;
      for (const c of ps) {
        passes++;
        const toMap = (u: number, v: number) => { const q = unwarp(g.shape!, u, v); return { x: (q.u + 1) * R, y: (q.v + 1) * R }; };
        const mid = toMap((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2);
        if (!inWall(g, mid.x, mid.y)) open++;
        // from one end of the pass to the other: the way goes through it (not around the cloud)
        const a = toMap(c.x1 - (c.x2 - c.x1) * 0.15, c.y1 - (c.y2 - c.y1) * 0.15), b = toMap(c.x2 + (c.x2 - c.x1) * 0.15, c.y2 + (c.y2 - c.y1) * 0.15);
        const inMap = (q: { x: number; y: number }) => q.x > 0 && q.y > 0 && q.x < g.width && q.y < g.height;
        if (!inMap(a) || !inMap(b) || inWall(g, a.x, a.y) || inWall(g, b.x, b.y)) continue;
        tried++;
        const via = detourPoints(g, a, b);
        if (via) { let len = 0, p0 = a; for (const q of [...via, b]) { len += Math.hypot(q.x - p0.x, q.y - p0.y); p0 = q; } if (len < Math.hypot(b.x - a.x, b.y - a.y) * 1.35) taken++; }
      }
    }
    check(withPass >= maps * 0.8 && passes >= maps * 1.2, `narrow passes in most maps (${passes} in ${maps} maps, ${withPass} with at least one)`);
    check(open >= passes * 0.9, `the passes are open (${open}/${passes})`);
    check(tried >= 8 && taken >= tried * 0.85, `the routes go through them rather than around (${taken}/${tried})`);
  }
  // the dust lane of an arm: a chain of clouds broken by passes
  let lanes = 0;
  for (let k = 0; k < 6; k++) { const g = quickGame(undefined, 'Medium', 3, 'standard', 'v363-lane' + k, { shape: 'arm' }); lanes += (g.shape!.walls ?? []).filter(w => w.lobes.length >= 6 && w.lobes[0].r < 0.08).length >= 2 ? 1 : 0; }
  check(lanes >= 5, `an arm has its dust lane, in pieces (${lanes}/6 maps)`);

  // a fleet goes around a cloud, as estimated
  const g = quiet(quickGame(undefined, 'Medium', 3, 'standard', 'v363-trip', { shape: 'arm' }));
  g.settings.culture = false;
  const me = g.players[0];
  let pair: [Planet, Planet] | null = null;
  for (const a of g.planets) { for (const b of g.planets) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 90 && d < 200 && segmentBlocked(g, a, b) && (detourPoints(g, a, b)?.length ?? 0) > 0) { pair = [a, b]; break; } } if (pair) break; }
  check(!!pair, `two worlds with a cloud between them (${pair?.[0].name} → ${pair?.[1].name})`);
  if (pair) {
    const [a, b] = pair;
    const f = g.fleets.find(x => x.owner === 0 && fleetSpec(g, x).hasEngines)!;
    const spec = fleetSpec(g, f);
    f.x = a.x; f.y = a.y; f.orbiting = a.id; f.fuel = spec.fuelCapacity;
    f.waypoints = [{ x: a.x, y: a.y, target: 'planet', targetId: a.id, warp: 0, task: 'none' }, { x: b.x, y: b.y, target: 'planet', targetId: b.id, warp: Math.min(6, spec.idealSpeed || 6), task: 'none' }];
    const est = estimateRoute(g, f);
    const plan = withDetours(g, f.waypoints).list;
    const straight = Math.hypot(a.x - b.x, a.y - b.y);
    check(est.length === 1 && (est[0].via?.length ?? 0) > 0 && est[0].dist > straight + 1, `the estimate follows the detour (${Math.round(est[0].dist)} al instead of ${Math.round(straight)}, ${est[0].via?.length} turn(s), ${plan.length - 2} in the route)`);
    let years = 0, inside = 0, crossed = 0;
    while (years < 30 && !(f.x === b.x && f.y === b.y)) {
      generateTurn(g); years++;
      if (inWall(g, f.x, f.y)) inside++;
      for (let i = 1; i < (f.trail?.length ?? 0); i++) if (wallStop(g, f.trail![i - 1], f.trail![i])) crossed++;
    }
    check(f.x === b.x && f.y === b.y && inside === 0 && crossed === 0, `the fleet arrives without entering a cloud (${years} years, ${inside} inside, ${crossed} crossings)`);
    check(Math.abs(years - Math.ceil(est[0].years)) <= 1, `in the estimated time (${years} years, estimate ${est[0].years})`);
    check(f.waypoints.every(w => !w.detour), 'no turn of the detour is left once there');

    // a packet thrown across the cloud is lost
    const src = a; src.owner = 0; const dst = b;
    g.packets.push({ id: 99001, owner: 0, x: src.x, y: src.y, targetId: dst.id, warp: 10, safeWarp: 10, cargo: { ironium: 500, boranium: 0, germanium: 0 }, newThisTurn: false, sourceId: src.id });
    me.messages = [];
    for (let k = 0; k < 4 && g.packets.some(p => p.id === 99001); k++) generateTurn(g);
    check(!g.packets.some(p => p.id === 99001) && msgs(g).some(m => m.includes('s\'est perdu dans')), `a mineral packet thrown across a cloud is lost (${msgs(g).find(m => m.includes('perdu'))})`);
  }
  // a point in a cloud: the nearest edge; a straight flight into one stops at its edge
  const w0 = g.shape!.walls!.find(w => { const l = w.lobes[0]; const x = (l.x + 1) * g.width / 2, y = (l.y + 1) * g.width / 2; return x > 0 && y > 0 && x < g.width && y < g.height && inWall(g, x, y); });
  if (w0) {
    const l = w0.lobes[0], c = { x: (l.x + 1) * g.width / 2, y: (l.y + 1) * g.width / 2 };
    const q = nearestOutside(g, c);
    check(!inWall(g, q.x, q.y) && Math.hypot(q.x - c.x, q.y - c.y) < l.r * g.width, `a step placed inside ${wallAt(g, c.x, c.y)} goes to its edge (${Math.round(Math.hypot(q.x - c.x, q.y - c.y))} al away)`);
    const from = g.planets.map(p => ({ p, d: Math.hypot(p.x - c.x, p.y - c.y) })).sort((x, y) => x.d - y.d)[0].p;
    const stop = wallStop(g, from, c);
    check(!!stop && !inWall(g, stop.x, stop.y) && stop.cloud === wallAt(g, c.x, c.y), `a flight from ${from.name} straight into it stops at the edge (${stop?.cloud})`);
  }
  // the computer players live with the clouds
  const ga = quickGame(undefined, 'Small', 3, 'standard', 'v363-ai', { shape: 'nursery' });
  let badPos = 0;
  for (let y = 0; y < 40; y++) { generateTurn(ga); badPos += ga.fleets.filter(f => !ga.players[f.owner].monster && inWall(ga, f.x, f.y, f.owner)).length; }
  check(badPos === 0 && ga.fleets.length > 10, `40 years of computer players in a nursery: no fleet ever inside a cloud (${ga.fleets.length} fleets)`);
}

console.log('--- radar');
{
  const g = game('v36-radar');
  g.settings.culture = false;
  const me = g.players[0], foe = g.players[1], other = g.players[2];
  me.relations[foe.id] = 'enemy'; foe.relations[0] = 'enemy';
  me.relations[other.id] = 'neutral';
  const hw = capitalOf(g, me)!;
  const fi = (id: number, owner: number, x: number, y: number) => ({ id, owner, x, y, detail: 'full' as const, name: 'F' + id, tokens: [{ designId: 0, qty: 2 }] });
  me.intel.fleets = [fi(9001, foe.id, hw.x + 20, hw.y), fi(9002, foe.id, hw.x + 140, hw.y), fi(9003, foe.id, hw.x + 400, hw.y + 300), fi(9004, other.id, hw.x + 10, hw.y)];
  me.intel.tracks[9002] = [{ year: g.year - 1, x: hw.x + 180, y: hw.y }, { year: g.year, x: hw.x + 140, y: hw.y }];
  const r = radarContacts(g, me);
  const by = (id: number) => r.find(c => c.id === id);
  check(by(9001)?.threat === 'inside' && by(9001)?.target === hw, 'an enemy next to our capital is an intruder');
  check(by(9002)?.threat === 'heading' && (by(9002)?.eta ?? 9) <= 3, `an enemy whose course leads to us is a threat (in ${by(9002)?.eta} years)`);
  check(by(9003)?.threat === null, 'an enemy elsewhere is only a contact');
  check(!by(9004), 'a fleet of an empire at peace is not on the radar');
}

console.log(bad ? `${bad} failure(s), ${good} ok` : `all good (${good})`);
process.exit(bad ? 1 : 0);
