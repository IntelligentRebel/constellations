// 0.3.9.26: a whole galaxy from a name, after Ron's galaxy generator (Galaxy Generator 0.8.0.0, written with Claude):
// the name ("Galaxy1") goes through SHA-256 and a Mersenne Twister; the numbers that come out give the shape of the
// galaxy (spiral, elliptical, irregular, lenticular, ring), then each star its place, its spectral type and its
// planets and moons. Reproduced here number for number (Galaxy1 in Constellations is Galaxy1 in his generator), with
// one fix of 0.3.9.27: a spiral's star past the edge of the disc is drawn again instead of being put on the edge. The
// stars of a game are the first stars of the galaxy (those that have planets, at a playable distance from each other).
// Constellations keeps the abstraction of Stars!: a star of the map is a system summed up in one world; the planets
// and moons are only shown (the system view), never managed.

// (this file is left out of the translation: its strings are seeds, a translated one would make another galaxy)

// ------------------------------------------------------------------ SHA-256 (synchronous: the engine runs without a browser)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W64 = new Uint32Array(64);
export function sha256Hex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[len] = 0x80;
  const bits = len * 8;
  buf[total - 4] = (bits >>> 24) & 255; buf[total - 3] = (bits >>> 16) & 255; buf[total - 2] = (bits >>> 8) & 255; buf[total - 1] = bits & 255;
  buf[total - 5] = Math.floor(bits / 2 ** 32) & 255;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W64[i] = (buf[o + i * 4] << 24) | (buf[o + i * 4 + 1] << 16) | (buf[o + i * 4 + 2] << 8) | buf[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const a = W64[i - 15], b = W64[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W64[i] = (W64[i - 16] + s0 + W64[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W64[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

// ------------------------------------------------------------------ MT19937, as in the generator
class MT19937 {
  private mt = new Uint32Array(624); private index = 624;
  constructor(seed: number) {
    this.mt[0] = seed >>> 0;
    for (let i = 1; i < 624; i++) { const p = this.mt[i - 1]; this.mt[i] = (Math.imul(1812433253, p ^ (p >>> 30)) + i) >>> 0; }
  }
  private generate() {
    const N = 624, M = 397, A = 0x9908B0DF, U = 0x80000000, L = 0x7FFFFFFF;
    for (let i = 0; i < N; i++) { const y = (this.mt[i] & U) | (this.mt[(i + 1) % N] & L); this.mt[i] = this.mt[(i + M) % N] ^ (y >>> 1); if (y & 1) this.mt[i] ^= A; }
    this.index = 0;
  }
  nextRaw() {
    if (this.index >= 624) this.generate();
    let y = this.mt[this.index++];
    y ^= (y >>> 11); y ^= (y << 7) & 0x9D2C5680; y ^= (y << 15) & 0xEFC60000; y ^= (y >>> 18);
    return y >>> 0;
  }
  next(min: number, max: number) { return min + (this.nextRaw() % (max - min + 1)); }
}

/** Up to eight values in given ranges, from the hash of a name (the generator's procHash). */
function procHash(id: string, defs: [string, number, number][]): Record<string, number> {
  const h = sha256Hex(id);
  const r: Record<string, number> = {};
  defs.forEach(([name, min, max], i) => { r[name] = min + (parseInt(h.substr(i * 8, 8), 16) % (max - min + 1)); });
  return r;
}

// ------------------------------------------------------------------ galaxy, stars, planets, moons
/** A name for a new galaxy, as the generator names them (never translated: the name is the seed). */
export const galaxyName = (n: number) => 'Galaxy' + n;
export interface GalaxyParams { shapeType: number; numArms: number; windiness: number; orientation: number; eccentricity: number; coreSize: number; numStars: number; ringWidth: number }
export function galaxyParams(gid: string): GalaxyParams {
  const g = procHash(gid, [['shapeType', 0, 4], ['numArms', 2, 8], ['windiness', 30, 90], ['orientation', 0, 359], ['eccentricity', 10, 90], ['coreSize', 10, 40], ['numStars', 750, 2000], ['ringWidth', 10, 30]]) as unknown as GalaxyParams;
  if (g.shapeType === 0) g.numStars = Math.max(g.numStars, Math.min(g.numArms, 6) * 400);
  return g;
}

const PI = 3.14159265, PI2 = PI * 2;
export function starPosition(starId: string, g: GalaxyParams, gHash: string, even: boolean): { x: number; y: number; dist: number } | null {
  const sh = sha256Hex(starId);
  let seed = 0;
  for (let i = 0; i < 8; i++) { seed ^= parseInt(sh.substr(i * 8, 8), 16); seed ^= parseInt(gHash.substr(i * 8, 8), 16); }
  const rng = new MT19937(seed >>> 0);
  const rDist = rng.next(0, 9999) / 9999, rAngle = rng.next(0, 9999) / 9999, rArm = rng.next(0, 9999) / 9999, rScatter = rng.next(0, 9999) / 9999, rEccAdj = rng.next(0, 9999) / 9999;
  const st = g.shapeType, orient = g.orientation * PI / 180;
  let x: number, y: number;
  let dist = even ? Math.sqrt(rDist) : Math.pow(rDist, 1.2);
  if (st === 0) {
    dist = Math.abs(Math.sqrt(-2 * Math.log10(Math.max(0.000001, rDist))) * Math.cos(PI2 * rAngle)) / 1.2;
    if (even) { const linear = Math.sqrt(rDist) * 1.3, cr = g.coreSize / 100, blend = Math.min(1, dist / cr); dist = dist * (1 - blend) + linear * blend; }
    // (0.3.9.27: a star past the edge of the disc is drawn again, by the next attempt, as one too close to another; the
    // generator 0.8.0.0 put it on the edge, dist = Math.min(dist, 1.3), and since the winding grows with the distance,
    // those stars lined up in a short arc at the end of each arm)
    if (dist > 1.3) return null;
    const na = Math.min(g.numArms, 6), ab = (Math.floor(rArm * na) / na) * PI2, asp = PI2 / na;
    const sa = (asp * 0.25) - (dist * 0.1), cr = g.coreSize / 100, cb = Math.max(0, cr - dist) / cr;
    const aa = ab + ((rScatter - 0.5) * sa * 2) + orient, ra = rEccAdj * PI2;
    const bx = Math.cos(aa) * (1 - cb) + Math.cos(ra) * cb, by = Math.sin(aa) * (1 - cb) + Math.sin(ra) * cb;
    const ang = Math.atan2(by, bx);
    x = dist * Math.cos(ang); y = dist * Math.sin(ang);
    const sw = dist * g.windiness * PI / 180 * 4;
    const sx = x * Math.cos(sw) - y * Math.sin(sw), sy = x * Math.sin(sw) + y * Math.cos(sw);
    x = sx; y = sy; dist = Math.sqrt(x * x + y * y);
  } else if (st === 1 || st === 3) {
    const cp = 1 + (1 - (g.coreSize / 100) / 0.4) * 1.5;
    dist = even ? Math.sqrt(rDist) : Math.pow(rDist, cp);
    const a = rAngle * PI2 + orient;
    x = dist * Math.cos(a); y = dist * Math.sin(a) * (st === 1 ? 1 - g.eccentricity / 100 : 0.25);
  } else if (st === 2) {
    const a = rAngle * PI2;
    x = dist * Math.cos(a) + (rEccAdj - 0.5) * 0.2 * (1 - dist) * Math.cos(a + PI / 2);
    y = dist * Math.sin(a) + (rEccAdj - 0.5) * 0.2 * (1 - dist) * Math.sin(a + PI / 2);
  } else {
    const rw = g.ringWidth / 100, cr = g.coreSize / 100, inner = 0.5 - rw / 2, outer = 0.5 + rw / 2;
    const rd = rEccAdj < cr ? (even ? Math.sqrt(rDist) * cr : rDist * cr) : inner + rDist * (outer - inner);
    const a = rAngle * PI2 + orient;
    x = rd * Math.cos(a); y = rd * Math.sin(a); dist = rd;
  }
  return { x, y, dist };
}

export const SPECTRAL = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const;
export type Spectral = typeof SPECTRAL[number];
export const SPECTRAL_COLOR: Record<Spectral, string> = { O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff', G: '#fff4e8', K: '#ffaa44', M: '#ff4400' };
const SPECTRAL_TEMP: Record<Spectral, number> = { O: 40000, B: 20000, A: 8500, F: 6750, G: 5500, K: 4000, M: 3000 };
const SPECTRAL_CUM = (() => { const w = [1, 4, 10, 20, 30, 25, 60], t = w.reduce((a, b) => a + b, 0); let c = 0; return w.map(x => (c += x) / t); })();

export interface StarProps { type: Spectral; temperature: number; luminosity: number; mass: number; numPlanets: number; metallicity: number; hzInner: number; hzOuter: number }
export function starProps(starId: string): StarProps {
  const h = procHash(starId + '_props', [['spectralRaw', 0, 99], ['mass', 0, 99], ['numPlanets', 0, 12], ['metallicity', 0, 99]]);
  const r = h.spectralRaw / 100;
  let si = SPECTRAL.length - 1;
  for (let i = 0; i < SPECTRAL_CUM.length; i++) if (r < SPECTRAL_CUM[i]) { si = i; break; }
  const type = SPECTRAL[si], temperature = SPECTRAL_TEMP[type], luminosity = Math.pow(temperature / 5500, 4);
  return { type, temperature, luminosity, mass: h.mass, numPlanets: h.numPlanets, metallicity: h.metallicity, hzInner: Math.sqrt(luminosity / 1.1), hzOuter: Math.sqrt(luminosity / 0.53) };
}

export type SysPlanetType = 'Rocky' | 'Desert' | 'Ocean' | 'Gas Giant' | 'Ice Giant' | 'Frozen';
export interface SysPlanet { num: number; orbit: number; sizeRaw: number; eccentricity: number; type: SysPlanetType; inHz: boolean; numMoons: number }
function moonCount(type: SysPlanetType, sizeRaw: number, moonRaw: number) {
  if (type === 'Gas Giant') return 2 + Math.floor((moonRaw / 99) * 18);
  if (type === 'Ice Giant') return 1 + Math.floor((moonRaw / 99) * 11);
  if (type === 'Frozen') return Math.floor((moonRaw / 99) * 6);
  if (moonRaw > (99 - sizeRaw)) return moonRaw > 90 ? 2 : 1;
  return 0;
}
export function systemPlanets(starId: string, p: StarProps): SysPlanet[] {
  const out: SysPlanet[] = [];
  let orbit = Math.max(0.2, p.hzInner * 0.05);
  for (let i = 1; i <= p.numPlanets; i++) {
    const h = procHash(`${starId}_Planet${i}`, [['spacingRaw', 0, 99], ['sizeRaw', 1, 99], ['eccentricity', 0, 25]]);
    if (i > 1) orbit = Math.max(orbit * (1.2 + (h.spacingRaw / 99) * 0.6), orbit * 1.25);
    let type: SysPlanetType;
    if (orbit < p.hzInner * 0.5) type = h.sizeRaw > 60 ? 'Gas Giant' : 'Rocky';
    else if (orbit < p.hzInner) type = h.sizeRaw > 70 ? 'Gas Giant' : 'Desert';
    else if (orbit <= p.hzOuter) type = h.sizeRaw > 65 ? 'Gas Giant' : 'Ocean';
    else if (orbit < p.hzOuter * 3) type = h.sizeRaw > 50 ? 'Gas Giant' : 'Ice Giant';
    else type = h.sizeRaw > 60 ? 'Ice Giant' : 'Frozen';
    const mh = procHash(`${starId}_Planet${i}_moons`, [['moonRaw', 0, 99], ['spare', 0, 99]]);
    out.push({ num: i, orbit, sizeRaw: h.sizeRaw, eccentricity: h.eccentricity, type, inHz: orbit >= p.hzInner && orbit <= p.hzOuter, numMoons: moonCount(type, h.sizeRaw, mh.moonRaw) });
  }
  return out;
}
export interface SysMoon { num: number; orbit: number; sizeRaw: number; type: 'Rocky' | 'Icy' | 'Captured' }
export function planetMoons(starId: string, pl: SysPlanet): SysMoon[] {
  const out: SysMoon[] = [];
  let orbit = (0.001 + (pl.sizeRaw / 99) * 0.004) * 3;
  for (let i = 1; i <= pl.numMoons; i++) {
    const h = procHash(`${starId}_Planet${pl.num}_Moon${i}`, [['sizeRaw', 1, 80], ['typeRaw', 0, 99], ['spacingRaw', 0, 99]]);
    if (i > 1) orbit *= 1.4 + (h.spacingRaw / 99) * 0.6;
    out.push({ num: i, orbit, sizeRaw: h.sizeRaw, type: h.typeRaw < 60 ? 'Rocky' : h.typeRaw < 85 ? 'Icy' : 'Captured' });
  }
  return out;
}

/** The generator's name of a star (its seed). */
export const starIdOf = (gid: string, n: number, attempt: number) => `${gid}_Star${n}_attempt${attempt}`;

// ------------------------------------------------------------------ the stars of a game
export interface GameStar { x: number; y: number; n: number; a: number; t: Spectral }
/**
 * The first `count` stars of the galaxy that have planets, at least `spacing` apart once on a map `W` wide (the
 * generator places its stars one after the other, each against those before: its first stars are always the same).
 * Past the generator's own count of stars, the same formula goes on (those stars are not in his generator).
 */
export function galaxyStars(gid: string, even: boolean, count: number, W: number, spacing = 14, border = 20): GameStar[] {
  const g = galaxyParams(gid), gHash = sha256Hex(gid);
  const placed: { x: number; y: number; n: number; a: number }[] = [];
  const place = (n: number) => {
    for (let a = 1; a <= 13; a++) {
      const c = starPosition(starIdOf(gid, n, a), g, gHash, even);
      if (!c) continue;
      let tooClose = false;
      const lim = 0.01 * (0.01 + c.dist * 0.99);
      for (const e of placed) { const dx = c.x - e.x, dy = c.y - e.y; if (dx * dx + dy * dy < lim * lim) { tooClose = true; break; } }
      if (!tooClose) { placed.push({ x: c.x, y: c.y, n, a }); return; }
    }
  };
  for (let n = 1; n <= g.numStars; n++) place(n);
  // the map frames the generator's whole galaxy
  let ext = 0;
  for (const s of placed) ext = Math.max(ext, Math.abs(s.x), Math.abs(s.y));
  ext = ext || 1;
  const R = W / 2, k = (R - border) / ext;
  const out: GameStar[] = [];
  const cell = spacing, grid = new Map<number, GameStar[]>();
  const key = (cx: number, cy: number) => cx * 4096 + cy;
  const take = (s: { x: number; y: number; n: number; a: number }) => {
    const x = Math.round(R + s.x * k), y = Math.round(R + s.y * k);
    if (x < border || y < border || x > W - border || y > W - border) return;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of grid.get(key(cx + i, cy + j)) ?? []) if (Math.hypot(q.x - x, q.y - y) < spacing) return;
    const id = starIdOf(gid, s.n, s.a), p = starProps(id);
    if (p.numPlanets < 1) return;
    const st: GameStar = { x, y, n: s.n, a: s.a, t: p.type };
    out.push(st);
    const kk = key(cx, cy); grid.set(kk, [...(grid.get(kk) ?? []), st]);
  };
  for (const s of placed) { if (out.length >= count) break; take(s); }
  for (let n = g.numStars + 1; out.length < count && n <= g.numStars * 4; n++) {
    const before = placed.length;
    place(n);
    if (placed.length > before) take(placed[placed.length - 1]);
  }
  return out;
}

/** A coarse map of where the stars are (0 to 1), for the glow behind them and to place what wanders (wormholes...). */
export function densityGrid(stars: { x: number; y: number }[], W: number, N = 40): number[] {
  const raw = new Float64Array(N * N), cellW = W / N;
  for (const s of stars) {
    const cx = s.x / cellW - 0.5, cy = s.y / cellW - 0.5;
    for (let i = Math.max(0, Math.floor(cx - 4)); i <= Math.min(N - 1, Math.ceil(cx + 4)); i++)
      for (let j = Math.max(0, Math.floor(cy - 4)); j <= Math.min(N - 1, Math.ceil(cy + 4)); j++)
        raw[j * N + i] += Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / 5);
  }
  // scaled on the dense parts but not on the very core alone (the arms keep a visible density)
  const vals = [...raw].filter(v => v > 0).sort((a, b) => a - b);
  const top = vals[Math.floor(vals.length * 0.85)] || 1;
  return [...raw].map(v => Math.round(Math.min(1, v / top) * 100) / 100);
}
