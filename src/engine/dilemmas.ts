// 0.3.9: dilemmas. Now and then (every ten years or so, never in the first act's first decade), an empire faces a hard
// choice: refugees at the gates, a vein that would ruin a world, a renegade scientist, a cult. Two answers, each with a
// price told beforehand; five years to decide, then the second answer applies by default. The computers choose too.
import type { Dilemma, Field, GameState, Planet, Player } from './types';
import { FIELDS, MINERALS } from './types';
import { Rng, seedFromString } from './rng';
import { addResearch, researchCost } from './research';
import { FIELD_NAMES } from './tech';
import { remember, diplomacyOn } from './diplomacy';
import { people } from './words';
import { addChronicle } from './chronicle';

export const dilemmasOn = (game: GameState) => !!game.settings.dilemmas;
export const DILEMMA_YEARS = 5;

interface Ctx { game: GameState; p: Player; d: Dilemma; rng: Rng }
export interface DilemmaDef {
  kind: string;
  title: string;
  /** chooses what the dilemma is about (null: not possible now) */
  setup: (game: GameState, p: Player, rng: Rng) => Dilemma['data'] | null;
  text: (c: Ctx) => string;
  a: { label: string; hint: (c: Ctx) => string; apply: (c: Ctx) => string };
  b: { label: string; hint: (c: Ctx) => string; apply: (c: Ctx) => string };
  /** the computers' choice */
  ai: (c: Ctx) => 'a' | 'b';
}

const planetOf = (c: Ctx) => c.game.planets[c.d.data!.planet as number];
const own = (game: GameState, p: Player) => game.planets.filter(pl => pl.owner === p.id);
const colony = (game: GameState, p: Player, rng: Rng, ok: (pl: Planet) => boolean = () => true) => {
  const list = own(game, p).filter(pl => pl.id !== p.capital && !pl.homeworld && pl.pop > 5000 && ok(pl));
  return list.length ? list[rng.int(list.length)] : undefined;
};
const empireMet = (game: GameState, p: Player, rng: Rng) => {
  const list = p.intel.met.filter(id => !game.players[id].monster && !game.players[id].dead);
  return list.length ? list[rng.int(list.length)] : undefined;
};
const levelShare = (c: Ctx, field: Field, share: number) => Math.max(20, Math.round(researchCost(c.game, c.p, field) * share));
const pop = (c: Ctx, n: number) => people(c.game, n);

