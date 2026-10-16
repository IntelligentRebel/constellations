// Constellations 3.6: the dark clouds that close the map and cut passages through it are impassable: at Warp speeds,
// each grain of their dust strikes like a shell. Fleets go around them: every leg that would cross one is replaced by
// a detour through points of deep space (pass-through waypoints), found on a grid of the map, and the route estimates
// follow the same detours as the movement.
import type { GameState, Secret, Waypoint } from './types';
import { cloudAt, cloudDepth, cloudName } from './shape';

/** What the geometry needs to know of a game (0.3.7: the hidden stars carve a way in, for those who found it). */
type Geo = Pick<GameState, 'shape' | 'width' | 'height'> & { secrets?: Secret[] };
type Pt = { x: number; y: number };

// ------------------------------------------------------------------ 0.3.7: the way into the veiled star
/**
 * Position along the way into a veiled star (0 at the mouth, the index of the star at the end), or -1 when the point
 * is not in it. The way is a narrow channel of thinner dust through the cloud, then the cavity the star blew around itself.
 */
export function laneT(s: Secret, p: Pt): number {
  const L = s.lane;
  if (!L || L.length < 2) return -1;
  const end = L[L.length - 1];
  if (Math.hypot(p.x - end.x, p.y - end.y) <= (s.cavity ?? 8) + 1) return L.length - 1;
  const hw = (s.laneWidth ?? 3) + 1.5;
  let best = -1, bd = Infinity;
  for (let k = 0; k < L.length - 1; k++) {
    const a = L[k], b = L[k + 1], vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    const d = Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
    if (d <= hw && d < bd) { bd = d; best = k + t; }
  }
  return best;
}

/** The ways in known to this empire. */
function lanesOf(game: Geo, who: number | undefined): Secret[] {
  if (who === undefined || !game.secrets) return [];
  return game.secrets.filter(s => s.lane && s.tunnel?.includes(who));
}

/** Is this point of a cloud open to this empire (it knows the way in and the point is on it)? */
export function openFor(game: Geo, who: number | undefined, x: number, y: number): boolean {
  for (const s of lanesOf(game, who)) if (laneT(s, { x, y }) >= 0) return true;
  return false;
}

/** The corners of the way between two positions along it (excluding both ends), in order. */
function laneBetween(s: Secret, ta: number, tb: number): Pt[] {
  const L = s.lane!, out: Pt[] = [];
  if (ta < tb) { for (let i = Math.floor(ta) + 1; i < tb; i++) out.push({ ...L[i] }); }
  else for (let i = Math.ceil(ta) - 1; i > tb; i--) out.push({ ...L[i] });
  return out;
}

// ------------------------------------------------------------------ 0.3.7: the hidden cluster, off the map
/** The box of the hidden cluster (beyond the edge of the map, reached only by its wormhole). */
export function pocketBox(game: Geo): { x: number; y: number; w: number; h: number } | null {
  return game.secrets?.find(s => s.kind === 'pocket')?.box ?? null;
}
/** 0 the galaxy, 1 the hidden cluster, -1 the void between them (impassable). */
export function regionOf(game: Geo, p: Pt): number {
  if (p.x >= 0 && p.y >= 0 && p.x <= game.width && p.y <= game.height) return 0;
  const b = pocketBox(game);
  if (b && p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h) return 1;
  return -1;
}
export const inPocket = (game: Geo, p: Pt) => regionOf(game, p) === 1;

/** Where a straight flight from a must stop before the void around the hidden cluster (null when it does not reach it). */
export function voidStop(game: Geo, a: Pt, b: Pt): Pt | null {
  if (!pocketBox(game)) return null;
  const ra = regionOf(game, a);
  // lost in the void (never: an old save at most), or the whole flight inside one region (both are convex boxes)
  if (ra < 0 || regionOf(game, b) === ra) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, n = Math.max(1, Math.ceil(len / 1.5));
  let last = { x: a.x, y: a.y };
  for (let k = 1; k <= n; k++) {
    const q = { x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n };
    if (regionOf(game, q) !== ra) {
      const r = { x: Math.round(last.x), y: Math.round(last.y) };
      return regionOf(game, r) === ra ? r : { x: Math.round(a.x), y: Math.round(a.y) };
    }
    last = q;
  }
  return null;
}

interface Grid { key: string; cell: number; cols: number; rows: number; hard: Uint8Array; soft: Uint8Array }
let grid: Grid | null = null;
const pathCache = new Map<string, { x: number; y: number }[] | null>();

export const hasWalls = (game: Pick<GameState, 'shape'>) => !!game.shape?.walls?.length;

