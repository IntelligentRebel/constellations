// Which reports carry a visible link to where a click leads (3.4.1): the templates of a long game, with the names
// turned into links and the last "→ …" link added when no name leads where the report does.
// run: npx tsx scripts/links-audit.ts [years] [seed]
async function main() {
  const g0: any = globalThis;
  g0.window = g0; g0.addEventListener = () => {}; g0.removeEventListener = () => {}; g0.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }; g0.document = undefined;
  const { quickGame } = await import('../src/engine/newgame');
  const { generateTurn } = await import('../src/engine/turn');
  const { msgLinks } = await import('../src/ui/nav');
  const years = +(process.argv[2] ?? 110), seed = process.argv[3] ?? 'links-1';
  const g = quickGame(undefined, 'Small', 3, 'standard', seed);
  const me = g.players[0];
  me.ai = 'standard';
  const seen = new Map<string, { n: number; ex: string; kind: string; links: string; go: string }>();
  const templ = (t: string) => t.replace(/\d[\d  .,]*/g, '#').slice(0, 70);
  for (let y = 0; y < years; y++) {
    generateTurn(g);
    for (const m of me.messages) {
      const k = (m.target?.kind ?? '-') + ' ' + templ(m.text);
      const e = seen.get(k);
      if (e) { e.n++; continue; }
      const l = msgLinks(g, me, m);
      seen.set(k, { n: 1, ex: m.text.slice(0, 140), kind: m.target?.kind ?? '-', links: l.ents.map(x => x.name).join(' | '), go: l.fallback ? 'FALLBACK ' + l.fallback : '' });
    }
  }
  const rows = [...seen.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  for (const r of rows) console.log(`${r.kind.padEnd(9)} ${String(r.n).padStart(4)}  [${r.links}] ${r.go}\n               ${r.ex}`);
  // reports a computer never sees (it decides at once): doctrines, discoveries, proposals
  let bad = 0;
  const probe = (text: string, target: any, want: string[], _unused?: string) => {
    const l = msgLinks(g, me, { year: g.year, kind: 'event', text, target });
    const names = l.ents.map(e => e.name);
    const ok = want.every(w => names.includes(w)) && !l.fallback;
    if (!ok) bad++;
    console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(text.slice(0, 60)), '→', JSON.stringify(names), l.fallback ?? '');
  };
  probe('Doctrine à choisir (Guerre de l\'information) : Réseau de capteurs (Scanners +25 %) ou Guerre électronique (Camouflage +10). Le choix est définitif.', { kind: 'doctrine', id: 0 }, ['Doctrine à choisir']);
  probe('Moteur climatique (Truc) : l\'étude est terminée. Une décision vous attend : réparer ou démonter ? (onglet Empire, Découvertes)', { kind: 'anomaly', id: 7 }, ['Une décision vous attend', '(onglet Empire, Découvertes)']);
  probe('Nouvelles technologies disponibles (Construction 4) : Cargo moyen. Cargo moyen peut améliorer 2 de vos modèles (Recherche, Technologies déjà trouvées).', { kind: 'research', id: 1 }, ['Recherche, Technologies déjà trouvées']);
  probe('Les Spectres proposent une alliance. Répondez dans la page Diplomatie.', { kind: 'player', id: 2 }, ['page Diplomatie']);
  probe(`Des pirates se sont installés dans la galaxie : la Flotte Noire à ${g.planets[0].name}. Ils vont piller (une prime, dans la file de production ou sur la page Empire).`, { kind: 'planet', id: 0 }, ['page Empire', g.planets[0].name]);
  {
    const o = g.players.find(p => !p.monster && p.id !== me.id)!;
    const l = msgLinks(g, me, { year: g.year, kind: 'diplomacy', text: `Ambassades ouvertes avec les ${o.name} : chacun en apprendra davantage sur l'autre (renseignement +25 des deux côtés).`, target: { kind: 'player', id: o.id } });
    const e = l.ents.find(x => x.name === 'Ambassades ouvertes');
    const ok = !!e && e.target.kind === 'planet' && g.planets[e.target.id].owner === o.id && l.ents.some(x => x.name === o.name);
    if (!ok) bad++;
    console.log(ok ? 'ok  ' : 'FAIL', '"Ambassades ouvertes" leads to their capital', JSON.stringify(l.ents.map(x => `${x.name}→${x.target.kind}`)));
  }
  probe('Vos scientifiques ont atteint le niveau 5 en Énergie.', { kind: 'research', id: 0 }, ['niveau 5 en Énergie']);
  probe('Vous avez reçu 2 enregistrements de bataille cette année.', { kind: 'battle', id: 3 }, ['2 enregistrements de bataille']);
  probe('Un trou de ver a été détecté en (705, 1346). Sa sortie reste inconnue tant qu\'aucun vaisseau ne l\'a franchi.', { kind: 'wormhole', id: 1 }, ['trou de ver']);
  probe('Bataille à l\'espace profond (116, 333) : 1 de vos vaisseaux détruits, 7 vaisseaux adverses détruits.', { kind: 'battle', id: 4 }, ['Bataille', 'l\'espace profond (116, 333)']);
  if (g.crisis?.planetId !== undefined) probe('Une vague de Moissonneurs (4 vaisseaux) sort de la Brèche, en direction des Spectres.', { kind: 'planet', id: g.crisis.planetId }, ['la Brèche']);
  // a planet with a two-letter name (3.4.1 fix): linked, and not inside a longer word
  const pl = g.planets.find(x => x.name === 'Mû') ?? g.planets.find(x => x.owner < 0)!;
  const old = pl.name; pl.name = 'Mû'; g.year++; // a new year: the names are read again
  probe('Vos capteurs ont découvert une colonie des Inconnus sur Mû.', { kind: 'planet', id: pl.id }, ['Mû']);
  { const l = msgLinks(g, me, { year: g.year, kind: 'event', text: 'Une Mûre géante pousse ici.', target: { kind: 'planet', id: pl.id } }); const ok = !l.ents.some(e => e.name === 'Mû'); if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', '"Mû" not lit inside "Mûre"'); }
  pl.name = old; g.year--;
  console.log(bad ? `${bad} probe failure(s)` : 'probes ok');
  const noLink = rows.filter(r => r.kind !== '-' && !r.links);
  const fb = rows.filter(r => r.go.startsWith('FALLBACK'));
  console.log(`\n${rows.length} templates; with a target but no visible link: ${noLink.length}; first clause as the link: ${fb.length}`);
  for (const r of noLink) console.log('  !', r.kind, r.ex);
  for (const r of fb) console.log('  ~', r.kind, r.go, '::', r.ex);
}
main();
