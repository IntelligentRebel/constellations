// Constellations 3.6: the region of space a game takes place in. A map spans a few hundred to two thousand
// light-years: at that scale one does not see a galaxy (the Milky Way is a hundred thousand light-years across) but a
// piece of one, as around the Sun: a stretch of spiral arm whose stars thin out into the gap between the arms, young
// stellar associations, superbubbles blown by old supernovae, and dark molecular clouds, impassable at Warp speeds,
// that close the map. Planets are drawn with the odds given by a density map (0 to 1), the same map the scanner paints
// as a faint glow behind the stars.
import type { DarkCloud, GalaxyShape, GameState, ShapeParams } from './types';
import { Rng, seedFromString } from './rng';

/** A region of a galaxy (0.3.6.3), rather than a whole galaxy (0.3.5.8)? */
export const isRegion = (k: GalaxyShape) => k === 'arm' || k === 'nursery' || k === 'bubble';

/** The regions a new game can be set in (the whole galaxies of 0.3.5.8 are no longer offered). */
export const SHAPES_OFFERED: GalaxyShape[] = ['arm', 'nursery', 'bubble', 'square'];
export const SHAPE_LABELS: Record<GalaxyShape, string> = {
  arm: 'Bras spiral',
  nursery: 'Pouponnière d\'étoiles',
  bubble: 'Superbulle',
  square: 'Carrée (Stars! d\'origine)',
  spiral: 'Galaxie spirale',
  elliptical: 'Galaxie elliptique',
  irregular: 'Galaxie irrégulière',
};
export const SHAPE_TEXT: Record<GalaxyShape, string> = {
  arm: 'Un secteur de bras spiral, comme le voisinage du Soleil (un bras fait des milliers d\'années-lumière de large : la carte en montre un bord) : des étoiles denses d\'un côté, plus rares vers le vide entre les bras, des associations d\'étoiles jeunes, des superbulles soufflées par d\'anciennes supernovae, la bande de poussière du bras coupée de quelques passages et un ou deux grands nuages sombres, infranchissables. Les nuages couvrent quelques pour cent de la carte, comme autour du Soleil.',
  nursery: 'Un complexe de nuages moléculaires où naissent les étoiles, comme Orion ou le Cygne : amas jeunes et serrés, nébuleuses brillantes, couloirs entre des nuages sombres infranchissables qui ferment la carte. Des passages obligés à tenir.',
  bubble: 'Une cavité de plusieurs centaines d\'années-lumière soufflée par des supernovae, comme la bulle locale où se trouve le Soleil : moins d\'étoiles au centre, un anneau d\'étoiles nées dans sa coquille, et sur la coquille, des arcs de nuages sombres que l\'onde de choc a balayés.',
  square: 'Les planètes réparties uniformément dans un carré, comme dans Stars!.',
  spiral: 'Un noyau dense et deux à quatre bras, séparés par des vides où les étoiles se font rares.',
  elliptical: 'Un disque ovale, plus dense au centre, au bord irrégulier.',
  irregular: 'Quelques nuages d\'étoiles de tailles inégales, reliés par des ponts plus clairsemés.',
};

/** Names of the dark clouds: they kill whoever tries to cross them. */
const CLOUD_NAMES = ['le Linceul', 'la Gueule de Charbon', 'le Sac à Charbon', 'l\'Abîme de Tantale', 'le Voile des Noyés', 'la Mâchoire Noire', 'le Mur des Silences', 'les Cendres d\'Érèbe', 'la Nuit sans Retour', 'le Gouffre de Sel', 'la Tombe des Pilotes', 'l\'Ombre de Charon', 'la Forge Éteinte', 'le Grand Suaire', 'le Puits des Veuves', 'la Muraille de Suie', 'les Dents du Néant', 'le Cimetière de Kaeth'];

