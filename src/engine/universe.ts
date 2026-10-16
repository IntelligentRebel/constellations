// Universe generation: planets, homeworlds, wormholes.
import type { Density, GameState, Hab, Minerals, Planet, PlayerPositions, ShapeParams, UniverseSize, Wormhole } from './types';
import { densityAt, pointInGalaxy, coverage, cloudAt } from './shape';
import { mainRegionTest } from './walls';
import { STABILITIES } from './types';
import { Rng } from './rng';
import { PLANET_NAMES, generatedName } from '../data/names';

export const UNIVERSE_SIZES: Record<UniverseSize, number> = { Tiny: 400, Small: 800, Medium: 1200, Large: 1600, Huge: 2000 };
export const SIZE_LABELS: Record<UniverseSize, string> = { Tiny: 'Minuscule', Small: 'Petit', Medium: 'Moyen', Large: 'Grand', Huge: 'Immense' };
export const DENSITY_LABELS: Record<Density, string> = { Sparse: 'Clairsemée', Normal: 'Normale', Dense: 'Dense', Packed: 'Compacte' };
export const POSITION_LABELS: Record<PlayerPositions, string> = { Close: 'Proches', Moderate: 'Modérées', Farther: 'Éloignées', Distant: 'Distantes' };
export const WORMHOLE_PAIRS: Record<UniverseSize, number> = { Tiny: 1, Small: 3, Medium: 4, Large: 5, Huge: 6 };

export function planetCount(size: UniverseSize, density: Density): number {
  const s = UNIVERSE_SIZES[size];
  const base = Math.trunc(s * s / 5000);
  switch (density) {
    case 'Sparse': return base - Math.trunc(base / 4);
    case 'Dense': return base + Math.trunc(base / 4);
    case 'Packed': return base + Math.trunc(base * 3 / 4);
    default: return base;
  }
}

function normalSample(rng: Rng, mean: number, sd: number, max: number): number {
  for (let i = 0; i < 100; i++) {
    const x = Math.round(rng.normal(mean, sd));
    if (x >= 0 && x <= max) return x;
  }
  return mean;
}

