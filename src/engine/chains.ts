// 0.3.9: stories that unfold over decades. Every thirty or forty years, an empire lives one: a signal from a distant
// world that must be answered in time, a grey plague to quarantine or let run, a prophet to embrace or exile. Each step
// comes years after the previous one; the choices go through the dilemmas (same window, same five years).
import type { Dilemma, GameState, Planet, Player, StoryChain } from './types';
import { MINERALS } from './types';
import { Rng, seedFromString } from './rng';
import { distance, fleetSpec } from './fleet';
import { addResearch, researchCost } from './research';
import { addChronicle } from './chronicle';
import { newFleet, addDesign } from './newgame';
import { designAtTech, spawnGuardian, guardiansOn } from './guardians';
import { revealPlanet } from './scan';
import { DILEMMA, settle, type DilemmaDef } from './dilemmas';

export const chainsOn = (game: GameState) => !!game.settings.eventChains;
const rngOf = (game: GameState, tag: string) => new Rng(seedFromString(`${game.settings.seed}|chain|${tag}|${game.year}`));
const own = (game: GameState, p: Player) => game.planets.filter(pl => pl.owner === p.id);
const tell = (game: GameState, p: Player, text: string, planet?: Planet) => p.messages.push({ year: game.year, kind: 'event', text, target: planet ? { kind: 'planet', id: planet.id } : { kind: 'colonies', id: 0 } });
const maxTech = (p: Player) => Math.max(p.tech.energy, p.tech.weapons, p.tech.propulsion, p.tech.construction, p.tech.electronics, p.tech.biotechnology);

/** The choices of the stories, as dilemmas (never drawn at random: the story offers them). */
export const CHAIN_DILEMMAS: DilemmaDef[] = [
  {
    kind: 'plague', title: 'La peste grise',
    setup: () => null,
    text: c => `Une fièvre inconnue ronge ${c.game.planets[c.d.data!.planet as number].name} : la population y décline. La quarantaine ralentirait le mal mais isolerait le monde ; sans elle, la peste gagnera les colonies voisines.`,
    a: { label: 'Quarantaine', hint: () => 'le monde perd 3 % de sa population par an jusqu\'au remède, la peste reste confinée', apply: c => { const ch = chainOf(c.game, c.d.data!.chain as number); if (ch) ch.data.mode = 'quarantine'; return 'La quarantaine est décrétée.'; } },
    b: { label: 'Laisser circuler', hint: () => '5 % par an sur les mondes touchés, la peste peut gagner un monde voisin tous les trois ans', apply: c => { const ch = chainOf(c.game, c.d.data!.chain as number); if (ch) ch.data.mode = 'open'; return 'Les échanges continuent, et la fièvre avec eux.'; } },
    ai: c => c.rng.chance(0.7) ? 'a' : 'b',
  },
  {
    kind: 'prophet', title: 'Le prophète',
    setup: () => null,
    text: c => `Sur ${c.game.planets[c.d.data!.planet as number].name}, un prophète annonce un âge nouveau ; les foules le suivent. L'embrasser lierait l'empire à son destin ; l'exiler apaiserait les autorités, mais il ira prêcher ailleurs.`,
    a: { label: 'L\'embrasser', hint: () => 'dans dix ans, un grand élan (culture, population)… ou des troubles', apply: c => { const ch = chainOf(c.game, c.d.data!.chain as number); if (ch) ch.data.mode = 'embrace'; return 'Le prophète devient la voix du monde.'; } },
    b: { label: 'L\'exiler', hint: () => 'rien ne change ici ; il prêchera chez un voisin', apply: c => { const ch = chainOf(c.game, c.d.data!.chain as number); if (ch) ch.data.mode = 'exile'; return 'Le prophète est exilé.'; } },
    ai: c => c.rng.chance(0.5) ? 'a' : 'b',
  },
];
for (const d of CHAIN_DILEMMAS) DILEMMA[d.kind] = d;

const chainOf = (game: GameState, id: number) => game.chains?.find(c => c.id === id);

function offer(game: GameState, p: Player, kind: string, data: Dilemma['data']) {
  const def = DILEMMA[kind];
  const d: Dilemma = { id: game.nextId++, kind, year: game.year, expires: game.year + 5, data };
  if (p.ai) { settle(game, p, d.id, def.ai({ game, p, d, rng: rngOf(game, 'ai' + d.id) }), false, d); return; }
  (p.dilemmas ??= []).push(d);
  p.messages.unshift({ year: game.year, kind: 'warning', text: `Dilemme : ${def.title}. ${def.text({ game, p, d, rng: rngOf(game, 'v' + d.id) })} Vous avez jusqu'en ${d.expires} pour trancher (« À traiter »).`, target: { kind: 'planet', id: data!.planet as number } });
}

const KINDS = ['signal', 'plague', 'prophet'] as const;