/** The shape of a new game (its own random stream: the rest of the universe does not depend on it). */
export function makeShape(seed: string, kind: GalaxyShape, width = 1200): ShapeParams | undefined {
  if (kind === 'square') return undefined;
  const rng = new Rng(seedFromString(seed + '|shape'));
  const p: ShapeParams = { kind, seed: rng.int(1_000_000_000), rot: rng.random() * Math.PI * 2, arms: 2 + rng.int(3), twist: 3.2 + rng.random() * 1.8, flat: 0.62 + rng.random() * 0.2, blobs: [] };
  if (kind === 'irregular') {
    const n = 3 + rng.int(3);
    for (let i = 0; i < n; i++) {
      const a = rng.random() * Math.PI * 2, d = i === 0 ? rng.random() * 0.2 : 0.25 + rng.random() * 0.35;
      p.blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: i === 0 ? 0.38 + rng.random() * 0.12 : 0.18 + rng.random() * 0.17 });
    }
  }
  // a cloud, an association, a bubble has a size in light-years: on the biggest maps they are relatively smaller, and
  // more of them (on the small ones they keep their share, or nothing would be left of the map)
  if (kind === 'arm' || kind === 'nursery' || kind === 'bubble') regionFeatures(rng, p, Math.min(1, Math.sqrt(1200 / width)), width);
  return p;
}

const rand = (rng: Rng, a: number, b: number) => a + rng.random() * (b - a);

/** The name of a dark cloud, in the player's language. */
export const cloudName = (w: DarkCloud) => (w.ni !== undefined ? CLOUD_NAMES[w.ni] : undefined) ?? w.name;

/** A dark cloud: a main lobe and a few smaller ones around it, an irregular mass. */
function cloud(rng: Rng, ni: number, x: number, y: number, r: number, extra: number): DarkCloud {
  const lobes = [{ x, y, r }];
  for (let i = 0; i < extra; i++) {
    const a = rng.random() * Math.PI * 2, d = r * rand(rng, 0.5, 1.1), rr = r * rand(rng, 0.25, 0.6);
    lobes.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: rr });
    // and smaller ones on the smaller ones: bays, capes, wisps
    if (rng.random() < 0.6) { const b = a + rand(rng, -1.2, 1.2), e = rr * rand(rng, 0.8, 1.3); lobes.push({ x: x + Math.cos(a) * d + Math.cos(b) * e, y: y + Math.sin(a) * d + Math.sin(b) * e, r: rr * rand(rng, 0.3, 0.55) }); }
  }
  return { name: CLOUD_NAMES[ni], ni, lobes };
}

/** A point on the border of the map, pushed a little outwards: where the clouds that close a nursery sit. */
function borderPoint(rng: Rng, t: number): { x: number; y: number } {
  const side = Math.floor(t * 4) % 4, f = (t * 4) % 1 * 2 - 1, out = rand(rng, 1.0, 1.15);
  return side === 0 ? { x: f, y: -out } : side === 1 ? { x: out, y: f } : side === 2 ? { x: -f, y: out } : { x: -out, y: -f };
}

/**
 * The features of a region. Around the Sun, molecular clouds cover a few per cent of a map seen from above (about
 * 1 % of the volume of the disc; 1 to 2 solar masses of molecular gas per square parsec against 50 to 100 inside a
 * cloud): an arm gets its dust lane and one or two big clouds, a superbubble the clouds its shock wave pushed onto its
 * shell (as Taurus, Ophiuchus or Lupus sit on the wall of the Local Bubble), and only a star-forming complex (Orion,
 * Cygnus) is full of them, closed by them.
 */
