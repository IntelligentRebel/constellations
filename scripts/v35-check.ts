// Constellations 3.5 checks: intelligence on the other empires (run: npx tsx scripts/v35-check.ts).
import { quickGame, newFleet, addDesign, classicRules } from '../src/engine/newgame';
import { generateTurn } from '../src/engine/turn';
import type { GameState, Planet } from '../src/engine/types';
import { setRule } from '../src/engine/rules';
import { runProduction, availableItems, unitCost, itemLabel } from '../src/engine/production';
import { designAtTech } from '../src/engine/guardians';
import { capitalOf } from '../src/engine/empire';
import { invade } from '../src/engine/tasks';
import * as I from '../src/engine/espionage';
import * as DIP from '../src/engine/diplomacy';
import { updateIntel } from '../src/engine/scan';

let bad = 0, good = 0;
const check = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL', m); } else { good++; console.log('ok  ', m); } };
const quiet = (g: GameState) => { for (const p of g.players) if (!p.monster) p.ai = null; return g; };
const game = (seed: string, size: GameState['settings']['size'] = 'Small', n = 3) => quiet(quickGame(undefined, size, n, 'standard', seed));
const turns = (g: GameState, n: number) => { for (let i = 0; i < n; i++) generateTurn(g); };
const meetAll = (g: GameState) => { for (const p of g.players) if (!p.monster) for (const o of g.players) if (!o.monster && o.id !== p.id && !p.intel.met.includes(o.id)) p.intel.met.push(o.id); };
const msgs = (g: GameState, id: number) => g.players[id].messages.map(m => m.text);
const strong = (g: GameState, owner: number, tech: number, hull = 'Destroyer') => addDesign(g, designAtTech(g.players[owner], tech, hull, 'beamWarship', `Test ${hull} ${tech}`)!);
const lvl = (g: GameState, a: number, b: number) => g.players[a].intel.dossiers?.[b]?.level ?? 0;
const lines = (g: GameState, a: number, b: number) => (g.players[a].intel.dossiers?.[b]?.lines ?? []).map(l => `${l.label} +${l.value}`).join(', ');

console.log('--- the rule');
{
  const g = game('int-1');
  check(!!g.settings.espionage, 'Intelligence on in new games');
  const c = classicRules(game('int-1c'));
  check(!c.settings.espionage, 'off with the classic rules');
  turns(g, 1);
  check(g.players.filter(p => !p.monster).every(p => Object.values(p.intel.dossiers ?? {}).every(d => d.level === 0) || p.intel.met.length > 0), 'nothing known of empires never met');
  // an older game: the rule switched on during the game works out what is known at once, silently
  const h = game('int-1b');
  h.settings.espionage = false;
  meetAll(h);
  for (const p of h.players) p.intel.dossiers = undefined;
  turns(h, 3);
  const cap1 = capitalOf(h, h.players[1])!;
  newFleet(h, h.players[0], strong(h, 0, 6, 'Scout').id, 1, cap1);
  turns(h, 1);
  check(!h.players[0].intel.dossiers, 'rule off: no dossiers');
  const n = h.players[0].messages.length;
  setRule(h, 'espionage', true);
  check(lvl(h, 0, 1) > 0 && h.players[0].messages.length === n, `switched on: level ${lvl(h, 0, 1)} at once, no flood of reports`);
}

console.log('--- scanners and ships in orbit');
{
  const g = game('int-2');
  meetAll(g);
  turns(g, 1);
  const l0 = lvl(g, 0, 1);
  const hw1 = capitalOf(g, g.players[1])!;
  const d = strong(g, 0, 6, 'Scout');
  newFleet(g, g.players[0], d.id, 1, hw1);
  turns(g, 1);
  const l1 = lvl(g, 0, 1);
  check(l1 > l0 && /Mondes sous vos scanners/.test(lines(g, 0, 1)) && /Capitale observée/.test(lines(g, 0, 1)), `a ship in orbit of their capital: ${l0} → ${l1} (${lines(g, 0, 1)})`);
  const pl = g.players[0].intel.dossiers![1];
  check(pl.facts.planets !== undefined && pl.facts.planets.year === g.year, `their planet count is estimated (${pl.facts.planets?.v} ±${pl.facts.planets?.err} %, really ${g.planets.filter(x => x.owner === 1).length})`);
  check((pl.facts.escort === undefined || pl.facts.escort.err > 0) && pl.techs === undefined && pl.research === undefined, `at best an estimate of their navy, not their technology by field or research (level ${pl.level})`);
  check(msgs(g, 0).some(t => t.includes('Renseignement sur les') && t.includes('page Diplomatie')), 'a report announces the new step');
}

