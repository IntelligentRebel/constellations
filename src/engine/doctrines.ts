// Research doctrines (Constellations 3): at a given level in a field, each empire must choose one of two
// doctrines. The choice is final and the other branch is closed for good, so two empires with the same
// technology levels no longer play the same way.
import type { Field, GameState, Player } from './types';

export type DoctrineId =
  | 'shields' | 'overcharge'
  | 'endurance' | 'speed'
  | 'armor' | 'modular'
  | 'sensors' | 'ewar'
  | 'natality' | 'arcology'
  | 'assault' | 'siege';

export interface DoctrineOption { id: DoctrineId; name: string; effect: string; detail: string }
export interface DoctrineFork { id: string; field: Field; level: number; title: string; a: DoctrineOption; b: DoctrineOption }

export const DOCTRINE_FORKS: DoctrineFork[] = [
  {
    id: 'energy', field: 'energy', level: 5, title: 'Usage de l\'énergie',
    a: { id: 'shields', name: 'Boucliers adaptatifs', effect: 'Boucliers +20 %', detail: 'Les boucliers de tous vos vaisseaux et stations sont 20 % plus solides.' },
    b: { id: 'overcharge', name: 'Armes surchargées', effect: 'Rayons +15 % de dégâts', detail: 'Toutes vos armes à rayon infligent 15 % de dégâts en plus.' },
  },
  {
    id: 'propulsion', field: 'propulsion', level: 5, title: 'Doctrine de vol',
    a: { id: 'endurance', name: 'Endurance', effect: 'Carburant −20 %, réservoirs +25 %', detail: 'Vos moteurs consomment 20 % de carburant en moins et vos réservoirs contiennent 25 % de plus : flottes plus autonomes.' },
    b: { id: 'speed', name: 'Vitesse tactique', effect: '+1 de vitesse en combat', detail: 'Tous vos vaisseaux armés gagnent 1 point de vitesse de combat : une case de plus un round sur quatre (4 points font une case par round), de quoi choisir plus souvent la distance.' },
  },
  {
    id: 'construction', field: 'construction', level: 6, title: 'Philosophie de construction',
    a: { id: 'armor', name: 'Blindage lourd', effect: 'Blindage +20 %', detail: 'Le blindage de tous vos vaisseaux et stations est 20 % plus épais.' },
    b: { id: 'modular', name: 'Production modulaire', effect: 'Vaisseaux −12 % de ressources', detail: 'Vaisseaux et stations coûtent 12 % de ressources en moins.' },
  },
  {
    id: 'electronics', field: 'electronics', level: 6, title: 'Guerre de l\'information',
    a: { id: 'sensors', name: 'Réseau de capteurs', effect: 'Scanners +25 %', detail: 'La portée de tous vos scanners (vaisseaux et planètes) augmente de 25 %.' },
    b: { id: 'ewar', name: 'Guerre électronique', effect: 'Camouflage +10, brouillage +10 %', detail: 'Tous vos vaisseaux gagnent 10 points de camouflage et 10 % de brouillage contre les torpilles.' },
  },
  {
    id: 'biotech', field: 'biotechnology', level: 5, title: 'Politique démographique',
    a: { id: 'natality', name: 'Natalité', effect: 'Croissance +15 %', detail: 'La population de toutes vos planètes croît 15 % plus vite.' },
    b: { id: 'arcology', name: 'Arcologies', effect: 'Population maximale +10 %', detail: 'Chaque planète peut accueillir 10 % d\'habitants en plus.' },
  },
  {
    id: 'weapons', field: 'weapons', level: 8, title: 'Art de la conquête',
    a: { id: 'assault', name: 'Assaut', effect: 'Invasions +30 %', detail: 'Vos troupes combattent 30 % mieux lors des invasions.' },
    b: { id: 'siege', name: 'Siège', effect: 'Bombardements +30 %', detail: 'Vos bombes tuent 30 % de population en plus.' },
  },
];

export const doctrinesOn = (game: GameState) => !!game.settings.doctrines;

/** Does this player follow a doctrine? (Works on any object carrying `doctrines`, e.g. design specs.) */
export function hasDoctrine(player: { doctrines?: Record<string, 'a' | 'b'> } | null | undefined, id: DoctrineId): boolean {
  const d = player?.doctrines;
  if (!d) return false;
  for (const f of DOCTRINE_FORKS) {
    const pick = d[f.id];
    if (pick && f[pick].id === id) return true;
  }
  return false;
}

export function doctrineOption(id: DoctrineId): DoctrineOption | undefined {
  for (const f of DOCTRINE_FORKS) { if (f.a.id === id) return f.a; if (f.b.id === id) return f.b; }
  return undefined;
}

/** Forks reached by the player but not decided yet. */
export function pendingForks(game: GameState, player: Player): DoctrineFork[] {
  if (!doctrinesOn(game)) return [];
  return DOCTRINE_FORKS.filter(f => player.tech[f.field] >= f.level && !player.doctrines?.[f.id]);
}

export function chooseDoctrine(game: GameState, player: Player, forkId: string, pick: 'a' | 'b'): boolean {
  const f = DOCTRINE_FORKS.find(x => x.id === forkId);
  if (!f || !doctrinesOn(game) || player.tech[f.field] < f.level || player.doctrines?.[forkId]) return false;
  player.doctrines = { ...(player.doctrines ?? {}), [forkId]: pick };
  return true;
}

/** Messages for forks reached this year (humans choose in the research screen; AIs choose at once). */
export function doctrineNews(game: GameState, player: Player, before: Set<string>) {
  if (!doctrinesOn(game)) return;
  for (const f of pendingForks(game, player)) {
    if (player.ai) { chooseDoctrine(game, player, f.id, aiDoctrine(player, f)); continue; }
    if (before.has(f.id)) continue;
    player.messages.push({ year: game.year, kind: 'research', text: `Doctrine à choisir (${f.title}) : ${f.a.name} (${f.a.effect}) ou ${f.b.name} (${f.b.effect}). Le choix est définitif.`, target: { kind: 'doctrine', id: 0 } });
  }
}

/** AI preference: follows its personality (race traits) with a stable per-player coin for the rest. */
export function aiDoctrine(player: Player, f: DoctrineFork): 'a' | 'b' {
  const prt = player.race.prt;
  // 0.3.9.9: no longer the race's name, whose length changed with the language (the same game diverged in English and in French)
  const coin = ((player.id * 7 + f.id.length * 3 + player.race.prt.charCodeAt(0)) % 2) === 0 ? 'a' : 'b';
  switch (f.id) {
    case 'energy': return prt === 'WM' || prt === 'SD' ? 'b' : coin;
    case 'propulsion': return prt === 'WM' ? 'b' : prt === 'IS' || prt === 'HE' ? 'a' : coin;
    case 'construction': return prt === 'AR' || prt === 'CA' ? 'b' : coin;
    case 'electronics': return prt === 'SS' ? 'b' : coin;
    case 'biotech': return prt === 'HE' || prt === 'IS' ? 'a' : coin;
    case 'weapons': return prt === 'IS' || prt === 'WM' ? 'a' : prt === 'SD' ? 'b' : coin;
  }
  return coin;
}

/** Forks already pending at the start of the year (to report only the new ones). */
export function pendingIds(game: GameState, player: Player): Set<string> {
  return new Set(pendingForks(game, player).map(f => f.id));
}