function regionFeatures(rng: Rng, p: ShapeParams, k: number, width: number) {
  const more = (n: number) => Math.round(n / (k * k));
  // 0.3.6.8: a narrow pass through a cloud, a few dozen light-years wide (never narrower than the grid the routes are
  // planned on can see: three of its cells)
  const cell = Math.max(5, Math.min(12, width / 160));
  const pass = (cx: number, cy: number, ang: number, half: number) => {
    const wLy = Math.max(1.6 * cell, rand(rng, 8, 15)), dx = Math.cos(ang) * half, dy = Math.sin(ang) * half;
    (p.passes ??= []).push({ x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, w: wLy / (width / 2) });
  };
  const carveCloud = (chance: number) => {
    const w = p.walls![p.walls!.length - 1], m = w.lobes[0];
    if (rng.random() < chance) pass(m.x, m.y, rng.random() * Math.PI, m.r * 3.2);
  };
  const names = rng.shuffle(CLOUD_NAMES.map((_, i) => i));
  let ni = 0;
  const next = () => names[ni++ % names.length];
  p.walls = []; p.clumps = []; p.voids = [];
  if (p.kind === 'arm') {
    // an arm is some three thousand light-years wide: the map straddles its edge, dense on one side, thinning out
    // towards the gap between the arms on the other
    const side = rng.random() < 0.5 ? -1 : 1;
    p.arm = { angle: rng.random() * Math.PI, offset: side * rand(rng, 0.2, 0.5), curve: rand(rng, -0.18, 0.18), width: rand(rng, 0.55, 0.8) };
    for (let i = 0, n = more(3 + rng.int(3)); i < n; i++) { const q = alongArm(rng, p, 0.6); p.clumps.push({ ...q, r: rand(rng, 0.06, 0.11) * k, a: rand(rng, 0.5, 0.9) }); }
    for (let i = 0, n = 1 + rng.int(2); i < n; i++) { const q = alongArm(rng, p, 0.5); p.voids.push({ ...q, r: rand(rng, 0.16, 0.24) * k }); }
    dustLane(rng, p, next, k, pass);
    // one or two giant molecular clouds: passages to fight over
    for (let i = 0, n = more(1 + rng.int(2)); i < n; i++) { inner(rng, p, next, 0.75, 0.085 * k, 0.13 * k, 2, 3); carveCloud(0.75); }
  } else if (p.kind === 'nursery') {
    // a star-forming complex: the clouds close the map, not all sides closed, and cut it into corridors
    const edge = Math.round((3 + rng.int(2)) / k), start = rng.random();
    for (let i = 0; i < edge; i++) {
      const b = borderPoint(rng, (start + (i + rand(rng, -0.25, 0.25)) / edge) % 1);
      p.walls.push(cloud(rng, next(), b.x, b.y, rand(rng, 0.2, 0.32) * k, 4 + rng.int(4)));
    }
    for (let i = 0, n = more(6 + rng.int(4)); i < n; i++) p.clumps.push({ x: rand(rng, -0.8, 0.8), y: rand(rng, -0.8, 0.8), r: rand(rng, 0.05, 0.09) * k, a: rand(rng, 0.6, 1.0) });
    for (let i = 0, n = more(4 + rng.int(3)); i < n; i++) { inner(rng, p, next, 0.65, 0.08 * k, 0.14 * k, 2, 4); carveCloud(0.6); }
  } else {
    const c = { x: rand(rng, -0.15, 0.15), y: rand(rng, -0.15, 0.15), r: rand(rng, 0.38, 0.48) };
    p.voids.push(c);
    for (let i = 0, n = more(3 + rng.int(3)); i < n; i++) { const a = rng.random() * Math.PI * 2; p.clumps.push({ x: c.x + Math.cos(a) * c.r, y: c.y + Math.sin(a) * c.r, r: rand(rng, 0.06, 0.1) * k, a: rand(rng, 0.5, 0.9) }); }
    shellClouds(rng, p, c, next, k);
  }
}

/**
 * The clouds on the shell of a superbubble: arcs of dust the shock wave swept up, with gaps between them (the bubble
 * stays open on its sides).
 */
function shellClouds(rng: Rng, p: ShapeParams, c: { x: number; y: number; r: number }, next: () => number, k: number) {
  const n = Math.max(3, Math.round((3 + rng.int(3)) / k));
  let a = rng.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const span = rand(rng, 0.25, 0.5) * k, lobes: DarkCloud['lobes'] = [];
    for (let t = 0; t <= span; t += rand(rng, 0.07, 0.11)) {
      const ang = a + t, d = c.r * rand(rng, 1.03, 1.14);
      lobes.push({ x: c.x + Math.cos(ang) * d, y: c.y + Math.sin(ang) * d, r: rand(rng, 0.035, 0.065) * k });
      if (rng.random() < 0.4) { const e = c.r * rand(rng, 1.12, 1.22); lobes.push({ x: c.x + Math.cos(ang) * e, y: c.y + Math.sin(ang) * e, r: rand(rng, 0.02, 0.04) * k }); }
    }
    const ni = next();
    if (lobes.some(l => Math.abs(l.x) < 1.02 && Math.abs(l.y) < 1.02)) p.walls!.push({ name: CLOUD_NAMES[ni], ni, lobes });
    a += span + (Math.PI * 2 - span * n) / n * rand(rng, 0.6, 1.3);
  }
}

