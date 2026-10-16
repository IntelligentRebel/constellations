// Terrain (Constellations 3): nebulae hide and slow, ion storms drift and weaken shields, dense clusters are rich
// but slow to cross. Space stops being uniform: approaches, chokepoints and ambushes appear.
import { galaxyDensity, isRegion, cloudDepth } from './shape';
import type { GameState, Terrain, TerrainKind, UniverseSize } from './types';
import { Rng, seedFromString } from './rng';

export interface TerrainInfo { name: string; warpCap: number | null; scanFactor: number; shieldFactor: number; effect: string }

export const TERRAIN_INFO: Record<TerrainKind, TerrainInfo> = {
  nebula: { name: 'Nébuleuse', warpCap: 6, scanFactor: 0.5, shieldFactor: 1, effect: 'Portée des scanners divisée par deux pour ce qui s\'y trouve et pour ce qu\'on y cherche ; Warp limité à 6 pour la traverser.' },
  storm: { name: 'Tempête ionique', warpCap: null, scanFactor: 1, shieldFactor: 0.5, effect: 'Boucliers réduits de moitié dans les combats qui s\'y déroulent ; la tempête dérive chaque année.' },
  cluster: { name: 'Amas dense', warpCap: 5, scanFactor: 1, shieldFactor: 1, effect: 'Planètes plus riches en minerais ; Warp limité à 5 pour le traverser.' },
};

const COUNTS: Record<UniverseSize, Record<TerrainKind, number>> = {
  Tiny: { nebula: 1, storm: 1, cluster: 1 },
  Small: { nebula: 3, storm: 2, cluster: 2 },
  Medium: { nebula: 5, storm: 3, cluster: 3 },
  Large: { nebula: 7, storm: 4, cluster: 4 },
  Huge: { nebula: 9, storm: 5, cluster: 5 },
};
const RADIUS: Record<TerrainKind, [number, number]> = { nebula: [55, 110], storm: [35, 60], cluster: [32, 55] };
const NAMES: Record<TerrainKind, string[]> = {
  nebula: ['Opale', 'Brume', 'Cendre', 'Méduse', 'Lanterne', 'Saphir', 'Ambre', 'Voile', 'Héron', 'Sablier', 'Lyre', 'Encre'],
  storm: ['Mistral', 'Sirocco', 'Borée', 'Simoun', 'Tramontane', 'Noroît', 'Levant', 'Autan'],
  cluster: ['de la Ruche', 'des Forges', 'du Grenier', 'de l\'Enclume', 'du Tisserand', 'des Mines', 'du Creuset'],
};

/**
 * 0.3.6.5: bright nebulae (gas ionised by hot young stars) are rare: within 1 500 light-years of the Sun, only the one
 * of Orion stands out. One in a stretch of arm or a superbubble (two on the biggest maps, none on the smallest), more
 * in a nursery, where the stars are being born.
 */
function regionNebulae(game: GameState, rng: Rng): number {
  const size = game.settings.size;
  if (game.shape!.kind === 'nursery') return { Tiny: 1, Small: 2, Medium: 3, Large: 4, Huge: 5 }[size];
  return { Tiny: rng.int(2), Small: 1, Medium: 1, Large: 1 + rng.int(2), Huge: 2 }[size];
}

export const terrainOn = (game: GameState) => !!game.settings.terrain && !!game.terrain?.length;

const inside = (t: Terrain, p: { x: number; y: number }) => (p.x - t.x) ** 2 + (p.y - t.y) ** 2 <= t.r * t.r;

function segHits(t: Terrain, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((t.x - a.x) * dx + (t.y - a.y) * dy) / l2)) : 0;
  return (a.x + k * dx - t.x) ** 2 + (a.y + k * dy - t.y) ** 2 <= t.r * t.r;
}

/** Terrain regions containing a point. */
export function terrainAt(game: GameState, p: { x: number; y: number }): Terrain[] {
  if (!terrainOn(game)) return [];
  return game.terrain!.filter(t => inside(t, p));
}

