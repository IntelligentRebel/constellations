// AI tournament: all-AI game with chosen races. usage: tsx scripts/sim3.ts <years> <size> <seed> <raceIdx,raceIdx,...> [difficulty]
import { createGame, defaultSettings } from '../src/engine/newgame';
import { AI_RACES } from '../src/engine/airaces';
import { generateTurn } from '../src/engine/turn';
import { planetSpec } from '../src/engine/planet';
import { checkInvariants } from './check';
const years = +(process.argv[2] ?? 100);
const settings = defaultSettings();
settings.size = (process.argv[3] ?? 'Medium') as any;
settings.seed = process.argv[4] ?? 't1';
const idx = (process.argv[5] ?? '0,1,2,3,4').split(',').map(Number);
const diff = (process.argv[6] ?? 'standard') as any;
const game = createGame({ name: 'sim', settings, players: idx.map(i => { const r = AI_RACES[i](); return { race: r, ai: diff, name: r.pluralName }; }) });
const stats = { conquests: 0, invFail: 0, colonies: 0 };
let total = 0;
for (let y = 0; y < years; y++) {
  const t = Date.now();
  generateTurn(game);
  total += Date.now() - t;
  for (const p of game.players) for (const m of p.messages) {
    if (/ont conquis|Vos troupes ont conquis/.test(m.text)) stats.conquests++;
    if (/invasion de .* a échoué/.test(m.text)) stats.invFail++;
  }
  const errs = checkInvariants(game);
  if (errs.length) { console.log('YEAR', game.year, errs.slice(0, 10)); break; }
  if (game.year % 20 === 0 || y === years - 1) {
    console.log(game.year, 'battles', game.battles.length, 'mines', game.minefields.length, 'packets', game.packets.length, JSON.stringify(stats));
    for (const p of game.players) {
      const pl = game.planets.filter(x => x.owner === p.id);
      const res = pl.reduce((a, x) => a + planetSpec(game, x, p).resources, 0);
      const pop = pl.reduce((a, x) => a + x.pop, 0);
      const ships = game.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.tokens.reduce((b, t) => b + t.qty, 0), 0);
      console.log('   ', (p.race.prt + ' ' + p.name).padEnd(18), String(pl.length).padStart(3) + 'pl', String(Math.round(pop / 1000)).padStart(6) + 'k', String(res).padStart(6) + 'R', 'T' + Object.values(p.tech).join('/'), String(ships).padStart(4) + 'sh', 'S' + (p.scores.at(-1)?.score ?? 0), p.dead ? 'DEAD' : '', p.aiState?.phase ?? '', p.aiState?.targetPlayer ?? '');
    }
  }
}
console.log('avg ms/turn', Math.round(total / years), 'json KB', Math.round(JSON.stringify(game).length / 1024));