function start(game: GameState, p: Player, rng: Rng): StoryChain | undefined {
  const kinds = rng.shuffle([...KINDS]).sort((a, b) => ((p.chainsSeen ?? []).includes(a) ? 1 : 0) - ((p.chainsSeen ?? []).includes(b) ? 1 : 0));
  const home = p.capital !== undefined ? game.planets[p.capital] : own(game, p)[0];
  if (!home) return undefined;
  for (const kind of kinds) {
    if (kind === 'signal') {
      const far = game.planets.filter(pl => !pl.hidden && pl.owner !== p.id && distance(pl, home) >= 150 && distance(pl, home) <= 420);
      if (!far.length) continue;
      const t = far[rng.int(far.length)];
      revealPlanet(game, p, t, false);
      tell(game, p, `Les antennes de ${home.name} captent un signal régulier, à peine audible, venu de ${t.name}. Ce n'est le chiffre d'aucun empire connu.`, t);
      return { id: game.nextId++, kind, owner: p.id, stage: 1, next: game.year + 5 + rng.int(4), data: { planet: t.id } };
    }
    const cols = own(game, p).filter(pl => pl.id !== p.capital && pl.pop > 15000);
    if (!cols.length) continue;
    const pl = cols[rng.int(cols.length)];
    const ch: StoryChain = { id: game.nextId++, kind, owner: p.id, stage: 1, next: game.year + (kind === 'plague' ? 10 + rng.int(5) : 10), data: { planet: pl.id, planets: String(pl.id) } };
    // the story is known while its first choice is offered (a computer answers at once)
    const arr = game.chains ??= [];
    arr.push(ch);
    offer(game, p, kind, { planet: pl.id, chain: ch.id });
    arr.splice(arr.indexOf(ch), 1);
    return ch;
  }
  return undefined;
}

/** Yearly: a new story for each empire now and then, the next step of the stories under way. */
export function runChains(game: GameState) {
  if (!chainsOn(game)) return;
  const list = game.chains ?? (game.chains = []);
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    const rng = rngOf(game, 'start' + p.id);
    p.nextChain ??= 2420 + rng.int(20);
    if (game.year < p.nextChain || list.some(c => c.owner === p.id && c.done === undefined)) continue;
    const ch = start(game, p, rng);
    p.nextChain = game.year + 30 + rng.int(15);
    if (!ch) continue;
    list.push(ch);
    p.chainsSeen = [...(p.chainsSeen ?? []).filter(k => k !== ch.kind), ch.kind];
  }
  for (const ch of list) if (ch.done === undefined) step(game, ch);
}

