// Technology store: components, hulls, requirements and per-player costs (miniaturization).
import { TECH_DATA } from '../data/techs';
import '../data/extras';
import { HULL_DATA } from '../data/hulls';
import type { HullData, TechData, TechReq } from '../data/types';
import type { Cost, Field, Player, Race, TechLevels } from './types';
import { FIELDS } from './types';
import { raceSpec } from './race';

export const TECHS = new Map<string, TechData>(TECH_DATA.map(t => [t.name, t]));
export const HULLS = new Map<string, HullData>(HULL_DATA.map(h => [h.name, h]));

export function tech(name: string): TechData {
  const t = TECHS.get(name);
  if (!t) throw new Error('Unknown tech ' + name);
  return t;
}
export function hull(name: string): HullData {
  const h = HULLS.get(name);
  if (!h) throw new Error('Unknown hull ' + name);
  return h;
}

export const FIELD_KEYS: Record<Field, keyof TechReq> = { energy: 'en', weapons: 'we', propulsion: 'pr', construction: 'co', electronics: 'el', biotechnology: 'bi' };
export const FIELD_NAMES: Record<Field, string> = { energy: 'Énergie', weapons: 'Armement', propulsion: 'Propulsion', construction: 'Construction', electronics: 'Électronique', biotechnology: 'Biotechnologie' };
export const FIELD_SHORT: Record<Field, string> = { energy: 'Éne', weapons: 'Arm', propulsion: 'Pro', construction: 'Con', electronics: 'Éle', biotechnology: 'Bio' };

export function reqLevels(req: TechReq): TechLevels {
  return { energy: req.en, weapons: req.we, propulsion: req.pr, construction: req.co, electronics: req.el, biotechnology: req.bi };
}

export function canLearn(race: Race, req: TechReq): boolean {
  if (req.prtsRequired && !req.prtsRequired.includes(race.prt)) return false;
  if (req.prtsDenied && req.prtsDenied.includes(race.prt)) return false;
  if (req.lrtsRequired && !req.lrtsRequired.every(l => race.lrts.includes(l as any))) return false;
  if (req.lrtsDenied && req.lrtsDenied.some(l => race.lrts.includes(l as any))) return false;
  return true;
}

export function meetsLevels(levels: TechLevels, req: TechReq): boolean {
  return FIELDS.every(f => levels[f] >= (req[FIELD_KEYS[f]] as number));
}

/** Field holding the highest requirement of an item (the one the per-game shift applies to), or null. */
export function mainField(req: TechReq): Field | null {
  let best: Field | null = null, v = 0;
  for (const f of FIELDS) { const r = req[FIELD_KEYS[f]] as number; if (r > v) { v = r; best = f; } }
  return best;
}

/** Requirement actually in force in this game (main field moved by the hidden per-game shift). */
export function effReq(player: { techShift?: Record<string, number> }, item: { name: string; req: TechReq }): TechReq {
  const d = player.techShift?.[item.name];
  if (!d) return item.req;
  const f = mainField(item.req);
  if (!f) return item.req;
  const k = FIELD_KEYS[f];
  return { ...item.req, [k]: Math.max(1, Math.min(26, (item.req[k] as number) + d)) };
}

export function hasTech(player: Player, item: { name: string; req: TechReq }): boolean {
  if (!canLearn(player.race, item.req)) return false;
  if (!meetsLevels(player.tech, effReq(player, item))) return false;
  if (item.req.acquirable && !player.acquiredTechs.includes(item.name)) return false;
  return true;
}

/** Levels above requirements (min over required fields); lowest level if there is no requirement. */
export function levelsAbove(levels: TechLevels, req: TechReq): number {
  let min = Infinity;
  for (const f of FIELDS) {
    const r = req[FIELD_KEYS[f]] as number;
    if (r > 0) min = Math.min(min, levels[f] - r);
  }
  if (min === Infinity) min = Math.min(...FIELDS.map(f => levels[f]));
  return min;
}

const roundHalfDown = (x: number) => Math.ceil(x - 0.5);
const minOne = (x: number) => (x > 0 && x < 1 ? 1 : roundHalfDown(x));

export function costOf(arr: number[]): Cost {
  return { ironium: arr[0] ?? 0, boranium: arr[1] ?? 0, germanium: arr[2] ?? 0, resources: arr[3] ?? 0 };
}

