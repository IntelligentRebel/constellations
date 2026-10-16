// Culture balance: radii, territory, assimilations over AI-only games (run: npx tsx scripts/culture-sim.ts [years] [games] [size]).
import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { radius, territoryGrid, isCapital, cultureGain, assimilation, territoryOwner } from '../src/engine/culture';

const years = +(process.argv[2] ?? 150), games = +(process.argv[3] ?? 3), size = (process.argv[4] ?? 'Small') as 'Small' | 'Medium';
const marks = [10, 25, 50, 75, 100, 150, 200].filter(y => y <= years);
const agg: Record<number, { cap: number[]; col: number[]; youngCol: number[]; cover: number[]; neutral: number[]; flips: number; refused: number; gain: number[]; bld: number; pressed: number; inForeign: number; maxProg: number; ratios: number[] }> = {};
for (const m of marks) agg[m] = { cap: [], col: [], youngCol: [], cover: [], neutral: [], flips: 0, refused: 0, gain: [], bld: 0, pressed: 0, inForeign: 0, maxProg: 0, ratios: [] };
let flipsTotal = 0, refusedTotal = 0;
const flipLog: string[] = [];
for (let gi = 0; gi < games; gi++) {
  const g = quickGame(undefined, size, 3, 'standard', `cult-${gi}`);
  g.players[0].ai = 'standard';
  const owners0 = new Map<number, number>();
  for (let y = 1; y <= years; y++) {
    const before = new Map(g.planets.map(p => [p.id, p.owner]));
    generateTurn(g);
    for (const p of g.players) for (const m of p.messages) if (m.text.includes('dans le territoire des')) refusedTotal++;
    for (const pl of g.planets) {
      const b = before.get(pl.id)!;
      if (b >= 0 && pl.owner >= 0 && b !== pl.owner && pl.colonizedYear === g.year && pl.conqueredYear === undefined) { flipsTotal++; if (flipLog.length < 12) flipLog.push(`${g.year} ${pl.name}: ${g.players[b].name} → ${g.players[pl.owner].name} (pop ${pl.pop})`); }
    }
    if (agg[y]) {
      const a = agg[y];
      for (const pl of g.planets) {
        if (pl.owner < 0 || g.players[pl.owner].monster) continue;
        (isCapital(g, pl) ? a.cap : a.col).push(radius(pl));
        if (!isCapital(g, pl) && g.year - (pl.colonizedYear ?? 2400) <= 15) a.youngCol.push(radius(pl));
        a.gain.push(cultureGain(g, pl).total);
        a.bld += (pl.cultureBld ?? []).length;
        const as = assimilation(g, pl);
        if (as.rate > 0) a.pressed++;
        if (as.by >= 0) a.ratios.push(as.ratio);
        if (territoryOwner(g, { x: pl.x + 3, y: pl.y }) !== pl.owner) a.inForeign++;
        a.maxProg = Math.max(a.maxProg, pl.assim?.progress ?? 0);
      }
      const t = territoryGrid(g, { ...g.players[0], intel: { ...g.players[0].intel, planets: g.planets.map(p => ({ id: p.id, owner: p.owner })) } } as any);
      const counts = new Map<number, number>();
      for (const o of t.grid) counts.set(o, (counts.get(o) ?? 0) + 1);
      a.neutral.push((counts.get(-1) ?? 0) / t.grid.length);
      for (const [o, n] of counts) if (o >= 0) a.cover.push(n / t.grid.length);
      a.flips = flipsTotal; a.refused = refusedTotal;
    }
  }
  void owners0;
}
const avg = (x: number[]) => x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0;
const mx = (x: number[]) => x.length ? Math.max(...x) : 0;
for (const m of marks) {
  const a = agg[m];
  console.log(`an ${m}: capitales R moy ${avg(a.cap).toFixed(0)} (max ${mx(a.cap).toFixed(0)}) · colonies R moy ${avg(a.col).toFixed(0)} (max ${mx(a.col).toFixed(0)}) · jeunes colonies ${avg(a.youngCol).toFixed(0)} · gain moy ${avg(a.gain).toFixed(1)}/an · territoire par empire ${(avg(a.cover) * 100).toFixed(1)} % (max ${(mx(a.cover) * 100).toFixed(1)} %) · espace neutre ${(avg(a.neutral) * 100).toFixed(0)} % · bâtiments ${a.bld} · bascules cumulées ${a.flips} · colonisations refusées ${a.refused} · sous pression ${a.pressed} (max ${a.maxProg.toFixed(0)}) · ratios>1 ${a.ratios.filter(r => r > 1).length}/${a.ratios.length} max ${mx(a.ratios).toFixed(2)} · entourées ${a.inForeign}`);
}
for (const l of flipLog) console.log('  ', l);