/** Is this map point inside a dark cloud (for this empire: the way into a veiled star it found is open)? */
export function inWall(game: Geo, x: number, y: number, who?: number): boolean {
  if (!game.shape?.walls?.length) return false;
  const R = game.width / 2;
  if (cloudDepth(game.shape, (x - R) / R, (y - game.height / 2) / R) <= 0) return false;
  return who === undefined || !openFor(game, who, x, y);
}

/** The dark cloud at a point (for messages and the map), if any. */
export function wallAt(game: Geo, x: number, y: number): string | null {
  const p = game.shape;
  if (!p?.walls?.length) return null;
  const R = game.width / 2, c = cloudAt(p, (x - R) / R, (y - game.height / 2) / R);
  return c.depth > 0 && c.wi >= 0 ? cloudName(p.walls[c.wi]) : null;
}

function gridOf(game: Geo): Grid | null {
  if (!game.shape?.walls?.length) return null;
  const key = `${game.shape.seed}|${game.width}|${game.shape.walls.length}|${game.shape.passes?.length ?? 0}`;
  if (grid?.key === key) return grid;
  // fine enough to see the narrow passes (0.3.6.8: a third finer than before)
  const cell = Math.max(5, Math.min(9, game.width / 240));
  const cols = Math.ceil(game.width / cell), rows = Math.ceil(game.height / cell);
  const hard = new Uint8Array(cols * rows), soft = new Uint8Array(cols * rows);
  // a cell is closed when its centre or one of its corners is in a cloud (the ragged edges have bits smaller than a
  // cell: a route planned between cells must not clip them); the corners are shared, each is tested once
  const corner = new Uint8Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) corner[j * (cols + 1) + i] = inWall(game, i * cell, j * cell) ? 1 : 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const c0 = j * (cols + 1) + i;
    if (corner[c0] || corner[c0 + 1] || corner[c0 + cols + 1] || corner[c0 + cols + 2] || inWall(game, (i + 0.5) * cell, (j + 0.5) * cell)) hard[j * cols + i] = 1;
  }
  // next to a cloud: passable, but the routes keep away from it when they can (one cell)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let b = 0;
    for (let dj = -1; dj <= 1 && !b; dj++) for (let di = -1; di <= 1 && !b; di++) {
      const a = i + di, c = j + dj;
      if (a >= 0 && c >= 0 && a < cols && c < rows && hard[c * cols + a]) b = 1;
    }
    soft[j * cols + i] = b;
  }
  grid = { key, cell, cols, rows, hard, soft };
  pathCache.clear();
  return grid;
}

/** Does the straight line from a to b cross a dark cloud? */
export function segmentBlocked(game: Geo, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const g = gridOf(game);
  if (!g) return false;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / (g.cell / 3)));
  for (let k = 1; k < n; k++) {
    const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n;
    const i = Math.floor(x / g.cell), j = Math.floor(y / g.cell);
    if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) continue;
    if (g.hard[j * g.cols + i]) return true;
  }
  return false;
}


/**
 * Where a straight flight from a to b must stop because it would enter a dark cloud (null when it does not): the last
 * point outside before the cloud. Skimming the ragged edge of a cloud is allowed; going into it is not.
 */
export function wallStop(game: Geo, a: { x: number; y: number }, b: { x: number; y: number }, who?: number): { x: number; y: number; cloud: string } | null {
  if (!game.shape?.walls?.length || inWall(game, a.x, a.y, who)) return null; // already inside (an old save): it may get out
  if (!segmentBlocked(game, a, b) && !inWall(game, b.x, b.y, who)) return null;
  const R = game.width / 2, H = game.height / 2;
  const open = lanesOf(game, who).length > 0;
  const depth = (x: number, y: number) => open && openFor(game, who, x, y) ? -1 : cloudDepth(game.shape!, (x - R) / R, (y - H) / R);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = Math.max(1, Math.ceil(len / 1.5));
  let free = { x: a.x, y: a.y };
  for (let k = 1; k <= n; k++) {
    const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n;
    const d = depth(x, y);
    if (d > 0.15 || (k === n && d > 0)) {
      // back to the last free point, on whole light-years that are still outside
      let q = { x: Math.round(free.x), y: Math.round(free.y) };
      for (let back = 1; back < len && inWall(game, q.x, q.y, who); back++) q = { x: Math.round(free.x - (b.x - a.x) / len * back), y: Math.round(free.y - (b.y - a.y) / len * back) };
      if (inWall(game, q.x, q.y, who)) q = { x: Math.round(a.x), y: Math.round(a.y) };
      return { ...q, cloud: wallAt(game, x, y) ?? '' };
    }
    if (d <= 0) free = { x, y };
  }
  return null;
}