export const DILEMMAS: DilemmaDef[] = [
  {
    kind: 'refugees', title: 'Des réfugiés aux portes',
    setup: (g, p, rng) => { const pl = colony(g, p, rng); return pl ? { planet: pl.id, n: Math.round((8000 + rng.int(20000)) / 100) * 100, kt: 200 + rng.int(300) } : null; },
    text: c => `Une flottille de réfugiés, fuyant une guerre lointaine, s'est mise en orbite de ${planetOf(c).name}. Ils sont ${pop(c, c.d.data!.n as number)} et ne demandent qu'un sol. Leurs vieux vaisseaux, démontés, vaudraient ${c.d.data!.kt} kt de minerais.`,
    a: { label: 'Les accueillir', hint: c => `+${pop(c, c.d.data!.n as number)} habitants sur ${planetOf(c).name}`, apply: c => { const pl = planetOf(c); if (pl.owner !== c.p.id) return 'Le monde n\'est plus à vous : les réfugiés repartent.'; pl.pop += c.d.data!.n as number; return `${pop(c, c.d.data!.n as number)} réfugiés s'installent sur ${pl.name}.`; } },
    b: { label: 'Prendre leurs vaisseaux', hint: c => `+${c.d.data!.kt} kt de chaque minerai, les réfugiés repartent à bord de navettes`, apply: c => { const pl = planetOf(c); for (const m of MINERALS) pl.surface[m] += c.d.data!.kt as number; return `Les réfugiés repartent ; leurs vaisseaux démontés laissent ${c.d.data!.kt} kt de chaque minerai sur ${pl.name}.`; } },
    ai: c => c.rng.chance(0.6) ? 'a' : 'b',
  },
  {
    kind: 'vein', title: 'Le filon maudit',
    setup: (g, p, rng) => { const pl = colony(g, p, rng, x => x.mines > 0); return pl ? { planet: pl.id, kt: 1200 + rng.int(1200) } : null; },
    text: c => `Les mineurs de ${planetOf(c).name} ont trouvé un filon fabuleux. L'exploiter d'un coup rapporterait ${c.d.data!.kt} kt de chaque minerai, mais l'effondrement qui suivrait ruinerait les gisements pour des siècles.`,
    a: { label: 'Tout extraire', hint: c => `+${c.d.data!.kt} kt de chaque minerai, concentrations de ${planetOf(c).name} divisées par deux`, apply: c => { const pl = planetOf(c); for (const m of MINERALS) { pl.surface[m] += c.d.data!.kt as number; pl.conc[m] = Math.max(1, Math.round(pl.conc[m] / 2)); } return `Le filon de ${pl.name} est vidé : ${c.d.data!.kt} kt de chaque minerai, des gisements ruinés.`; } },
    b: { label: 'Exploiter avec prudence', hint: () => 'concentrations +10 sur ce monde, rien de plus', apply: c => { const pl = planetOf(c); for (const m of MINERALS) pl.conc[m] = Math.min(100, pl.conc[m] + 10); return `Les ingénieurs de ${pl.name} exploitent le filon pas à pas : ses concentrations montent.`; } },
    ai: c => c.rng.chance(0.4) ? 'a' : 'b',
  },
  {
    kind: 'renegade', title: 'Le savant renégat',
    setup: (g, p, rng) => { const e = empireMet(g, p, rng); return e === undefined ? null : { empire: e, field: FIELDS[rng.int(6)] }; },
    text: c => `Un grand savant des ${c.game.players[c.d.data!.empire as number].name} a fui vers vos mondes avec ses travaux en ${FIELD_NAMES[c.d.data!.field as Field]}. Ses anciens maîtres réclament qu'on le leur rende.`,
    a: { label: 'Lui offrir l\'asile', hint: c => diplomacyOn(c.game) ? `un tiers d'un niveau de ${FIELD_NAMES[c.d.data!.field as Field]}, mais les ${c.game.players[c.d.data!.empire as number].name} vous en voudront` : `un tiers d'un niveau de ${FIELD_NAMES[c.d.data!.field as Field]}`, apply: c => { const f = c.d.data!.field as Field; addResearch(c.game, c.p, f, levelShare(c, f, 0.35)); if (diplomacyOn(c.game)) remember(c.game, c.d.data!.empire as number, c.p.id, 'choice', -15, 0.5); return `Le savant poursuit ses travaux chez vous : vos chercheurs progressent en ${FIELD_NAMES[f]}.`; } },
    b: { label: 'Le rendre', hint: c => diplomacyOn(c.game) ? `les ${c.game.players[c.d.data!.empire as number].name} vous en sauront gré` : 'rien ne change', apply: c => { if (diplomacyOn(c.game)) remember(c.game, c.d.data!.empire as number, c.p.id, 'choice', 15, 0.5); return `Le savant est rendu aux ${c.game.players[c.d.data!.empire as number].name}, qui apprécient.`; } },
    ai: c => c.rng.chance(0.5) ? 'a' : 'b',
  },
  {
    kind: 'strike', title: 'La grève des chantiers',
    setup: (g, p) => { const cap = p.capital !== undefined ? g.planets[p.capital] : own(g, p).sort((a, b) => b.pop - a.pop)[0]; return cap && cap.owner === p.id && cap.pop > 50000 ? { planet: cap.id, kt: 150 + Math.round(cap.pop / 5000) } : null; },
    text: c => `Les ouvriers des chantiers de ${planetOf(c).name} cessent le travail : ils réclament leur part des richesses de l'empire.`,
    a: { label: 'Payer', hint: c => `−${c.d.data!.kt} kt de chaque minerai sur ${planetOf(c).name}`, apply: c => { const pl = planetOf(c); for (const m of MINERALS) pl.surface[m] = Math.max(0, pl.surface[m] - (c.d.data!.kt as number)); return `Les ouvriers de ${pl.name} reprennent le travail, payés.`; } },
    b: { label: 'Briser la grève', hint: c => `${planetOf(c).name} perd un vingtième de sa population et un dixième de ses usines`, apply: c => { const pl = planetOf(c); pl.pop = Math.round(pl.pop * 0.95 / 100) * 100; pl.factories = Math.trunc(pl.factories * 0.9); return `La grève de ${pl.name} est brisée, au prix de vies et d'usines sabotées.`; } },
    ai: c => c.rng.chance(0.6) ? 'a' : 'b',
  },
  {
    kind: 'cult', title: 'Le culte des étoiles',
    setup: (g, p, rng) => { const pl = colony(g, p, rng, x => x.pop > 20000); return pl ? { planet: pl.id } : null; },
    text: c => `Sur ${planetOf(c).name}, un culte voué aux étoiles gagne des fidèles chaque jour. Il prêche le détachement des choses matérielles, et ses fêtes attirent des pèlerins.`,
    a: { label: 'Le tolérer', hint: c => cultureRule(c) ? `+40 points de culture sur ${planetOf(c).name}, ses usines tournent un peu moins (−10 %)` : `ses usines tournent un peu moins (−10 %)`, apply: c => { const pl = planetOf(c); pl.culture = (pl.culture ?? 0) + 40; pl.factories = Math.trunc(pl.factories * 0.9); return `Le culte prospère sur ${pl.name} : ses temples rayonnent, ses usines ralentissent.`; } },
    b: { label: 'L\'interdire', hint: c => `${planetOf(c).name} perd un dixième de sa population (exils et troubles)`, apply: c => { const pl = planetOf(c); pl.pop = Math.round(pl.pop * 0.9 / 100) * 100; return `Le culte de ${pl.name} est interdit ; ses fidèles s'exilent.`; } },
    ai: c => c.rng.chance(0.5) ? 'a' : 'b',
  },
  {
    kind: 'wreck', title: 'L\'épave à vendre',
    setup: (g, p, rng) => { const pl = colony(g, p, rng) ?? own(g, p)[0]; return pl ? { planet: pl.id, kt: 300 + rng.int(400), field: rng.chance(0.5) ? 'weapons' : 'construction' } : null; },
    text: c => `Des prospecteurs ont repéré près de ${planetOf(c).name} l'épave d'un vaisseau d'un modèle inconnu. Un marchand offre ${c.d.data!.kt} kt de minerais pour ses coordonnées.`,
    a: { label: 'L\'étudier', hint: c => `un quart d'un niveau de ${FIELD_NAMES[c.d.data!.field as Field]}`, apply: c => { const f = c.d.data!.field as Field; addResearch(c.game, c.p, f, levelShare(c, f, 0.25)); return `Vos ingénieurs démontent l'épave : progrès en ${FIELD_NAMES[f]}.`; } },
    b: { label: 'Vendre les coordonnées', hint: c => `+${c.d.data!.kt} kt de chaque minerai sur ${planetOf(c).name}`, apply: c => { const pl = planetOf(c); for (const m of MINERALS) pl.surface[m] += c.d.data!.kt as number; return `Le marchand paie : ${c.d.data!.kt} kt de chaque minerai livrés à ${pl.name}.`; } },
    ai: c => c.rng.chance(0.5) ? 'a' : 'b',
  },
  {
    kind: 'mutation', title: 'Les enfants du nouveau monde',
    setup: (g, p, rng) => { const pl = colony(g, p, rng, x => x.pop > 10000); return pl ? { planet: pl.id } : null; },
    text: c => `Sur ${planetOf(c).name}, une génération naît adaptée à son monde : plus robuste, plus féconde, mais différente. Une part de la population réclame qu'on « corrige » ces enfants.`,
    a: { label: 'Les accepter', hint: c => `${planetOf(c).name} gagne un cinquième de population, un peu de recherche en Biotechnologie`, apply: c => { const pl = planetOf(c); pl.pop = Math.round(pl.pop * 1.2 / 100) * 100; addResearch(c.game, c.p, 'biotechnology', levelShare(c, 'biotechnology', 0.1)); return `Les enfants de ${pl.name} grandissent libres : la colonie prospère.`; } },
    b: { label: 'Les « corriger »', hint: () => 'un tiers d\'un niveau de Biotechnologie (les études médicales), au prix de la confiance', apply: c => { addResearch(c.game, c.p, 'biotechnology', levelShare(c, 'biotechnology', 0.33)); const pl = planetOf(c); pl.pop = Math.round(pl.pop * 0.95 / 100) * 100; return `Les généticiens interviennent sur ${pl.name} ; la colonie ne l'oubliera pas.`; } },
    ai: c => c.rng.chance(0.7) ? 'a' : 'b',
  },
  {
    kind: 'triumph', title: 'Le triomphe',
    setup: (g, p, rng) => { if (!g.settings.veterans) return null; const fl = g.fleets.filter(f => f.owner === p.id && (f.xp ?? 0) >= 15 && f.tokens.length); return fl.length ? { fleet: fl[rng.int(fl.length)].id, kt: 150 + rng.int(150) } : null; },
    text: c => { const f = c.game.fleets.find(x => x.id === c.d.data!.fleet); return `L'amiral de ${f?.name ?? 'votre flotte la plus aguerrie'} réclame un triomphe pour ses équipages : défilés, médailles, et une coque neuve pour le vaisseau amiral.`; },
    a: { label: 'Accorder le triomphe', hint: c => `+25 points d'expérience à la flotte, −${c.d.data!.kt} kt de chaque minerai sur votre capitale`, apply: c => { const f = c.game.fleets.find(x => x.id === c.d.data!.fleet); const cap = c.p.capital !== undefined ? c.game.planets[c.p.capital] : undefined; if (cap) for (const m of MINERALS) cap.surface[m] = Math.max(0, cap.surface[m] - (c.d.data!.kt as number)); if (!f) return 'La flotte n\'est plus : le triomphe devient un hommage.'; f.xp = (f.xp ?? 0) + 25; return `Le triomphe de ${f.name} galvanise ses équipages.`; } },
    b: { label: 'Refuser', hint: () => 'la flotte perd 10 points d\'expérience (l\'amertume)', apply: c => { const f = c.game.fleets.find(x => x.id === c.d.data!.fleet); if (f) f.xp = Math.max(0, (f.xp ?? 0) - 10); return f ? `L'amiral de ${f.name} rentre dans le rang, amer.` : 'La flotte n\'est plus.'; } },
    ai: c => c.rng.chance(0.5) ? 'a' : 'b',
  },
];
export const DILEMMA = Object.fromEntries(DILEMMAS.map(d => [d.kind, d])) as Record<string, DilemmaDef>;
// the cult's culture only matters with the culture rule
function cultureRule(c: Ctx) { return !!c.game.settings.culture; }

