// 0.3.9: the chronicle of the game. Notable events (contacts, wars, conquests of capitals, wonders, the crisis, the
// fall of empires...) and, every few years, who held each world: at the end, the territory can be replayed and the
// story told. During the game, an empire reads only what concerns it or the empires it met.
import type { ChronicleEvent, ChronicleKind, GameState, Player } from './types';

/** Years between two pictures of the territory. */
export const FRAME_EVERY = 3;
const MAX_EVENTS = 600;

function chron(game: GameState) {
  return game.chronicle ?? (game.chronicle = { events: [], frames: [] });
}

export function addChronicle(game: GameState, kind: ChronicleKind, text: string, who: number[], at?: { x: number; y: number }) {
  const c = chron(game);
  c.events.push({ year: game.year, kind, text, who: [...new Set(who)], ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : {}) });
  if (c.events.length > MAX_EVENTS) {
    // keep the big events, drop the oldest small ones
    const small = c.events.findIndex(e => e.kind === 'contact' || e.kind === 'worlds' || e.kind === 'veteran');
    c.events.splice(small >= 0 ? small : 0, 1);
  }
}

/** One character per planet: its owner + 1 ('0' for nobody). */
export function ownersString(game: GameState): string {
  let s = '';
  for (const p of game.planets) s += String.fromCharCode(48 + Math.max(0, Math.min(70, p.owner + 1)));
  return s;
}
export const ownerAt = (owners: string, i: number) => owners.charCodeAt(i) - 49;

/** A picture of the territory (at the start, then every few years, and at the end of a game). */
export function recordFrame(game: GameState, force = false) {
  const c = chron(game);
  const last = c.frames[c.frames.length - 1];
  if (last && last.year === game.year) { last.owners = ownersString(game); return; }
  if (!force && last && game.year - last.year < FRAME_EVERY) return;
  c.frames.push({ year: game.year, owners: ownersString(game) });
}

/** At the first year: the opening line and the first picture. */
export function startChronicle(game: GameState) {
  const c = chron(game);
  if (c.frames.length) return;
  const empires = game.players.filter(p => !p.monster);
  c.events.push({ year: game.year, kind: 'start', text: `${game.year} : ${empires.length} empires s'éveillent aux étoiles.`, who: [] });
  c.frames.push({ year: game.year, owners: ownersString(game) });
}

/** What a player may read now (everything once the game is won or the empire gone). */
export function chronicleFor(game: GameState, p: Player, all = false): ChronicleEvent[] {
  const ev = game.chronicle?.events ?? [];
  if (all || game.victor !== null || p.dead) return ev;
  return ev.filter(e => !e.who.length || e.who.includes(p.id) || e.who.some(w => p.intel.met.includes(w)));
}

/** Milestones of the size of an empire. */
const MILESTONES = [10, 25, 50, 100, 200];
export function worldMilestones(game: GameState) {
  for (const p of game.players) {
    if (p.monster || p.dead) continue;
    const n = game.planets.filter(x => x.owner === p.id).length;
    const reached = MILESTONES.filter(m => n >= m).pop();
    if (reached === undefined || (p.milestone ?? 0) >= reached) continue;
    p.milestone = reached;
    const first = !game.players.some(o => o !== p && (o.milestone ?? 0) >= reached);
    addChronicle(game, 'worlds', first ? `Les ${p.name} sont les premiers à tenir ${reached} mondes.` : `Les ${p.name} tiennent ${reached} mondes.`, [p.id]);
  }
}

/** Worlds held by an empire in each picture of the territory. */
export function worldsOver(game: GameState, id: number): { year: number; n: number }[] {
  const ch = String.fromCharCode(49 + id);
  return (game.chronicle?.frames ?? []).map(f => { let n = 0; for (let i = 0; i < f.owners.length; i++) if (f.owners[i] === ch) n++; return { year: f.year, n }; });
}

const FIELDS6 = ['energy', 'weapons', 'propulsion', 'construction', 'electronics', 'biotechnology'] as const;
const techSum = (p: Player) => FIELDS6.reduce((a, f) => a + p.tech[f], 0);

