// 0.3.9: achievements. Kept by this browser across games (like the preferences): each one is unlocked once, with the
// game and the year. Some unlock an emblem for races (wizard) or, later, an origin.
import type { GameState, Player } from '../engine/types';
import { rankOf, RANKS } from '../engine/veterans';
import { MINERALS } from '../engine/types';

export interface Achievement {
  id: string;
  name: string;
  text: string;
  /** what it unlocks, told on its card */
  unlocks?: { icon?: number; origin?: string };
  test: (g: GameState, me: Player) => boolean;
  /** only told once unlocked (the surprise is part of it) */
  secret?: boolean;
}

const own = (g: GameState, me: Player) => g.planets.filter(p => p.owner === me.id);
const won = (g: GameState, me: Player, kind?: GameState['victoryKind']) => g.victor === me.id && (!kind || g.victoryKind === kind);

/** Emblems after the sixteen of the start (indexes 16 and more of RACE_ICONS) are each unlocked by an achievement. */
export const BASE_ICONS = 16;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'colony', name: 'Hors du berceau', text: 'Fonder une première colonie.', test: (g, me) => own(g, me).length >= 2 },
  { id: 'worlds10', name: 'Dix mondes', text: 'Tenir dix mondes à la fois.', test: (g, me) => own(g, me).length >= 10 },
  { id: 'worlds50', name: 'Cinquante mondes', text: 'Tenir cinquante mondes à la fois.', unlocks: { icon: 16 + 5 }, test: (g, me) => own(g, me).length >= 50 },
  { id: 'contact5', name: 'Carrefour des peuples', text: 'Rencontrer cinq autres empires.', test: (g, me) => me.intel.met.filter(id => !g.players[id]?.monster).length >= 5 },
  { id: 'alliance', name: 'Frères d\'armes', text: 'Signer une alliance.', test: (g, me) => Object.entries(g.diplomacy?.pairs ?? {}).some(([k, pr]) => pr.status === 'alliance' && k.split('-').map(Number).includes(me.id)) },
  { id: 'firstBlood', name: 'Baptême du feu', text: 'Détruire un premier vaisseau ennemi.', test: (g, me) => me.stats.shipsDestroyed >= 1 },
  { id: 'kills100', name: 'Cent épaves', text: 'Détruire cent vaisseaux ennemis.', unlocks: { icon: 16 + 3 }, test: (g, me) => me.stats.shipsDestroyed >= 100 },
  { id: 'legend', name: 'Entrée dans la légende', text: 'Mener une flotte au rang « Légende ».', unlocks: { icon: 16 + 6 }, test: (g, me) => g.fleets.some(f => f.owner === me.id && rankOf(f) === RANKS.length - 1) },
  { id: 'guardian', name: 'Tueur de gardiens', text: 'Abattre un gardien.', test: (g, me) => !!g.guardians?.some(x => x.killedBy === me.id) },
  { id: 'secret', name: 'Ce que cachent les étoiles', text: 'Trouver une étoile cachée.', secret: true, test: (g, me) => !!g.secrets?.some(s => s.known.includes(me.id)) },
  { id: 'mega', name: 'Merveille', text: 'Achever un mégaprojet.', unlocks: { icon: 16 + 4 }, test: (g, me) => own(g, me).some(p => (p.megaprojects?.length ?? 0) > 0) },
  { id: 'rich', name: 'Trésor de guerre', text: 'Accumuler 20 000 kt de minerais sur un seul monde.', test: (g, me) => own(g, me).some(p => MINERALS.reduce((a, m) => a + p.surface[m], 0) >= 20000) },
  { id: 'nemesis', name: 'La haine éteinte', text: 'Briser votre némésis.', unlocks: { icon: 16 + 2 }, test: (g, me) => !!g.nemeses?.some(n => n.of === me.id && n.broken !== undefined) },
  { id: 'act3', name: 'L\'Apothéose', text: 'Voir s\'ouvrir le troisième acte.', test: (g, me) => !!g.settings.acts && (g.act?.n ?? 1) >= 3 && !me.dead },
  { id: 'relays', name: 'Trois relais', text: 'Tenir trois relais de l\'Ascension.', test: (g, me) => g.planets.filter(p => p.owner === me.id && p.megaprojects?.includes('relay')).length >= 3 },
  { id: 'golden', name: 'Le siècle d\'or', text: 'Vivre un âge d\'or.', test: (g, me) => (me.golden?.count ?? 0) > 0 },
  { id: 'secretFound', name: 'Ce que savaient les Anciens', text: 'Percer le secret de la Brèche.', unlocks: { origin: 'heirs' }, test: (g, me) => me.secretKnown !== undefined },
  { id: 'refound', name: 'Renaître de ses cendres', text: 'Refonder votre empire après avoir perdu tous vos mondes.', unlocks: { origin: 'exiles' }, secret: true, test: (g, me) => (me.stats.refounded ?? 0) > 0 },
  { id: 'supernova', name: 'Sous le souffle', text: 'Garder un monde dans les retombées d\'une supernova.', secret: true, test: (g, me) => (g.cataclysms ?? []).some(c => c.kind === 'supernova' && c.done !== undefined && g.planets.some(p => p.owner === me.id && Math.hypot(p.x - c.x, p.y - c.y) <= 70 && (p.colonizedYear ?? 2400) <= (c.at ?? 0))) },
  { id: 'century', name: 'Un siècle d\'histoire', text: 'Atteindre l\'an 2500 avec votre empire.', test: (g, me) => g.year >= 2500 && !me.dead },
  { id: 'win', name: 'Victoire', text: 'Gagner une partie.', unlocks: { icon: 16 + 0 }, test: (g, me) => won(g, me) },
  { id: 'winConditions', name: 'Selon les règles', text: 'Gagner en remplissant les conditions de victoire.', test: (g, me) => won(g, me, 'conditions') },
  { id: 'winPortal', name: 'Ascension', text: 'Gagner en achevant le Portail de l\'Ascension.', unlocks: { icon: 16 + 1 }, test: (g, me) => won(g, me, 'megaproject') },
  { id: 'winNexus', name: 'Sauveurs de la galaxie', text: 'Gagner en abattant le Nexus.', unlocks: { icon: 16 + 7 }, test: (g, me) => won(g, me, 'crisis') },
  { id: 'winSeal', name: 'Le Sceau', text: 'Gagner en scellant la Brèche.', test: (g, me) => won(g, me, 'seal') || (won(g, me, 'origin') && !!g.crisis?.sealed && g.crisis.endedBy === me.id) },
  { id: 'winOrigin', name: 'Le destin accompli', text: 'Gagner par la victoire de votre origine.', test: (g, me) => won(g, me, 'origin') },
  { id: 'winLast', name: 'Derniers debout', text: 'Gagner en dernier empire en vie.', test: (g, me) => won(g, me, 'lastStanding') },
];

