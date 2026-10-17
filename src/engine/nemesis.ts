// 0.3.9: the nemesis. A computer empire remembers what a human empire did to it: the ships destroyed, the worlds
// taken, the wars declared on it. Past a threshold it swears the destruction of that empire: it declares war as soon
// as it can, aims at its weakest worlds, builds for war and refuses any peace until it is broken (it lost most of the
// worlds it held, or its capital). One nemesis at a time per human empire; another may rise later.
import type { GameState, Nemesis, Player } from './types';
import { addChronicle } from './chronicle';
import { seenProtection } from './aiknow';

export const nemesisOn = (game: GameState) => !!game.settings.nemesis;
/** Grudge at which a computer swears your destruction. */
export const NEMESIS_AT = 45;

const emp = (game: GameState, id: number) => !!game.players[id] && !game.players[id].monster;

/** The active nemesis (not broken) of a human empire. */
export function nemesisOf(game: GameState, human: number): Nemesis | undefined {
  return game.nemeses?.find(n => n.of === human && n.broken === undefined && !game.players[n.ai].dead);
}
/** Is `ai` the active nemesis of `human`? */
export const isNemesis = (game: GameState, ai: number, human: number) => nemesisOn(game) && nemesisOf(game, human)?.ai === ai;
/** The humans this computer has sworn to destroy. */
export const swornAgainst = (game: GameState, ai: number): number[] => nemesisOn(game) ? (game.nemeses ?? []).filter(n => n.ai === ai && n.broken === undefined && !game.players[n.of].dead).map(n => n.of) : [];

export function addGrudge(game: GameState, ai: number, against: number, v: number) {
  if (!nemesisOn(game) || !emp(game, ai) || !emp(game, against) || ai === against) return;
  const p = game.players[ai];
  if (!p.ai || p.dead) return;
  const g = p.grudges ?? (p.grudges = {});
  g[against] = Math.min(200, (g[against] ?? 0) + v);
}

/** Ships destroyed in a battle: a computer's grudge against the humans who destroyed them (15 at most per battle). */
export function battleGrudges(game: GameState, killsBy: Record<number, Record<number, number>>) {
  if (!nemesisOn(game)) return;
  for (const [a, row] of Object.entries(killsBy)) {
    const attacker = game.players[+a];
    if (!attacker || attacker.ai || attacker.monster) continue;
    for (const [v, k] of Object.entries(row)) addGrudge(game, +v, +a, Math.min(15, k));
  }
}

/** A world taken (conquest, or a culture that absorbed it). */
export function worldGrudge(game: GameState, loser: number, winner: number, how: 'conquest' | 'assimilation') {
  addGrudge(game, loser, winner, how === 'conquest' ? 22 : 10);
}

/** A war declared by a human on a computer. */
export const warGrudge = (game: GameState, by: number, on: number) => { if (!game.players[by]?.ai) addGrudge(game, on, by, 12); };

const own = (game: GameState, id: number) => game.planets.filter(p => p.owner === id).length;

/**
 * A nemesis studies the warships of its sworn enemy: against heavy shields it arms its own with torpedoes (half of
 * their damage goes past the shields), against armour with beams. Told once when it changes its mind.
 */
export function counterPurpose(game: GameState, p: Player): 'beamWarship' | 'torpedoWarship' | undefined {
  if (!nemesisOn(game)) return undefined;
  const n = game.nemeses?.find(x => x.ai === p.id && x.broken === undefined && !game.players[x.of].dead);
  if (!n) return undefined;
  // 0.3.9.15: the warships of the sworn enemy it has in sight and whose designs it knows (met in battle), not all of them
  const { shields: sh, armor: ar } = seenProtection(game, p, n.of);
  if (sh + ar <= 0) return n.counter;
  const want = sh / (sh + ar) > 0.35 ? 'torpedoWarship' : 'beamWarship';
  if (n.counter !== want) {
    if (n.counter !== undefined || want === 'torpedoWarship') game.players[n.of].messages.push({ year: game.year, kind: 'diplomacy', text: want === 'torpedoWarship' ? `Vos agents rapportent que les ${p.name} arment leurs nouveaux navires de torpilles, pour percer vos boucliers.` : `Vos agents rapportent que les ${p.name} reviennent aux rayons, contre le blindage de vos navires.`, target: { kind: 'player', id: p.id } });
    n.counter = want;
  }
  return want;
}

