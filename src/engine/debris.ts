// Constellations 3.6: the wrecks of a battle. Whoever holds the field after a battle may study the debris of the enemy
// ships destroyed there: when they carried components it does not know yet, its scientists make progress toward them
// (research points in the field of the most advanced one), the more wrecks, the better the odds.
import type { GameState, Player } from './types';
import { Rng, seedFromString } from './rng';
import { TECHS, HULLS, hasTech, mainField, FIELD_NAMES } from './tech';
import { addResearch, researchCost } from './research';
import { tl } from '../data/labels';
import { foughtWith } from './techtrade';

export const debrisOn = (game: GameState) => !!game.settings.debris;
/** Odds per enemy ship destroyed (at most DEBRIS_MAX), share of the next level's cost gained. */
export const DEBRIS_ODDS = 0.12, DEBRIS_MAX = 0.6, DEBRIS_SHARE = 0.35;

export function studyDebris(game: GameState) {
  if (!debrisOn(game)) return;
  const rng = new Rng(seedFromString(`${game.settings.seed}|debris|${game.year}`));
  for (const b of game.battles) {
    const tok = new Map(b.tokens.map(t => [t.id, t]));
    // ships destroyed, by owner and design
    const lost = new Map<number, Map<number, number>>();
    for (const a of b.actions) {
      if (a.t !== 'fire' || !a.killed) continue;
      const t = tok.get(a.target);
      if (!t) continue;
      const m = lost.get(t.owner) ?? new Map<number, number>();
      m.set(t.designId, (m.get(t.designId) ?? 0) + a.killed);
      lost.set(t.owner, m);
    }
    if (!lost.size) continue;
    // who holds the field: empires with ships still there
    const holders = new Set(game.fleets.filter(f => Math.abs(f.x - b.x) < 0.5 && Math.abs(f.y - b.y) < 0.5 && f.tokens.length).map(f => f.owner));
    for (const pid of b.players) {
      const p = game.players[pid];
      if (!p || p.monster || p.dead || !holders.has(pid)) continue;
      let wrecks = 0;
      const parts = new Map<string, number>();
      // 0.3.9.21: only the wrecks of those it fought (not an ally's, nor those of a fight between two others)
      const foes = foughtWith(b, pid);
      for (const [owner, designs] of lost) {
        if (owner === pid || !foes.has(owner)) continue;
        for (const [did, n] of designs) {
          wrecks += n;
          const d = game.designs.find(x => x.id === did);
          if (d) for (const s of d.slots) parts.set(s.part, (parts.get(s.part) ?? 0) + n);
          if (d) parts.set(d.hull, (parts.get(d.hull) ?? 0) + n);
        }
      }
      if (!wrecks || !rng.chance(Math.min(DEBRIS_MAX, DEBRIS_ODDS * wrecks))) continue;
      // the most advanced thing we do not know yet (alien technologies are only seen, never understood)
      const unknown = [...parts.keys()].map(n => TECHS.get(n) ?? HULLS.get(n)).filter(t => t && !t.req.acquirable && !hasTech(p, t) && mainField(t.req)) as { name: string; rank?: number; req: NonNullable<ReturnType<typeof TECHS.get>>['req'] }[];
      if (!unknown.length) continue;
      unknown.sort((x, y) => (y.rank ?? 0) - (x.rank ?? 0));
      const t = unknown[0];
      const f = mainField(t.req)!;
      const pts = Math.max(10, Math.round(researchCost(game, p, f) * DEBRIS_SHARE));
      addResearch(game, p, f, pts, rng);
      const where = b.planetId !== undefined ? game.planets[b.planetId].name : `(${Math.round(b.x)}, ${Math.round(b.y)})`;
      if (!p.ai) p.messages.push({ year: game.year, kind: 'research', text: `Débris de la bataille de ${where} : vos scientifiques ont étudié les épaves ennemies et progressent vers ${tl(t.name)} (+${pts} points en ${FIELD_NAMES[f]}).`, target: { kind: 'research', id: 0 } });
    }
  }
}
export type { Player };