export interface Unlocked { year: number; game: string; date: string }
const KEY = 'constellations.achievements';
let store: Record<string, Unlocked> = {};
try { store = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* ignore */ } };

export const unlocked = (id: string): Unlocked | undefined => store[id];
export const unlockedCount = () => ACHIEVEMENTS.filter(a => store[a.id]).length;

/** Is this emblem free to use (the sixteen of the start always are)? */
export function iconUnlocked(i: number): boolean {
  if (i < BASE_ICONS) return true;
  return ACHIEVEMENTS.some(a => a.unlocks?.icon === i && store[a.id]);
}
export const iconAchievement = (i: number) => ACHIEVEMENTS.find(a => a.unlocks?.icon === i);
export const originUnlocked = (id: string) => !ACHIEVEMENTS.some(a => a.unlocks?.origin === id) || ACHIEVEMENTS.some(a => a.unlocks?.origin === id && store[a.id]);
export const originAchievement = (id: string) => ACHIEVEMENTS.find(a => a.unlocks?.origin === id);

/** After a year (or a game loaded): the achievements this player just earned. Never in the tutorial. */
export function checkAchievements(g: GameState, me: Player): Achievement[] {
  if (g.tutorial || me.ai) return [];
  const fresh: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (store[a.id]) continue;
    let ok = false;
    try { ok = a.test(g, me); } catch { ok = false; }
    if (!ok) continue;
    store[a.id] = { year: g.year, game: g.name, date: new Date().toISOString().slice(0, 10) };
    fresh.push(a);
  }
  if (fresh.length) save();
  return fresh;
}

/** For the tests: forget everything. */
export function resetAchievements() { store = {}; save(); }
