// Values observed in the real Stars! 2.7 (Windows 3.11 under DOSBox-X), replayed in the engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, defaultSettings, quickGame, classicRules, CONSTELLATIONS_RULES } from '../src/engine/newgame';
import { PREDEFINED_RACES, habitability } from '../src/engine/race';
import { terraformRemaining, planetSpec } from '../src/engine/planet';
import { researchCost } from '../src/engine/research';
import { resolveBattles } from '../src/engine/battle';
import { Rng } from '../src/engine/rng';
import { generateTurn } from '../src/engine/turn';
import type { GameState } from '../src/engine/types';

/** Stars! rules exactly: no hidden tech-tree shift, no random breakthroughs. */
function stars<T extends GameState>(g: T): T { classicRules(g); return g; }

test('planet value 63 % (72 % terraformed) for 1.48g / -68°C / 61mR, Humanoids year 2404', () => {
  const g = stars(quickGame(undefined, 'Small', 1, 'standard', 'fid1'));
  const me = g.players[0];
  const hab: [number, number, number] = [62, 33, 61];
  assert.equal(habitability(me.race, hab), 63);
  const pl = { ...g.planets[0], hab, baseHab: hab, terraformed: [0, 0, 0] as [number, number, number] };
  const rem = terraformRemaining(me, pl);
  assert.equal(habitability(me.race, hab.map((v, i) => v + rem[i]) as [number, number, number]), 72);
});

test('homeworld economy: 43 700 colonists, 19 factories, 14 mines, conc 107/108/59', () => {
  const g = stars(quickGame(undefined, 'Small', 1, 'standard', 'fid2'));
  const me = g.players[0];
  const hw = g.planets.find(p => p.owner === 0 && p.homeworld)!;
  hw.pop = 43700; hw.factories = 19; hw.mines = 14; hw.conc = { ironium: 107, boranium: 108, germanium: 59 };
  const sp = planetSpec(g, hw, me);
  assert.equal(sp.resources, 62);          // Stars!: "53 of 62" with 15 % research
  assert.deepEqual([sp.mining.ironium, sp.mining.boranium, sp.mining.germanium], [14, 15, 8]);
});

test('research cost: Energy 3 -> 4 costs 390 at the start for Humanoids', () => {
  const g = stars(quickGame(undefined, 'Small', 1, 'standard', 'fid3'));
  assert.equal(researchCost(g, g.players[0], 'energy'), 390);
});

test('battle VCR: Armed Probe vs Space Station dies at (6,4) in round 5 to a 20 dp laser shot', () => {
  const settings = defaultSettings(); settings.size = 'Small'; settings.seed = 'bt1'; for (const k of CONSTELLATIONS_RULES) (settings as any)[k] = false;
  const g = createGame({ name: 'bt', settings, players: [{ race: PREDEFINED_RACES.Humanoid(), ai: null }, { race: PREDEFINED_RACES.Rabbitoid(), ai: null, name: 'Hawks' }] });
  const hw1 = g.planets.find(p => p.owner === 1 && p.homeworld)!;
  const probe = g.fleets.find(f => f.owner === 0 && f.name.startsWith('Sonde armée'))!;
  probe.x = hw1.x; probe.y = hw1.y; probe.orbiting = hw1.id;
  probe.waypoints = [{ x: hw1.x, y: hw1.y, target: 'planet', targetId: hw1.id, warp: 0, task: 'none' }];
  g.fleets = g.fleets.filter(f => f === probe || (f.owner === 1 && f.name.startsWith('Éclaireur Horizon')));
  for (const f of g.fleets) if (f.owner === 1) { f.x = hw1.x; f.y = hw1.y; f.orbiting = hw1.id; }
  const [b] = resolveBattles(g, new Rng(g.rng));
  assert.ok(b);
  assert.equal(b.rounds, 5);
  assert.deepEqual(b.tokens.find(t => t.owner === 0)!.x, 1); // starts at (1,4) like Stars!
  const kill = b.actions.find(a => a.t === 'fire' && a.killed > 0) as any;
  assert.equal(kill.armorDmg, 20);
  const lastMove = [...b.actions].reverse().find(a => a.t === 'move' && a.id === b.tokens.find(t => t.owner === 0)!.id) as any;
  assert.deepEqual([lastMove.x, lastMove.y], [6, 4]);
});

test('AI fleets never end a year without fuel in deep space', () => {
  const g = stars(quickGame(undefined, 'Small', 3, 'standard', 'fid5'));
  g.players[0].ai = 'standard';
  for (let y = 0; y < 80; y++) {
    generateTurn(g);
    assert.equal(g.fleets.filter(f => f.fuel <= 0 && f.orbiting < 0).length, 0, `year ${g.year}`);
  }
});