const rngOf = (game: GameState, p: Player, tag: string) => new Rng(seedFromString(`${game.settings.seed}|dilemma|${tag}|${p.id}|${game.year}`));

/** Yearly: new dilemmas now and then; the computers answer at once; the forgotten ones apply their second answer. */
export function runDilemmas(game: GameState) {
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    // the choices of the stories (chains.ts) expire too, rule or not
    for (const d of [...(p.dilemmas ?? [])]) if (d.expires <= game.year) settle(game, p, d.id, 'b', true);
    if (!dilemmasOn(game)) continue;
    const list = p.dilemmas ?? (p.dilemmas = []);
    if (game.year < 2412 || list.length) continue;
    const rng = rngOf(game, p, 'new');
    const last = p.lastDilemma ?? 2400;
    if (game.year - last < 7 || !rng.chance(0.18)) continue;
    const pool = rng.shuffle([...DILEMMAS]).filter(x => !(p.dilemmaSeen ?? []).includes(x.kind) || (p.dilemmaSeen ?? []).length >= DILEMMAS.length - 1);
    for (const def of pool) {
      const data = def.setup(game, p, rng);
      if (!data) continue;
      const d: Dilemma = { id: game.nextId++, kind: def.kind, year: game.year, expires: game.year + DILEMMA_YEARS, data };
      p.lastDilemma = game.year;
      p.dilemmaSeen = [...(p.dilemmaSeen ?? []).filter(k => k !== def.kind), def.kind].slice(-(DILEMMAS.length - 1));
      if (p.ai) { settle(game, p, d.id, def.ai({ game, p, d, rng }), false, d); break; }
      list.push(d);
      p.messages.unshift({ year: game.year, kind: 'warning', text: `Dilemme : ${def.title}. ${def.text({ game, p, d, rng })} Vous avez jusqu'en ${d.expires} pour trancher (« À traiter »).`, target: { kind: 'colonies', id: 0 } });
      break;
    }
  }
}