/** Nearest point outside the clouds, on the way from a towards b (b itself when it is free). */
export function clampOutside(game: Geo, a: { x: number; y: number }, b: { x: number; y: number }, who?: number): { x: number; y: number } {
  if (!inWall(game, b.x, b.y, who)) return b;
  // walk back from b towards a until outside, then a few light-years more
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  for (let d = 0; d <= len; d += 2) {
    const x = b.x + (a.x - b.x) * d / len, y = b.y + (a.y - b.y) * d / len;
    if (!inWall(game, x, y, who)) { const e = Math.min(len, d + 6); return { x: Math.round(b.x + (a.x - b.x) * e / len), y: Math.round(b.y + (a.y - b.y) * e / len) }; }
  }
  return a;
}

/**
 * The points to go through from a to b without crossing a cloud (empty when the straight line is free, null when
 * there is no way). A* on the grid, then the path is pulled tight.
 */
export function detourPoints(game: Geo, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] | null {
  if (!segmentBlocked(game, a, b)) return [];
  const g = gridOf(game)!;
  const ci = (x: number) => Math.max(0, Math.min(g.cols - 1, Math.floor(x / g.cell)));
  const cj = (y: number) => Math.max(0, Math.min(g.rows - 1, Math.floor(y / g.cell)));
  const s = cj(a.y) * g.cols + ci(a.x), t = cj(b.y) * g.cols + ci(b.x);
  const key = `${s}>${t}`;
  let cells = pathCache.get(key);
  if (cells === undefined) {
    cells = astar(g, s, t);
    if (pathCache.size > 4000) pathCache.clear();
    pathCache.set(key, cells);
  }
  if (!cells) return null;
  // pull the path tight: keep only the points where the straight line would hit a cloud
  const pts = [a, ...cells, b];
  const out: { x: number; y: number }[] = [];
  let from = a, i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && segmentBlocked(game, from, pts[j])) j--;
    if (j === pts.length - 1) break;
    const q = { x: Math.round(pts[j].x), y: Math.round(pts[j].y) };
    out.push(q);
    from = q; i = j;
  }
  return out;
}

/**
 * The shortest way on the grid around the closed cells. A cell next to a cloud costs more (the routes keep some room
 * when it is cheap) but stays open: a narrow pass between two clouds is taken when going around costs more
 * (0.3.6.8; before, a pass narrower than three cells was never taken while any way around existed).
 */
function astar(g: Grid, s: number, t: number): { x: number; y: number }[] | null {
  const n = g.cols * g.rows, NEAR = 2.2;
  const cost = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const tx = t % g.cols, ty = Math.floor(t / g.cols);
  const h = (c: number) => Math.hypot(c % g.cols - tx, Math.floor(c / g.cols) - ty);
  const free = (c: number) => c === s || c === t || !g.hard[c];
  // binary heap of (f, cell)
  const heapF: number[] = [], heapC: number[] = [];
  const push = (fv: number, c: number) => {
    let i = heapF.length; heapF.push(fv); heapC.push(c);
    while (i > 0) { const pi = (i - 1) >> 1; if (heapF[pi] <= fv) break; heapF[i] = heapF[pi]; heapC[i] = heapC[pi]; i = pi; }
    heapF[i] = fv; heapC[i] = c;
  };
  const pop = (): number => {
    const top = heapC[0], lf = heapF.pop()!, lc = heapC.pop()!;
    if (heapF.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mf = lf;
        if (l < heapF.length && heapF[l] < mf) { m = l; mf = heapF[l]; }
        if (r < heapF.length && heapF[r] < mf) { m = r; mf = heapF[r]; }
        if (m === i) break;
        heapF[i] = heapF[m]; heapC[i] = heapC[m]; i = m;
      }
      heapF[i] = lf; heapC[i] = lc;
    }
    return top;
  };
  cost[s] = 0; push(h(s), s);
  const done = new Uint8Array(n);
  while (heapF.length) {
    const c = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === t) break;
    const cx = c % g.cols, cy = Math.floor(c / g.cols);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
      const nb = y * g.cols + x;
      if (done[nb] || !free(nb)) continue;
      if (dx && dy && (!free(cy * g.cols + x) || !free(y * g.cols + cx))) continue;
      const nc = cost[c] + (dx && dy ? Math.SQRT2 : 1) * (g.soft[nb] && nb !== t ? NEAR : 1);
      if (nc < cost[nb]) { cost[nb] = nc; prev[nb] = c; push(nc + h(nb), nb); }
    }
  }
  if (prev[t] < 0 && s !== t) return null;
  const out: { x: number; y: number }[] = [];
  for (let c = prev[t]; c >= 0 && c !== s; c = prev[c]) out.unshift({ x: (c % g.cols + 0.5) * g.cell, y: (Math.floor(c / g.cols) + 0.5) * g.cell });
  return out;
}

/**
 * The points to go through from a to b for this empire: around the clouds, and along the way into a veiled star it
 * found when one of the two ends is on it (0.3.7).
 */
