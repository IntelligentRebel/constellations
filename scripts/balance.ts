// AI-vs-AI games with the Constellations 3 rules, to tune them (run: npx tsx scripts/balance.ts [games] [years] [size] [off]).
import { quickGame, CONSTELLATIONS_RULES } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import { planetSpec } from '../src/engine/planet';
import { DOCTRINE_FORKS } from '../src/engine/doctrines';
import { megaProgress } from '../src/engine/megaprojects';
import { OBJ } from '../src/engine/objectives';
import type { GameState } from '../src/engine/types';

const games = +(process.argv[2] ?? 4);
const years = +(process.argv[3] ?? 120);
const size = (process.argv[4] ?? 'Small') as any;
const off = process.argv[5] === 'off';
const off32 = process.argv[5] === 'off32';
const diff = (process.argv[6] ?? 'standard') as any;

const agg = {
  victories: [] as string[], effAvg: [] as number[], effMin: [] as number[], regional: [] as number[], delivered: [] as number[], convoysLost: [] as number[],
  objectivesDone: 0, objectivesTotal: 0, objById: {} as Record<string, [number, number]>, doctrines: {} as Record<string, number>,
  megaBuilt: {} as Record<string, number>, portalMax: [] as number[], battles: 0, retreats: 0, capitalsLost: 0, conquests: 0, resources: [] as number[],
  relics: [] as number[], finds: [] as number[], guardKilled: [] as number[], guardTotal: 0, origins: {} as Record<string, number[]>,
};