console.log('--- ships in sight');
{
  const g = game('int-2s');
  meetAll(g);
  turns(g, 1);
  const spot = g.planets.find(x => x.owner < 0)!;
  const war = strong(g, 1, 10, 'Destroyer');
  newFleet(g, g.players[1], war.id, 4, spot);
  newFleet(g, g.players[0], strong(g, 0, 6, 'Scout').id, 1, spot);
  turns(g, 1);
  const vis = I.visibleShips(g, g.players[0], 1);
  const seen = g.fleets.filter(f => f.owner === 1 && g.players[0].intel.fleets.some(x => x.id === f.id)).reduce((a, f) => a + f.tokens.reduce((b, t) => b + t.qty, 0), 0);
  check(vis.unarmed + vis.escort + vis.capital + vis.unsure >= 4 && vis.unarmed + vis.escort + vis.capital <= seen, `their ships in sight, by class: ${vis.unarmed} unarmed, ${vis.escort} escort, ${vis.capital} capital${vis.unsure ? `, ~${vis.unsure} unsure` : ''} (of ${seen} seen)`);
  const none = I.visibleShips(g, g.players[0], 2);
  check(none.fleets === g.players[0].intel.fleets.filter(x => x.owner === 2).length, 'only what the scanners show');
}

console.log('--- better or worse than us');
{
  check(I.gapOf(10, 10) === 'equal' && I.gapOf(100, 103) === 'tiny' && I.gapOf(100, 110) === 'small' && I.gapOf(100, 130) === 'medium' && I.gapOf(100, 200) === 'large' && I.gapOf(100, 400) === 'huge', 'gaps: =, very little, little, medium, a lot, gigantic');
  check(I.gapOf(0, 2) === 'large' && I.gapOf(1, 2) === 'medium' && I.gapOf(7, 8) === 'small', 'small numbers are smoothed (0 against 2 ships: a lot, not gigantic)');
  check(I.gapOf(27, 7) === 'huge' && I.gapOf(240, 144) === 'large', `27 planets against 7: gigantic; a score of 240 against 144: a lot`);
}

console.log('--- embassies');
{
  const g = game('int-3');
  for (const p of g.players) if (!p.monster && p.id !== 0) p.ai = 'standard';
  meetAll(g);
  turns(g, 1);
  const pred = DIP.evaluate(g, 1, 0, 'embassy');
  check(pred.why.includes(`il faudrait une opinion d'au moins ${DIP.NEED.embassy}`), `the answer is announced (${pred.why})`);
  const before0 = lvl(g, 0, 1), before1 = lvl(g, 1, 0);
  const ans = DIP.propose(g, 0, 1, 'embassy');
  check(!!ans && ans.ok === pred.ok, `proposed: ${ans?.ok ? 'accepted' : 'refused'} as announced`);
  if (!ans?.ok) DIP.sign(g, 0, 1, 'embassy');
  check(DIP.pairOf(g, 0, 1)!.embassy === g.year, 'embassies open');
  const c1 = capitalOf(g, g.players[1])!, c0 = capitalOf(g, g.players[0])!;
  check(g.players[0].intel.planets[c1.id].owner === 1 && g.players[0].intel.planets[c1.id].year === g.year && g.players[1].intel.planets[c0.id].owner === 0, 'each side knows the other\'s capital at once');
  check(DIP.opinion(g, 1, 0).lines.some(l => l.label === 'Ambassades'), 'they improve the opinion a little');
  check(DIP.proposalBlocker(g, 0, 1, 'embassy') === 'ambassades déjà ouvertes', 'cannot be opened twice');
  turns(g, 1);
  check(lvl(g, 0, 1) >= before0 + I.EMBASSY && lvl(g, 1, 0) >= before1 + I.EMBASSY, `both sides learn: us ${before0} → ${lvl(g, 0, 1)}, them ${before1} → ${lvl(g, 1, 0)}`);
  const cap1 = capitalOf(g, g.players[1])!;
  check(g.players[0].intel.planets[cap1.id].year === g.year && g.players[0].intel.planets[cap1.id].owner === 1, `their capital (${cap1.name}) is seen through the embassy`);
  DIP.declareWar(g, 0, 1);
  check(DIP.pairOf(g, 0, 1)!.embassy === undefined && msgs(g, 0).some(t => t.includes('ambassades entre vos deux empires sont fermées')), 'war closes the embassies');
  DIP.makePeace(g, 0, 1);
  DIP.sign(g, 0, 1, 'embassy');
  DIP.cancel(g, 0, 1, 'embassy');
  check(DIP.pairOf(g, 0, 1)!.embassy === undefined && DIP.opinion(g, 1, 0).lines.some(l => l.label === 'Accords rompus par vous'), 'closing them is noticed');
  // without the rule
  setRule(g, 'espionage', false);
  check(DIP.proposalBlocker(g, 0, 2, 'embassy') === 'règle Renseignement désactivée', 'no embassies without the rule');
}

