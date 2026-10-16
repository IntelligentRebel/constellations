// 3.6: the dark clouds as the map paints them: opaque dust, a rim lit by the nearby stars, a shadow around them, and
// where to write their names. Pure computation (no canvas), so that it can be measured outside the browser.
import type { GameState } from '../engine/types';
import { cloudAt, cloudName, fbm, lobesOf, LOBE_MARGIN, type Lobe } from '../engine/shape';

export interface CloudRaster { n: number; data: Uint8ClampedArray; labels: { x: number; y: number; name: string; size: number }[] }

const REACH = 26; // light-years of shadow around a cloud
const rimLight = (seed: number, u: number, v: number) => { const x = fbm(seed + 301, u * 3.2 + 4, v * 3.2 + 4); return x <= 0.3 ? 0.15 : x >= 0.7 ? 1 : 0.15 + 0.85 * (x - 0.3) / 0.4; };

/** The whole picture at once (tests, measures). */
export function cloudRaster(game: Pick<GameState, 'shape' | 'width' | 'height'>, n: number): CloudRaster | null {
  return cloudJob(game, n)?.step(Infinity) ?? null;
}

/**
 * The picture painted a few rows at a time: `step(ms)` works for about that long and gives the result once done (the
 * map shows up at once, its clouds a moment later, rather than the page freezing for half a second).
 */
export function cloudJob(game: Pick<GameState, 'shape' | 'width' | 'height'>, n: number): { step: (ms: number) => CloudRaster | null } | null {
  const p = game.shape;
  if (!p?.walls?.length) return null;
  const R = game.width / 2, reach = REACH / R;
  const data = new Uint8ClampedArray(n * n * 4);
  // the lobes near each tile of the picture: a pixel only looks at those
  const T = 32, tiles: Lobe[][] = Array.from({ length: T * T }, () => []);
  for (const l of lobesOf(p)) {
    const m = l.r * 2.3 + reach + LOBE_MARGIN;
    const i0 = Math.max(0, Math.floor((l.x - m + 1) / 2 * T)), i1 = Math.min(T - 1, Math.floor((l.x + m + 1) / 2 * T));
    const j0 = Math.max(0, Math.floor((l.y - m + 1) / 2 * T)), j1 = Math.min(T - 1, Math.floor((l.y + m + 1) / 2 * T));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) tiles[j * T + i].push(l);
  }
  const lyPx = game.width / n, margin = game.width * 0.06;
  const best = p.walls.map(() => ({ e: -1, x: 0, y: 0, n: 0 }));
  let row = 0;
  const paintRow = (j: number) => { for (let i = 0; i < n; i++) {
    const list = tiles[Math.floor(j / n * T) * T + Math.floor(i / n * T)];
    if (!list.length) continue;
    const u = (i + 0.5) / (n / 2) - 1, v = (j + 0.5) / (n / 2) - 1;
    const c = cloudAt(p, u, v, list);
    if (c.wi < 0) continue;
    const wi = c.wi, ly = c.edge * R;
    if (ly <= -4 && c.soft * R <= -REACH) continue;
    const o = (j * n + i) * 4;
    if (ly > 0) {
      // dark dust against the stars, smoky and brown (it must read as matter, not as empty space); only the edges near
      // bright stars are lit, thinly
      const t = fbm(p.seed + 201, u * 16 + 1, v * 16 + 1), t2 = fbm(p.seed + 203, u * 45 + 7, v * 45 + 2);
      const smoke = 0.55 * t + 0.45 * t2, lit = Math.exp(-ly / 3) * (0.5 + 0.7 * t) * rimLight(p.seed, u, v);
      const deep = Math.min(1, ly / 12); // the heart of a cloud is darker than its margins
      data[o] = 16 + 26 * smoke * (1 - 0.5 * deep) + 120 * lit; data[o + 1] = 11 + 16 * smoke * (1 - 0.5 * deep) + 62 * lit; data[o + 2] = 10 + 10 * smoke * (1 - 0.5 * deep) + 34 * lit;
      data[o + 3] = Math.round(255 * Math.min(0.97, 0.5 + ly / 3));
      const x = (i + 0.5) * lyPx, y = (j + 0.5) * lyPx;
      if (wi >= 0 && x > margin && y > margin && x < game.width - margin && y < game.height - margin) {
        const b = best[wi]; b.n++;
        if (ly > b.e) { b.e = ly; b.x = x; b.y = y; }
      }
    } else if (ly > -4) {
      // the lit rim, just outside (the edge itself is blended with it)
      const a = (1 + ly / 4) * (0.25 + 0.75 * rimLight(p.seed, u, v));
      data[o] = 196; data[o + 1] = 116; data[o + 2] = 68; data[o + 3] = Math.round(255 * 0.3 * a * a);
    } else {
      // the dust thins out: a shadow over the glow of the stars (smooth: the ragged edge would show its grain here)
      const a = Math.max(0, 1 - (-Math.min(-4, c.soft * R) - 4) / (REACH - 4));
      data[o] = 3; data[o + 1] = 4; data[o + 2] = 9; data[o + 3] = Math.round(255 * 0.4 * a);
    }
  } };
  const finish = (): CloudRaster => {
    const area = lyPx * lyPx;
    const labels = p.walls!.map((w, i) => ({ ...best[i], name: cloudName(w), size: best[i].n * area }))
      .filter(b => b.n > 0 && b.size > 900)
      .map(b => ({ x: b.x, y: b.y, name: b.name, size: b.size }));
    return { n, data, labels };
  };
  return {
    step(ms: number) {
      const t0 = Date.now();
      while (row < n) { paintRow(row++); if ((row & 7) === 0 && Date.now() - t0 > ms) return null; }
      return finish();
    },
  };
}

/**
 * Where the names go on screen: inside the map (a name never runs off its edge), the biggest clouds first, a name
 * that would cover another one left out.
 */
export function layoutCloudLabels(labels: CloudRaster['labels'], toScreen: (x: number, y: number) => { x: number; y: number }, box: { x0: number; y0: number; x1: number; y1: number }, z: number, measure: (text: string, size: number) => number): { x: number; y: number; text: string; size: number }[] {
  const out: { x: number; y: number; text: string; size: number; w: number }[] = [];
  for (const l of [...labels].sort((a, b) => b.size - a.size)) {
    const size = Math.round(Math.max(9, Math.min(15, 8 + Math.sqrt(l.size) / 40 * Math.min(2, z))));
    const text = l.name.toLocaleUpperCase(), w = measure(text, size);
    const q = toScreen(l.x, l.y);
    const x = Math.max(box.x0 + w / 2 + 6, Math.min(box.x1 - w / 2 - 6, q.x)), y = Math.max(box.y0 + size, Math.min(box.y1 - size, q.y));
    if (out.some(o => Math.abs(o.x - x) < (o.w + w) / 2 + 4 && Math.abs(o.y - y) < (o.size + size) / 2 + 3)) continue;
    out.push({ x, y, text, size, w });
  }
  return out;
}