export function randomConcentrations(rng: Rng, rad: number, accelerated: boolean): Minerals {
  const c = [1 + normalSample(rng, 80, 20, 120), 1 + normalSample(rng, 80, 20, 120), 1 + normalSample(rng, 80, 20, 120)];
  if (accelerated) for (let i = 0; i < 3; i++) if (c[i] < 40) c[i] += 5;
  let limiter = rng.int(27);
  if (limiter >= 9 && limiter <= 17) c[rng.int(3)] = 1 + rng.int(30);
  else if (limiter <= 8) {
    limiter += 1;
    while (limiter < 16) { c[rng.int(3)] = 1 + rng.int(30); limiter *= 2; }
  }
  if (rad >= 90) for (let i = 0; i < 3; i++) c[i] += Math.trunc(rng.int(99 - Math.min(c[i], 98)) / 2);
  return { ironium: clamp(c[0], 1, 121), boranium: clamp(c[1], 1, 121), germanium: clamp(c[2], 1, 121) };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function randomHab(rng: Rng): Hab {
  return [1 + rng.int(91) + rng.int(10), 1 + rng.int(91) + rng.int(10), 1 + rng.int(99)];
}

/**
 * 3.6: planets of a natural galaxy, drawn with the odds of its density map (dense core and arms, sparse gaps, a
 * ragged edge); "en amas" adds small knots. Same number of planets, same minimum spacing as in the square.
 */
function shapedPoints(rng: Rng, W: number, n: number, shape: ShapeParams, clumping: boolean): { x: number; y: number }[] {
  const border = 20, R = W / 2, cell = 14;
  const grid = new Map<number, { x: number; y: number }[]>();
  const key = (cx: number, cy: number) => cx * 4096 + cy;
  const kept: { x: number; y: number }[] = [];
  // 3.6: no world shut away behind the dark clouds (a pocket they close off)
  const inMain = shape.walls?.length ? mainRegionTest({ shape, width: W, height: W }) : null;
  const knots = clumping ? Array.from({ length: Math.max(4, Math.trunc(n / 20)) }, () => pointInGalaxy({ shape, width: W, height: W }, rng, 40, 0.3)) : [];
  for (let t = 0; t < n * 400 && kept.length < n; t++) {
    const x = border + rng.int(W - 2 * border), y = border + rng.int(W - 2 * border);
    let d = densityAt(shape, (x - R) / R, (y - R) / R);
    if (knots.length) d *= 0.35 + 1.3 * Math.max(...knots.map(k => Math.exp(-((Math.hypot(k.x - x, k.y - y) / (W * 0.06)) ** 2))));
    // the void around the galaxy stays empty (no lone world lost in it)
    if (d < 0.03 || rng.random() >= d) continue;
    if (inMain && !inMain(x, y)) continue;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let ok = true;
    for (let i = -1; i <= 1 && ok; i++) for (let j = -1; j <= 1 && ok; j++) for (const q of grid.get(key(cx + i, cy + j)) ?? []) if (Math.hypot(q.x - x, q.y - y) < 14) { ok = false; break; }
    if (!ok) continue;
    const pt = { x, y };
    kept.push(pt);
    const k = key(cx, cy);
    grid.set(k, [...(grid.get(k) ?? []), pt]);
  }
  return kept;
}

export function generatePlanets(rng: Rng, size: UniverseSize, density: Density, clumping: boolean, accelerated: boolean, shape?: ShapeParams): Planet[] {
  const W = UNIVERSE_SIZES[size];
  const n = planetCount(size, density);
  if (shape) return toPlanets(rng, shapedPoints(rng, W, n, shape, clumping), accelerated);
  const border = 30;
  const pts: { x: number; y: number }[] = [];
  const target = n + Math.trunc(n / 7);
  for (let i = 0; i < target; i++) pts.push({ x: border + rng.int(W - 2 * border), y: border + rng.int(W - 2 * border) });
  if (clumping) {
    // nudge points toward a few attractors to create clusters
    const attractors = Array.from({ length: Math.max(3, Math.trunc(n / 25)) }, () => ({ x: border + rng.int(W - 2 * border), y: border + rng.int(W - 2 * border) }));
    for (const p of pts) {
      let best = attractors[0], bd = Infinity;
      for (const a of attractors) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = a; } }
      const f = 0.35 + rng.random() * 0.3;
      p.x = Math.round(p.x + (best.x - p.x) * f); p.y = Math.round(p.y + (best.y - p.y) * f);
    }
  }
  pts.sort((a, b) => a.x - b.x);
  const kept: { x: number; y: number }[] = [];
  for (const p of pts) {
    let ok = true;
    for (let j = kept.length - 1; j >= 0 && p.x - kept[j].x < 14; j--) if (Math.hypot(p.x - kept[j].x, p.y - kept[j].y) < 14) { ok = false; break; }
    if (ok) kept.push(p);
  }
  while (kept.length > n) kept.splice(rng.int(kept.length), 1);
  return toPlanets(rng, kept, accelerated);
}

function toPlanets(rng: Rng, kept: { x: number; y: number }[], accelerated: boolean): Planet[] {
  const names = rng.shuffle([...new Set(PLANET_NAMES)]);
  return kept.map((p, i) => {
    const hab = randomHab(rng);
    const planet: Planet = {
      id: i, name: names[i] ?? generatedName(i - names.length), x: p.x, y: p.y,
      hab, baseHab: [...hab] as Hab, terraformed: [0, 0, 0],
      conc: randomConcentrations(rng, hab[2], accelerated), mineYears: { ironium: 0, boranium: 0, germanium: 0 },
      surface: { ironium: 0, boranium: 0, germanium: 0 },
      owner: -1, pop: 0, mines: 0, factories: 0, defenses: 0, scanner: false, homeworld: false,
      queue: [], leftoverOnly: false, packetWarp: 5, starbase: null, bonusResources: 0,
    };
    return planet;
  });
}