/** A cloud inside the map, apart from the others (two clouds that touch would read as one with two names). */
function inner(rng: Rng, p: ShapeParams, next: () => number, span: number, r0: number, r1: number, e0: number, e1: number) {
  let best: DarkCloud | null = null, bestGap = -Infinity;
  for (let k = 0; k < 24; k++) {
    const c = cloud(rng, -1, rand(rng, -span, span), rand(rng, -span, span), rand(rng, r0, r1), e0 + rng.int(e1));
    const m = c.lobes[0];
    let gap = Infinity;
    for (const w of p.walls!) for (const l of w.lobes) gap = Math.min(gap, Math.hypot(l.x - m.x, l.y - m.y) - (l.r + m.r) * 1.6);
    if (gap > bestGap) { bestGap = gap; best = c; }
    if (gap > 0) break;
  }
  const ni = next();
  p.walls!.push({ ...best!, name: CLOUD_NAMES[ni], ni });
}

/**
 * The dust lane of the arm: on its inner (concave) edge, where the gas is compressed before it forms stars, a chain of
 * dark clouds runs along the arm, broken by a few passes. A natural frontier, with its gates.
 */
function dustLane(rng: Rng, p: ShapeParams, next: () => number, k: number, pass: (cx: number, cy: number, ang: number, half: number) => void) {
  const a = p.arm!, dx = Math.cos(a.angle), dy = Math.sin(a.angle), nx = -dy, ny = dx;
  const s = a.curve > 0.03 ? 1 : a.curve < -0.03 ? -1 : -Math.sign(a.offset) || 1;
  const n0 = s * a.width * rand(rng, 0.7, 0.85);
  // the lane wanders a little around its line
  const k1 = rand(rng, 2, 4), ph = rng.random() * 6.28, amp = rand(rng, 0.03, 0.07);
  const at = (t: number) => { const d = a.offset + a.curve * t * t + n0 + amp * Math.sin(k1 * t + ph); return { x: dx * t + nx * d, y: dy * t + ny * d }; };
  // segments separated by passes, from one side of the map to the other
  let t = rand(rng, -1.5, -1.25);
  while (t < 1.4) {
    const len = rand(rng, 0.35, 0.7);
    const ni = next();
    const lobes: DarkCloud['lobes'] = [];
    for (let u = t; u < t + len; u += rand(rng, 0.05, 0.08) * k) {
      // thinner at the ends of a segment: it frays out into the passes
      const f = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - t) / len))) * 0.45 + 0.55;
      const q = at(u), r = rand(rng, 0.032, 0.066) * f * k;
      lobes.push({ x: q.x + nx * rand(rng, -0.03, 0.03) * k, y: q.y + ny * rand(rng, -0.03, 0.03) * k, r });
      // filaments on either side: the lane is not a rope
      if (rng.random() < 0.45) { const o = rand(rng, 0.04, 0.1) * k * (rng.random() < 0.65 ? s : -s); lobes.push({ x: q.x + nx * o + dx * rand(rng, -0.03, 0.03) * k, y: q.y + ny * o + dy * rand(rng, -0.03, 0.03) * k, r: r * rand(rng, 0.35, 0.7) }); }
    }
    if (lobes.some(l => Math.abs(l.x) < 1.05 && Math.abs(l.y) < 1.05)) {
      p.walls!.push({ name: CLOUD_NAMES[ni], ni, lobes });
      // a long segment gets a narrow pass across it (0.3.6.8)
      if (len > 0.42 && rng.random() < 0.65) { const q = at(t + len * rand(rng, 0.35, 0.65)); pass(q.x, q.y, Math.atan2(ny, nx) + rand(rng, -0.35, 0.35), 0.22 * k); }
    }
    t += len + rand(rng, 0.2, 0.32);
  }
}

