// 0.3.9: what the game sounds like. The mood of the music follows the state of the empire (calm, tension, crisis),
// and each new year plays the signal of its most important news.
import type { GameState, Player } from '../engine/types';
import { FIELDS } from '../engine/types';
import { portalThreat } from '../engine/megaprojects';
import { play, setMood, type Mood, type Sfx } from './audio';

export interface Before { year: number; planets: number; tech: number; anomalies: number }

const techSum = (p: Player) => FIELDS.reduce((a, f) => a + p.tech[f], 0);
export const snapshot = (g: GameState, me: Player): Before => ({
  year: g.year,
  planets: g.planets.filter(p => p.owner === me.id).length,
  tech: techSum(me),
  anomalies: me.messages.filter(m => m.kind === 'event').length,
});

/** Calm by default; tension when an enemy is close, a battle was fought or a rival builds the Portal; crisis when worlds fall, the Breach is open, or a rival's Portal is half done. */
export function moodOf(g: GameState, me: Player, before?: Before): Mood {
  if (g.victor !== null || me.dead) return 'calm';
  const portal = g.settings.megaprojects ? portalThreat(g) : null;
  const rival = portal && portal.owner !== me.id ? portal.announced : 0;
  const phase = g.settings.crisis ? g.crisis?.phase : undefined;
  const fights = g.battles.filter(b => b.players.includes(me.id)).length;
  const mine = g.planets.filter(p => p.owner === me.id);
  const lost = before ? before.planets > mine.length : false;
  if (rival >= 50 || phase === 'active' || (fights > 0 && lost)) return 'crisis';
  if (fights > 0 || rival > 0 || phase === 'omen' || lost) return 'tension';
  // an enemy fleet seen within 60 ly of one of our worlds
  const near = me.intel.fleets.some(f => {
    if (f.owner === me.id) return false;
    const hostile = f.owner < 0 || g.players[f.owner]?.monster || me.relations[f.owner] === 'enemy';
    if (!hostile) return false;
    return mine.some(p => (p.x - f.x) ** 2 + (p.y - f.y) ** 2 < 60 * 60);
  });
  return near ? 'tension' : 'calm';
}

/** After a generated year: the music's mood, and the signal of the main news (one, two at most). */
export function afterTurn(g: GameState, me: Player, before: Before) {
  setMood(moodOf(g, me, before));
  const out: Sfx[] = [];
  if (g.victor !== null) out.push(g.victor === me.id ? 'victory' : 'defeat');
  else if (me.dead) out.push('defeat');
  else {
    const planets = g.planets.filter(p => p.owner === me.id).length;
    if (g.battles.some(b => b.players.includes(me.id))) out.push('battle');
    if (planets < before.planets) out.push('alert');
    if (techSum(me) > before.tech) out.push('tech');
    if (planets > before.planets) out.push('colony');
    if (me.messages.filter(m => m.kind === 'event').length > before.anomalies) out.push('discovery');
    if (!out.length && me.messages.some(m => m.kind === 'warning')) out.push('alert');
  }
  play('turn');
  out.slice(0, 2).forEach((s, i) => play(s, 0.35 + i * 0.9));
}

/** When a game is loaded or a player takes over: the mood without signals. */
export const moodNow = (g: GameState | null, me: Player | null) => { if (g && me) setMood(moodOf(g, me)); };