/** Scanner range factor for something located at p (nebulae halve it). */
export function scanFactorAt(game: GameState, p: { x: number; y: number }): number {
  if (!terrainOn(game)) return 1;
  let f = 1;
  for (const t of game.terrain!) if (TERRAIN_INFO[t.kind].scanFactor < 1 && inside(t, p)) f = Math.min(f, TERRAIN_INFO[t.kind].scanFactor);
  return f;
}

/** Shield factor for a battle at p (ion storms halve shields). */
/** 0.3.7: within this distance of a pulsar, shields hold only half. */
export const PULSAR_SHIELD_RANGE = 40;
export function shieldFactorAt(game: GameState, p: { x: number; y: number }): number {
  const pulsar = game.secrets?.some(s => s.kind === 'pulsar' && Math.hypot(p.x - s.x, p.y - s.y) <= PULSAR_SHIELD_RANGE) ? 0.5 : 1;
  if (!terrainOn(game)) return pulsar;
  let f = pulsar;
  for (const t of game.terrain!) if (TERRAIN_INFO[t.kind].shieldFactor < 1 && inside(t, p)) f = Math.min(f, TERRAIN_INFO[t.kind].shieldFactor);
  return f;
}

/**
 * Warp actually flown this year from `from` toward `to`: if, at the capped speed, the year's path touches a
 * nebula or a cluster, the fleet flies at that cap. Shared by the movement phase and the route estimate.
 */
export function effectiveWarp(game: GameState, from: { x: number; y: number }, to: { x: number; y: number }, warp: number, budget = 1): number {
  if (warp >= 11) return warp;
  warp = cloudCap(game, from, to, warp, budget);
  if (!terrainOn(game)) return warp;
  const total = Math.hypot(to.x - from.x, to.y - from.y);
  let best = warp;
  for (const t of game.terrain!) {
    const cap = TERRAIN_INFO[t.kind].warpCap;
    if (cap === null || cap >= best) continue;
    const d = Math.min(total, cap * cap * budget);
    const end = total > 0 ? { x: from.x + (to.x - from.x) * d / total, y: from.y + (to.y - from.y) * d / total } : from;
    if (inside(t, from) || segHits(t, from, end)) best = cap;
  }
  return best;
}

/**
 * 0.3.7: inside a dark cloud (only the way into a veiled star lets a fleet in), Warp 3 at most: as for the terrain, the
 * year is flown at that speed when the path it would cover at Warp 3 touches the cloud.
 */
function cloudCap(game: GameState, from: { x: number; y: number }, to: { x: number; y: number }, warp: number, budget: number): number {
  if (warp <= 3 || !game.shape?.walls?.length || !game.secrets?.some(s => s.lane)) return warp;
  const R = game.width / 2, H = game.height / 2;
  const total = Math.hypot(to.x - from.x, to.y - from.y);
  const d = Math.min(total, 9 * budget), n = Math.max(1, Math.ceil(d / 2));
  for (let k = 0; k <= n; k++) {
    const x = total > 0 ? from.x + (to.x - from.x) * d * k / n / total : from.x, y = total > 0 ? from.y + (to.y - from.y) * d * k / n / total : from.y;
    if (cloudDepth(game.shape, (x - R) / R, (y - H) / R) > 0) return 3;
  }
  return warp;
}

/** Terrain crossed by a straight leg (for warnings on routes). */
export function terrainOnLeg(game: GameState, a: { x: number; y: number }, b: { x: number; y: number }): Terrain[] {
  if (!terrainOn(game)) return [];
  return game.terrain!.filter(t => segHits(t, a, b));
}

export function terrainName(t: Terrain): string {
  return t.kind === 'cluster' ? `Amas ${t.name}` : `${TERRAIN_INFO[t.kind].name} ${t.name}`;
}