/** The epilogue of an empire: a few sentences on its story, from the chronicle and its records. */
export function epilogue(game: GameState, p: Player): string[] {
  const out: string[] = [];
  const ev = game.chronicle?.events ?? [];
  const mine = (k: ChronicleEvent['kind']) => ev.filter(e => e.kind === k && e.who.includes(p.id));
  const curve = worldsOver(game, p.id);
  const peak = curve.reduce((a, c) => c.n > a.n ? c : a, { year: game.year, n: 0 });
  const now = game.planets.filter(x => x.owner === p.id).length;
  if (game.victor === p.id) {
    out.push(game.victoryKind === 'megaproject' ? `Les ${p.name} achèvent le Portail de l'Ascension et remportent la partie.` : game.victoryKind === 'crisis' ? `Les ${p.name} abattent le Nexus et remportent la partie : la galaxie leur doit sa survie.` : game.victoryKind === 'lastStanding' ? `Les ${p.name} restent seuls debout et remportent la partie.` : game.victoryKind === 'seal' ? `Les ${p.name} scellent la Brèche avec le Sceau des Anciens et remportent la partie.` : game.victoryKind === 'origin' ? `Les ${p.name} accomplissent le destin de leur origine et remportent la partie.` : `Les ${p.name} remportent la partie en remplissant les conditions de victoire.`);
  }
  if (p.dead) {
    const d = mine('death')[0];
    const killer = game.players.find(o => o.id !== p.id && (o.stats.homeworldsTaken ?? []).includes(p.id));
    const year = d?.year ?? game.year;
    out.push(killer ? `Leur empire s'éteint en ${year} ; leur monde natal était tombé aux mains des ${killer.name}.` : `Leur empire s'éteint en ${year}.`);
  }
  if (peak.n > 0) out.push(peak.n > now && !p.dead ? `À leur apogée, en ${peak.year}, ils tenaient ${peak.n} mondes ; il leur en reste ${now}.` : p.dead ? `À leur apogée, en ${peak.year}, ils tenaient ${peak.n} mondes.` : `Ils tiennent ${now} mondes, leur plus grande étendue.`);
  const wars = ev.filter(e => e.kind === 'war' && e.who[0] === p.id).length, suffered = ev.filter(e => e.kind === 'war' && e.who[1] === p.id).length;
  const conquests = p.stats.planetsCaptured ?? 0;
  if (wars + suffered === 0) out.push('Ils n\'ont connu aucune guerre déclarée.');
  else if (wars === 0) out.push(suffered > 1 ? `Ils n'ont déclaré aucune guerre, mais en ont subi ${suffered}.` : 'Ils n\'ont déclaré aucune guerre, mais en ont subi une.');
  else out.push(`Ils ont déclaré ${wars} guerre${wars > 1 ? 's' : ''} et en ont subi ${suffered}.`);
  if (p.stats.shipsDestroyed + p.stats.shipsLost > 0) out.push(`Ils ont détruit ${p.stats.shipsDestroyed} vaisseaux ennemis et perdu ${p.stats.shipsLost} des leurs.`);
  if (conquests) out.push(conquests > 1 ? `Ils ont pris ${conquests} mondes à l'ennemi.` : 'Ils ont pris un monde à l\'ennemi.');
  const megas = mine('mega');
  if (megas.length) out.push(megas.length > 1 ? `Ils ont achevé ${megas.length} mégaprojets.` : 'Ils ont achevé un mégaprojet.');
  const nem = game.nemeses?.find(n => n.ai === p.id || n.of === p.id);
  if (nem) {
    const other = game.players[nem.ai === p.id ? nem.of : nem.ai].name;
    if (nem.ai === p.id) out.push(nem.broken !== undefined ? `Ils avaient juré la perte des ${other}, jusqu'à être brisés en ${nem.broken}.` : `Ils avaient juré la perte des ${other}.`);
    else out.push(nem.broken !== undefined ? `Les ${other} avaient juré leur perte ; ils les ont brisés en ${nem.broken}.` : `Les ${other} avaient juré leur perte.`);
  }
  const legends = mine('veteran');
  if (legends.length) out.push(legends.length > 1 ? `${legends.length} de leurs flottes sont entrées dans la légende.` : 'Une de leurs flottes est entrée dans la légende.');
  return out;
}

export interface Award { title: string; text: string; who: number; value: string }

/** The distinctions of the end of a game (one empire each). */
export function awards(game: GameState): Award[] {
  const emp = game.players.filter(p => !p.monster);
  const out: Award[] = [];
  const best = (title: string, text: string, val: (p: Player) => number, fmtv: (v: number) => string, min = 1) => {
    let b: Player | undefined, bv = min - 1e-9;
    for (const p of emp) { const v = val(p); if (v > bv) { bv = v; b = p; } }
    if (b) out.push({ title, text, who: b.id, value: fmtv(bv) });
  };
  best('Le plus grand empire', 'Le plus de mondes tenus à la fois.', p => Math.max(0, ...worldsOver(game, p.id).map(c => c.n), game.planets.filter(x => x.owner === p.id).length), v => `${v} mondes à la fois`);
  best('Conquérants', 'Le plus de mondes pris à l\'ennemi.', p => p.stats.planetsCaptured ?? 0, v => `${v} mondes conquis`);
  best('Fléau des étoiles', 'Le plus de vaisseaux ennemis détruits.', p => p.stats.shipsDestroyed, v => `${v} vaisseaux`);
  best('Chantiers infatigables', 'Le plus de vaisseaux construits.', p => p.stats.shipsBuilt, v => `${v} vaisseaux`);
  best('Pionniers', 'Le plus de mondes colonisés.', p => p.stats.planetsColonized, v => `${v} colonies`);
  best('Savants', 'Le plus haut niveau technologique.', p => techSum(p), v => `${v} niveaux`);
  best('Bâtisseurs de merveilles', 'Le plus de mégaprojets achevés.', p => (game.chronicle?.events ?? []).filter(e => e.kind === 'mega' && e.who.includes(p.id)).length, v => `${v} mégaprojet${v > 1 ? 's' : ''}`);
  best('Les plus tenaces', 'Le plus de mondes perdus, et toujours debout.', p => p.dead ? 0 : p.stats.planetsLost ?? 0, v => `${v} mondes perdus`);
  const peaceful = emp.filter(p => !p.dead && !(game.chronicle?.events ?? []).some(e => e.kind === 'war' && e.who[0] === p.id));
  if (peaceful.length === 1) out.push({ title: 'Colombe', text: 'Le seul empire survivant à n\'avoir jamais déclaré de guerre.', who: peaceful[0].id, value: '' });
  return out;
}
