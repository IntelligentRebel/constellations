// Galaxy technology over time in AI games (calibration of the pirates and the crisis).
import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { FIELDS } from '../src/engine/types';
const games = +(process.argv[2] ?? 2), years = +(process.argv[3] ?? 120), size = (process.argv[4] ?? 'Small') as any;
const rows: Record<number, number[][]> = {};
for (let gi = 0; gi < games; gi++) {
  const g = quickGame(undefined, size, 3, 'standard', `tc${gi}`);
  g.players[0].ai = 'standard';
  for (let y = 0; y < years; y++) {
    generateTurn(g);
    if ((g.year - 2400) % 10 === 0) {
      const lv = g.players.filter(p => !p.monster && !p.dead).map(p => { const v = FIELDS.map(f => p.tech[f]).sort((a, b) => b - a); return (v[0] + v[1] + v[2]) / 3; });
      const sc = g.players.filter(p => !p.monster && !p.dead).map(p => p.scores[p.scores.length - 1]?.score ?? 0).sort((a, b) => b - a);
      const ws = g.fleets.filter(f => !g.players[f.owner].monster && f.purpose === 'warship').length;
      (rows[g.year] ??= []).push([lv.reduce((a, b) => a + b, 0) / lv.length, Math.max(...lv), sc[0], sc[1] ?? 0, ws]);
    }
  }
}
for (const [y, r] of Object.entries(rows)) console.log(y, r.map(x => x.map(v => v.toFixed(1)).join('/')).join('  '));
