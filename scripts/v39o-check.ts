// Constellations 0.3.9.19 checks: the common enemy. When an empire dominates the galaxy, the others draw together
// against it in proportion to its lead (run: npx tsx scripts/v39o-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { quickGame } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES } = await import('../src/engine/race');
  const { generateTurn } = await import('../src/engine/turn');
  const DIP = await import('../src/engine/diplomacy');
  type G = ReturnType<typeof quickGame>;

  // a human (0) and three standard computers (1-3), past the years when the first scores mean little
  const base = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 3, 'standard', 'v39o');
  base.settings.cataclysms = false;
  while (base.year < 2432) generateTurn(base);
  const raw = JSON.stringify(base);
  const fresh = (): G => {
    const g: G = JSON.parse(raw);
    g.settings.publicScores = true;
    for (const p of g.players) if (!p.monster) for (const q of g.players) if (!q.monster && q.id !== p.id && !p.intel.met.includes(q.id)) p.intel.met.push(q.id);
    return g;
  };
  const setScores = (g: G, s: number[]) => { s.forEach((v, id) => { const p = g.players[id]; if (!p.scores.length) p.scores.push({ year: g.year, score: v } as any); p.scores[p.scores.length - 1].score = v; }); };
  const line = (g: G, of: number, about: number, start: string) => DIP.opinion(g, of, about).lines.find(l => l.label.startsWith(start))?.value ?? 0;
  const L = (g: G, id: number) => g.players[id].name;

  console.log('--- how far an empire dominates');
  {
    const g = fresh();
    const t = (lead: number) => { setScores(g, [600, 600 * lead, 600, 600]); return DIP.runaway(g, 1); };
    check(t(1.2) === 0 && Math.abs(t(1.85) - 0.5) < 0.01 && t(2.5) === 1 && t(4) === 1, `in proportion to its lead over the next one: 1.2 times → ${t(1.2)}, 1.85 → ${t(1.85)}, 2.5 → ${t(2.5)}`);
    setScores(g, [600, 1500, 600, 600]);
    g.year = 2420;
    const early = DIP.runaway(g, 1);
    g.year = 2432;
    check(Math.abs(early - DIP.runaway(g, 1) / 2) < 0.01, `in 2420 the first scores count for half (${early})`);
  }

  console.log('--- the common enemy');
  {
    const g = fresh();
    setScores(g, [600, 1500, 600, 600]);
    const r23 = line(g, 2, 3, 'Rival commun'), r20 = line(g, 2, 0, 'Rival commun'), vs1 = line(g, 2, 1, 'Votre avance');
    check(r23 === 50 && r20 === 50, `a computer dominates: the others like each other better, the human too (+${r23}, +${r20})`);
    check(vs1 === -40, `and the dominant one less (${vs1})`);
    setScores(g, [600, 1110, 600, 600]);
    check(line(g, 2, 3, 'Rival commun') === 25, `in proportion to its lead (1.85 times: +${line(g, 2, 3, 'Rival commun')})`);
    setScores(g, [600, 1500, 600, 600]);
    const before = DIP.opinion(g, 2, 3).total;
    DIP.remember(g, 2, 3, 'war', -40, 0);
    check(line(g, 2, 3, 'Rival commun') === 50 && DIP.opinion(g, 2, 3).total === before - 40, 'even between empires that dislike each other');
    // not with one that has sworn your ruin
    g.settings.nemesis = true;
    g.nemeses = [{ of: 0, ai: 2, since: g.year, peak: 3 } as any];
    check(line(g, 2, 0, 'Rival commun') === 0 && line(g, 3, 0, 'Rival commun') === 50, 'except toward the one a computer has sworn to destroy');
    g.nemeses = [];
    // not toward an ally of the dominant empire
    DIP.sign(g, 1, 3, 'alliance');
    check(line(g, 2, 3, 'Rival commun') === 0, 'nor toward an ally of the dominant empire');
  }

  console.log('--- the levels');
  {
    const g = fresh();
    setScores(g, [1500, 600, 600, 600]);
    check(line(g, 2, 0, 'Votre avance') === -40, `the human dominates: a standard computer bands together against it (${line(g, 2, 0, 'Votre avance')})`);
    g.players[2].ai = 'easy';
    check(line(g, 2, 0, 'Votre avance') === 0 && line(g, 2, 3, 'Rival commun') === 0, 'an easy one never against a human');
    setScores(g, [600, 1500, 600, 600]);
    check(line(g, 2, 0, 'Rival commun') === 50, 'but it rallies with the human against a computer');
  }

  console.log('--- alliances against it');
  {
    const g = fresh();
    setScores(g, [600, 1500, 600, 600]);
    const a = DIP.evaluate(g, 2, 0, 'alliance');
    check(a.why.includes('au moins 30') && a.why.includes(`contre les ${L(g, 1)}`), `an alliance against it needs less opinion: « ${a.why} »`);
    // the computers offer it, to the human too
    const h = fresh();
    setScores(h, [600, 1500, 600, 600]);
    DIP.remember(h, 2, 0, 'gift', 30, 0); DIP.remember(h, 3, 0, 'gift', 30, 0);
    for (let y = 0; y < 8 && !h.diplomacy!.proposals.some(p => p.to === 0 && p.kind === 'alliance'); y++) { h.year++; setScores(h, [600, 1500, 600, 600]); DIP.runDiplomacy(h); }
    const prop = h.diplomacy!.proposals.find(p => p.to === 0 && p.kind === 'alliance');
    const msg = h.players[0].messages.find(m => m.text.includes('vous proposent une alliance contre'));
    check(!!prop && prop.against === 1 && !!msg, `the human is offered an alliance against them: « ${msg?.text.slice(0, 110)}… »`);
    if (prop) { DIP.answer(h, prop.id, true); check(DIP.statusOf(h, 0, prop.from) === 'alliance' && (h.chronicle?.events ?? []).some(e => /contre la domination/.test((e as any).text ?? '')), 'accepted: the alliance is signed, and the chronicle tells against whom'); }
    // between computers
    const k = fresh();
    setScores(k, [600, 1500, 600, 600]);
    for (let y = 0; y < 12 && DIP.statusOf(k, 2, 3) !== 'alliance'; y++) { k.year++; setScores(k, [600, 1500, 600, 600]); DIP.runDiplomacy(k); }
    check(DIP.statusOf(k, 2, 3) === 'alliance', `two computers ally against it (${k.year})`);
  }

  console.log('--- war on it');
  {
    const g = fresh();
    setScores(g, [600, 1500, 600, 600]);
    DIP.sign(g, 2, 3, 'alliance'); DIP.sign(g, 2, 0, 'alliance');
    const w = DIP.warDesire(g, 2, 1);
    (globalThis as any).__aiOff = new Set(['coalition']);
    const w0 = DIP.warDesire(g, 2, 1);
    (globalThis as any).__aiOff = undefined;
    check(w - w0 >= 34, `readier for war against it (${w0} → ${w})`);
    g.players[0].messages = [];
    DIP.declareWar(g, 2, 1);
    check(DIP.statusOf(g, 3, 1) === 'war', 'one attacks it: its computer allies follow');
    check(DIP.statusOf(g, 0, 1) !== 'war' && g.players[0].messages.some(m => m.text.includes('pour contenir leur avance')), 'the human ally is told, and free to follow or not');
  }

  console.log(`\n${good} ok, ${bad} failed`);
  if (bad) process.exit(1);
}
main();