/** Ion storms drift every year (and sometimes change course); they bounce off the edges of the galaxy. */
export function driftStorms(game: GameState, rng: Rng) {
  if (!terrainOn(game)) return;
  for (const t of game.terrain!) {
    if (t.kind !== 'storm') continue;
    if (rng.chance(0.12)) {
      const a = rng.random() * Math.PI * 2, v = 6 + rng.int(8);
      t.dx = Math.round(Math.cos(a) * v); t.dy = Math.round(Math.sin(a) * v);
    }
    t.x += t.dx ?? 0; t.y += t.dy ?? 0;
    if (t.x < t.r * 0.5 || t.x > game.width - t.r * 0.5) { t.dx = -(t.dx ?? 0); t.x = Math.max(t.r * 0.5, Math.min(game.width - t.r * 0.5, t.x)); }
    if (t.y < t.r * 0.5 || t.y > game.height - t.r * 0.5) { t.dy = -(t.dy ?? 0); t.y = Math.max(t.r * 0.5, Math.min(game.height - t.r * 0.5, t.y)); }
  }
}

/**
 * Creates the terrain of a new game with its own random stream (the rest of the universe does not change).
 * Homeworlds stay clear of nebulae and clusters; planets inside a cluster get richer concentrations.
 */
export function generateTerrain(game: GameState): Terrain[] {
  const rng = new Rng(seedFromString(game.settings.seed + '|terrain'));
  const W = game.width;
  const scale = W / 800;
  const homes = game.planets.filter(p => p.homeworld && p.owner >= 0);
  const res: Terrain[] = [];
  const names: Record<TerrainKind, string[]> = { nebula: rng.shuffle([...NAMES.nebula]), storm: rng.shuffle([...NAMES.storm]), cluster: rng.shuffle([...NAMES.cluster]) };
  const shape = game.shape, region = !!shape && isRegion(shape.kind);
  for (const kind of ['nebula', 'cluster', 'storm'] as TerrainKind[]) {
    const n = region && kind === 'nebula' ? regionNebulae(game, rng) : COUNTS[game.settings.size][kind];
    for (let i = 0; i < n; i++) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const [lo, hi] = RADIUS[kind];
        const r = Math.round((lo + rng.int(hi - lo + 1)) * Math.max(0.7, Math.min(1.3, scale)));
        let x = Math.round(r * 0.6 + rng.random() * (W - r * 1.2)), y = Math.round(r * 0.6 + rng.random() * (W - r * 1.2));
        // 0.3.6.5: a bright nebula is the gas lit by the young stars of an association: it sits on one
        if (region && kind === 'nebula' && shape!.clumps?.length && attempt < 60) {
          const c = shape!.clumps[rng.int(shape!.clumps.length)];
          x = Math.round((c.x + 1) * W / 2 + (rng.random() - 0.5) * c.r * W * 0.6); y = Math.round((c.y + 1) * W / 2 + (rng.random() - 0.5) * c.r * W * 0.6);
          if (x < r * 0.6 || y < r * 0.6 || x > W - r * 0.6 || y > W - r * 0.6) continue;
        }
        // 3.6: in a natural galaxy, where the stars are (not in the void around it)
        if (game.shape && galaxyDensity(game, x, y) < 0.15) continue;
        const clearOfHomes = homes.every(h => Math.hypot(h.x - x, h.y - y) > r + (kind === 'storm' ? 40 : 70));
        const clearOfOthers = res.every(o => Math.hypot(o.x - x, o.y - y) > (o.r + r) * 0.8);
        if (!clearOfHomes || !clearOfOthers) continue;
        const t: Terrain = { id: res.length + 1, kind, x, y, r, name: names[kind][i % names[kind].length] + (i >= names[kind].length ? ` ${Math.floor(i / names[kind].length) + 1}` : '') };
        if (kind === 'storm') { const a = rng.random() * Math.PI * 2, v = 6 + rng.int(8); t.dx = Math.round(Math.cos(a) * v); t.dy = Math.round(Math.sin(a) * v); }
        res.push(t);
        break;
      }
    }
  }
  for (const t of res) {
    if (t.kind !== 'cluster') continue;
    for (const p of game.planets) {
      if (!inside(t, p) || p.homeworld) continue;
      p.conc.ironium = Math.min(140, p.conc.ironium + 25); p.conc.boranium = Math.min(140, p.conc.boranium + 25); p.conc.germanium = Math.min(140, p.conc.germanium + 25);
    }
  }
  return res;
}
