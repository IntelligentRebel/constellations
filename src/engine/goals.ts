// Research goals (Constellations 3.3.2): a goal can be a component, a hull, a technology without a component
// (automatic exploration, wormhole navigation) or a megaproject. The last two unlock at fixed levels, known exactly.
import type { Field, GameState, Player } from './types';
import { FIELDS } from './types';
import type { TechReq } from '../data/types';
import { TECHS, HULLS, hasTech, FIELD_KEYS } from './tech';
import { SPECIALS, hasSpecial } from './specials';
import { MEGAPROJECTS } from './megaprojects';

export interface GoalItem { name: string; req: TechReq; kind: 'tech' | 'hull' | 'special' | 'mega'; exact?: boolean }

export function levelsReq(r: Partial<Record<Field, number>>): TechReq {
  const q: TechReq = { en: 0, we: 0, pr: 0, co: 0, el: 0, bi: 0 };
  for (const f of FIELDS) (q as any)[FIELD_KEYS[f]] = r[f] ?? 0;
  return q;
}

export function resolveGoal(game: GameState, name?: string): GoalItem | undefined {
  if (!name) return undefined;
  const t = TECHS.get(name);
  if (t) return { name, req: t.req, kind: 'tech' };
  const h = HULLS.get(name);
  if (h) return { name, req: h.req, kind: 'hull' };
  const sp = SPECIALS.find(x => x.name === name);
  // a special technology on the hidden tree is aimed at like a component (odds); otherwise its level is known
  if (sp) return { name, req: levelsReq(sp.req), kind: 'special', exact: !(sp.fuzzy && game.settings.fuzzyTechTree) };
  const m = MEGAPROJECTS.find(x => x.name === name);
  if (m) return { name, req: levelsReq(m.req), kind: 'mega', exact: true };
  return undefined;
}

export function goalReached(p: Player, g: GoalItem): boolean {
  if (g.kind === 'tech') return hasTech(p, TECHS.get(g.name)!);
  if (g.kind === 'hull') return hasTech(p, HULLS.get(g.name)!);
  const sp = g.kind === 'special' ? SPECIALS.find(x => x.name === g.name) : undefined;
  if (sp) return hasSpecial(p, sp);
  return FIELDS.every(f => p.tech[f] >= ((g.req as any)[FIELD_KEYS[f]] ?? 0));
}