function step(game: GameState, ch: StoryChain) {
  const p = game.players[ch.owner];
  if (!p || p.dead) { ch.done = game.year; return; }
  const rng = rngOf(game, 'step' + ch.id);
  const pl = game.planets[ch.data.planet as number];
  if (ch.kind === 'signal') {
    if (ch.stage === 1 && game.year >= ch.next) {
      ch.stage = 2; ch.data.deadline = game.year + 15;
      tell(game, p, `Le signal de ${pl.name} se précise : il appelle. Pour savoir ce qui l'émet, un vaisseau doté d'un scanner doit se mettre en orbite de ${pl.name} avant ${ch.data.deadline}.`, pl);
      return;
    }
    if (ch.stage === 2) {
      const there = game.fleets.find(f => f.owner === p.id && distance(f, pl) < 1 && fleetSpec(game, f).scanRange > 0);
      if (there) return signalEnd(game, ch, p, pl, rng);
      if (game.year > (ch.data.deadline as number)) { ch.done = game.year; tell(game, p, `Le signal de ${pl.name} s'est tu. Nul ne saura ce qu'il annonçait.`, pl); }
    }
    return;
  }
  if (ch.kind === 'plague') {
    const mode = ch.data.mode as string | undefined;
    const ids = String(ch.data.planets).split(',').map(Number).filter(id => game.planets[id]?.owner === p.id);
    if (!ids.length) { ch.done = game.year; return; }
    if (game.year >= ch.next) {
      ch.done = game.year;
      const share = Math.max(20, Math.round(researchCost(game, p, 'biotechnology') * 0.3));
      addResearch(game, p, 'biotechnology', share);
      tell(game, p, ids.length > 1 ? `Vos biologistes ont trouvé le remède à la peste grise : ${ids.length} mondes sont sauvés, et la médecine progresse (Biotechnologie).` : `Vos biologistes ont trouvé le remède à la peste grise : ${game.planets[ids[0]].name} est sauvée, et la médecine progresse (Biotechnologie).`, game.planets[ids[0]]);
      addChronicle(game, 'event', `La peste grise des ${p.name} est vaincue.`, [p.id], game.planets[ids[0]]);
      return;
    }
    const loss = mode === 'quarantine' ? 0.03 : 0.05;
    for (const id of ids) { const w = game.planets[id]; w.pop = Math.max(100, Math.round(w.pop * (1 - loss) / 100) * 100); }
    if (mode !== 'quarantine' && (game.year - (ch.data.since as number ?? game.year)) % 3 === 2) {
      const next = own(game, p).filter(w => !ids.includes(w.id) && ids.some(id => distance(game.planets[id], w) <= 90)).sort((a, b) => Math.min(...ids.map(id => distance(game.planets[id], a))) - Math.min(...ids.map(id => distance(game.planets[id], b))))[0];
      if (next) { ids.push(next.id); tell(game, p, `La peste grise a gagné ${next.name}.`, next); }
    }
    ch.data.planets = ids.join(',');
    ch.data.since ??= game.year;
    return;
  }
  if (ch.kind === 'prophet' && game.year >= ch.next) {
    ch.done = game.year;
    const mode = ch.data.mode as string | undefined;
    if (mode === 'embrace') {
      if (pl.owner !== p.id) { tell(game, p, 'Le prophète est mort loin des siens : son mouvement s\'éteint.'); return; }
      if (rng.chance(0.7)) {
        pl.pop = Math.round(pl.pop * 1.15 / 100) * 100;
        pl.culture = (pl.culture ?? 0) + 80;
        if (p.golden) p.golden.inspiration += 400;
        tell(game, p, `L'élan du prophète a gagné tout l'empire : des pèlerins affluent vers ${pl.name} (+15 % de population), sa culture rayonne, et l'inspiration de vos peuples grandit.`, pl);
        addChronicle(game, 'event', `Le prophète de ${pl.name} soulève l'enthousiasme des ${p.name}.`, [p.id], pl);
      } else {
        pl.pop = Math.round(pl.pop * 0.85 / 100) * 100;
        pl.factories = Math.trunc(pl.factories * 0.8);
        tell(game, p, `Le prophète de ${pl.name} est mort ; ses disciples se déchirent sa succession. Émeutes et sabotages : 15 % de la population et un cinquième des usines perdus.`, pl);
      }
      return;
    }
    // exiled (or never answered): he preaches at a neighbour's
    const rival = p.intel.met.map(id => game.players[id]).filter(o => !o.monster && !o.dead)[0];
    if (rival) {
      const theirs = own(game, rival).sort((a, b) => b.pop - a.pop)[0];
      if (theirs) { theirs.culture = (theirs.culture ?? 0) + 60; tell(game, p, `Le prophète que vous aviez exilé prêche désormais chez les ${rival.name} : sur ${theirs.name}, les foules l'acclament.`, theirs); return; }
    }
    tell(game, p, 'Le prophète exilé s\'est perdu entre les étoiles.');
  }
}

function signalEnd(game: GameState, ch: StoryChain, p: Player, pl: Planet, rng: Rng) {
  ch.done = game.year;
  const roll = rng.random();
  if (roll < 0.4) {
    const d = designAtTech(p, Math.min(26, maxTech(p) + 3), 'Destroyer', 'beamWarship', 'Héraut du signal');
    if (d) {
      const nd = addDesign(game, { ...d, owner: p.id, alien: true });
      const f = newFleet(game, p, nd.id, 2, pl, 'Héraut');
      f.x = pl.x; f.y = pl.y; f.orbiting = pl.id;
      f.fuel = fleetSpec(game, f).fuelCapacity;
      tell(game, p, `Au-dessus de ${pl.name}, deux navires d'un dessin oublié dérivent, moteurs en veille : c'étaient eux qui appelaient. Leurs systèmes reconnaissent votre vaisseau et se rangent sous vos ordres.`, pl);
      addChronicle(game, 'event', `Les ${p.name} répondent au signal de ${pl.name} : deux navires d'un autre âge les rejoignent.`, [p.id], pl);
      return;
    }
  }
  if (roll < 0.75 || !guardiansOn(game) || pl.owner >= 0) {
    for (const f of ['electronics', 'energy'] as const) addResearch(game, p, f, Math.max(20, Math.round(researchCost(game, p, f) * (f === 'electronics' ? 0.6 : 0.3))));
    for (const m of MINERALS) pl.surface[m] += 300;
    tell(game, p, `Le signal de ${pl.name} venait d'une balise enfouie, vieille de plusieurs millénaires. Ses archives font progresser votre Électronique et votre Énergie ; 300 kt de chaque minerai attendent qui voudra les prendre.`, pl);
    addChronicle(game, 'event', `Les ${p.name} percent le secret du signal de ${pl.name}.`, [p.id], pl);
    return;
  }
  const g = spawnGuardian(game, pl, 'sentinel');
  tell(game, p, g ? `Le signal de ${pl.name} était un réveil : une sentinelle cristalline s'arrache des glaces et prend l'orbite. Votre vaisseau a vu ce qu'il fallait voir : fuyez.` : `Le signal de ${pl.name} s'éteint au moment où votre vaisseau arrive.`, pl);
  if (g) addChronicle(game, 'event', `En répondant au signal de ${pl.name}, les ${p.name} réveillent un gardien.`, [p.id], pl);
}