export function routePoints(game: Geo, a: Pt, b: Pt, who?: number): Pt[] | null {
  for (const s of lanesOf(game, who)) {
    const ta = laneT(s, a), tb = laneT(s, b);
    if (ta < 0 && tb < 0) continue;
    if (ta >= 0 && tb >= 0) return laneBetween(s, ta, tb);
    const mouth = s.lane![0];
    if (ta >= 0) return [...laneBetween(s, ta, 0), ...(ta > 0 ? [{ ...mouth }] : []), ...(detourPoints(game, mouth, b) ?? [])];
    return [...(detourPoints(game, a, mouth) ?? []), ...(tb > 0 ? [{ ...mouth }] : []), ...laneBetween(s, 0, tb)];
  }
  return detourPoints(game, a, b);
}

/** Are these two points connected (a way around the clouds exists)? */
export function connected(game: Geo, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return detourPoints(game, a, b) !== null;
}

/**
 * Waypoints with the detours inserted (pass-through points of deep space marked `detour`); `map[i]` is where the
 * original waypoint i ended up. Waypoints inside a cloud are moved to its edge.
 */
export function withDetours(game: GameState, wps: Waypoint[], posOf: (w: Waypoint) => { x: number; y: number } = w => w, who?: number): { list: Waypoint[]; map: number[] } {
  if (!hasWalls(game) || wps.length < 2) return { list: wps, map: wps.map((_, i) => i) };
  const list: Waypoint[] = [wps[0]];
  const map = [0];
  let prev = posOf(wps[0]);
  for (let i = 1; i < wps.length; i++) {
    let w = wps[i];
    let at = posOf(w);
    if (w.target === 'space' && inWall(game, at.x, at.y, who)) { at = clampOutside(game, prev, at, who); w = { ...w, x: at.x, y: at.y }; }
    const pts = w.detour ? [] : routePoints(game, prev, at, who) ?? [];
    for (const q of pts) list.push({ x: q.x, y: q.y, target: 'space', warp: w.warp, task: 'none', detour: true });
    list.push(w);
    map.push(list.length - 1);
    prev = at;
    // 0.3.7: through a wormhole whose exit the empire knows, the next leg starts from the exit
    if (w.target === 'wormhole' && w.targetId !== undefined && who !== undefined) {
      const wh = game.wormholes.find(x => x.id === w.targetId), known = game.players[who]?.intel.wormholes;
      const exit = wh && !wh.sealed && known?.[wh.id]?.destId === wh.destId ? known[wh.destId] : undefined;
      if (exit) prev = { x: exit.x, y: exit.y };
    }
  }
  return { list, map };
}

/** The nearest point outside the clouds (a few light-years clear of the edge). */
export function nearestOutside(game: Geo, p: { x: number; y: number }): { x: number; y: number } {
  if (!inWall(game, p.x, p.y)) return p;
  for (let r = 3; r < game.width; r += 3) {
    const n = Math.max(12, Math.round(r / 2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (x < 0 || y < 0 || x > game.width || y > game.height || inWall(game, x, y)) continue;
      const e = r + 5, q = { x: Math.round(p.x + Math.cos(a) * e), y: Math.round(p.y + Math.sin(a) * e) };
      return inWall(game, q.x, q.y) ? { x: Math.round(x), y: Math.round(y) } : q;
    }
  }
  return p;
}

/** Is this point in the largest region the clouds leave connected (null when there are no clouds)? */
export function mainRegionTest(game: Geo): ((x: number, y: number) => boolean) | null {
  const g = gridOf(game);
  if (!g) return null;
  const label = labels(g);
  const area = new Map<number, number>();
  for (const l of label) if (l >= 0) area.set(l, (area.get(l) ?? 0) + 1);
  const best = [...area.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  return (x, y) => {
    const i = Math.max(0, Math.min(g.cols - 1, Math.floor(x / g.cell))), j = Math.max(0, Math.min(g.rows - 1, Math.floor(y / g.cell)));
    return label[j * g.cols + i] === best;
  };
}

/** Connected regions of free space (4-neighbours on the grid of the clouds): -1 inside a cloud. */
function labels(g: Grid): Int32Array {
  const label = new Int32Array(g.cols * g.rows).fill(-1);
  let next = 0;
  for (let c0 = 0; c0 < label.length; c0++) {
    if (g.hard[c0] || label[c0] >= 0) continue;
    const stack = [c0];
    label[c0] = next;
    while (stack.length) {
      const c = stack.pop()!, cx = c % g.cols, cy = Math.floor(c / g.cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
        const nb = y * g.cols + x;
        if (g.hard[nb] || label[nb] >= 0) continue;
        label[nb] = next; stack.push(nb);
      }
    }
    next++;
  }
  return label;
}
