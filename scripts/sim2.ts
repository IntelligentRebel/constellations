import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { planetSpec } from '../src/engine/planet';
import { checkInvariants } from './check';
const years = +(process.argv[2] ?? 100);
const size = (process.argv[3] ?? 'Medium') as any;
const ais = +(process.argv[5] ?? 5);
const game = quickGame(undefined, size, ais, 'expert', process.argv[4] ?? 'inv1');
game.players[0].ai = 'standard';
let total = 0, maxT = 0;
for (let y = 0; y < years; y++) {
  const t = Date.now();
  generateTurn(game);
  const dt = Date.now() - t; total += dt; maxT = Math.max(maxT, dt);
  const errs = checkInvariants(game);
  if (errs.length) { console.log('YEAR', game.year, errs.slice(0, 10)); break; }
  if (game.year % 25 === 0) {
    const line = game.players.map(p => {
      const pl = game.planets.filter(x => x.owner === p.id);
      const res = pl.reduce((a, x) => a + planetSpec(game, x, p).resources, 0);
      const tech = Object.values(p.tech).reduce((a, b) => a + b, 0);
      const fl = game.fleets.filter(f => f.owner === p.id).length;
      return p.name.slice(0, 6) + ' ' + pl.length + 'pl ' + res + 'R T' + tech + ' ' + fl + 'fl' + (p.dead ? ' X' : '');
    }).join(' | ');
    console.log(game.year, line, 'battles', game.battles.length, 'mines', game.minefields.length, 'packets', game.packets.length);
  }
}
console.log('avg ms/turn', Math.round(total / years), 'max', maxT, 'json KB', Math.round(JSON.stringify(game).length / 1024));
