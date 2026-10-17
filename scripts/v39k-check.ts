// Constellations 0.3.9.15 checks: data tables of 15 October 2026 (craig-stars parity pass) and a computer that only
// uses what it knows (run: npx tsx scripts/v39k-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { quickGame } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES, baseRace } = await import('../src/engine/race') as any;
  const { TECHS, HULLS, partFitsSlot, playerCost } = await import('../src/engine/tech');
  const { designSpec } = await import('../src/engine/design');
  type G = ReturnType<typeof quickGame>;

  // --- tables
  const t = (n: string) => TECHS.get(n)!, h = (n: string) => HULLS.get(n)!;
  check(JSON.stringify(h('Mini Bomber').cost) === '[20,5,10,35]', 'Mini Bomber costs 20/5/10/35 (no longer miniaturized twice)');
  check(JSON.stringify(t('Alien Miner').cost) === '[8,0,2,20]', 'Alien Miner costs 8/0/2/20');
  check(t('Total Terraform ±3').cost[3] === 70, 'Total Terraform costs 70 resources');
  check(t('Mini Gun').stats?.power === 13 && t('Mini Gun').cost[1] === 16, 'Mini Gun: power 13, 16 boranium');
  check(h('B-52 Bomber').slots[0].cap === 3 && h('Super Mine Layer').slots[0].cap === 3, 'B-52 and Super Mine Layer take three engines');
  check(h('Meta Morph').cargo === 300, 'Meta Morph carries 300 kT');
  check(!!t('Robo-Midget-Miner') && !!t('Anti-Matter Generator'), 'the two renamed parts keep their names in the game (saved designs)');
  check(!!t('Robo-Midget-Miner').req.lrtsDenied?.includes('OBRM') && !!h('Midget Miner').req.lrtsDenied?.includes('OBRM'), 'OBRM forbids the midget miner hull and robot');
  check(!!t('Laser Battery').req.prtsDenied?.includes('WM'), 'WM cannot build laser batteries');
  check(!partFitsSlot(t('Transport Cloaking'), ['Scanner', 'Mechanical', 'Electrical', 'Shield', 'Armor', 'Weapon', 'MineLayer'], 'Scout'), 'the transport cloak does not go on a hull with room for weapons');
  check(partFitsSlot(t('Transport Cloaking'), ['Scanner', 'Mechanical', 'Electrical'], 'Small Freighter'), '… but goes on a freighter');

  {
    const { tidyDesigns } = await import('../src/engine/design');
    const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 1, 'easy', 'v39k-tidy');
    g.designs.push({ id: 99999, owner: 0, name: 'Old layer', hull: 'Super Mine Layer', starbase: false, slots: [{ slot: 4, part: 'Tritanium', qty: 4 }] } as any);
    tidyDesigns(g);
    check(g.designs.find(d => d.id === 99999)!.slots[0].qty === 3, 'a saved design over the new capacity of its slot is brought back to it (4 → 3)');
  }

  // --- starting fleets
  const start = (race: any, size = 'Small') => {
    const g = quickGame(race, size as any, 1, 'easy', 'v39k-' + race.prt + size);
    const names = g.fleets.filter(f => f.owner === 0).map(f => g.designs.find(d => d.id === f.tokens[0].designId)!);
    return { g, names: names.map(d => d.name), designs: names };
  };
  const R = (prt: string, extra: any = {}) => ({ ...PREDEFINED_RACES.Humanoid(), prt, ...extra });
  const ss = start(R('SS'));
  const shadow = ss.designs.find(d => d.hull === 'Small Freighter');
  check(!!shadow && shadow.slots.some(s => s.part === 'Transport Cloaking'), 'SS starts with a cloaked freighter (' + ss.names.join(', ') + ')');
  check(!!shadow && designSpec(ss.g.players[0], shadow).cloakPercent > 0, '… and it is cloaked');
  const wm = start(R('WM'));
  const wmCon = wm.g.players[0].tech.construction;
  check(wm.designs.some(d => d.hull === 'Destroyer') === wmCon >= 3, `WM gets a Destroyer only with Construction 3 (has ${wmCon}): ${wm.names.join(', ')}`);
  const obrm = start(R('JoaT', { lrts: ['ARM', 'OBRM'] }));
  check(!obrm.designs.some(d => d.hull === 'Midget Miner'), 'ARM + OBRM starts without Potato Bugs');
  const arm = start(R('JoaT', { lrts: ['ARM'] }));
  check(arm.designs.filter(d => d.hull === 'Midget Miner').length === 2, 'ARM alone still starts with two Potato Bugs');
  for (const prt of ['HE', 'SS', 'WM', 'CA', 'IS', 'SD', 'PP', 'IT', 'AR', 'JoaT']) {
    const s = start(R(prt));
    check(!s.designs.some(d => !HULLS.has(d.hull)) && s.names.length >= 1, `${prt} starts with ${s.names.join(', ')}`);
  }
  const ex = { energy: 'extra', weapons: 'extra', propulsion: 'extra', construction: 'extra', electronics: 'extra', biotechnology: 'extra' };
  const joat4 = start(R('JoaT', { researchCost: ex, techsStartHigh: true }));
  check(joat4.g.players[0].tech.construction === 4 && joat4.designs.some(d => d.hull === 'Privateer') && !joat4.designs.some(d => d.hull === 'Medium Freighter'), `JoaT starting at tech 4: a Swashbuckler instead of the Teamster (${joat4.names.join(', ')})`);
  const ssHigh = start(R('SS', { researchCost: ex, techsStartHigh: true }));
  const sleuth = ssHigh.designs.find(d => d.hull === 'Scout');
  check(!!sleuth && sleuth.slots.some(s => s.part === 'Stealth Cloak'), `SS starting with the Stealth Cloak: its scout carries it (${ssHigh.names.join(', ')})`);
  // the starting fleet does not depend on the shift of the tech tree
  const shifted = [1, 2, 3, 4, 5, 6].map(i => quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 1, 'easy', 'shift' + i)).map(g => g.fleets.filter(f => f.owner === 0).length);
  check(new Set(shifted).size === 1, `the same starting fleet in every game (${shifted.join(', ')} fleets)`);
  // PP / IT: 25,000 colonists on a tiny map (no second world), 20,000 + 10,000 otherwise
  const pp = start(R('PP'), 'Small'), ppT = start(R('PP'), 'Tiny');
  const hw = (g: G) => g.planets.find(p => p.owner === 0 && p.homeworld)!;
  check(hw(pp.g).pop === 20000 && pp.g.planets.filter(p => p.owner === 0).length === 2, 'PP: 20,000 on its homeworld and a second world');
  check(hw(ppT.g).pop === 25000 && ppT.g.planets.filter(p => p.owner === 0).length === 1, 'PP on a tiny map: 25,000 on its only world');

  // --- a computer that only uses what it knows
  {
    const AK = await import('../src/engine/aiknow');
    const AI = await import('../src/engine/ai');
    const { learnDesign } = await import('../src/engine/scan');
    const { newFleet, addDesign } = await import('../src/engine/newgame');
    const { autoDesign, specOf } = await import('../src/engine/design');
    const { generateTurn } = await import('../src/engine/turn');
    const g = quickGame(PREDEFINED_RACES.Humanoid(), 'Small', 3, 'expert', 'v39k-know');
    g.settings.cataclysms = false;
    while (g.year < 2412) generateTurn(g);
    const p = g.players[1], foe = g.players[2];
    // an armed scout of the other empire, seen in the scanners: only its hull is known
    const sd = addDesign(g, { ...autoDesign(foe, 'Scout', 'armedScout', 'Dard')!, owner: 2 } as any);
    const real = specOf(g, sd.id);
    const f = newFleet(g, foe, sd.id, 3, g.planets.find(pl => pl.owner === 2)!);
    learnDesign(p, g, sd.id, false);
    const fi = { id: f.id, owner: 2, x: f.x, y: f.y, detail: 'full' as const, tokens: [{ designId: sd.id, qty: 3 }] };
    check(real.powerRating > 0 && AK.seenMight(g, p, fi).pow === 0, `an armed scout seen from afar passes for unarmed (really ${real.powerRating} of firepower)`);
    learnDesign(p, g, sd.id, true);
    check(AK.seenMight(g, p, fi).pow === real.powerRating * 3, 'once met in battle, its guns are known');
    const contact = { id: f.id, owner: 2, x: f.x, y: f.y, detail: 'contact' as const, mass: 40, uncertain: true };
    check(AK.seenMight(g, p, contact).hp === 120, 'a contact it cannot make out: judged by its mass');
    // a warship hull it has not met: guessed with its own technology
    const wd = addDesign(g, { ...autoDesign(foe, 'Destroyer', 'beamWarship', 'Lame')!, owner: 2 } as any);
    learnDesign(p, g, wd.id, false);
    const guess = AK.seenMight(g, p, { id: 0, owner: 2, x: 0, y: 0, detail: 'full', tokens: [{ designId: wd.id, qty: 1 }] });
    check(guess.pow > 0 && guess.hp > 0, `a Destroyer seen from afar: guessed armed (${Math.round(guess.hp)} hp, ${Math.round(guess.pow)} firepower)`);
    // invasions: the defenses counted, not the real ones
    const target = g.planets.find(pl => pl.owner === 2)!;
    const pi = p.intel.planets[target.id];
    pi.owner = 2; pi.year = g.year; pi.pop = 20000; pi.defenses = 0;
    target.defenses = 100;
    const low = AI.invasionNeed(g, p, target);
    pi.defenses = 100;
    const high = AI.invasionNeed(g, p, target);
    check(high > low, `the troops sent follow the defenses counted there (${low} kT for 0, ${high} kT for 100), whatever is really there`);
  }

  console.log(`\n${good} ok, ${bad} failed`);
  if (bad) process.exit(1);
}
main();
