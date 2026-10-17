// Constellations 0.3.9.18 checks: the greenhouse effect of industry, fewer artifacts, the Mystery Trader keeps only the
// minerals, gate cargo messages, the update check of the local copy (run: npx tsx scripts/v39n-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { quickGame } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES, habCenter } = await import('../src/engine/race');
  const { generateTurn } = await import('../src/engine/turn');
  const GH = await import('../src/engine/greenhouse');
  const { planetSpec } = await import('../src/engine/planet');
  const { setRule } = await import('../src/engine/rules');
  const { FIELDS } = await import('../src/engine/types');
  type G = ReturnType<typeof quickGame>;

  const base = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 2, 'standard', 'v39n', { randomEvents: true } as any);
  base.settings.cataclysms = false;
  while (base.year < 2405) generateTurn(base);
  const raw = JSON.stringify(base);
  const fresh = (): G => JSON.parse(raw);
  const home = (g: G) => g.planets.find(p => p.owner === 0 && p.homeworld)!;
  /** A homeworld full of people and of factories at work. */
  const industrial = (g: G, factories: number) => {
    const h = home(g);
    h.pop = 1_000_000;
    h.factories = factories;
    return h;
  };

  console.log('--- the greenhouse effect');
  {
    const g = fresh();
    check(!!g.settings.greenhouse, 'a new game has the rule on');
    const h = industrial(g, 1000);
    const out = GH.factoryOutput(g, h), target = GH.greenhouseTarget(g, h);
    check(Math.abs(target - 4 * Math.log(1 + out / 400)) < 1e-9 && target > 4.5 && target < 5.5, `1,000 factories at work (${out} resources a year) push their world toward +${Math.round(target * 4)} °C`);
    const gh0 = h.greenhouse ?? 0, had = h.ghShift ?? 0;
    const base0 = h.baseHab[1] - had, hab0 = h.hab[1] - had, tf0 = h.terraformed[1];
    h.queue = [];
    for (let i = 0; i < 20; i++) GH.greenhouse(g);
    const gh = h.greenhouse ?? 0;
    check(Math.abs(gh - (target - (target - gh0) * Math.pow(19 / 20, 20))) < 0.02, `it warms slowly: after 20 years, ${gh.toFixed(2)} steps of the ${target.toFixed(2)} it heads for`);
    check(h.ghShift === Math.round(gh) && h.baseHab[1] === base0 + Math.round(gh) && h.hab[1] === hab0 + Math.round(gh) && h.terraformed[1] === tf0, `the natural temperature moves by the whole steps (${base0} → ${h.baseHab[1]}), terraforming is kept`);
    const msg = g.players[0].messages.find(m => m.text.startsWith('Effet de serre'));
    check(!!msg, `the owner is told: « ${msg?.text.slice(0, 120)}… »`);
    // the technologies
    const p = g.players[0];
    const save = { ...p.tech };
    p.tech.energy = 6;
    check(Math.abs(GH.emissionFactor(p) - 0.6) < 1e-9, 'Énergie décarbonée (Énergie 6): 40 % less');
    p.tech.biotechnology = 8; p.tech.energy = 6;
    check(Math.abs(GH.emissionFactor(p) - 0.3) < 1e-9, 'Captage du carbone (Biotechnologie 8): half of the rest');
    p.tech.biotechnology = 14; p.tech.energy = 12;
    check(Math.abs(GH.emissionFactor(p) - 0.15) < 1e-9 && GH.greenhouseTarget(g, h) < target / 2.5, `Régulation climatique (Biotechnologie 14, Énergie 12): half again; the same world heads for +${Math.round(GH.greenhouseTarget(g, h) * 4)} °C`);
    // cooling: slow, five times faster with the climate control
    const cool = (tech: typeof p.tech) => {
      const k = fresh(); const w = industrial(k, 0); w.greenhouse = 4; w.ghShift = 4; Object.assign(k.players[0].tech, tech);
      for (let i = 0; i < 10; i++) GH.greenhouse(k);
      return w.greenhouse ?? 0;
    };
    const slow = cool(save), fast = cool({ ...save, biotechnology: 14, energy: 12 });
    check(slow > 3.2 && fast < 1.6, `without industry it cools slowly (4 steps → ${slow.toFixed(2)} in ten years), much faster with the climate control (${fast.toFixed(2)})`);
    p.tech = save;
    // a world too cold for its people gains
    const k = fresh(); const c = industrial(k, 1000); const r = k.players[0].race;
    const centre = habCenter(r)[1];
    c.baseHab[1] = c.hab[1] = centre - 10; c.terraformed[1] = 0;
    const before = planetSpec(k, c).hab;
    for (let i = 0; i < 60; i++) GH.greenhouse(k);
    check(planetSpec(k, c).hab > before, `a world too cold for its race gains (${before} % → ${planetSpec(k, c).hab} %)`);
    // switching the rule off gives the worlds back their temperature
    setRule(g, 'greenhouse', false);
    check(h.baseHab[1] === base0 && h.hab[1] === hab0 && !h.greenhouse && !h.ghShift, 'switching the rule off gives the worlds back their temperature');
    // off: nothing moves
    const o = fresh(); o.settings.greenhouse = false; const oh = industrial(o, 1000);
    const was = JSON.stringify([oh.greenhouse, oh.baseHab, oh.hab]);
    for (let i = 0; i < 30; i++) GH.greenhouse(o);
    check(JSON.stringify([oh.greenhouse, oh.baseHab, oh.hab]) === was, 'without the rule, nothing moves');
    // an old save (no setting) plays without it
    const { defaultSettings } = await import('../src/engine/newgame');
    check(defaultSettings().greenhouse === true, 'on by default for new games, off for older saves (no setting)');
    // in a whole game: the AI's homeworlds warm a little and the AIs terraform it back
    const w = fresh();
    for (const pl of w.players) if (!pl.ai && !pl.monster) pl.ai = 'standard' as any;
    while (w.year < 2470) generateTurn(w);
    const warmed = w.planets.filter(x => (x.ghShift ?? 0) > 0);
    check(warmed.length > 0 && warmed.every(x => (x.ghShift ?? 0) <= 6), `in a game of 70 years, ${warmed.length} world(s) warmed by industry, by ${Math.max(0, ...warmed.map(x => x.ghShift ?? 0))} steps at most`);
  }

  console.log('--- artifacts, the Mystery Trader, gates');
  {
    const g = fresh();
    const share = g.planets.filter(p => p.artifact).length / g.planets.length;
    check(share < 0.14 && g.artifactsThinned === true, `one world in ten at most hides an artifact (${(share * 100).toFixed(0)} %)`);
    const old = fresh(); old.artifactsThinned = undefined;
    for (const p of old.planets) if (p.owner < 0) p.artifact = true;
    const n0 = old.planets.filter(p => p.artifact).length;
    generateTurn(old);
    const n1 = old.planets.filter(p => p.artifact).length;
    check(n1 < n0 * 0.4 && n1 > n0 * 0.2, `a game of 0.3.9.17 keeps about 3 artifacts in 10 (${n0} → ${n1})`);
  }

  console.log('--- the update check of the local copy');
  {
    const U = await import('../src/ui/update');
    check(U.cmpVersion('0.3.9.18', '0.3.9.9') > 0 && U.cmpVersion('0.3.10', '0.3.9.18') > 0 && U.cmpVersion('0.3.9.17', '0.3.9.17') === 0, 'versions compare number by number (0.3.9.18 after 0.3.9.9)');
    const body = '**Play in your browser:** https://x\n\nOr download it.\n\n## What\'s new\n\n- **One:** a thing\n\nThe full history of versions is in README.fr.md.\n\nCreated with the help of Claude.\n\n<details><summary>En français</summary>\n\n**Jouer dans le navigateur :** https://x\n\n## Nouveautés\n\n- **Un :** une chose\n\n</details>\n';
    const en = U.releaseNotes(body, 'en'), fr = U.releaseNotes(body, 'fr'), de = U.releaseNotes(body, 'de');
    check(en.startsWith("## What's new") && en.includes('One') && !en.includes('Nouveautés') && !en.includes('full history') && !en.includes('Created'), 'the English notes, without the lines on where to play');
    check(fr.startsWith('## Nouveautés') && fr.includes('Un :') && !fr.includes('One') && de === en, 'the French part for French players, English for the others');
    const list = U.parseReleases([
      { tag_name: 'v0.3.9.17', published_at: '2026-10-17', body: 'a', html_url: 'u17', assets: [{ name: 'Constellations_v0.3.9.17.zip', browser_download_url: 'z17', size: 1 }] },
      { tag_name: 'v0.3.9.19', published_at: '2026-10-20', body: 'c', html_url: 'u19', draft: true, assets: [] },
      { tag_name: 'v0.3.9.18', published_at: '2026-10-18', body: 'b', html_url: 'u18', assets: [{ name: 'index.html', browser_download_url: 'h18', size: 4_600_000 }, { name: 'Constellations_v0.3.9.18.zip', browser_download_url: 'z18', size: 2 }] },
    ]);
    check(list.length === 2 && list[0].version === '0.3.9.18' && list[0].html === 'h18' && list[0].zip === 'z18' && list[1].html === undefined, 'the releases, newest first, drafts left out, with the game file and the zip');
    check(!U.isLocalCopy(), 'only the copy opened from the disk asks GitHub (not here)');
  }

  console.log(`\n${good} ok, ${bad} failed`);
  if (bad) process.exit(1);
}
main();
