// Design upgrades (Constellations 3.2.5): a newly found component replaces, in every design of yours that uses an
// older component of the same kind, that older component. Each upgraded design is a new design (the next number in
// its name), the old one is withdrawn (the ships already built keep flying, shown as obsolete and open to a refit),
// and the production lines that were building the old design build the new one.
import type { GameState, Player, ShipDesign } from './types';
import type { TechData } from '../data/types';
import { TECHS, HULLS, partFitsSlot, hasTech } from './tech';
import { addDesign } from './newgame';

/** Kinds where a better part is a plain upgrade (stargates, colony modules, terraforming robots… are choices, not upgrades). */
const UPGRADABLE = new Set(['Engine', 'BeamWeapon', 'Torpedo', 'Armor', 'Shield', 'Scanner', 'MineRobot', 'MineLayer', 'Bomb', 'Mechanical', 'Electrical', 'Orbital']);
const SKIP_TAGS = new Set(['ColonyModule', 'TerraformingRobot', 'Stargate']);

const tagKey = (t: TechData) => [...t.tags].sort().join('+');
const st = (t: TechData) => t.stats ?? {};

/** Is `t` a straight upgrade of `old` (same kind, same role, better)? */
export function betterPart(t: TechData, old: TechData): boolean {
  if (t.name === old.name || t.cat !== old.cat || !UPGRADABLE.has(t.cat)) return false;
  if (t.req.acquirable || old.req.acquirable) return false; // alien parts are one of a kind
  if (tagKey(t) !== tagKey(old) || t.tags.some(x => SKIP_TAGS.has(x))) return false;
  const a = st(t), b = st(old);
  switch (t.cat) {
    case 'BeamWeapon': case 'Torpedo': {
      if (!!a.gatling !== !!b.gatling || !!a.damageShieldsOnly !== !!b.damageShieldsOnly) return false;
      const ra = a.range ?? 0, rb = b.range ?? 0;
      if ((ra > 0) !== (rb > 0) || ra < rb) return false;
      return (a.power ?? 0) > (b.power ?? 0) || ((a.power ?? 0) === (b.power ?? 0) && ra > rb);
    }
    case 'Scanner':
      if (a.canStealFleetCargo || a.canStealPlanetCargo || b.canStealFleetCargo || b.canStealPlanetCargo) return false;
      return (a.scanRange ?? 0) >= (b.scanRange ?? 0) && (a.scanRangePen ?? 0) >= (b.scanRangePen ?? 0) && ((a.scanRange ?? 0) + (a.scanRangePen ?? 0)) > ((b.scanRange ?? 0) + (b.scanRangePen ?? 0));
    case 'Armor': return (a.armor ?? 0) > (b.armor ?? 0);
    case 'Shield': return (a.shield ?? 0) > (b.shield ?? 0);
    case 'MineRobot': return (a.miningRate ?? 0) > (b.miningRate ?? 0);
    case 'MineLayer': return a.minefieldType === b.minefieldType && (a.mineLayingRate ?? 0) > (b.mineLayingRate ?? 0);
    // 0.3.9.21: a Retro Bomb (it un-terraforms, kills no one) is not a better ordinary bomb
    case 'Bomb': return !!a.smart === !!b.smart && !!a.unterraformRate === !!b.unterraformRate && t.rank > old.rank;
    case 'Mechanical':
      if (t.tags.includes('FuelTank')) return (a.fuelBonus ?? 0) > (b.fuelBonus ?? 0);
      if (t.tags.includes('CargoPod')) return (a.cargoBonus ?? 0) > (b.cargoBonus ?? 0);
      return t.rank > old.rank;
    case 'Electrical':
      if (t.name === 'Transport Cloaking' || old.name === 'Transport Cloaking') return false;
      if (t.tags.includes('Cloak')) return (a.cloakUnits ?? 0) > (b.cloakUnits ?? 0);
      return t.tags.length > 0 && t.rank > old.rank;
    default: return t.rank > old.rank;
  }
}

export interface UpgradePlan { design: ShipDesign; replaced: string[] }

