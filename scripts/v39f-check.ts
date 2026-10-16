// Constellations 0.3.9 (lot F) checks: multiplayer by turn files (run: npx tsx scripts/v39f-check.ts).
let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };

async function main() {
  const { createGame, defaultSettings, newFleet } = await import('../src/engine/newgame');
  const { PREDEFINED_RACES } = await import('../src/engine/race');
  const { generateTurn } = await import('../src/engine/turn');
  const PB = await import('../src/engine/pbem');

  console.log('--- turn files');
  const s = { ...defaultSettings(), seed: 'v39f', shape: 'arm' as const, size: 'Small' as const };
  const host = createGame({ name: 'Partie à trois', settings: s, players: [
    { race: PREDEFINED_RACES.Humanoid(), ai: null },
    { race: PREDEFINED_RACES.Insectoid(), ai: null, name: 'Chitineux' },
    { race: PREDEFINED_RACES.Rabbitoid(), ai: null, name: 'Bondisseurs' },
    { race: PREDEFINED_RACES.Silicanoid(), ai: 'standard' },
  ] } as any);
  PB.startHosting(host);
  check(host.pbem?.role === 'host' && PB.pbemHumans(host).length === 3, 'a hosted game with three humans and a computer');
  check(PB.missingOrders(host).length === 3, 'no orders yet');
  const files = PB.pbemHumans(host).map(id => PB.turnFile(host, id, 'slot-host'));
  const raw = files.map(f => JSON.stringify(f));
  check(raw.every(r => r.length < 2_000_000), `turn files are compact (${raw.map(r => Math.round(r.length / 1024) + ' Ko').join(', ')})`);
  check(PB.fileName(files[1]).endsWith('.tour.json') && PB.fileName(files[1]).includes(String(host.year)), `a clear file name (${PB.fileName(files[1])})`);
  const opened = raw.map(r => { const x = PB.readPbem(r)!; return { file: x.file, g: PB.openTurn(x.file, x.game) }; });
  const g1 = opened[1].g, g2 = opened[2].g;
  check(g1.human === 1 && g1.pbem?.role === 'player' && g1.pbem.player === 1 && (g1 as any).id === `pbem-${host.pbem!.hostId}-1`, 'a turn file opens as that player, in a slot of its own');
  check(g1.players[2].messages.length === 0 && g1.players[1].messages.length > 0, 'the other humans\' reports are not in it');
  check(g1.nextId !== g2.nextId && Math.abs(g1.nextId - g2.nextId) >= PB.ID_STRIDE, 'each player creates ids in a range of their own');

  // player 1: a production order, a split fleet, a waypoint
  const hw1 = g1.planets.find(p => p.owner === 1 && p.homeworld)!;
  hw1.queue.unshift({ kind: 'defenses', qty: 7, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } });
  const f1 = g1.fleets.find(f => f.owner === 1)!;
  const piece = newFleet(g1, g1.players[1], f1.tokens[0].designId, 1, hw1);
  const target = g1.planets.find(p => p.owner < 0)!;
  piece.waypoints.push({ x: target.x, y: target.y, target: 'planet', targetId: target.id, warp: 6, task: 'none' });
  g1.players[1].researching = 'weapons';
  // player 2: research
  g2.players[2].researching = 'biotechnology';
  const o1 = PB.ordersFile(g1), o2 = PB.ordersFile(g2);
  check(PB.fileName(o1).endsWith('.ordres.json'), `orders file name (${PB.fileName(o1)})`);

  console.log('--- the merge');
  const r1 = PB.readPbem(JSON.stringify(o1))!;
  check(PB.mergeOrders(host, r1.file, r1.game) === null, 'the host takes the orders of the second empire');
  const hhw1 = host.planets[hw1.id];
  check(hhw1.queue[0].kind === 'defenses' && hhw1.queue[0].qty === 7, 'its production order is in the host\'s game');
  check(host.fleets.some(f => f.id === piece.id && f.waypoints.length === 2), 'the fleet it split off is there, with its orders');
  check(host.players[1].researching === 'weapons', 'and its research');
  check(PB.missingOrders(host).length === 2, 'two empires still to come');
  // again: the same orders do not add anything twice
  const fleets = host.fleets.length;
  PB.mergeOrders(host, r1.file, PB.readPbem(JSON.stringify(o1))!.game);
  check(host.fleets.length === fleets, 'taking the same orders twice changes nothing');
  const r2 = PB.readPbem(JSON.stringify(o2))!;
  check(PB.mergeOrders(host, r2.file, r2.game) === null && host.players[2].researching === 'biotechnology', 'the third empire\'s orders');
  check(host.planets[hw1.id].queue[0].kind === 'defenses', 'without undoing the second\'s');
  // errors
  const other = { ...r2.file, hostId: 'zzz' };
  check(PB.mergeOrders(host, other, r2.game) !== null, 'orders of another game are refused');

  console.log('--- the year');
  check(PB.missingOrders(host).length === 1 && PB.missingOrders(host)[0] === 0, 'the first empire has not sent its orders');
  PB.beforeGenerate(host);
  generateTurn(host);
  PB.prepareTurn(host);
  check(host.pbem!.turn === host.year && PB.missingOrders(host).length === 3, 'a new year: new turn files, no orders yet');
  const ids = host.fleets.map(f => f.id).concat(host.designs.map(d => d.id));
  check(new Set(ids).size === ids.length, 'no id is used twice');
  check(host.fleets.some(f => f.id === piece.id), 'the fleet created by a player lives on');
  const late = PB.readPbem(JSON.stringify(o1))!;
  check(PB.mergeOrders(host, late.file, late.game) !== null, 'last year\'s orders are refused');
  // a second year round trip
  const t2 = PB.readPbem(JSON.stringify(PB.turnFile(host, 1)))!;
  const g1b = PB.openTurn(t2.file, t2.game);
  check(g1b.year === host.year && g1b.fleets.some(f => f.id === piece.id), 'the next turn file carries on');
  const ob = PB.readPbem(JSON.stringify(PB.ordersFile(g1b)))!;
  check(PB.mergeOrders(host, ob.file, ob.game) === null, 'and its orders come back');

  console.log('--- diplomacy between two humans');
  {
    const DIP = await import('../src/engine/diplomacy');
    const tA = PB.readPbem(JSON.stringify(PB.turnFile(host, 1)))!; const gA = PB.openTurn(tA.file, tA.game);
    for (const g of [gA]) { g.players[1].intel.met = [...new Set([...g.players[1].intel.met, 2])]; g.players[2].intel.met = [...new Set([...g.players[2].intel.met, 1])]; }
    const why = DIP.proposalBlocker(gA, 1, 2, 'peace');
    const kind = why ? 'trade' : 'peace';
    const blocked = DIP.proposalBlocker(gA, 1, 2, kind as any);
    check(!blocked, `a proposal between two humans can be made (${kind}${blocked ? ': ' + blocked : ''})`);
    DIP.propose(gA, 1, 2, kind as any);
    const pr = gA.diplomacy!.proposals.find(p => p.from === 1 && p.to === 2)!;
    const oA = PB.readPbem(JSON.stringify(PB.ordersFile(gA)))!;
    PB.mergeOrders(host, oA.file, oA.game);
    check(host.diplomacy!.proposals.some(p => p.id === pr.id), 'the proposal reaches the host');
    check(host.players[2].messages.some(m => m.text.includes('proposent')), 'and the other empire is told');
    // the other one answers next year
    PB.beforeGenerate(host); generateTurn(host); PB.prepareTurn(host);
    const tB = PB.readPbem(JSON.stringify(PB.turnFile(host, 2)))!; const gB = PB.openTurn(tB.file, tB.game);
    check(gB.diplomacy!.proposals.some(p => p.id === pr.id), 'the turn file of the other empire holds it');
    DIP.answer(gB, pr.id, true);
    const oB = PB.readPbem(JSON.stringify(PB.ordersFile(gB)))!;
    PB.mergeOrders(host, oB.file, oB.game);
    const pair = DIP.pairOf(host, 1, 2);
    check(!host.diplomacy!.proposals.some(p => p.id === pr.id) && (kind === 'peace' ? pair?.status === 'peace' : pair?.trade !== undefined), `accepted: the treaty is in the host's game (${JSON.stringify(pair)})`);
  }

  console.log(bad ? `${bad} FAILED, ${good} ok` : `all good (${good})`);
  if (bad) process.exit(1);
}
void main();