for (let gi = 0; gi < games; gi++) {
  const g: GameState = quickGame(undefined, size, 3, diff, `bal${gi}`);
  g.players[0].ai = diff;
  if (off) for (const k of CONSTELLATIONS_RULES) if (!['randomResearch', 'fuzzyTechTree'].includes(k)) (g.settings as any)[k] = false;
  if (off32) { g.settings.anomalies = false; g.settings.guardians = false; g.fleets = g.fleets.filter(f => f.owner !== g.monsterId); }
  let battles = 0, retreats = 0, lostCap = 0;
  const t0 = Date.now();
  for (let y = 0; y < years; y++) {
    generateTurn(g);
    battles += g.battles.length;
    for (const p of g.players) for (const m of p.messages) {
      if (m.text.includes('seuil de retraite')) retreats++;
      if (m.text.includes('Le gouvernement s\'installe')) lostCap++;
    }
    if (g.victor !== null && !agg.victories[gi]) agg.victories[gi] = `${g.victoryKind ?? 'conditions'}@${g.year - 2400}`;
  }
  agg.battles += battles; agg.retreats += retreats; agg.capitalsLost += lostCap;
  const lines: string[] = [];
  for (const p of g.players) {
    if (p.monster) continue;
    const own = g.planets.filter(x => x.owner === p.id);
    const specs = own.map(x => planetSpec(g, x, p));
    const base = specs.reduce((a, s) => a + s.resourcesBase, 0), res = specs.reduce((a, s) => a + s.resources, 0);
    const eff = base ? res / base : 1;
    if (!p.dead) { agg.effAvg.push(eff); agg.effMin.push(Math.min(1, ...specs.map(s => s.efficiency.total))); agg.resources.push(res); }
    agg.regional.push(own.filter(x => x.regionalCapital).length);
    agg.delivered.push(p.logStats?.colonists ?? 0);
    agg.convoysLost.push(p.logStats?.convoysLost ?? 0);
    agg.conquests += p.stats.planetsCaptured ?? 0;
    for (const o of p.objectives ?? []) {
      agg.objectivesTotal++; if (o.done !== undefined) agg.objectivesDone++;
      const e = agg.objById[o.id] ?? (agg.objById[o.id] = [0, 0]); e[1]++; if (o.done !== undefined) e[0]++;
    }
    for (const f of DOCTRINE_FORKS) { const c = p.doctrines?.[f.id]; if (c) { const n = f[c].name; agg.doctrines[n] = (agg.doctrines[n] ?? 0) + 1; } }
    for (const x of own) for (const m of x.megaprojects ?? []) agg.megaBuilt[m] = (agg.megaBuilt[m] ?? 0) + 1;
    let portal = 0;
    for (const x of own) for (const q of x.queue) if (q.kind === 'mega' && q.megaId === 'portal') portal = Math.max(portal, megaProgress(q));
    agg.portalMax.push(portal);
    const explored = Math.round(p.intel.planets.filter(x => x.year !== undefined).length * 100 / g.planets.length);
    const popTot = own.reduce((a, x) => a + x.pop, 0);
    lines.push(`  ${p.name.padEnd(10)} ${p.dead ? 'MORT ' : ''}${own.length}pl ${Math.round(popTot / 1000)}kpop expl ${explored}% kills ${p.stats.shipsDestroyed} cap ${p.stats.planetsCaptured ?? 0} frt ${p.stats.convoysDestroyed ?? 0} ${res}R eff ${(eff * 100).toFixed(0)}% reg ${own.filter(x => x.regionalCapital).length} log ${Math.round((p.logStats?.colonists ?? 0) / 1000)}k colons/${p.logStats?.trips ?? 0} trajets/${p.logStats?.convoysLost ?? 0} perdus obj ${(p.objectives ?? []).map(o => `${o.id}${o.done !== undefined ? '✓' + (o.done - 2400) : o.failed ? '✗' : ''}`).join(',')} doc ${Object.values(p.doctrines ?? {}).join('')} mega ${own.flatMap(x => x.megaprojects ?? []).join(',')} portail ${(portal * 100).toFixed(0)}% S${p.scores.at(-1)?.score ?? 0}`);
  }
  for (const p of g.players) if (!p.monster) {
    agg.relics.push(p.relics?.length ?? 0); agg.finds.push((p.finds?.anomalies ?? 0) + (p.finds?.chapters ?? 0));
    const o = p.origin ?? 'none'; (agg.origins[o] ??= []).push(p.scores.at(-1)?.score ?? 0);
  }
  agg.guardTotal += g.guardians?.length ?? 0;
  for (const x of g.guardians ?? []) if (!x.alive && x.killedYear) agg.guardKilled.push(x.killedYear - 2400);
  console.log(`  découvertes: ${(g.anomalies ?? []).filter(a => a.doneBy !== undefined).length}/${g.anomalies?.length ?? 0} · gardiens tués: ${(g.guardians ?? []).filter(x => !x.alive).map(x => `${x.kind}@${(x.killedYear ?? 0) - 2400}`).join(', ') || 'aucun'} · origines ${g.players.filter(p => !p.monster).map(p => p.origin).join(',')}`);
  console.log(`partie ${gi} (${Date.now() - t0} ms) victoire ${agg.victories[gi] ?? 'aucune'} batailles ${battles} retraites ${retreats} capitales perdues ${lostCap}`);
  console.log(lines.join('\n'));
}
const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
console.log('\n=== bilan', games, 'parties de', years, 'ans', size, off ? '(règles 3 désactivées)' : '');
console.log('victoires', agg.victories.map(v => v ?? '-').join(' '));
console.log('rendement moyen', (avg(agg.effAvg) * 100).toFixed(1), '% ; pire planète moyenne', (avg(agg.effMin) * 100).toFixed(1), '% ; ressources moyennes', Math.round(avg(agg.resources)));
console.log('capitales régionales par empire', avg(agg.regional).toFixed(2), '; colons livrés par empire', Math.round(avg(agg.delivered)), '; convois perdus', avg(agg.convoysLost).toFixed(2));
console.log('objectifs', agg.objectivesDone, '/', agg.objectivesTotal, Object.entries(agg.objById).map(([k, [d, t]]) => `${OBJ[k].name} ${d}/${t}`).join(', '));
console.log('doctrines', JSON.stringify(agg.doctrines));
console.log('mégaprojets', JSON.stringify(agg.megaBuilt), '; portail max moyen', (avg(agg.portalMax) * 100).toFixed(0), '%');
console.log('reliques par empire', avg(agg.relics).toFixed(2), '; découvertes par empire', avg(agg.finds).toFixed(1), '; gardiens tués', agg.guardKilled.length, '/', agg.guardTotal, agg.guardKilled.length ? `(an moyen ${Math.round(avg(agg.guardKilled))})` : '');
console.log('score moyen par origine', Object.entries(agg.origins).map(([k, v]) => `${k} ${Math.round(avg(v))} (${v.length})`).join(', '));
console.log('batailles', agg.battles, 'retraites', agg.retreats, 'capitales perdues', agg.capitalsLost, 'conquêtes', agg.conquests);
