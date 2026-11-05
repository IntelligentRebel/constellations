/**
 * 0.3.9.22: is the engine generating a turn? Some caches can trust object identity during a turn: nothing in the
 * turn changes a race in place (only the race wizard does, outside of turns). Each turn, and each step out of
 * one, starts a new epoch, so an entry made outside a turn is checked again inside the next one.
 */
let depth = 0, epoch = 0;
export const inTurn = () => depth > 0;
export const turnEpoch = () => epoch;
export function withinTurn<T>(fn: () => T): T {
  depth++; epoch++;
  try { return fn(); } finally { depth--; epoch++; }
}
