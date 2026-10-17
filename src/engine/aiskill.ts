// 0.3.9.14: what each difficulty level of the computers knows how to do. "Easy" plays as before 0.3.9.14; "standard"
// looks after its economy and its defense (refits, stations, defense of its worlds, fleets kept together, expansion,
// minerals, research, idle colony ships); "harder" and "expert" also plan their invasions, design against the enemy's
// fleet and band together against an empire that runs away with the game.
import type { Player } from './types';

export const aiSkill = (p: Player | undefined): 0 | 1 | 2 => !p?.ai || p.ai === 'easy' ? 0 : p.ai === 'standard' ? 1 : 2;

/** For the AI arena: behaviours of 0.3.9.14 switched off by name (measuring what each one is worth). */
export const aiOff = (k: string): boolean => !!(globalThis as { __aiOff?: Set<string> }).__aiOff?.has(k);
/** Does this computer use this behaviour of 0.3.9.14 (its level is high enough, and the arena did not switch it off)? */
export const aiCan = (p: Player | undefined, level: 1 | 2, k: string): boolean => aiSkill(p) >= level && !aiOff(k);