/** Cost for a player of one component/hull, including miniaturization, BET and racial cost offsets. */
export function playerCost(player: { tech: TechLevels; race: Race; techShift?: Record<string, number> }, item: { name?: string; cost: number[]; req: TechReq; tags?: string[] }): Cost {
  const spec = raceSpec(player.race);
  const above = levelsAbove(player.tech, item.name ? effReq(player, item as { name: string; req: TechReq }) : item.req);
  const f = above > 0 ? 1 - Math.min(spec.miniMax, spec.miniPerLevel * above) : spec.newTechCostFactor;
  const base = costOf(item.cost);
  const c: Cost = { ironium: minOne(base.ironium * f), boranium: minOne(base.boranium * f), germanium: minOne(base.germanium * f), resources: minOne(base.resources * f) };
  let multi = 1;
  for (const tag of item.tags ?? []) if (spec.techCostOffset[tag]) multi *= 1 + spec.techCostOffset[tag];
  if (multi !== 1) {
    for (const k of ['ironium', 'boranium', 'germanium', 'resources'] as const) c[k] = minOne(c[k] + roundHalfDown(c[k] * (multi - 1)));
  }
  return c;
}

export function techsInCategory(cat: string): TechData[] {
  return TECH_DATA.filter(t => t.cat === cat);
}

export const CATEGORY_NAMES: Record<string, string> = {
  Engine: 'Moteurs', BeamWeapon: 'Armes à faisceau', Torpedo: 'Torpilles', Bomb: 'Bombes', Armor: 'Blindages', Shield: 'Boucliers',
  Scanner: 'Scanners', Electrical: 'Électrique', Mechanical: 'Mécanique', MineLayer: 'Lance-mines', MineRobot: 'Robots foreurs',
  Orbital: 'Orbital', PlanetaryScanner: 'Scanners planétaires', PlanetaryDefense: 'Défenses planétaires', Terraforming: 'Terraformation',
  Planetary: 'Planétaire', ShipHull: 'Coques de vaisseaux', StarbaseHull: 'Coques de stations',
};

export const SLOT_TYPE_NAMES: Record<string, string> = {
  Engine: 'Moteur', Scanner: 'Scanner', Mechanical: 'Mécanique', Bomb: 'Bombe', Mining: 'Minage', Electrical: 'Électrique',
  Shield: 'Bouclier', Armor: 'Blindage', Weapon: 'Arme', MineLayer: 'Poseur', Orbital: 'Orbital', SpaceDock: 'Chantier', Cargo: 'Soute',
};

export function slotLabel(types: string[]): string {
  const s = new Set(types);
  if (s.size >= 7 && s.has('Scanner') && s.has('Mechanical') && s.has('Electrical') && s.has('Weapon')) return 'Général';
  if (s.has('Shield') && s.has('Armor') && s.size === 2) return 'Bouclier/Blindage';
  if (s.has('Electrical') && s.has('Mechanical') && s.size === 2) return 'Élec/Méca';
  if (s.has('Orbital') && s.has('Electrical') && s.size === 2) return 'Orbital/Élec';
  if (s.has('Scanner') && s.has('Electrical') && s.has('Mechanical') && s.size === 3) return 'Scanner/Élec/Méca';
  if (s.has('Mining') && s.has('Electrical') && s.has('Mechanical')) return 'Minage/Élec/Méca';
  if (s.has('MineLayer') && s.size === 1) return 'Poseur de mines';
  return types.map(t => SLOT_TYPE_NAMES[t] ?? t).join('/');
}

/** does a component fit a hull slot */
export function partFitsSlot(part: TechData, slotTypes: string[], hullName: string): boolean {
  if (!part.slot) return false;
  if (!slotTypes.includes(part.slot)) return false;
  if (part.req.hullsAllowed && !part.req.hullsAllowed.includes(hullName)) return false;
  if (part.req.hullsDenied && part.req.hullsDenied.includes(hullName)) return false;
  return true;
}

export function techRequirementText(req: TechReq): string {
  const parts: string[] = [];
  for (const f of FIELDS) { const v = req[FIELD_KEYS[f]] as number; if (v > 0) parts.push(`${FIELD_NAMES[f]} ${v}`); }
  return parts.length ? parts.join(', ') : 'Aucun';
}
