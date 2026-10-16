import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { planetSpec } from '../src/engine/planet';
import { fleetSpec } from '../src/engine/fleet';

const years = +(process.argv[2] ?? 60);
const size = (process.argv[3] ?? 'Small') as any;
const game = quickGame(undefined, size, 3, 'standard', process.argv[4] ?? 'sim1', process.env.SHAPE ? { shape: process.env.SHAPE as 'arm' } : undefined);
game.players[0].ai = 'standard';
console.log('planets', game.planets.length, 'designs', game.designs.length, 'fleets', game.fleets.length);
for (const d of game.designs.filter(d => d.owner === 0)) console.log('  design', d.name, d.hull, JSON.stringify(d.slots));
const t0 = Date.now();
for (let y = 0; y < years; y++) {
  const t = Date.now();
  generateTurn(game);
  const dt = Date.now() - t;
  if (game.year % 10 === 0 || dt > 2000) {
    const line = game.players.map(p => {
      const pl = game.planets.filter(x => x.owner === p.id);
      const pop = pl.reduce((a, x) => a + x.pop, 0);
      const res = pl.reduce((a, x) => a + planetSpec(game, x, p).resources, 0);
      const ships = game.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.tokens.reduce((b, t) => b + t.qty, 0), 0);
      const tech = Object.values(p.tech).join('/');
      return `${p.name.slice(0, 8)}:${pl.length}pl ${Math.round(pop / 1000)}k ${res}R ${ships}sh T${tech} S${p.scores.at(-1)?.score ?? 0}${p.dead ? ' DEAD' : ''}`;
    }).join(' | ');
    console.log(game.year, `${dt}ms`, line, 'battles', game.battles.length);
  }
}
const stranded = game.fleets.filter(f => f.fuel <= 0 && f.orbiting < 0);
console.log('total', Date.now() - t0, 'ms; stranded fleets without fuel in deep space:', stranded.length, stranded.map(f => `${game.players[f.owner].name}:${f.name}`).slice(0, 10));
console.log('victor', game.victor);
const msgs = game.players[0].messages.slice(0, 15).map(m => m.text);
console.log(msgs.join('\n'));