/** What the nemesis says (one line, now and then). */
const SWORN = [
  'Nous n\'oublierons pas. Tant qu\'un seul de vos mondes brillera, nous ne connaîtrons pas la paix.',
  'Vos victoires sont des dettes. Nous venons les encaisser.',
  'Chaque vaisseau que vous nous avez pris porte un nom. Nous les récitons à nos enfants.',
  'Comptez vos mondes ce soir. Demain, il y en aura un de moins.',
  'Nous avons appris de nos défaites. Vous, avez-vous appris de vos victoires ?',
  'La galaxie est vaste, mais pas assez pour vous cacher.',
];

/** Yearly: grudges fade, a nemesis rises, speaks, or breaks. */
export function runNemesis(game: GameState) {
  if (!nemesisOn(game)) return;
  const list = game.nemeses ?? (game.nemeses = []);
  for (const p of game.players) if (p.grudges) for (const k of Object.keys(p.grudges)) { p.grudges[+k] *= 0.96; if (p.grudges[+k] < 0.5) delete p.grudges[+k]; }
  for (const h of game.players) {
    if (h.ai || h.monster || h.dead) continue;
    const cur = nemesisOf(game, h.id);
    if (cur) {
      const ai = game.players[cur.ai];
      const n = own(game, ai.id);
      cur.peak = Math.max(cur.peak, n);
      const capitalLost = ai.capital !== undefined && game.planets[ai.capital]?.owner !== ai.id;
      if (cur.peak >= 3 && (n <= Math.floor(cur.peak * 0.4) || (capitalLost && n < cur.peak))) {
        cur.broken = game.year;
        if (ai.grudges) ai.grudges[h.id] = 0;
        h.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${ai.name} sont brisés. Leur haine s'éteint avec leur puissance : ils accepteront désormais de négocier la paix.`, target: { kind: 'player', id: ai.id } });
        addChronicle(game, 'nemesis', `Les ${ai.name}, qui avaient juré la perte des ${h.name}, sont brisés.`, [h.id, ai.id]);
        continue;
      }
      if (game.year - cur.said >= 9) {
        cur.said = game.year;
        const line = SWORN[(game.year + ai.id) % SWORN.length];
        h.messages.push({ year: game.year, kind: 'diplomacy', text: `Message des ${ai.name} : « ${line} »`, target: { kind: 'player', id: ai.id } });
      }
      continue;
    }
    // a new nemesis, fifteen years at least after the last one broke
    const last = list.filter(n => n.of === h.id).sort((a, b) => (b.broken ?? 0) - (a.broken ?? 0))[0];
    if (last?.broken !== undefined && game.year - last.broken < 15) continue;
    let best: Player | undefined, bg = NEMESIS_AT;
    for (const ai of game.players) {
      if (!ai.ai || ai.dead || ai.monster || !ai.intel.met.includes(h.id)) continue;
      if (list.some(n => n.ai === ai.id && n.of === h.id && n.broken !== undefined && game.year - n.broken < 40)) continue;
      const g = ai.grudges?.[h.id] ?? 0;
      if (g >= bg && own(game, ai.id) >= 2) { bg = g; best = ai; }
    }
    if (!best) continue;
    list.push({ of: h.id, ai: best.id, since: game.year, peak: own(game, best.id), said: game.year });
    if (best.aiState) best.aiState.lastDesignYear = -100; // it studies your warships and redraws its own
    h.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${best.name} ont juré votre perte. Trop de leurs vaisseaux et de leurs mondes vous doivent leur fin : désormais, ils vous combattront dès qu'ils le pourront, viseront vos mondes les plus faibles et refuseront toute paix tant que leur empire ne sera pas brisé (60 % des mondes qu'ils tenaient, ou leur capitale).`, target: { kind: 'player', id: best.id } });
    for (const o of game.players) if (o.id !== h.id && !o.monster && !o.dead && !o.ai && o.intel.met.includes(best.id)) o.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${best.name} ont juré la perte des ${h.name}.`, target: { kind: 'player', id: best.id } });
    addChronicle(game, 'nemesis', `Les ${best.name} jurent la perte des ${h.name}.`, [h.id, best.id]);
  }
}
