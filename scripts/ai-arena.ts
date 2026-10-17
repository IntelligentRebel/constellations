// 0.3.9.14: the AI arena. Half the computers play the current AI, the other half a frozen copy of an older one
// (OLD=<path to its src/engine>), in the same games; the slots are swapped on a second game of the same seed so the
// map does not favour either side. Prints the scores, worlds and survival of both sides.
// run: OLD=/path/to/old/src/engine npx tsx scripts/ai-arena.ts <seed> [years=100] [level=expert] [size=Medium]
async function main() {
  const [seed = 'arena1', yearsArg = '100', level = 'expert', size = 'Medium'] = process.argv.slice(2);
  const oldDir = process.env.OLD;
  // behaviours of the new AI switched off (OFF=refit,station...), to measure what each one is worth
  if (process.env.OFF) (globalThis as { __aiOff?: Set<string> }).__aiOff = new Set(process.env.OFF.split(','));
  if (!oldDir) { console.log('OLD=<path to the old src/engine> is needed'); process.exit(1); }
  const { createGame, defaultSettings } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES } = await import('../src/engine/race');
  const { generateTurn, aiHooks } = await import('../src/engine/turn');
  const old = await import(oldDir + '/ai.ts');
  const races = ['Humanoid', 'Insectoid', 'Rabbitoid', 'Silicanoid', 'Antetheral', 'Nucleotid'];
  const out: any[] = [];
  for (const swap of [0, 1]) {
    const s = { ...defaultSettings(), seed, size: size as any };
    const g = createGame({ name: 'arena', settings: s, players: races.map(r => ({ race: (PREDEFINED_RACES as any)[r](), ai: level })) } as any);
    const isNew = (id: number) => id % 2 === swap;
    aiHooks.run = (game, p, rng) => { if (isNew(p.id)) return false; old.runAI(game, p, rng); return true; };
    const t0 = Date.now();
    const end = 2400 + +yearsArg;
    let conquests = [0, 0];
    let owners = g.planets.map(p => p.owner);
    while (g.year < end) {
      generateTurn(g);
      g.planets.forEach((pl, i) => { const o = owners[i]; if (o !== pl.owner && pl.owner >= 0 && o >= 0 && !g.players[pl.owner].monster && !g.players[o].monster) conquests[isNew(pl.owner) ? 0 : 1]++; });
      owners = g.planets.map(p => p.owner);
    }
    for (const p of g.players) {
      if (p.monster) continue;
      const sc = p.scores[p.scores.length - 1];
      out.push({ seed, swap, id: p.id, side: isNew(p.id) ? 'new' : 'old', race: p.race.name, dead: !!p.dead, score: sc?.score ?? 0, planets: g.planets.filter(x => x.owner === p.id).length, ships: g.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.tokens.reduce((b, t) => b + t.qty, 0), 0), resources: sc?.resources ?? 0, tech: Object.values(p.tech).reduce((a: number, b: any) => a + b, 0) });
    }
    out.push({ seed, swap, conquestsNew: conquests[0], conquestsOld: conquests[1], ms: Date.now() - t0 });
  }
  console.log(JSON.stringify(out));
}
void main();