/** Your designs (still in production) that the component would improve. */
export function upgradeTargets(game: GameState, p: Player, partName: string): UpgradePlan[] {
  const t = TECHS.get(partName);
  if (!t || !hasTech(p, t)) return [];
  const out: UpgradePlan[] = [];
  for (const d of game.designs) {
    if (d.owner !== p.id || d.deleted || d.alien) continue;
    const h = HULLS.get(d.hull);
    if (!h) continue;
    const replaced = new Set<string>();
    for (const s of d.slots) {
      const old = TECHS.get(s.part);
      const types = h.slots[s.slot - 1]?.types ?? [];
      if (old && betterPart(t, old) && partFitsSlot(t, types, h.name)) replaced.add(old.name);
    }
    if (replaced.size) out.push({ design: d, replaced: [...replaced] });
  }
  return out;
}

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const toRoman = (n: number) => { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; };
const fromRoman = (s: string) => { let n = 0, i = 0; for (const [v, r] of ROMAN) while (s.startsWith(r, i)) { n += v; i += r.length; } return i === s.length ? n : 0; };

/** "Croiseur IV" → "Croiseur V", "Éclaireur 2" → "Éclaireur 3", "Sonde" → "Sonde 2"; never a name already taken. */
export function nextDesignName(game: GameState, p: Player, name: string): string {
  const taken = new Set(game.designs.filter(d => d.owner === p.id).map(d => d.name));
  let base = name, n = 1, roman = false;
  const mr = /^(.*\S)\s+([IVXLCDM]+)$/.exec(name);
  const mn = /^(.*\S)\s+(\d+)$/.exec(name);
  if (mr && fromRoman(mr[2]) > 0) { base = mr[1]; n = fromRoman(mr[2]); roman = true; }
  else if (mn) { base = mn[1]; n = +mn[2]; }
  for (let k = n + 1; k < n + 200; k++) {
    const cand = `${base} ${roman ? toRoman(k) : k}`;
    if (!taken.has(cand)) return cand;
  }
  return `${name} (${game.year})`;
}

/**
 * Puts the component in every design it improves (or those listed in `only`): new designs, old ones withdrawn,
 * production switched over.
 * Returns the pairs (old → new).
 */
export function upgradeDesigns(game: GameState, p: Player, partName: string, only?: number[]): { from: ShipDesign; to: ShipDesign; replaced: string[] }[] {
  const t = TECHS.get(partName);
  if (!t) return [];
  const done: { from: ShipDesign; to: ShipDesign; replaced: string[] }[] = [];
  for (const plan of upgradeTargets(game, p, partName)) {
    if (only && !only.includes(plan.design.id)) continue;
    const d = plan.design, h = HULLS.get(d.hull)!;
    const slots = d.slots.map(s => {
      const old = TECHS.get(s.part);
      const types = h.slots[s.slot - 1]?.types ?? [];
      return old && plan.replaced.includes(old.name) && partFitsSlot(t, types, h.name) ? { ...s, part: t.name } : { ...s };
    });
    const nd = addDesign(game, { id: -1, owner: p.id, name: nextDesignName(game, p, d.name), hull: d.hull, slots, starbase: d.starbase, purpose: d.purpose, role: d.role, scout: d.scout, built: 0 });
    d.deleted = true;
    // what was being built (or refitted to) the old design now follows the new one
    for (const pl of game.planets) {
      if (pl.owner !== p.id) continue;
      for (const q of pl.queue) if ((q.kind === 'ship' || q.kind === 'starbase' || q.kind === 'refit') && q.designId === d.id) q.designId = nd.id;
    }
    for (const tp of p.templates ?? []) for (const it of tp.items) if (it.designId === d.id) it.designId = nd.id;
    // 0.3.9.21: the operations that had it built, and the refit orders that aimed at it, follow too
    for (const f of game.fleets) {
      if (f.owner !== p.id) continue;
      if (f.op?.designId === d.id) f.op.designId = nd.id;
      for (const wp of f.waypoints) if (wp.refitTo) for (const k of Object.keys(wp.refitTo)) if (wp.refitTo[+k] === d.id) wp.refitTo[+k] = nd.id;
    }
    done.push({ from: d, to: nd, replaced: plan.replaced });
  }
  return done;
}