/** A random point near the centre line of the arm (spread: share of its half-width). */
function alongArm(rng: Rng, p: ShapeParams, spread: number): { x: number; y: number } {
  const a = p.arm!, dx = Math.cos(a.angle), dy = Math.sin(a.angle), nx = -dy, ny = dx;
  const t = rand(rng, -0.7, 0.7), d = a.offset + a.curve * t * t + rand(rng, -1, 1) * a.width * spread;
  return { x: dx * t + nx * d, y: dy * t + ny * d };
}

// value noise: smooth, deterministic, cheap
function hash(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(seed, ix, iy), b = hash(seed, ix + 1, iy), c = hash(seed, ix, iy + 1), d = hash(seed, ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** two octaves, 0..1 */
export const fbm = (seed: number, x: number, y: number) => noise(seed, x, y) * 0.65 + noise(seed + 7, x * 2.3, y * 2.3) * 0.35;
/** four octaves, 0..1: the frayed edges of the dust */
const fbm4 = (seed: number, x: number, y: number) => noise(seed, x, y) * 0.45
  // each octave turned a little: value noise left square would draw stairs along the axes
  + noise(seed + 7, (x * 0.8 - y * 0.6) * 2.1, (x * 0.6 + y * 0.8) * 2.1) * 0.29
  + noise(seed + 13, (x * 0.28 + y * 0.96) * 4.3, (-x * 0.96 + y * 0.28) * 4.3) * 0.17
  + noise(seed + 19, (x * 0.6 - y * 0.8) * 8.7, (x * 0.8 + y * 0.6) * 8.7) * 0.09;
const step = (a: number, b: number, x: number) => x <= a ? 0 : x >= b ? 1 : smooth((x - a) / (b - a));

/** A lobe of dark cloud with the index of its cloud. */
export interface Lobe { wi: number; x: number; y: number; r: number }
const LN2 = Math.LN2;
/** How much a pass takes away from the clouds' field at its axis (enough to open the densest of them). */
const PASS = 4;
const lobeCache = new WeakMap<ShapeParams, Lobe[]>();
/** Every lobe of every cloud of a region, in one list. */
export function lobesOf(p: ShapeParams): Lobe[] {
  let l = lobeCache.get(p);
  if (!l) { l = (p.walls ?? []).flatMap((w, wi) => w.lobes.map(q => ({ wi, ...q }))); lobeCache.set(p, l); }
  return l;
}

/** How far the space is warped around the clouds (map units, at most half of it each way): their shapes are torn. */
const WARP = 0.22;
/** Margin to add around a lobe to be sure to catch every point it touches. */
export const LOBE_MARGIN = WARP / 2 + 0.035;

export interface CloudSample {
  /** above 0 inside (impassable), below 0 outside */
  depth: number;
  /** distance to the edge in map units (an estimate): positive inside */
  edge: number;
  /** the cloud the point belongs to (or is nearest to), -1 when none is near */
  wi: number;
  /** the same distance without the ragged edge (smooth: for the shadow around a cloud) */
  soft: number;
}

/** Where a map point falls in the space the lobes and passes are drawn in (the warp that tears the clouds' shapes). */
export function warpOf(p: ShapeParams, u: number, v: number): { u: number; v: number } {
  return {
    u: u + WARP * (fbm(p.seed + 111, u * 2.6 + 1, v * 2.6 + 2) - 0.5) + 0.07 * (fbm(p.seed + 115, u * 7 + 3, v * 7 + 1) - 0.5),
    v: v + WARP * (fbm(p.seed + 113, u * 2.6 + 5, v * 2.6 + 6) - 0.5) + 0.07 * (fbm(p.seed + 117, u * 7 + 8, v * 7 + 4) - 0.5),
  };
}
/** The map point that the warp sends to (u, v) (a few steps of fixed point: the warp is gentle). */
export function unwarp(p: ShapeParams, u: number, v: number): { u: number; v: number } {
  let x = u, y = v;
  for (let i = 0; i < 8; i++) { const w = warpOf(p, x, y); x += u - w.u; y += v - w.v; }
  return { u: x, v: y };
}

/**
 * The dark clouds as one field: each lobe a soft blob, the blobs adding up (two lobes side by side melt into one
 * filament rather than a string of beads), the edge where the field crosses a ragged threshold. Map units [-1, 1].
 * `lobes` restricts the sum to those near the point (the map's painter sorts them by tile).
 */
export function cloudAt(p: ShapeParams, u: number, v: number, lobes: Lobe[] = lobesOf(p)): CloudSample {
  if (!lobes.length) return { depth: -1, edge: -1, wi: -1, soft: -1 };
  // the edge is never smooth: the space is warped a little, then the threshold wavers
  const { u: wu, v: wv } = warpOf(p, u, v);
  let F = 0, gx = 0, gy = 0, top = 0, wi = -1;
  for (const l of lobes) {
    const dx = wu - l.x, dy = wv - l.y, m = l.r * 2.3;
    if (dx > m || dx < -m || dy > m || dy < -m) continue;
    const q = (dx * dx + dy * dy) / (l.r * l.r);
    if (q > 5.3) continue;
    const f = Math.exp(-LN2 * q);
    F += f;
    const k = -2 * LN2 * f / (l.r * l.r);
    gx += k * dx; gy += k * dy;
    if (f > top) { top = f; wi = l.wi; }
  }
  if (wi < 0) return { depth: -1, edge: -1, wi: -1, soft: -1 };
  // 0.3.6.8: the narrow passes carved through the clouds
  for (const c of p.passes ?? []) {
    const vx = c.x2 - c.x1, vy = c.y2 - c.y1;
    const t = Math.max(0, Math.min(1, ((wu - c.x1) * vx + (wv - c.y1) * vy) / (vx * vx + vy * vy || 1)));
    const dx = wu - (c.x1 + t * vx), dy = wv - (c.y1 + t * vy), q = (dx * dx + dy * dy) / (c.w * c.w);
    if (q > 8) continue;
    const f = PASS * Math.exp(-LN2 * q);
    F -= f;
    const k = 2 * LN2 * f / (c.w * c.w);
    gx += k * dx; gy += k * dy;
  }
  const T = 0.5 * (1 + 1.1 * (fbm4(p.seed + 101, u * 8 + 3, v * 8 + 3) - 0.5));
  const depth = F - T, g = Math.hypot(gx, gy);
  return { depth, edge: depth / Math.max(g, 0.5), wi, soft: (F - 0.5) / Math.max(g, 1.5) };
}

/** How deep a point is in a dark cloud: above 0 inside (impassable), below 0 outside. */
export const cloudDepth = (p: ShapeParams, u: number, v: number) => cloudAt(p, u, v).depth;

/** Density of stars at a point (0 empty, 1 densest); u, v in [-1, 1] from the centre of the map. */
export function densityAt(p: ShapeParams, u: number, v: number): number {
  const r0 = Math.hypot(u, v);
  // the edge: ragged, never a straight line
  const edge = 0.16 * (fbm(p.seed + 3, u * 2.2 + 5, v * 2.2 + 5) - 0.5);
  const tex = 0.7 + 0.6 * fbm(p.seed + 11, u * 6 + 9, v * 6 + 9);
  if (p.kind === 'arm' || p.kind === 'nursery' || p.kind === 'bubble') {
    // no star in a dark cloud, nor right at its edge
    const depth = cloudDepth(p, u, v);
    if (depth > -0.12) return 0;
    // and fewer of them as one gets closer (no hard line around the clouds)
    const near = 1 - step(-0.32, -0.12, depth);
    let d: number;
    if (p.kind === 'arm') {
      const a = p.arm!, dx = Math.cos(a.angle), dy = Math.sin(a.angle);
      const t = u * dx + v * dy, n = -u * dy + v * dx - a.offset - a.curve * t * t;
      d = 0.16 + 0.84 * Math.exp(-((n / a.width) ** 2));
    } else if (p.kind === 'nursery') d = 0.3 + 0.25 * fbm(p.seed + 31, u * 3 + 1, v * 3 + 1);
    else d = 0.3;
    for (const c of p.clumps ?? []) d += c.a * Math.exp(-((Math.hypot(u - c.x, v - c.y) / c.r) ** 2));
    for (let k = 0; k < (p.voids?.length ?? 0); k++) {
      const b = p.voids![k];
      // never a circle: the supernovae blew it unevenly
      const dist = Math.hypot(u - b.x, v - b.y) / (1 + 0.8 * (fbm(p.seed + 41 + k, u * 2.6 + 7, v * 2.6 + 7) - 0.5));
      // a cavity swept clean of gas (old stars still cross it, fewer of them), and its shell, where the shock made new ones
      d = d * (0.3 + 0.7 * step(b.r * 0.6, b.r, dist)) + 0.55 * Math.exp(-(((dist - b.r) / (b.r * 0.18)) ** 2));
    }
    return clamp01(d * tex * near);
  }
  if (p.kind === 'spiral') {
    // slightly tilted disc
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const x = u * c + v * s, y = (-u * s + v * c) / p.flat * 0.85;
    const r = Math.hypot(x, y);
    const theta = Math.atan2(y, x);
    const core = Math.exp(-((r / 0.2) ** 2));
    let arm = 0;
    for (let k = 0; k < p.arms; k++) {
      const phi = (2 * Math.PI * k) / p.arms + p.twist * r;
      let d = theta - phi;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const width = 0.1 + 0.08 * r;
      arm = Math.max(arm, Math.exp(-(((d * Math.max(r, 0.12)) / width) ** 2) / 2));
    }
    const disc = 1 - step(0.72, 1.0, r + edge);
    return clamp01(disc * Math.max(core, 0.14 + 0.86 * arm) * tex);
  }
  if (p.kind === 'elliptical') {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const x = u * c + v * s, y = (-u * s + v * c) / p.flat;
    const q = Math.hypot(x, y) + edge * 1.4;
    const body = 1 - step(0.5, 0.97, q);
    return clamp01(body * (0.45 + 0.55 * Math.exp(-((q / 0.4) ** 2))) * tex);
  }
  // irregular: lobes of unequal size, a ragged outline, bridges between them
  let m = 0;
  for (const b of p.blobs) m = Math.max(m, Math.exp(-((Math.hypot(u - b.x, v - b.y) / b.r) ** 2)));
  const lumpy = m * (0.55 + 0.9 * fbm(p.seed + 21, u * 3.4 + 2, v * 3.4 + 2));
  const frame = 1 - step(0.82, 1.0, r0 + edge);
  return clamp01(step(0.12, 0.75, lumpy) * frame * tex);
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Share of the map where stars are not rare (density 0.15 and more). */
export function coverage(p: ShapeParams): number {
  let n = 0;
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) if (densityAt(p, (i + 0.5) / 20 - 1, (j + 0.5) / 20 - 1) >= 0.15) n++;
  return Math.max(0.15, n / 1600);
}

/** Star density at a map point (1 everywhere in a square galaxy). */
export function galaxyDensity(game: Pick<GameState, 'shape' | 'width' | 'height'>, x: number, y: number): number {
  if (!game.shape) return 1;
  const R = game.width / 2;
  return densityAt(game.shape, (x - R) / R, (y - game.height / 2) / R);
}

/** A random point inside the galaxy (where the density is at least `min`), for wormholes and other wanderers. */
export function pointInGalaxy(game: Pick<GameState, 'shape' | 'width' | 'height'>, rng: Rng, margin = 20, min = 0.15): { x: number; y: number } {
  const W = game.width, H = game.height;
  for (let t = 0; t < 400; t++) {
    const x = margin + rng.int(W - 2 * margin), y = margin + rng.int(H - 2 * margin);
    if (!game.shape || galaxyDensity(game, x, y) >= min) return { x, y };
  }
  return { x: W / 2, y: H / 2 };
}