/** The answer (a or b): applied at once. Returns the text told, or null if the dilemma is not there. */
export function settle(game: GameState, p: Player, id: number, choice: 'a' | 'b', expired = false, given?: Dilemma): string | null {
  const list = p.dilemmas ?? [];
  const d = given ?? list.find(x => x.id === id);
  if (!d) return null;
  const def = DILEMMA[d.kind];
  if (!given) p.dilemmas = list.filter(x => x.id !== id);
  if (!def) return null;
  const rng = rngOf(game, p, 'settle' + d.id);
  const text = def[choice].apply({ game, p, d, rng });
  if (!p.ai) {
    p.messages.push({ year: game.year, kind: 'event', text: expired ? `${def.title} : faute de décision, « ${def[choice].label} » l'emporte. ${text}` : `${def.title} : ${text}`, target: { kind: 'colonies', id: 0 } });
    addChronicle(game, 'event', `${def.title} : les ${p.name} choisissent « ${def[choice].label} ».`, [p.id]);
  }
  return text;
}

export function dilemmaView(game: GameState, p: Player, d: Dilemma) {
  const def = DILEMMA[d.kind];
  if (!def) return null;
  const c: Ctx = { game, p, d, rng: rngOf(game, p, 'view' + d.id) };
  return { title: def.title, text: def.text(c), a: { label: def.a.label, hint: def.a.hint(c) }, b: { label: def.b.label, hint: def.b.hint(c) } };
}

