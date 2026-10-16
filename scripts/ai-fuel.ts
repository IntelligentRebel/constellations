// How well do the AIs manage fuel? Counts, over AI-only games, the fleets crawling or stranded for want of fuel
// (run: npx tsx scripts/ai-fuel.ts [years] [games] [size]).
import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { fleetSpec, canRefuelAt, estimateRoute } from '../src/engine/fleet';

const years = +(process.argv[2] ?? 120), games = +(process.argv[3] ?? 3), size = (process.argv[4] ?? 'Small') as 'Small' | 'Medium';
const tot = { fleetYears: 0, moving: 0, dry: 0, crawl: 0, stranded: 0, legBad: 0 };
const byPurpose: Record<string, { n: number; dry: number; crawl: number; stranded: number }> = {};
const scoutRange: number[] = [];
const tk = { built: 0, serving: 0, duty: 0, pickets: 0 };
const samples: string[] = [];
for (let gi = 0; gi < games; gi++) {
  const g = quickGame(undefined, size, 3, 'standard', `fuel-${gi}`);
  g.players[0].ai = 'standard';
  for (let y = 0; y < years; y++) {
    generateTurn(g);
    if (y < 10) continue;
    for (const f of g.fleets) { const p = g.players[f.owner]; if (!p.ai || p.monster) continue; if (f.purpose === 'tanker') { tk.built++; if (f.refuelFor !== undefined) tk.serving++; else if (f.waypoints[0]?.task === 'refuel') tk.duty++; } if (f.purpose === 'picket') tk.pickets++; }
    for (const f of g.fleets) {
      const p = g.players[f.owner];
      if (!p.ai || p.monster) continue;
      const sp = fleetSpec(g, f);
      if (!sp.hasEngines || sp.fuelCapacity <= 0) continue;
      tot.fleetYears++;
      const k = f.purpose ?? (sp.colonizer ? 'colonizer' : sp.miningRate > 0 ? 'miner' : sp.cargoCapacity > 0 ? 'freighter' : sp.hasWeapons ? 'warship' : 'other');
      const b = byPurpose[k] ??= { n: 0, dry: 0, crawl: 0, stranded: 0 };
      b.n++;
      const dock = f.orbiting >= 0 && canRefuelAt(g, p, g.planets[f.orbiting]);
      if (f.outOfFuel) { tot.dry++; b.dry++; }
      if (f.waypoints.length > 1) {
        tot.moving++;
        const ideal = sp.idealSpeed || 5;
        if (f.lastWarp > 0 && f.lastWarp <= 2 && ideal >= 5 && sp.freeSpeed < 2) {
          tot.crawl++; b.crawl++;
          if (samples.length < 25 && y % 7 === 0) samples.push(`${g.year} ${p.name} ${f.name} [${k}] W${f.lastWarp} fuel ${Math.round(f.fuel)}/${sp.fuelCapacity} legs ${f.waypoints.slice(1).map(w => w.warp).join(',')}`);
        }
        if (!estimateRoute(g, f).every(l => l.ok)) tot.legBad++;
      }
      if (!dock && f.fuel < 1 && sp.freeSpeed < 2) { tot.stranded++; b.stranded++; }
    }
  }
  for (const d of g.designs) {
    const p = g.players[d.owner];
    if (!p?.ai || p.monster || d.purpose !== 'scout') continue;
    const f = g.fleets.find(x => x.tokens.some(t => t.designId === d.id));
    if (f) scoutRange.push(Math.round(fleetSpec(g, f).estimatedRange));
  }
}
const pc = (a: number, b: number) => `${(a / Math.max(1, b) * 100).toFixed(1)} %`;
console.log(`fleet-years ${tot.fleetYears} · moving ${tot.moving} · ran dry this year ${tot.dry} (${pc(tot.dry, tot.moving)} of moving) · crawling W≤2 ${tot.crawl} (${pc(tot.crawl, tot.moving)}) · stranded at 0 fuel ${tot.stranded} (${pc(tot.stranded, tot.fleetYears)}) · routes with an impossible leg ${tot.legBad}`);
for (const [k, b] of Object.entries(byPurpose).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(16)} n ${String(b.n).padStart(6)} · dry ${pc(b.dry, b.n)} · crawl ${pc(b.crawl, b.n)} · stranded ${pc(b.stranded, b.n)}`);
console.log(`tanker-years ${tk.built} (on duty ${tk.duty}, serving a fleet ${tk.serving}) · picket-years ${tk.pickets}`);
console.log('scout ranges (ly):', scoutRange.sort((a, b) => a - b).join(' '));
for (const s of samples) console.log('  ', s);
