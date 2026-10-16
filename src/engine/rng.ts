// Deterministic, serialisable PRNG (sfc32). The state lives inside the game save.

export type RngState = [number, number, number, number];

export function seedFromString(seed: string): RngState {
  // xmur3 hash → 4 seeds
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  const s: RngState = [next(), next(), next(), next()];
  const r = new Rng(s);
  for (let i = 0; i < 15; i++) r.next();
  return s;
}

export class Rng {
  constructor(public s: RngState) {}
  /** uint32 */
  next(): number {
    const s = this.s;
    let a = s[0] >>> 0, b = s[1] >>> 0, c = s[2] >>> 0, d = s[3] >>> 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    s[0] = a >>> 0; s[1] = b >>> 0; s[2] = c >>> 0; s[3] = d >>> 0;
    return t;
  }
  /** float in [0,1) */
  random(): number { return this.next() / 4294967296; }
  /** integer in [0,n) */
  int(n: number): number { return n <= 0 ? 0 : Math.floor(this.random() * n); }
  /** integer in [a,b] inclusive */
  range(a: number, b: number): number { return a + this.int(b - a + 1); }
  chance(p: number): boolean { return this.random() < p; }
  pick<T>(arr: T[]): T { return arr[this.int(arr.length)]; }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) { const j = this.int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  /** approx normal sample */
  normal(mean: number, sd: number): number {
    let u = 0, v = 0;
    while (u === 0) u = this.random();
    while (v === 0) v = this.random();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