console.log('--- spies and the agency');
{
  const g = game('int-4');
  meetAll(g);
  turns(g, 1);
  const me = g.players[0];
  const hw = capitalOf(g, me)!;
  const items = availableItems(g, hw);
  const spy = items.filter(i => i.kind === 'spy');
  check(spy.length === me.intel.met.length && spy.every(i => !i.disabled), `spies can be bought on each empire met (${spy.map(i => i.label).join(', ')})`);
  check(unitCost(g, hw, me, { kind: 'spy', bountyOn: 1 }).resources === I.SPY_UNIT, `${I.SPY_UNIT} R a unit`);
  const ag = items.find(i => i.kind === 'agency');
  check(!!ag, `an agency can be built (${ag?.disabled ?? 'available'})`);
  me.tech.electronics = Math.max(me.tech.electronics, 5);
  hw.queue = [{ kind: 'spy', bountyOn: 1, qty: 2, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }];
  hw.surface = { ironium: 5000, boranium: 5000, germanium: 5000 };
  for (let i = 0; i < 30 && hw.queue.length; i++) runProduction(g, hw, () => {});
  const net = me.intel.dossiers![1].network ?? 0;
  check(net === 2 * I.SPY_GAIN && msgs(g, 0).some(t => t.includes('d\'espions chez les')), `two units: network ${net}`);
  check(itemLabel(g, { kind: 'spy', bountyOn: 1 }).includes(g.players[1].name), 'the queue says where');
  turns(g, 1);
  check(/Réseau d'espions/.test(lines(g, 0, 1)), `the network counts (${lines(g, 0, 1)})`);
  check((me.intel.dossiers![1].network ?? 0) < net, `and wears out (${net} → ${Math.round(me.intel.dossiers![1].network ?? 0)})`);
  me.intel.dossiers![1].network = I.SPY_MAX;
  check(I.spyBlocker(g, me, 1)?.includes('maximum') ?? false, 'a network has a ceiling');
  // the agency
  hw.queue = [{ kind: 'agency', qty: 1, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }];
  for (let i = 0; i < 20 && !hw.agency; i++) runProduction(g, hw, () => {});
  check(!!hw.agency && I.agencyOf(g, 0) === hw, 'the agency is built');
  const other = g.planets.find(x => x.owner === 0 && x !== hw);
  if (other) check(!!I.agencyBlocker(g, other), `one per empire (${I.agencyBlocker(g, other)})`);
  check(I.spyGain(g, me) === Math.round(I.SPY_GAIN * 1.5), `it makes spies go further (${I.spyGain(g, me)} a unit)`);
  check(I.detectChance(g, g.players[1], 0, 30) > I.detectChance(g, g.players[2], 1, 30), 'and uncovers foreign networks more often');
}

console.log('--- uncovered networks');
{
  const g = game('int-5');
  for (const p of g.players) if (!p.monster && p.id !== 0) p.ai = 'standard';
  meetAll(g);
  const cap1 = capitalOf(g, g.players[1])!;
  cap1.agency = true;
  let caught = false;
  for (let y = 0; y < 40 && !caught; y++) {
    I.dossierOf(g.players[0], 1).network = I.SPY_MAX;
    generateTurn(g);
    caught = msgs(g, 0).some(t => t.includes('ont démasqué une partie de votre réseau'));
  }
  check(caught, `a network gets caught (year ${g.year})`);
  check(msgs(g, 1).some(t => t.includes('a démantelé un réseau d\'espions des')), 'the victim is told');
  check(DIP.opinion(g, 1, 0).lines.some(l => l.label === 'Vos espions démasqués chez eux'), 'and holds it against the spy');
}

console.log('--- figures: estimates, then exact, then everything');
{
  const g = game('int-6');
  meetAll(g);
  turns(g, 2);
  const me = g.players[0], o = g.players[1];
  // about 30: estimates
  const d = I.dossierOf(me, 1);
  d.network = 38; d.fresh = 0;
  const hw1 = capitalOf(g, o)!;
  generateTurn(g);
  const real = o.scores[o.scores.length - 1];
  const f = d.facts;
  check(d.level >= 30 && d.level < 55, `level ${d.level} (${lines(g, 0, 1)})`);
  check(!!f.score && f.score.err > 0 && Math.abs(f.score.v - real.score) <= real.score * 0.31 + 10, `score estimated: ≈ ${f.score?.v} ±${f.score?.err} % (really ${real.score})`);
  check(!!f.resources === d.level >= 30, `resources ${f.resources ? `≈ ${f.resources.v} (really ${real.resources})` : 'unknown'}`);
  check(!d.objectives && !d.research, 'research and objectives stay hidden');
  // 100: everything
  DIP.sign(g, 0, 1, 'embassy'); DIP.sign(g, 0, 1, 'trade'); DIP.sign(g, 0, 1, 'research'); DIP.sign(g, 0, 1, 'alliance');
  d.network = I.SPY_MAX;
  newFleet(g, me, strong(g, 0, 6, 'Scout').id, 1, hw1);
  generateTurn(g);
  const real2 = o.scores[o.scores.length - 1];
  check(d.level >= 90, `with embassies, treaties, an alliance and spies: ${d.level}`);
  check(Object.keys(I.FACT).every(k => d.facts[k as keyof typeof d.facts]?.err === 0) && d.facts.score!.v === real2.score && d.facts.capital!.v === real2.capital, 'every figure exact');
  check(!!d.techs && d.techs.v.energy === o.tech.energy && d.research?.field === o.researching, `technology by field and research (${d.research?.field})`);
  check(!!d.victory && (!g.settings.secretObjectives || (d.objectives?.list.length ?? 0) > 0), 'victory conditions and secret objectives');
  check((d.history?.length ?? 0) >= 2, `the score is followed over the years (${d.history?.length} points)`);
  // sources gone: what was learnt stays, dated
  DIP.declareWar(g, 0, 1);
  d.network = 0;
  g.fleets = g.fleets.filter(x => !(x.owner === 0 && x.orbiting === hw1.id));
  const year = g.year;
  turns(g, 2);
  check(d.level < 30 && d.facts.capital?.year === year, `sources lost: level ${d.level}, the navy figures stay, dated ${d.facts.capital?.year}`);
}

console.log('--- allies share, battles teach, conquests too');
{
  const g = game('int-7', 'Small', 4);
  meetAll(g);
  turns(g, 1);
  I.dossierOf(g.players[1], 2).network = I.SPY_MAX;
  DIP.sign(g, 0, 1, 'alliance');
  generateTurn(g);
  check(/partagés par les/.test(lines(g, 0, 2)), `an ally shares (${lines(g, 0, 2)})`);
  // a battle
  DIP.declareWar(g, 0, 3);
  const spot = g.planets.find(x => x.owner < 0)!;
  newFleet(g, g.players[0], strong(g, 0, 10).id, 3, spot);
  newFleet(g, g.players[3], strong(g, 3, 10).id, 3, spot);
  generateTurn(g);
  const fought = g.battles.some(b => b.players.includes(0) && b.players.includes(3));
  check(!fought || /Combats et conquêtes/.test(lines(g, 0, 3)), `a battle teaches something (${fought ? lines(g, 0, 3) : 'no battle'})`);
  // a conquest with the archives of an agency
  const t = capitalOf(g, g.players[3])!;
  t.agency = true; t.starbase = null; t.defenses = 0;
  const pop = t.pop;
  invade(g, g.players[0], t, pop * 3);
  check(t.owner === 0 && !t.agency && (g.players[0].intel.dossiers?.[3]?.fresh ?? 0) >= 40, 'the archives of their agency fall into our hands');
  check(msgs(g, 0).some(x => x.includes('archives de l\'Agence')) && msgs(g, 3).some(x => x.includes('Votre Agence de renseignement est perdue')), 'both are told');
}

console.log('--- computers judge strength through intelligence');
{
  const g = game('int-8');
  for (const p of g.players) if (!p.monster && p.id !== 0) p.ai = 'standard';
  meetAll(g);
  turns(g, 1);
  const p0 = I.perception(g, 1, 0);
  check(p0.err > 0.25, `knowing little, a ±${Math.round(p0.err * 100)} % error on our strength`);
  I.dossierOf(g.players[1], 0).level = 85;
  const p1 = I.perception(g, 1, 0);
  check(p1.err === 0 && p1.factor === 1, 'knowing a lot, the exact strength');
  I.dossierOf(g.players[1], 0).level = 0;
  DIP.declareWar(g, 1, 0);
  g.year += 5;
  const w = DIP.evaluate(g, 1, 0, 'peace');
  check(/force estimée|leur force/.test(w.why), `their answers say it (${w.why})`);
  setRule(g, 'espionage', false);
  check(I.perception(g, 1, 0).factor === 1 && I.levelOf(g, 1, 0) === 0, 'without the rule: exact strength, no levels');
  check(!availableItems(g, capitalOf(g, g.players[0])!).some(i => i.kind === 'spy' || i.kind === 'agency'), 'and no spies or agency in production');
}

console.log('--- saves');
{
  const g = game('int-9');
  meetAll(g);
  I.dossierOf(g.players[0], 1).network = 20;
  turns(g, 2);
  const h = JSON.parse(JSON.stringify(g)) as GameState;
  check(JSON.stringify(h.players[0].intel.dossiers) === JSON.stringify(g.players[0].intel.dossiers), 'dossiers saved and loaded');
  turns(h, 1); turns(g, 1);
  check(JSON.stringify(h.players[0].intel.dossiers) === JSON.stringify(g.players[0].intel.dossiers), 'and the next year is identical (deterministic)');
}

console.log('--- computer games');
{
  let emb = 0, nets = 0, ag = 0, caught = 0, humanBest = 0, steps = 0;
  for (const seed of ['int-g1', 'int-g2']) {
    const g = quickGame(undefined, 'Medium', 5, 'standard', seed);
    g.players[0].ai = 'standard';
    for (let y = 0; y < 80; y++) generateTurn(g);
    const emps = g.players.filter(p => !p.monster);
    emb += Object.values(g.diplomacy!.pairs).filter(p => p.embassy !== undefined).length;
    nets += emps.reduce((a, p) => a + Object.values(p.intel.dossiers ?? {}).filter(d => (d.network ?? 0) >= 1).length, 0);
    ag += g.planets.filter(x => x.agency).length;
    caught += emps.reduce((a, p) => a + p.messages.filter(m => m.text.includes('démasqué')).length, 0);
    for (const p of emps) for (const d of Object.values(p.intel.dossiers ?? {})) humanBest = Math.max(humanBest, d.level);
    steps += g.players.some(p => p.messages.some(m => m.text.startsWith('Renseignement sur'))) ? 1 : 0;
    console.log(`     ${g.year}: ${Object.values(g.diplomacy!.pairs).filter(p => p.embassy !== undefined).length} embassies, ${g.planets.filter(x => x.agency).length} agencies, levels ${emps.map(p => Object.values(p.intel.dossiers ?? {}).map(d => d.level).join('/')).join(' · ')}`);
  }
  check(emb > 0, `computers open embassies (${emb})`);
  check(ag > 0, `and build agencies (${ag})`);
  check(humanBest >= 40, `levels rise during a game (best ${humanBest})`);
  void nets; void caught; void steps; void updateIntel;
}

console.log(bad ? `${bad} failure(s), ${good} ok` : `all good (${good})`);
process.exit(bad ? 1 : 0);
