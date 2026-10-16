// AI games with the pirates (and later the crisis), to tune them: npx tsx scripts/factions-sim.ts [games] [years] [size] [seedPrefix] [difficulty]
import { quickGame } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import type { GameState } from '../src/engine/types';
import { liveLairs, lairStrength } from '../src/engine/pirates';
import { fleetStrength } from '../src/engine/factions';
import { nexusStrength, navyStrength, waves } from '../src/engine/crisis';

const games = +(process.argv[2] ?? 3), years = +(process.argv[3] ?? 120), size = (process.argv[4] ?? 'Small') as any;
const prefix = process.argv[5] ?? 'fs', diff = (process.argv[6] ?? 'standard') as any;
const agg = { raids: 0, plunders: 0, loot: 0, repelled: 0, killedRaids: 0, lairsKilled: [] as number[], lairs: 0, dead: 0, ended: 0, crisis: [] as string[] };

for (let gi = 0; gi < games; gi++) {
  const g: GameState = quickGame(undefined, size, 3, diff, `${prefix}${gi}`);
  g.players[0].ai = diff;
  let raids = 0, plunders = 0, loot = 0, repelled = 0;
  const lines: string[] = [];
  const raidIds = new Set<number>();
  let killedRaids = 0, spyCaught = 0;
  const harvested = new Set<number>();
  const t0 = Date.now();
  for (let y = 0; y < years; y++) {
    const before = new Set(g.fleets.filter(f => f.raid?.kind === 'pirates' && f.raid.phase !== 'home').map(f => f.id));
    generateTurn(g);
    for (const id of before) if (!g.fleets.some(f => f.id === id)) killedRaids++;
    for (const f of g.fleets) if (f.raid) raidIds.add(f.id);
    for (const p of g.players) for (const m of p.messages) {
      if (m.text.startsWith('Alerte pirate')) raids++;
      if (m.text.startsWith('Raid pirate sur')) { plunders++; loot += +(m.text.match(/: ([\d\s  ]+) kt/)?.[1] ?? '0').replace(/\D/g, ''); }
      if (m.text.includes('rebrousse chemin') || m.text.includes('trop bien défendue')) repelled++;
      if (m.text.includes('ont démasqué une partie de votre réseau')) spyCaught++;
      if (m.text.includes('entièrement dépeuplée') && p.id !== (g.crisis?.id ?? -9)) harvested.add(m.target?.id ?? -1);
    }
    if ((g.year - 2400) % 10 === 0 && g.pirates?.emerged) {
      const lairs = liveLairs(g).map(l => Math.round(lairStrength(g, l) / 1000) + 'k').join(',');
      const best = g.players.filter(p => !p.monster && !p.dead).map(p => {
        const byPl = new Map<number, number>();
        for (const f of g.fleets) if (f.owner === p.id && f.purpose === 'warship' && f.orbiting >= 0) byPl.set(f.orbiting, (byPl.get(f.orbiting) ?? 0) + fleetStrength(g, f));
        return Math.round(Math.max(0, ...byPl.values()) / 1000) + 'k';
      }).join('/');
      const C = g.crisis;
      const cr = C && C.phase !== 'dormant' ? ` | crisis ${C.phase} wave ${C.wave} nexus ${Math.round(nexusStrength(g) / 1e6)}M navies ${g.players.filter(p => !p.monster && !p.dead).map(p => Math.round(navyStrength(g, p.id) / 1e6) + 'M').join('/')} waves ${waves(g).map(w => `${w.tokens.reduce((a, t) => a + t.qty, 0)}→${g.planets[w.raid!.target].name}`).join(',')}` : '';
      lines.push(`${g.year}: lairs [${lairs}] best stacks ${best} treasure ${g.pirates.treasure} bounty ${JSON.stringify(g.pirates.bounty)}${cr}`);
    }
  }
  const P = g.pirates!;
  agg.raids += raids; agg.plunders += plunders; agg.loot += loot; agg.repelled += repelled; agg.killedRaids += killedRaids;
  agg.lairs += P.lairs.length;
  for (const l of P.lairs) if (!l.alive) agg.lairsKilled.push(l.killedYear! - 2400);
  if (P.ended) agg.ended++;
  agg.dead += g.players.filter(p => !p.monster && p.dead).length;
  console.log(`game ${gi} (${((Date.now() - t0) / 1000).toFixed(0)} s): emerged ${P.emergeYear}, ${raids} raids, ${plunders} plunders (${loot} kt), ${repelled} repelled, ${killedRaids} raids destroyed, lairs ${P.lairs.map(l => l.alive ? 'standing' : `killed ${l.killedYear} by ${l.killedBy}`).join(', ')}, empires dead ${g.players.filter(p => !p.monster && p.dead).length}, victor ${g.victor ?? '-'} ${g.victoryKind ?? ''}`);
  const C = g.crisis;
  const dl = g.diplomacy?.log ?? [];
  const cnt = (re: RegExp) => dl.filter(e => re.test(e.text)).length;
  console.log(`    diplomacy: ${cnt(/déclarent la guerre/)} wars, ${cnt(/^Paix/)} peaces, ${cnt(/^Accord|^Coopération/)} treaties, ${cnt(/^Alliance/)} alliances, ${cnt(/tribut/)} tributes, ${cnt(/offrent/)} gifts; at war now: ${Object.entries(g.diplomacy?.pairs ?? {}).filter(([, p]) => p.status === 'war').map(([k]) => k).join(' ') || 'none'}`);
  {
    const emps = g.players.filter(p => !p.monster);
    const lv = emps.flatMap(p => Object.entries(p.intel.dossiers ?? {}).filter(([k]) => !g.players[+k].dead).map(([, d]) => d.level));
    const caught = emps.reduce((a, p) => a + p.messages.length * 0, 0);
    console.log(`    intel: ${cnt(/^Ambassades/)} embassies opened (${Object.values(g.diplomacy?.pairs ?? {}).filter(p => p.embassy !== undefined).length} open), ${g.planets.filter(x => x.agency).length} agencies, ${emps.reduce((a, p) => a + Object.values(p.intel.dossiers ?? {}).filter(d => (d.network ?? 0) >= 1).length, 0)} networks, ${spyCaught} caught; levels min ${Math.min(...lv)} avg ${Math.round(lv.reduce((a, x) => a + x, 0) / Math.max(1, lv.length))} max ${Math.max(...lv)}`);
    void caught;
  }
  if (C) { const s = `crisis ${C.phase} omen ${C.omenYear} open ${C.openYear} waves ${C.wave} ended ${C.endedYear ?? '-'} by ${C.endedBy ?? '-'}, worlds emptied ${harvested.size}`; console.log('   ', s); agg.crisis.push(s); }
  for (const l of lines) console.log('   ', l);
}
console.log(`TOTAL ${games} games: ${agg.raids} raids, ${agg.plunders} plunders (${agg.loot} kt), ${agg.repelled} repelled, ${agg.killedRaids} destroyed, lairs killed ${agg.lairsKilled.length}/${agg.lairs} at years ${agg.lairsKilled.sort((a, b) => a - b).join(',')}, pirates ended ${agg.ended}, empires dead ${agg.dead}`);
for (const c of agg.crisis) console.log('  ', c);