/** Choose well spaced homeworlds in the central area of the map. */
export function chooseHomeworlds(rng: Rng, planets: Planet[], W: number, numPlayers: number, positions: PlayerPositions, shape?: ShapeParams): Planet[] {
  // 3.6: in a natural galaxy the stars fill only part of the map: spacing by the area they really cover
  const shaped = !!shape;
  const area = W * W * (shape ? coverage(shape) : 1);
  const ideal = Math.sqrt(area / Math.max(1, numPlayers)) * ({ Close: 0.45, Moderate: 0.65, Farther: 0.85, Distant: 1.05 } as Record<PlayerPositions, number>)[positions];
  const box = numPlayers < 3 ? 0.15 : numPlayers < 5 ? 0.1 : 0.05;
  // 3.6: a homeworld of a natural galaxy needs neighbours (no start alone on the rim or in a gap)
  const reach = W * 0.12;
  const near = shaped ? planets.map(p => planets.reduce((a, o) => a + (Math.abs(o.x - p.x) < reach && Math.abs(o.y - p.y) < reach && Math.hypot(o.x - p.x, o.y - p.y) < reach ? 1 : 0), 0)) : [];
  const median = shaped ? [...near].sort((a, b) => a - b)[Math.floor(near.length / 2)] : 0;
  const inBox = (p: Planet) => p.x >= W * box && p.x <= W * (1 - box) && p.y >= W * box && p.y <= W * (1 - box) && (!shaped || near[planets.indexOf(p)] >= median * 0.7);
  // 3.6: not right against a dark cloud either (a capital deserves some room)
  const clear = shape?.walls?.length ? planets.map(p => cloudAt(shape, (p.x - W / 2) / (W / 2), (p.y - W / 2) / (W / 2)).edge * W / 2 < -Math.min(30, W * 0.04)) : null;
  let minD = Math.min(ideal, W * 0.9);
  for (let attempt = 0; attempt < 60; attempt++) {
    const chosen: Planet[] = [];
    const candidates = rng.shuffle(planets.filter((p, i) => inBox(p) && (!clear || attempt >= 30 || clear[i])));
    for (const c of candidates) {
      if (chosen.length >= numPlayers) break;
      if (chosen.every(o => Math.hypot(o.x - c.x, o.y - c.y) >= minD)) chosen.push(c);
    }
    if (chosen.length >= numPlayers) return chosen;
    minD *= 0.93;
  }
  return rng.shuffle([...planets]).slice(0, numPlayers);
}

export function generateWormholes(rng: Rng, game: GameState, pairs: number): Wormhole[] {
  const W = game.width;
  const res: Wormhole[] = [];
  const minPlanet = 30, minWorm = W / 4 / 2;
  const place = () => {
    for (let t = 0; t < 1000; t++) {
      // 3.6: inside a natural galaxy, not in the void around it
      const { x, y } = game.shape ? pointInGalaxy(game, rng, 20, 0.12) : { x: 20 + rng.int(W - 40), y: 20 + rng.int(W - 40) };
      if (game.planets.some(p => Math.hypot(p.x - x, p.y - y) < minPlanet)) continue;
      if (res.some(w => Math.hypot(w.x - x, w.y - y) < minWorm)) continue;
      return { x, y };
    }
    return { x: 20 + rng.int(W - 40), y: 20 + rng.int(W - 40) };
  };
  for (let i = 0; i < pairs; i++) {
    const a = place();
    const ida = game.nextId++;
    const wa: Wormhole = { id: ida, x: a.x, y: a.y, destId: -1, stability: STABILITIES[rng.int(7)], yearsAtStability: 0 };
    res.push(wa);
    const b = place();
    const idb = game.nextId++;
    const wb: Wormhole = { id: idb, x: b.x, y: b.y, destId: ida, stability: STABILITIES[rng.int(7)], yearsAtStability: 0 };
    wa.destId = idb;
    res.push(wb);
  }
  return res;
}

export const STABILITY_LABELS: Record<string, string> = {
  rockSolid: 'Stable comme le roc', stable: 'Stable', mostlyStable: 'Plutôt stable', average: 'Moyenne',
  slightlyVolatile: 'Un peu instable', volatile: 'Instable', extremelyVolatile: 'Très instable',
};
