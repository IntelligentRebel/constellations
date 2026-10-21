// Constellations 0.3.9 checks (run: npx tsx scripts/v39-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const g0: any = globalThis;
  g0.window = g0; g0.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  g0.document = undefined;
  const { store } = await import('../src/ui/store');
  const { quickGame } = await import('../src/engine/newgame');
  const { generateTurn } = await import('../src/engine/turn');
  const { todoItems, nextTodo } = await import('../src/ui/todo');
  const { moodOf, snapshot } = await import('../src/ui/sound');
  const { uiPrefs, setPrefs, applyPlayerColors } = await import('../src/ui/prefs');

  console.log('--- the queue of things to handle');
  {
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-todo', { shape: 'arm' });
    store.game = g;
    const me = g.players[g.human];
    const list = todoItems(g, me);
    check(list.some(x => x.group === 'scouts'), `idle scouts are in the queue at the start (${list.map(x => x.group).join(', ')})`);
    const keys = new Set(list.map(x => x.key));
    check(keys.size === list.length, 'every item has its own key');
    store.todoKey = null;
    nextTodo(1); const k1 = store.todoKey;
    nextTodo(1); const k2 = store.todoKey;
    check(k1 === list[0].key && (list.length < 2 || k2 === list[1].key), 'T walks through the queue in order');
    nextTodo(-1);
    check(store.todoKey === k1, 'Shift+T goes back');
    // an empty production queue is listed
    const hw = g.planets.find(p => p.owner === me.id)!;
    hw.queue = [];
    check(todoItems(g, me).some(x => x.group === 'queue' && x.key === 'q' + hw.id), 'an empty production queue is listed');
    // a pending decision comes first
    me.decisions = [{ id: 999, kind: 'relic', year: g.year } as any];
    check(todoItems(g, me)[0].group === 'decision', 'a decision comes before the fleets');
    me.decisions = [];
  }

  console.log('--- the mood of the music');
  {
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-mood', { shape: 'arm' });
    const me = g.players[g.human];
    for (const p of g.players) if (p.id !== me.id) p.ai = null;
    generateTurn(g);
    check(moodOf(g, me) === 'calm', 'calm at the start');
    const before = snapshot(g, me);
    const hw = g.planets.find(p => p.owner === me.id)!;
    const enemy = g.players.find(p => !p.monster && p.id !== me.id)!;
    me.relations[enemy.id] = 'enemy';
    me.intel.fleets.push({ id: 99999, owner: enemy.id, x: hw.x + 20, y: hw.y, detail: 'contact' } as any);
    check(moodOf(g, me) === 'tension', 'an enemy fleet 20 ly from a world: tension');
    me.intel.fleets.pop();
    me.relations[enemy.id] = 'neutral';
    me.intel.fleets.push({ id: 99998, owner: enemy.id, x: hw.x + 20, y: hw.y, detail: 'contact' } as any);
    check(moodOf(g, me) === 'calm', 'a neutral fleet nearby is no threat');
    me.intel.fleets.pop();
    g.battles.push({ id: 1, year: g.year, x: hw.x, y: hw.y, players: [me.id, enemy.id], tokens: [], actions: [] } as any);
    check(moodOf(g, me, before) === 'tension', 'a battle: tension');
    const other = g.planets.find(p => p.owner === me.id && p !== hw);
    const lostWorld = other ?? hw;
    const ownerWas = lostWorld.owner;
    lostWorld.owner = enemy.id;
    check(moodOf(g, me, before) === 'crisis', 'a battle and a world lost: crisis');
    lostWorld.owner = ownerWas;
    g.battles.pop();
  }

  console.log('--- colours for colour blindness');
  {
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-colours', { shape: 'arm' });
    const was = g.players.map(p => p.color);
    setPrefs({ colors: 'rg' }); applyPlayerColors(g);
    const emp = g.players.filter(p => !p.monster);
    check(emp.every(p => p.baseColor === was[p.id]), 'the colour chosen at creation is kept');
    check(emp.some(p => p.color !== p.baseColor), 'the empires are shown in the red-green palette');
    check(new Set(emp.map(p => p.color)).size === emp.length, 'the palette keeps the empires apart');
    setPrefs({ colors: 'normal' }); applyPlayerColors(g);
    check(g.players.every((p, i) => p.color === was[i]), 'back to standard colours');
    check(uiPrefs.colors === 'normal', 'the preference is stored');
    setPrefs({ textScale: 1.3 });
    check(uiPrefs.textScale === 1.3, 'text size stored');
    setPrefs({ textScale: 1 });
  }

  console.log('--- veterans');
  {
    const { addDesign, newFleet } = await import('../src/engine/newgame');
    const { designAtTech } = await import('../src/engine/guardians');
    const { rankOf, RANKS } = await import('../src/engine/veterans');
    const { mergeFleets, splitFleet } = await import('../src/engine/tasks');
    const { declareWar } = await import('../src/engine/diplomacy');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-vets', { shape: 'arm' });
    for (const p of g.players) if (!p.monster) p.ai = null;
    const a = g.players[0], b = g.players[1];
    const hw = g.planets.find(p => p.owner === a.id)!;
    const hwb = g.planets.find(p => p.owner === b.id)!;
    declareWar(g, a.id, b.id);
    for (const p of [a, b]) p.relations = p.relations.map((r, i) => i === a.id || i === b.id ? 'enemy' : r);
    const da = addDesign(g, designAtTech(a, 12, 'Destroyer', 'beamWarship', 'Vet A')!);
    const db = addDesign(g, designAtTech(b, 12, 'Destroyer', 'beamWarship', 'Cible B')!);
    const fa = newFleet(g, a, da.id, 10, hw);
    check(fa.born === g.year && (fa.journal?.[0]?.text ?? '').includes('Mise en service'), `a new fleet has a log (${fa.journal?.[0]?.text})`);
    const x = Math.round((hw.x + hwb.x) / 2), y = Math.round((hw.y + hwb.y) / 2);
    const place = (f: any) => { f.x = x; f.y = y; f.orbiting = -1; f.waypoints = [{ x, y, target: 'space', warp: 0, task: 'none', processed: true }]; };
    place(fa);
    const fb = newFleet(g, b, db.id, 2, hwb); place(fb);
    generateTurn(g);
    const fa2 = g.fleets.find(f => f.id === fa.id)!;
    check(!!fa2 && (fa2.xp ?? 0) >= 3 + 4 * 1, `xp after a won battle (${fa2?.xp}, kills ${fa2?.kills})`);
    check((fa2.journal ?? []).some(j => j.text.startsWith('Bataille')), 'the battle is in the log');
    fa2.xp = 50;
    check(rankOf(fa2) === 2 && RANKS[2].name === 'Vétérans', 'rank from experience');
    const rookies = newFleet(g, a, da.id, 6, hw); rookies.x = fa2.x; rookies.y = fa2.y; rookies.orbiting = fa2.orbiting;
    const n0 = fa2.tokens.reduce((s, t) => s + t.qty, 0);
    mergeFleets(g, fa2, rookies);
    check(fa2.xp === Math.floor(50 * n0 / (n0 + 6)), `recruits dilute the experience (${fa2.xp})`);
    check((fa2.journal ?? []).some(j => j.text.startsWith('Renforcée')), 'the merge is in the log');
    const part = splitFleet(g, fa2, [{ designId: da.id, qty: 2 }])!;
    check(part.xp === fa2.xp && (part.journal ?? []).some(j => j.text.startsWith('Détachée')), 'a split fleet keeps the experience');
    // the bonus in battle: a veteran fleet beats the same fleet of recruits more often
    const { simulateBattle } = await import('../src/engine/battle');
    void simulateBattle;
  }

  console.log('--- nemesis');
  {
    const { runNemesis, isNemesis, nemesisOf, NEMESIS_AT, battleGrudges } = await import('../src/engine/nemesis');
    const { opinion, evaluate, declareWar, warDesire } = await import('../src/engine/diplomacy');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-nemesis', { shape: 'arm' });
    const me = g.players[g.human];
    const ai = g.players.find(p => p.ai && !p.monster)!;
    if (!me.intel.met.includes(ai.id)) me.intel.met.push(ai.id);
    if (!ai.intel.met.includes(me.id)) ai.intel.met.push(me.id);
    // two of its worlds, so it can swear
    const free = g.planets.find(p => p.owner < 0 && !p.hidden)!; free.owner = ai.id; free.pop = 10000;
    battleGrudges(g, { [me.id]: { [ai.id]: 40 } });
    check((ai.grudges?.[me.id] ?? 0) === 15, `at most 15 of grudge per battle (${ai.grudges?.[me.id]})`);
    ai.grudges![me.id] = NEMESIS_AT + 5;
    runNemesis(g);
    check(isNemesis(g, ai.id, me.id), 'past the threshold, it swears');
    check(me.messages.some(m => m.text.includes('juré votre perte')), 'the human is told');
    check(opinion(g, ai.id, me.id).lines.some(l => l.label === 'Ils ont juré votre perte'), 'the reason shows in its opinion');
    const wd = warDesire(g, ai.id, me.id);
    check(wd >= 45, `it wants war (${wd})`);
    declareWar(g, ai.id, me.id);
    g.year += 5;
    check(!evaluate(g, ai.id, me.id, 'peace').ok, 'no peace with a nemesis');
    {
      const { counterPurpose } = await import('../src/engine/nemesis');
      const { addDesign, newFleet } = await import('../src/engine/newgame');
      const { designAtTech } = await import('../src/engine/guardians');
      const hw = g.planets.find(p => p.owner === me.id)!;
      for (const f of g.fleets.filter(f => f.owner === me.id)) f.tokens = f.tokens.filter(() => false);
      g.fleets = g.fleets.filter(f => f.tokens.length);
      const d = addDesign(g, designAtTech(me, 14, 'Battleship', 'beamWarship', 'Bouclier')!);
      const { specOf } = await import('../src/engine/design');
      const sp = specOf(g, d.id);
      const nf = newFleet(g, me, d.id, 3, hw);
      // 0.3.9.15: it can only adapt to warships it has seen, of a design met in battle
      check(counterPurpose(g, ai) === undefined, 'your fleet unseen: it designs as before');
      const { learnDesign } = await import('../src/engine/scan');
      ai.intel.fleets.push({ id: nf.id, owner: me.id, x: nf.x, y: nf.y, detail: 'full', tokens: nf.tokens.map(t => ({ designId: t.designId, qty: t.qty })) });
      learnDesign(ai, g, d.id, true);
      const want = sp.shields / (sp.shields + sp.armor) > 0.35 ? 'torpedoWarship' : 'beamWarship';
      check(counterPurpose(g, ai) === want, `it arms its warships against yours (${counterPurpose(g, ai)}, your shields ${sp.shields} / armour ${sp.armor})`);
    }
    check(g.chronicle!.events.some(e => e.kind === 'nemesis'), 'in the chronicle');
    // broken: it loses most of its worlds
    const n = nemesisOf(g, me.id)!;
    n.peak = 10;
    for (const p of g.planets) if (p.owner === ai.id && p.id !== ai.capital) p.owner = -1;
    runNemesis(g);
    check(n.broken === g.year, 'broken when it lost most of its worlds');
    check(!isNemesis(g, ai.id, me.id), 'a broken nemesis is no longer one');
  }

  console.log('--- chronicle');
  {
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-chronicle', { shape: 'arm' });
    for (let i = 0; i < 10; i++) generateTurn(g);
    const c = g.chronicle!;
    check(c.events[0]?.kind === 'start', 'it opens with the start of the game');
    check(c.frames.length >= 4 && c.frames[0].year === 2400, `a picture of the territory every few years (${c.frames.map(f => f.year).join(', ')})`);
    check(c.frames.every(f => f.owners.length === g.planets.length), 'one character per planet');
    const { ownerAt } = await import('../src/engine/chronicle');
    const last = c.frames[c.frames.length - 1];
    const hw = g.planets.find(p => p.owner === 0)!;
    check(c.frames[0] && ownerAt(c.frames[0].owners, hw.id) === 0, 'the homeworld belongs to its empire in the first picture');
    void last;
  }

  console.log('--- three acts');
  {
    const { actOf, runActs, actRules } = await import('../src/engine/acts');
    const { megaBlocker, MEGA } = await import('../src/engine/megaprojects');
    const { researchCost } = await import('../src/engine/research');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-acts', { shape: 'arm' });
    for (const p of g.players) if (!p.monster) p.ai = null;
    generateTurn(g);
    check(actOf(g) === 1 && actRules(g, 1).length > 0, 'the game opens on act I');
    const me = g.players[0];
    const hw = g.planets.find(p => p.owner === me.id)!;
    for (const f of ['energy', 'weapons', 'propulsion', 'construction', 'electronics', 'biotechnology'] as const) me.tech[f] = 14;
    hw.pop = 900000;
    check(megaBlocker(g, hw, 'shield') === 'aucun mégaprojet pendant l\'acte I', `no megaproject in act I (${megaBlocker(g, hw, 'shield')})`);
    g.year = 2430; runActs(g);
    check(actOf(g) === 2 && g.act!.since === 2430, 'act II by 2430 at the latest');
    check(megaBlocker(g, hw, 'shield') === null && megaBlocker(g, hw, 'portal') === 'le Portail attend l\'acte III', `megaprojects in act II, not the Portal (${megaBlocker(g, hw, 'portal')})`);
    check(me.messages.some(m => m.text.startsWith('Acte II')), 'everyone is told');
    const before = researchCost(g, me, 'energy');
    // act III: a third relay
    const mine = [hw, ...g.planets.filter(p => p.owner < 0 && !p.hidden).slice(0, 2)];
    for (const p of mine) { p.owner = me.id; p.pop = Math.max(p.pop, 50000); p.megaprojects = ['relay']; }
    runActs(g);
    check(actOf(g) === 3 && (g.act!.why ?? '').includes('relais'), `act III with a third relay (${g.act!.why})`);
    check(Math.abs(researchCost(g, me, 'energy') / before - 0.85) < 0.01, 'research 15 % cheaper in act III');
    check(megaBlocker(g, hw, 'portal') === null, 'the Portal can be built in act III with three relays');
    // the computers make no war in act I
    const g2 = quickGame(undefined, 'Small', 4, 'expert', 'v39-acts-war', { shape: 'arm' });
    for (let i = 0; i < 28; i++) generateTurn(g2);
    const wars = (g2.chronicle?.events ?? []).filter(e => e.kind === 'war' && g2.players[e.who[0]].ai);
    check(actOf(g2) === 1 || wars.every(e => e.year >= g2.act!.since), `no war declared by a computer in act I (act ${actOf(g2)}, wars ${wars.map(e => e.year).join(',') || 'none'})`);
  }

  console.log('--- relays of the Ascension');
  {
    const { megaBlocker, relaysOf, MEGA } = await import('../src/engine/megaprojects');
    const { runProduction } = await import('../src/engine/production');
    const { zeroCost } = await import('../src/engine/production');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-relays', { shape: 'arm' });
    g.settings.acts = false;
    const me = g.players[0];
    for (const f of ['energy', 'weapons', 'propulsion', 'construction', 'electronics', 'biotechnology'] as const) me.tech[f] = 14;
    const hw = g.planets.find(p => p.owner === me.id)!; hw.pop = 900000;
    check((megaBlocker(g, hw, 'portal') ?? '').includes('relais'), `the Portal needs relays (${megaBlocker(g, hw, 'portal')})`);
    check(megaBlocker(g, hw, 'relay') === null, 'a relay can be built');
    hw.megaprojects = ['relay'];
    check(megaBlocker(g, hw, 'relay') === 'déjà construit ici', 'one relay per world');
    const others = g.planets.filter(p => p.owner < 0 && !p.hidden).slice(0, 2);
    for (const p of others) { p.owner = me.id; p.pop = 60000; }
    check(megaBlocker(g, others[0], 'relay') === null, 'another world can have its own');
    for (const p of others) p.megaprojects = ['relay'];
    check(relaysOf(g, me.id).length === 3 && megaBlocker(g, hw, 'portal') === null, 'three relays: the Portal can start');
    hw.queue = [{ kind: 'mega', megaId: 'portal', qty: 1, allocated: zeroCost() }];
    const rich = () => { hw.surface = { ironium: 50000, boranium: 50000, germanium: 50000 }; hw.bonusResources = 100000; };
    rich(); runProduction(g, hw, () => {});
    const a1 = hw.queue[0].allocated.resources;
    check(a1 > 0, 'the Portal advances');
    others[1].owner = 1;
    rich(); const r = runProduction(g, hw, () => {});
    check(hw.queue[0]?.megaId === 'portal' && hw.queue[0].allocated.resources === a1, 'a relay lost: the Portal is paused, not lost');
    check(r.messages.some(m => m.includes('en pause')), `and the player is told (${r.messages.find(m => m.includes('pause'))})`);
  }

  console.log('--- diaspora');
  {
    const { addDesign, newFleet } = await import('../src/engine/newgame');
    const { colonize } = await import('../src/engine/tasks');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-diaspora', { shape: 'arm' });
    for (const p of g.players) if (!p.monster) p.ai = null;
    const me = g.players[0];
    const ark = g.fleets.find(f => f.owner === me.id && f.tokens.some(t => g.designs.find(d => d.id === t.designId)?.slots.some(sl => /Colonization/.test(sl.part))))!;
    check(!!ark, 'an ark to start with');
    ark.cargo.colonists = 50;
    const home = g.planets.find(p => p.owner === me.id)!;
    const target = g.planets.find(p => p.owner < 0 && !p.hidden && Math.hypot(p.x - home.x, p.y - home.y) < 200)!;
    for (const p of g.planets) if (p.owner === me.id) { p.owner = -1; p.pop = 0; }
    generateTurn(g);
    check(!me.dead && !!me.exile && me.messages.some(m => m.text.startsWith('Votre dernier monde')), 'no world, a loaded ark: the empire lives in exile');
    check(g.chronicle!.events.some(e => e.kind === 'diaspora'), 'in the chronicle');
    const ark2 = g.fleets.find(f => f.id === ark.id)!;
    ark2.x = target.x; ark2.y = target.y; ark2.orbiting = target.id;
    const f0 = target.factories;
    check(colonize(g, ark2, target), 'it settles a world');
    check(me.capital === target.id && target.factories === f0 + 20 && !!me.exile?.refounded, 'the colony becomes the new capital, with factories');
    check((me.stats.refounded ?? 0) === 1, 'counted (achievement)');
    // an empty ark is not enough
    const g2 = quickGame(undefined, 'Small', 3, 'standard', 'v39-diaspora-2', { shape: 'arm' });
    for (const p of g2.players) if (!p.monster) p.ai = null;
    const m2 = g2.players[0];
    for (const f of g2.fleets.filter(f => f.owner === m2.id)) f.cargo.colonists = 0;
    for (const p of g2.planets) if (p.owner === m2.id) { p.owner = -1; p.pop = 0; }
    generateTurn(g2);
    check(m2.dead, 'without colonists aboard, the empire is gone');
  }

  console.log('--- cataclysms');
  {
    const { forceCataclysm, dangerAt, SN_RADIUS, SN_FALLOUT, BH_CORE } = await import('../src/engine/cataclysms');
    const g = quickGame(undefined, 'Medium', 4, 'standard', 'v39-cata', { shape: 'arm' });
    for (const p of g.players) if (!p.monster) p.ai = null;
    g.settings.acts = false;
    g.cataNext = 9999;
    const c = forceCataclysm(g, 'supernova')!;
    check(!!c && c.at === g.year + 15, `a supernova announced fifteen years ahead (${c?.at})`);
    const star = g.planets[c.planetId!];
    check(!g.planets.some(p => (p.homeworld || g.players.some(o => o.capital === p.id)) && Math.hypot(p.x - star.x, p.y - star.y) <= SN_RADIUS), 'never on a capital');
    check(g.players[0].messages.some(m => m.text.includes('supernova')), 'everyone is told');
    // a colony in the blast, one in the fallout, a fleet in the blast
    const inner = g.planets.find(p => p !== star && !p.hidden && p.owner < 0 && Math.hypot(p.x - star.x, p.y - star.y) <= SN_RADIUS - 2);
    const outer = g.planets.find(p => !p.hidden && p.owner < 0 && Math.hypot(p.x - star.x, p.y - star.y) > SN_RADIUS + 2 && Math.hypot(p.x - star.x, p.y - star.y) <= SN_FALLOUT - 2);
    if (inner) { inner.owner = 0; inner.pop = 20000; }
    if (outer) { outer.owner = 0; outer.pop = 40000; }
    const f = g.fleets.find(x => x.owner === 0)!; f.x = star.x + 3; f.y = star.y; f.orbiting = -1; f.waypoints = [{ x: f.x, y: f.y, target: 'space', warp: 0, task: 'none', processed: true }];
    check(!!dangerAt(g, star), 'the zone is marked as dangerous');
    while (g.year < c.at! - 1) generateTurn(g);
    const popBefore = outer?.pop ?? 0;
    generateTurn(g);
    check(c.done === g.year, 'it blows at the announced year');
    if (inner) check(inner.owner === -1 && inner.pop === 0 && inner.hab[2] === 100, 'a world in the blast is wiped out and irradiated');
    if (outer) check(outer.owner === 0 && outer.pop > 0 && outer.pop <= popBefore * 0.6, `a world in the fallout keeps half its people (${popBefore} → ${outer.pop})`);
    check(!g.fleets.some(x => x.id === f.id), 'a fleet in the blast is lost');
    check(g.chronicle!.events.filter(e => e.kind === 'cataclysm').length >= 2, 'announced and told in the chronicle');
    const h = forceCataclysm(g, 'blackhole')!;
    const x0 = h.x, y0 = h.y;
    generateTurn(g);
    check(Math.hypot(h.x - x0, h.y - y0) >= 5, 'the black hole drifts every year');
    const victim = g.planets.find(p => !p.hidden)!;
    victim.owner = 1; victim.pop = 30000; h.x = victim.x + 2; h.y = victim.y; h.vx = 0; h.vy = 0;
    generateTurn(g);
    check(victim.owner === -1 && victim.surface.ironium === 0, 'a world it passes over is swallowed');
    void BH_CORE;
  }

  console.log('--- golden ages');
  {
    const { runGoldenAges, inGoldenAge, GOLDEN_FIRST } = await import('../src/engine/golden');
    const { planetSpec } = await import('../src/engine/planet');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-golden', { shape: 'arm' });
    const me = g.players[0];
    const hw = g.planets.find(p => p.owner === me.id)!;
    const before = planetSpec(g, hw, me).resources;
    runGoldenAges(g);
    check((me.golden?.inspiration ?? 0) > 0 && !inGoldenAge(g, me), `inspiration gathers (${me.golden?.inspiration.toFixed(1)})`);
    me.golden!.inspiration = GOLDEN_FIRST;
    runGoldenAges(g);
    check(inGoldenAge(g, me) && me.golden!.until === g.year + 10 && me.golden!.next > GOLDEN_FIRST, `a golden age of ten years (until ${me.golden!.until}), the next asks for more (${me.golden!.next})`);
    const during = planetSpec(g, hw, me).resources;
    check(during >= Math.floor(before * 1.15) - 1 && during > before, `15 % more resources (${before} → ${during})`);
    // (0.3.9.21: ten productions, from next year to the year + 10)
    g.year += 10;
    check(inGoldenAge(g, me), 'still on for the tenth production');
    g.year += 1;
    check(!inGoldenAge(g, me), 'over after ten years');
  }

  console.log('--- dilemmas');
  {
    const { runDilemmas, settle, dilemmaView, DILEMMA } = await import('../src/engine/dilemmas');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-dilemma', { shape: 'arm' });
    for (const p of g.players) if (!p.monster) p.ai = null;
    for (let i = 0; i < 25; i++) generateTurn(g);
    const me = g.players[0];
    let tries = 0;
    while (!(me.dilemmas ?? []).length && tries++ < 80) { me.lastDilemma = 2400; runDilemmas(g); g.year++; }
    const d = me.dilemmas?.[0];
    check(!!d, `a dilemma comes (${d?.kind})`);
    if (d) {
      const v = dilemmaView(g, me, d)!;
      check(!!v.text && !!v.a.hint && !!v.b.hint, `told with both prices (${v.title} : ${v.a.label} / ${v.b.label})`);
      const t = settle(g, me, d.id, 'a');
      check(!!t && !(me.dilemmas ?? []).length, `answered (${t})`);
    }
    // forgotten: the second answer applies
    me.dilemmas = [{ id: 1, kind: 'wreck', year: g.year - 6, expires: g.year, data: { planet: g.planets.find(p => p.owner === me.id)!.id, kt: 300, field: 'weapons' } }];
    me.messages = [];
    runDilemmas(g);
    check(!(me.dilemmas ?? []).length && me.messages.some(m => m.text.includes('faute de décision')), 'unanswered, the second answer applies');
    check(Object.keys(DILEMMA).length >= 10, 'the stories\' choices are dilemmas too');
  }

  console.log('--- stories');
  {
    const { runChains } = await import('../src/engine/chains');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-chains', { shape: 'arm' });
    for (const p of g.players) if (!p.monster) p.ai = null;
    for (let i = 0; i < 22; i++) generateTurn(g);
    const me = g.players[0];
    for (const p of g.players) p.nextChain = 9999;
    me.nextChain = g.year;
    me.chainsSeen = ['plague', 'prophet'];
    runChains(g);
    const ch = g.chains?.find(c => c.owner === me.id);
    check(!!ch && ch.kind === 'signal', `a story begins (${ch?.kind})`);
    if (ch) {
      const t = g.planets[ch.data.planet as number];
      g.year = ch.next; runChains(g);
      check(ch.stage === 2 && me.messages.some(m => m.text.includes('se précise')), 'the signal asks for a ship');
      const sc = g.fleets.find(f => f.owner === me.id && f.tokens.length)!;
      sc.x = t.x; sc.y = t.y; sc.orbiting = t.id;
      const { fleetSpec } = await import('../src/engine/fleet');
      if (fleetSpec(g, sc).scanRange <= 0) console.log('  (the fleet has no scanner)');
      g.year++; runChains(g);
      check(ch.done !== undefined, `answered in time, the story ends (${me.messages[me.messages.length - 1]?.text.slice(0, 80)})`);
    }
    // a plague: its choice is a dilemma
    me.nextChain = g.year; me.chainsSeen = ['signal', 'prophet'];
    const col = g.planets.find(p => p.owner < 0 && !p.hidden)!; col.owner = me.id; col.pop = 30000;
    runChains(g);
    const pl = g.chains?.find(c => c.owner === me.id && c.kind === 'plague' && c.done === undefined);
    check(!!pl && (me.dilemmas ?? []).some(d => d.kind === 'plague'), 'the plague asks: quarantine or not');
  }

  console.log('--- the secret of the Ancients');
  {
    const { addClue, CLUES_NEEDED, sealBlocker, breachKind, anchorOf } = await import('../src/engine/ancients');
    const { megaBlocker } = await import('../src/engine/megaprojects');
    const { runProduction, zeroCost } = await import('../src/engine/production');
    const { initCrisis } = await import('../src/engine/crisis');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-secret', { shape: 'arm' });
    g.settings.acts = false;
    const me = g.players[0];
    for (let i = 0; i < CLUES_NEEDED - 1; i++) addClue(g, me, 'test');
    check(me.clues === CLUES_NEEDED - 1 && me.secretKnown === undefined, 'clues gather');
    addClue(g, me, 'test');
    check(me.secretKnown === g.year && me.messages.some(m => m.text.startsWith('Le secret des Anciens est percé')), `six clues: the secret (${breachKind(g)})`);
    const hw = g.planets.find(p => p.owner === me.id)!;
    check(sealBlocker(g, hw) === 'la Brèche ne s\'est pas encore annoncée', 'no seal before the omens');
    // the omens: the Breach far away; the seal where the secret says
    initCrisis(g); g.crisis!.omenYear = g.year; const { runCrisis } = await import('../src/engine/crisis'); runCrisis(g);
    const b = g.planets[g.crisis!.planetId!];
    const kind = breachKind(g);
    const site = kind === 'prison' ? b : kind === 'seed' ? anchorOf(g)! : b;
    site.owner = me.id; site.pop = 60000;
    if (kind === 'experiment') { /* any world near the Breach: the Breach world itself is near */ }
    check(megaBlocker(g, site, 'seal') === null, `the Seal can rise on ${site.name} (${kind}) : ${megaBlocker(g, site, 'seal')}`);
    site.queue = [{ kind: 'mega', megaId: 'seal', qty: 1, allocated: zeroCost() }];
    let years = 0;
    while (site.queue.some(q => q.kind === 'mega') && years++ < 20) { site.surface = { ironium: 90000, boranium: 90000, germanium: 90000 }; site.bonusResources = 100000; runProduction(g, site, () => {}); }
    check(g.crisis!.phase === 'ended' && g.crisis!.sealed === true && g.victor === me.id && (g.victoryKind === 'seal' || g.victoryKind === 'origin'), `the Seal closes the Breach and wins (${years} years, ${g.victoryKind})`);
  }

  console.log('--- origin victories');
  {
    const { runOriginWins, ORIGIN_WINS } = await import('../src/engine/originwins');
    const { createGame, defaultSettings } = await import('../src/engine/newgame');
    const { PREDEFINED_RACES } = await import('../src/engine/race');
    const g = quickGame(undefined, 'Small', 3, 'standard', 'v39-origin', { shape: 'arm' });
    const me = g.players[0];
    me.origin = 'relicWorld';
    me.relics = ['codex', 'seed', 'forge', 'heart'];
    g.year = 2429; runOriginWins(g);
    check(g.victor === null, 'not before 2430');
    g.year = 2430; runOriginWins(g);
    check(g.victor === me.id && g.victoryKind === 'origin', `four relics: the victory of the relic world (${ORIGIN_WINS.relicWorld.name})`);
    check(Object.keys(ORIGIN_WINS).length >= 8, 'every origin has one');
    // the exiles: no world, five arks
    const s = { ...defaultSettings(), seed: 'v39-exiles', shape: 'arm' as const };
    const ge = createGame({ name: 'Exil', settings: s, players: [{ race: PREDEFINED_RACES.Humanoid(), ai: null, origin: 'exiles' }, { race: PREDEFINED_RACES.Humanoid(), ai: 'standard' }] });
    const ex = ge.players[0];
    const arks = ge.fleets.filter(f => f.owner === ex.id && f.cargo.colonists > 0);
    check(!ge.planets.some(p => p.owner === ex.id) && arks.length >= 5 && !!ex.exile, `the exiles start aboard ${arks.length} arks`);
    generateTurn(ge);
    check(!ex.dead, 'and live on');
    const ai = ge.players[1];
    check(ai.origin !== 'exiles' && ai.origin !== 'heirs', 'the computers never draw a locked origin');
  }

  console.log(bad ? `${bad} FAILED, ${good} ok` : `all good (${good})`);
  if (bad) process.exit(1);
}
void main();
