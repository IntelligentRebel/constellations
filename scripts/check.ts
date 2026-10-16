import type { GameState } from '../src/engine/types';
import { fleetSpec } from '../src/engine/fleet';
import { inWall, wallAt, regionOf } from '../src/engine/walls';

export function checkInvariants(g: GameState): string[] {
  const errs: string[] = [];
  const num = (v: unknown, where: string) => { if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${where} = ${v}`); };
  // 3.6: nothing ends a year inside a dark cloud
  // (0.3.7: but on the way into a veiled star the empire found, and the guardian of that star)
  for (const f of g.fleets) if (inWall(g, f.x, f.y, f.owner) && !(f.orbiting >= 0 && g.planets[f.orbiting]?.hidden === 'veiled')) errs.push(`fleet ${f.name} inside ${wallAt(g, f.x, f.y)} at ${f.x},${f.y}`);
  // 0.3.7: nothing in the void around the hidden cluster; one line of intel per world for everyone
  for (const f of g.fleets) if (regionOf(g, f) < 0) errs.push(`fleet ${f.name} in the void at ${f.x},${f.y}`);
  for (const pl of g.players) if (pl.intel.planets.length !== g.planets.length) errs.push(`${pl.name}: ${pl.intel.planets.length} intel lines for ${g.planets.length} worlds`);
  for (const p of g.planets) {
    num(p.pop, `planet ${p.name} pop`); if (p.pop < 0) errs.push(`planet ${p.name} pop<0`);
    for (const m of ['ironium', 'boranium', 'germanium'] as const) { num(p.surface[m], `${p.name} surface ${m}`); if (p.surface[m] < 0) errs.push(`${p.name} surface ${m} < 0`); num(p.conc[m], `${p.name} conc`); }
    if (p.owner >= 0 && p.pop <= 0) errs.push(`${p.name} owned with 0 pop`);
    for (let i = 0; i < 3; i++) if (p.hab[i] < 0 || p.hab[i] > 100) errs.push(`${p.name} hab ${i} = ${p.hab[i]}`);
    for (const q of p.queue) { num(q.qty, `${p.name} queue qty`); }
  }
  for (const f of g.fleets) {
    if (!f.tokens.length) errs.push(`fleet ${f.name} empty`);
    for (const t of f.tokens) { if (t.qty <= 0) errs.push(`fleet ${f.name} token qty ${t.qty}`); num(t.damage, `${f.name} dmg`); }
    num(f.fuel, `${f.name} fuel`); num(f.x, `${f.name} x`); num(f.y, `${f.name} y`);
    const sp = fleetSpec(g, f);
    if (f.fuel < 0 || f.fuel > sp.fuelCapacity + 1e-6) errs.push(`fleet ${f.name} fuel ${f.fuel}/${sp.fuelCapacity}`);
    const c = f.cargo.ironium + f.cargo.boranium + f.cargo.germanium + f.cargo.colonists;
    if (c > sp.cargoCapacity + 1e-6) errs.push(`fleet ${f.name} cargo ${c}/${sp.cargoCapacity}`);
    for (const k of ['ironium', 'boranium', 'germanium', 'colonists'] as const) if (f.cargo[k] < 0) errs.push(`${f.name} cargo ${k}<0`);
  }
  // Constellations 3
  for (const pl of g.players) {
    if (pl.dead) continue;
    if (pl.capital !== undefined && g.planets.some(p => p.owner === pl.id) && g.year > 2400 && g.planets[pl.capital]?.owner !== pl.id && g.settings.distanceCost) errs.push(`${pl.name}: capital not owned`);
    if (pl.objectives && pl.objectives.length !== 2) errs.push(`${pl.name}: ${pl.objectives.length} objectives`);
  }
  for (const p of g.planets) {
    if (p.regionalCapital && p.owner < 0) errs.push(`${p.name}: regional capital without owner`);
    for (const q of p.queue) if (q.kind === 'mega' && !q.megaId) errs.push(`${p.name}: megaproject without id`);
    if (p.migration && (p.migration.target < 5 || p.migration.target > 100)) errs.push(`${p.name}: migration target ${p.migration.target}`);
  }
  for (const f of g.fleets) if (f.job && f.auto !== 'logistics') errs.push(`${f.name}: job outside the network`);
  return errs;
}
