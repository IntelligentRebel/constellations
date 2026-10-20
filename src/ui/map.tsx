// The scanner: a canvas map of the galaxy (pan, zoom, select, waypoints, overlays).
import { useEffect, useRef, useState } from 'preact/hooks';
import { viewRoute, viewFleet, viewScanners } from './memo';
import { mapColors, uiPrefs } from './prefs';
import { store, useStore, type ObjRef, fmt, fmtPop } from './store';
import type { Fleet, GameState, Planet, Player, Waypoint } from '../engine/types';
import { habitability } from '../engine/race';
import { terraformedHabValue, planetSpec } from '../engine/planet';
import { fleetSpec, distance, travelYears, estimateRoute } from '../engine/fleet';
import { scannersOf, estimateTrajectory } from '../engine/scan';
import { traderPositions } from '../engine/intercept';
import { minefieldsOnLeg } from '../engine/movement';
import { specOf } from '../engine/design';
import { addWaypoint, commandedFleet, moveWaypoint, insertWaypoint, markIntercept, intercept as interceptFleet, setPatrolRange } from './actions';
import { defaultTankerRange } from '../engine/refuel';
import { planetSprite } from './art';
import { canUseWormholes } from '../engine/specials';
import { terrainAt, terrainName, TERRAIN_INFO } from '../engine/terrain';
import { seatsOf, ADMIN_RADIUS } from '../engine/empire';
import { portalThreat } from '../engine/megaprojects';
import { raidsAgainst, etaYears } from '../engine/pirates';
import { waves } from '../engine/crisis';
import { planetNotes } from './discoveries';
import { anomalyAt, isSite } from '../engine/anomalies';
import { SECRET_INFO, PROBE_NEED } from '../engine/secrets';
import { PULSAR_SHIELD_RANGE } from '../engine/terrain';
import { cultureOn, territoryField, type TerritoryField } from '../engine/culture';
import { closersOf } from '../engine/borders';
import { densityAt, isRegion } from '../engine/shape';
import { cloudJob, layoutCloudLabels, type CloudRaster } from './clouds';
import { wallAt, openFor } from '../engine/walls';
import { upperFirst } from '../engine/words';
import { radarContacts } from '../engine/radar';
import { drawCataclysms, cataclysmTip } from './catamap';

interface Hit { ref: ObjRef; label: string; x: number; y: number }

/** A chevron of a foreign fleet's estimated trajectory: where it should be k years from now. */
export interface TrackSnap { x: number; y: number; fleetId: number; k: number; name: string }
function trackPoints(me: Player, game?: GameState): TrackSnap[] {
  const res: TrackSnap[] = [];
  // 3.6: the Mystery Trader's year-end positions are magnetic too
  if (game) for (const t of me.intel.traders) (traderPositions(game, me, t.id, 10) ?? []).forEach((a, k) => res.push({ x: a.x, y: a.y, fleetId: -1, k: k + 1, name: 'le Marchand nomade' }));
  for (const fi of me.intel.fleets) {
    const tr = estimateTrajectory(me, fi.id, 3);
    if (!tr) continue;
    tr.ahead.forEach((a, k) => res.push({ x: a.x, y: a.y, fleetId: fi.id, k: k + 1, name: fi.name ?? 'Flotte inconnue' }));
  }
  return res;
}

/** Draggable points of the selected fleet's route: waypoint markers and the yearly chevrons. */
interface RouteHandle { kind: 'wp' | 'leg' | 'radius'; i: number; x: number; y: number }
/** 3.6: the radius of a patrol (or a tanker's post), its handle on the circle's east side */
export const patrolRadiusOf = (g: GameState, f: Fleet, i: number) => f.waypoints[i].patrolRange ?? (f.waypoints[i].task === 'refuel' ? defaultTankerRange(g, f) : 50);
function routeHandles(g: GameState, f: Fleet): RouteHandle[] {
  const res: RouteHandle[] = [];
  f.waypoints.forEach((w, i) => { if (w.task === 'patrol' || w.task === 'refuel') res.push({ kind: 'radius', i, x: w.x + patrolRadiusOf(g, f, i), y: w.y }); });
  const est = viewRoute(g, f);
  let prev = { x: f.x, y: f.y };
  for (let i = 1; i < f.waypoints.length; i++) {
    const wp = f.waypoints[i];
    const ends = est[i - 1]?.yearEnds ?? [];
    for (const p of ends) res.push({ kind: 'leg', i, x: p.x, y: p.y });
    if (!ends.length && distance(prev, wp) > 2) res.push({ kind: 'leg', i, x: (prev.x + wp.x) / 2, y: (prev.y + wp.y) / 2 });
    res.push({ kind: 'wp', i, x: wp.x, y: wp.y });
    prev = wp;
  }
  return res;
}

/**
 * Shift+click semantics: the first Shift+click gives the selected fleet a new destination (replacing its
 * route); while Shift stays held, further clicks add steps. Ctrl+Shift+click always appends to the
 * existing route. The touch "Étapes" mode behaves like holding Shift.
 */
const shiftSession = { fleet: -1 };
if (typeof window !== 'undefined') {
  window.addEventListener('keyup', e => { if (e.key === 'Shift') shiftSession.fleet = -1; });
  window.addEventListener('blur', () => { shiftSession.fleet = -1; });
}
export function resetStepSession() { shiftSession.fleet = -1; }

function routeClick(ref: ObjRef, pos: { x: number; y: number }, append: boolean) {
  const s = store, f = commandedFleet();
  if (!f) return;
  let snap: string | undefined;
  if (!append && shiftSession.fleet !== f.id) {
    // new destination: the current route is replaced (one undo step restores it)
    if (f.waypoints.length > 1 || f.auto) { s.checkpoint(); snap = s.undo.pop(); f.waypoints = [{ ...f.waypoints[0], task: f.waypoints[0].processed ? 'none' : f.waypoints[0].task }]; f.repeat = false; f.route = undefined; f.auto = undefined; f.job = undefined; }
    s.waypointIndex = 0;
  } else s.waypointIndex = f.waypoints.length - 1;
  shiftSession.fleet = f.id;
  const before = s.undo.length;
  addWaypoint(ref, pos);
  if (snap) { if (s.undo.length > before) s.undo[s.undo.length - 1] = snap; else s.undo.push(snap); }
}

// 0.3.9: the semantic colours follow the colour-blind palette chosen in the preferences
const NEUTRAL_KNOWN = '#e8ecf4', UNKNOWN = '#4a5568';
const OWN_ = () => mapColors().own, ENEMY_ = () => mapColors().enemy, FRIEND_ = () => mapColors().friend, GOOD_ = () => mapColors().good, BAD_ = () => mapColors().bad;
/** 3.6: at peace (neither ally nor at war) */
const PEACE = '#a9b8cc';

/** Colour of an empire's relation to us: ours, allied (gold), at peace (grey-blue), at war (red). */
export function relationColor(game: GameState, me: Player, owner: number | undefined): string {
  if (owner === undefined || owner < 0) return NEUTRAL_KNOWN;
  if (owner === me.id) return OWN_();
  const r = me.relations[owner];
  return r === 'friend' ? FRIEND_() : r === 'neutral' && !game.players[owner]?.monster ? PEACE : ENEMY_();
}
const rgb = (hex: string) => `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;

let offCanvas: HTMLCanvasElement | null = null;
function offscreen(w: number, h: number): HTMLCanvasElement {
  if (!offCanvas) offCanvas = document.createElement('canvas');
  if (offCanvas.width !== w || offCanvas.height !== h) { offCanvas.width = w; offCanvas.height = h; }
  return offCanvas;
}

/** the scanners of the player (0.3.9.20: kept until the game changes, see memo.ts) */
const cachedScanners = (game: GameState, me: Player) => viewScanners(game, me);

/**
 * 3.6: the glow of a whole galaxy (games of 0.3.5.8 to 0.3.6.2: it draws its outline), painted once and stretched over
 * the map. A region of a galaxy (0.3.6.3) has none: the background stays black, the stars and the clouds show its shape.
 */
let glow: { key: string; cv: HTMLCanvasElement } | null = null;
export function galaxyGlow(game: GameState): HTMLCanvasElement | null {
  if (!game.shape || isRegion(game.shape.kind)) return null;
  const key = game.settings.seed + '|' + game.shape.seed + '|' + game.width;
  if (glow?.key === key) return glow.cv;
  const N = 220;
  const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = densityAt(game.shape, (i + 0.5) / (N / 2) - 1, (j + 0.5) / (N / 2) - 1);
    const o = (j * N + i) * 4;
    // dust blue in the arms, warmer toward the brightest core
    img.data[o] = 95 + 70 * d * d; img.data[o + 1] = 110 + 40 * d * d; img.data[o + 2] = 215; img.data[o + 3] = Math.round(255 * Math.min(0.34, d * 0.34));
  }
  c.putImageData(img, 0, 0);
  glow = { key, cv };
  return cv;
}

/**
 * 3.6: the dark clouds, painted once: opaque dust, a rim lit by the nearby stars, a shadow around them; and where to
 * write their names (their deepest point inside the map).
 */
let clouds: { key: string; cv: HTMLCanvasElement | null; labels: CloudRaster['labels'] } | null = null;
/** Called when the clouds of a new map are ready (the map and the minimap paint again). */
const cloudsReady = new Set<() => void>();
export function cloudLayer(game: GameState): { cv: HTMLCanvasElement; labels: CloudRaster['labels'] } | null {
  const p = game.shape;
  if (!p?.walls?.length) return null;
  const key = game.settings.seed + '|' + p.seed + '|' + game.width + '|' + p.walls.length;
  if (clouds?.key === key) return clouds.cv ? clouds as { cv: HTMLCanvasElement; labels: CloudRaster['labels'] } : null;
  const N = Math.round(Math.max(700, Math.min(1200, game.width * 0.7)));
  const job = cloudJob(game, N)!;
  const mine: { key: string; cv: HTMLCanvasElement | null; labels: CloudRaster['labels'] } = { key, cv: null, labels: [] };
  clouds = mine;
  const tick = () => {
    if (clouds !== mine) return; // another map in the meantime
    const r = job.step(30);
    if (!r) { setTimeout(tick, 0); return; }
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(N, N);
    img.data.set(r.data);
    c.putImageData(img, 0, 0);
    mine.cv = cv; mine.labels = r.labels;
    for (const f of cloudsReady) f();
  };
  setTimeout(tick, 0);
  return null;
}

function drawClouds(ctx: CanvasRenderingContext2D, game: GameState, toScreen: (x: number, y: number) => { x: number; y: number }, z: number) {
  const cl = cloudLayer(game);
  if (!cl) return;
  const tl = toScreen(0, 0), br = toScreen(game.width, game.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cl.cv, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  // their names, in spaced capitals: big enough to be read, small enough not to cover the stars
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const c2 = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const font = (size: number) => { ctx.font = `600 ${size}px Georgia, 'Times New Roman', serif`; c2.letterSpacing = `${Math.round(size * 0.22)}px`; };
  const view = { x0: Math.max(tl.x, 0), y0: Math.max(tl.y, 0), x1: Math.min(br.x, ctx.canvas.width), y1: Math.min(br.y, ctx.canvas.height) };
  for (const l of layoutCloudLabels(cl.labels, toScreen, { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y }, z, (t, size) => { font(size); return ctx.measureText(t).width; })) {
    if (l.x < view.x0 - 200 || l.x > view.x1 + 200 || l.y < view.y0 - 20 || l.y > view.y1 + 20) continue;
    font(l.size);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(6,4,3,0.85)'; ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = 'rgba(214,150,100,0.72)'; ctx.fillText(l.text, l.x, l.y);
  }
  c2.letterSpacing = '0px';
  ctx.restore();
}

let starfield: HTMLCanvasElement | null = null;
function getStarfield(): HTMLCanvasElement {
  if (starfield) return starfield;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d')!;
  let s = 12345;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 260; i++) {
    const a = r() * 0.35 + 0.05;
    ctx.fillStyle = `rgba(${180 + r() * 75},${190 + r() * 65},255,${a})`;
    const sz = r() < 0.95 ? 1 : 1.6;
    ctx.fillRect(r() * 512, r() * 512, sz, sz);
  }
  starfield = c;
  return c;
}

export function MapView() {
  const s = useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: Hit[]; wx: number; wy: number } | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; ruler?: { x: number; y: number } } | null>(null);
  const routeDrag = useRef<{ h: RouteHandle; fleet: number; sx: number; sy: number; moved: boolean } | null>(null);
  const [dragPt, setDragPt] = useState<{ x: number; y: number; snap: boolean; track?: TrackSnap } | null>(null);
  const [hoverHandle, setHoverHandle] = useState<RouteHandle | null>(null);
  const lastClick = useRef<{ x: number; y: number; i: number }>({ x: -1, y: -1, i: 0 });
  const measure = useRef<{ x: number; y: number } | null>(null);
  const [ruler, setRuler] = useState<{ a: { x: number; y: number }; b: { x: number; y: number }; la?: string; lb?: string } | null>(null);
  /** 3.3.6 ruler: a point snaps to the planet or fleet under the cursor */
  const snapPoint = (sx: number, sy: number): { x: number; y: number; label?: string } => {
    const h = hits(sx, sy, 10);
    const t = h.find(x => x.ref.kind === 'planet') ?? h[0];
    return t ? { x: t.x, y: t.y, label: t.label } : toWorld(sx, sy);
  };

  const [camTick, setCamTick] = useState(0);
  useEffect(() => s.subscribeCamera(() => setCamTick(v => v + 1)), []);
  useEffect(() => { const f = () => setCamTick(v => v + 1); cloudsReady.add(f); return () => { cloudsReady.delete(f); }; }, []);
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize(o => o.w === el.clientWidth && o.h === el.clientHeight ? o : { w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const toScreen = (x: number, y: number) => ({ x: (x - s.camera.x) * s.camera.zoom + size.w / 2, y: (y - s.camera.y) * s.camera.zoom + size.h / 2 });
  const toWorld = (sx: number, sy: number) => ({ x: (sx - size.w / 2) / s.camera.zoom + s.camera.x, y: (sy - size.h / 2) / s.camera.zoom + s.camera.y });

  // 0.3.9.20: the map is drawn again only when what it shows may have changed: the game (any bump of the store, any
  // order), the camera, the size, the clouds coming in, a route being dragged, a ruler. A tooltip, the report strip or
  // a toast no longer redraw the whole galaxy.
  const drawn = useRef<unknown[] | null>(null);
  useEffect(() => {
    const sig = [s.game, s.me, s.version, s.camera.x, s.camera.y, s.camera.zoom, size.w, size.h, camTick, dragPt, hoverHandle, ruler, routeDrag.current?.moved];
    const prev = drawn.current;
    if (prev && sig.every((v, i) => v === prev[i])) return;
    drawn.current = sig;
    const w = window as any, t0 = performance.now(); draw(); w.__drawMs = performance.now() - t0; w.__draws = (w.__draws | 0) + 1;
  });

  function draw() {
    const cv = canvas.current;
    const game = s.game, me = s.me;
    if (!cv || !game || !me) return;
    // 0.3.9: under the interface zoom (text size), draw at the real resolution of the screen
    const dpr = (window.devicePixelRatio || 1) * (uiPrefs.textScale || 1);
    if (cv.width !== size.w * dpr || cv.height !== size.h * dpr) { cv.width = size.w * dpr; cv.height = size.h * dpr; }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#03050b';
    ctx.fillRect(0, 0, size.w, size.h);
    // parallax stars
    const sf = getStarfield();
    const ox = (-s.camera.x * s.camera.zoom * 0.15) % 512, oy = (-s.camera.y * s.camera.zoom * 0.15) % 512;
    for (let x = ox - 512; x < size.w; x += 512) for (let y = oy - 512; y < size.h; y += 512) ctx.drawImage(sf, x, y);
    const z = s.camera.zoom;
    // universe border: the square of Stars!, or the glow of a natural galaxy (3.6)
    const tl = toScreen(0, 0), br = toScreen(game.width, game.height);
    const gl = galaxyGlow(game);
    if (gl) { ctx.imageSmoothingEnabled = true; ctx.drawImage(gl, tl.x, tl.y, br.x - tl.x, br.y - tl.y); }
    else {
      ctx.strokeStyle = 'rgba(80,110,160,0.25)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y); ctx.setLineDash([]);
    }
    const v = s.view;
    // 3.6: épuré and radar draw the planets plainly
    const plain = v.mode === 6 || v.mode === 8;
    const radar = v.mode === 8 ? radarContacts(game, me) : null;
    const radarById = new Map((radar ?? []).map(c => [c.id, c]));
    // terrain: nebulae, dense clusters, ion storms (known to everyone: they are huge)
    if (game.settings.terrain && game.terrain?.length) drawTerrain(ctx, game, toScreen, z);
    // Constellations 3: administrative radius of the capitals (full output inside)
    const seats = game.settings.distanceCost ? seatsOf(game, me) : [];
    if (seats.length && v.admin !== false && !plain) {
      for (const pl of seats) {
        const p = toScreen(pl.x, pl.y), r = ADMIN_RADIUS * z;
        ctx.strokeStyle = 'rgba(201,162,39,0.35)'; ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // scanner coverage (union of discs, drawn once)
    // 3.6 radar: what the scanners cover, faintly
    if (radar) {
      const off = offscreen(size.w, size.h);
      const o = off.getContext('2d')!;
      o.clearRect(0, 0, size.w, size.h); o.fillStyle = '#2f9e5e';
      for (const sc of cachedScanners(game, me)) { if (sc.range <= 0) continue; const p = toScreen(sc.x, sc.y); o.beginPath(); o.arc(p.x, p.y, sc.range * z, 0, Math.PI * 2); o.fill(); }
      ctx.globalAlpha = 0.13; ctx.drawImage(off, 0, 0); ctx.globalAlpha = 1;
    }
    if (v.scan && !plain) {
      const scanners = cachedScanners(game, me);
      const factor = 1 - v.scanPct / 100;
      const off = offscreen(size.w, size.h);
      const o = off.getContext('2d')!;
      o.clearRect(0, 0, size.w, size.h);
      o.fillStyle = '#a3141c';
      for (const sc of scanners) { if (sc.range <= 0) continue; const p = toScreen(sc.x, sc.y); o.beginPath(); o.arc(p.x, p.y, sc.range * factor * z, 0, Math.PI * 2); o.fill(); }
      const wash = Math.max(0.15, Math.min(0.28, 0.28 - (z - 1.5) * 0.05));
      ctx.globalAlpha = wash; ctx.drawImage(off, 0, 0); ctx.globalAlpha = 1;
      o.clearRect(0, 0, size.w, size.h); o.fillStyle = '#d6b21c';
      let anyPen = false;
      for (const sc of scanners) { if (sc.pen <= 0) continue; anyPen = true; const p = toScreen(sc.x, sc.y); o.beginPath(); o.arc(p.x, p.y, sc.pen * factor * z, 0, Math.PI * 2); o.fill(); }
      if (anyPen) { ctx.globalAlpha = wash + 0.02; ctx.drawImage(off, 0, 0); ctx.globalAlpha = 1; }
    }
    // Constellations 3.3: cultural territories, smooth borders traced on the influence field (over the scanner wash)
    if (cultureOn(game) && v.borders !== false) drawTerritories(ctx, game, me, dpr, size, s.camera);
    // 3.6: the dark clouds, over everything that is not an object (nothing lives inside them)
    drawClouds(ctx, game, toScreen, z);
    // 0.3.7: the hidden stars this empire found (the way into the veiled star, the hidden cluster, danger zones)
    if (game.secrets?.length) drawSecrets(ctx, game, me, toScreen, z);
    // 0.3.9: announced cataclysms (everyone sees them)
    if (game.cataclysms?.length) drawCataclysms(ctx, game, toScreen, z);
    // minefields
    if (v.mines) {
      for (const m of Object.values(me.intel.minefields)) {
        const p = toScreen(m.x, m.y), r = Math.sqrt(m.mines) * z;
        const col = m.owner === me.id ? '79,179,255' : rgb(relationColor(game, me, m.owner));
        ctx.fillStyle = `rgba(${col},0.08)`; ctx.strokeStyle = `rgba(${col},0.6)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // grid hatching
        ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.clip();
        ctx.strokeStyle = `rgba(${col},0.18)`;
        const step = Math.max(6, 12 * Math.min(1.5, z));
        for (let k = -r; k <= r; k += step) { ctx.beginPath(); ctx.moveTo(p.x + k, p.y - r); ctx.lineTo(p.x + k, p.y + r); ctx.moveTo(p.x - r, p.y + k); ctx.lineTo(p.x + r, p.y + k); ctx.stroke(); }
        ctx.restore();
        if (m.type === 'speedBump') { ctx.fillStyle = `rgba(${col},0.8)`; ctx.font = '10px system-ui'; ctx.fillText('ralentisseur', p.x - 24, p.y - r - 3); }
      }
    }
    // wormholes
    if (v.wormholes) {
      for (const w of Object.values(me.intel.wormholes)) {
        const p = toScreen(w.x, w.y);
        if (w.destId !== undefined) {
          const d = me.intel.wormholes[w.destId];
          if (d && w.id < d.id) {
            const q = toScreen(d.x, d.y);
            ctx.strokeStyle = 'rgba(199,125,255,0.45)'; ctx.setLineDash([2, 5]); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
          }
        }
        drawWormhole(ctx, p.x, p.y, Math.max(5, 6 * Math.min(2, z)));
        // 0.3.7: the sealed wormhole of the hidden cluster
        if (game.wormholes.find(x => x.id === w.id)?.sealed) {
          const r = Math.max(5, 6 * Math.min(2, z)) + 3;
          ctx.strokeStyle = 'rgba(255,207,106,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#ffcf6a'; ctx.font = 'bold 10px system-ui'; ctx.fillText('scellé', p.x + r + 2, p.y + 3);
        }
      }
    }
    // packets
    for (const k of me.intel.packets) {
      const p = toScreen(k.x, k.y);
      const t = game.planets[k.targetId];
      if (k.owner === me.id && t) { const q = toScreen(t.x, t.y); ctx.strokeStyle = 'rgba(199,125,255,0.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = k.owner === me.id ? '#c77dff' : '#ff7ac8';
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 4, p.y); ctx.lineTo(p.x, p.y + 4); ctx.lineTo(p.x - 4, p.y); ctx.closePath(); ctx.fill();
    }
    for (const sv of me.intel.salvage) { const p = toScreen(sv.x, sv.y); ctx.strokeStyle = '#c0a070'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x - 3, p.y - 3); ctx.lineTo(p.x + 3, p.y + 3); ctx.moveTo(p.x + 3, p.y - 3); ctx.lineTo(p.x - 3, p.y + 3); ctx.stroke(); }
    for (const t of me.intel.traders) {
      const p = toScreen(t.x, t.y);
      // 3.6: its route, year by year (it keeps its course until it leaves the galaxy)
      const path = traderPositions(game, me, t.id, 10) ?? [];
      if (path.length && t.heading) {
        ctx.strokeStyle = 'rgba(255,210,74,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        for (const a of path) { const q = toScreen(a.x, a.y); ctx.lineTo(q.x, q.y); }
        ctx.stroke(); ctx.setLineDash([]);
        path.forEach((a, k) => { const q = toScreen(a.x, a.y); drawChevron(ctx, q.x, q.y, t.heading!, 'rgba(255,210,74,0.95)'); if (s.camera.zoom > 0.6) { ctx.fillStyle = 'rgba(255,210,74,0.8)'; ctx.font = '10px system-ui'; ctx.fillText(String(game.year + k + 1), q.x + 6, q.y - 6); } });
      }
      ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 14px system-ui'; ctx.fillText('✪', p.x - 6, p.y + 5);
    }
    // fleet paths
    const commandedFleet = s.commanded?.kind === 'fleet' ? game.fleets.find(f => f.id === s.commanded!.id) : undefined;
    if (v.paths) for (const f of game.fleets) if (f.owner === me.id && f !== commandedFleet && f.waypoints.length > 1) drawRoute(ctx, game, f, false);
    if (commandedFleet) drawRoute(ctx, game, commandedFleet, true);
    // route of commanded planet
    if (s.commanded?.kind === 'planet') {
      const pl = game.planets[s.commanded.id];
      if (pl.route !== undefined) { const a = toScreen(pl.x, pl.y), b = toScreen(game.planets[pl.route].x, game.planets[pl.route].y); ctx.strokeStyle = 'rgba(93,222,122,0.6)'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); }
      if (pl.packetTarget !== undefined) { const a = toScreen(pl.x, pl.y), b = toScreen(game.planets[pl.packetTarget].x, game.planets[pl.packetTarget].y); ctx.strokeStyle = 'rgba(199,125,255,0.7)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); }
    }
    // planets
    // ships in orbit: ours, and the others by relation (3.6: at peace apart from at war; uncertain counts in brackets)
    const fleetsByPlanet = new Map<number, { own: number; enemy: number; friend: number; peace: number; foreign: number; unsure: boolean }>();
    const orbitOf = (id: number) => { let e = fleetsByPlanet.get(id); if (!e) { e = { own: 0, enemy: 0, friend: 0, peace: 0, foreign: 0, unsure: false }; fleetsByPlanet.set(id, e); } return e; };
    if (!radar) for (const f of game.fleets) if (f.owner === me.id && f.orbiting >= 0) { const e = orbitOf(f.orbiting); if (passesFilter(f)) e.own += f.tokens.reduce((a, t) => a + t.qty, 0); }
    for (const fi of me.intel.fleets) if (fi.orbiting !== undefined) {
      if (radar && !radarById.has(fi.id)) continue;
      const e = orbitOf(fi.orbiting);
      const n = fi.tokens && !fi.uncertain ? fi.tokens.reduce((a, t) => a + t.qty, 0) : fi.count ?? 1;
      if (!fi.tokens || fi.uncertain || fi.identYear !== undefined) e.unsure = true;
      const rel = fi.owner >= 0 ? me.relations[fi.owner] : 'enemy';
      if (rel === 'friend') e.friend += n; else if (rel === 'neutral' && !game.players[fi.owner]?.monster) e.peace += n; else e.enemy += n;
      e.foreign += n;
    }
    ctx.font = `${Math.round(Math.min(13, Math.max(10, 9 + z * 1.5)))}px system-ui, sans-serif`;
    const labels: { text: string; x: number; y: number; col: string; prio: number }[] = [];
    for (const pl of game.planets) {
      const p = toScreen(pl.x, pl.y);
      if (p.x < -40 || p.y < -40 || p.x > size.w + 40 || p.y > size.h + 40) continue;
      const intel = me.intel.planets[pl.id];
      if (intel.unknown) continue; // 0.3.7: a hidden star this empire has not found
      if (pl.hidden && !plain) drawHiddenStar(ctx, pl.hidden, p.x, p.y, z);
      drawPlanet(ctx, game, me, pl, intel, p.x, p.y, z);
      const orb = fleetsByPlanet.get(pl.id);
      if (orb && v.mode !== 4 && !radar) {
        const r = 6 + Math.min(3, z);
        if (orb.own) { ctx.strokeStyle = '#7fc8ff'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); }
        if (orb.enemy) { ctx.strokeStyle = ENEMY_(); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
        if (orb.peace) { ctx.strokeStyle = PEACE; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(p.x, p.y, r + 4.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        if (orb.friend) { ctx.strokeStyle = FRIEND_(); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.stroke(); }
        if (v.counts) {
          let tx = p.x + r + 2;
          if (orb.own) { ctx.fillStyle = '#cfe6ff'; const t = String(orb.own); ctx.fillText(t, tx, p.y + r + 6); tx += ctx.measureText(t).width + 3; }
          if (orb.foreign) { ctx.fillStyle = orb.enemy ? ENEMY_() : orb.peace ? PEACE : FRIEND_(); ctx.fillText(orb.unsure ? `(${orb.foreign})` : String(orb.foreign), tx, p.y + r + 6); }
        }
      }
      if (v.names && !plain && z > 0.55) {
        const col = intel.owner !== undefined && intel.owner >= 0 ? (intel.owner === me.id ? '#e8ffe8' : game.players[intel.owner].color) : intel.year !== undefined ? '#b8c2d4' : '#6a7486';
        const prio = intel.owner === me.id ? 3 : intel.owner !== undefined && intel.owner >= 0 ? 2 : intel.year !== undefined ? 1 : 0;
        labels.push({ text: pl.name, x: p.x, y: p.y + 15 + Math.min(4, z), col, prio: s.selected?.kind === 'planet' && s.selected.id === pl.id ? 9 : prio });
      }
    }
    // discoveries and guardians (Constellations 3.2)
    if (game.anomalies?.length || game.guardians?.length || game.pirates || game.crisis) {
      ctx.font = `bold ${Math.round(9 + Math.min(4, z))}px system-ui`;
      for (const pl of game.planets) {
        const intel = me.intel.planets[pl.id];
        if (intel.unknown) continue;
        const guarded = !!intel.guardian;
        const lair = intel.lair;
        const anom = game.settings.anomalies ? anomalyAt(game, me, pl.id) : undefined;
        if (!guarded && !anom && !lair) continue;
        const p = toScreen(pl.x, pl.y);
        if (p.x < -40 || p.y < -40 || p.x > size.w + 40 || p.y > size.h + 40) continue;
        if (guarded) {
          const r = 9 + Math.min(4, z);
          ctx.strokeStyle = 'rgba(199,139,255,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 2]);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#d6a8ff'; ctx.fillText('⚠', p.x - r - 10, p.y - r + 4);
        }
        // 3.4: a pirate lair, the Breach of the crisis
        if (lair) {
          const r = 10 + Math.min(4, z);
          const col = lair === 'pirates' ? '201,123,60' : '255,47,176';
          ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 2; ctx.setLineDash(lair === 'pirates' ? [5, 3] : [2, 2]);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = `rgb(${col})`; ctx.fillText(lair === 'pirates' ? '☠' : '✹', p.x + r + 1, p.y - r + 4);
        }
        if (anom) {
          const site = isSite(anom);
          ctx.fillStyle = site ? '#ffcf6a' : '#7ff0e0';
          ctx.fillText(site ? '✦' : '?', p.x - 3, p.y - 9 - Math.min(4, z));
        }
      }
    }
    // seats of government and megaprojects
    for (const pl of seats) {
      const p = toScreen(pl.x, pl.y);
      ctx.fillStyle = '#e8c547'; ctx.font = `bold ${Math.round(10 + Math.min(4, z))}px system-ui`;
      // 3.6: on the left of the planet (what stands in orbit is drawn on its right)
      ctx.textAlign = 'right'; ctx.fillText(pl.regionalCapital ? '◆' : '★', p.x - 7, p.y - 6); ctx.textAlign = 'left';
    }
    const portal = game.settings.megaprojects ? portalThreat(game) : null;
    const portals = portal && (portal.owner === me.id || portal.announced > 0) ? [portal] : [];
    for (const pt of portals) {
      const p = toScreen(pt.planet.x, pt.planet.y);
      const pulse = 12 + 3 * Math.sin(Date.now() / 300);
      ctx.strokeStyle = 'rgba(232,197,71,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e8c547'; ctx.font = 'bold 11px system-ui';
      ctx.fillText(`Portail ${pt.owner === me.id ? Math.floor(pt.progress * 100) : pt.announced} %`, p.x + pulse + 3, p.y + 4);
    }
    // 3.4: raids announced against my worlds (the informants name the target)
    if (game.pirates?.emerged && !game.pirates.ended) for (const f of raidsAgainst(game, me.id)) {
      const t = game.planets[f.raid!.target];
      const pt = toScreen(t.x, t.y);
      const pulse = 13 + 2 * Math.sin(Date.now() / 250);
      ctx.strokeStyle = 'rgba(230,120,50,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pulse, 0, Math.PI * 2); ctx.stroke();
      const seen = me.intel.fleets.find(x => x.id === f.id);
      if (seen) { const a = toScreen(seen.x, seen.y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(pt.x, pt.y); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = '#f0a060'; ctx.font = 'bold 11px system-ui';
      ctx.fillText(f.raid!.phase === 'siege' ? 'Raid pirate !' : `Raid vers ${game.year + etaYears(game, f, t)}`, pt.x + pulse + 3, pt.y + 14);
    }
    // 3.4: the waves of the crisis heading for my worlds
    if (game.crisis?.phase === 'active') for (const f of waves(game)) {
      if (f.raid!.empire !== me.id) continue;
      const seen = me.intel.fleets.find(x => x.id === f.id);
      const t = game.planets[f.raid!.target];
      const pt = toScreen(t.x, t.y);
      ctx.strokeStyle = 'rgba(255,47,176,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 15, 0, Math.PI * 2); ctx.stroke();
      if (seen) { const a = toScreen(seen.x, seen.y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(pt.x, pt.y); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff7fd0'; ctx.font = 'bold 11px system-ui';
      ctx.fillText(f.name, pt.x + 18, pt.y + 14);
    }
    ctx.font = `${Math.round(Math.min(13, Math.max(10, 9 + z * 1.5)))}px system-ui, sans-serif`;
    // names: most important first, skipping those that would overlap an already placed label
    if (labels.length) {
      labels.sort((a, b) => b.prio - a.prio);
      const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const fh = parseInt(ctx.font, 10) || 11;
      for (const l of labels) {
        const tw = ctx.measureText(l.text).width;
        const r = { x1: l.x - tw / 2 - 1, y1: l.y - fh + 1, x2: l.x + tw / 2 + 1, y2: l.y + 2 };
        if (l.prio < 9 && placed.some(o => r.x1 < o.x2 && r.x2 > o.x1 && r.y1 < o.y2 && r.y2 > o.y1)) continue;
        placed.push(r);
        ctx.fillStyle = l.col;
        ctx.fillText(l.text, l.x - tw / 2, l.y);
      }
    }
    // fleets in space
    for (const f of game.fleets) {
      if (radar || f.owner !== me.id || f.orbiting >= 0 || !passesFilter(f)) continue;
      const p = toScreen(f.x, f.y);
      drawArrow(ctx, p.x, p.y, f.heading, f === commandedFleet ? '#ffffff' : '#7fc8ff', f.waypoints.length > 1);
      if (v.counts) { ctx.fillStyle = '#cfe6ff'; ctx.fillText(String(f.tokens.reduce((a, t) => a + t.qty, 0)), p.x + 7, p.y + 10); }
    }
    for (const fi of me.intel.fleets) {
      if (radar) continue; // drawn by the radar below
      if (fi.orbiting !== undefined) continue;
      const p = toScreen(fi.x, fi.y);
      const col = fi.owner < 0 ? '#ff9a3d' : relationColor(game, me, fi.owner);
      const heading = fi.heading ?? estimateHeading(me, fi.id);
      // 3.6: filled with the empire's colour, outlined with the relation (war, peace, alliance)
      const fill = fi.owner >= 0 && !game.players[fi.owner]?.monster ? game.players[fi.owner].color : col;
      drawArrow(ctx, p.x, p.y, heading, fill, !!heading, col);
      // ship count: exact when identified this year, in brackets when estimated or followed since an older identification
      const n = fi.tokens && !fi.uncertain ? fi.tokens.reduce((a, t) => a + t.qty, 0) : fi.count;
      if (v.counts && n) { ctx.fillStyle = col; ctx.fillText(fi.uncertain || fi.identYear !== undefined || !fi.tokens ? `(${n})` : String(n), p.x + 7, p.y + 10); }
    }
    // 3.6 radar: hostile contacts only; the threats in red, with the course that brings them to us
    if (radar) {
      ctx.font = `bold ${Math.round(10 + Math.min(3, z))}px system-ui, sans-serif`;
      for (const c of [...radar].sort((a, b) => (a.threat ? 1 : 0) - (b.threat ? 1 : 0))) {
        const fi = me.intel.fleets.find(x => x.id === c.id)!;
        const p = toScreen(c.x, c.y);
        const col = c.threat ? '#ff3030' : c.owner < 0 ? '#a99b7d' : '#e8a33a';
        if (c.threat && c.path && c.path.length > 1) {
          ctx.strokeStyle = 'rgba(255,48,48,0.75)'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
          ctx.beginPath(); c.path.forEach((q, i) => { const a = toScreen(q.x, q.y); if (i === 0) ctx.moveTo(a.x, a.y); else ctx.lineTo(a.x, a.y); });
          ctx.stroke(); ctx.setLineDash([]);
          // where it enters our space
          const end = toScreen(c.path[c.path.length - 1].x, c.path[c.path.length - 1].y);
          ctx.fillStyle = 'rgba(255,48,48,0.9)'; ctx.beginPath(); ctx.arc(end.x, end.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        if (c.threat) {
          ctx.strokeStyle = 'rgba(255,48,48,0.9)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,48,48,0.35)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.stroke();
        }
        if (fi.orbiting === undefined) drawArrow(ctx, p.x, p.y, fi.heading ?? estimateHeading(me, fi.id), col, true, c.threat ? '#ffd0d0' : undefined);
        else { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 7 + Math.min(3, z), 0, Math.PI * 2); ctx.stroke(); }
        const n = fi.tokens && !fi.uncertain ? fi.tokens.reduce((a, t) => a + t.qty, 0) : fi.count;
        const parts: string[] = [];
        if (n) parts.push(fi.uncertain || fi.identYear !== undefined || !fi.tokens ? `(${n})` : String(n));
        if (c.threat === 'inside') parts.push(c.target && fi.orbiting === c.target.id ? `en orbite de ${c.target.name}` : 'sur votre territoire');
        else if (c.threat === 'heading' && c.target) parts.push(c.eta ? `→ ${c.target.name} · ${c.eta} a` : `→ ${c.target.name}`);
        if (parts.length) {
          // above the contact, outlined so it reads over the course and the borders
          const t = parts.join(' ');
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(3,5,11,0.85)'; ctx.strokeText(t, p.x + 12, p.y - 9);
          ctx.fillStyle = col; ctx.fillText(t, p.x + 12, p.y - 9);
        }
      }
    }
    // estimated trajectories of foreign fleets (from observed positions only)
    if (v.enemyTracks && !radar) {
      for (const fi of me.intel.fleets) {
        const tr = estimateTrajectory(me, fi.id, 3);
        if (!tr) continue;
        ctx.strokeStyle = 'rgba(255,154,61,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath();
        tr.from.forEach((o, i) => { const q = toScreen(o.x, o.y); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
        ctx.stroke(); ctx.setLineDash([]);
        const last = toScreen(tr.from[tr.from.length - 1].x, tr.from[tr.from.length - 1].y);
        ctx.strokeStyle = 'rgba(255,154,61,0.8)';
        ctx.beginPath(); ctx.moveTo(last.x, last.y);
        for (const a of tr.ahead) { const q = toScreen(a.x, a.y); ctx.lineTo(q.x, q.y); }
        ctx.stroke();
        const dir = { x: tr.ahead[0].x - tr.from[tr.from.length - 1].x, y: tr.ahead[0].y - tr.from[tr.from.length - 1].y };
        for (const a of tr.ahead) { const q = toScreen(a.x, a.y); drawChevron(ctx, q.x, q.y, dir, 'rgba(255,154,61,0.9)'); }
      }
    }
    // 3.6: the patrol radius of the selected fleet (drag its handle to change it)
    if (commandedFleet && s.selected?.kind === 'fleet' && s.selected.id === commandedFleet.id) {
      const f = commandedFleet, rd = routeDrag.current;
      f.waypoints.forEach((w, i) => {
        if (w.task !== 'patrol' && w.task !== 'refuel') return;
        const live = rd && rd.h.kind === 'radius' && rd.h.i === i && dragPt ? Math.max(10, Math.min(1000, Math.round(distance(w, dragPt) / 5) * 5)) : patrolRadiusOf(game, f, i);
        const c = toScreen(w.x, w.y), R = live * s.camera.zoom;
        const col = w.task === 'patrol' ? '127,200,255' : '47,158,126';
        ctx.fillStyle = `rgba(${col},0.06)`; ctx.strokeStyle = `rgba(${col},0.8)`; ctx.lineWidth = 1.3; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(c.x + R, c.y, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.font = '11px system-ui'; ctx.fillText(`${w.task === 'patrol' ? 'Patrouille' : 'Ravitaillement'} · ${live} al`, c.x + R + 8, c.y + 4);
      });
    }
    // route editing: hovered handle and drag preview
    if (commandedFleet && s.selected?.kind === 'fleet' && s.selected.id === commandedFleet.id) {
      if (hoverHandle && !routeDrag.current) {
        const q = toScreen(hoverHandle.x, hoverHandle.y);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.stroke();
      }
      const rd = routeDrag.current;
      if (rd && dragPt && rd.fleet === commandedFleet.id && rd.h.kind !== 'radius') {
        const f = commandedFleet, i = rd.h.i;
        const a = i - 1 <= 0 ? { x: f.x, y: f.y } : f.waypoints[i - 1];
        const b = rd.h.kind === 'wp' ? f.waypoints[i + 1] : f.waypoints[i];
        const pa = toScreen(a.x, a.y), pd = toScreen(dragPt.x, dragPt.y);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pd.x, pd.y);
        if (b) { const pb = toScreen(b.x, b.y); ctx.lineTo(pb.x, pb.y); }
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(pd.x, pd.y - 5); ctx.lineTo(pd.x + 5, pd.y); ctx.lineTo(pd.x, pd.y + 5); ctx.lineTo(pd.x - 5, pd.y); ctx.closePath(); ctx.fill();
        if (dragPt.snap) { ctx.strokeStyle = dragPt.track ? '#ff9a3d' : '#4fd6e3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pd.x, pd.y, 10, 0, Math.PI * 2); ctx.stroke(); }
        // the year the fleet would get there, and for an interception, the year the target is expected
        const wps = f.waypoints.map(w => ({ ...w }));
        const moved = { ...(rd.h.kind === 'wp' ? wps[i] : (wps[i] ?? wps[wps.length - 1])), x: Math.round(dragPt.x), y: Math.round(dragPt.y), target: 'space' as const, targetId: undefined, task: rd.h.kind === 'wp' ? wps[i].task : 'none' as const, stop: dragPt.track ? true : undefined };
        if (rd.h.kind === 'wp') wps[i] = moved; else wps.splice(i, 0, moved);
        const arr = estimateRoute(game, f, wps)[i - 1]?.arrival;
        const lines = [`${fmt(distance(a, dragPt), 0)} al${arr !== undefined && Number.isFinite(arr) ? ` · arrivée ${game.year + arr}` : ''}`];
        let col = '#ffffff';
        if (dragPt.track && arr !== undefined) {
          const ty = game.year + dragPt.track.k, my = game.year + arr;
          lines.push(`${dragPt.track.name} attendu en ${ty}`);
          lines.push(my === ty ? 'Interception : même année ✓' : my < ty ? `En avance de ${ty - my} an${ty - my > 1 ? 's' : ''} (attente sur place)` : `Trop tard de ${my - ty} an${my - ty > 1 ? 's' : ''}`);
          col = my === ty ? '#5ee08a' : my < ty ? '#ffd24a' : '#ff7a59';
        }
        ctx.font = '11px system-ui';
        lines.forEach((t, k) => { ctx.fillStyle = k === 2 ? col : '#ffffff'; ctx.fillText(t, pd.x + 12, pd.y + 16 + k * 13); });
      }
    }
    // selection marker
    if (s.selected) {
      const pos = refPos(game, me, s.selected);
      if (pos) {
        const p = toScreen(pos.x, pos.y);
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath(); ctx.moveTo(p.x, p.y + 9); ctx.lineTo(p.x - 5, p.y + 17); ctx.lineTo(p.x + 5, p.y + 17); ctx.closePath(); ctx.fill();
      }
    }
    if (ruler) {
      const a = toScreen(ruler.a.x, ruler.a.y), b = toScreen(ruler.b.x, ruler.b.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      for (const q of [a, b]) { ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
      // the distance, on a dark label at the cursor end, with the names when the ends are on objects
      const dist = distance(ruler.a, ruler.b);
      const main = `${fmt(dist, 1)} al`;
      const sub = ruler.la || ruler.lb ? `${ruler.la ?? 'espace'} → ${ruler.lb ?? 'espace'}` : '';
      ctx.font = 'bold 13px system-ui, sans-serif';
      const w1 = ctx.measureText(main).width;
      ctx.font = '11px system-ui, sans-serif';
      const w2 = sub ? ctx.measureText(sub).width : 0;
      const bw = Math.max(w1, w2) + 14, bh = sub ? 36 : 22;
      const lx = Math.min(size.w - bw - 4, b.x + 12), ly = Math.max(4, b.y - bh - 8);
      ctx.fillStyle = 'rgba(6,12,22,0.88)'; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect?.(lx, ly, bw, bh, 5); if (!ctx.roundRect) ctx.rect(lx, ly, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui, sans-serif'; ctx.fillText(main, lx + 7, ly + 16);
      if (sub) { ctx.fillStyle = 'rgba(220,230,245,0.75)'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(sub, lx + 7, ly + 30); }
    }

    function passesFilter(f: Fleet): boolean {
      if (v.idleOnly && f.waypoints.length > 1) return false;
      if (v.designFilter !== null && !f.tokens.some(t => t.designId === v.designFilter)) return false;
      return true;
    }

    function drawRoute(c: CanvasRenderingContext2D, g: GameState, f: Fleet, selected: boolean) {
      const est = viewRoute(g, f);
      let prev = { x: f.x, y: f.y };
      for (let i = 1; i < f.waypoints.length; i++) {
        const wp = f.waypoints[i];
        const a = toScreen(prev.x, prev.y), b = toScreen(wp.x, wp.y);
        const mines = selected && wp.warp < 11 && minefieldsOnLeg(g, store.me!, prev, wp).some(m => wp.warp > m.safeWarp);
        const bad = (est[i - 1] && !est[i - 1].ok) || mines;
        c.strokeStyle = bad ? '#ff5d5d' : selected ? (i === s.waypointIndex ? '#ffffff' : '#9fd4ff') : 'rgba(127,200,255,0.45)';
        c.lineWidth = selected ? 1.6 : 1;
        if (wp.warp >= 11) c.setLineDash([8, 4]);
        // 3.6: around the dark clouds, through the points of the detour
        const poly = [prev, ...(est[i - 1]?.via ?? []), wp];
        c.beginPath(); c.moveTo(a.x, a.y); for (const q of poly.slice(1)) { const t = toScreen(q.x, q.y); c.lineTo(t.x, t.y); } c.stroke(); c.setLineDash([]);
        // year chevrons: where the fleet will be at the end of each year (turns in deep space cost no time)
        if (selected && wp.warp > 0 && wp.warp < 11 && est[i - 1]) {
          for (const p of est[i - 1].yearEnds) {
            // the direction of the stretch of the route the point is on
            let dir = { x: wp.x - prev.x, y: wp.y - prev.y }, best = Infinity;
            for (let k = 0; k < poly.length - 1; k++) { const d = segDist(p, poly[k], poly[k + 1]); if (d < best) { best = d; dir = { x: poly[k + 1].x - poly[k].x, y: poly[k + 1].y - poly[k].y }; } }
            const q = toScreen(p.x, p.y); drawChevron(c, q.x, q.y, dir, bad ? '#ff5d5d' : '#cfe6ff');
          }
        }
        // waypoint marker: filled diamond = stop, hollow = crossed without stopping; a point of a detour: a small dot
        const pass = est[i - 1]?.pass;
        c.fillStyle = c.strokeStyle = selected ? (i === s.waypointIndex ? '#ffffff' : '#4fb3ff') : 'rgba(127,200,255,0.6)';
        if (wp.detour) { c.beginPath(); c.arc(b.x, b.y, 2, 0, Math.PI * 2); c.fill(); prev = wp; continue; }
        c.beginPath(); c.moveTo(b.x, b.y - 4); c.lineTo(b.x + 4, b.y); c.lineTo(b.x, b.y + 4); c.lineTo(b.x - 4, b.y); c.closePath();
        if (pass) { c.lineWidth = 1.4; c.fillStyle = '#0b1020'; c.fill(); c.stroke(); } else c.fill();
        if (selected && est[i - 1]) {
          c.fillStyle = bad ? '#ff8080' : '#cfe6ff'; c.font = '11px system-ui';
          const sealed = wp.target === 'wormhole' && g.wormholes.find(x => x.id === wp.targetId)?.sealed;
          c.fillText(`${pass ? '↷ ' : ''}${est[i - 1].arrival} a${est[i - 1].ok ? '' : ' ⚠ carburant'}${mines ? ' ⚠ mines' : ''}${sealed ? ' ⚠ scellé' : wp.target === 'wormhole' && !canUseWormholes(store.me!) ? ' ⚠ traversée verrouillée' : ''}`, b.x + 7, b.y - 7);
        }
        prev = wp;
        // 0.3.7: through a wormhole whose exit is known, the route goes on from the exit
        if (wp.target === 'wormhole' && wp.targetId !== undefined) {
          const wh = g.wormholes.find(x => x.id === wp.targetId), known = store.me!.intel.wormholes;
          const exit = wh && !wh.sealed && known[wh.id]?.destId === wh.destId ? known[wh.destId] : undefined;
          if (exit) prev = { ...wp, x: exit.x, y: exit.y };
        }
      }
      if (f.repeat && f.waypoints.length > 1) {
        const a = toScreen(prev.x, prev.y), b = toScreen(f.waypoints[0].x, f.waypoints[0].y);
        c.strokeStyle = 'rgba(159,212,255,0.35)'; c.setLineDash([2, 6]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
      }
    }
  }

  function hits(sx: number, sy: number, R = 9): Hit[] {
    const game = s.game, me = s.me;
    if (!game || !me) return [];
    const res: Hit[] = [];
    for (const pl of game.planets) { if (me.intel.planets[pl.id].unknown) continue; const p = toScreen(pl.x, pl.y); if (Math.hypot(p.x - sx, p.y - sy) <= R) res.push({ ref: { kind: 'planet', id: pl.id }, label: pl.name, x: pl.x, y: pl.y }); }
    for (const f of game.fleets) if (f.owner === me.id) { const p = toScreen(f.x, f.y); if (Math.hypot(p.x - sx, p.y - sy) <= R) res.push({ ref: { kind: 'fleet', id: f.id }, label: f.name, x: f.x, y: f.y }); }
    for (const fi of me.intel.fleets) { const p = toScreen(fi.x, fi.y); if (Math.hypot(p.x - sx, p.y - sy) <= R) res.push({ ref: { kind: 'fleet', id: fi.id }, label: fi.detail === 'full' ? `${fi.name} (${game.players[fi.owner].name})${fi.identYear !== undefined && fi.identYear < game.year ? ` · identifiée en ${fi.identYear}` : ''}` : fi.uncertain ? `${fi.owner >= 0 ? `Flotte des ${game.players[fi.owner].name}` : 'Contact'} · ≈ ${fi.mass} kt, ≈ ${fi.count} vaisseau${(fi.count ?? 0) > 1 ? 'x' : ''}` : 'Contact inconnu', x: fi.x, y: fi.y }); }
    for (const w of Object.values(me.intel.wormholes)) { const p = toScreen(w.x, w.y); if (Math.hypot(p.x - sx, p.y - sy) <= R + 2) res.push({ ref: { kind: 'wormhole', id: w.id }, label: game.wormholes.find(x => x.id === w.id)?.sealed ? 'Trou de ver scellé' : 'Trou de ver', x: w.x, y: w.y }); }
    for (const k of me.intel.packets) { const p = toScreen(k.x, k.y); if (Math.hypot(p.x - sx, p.y - sy) <= R) res.push({ ref: { kind: 'packet', id: k.id }, label: `Paquet (${k.mass} kt)`, x: k.x, y: k.y }); }
    for (const k of me.intel.salvage) { const p = toScreen(k.x, k.y); if (Math.hypot(p.x - sx, p.y - sy) <= R) res.push({ ref: { kind: 'salvage', id: k.id }, label: `Épave (${k.mass} kt)`, x: k.x, y: k.y }); }
    for (const t of me.intel.traders) { const p = toScreen(t.x, t.y); if (Math.hypot(p.x - sx, p.y - sy) <= R + 3) res.push({ ref: { kind: 'trader', id: t.id }, label: 'Marchand nomade', x: t.x, y: t.y }); }
    if (!res.length) {
      const w = toWorld(sx, sy);
      for (const m of Object.values(me.intel.minefields)) if (distance(m, w) <= Math.sqrt(m.mines)) res.push({ ref: { kind: 'minefield', id: m.id }, label: `Champ de mines (${game.players[m.owner].name})`, x: m.x, y: m.y });
    }
    return res;
  }

  function editableFleet(): Fleet | undefined {
    const f = commandedFleet();
    return f && s.selected?.kind === 'fleet' && s.selected.id === f.id ? f : undefined;
  }
  function handleAt(sx: number, sy: number, R: number): RouteHandle | null {
    const f = editableFleet(); if (!f) return null;
    let best: RouteHandle | null = null, bd = R;
    for (const h of routeHandles(store.game!, f)) {
      const q = toScreen(h.x, h.y);
      const d = Math.hypot(q.x - sx, q.y - sy) - (h.kind === 'wp' ? 1.5 : 0); // waypoints win ties
      if (d <= bd) { bd = d; best = h; }
    }
    return best;
  }
  /** Nearest chevron of a foreign fleet's estimated trajectory within R pixels (magnetic for interceptions). */
  function trackSnapAt(sx: number, sy: number, R = 14): TrackSnap | null {
    if (!s.view.enemyTracks || !s.me) return null;
    let best: TrackSnap | null = null, bd = R;
    for (const t of trackPoints(s.me, s.game ?? undefined)) { const q = toScreen(t.x, t.y); const d = Math.hypot(q.x - sx, q.y - sy); if (d <= bd) { bd = d; best = t; } }
    return best;
  }

  function dropTarget(sx: number, sy: number, fleetId: number): { ref: ObjRef; pos: { x: number; y: number }; snap: boolean; track?: TrackSnap } {
    const h = hits(sx, sy).filter(x => x.ref.kind === 'planet' || x.ref.kind === 'wormhole' || x.ref.kind === 'trader' || (x.ref.kind === 'fleet' && x.ref.id !== fleetId));
    const t = h.find(x => x.ref.kind === 'planet') ?? h[0];
    const ts = trackSnapAt(sx, sy);
    if (ts) {
      const qt = toScreen(ts.x, ts.y), qh = t ? toScreen(t.x, t.y) : null;
      if (!qh || Math.hypot(qt.x - sx, qt.y - sy) <= Math.hypot(qh.x - sx, qh.y - sy)) return { ref: { kind: 'space', id: -1, x: Math.round(ts.x), y: Math.round(ts.y) }, pos: { x: Math.round(ts.x), y: Math.round(ts.y) }, snap: true, track: ts };
    }
    if (t) return { ref: t.ref, pos: { x: t.x, y: t.y }, snap: true };
    const w = toWorld(sx, sy);
    return { ref: { kind: 'space', id: -1, x: Math.round(w.x), y: Math.round(w.y) }, pos: { x: Math.round(w.x), y: Math.round(w.y) }, snap: false };
  }

  // Pointer handling: mouse, pen and touch (drag to pan, pinch to zoom, long press = context menu).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number; wx: number; wy: number } | null>(null);
  const press = useRef<{ t: number; timer: number } | null>(null);
  // 0.3.9: the interface may be zoomed (text size): the pointer comes in screen pixels, the map counts in its own
  const local = (e: MouseEvent) => { const el = (e.currentTarget as HTMLElement); const r = el.getBoundingClientRect(); const z = el.offsetWidth ? r.width / el.offsetWidth : 1; return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z }; };
  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  const onPointerDown = (e: PointerEvent) => {
    setMenu(null);
    if (e.pointerType === 'mouse' && e.button === 2) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.current.size === 2) {
      const st = pinchState(); const w = toWorld(st.cx, st.cy);
      pinch.current = { d: st.d, zoom: s.camera.zoom, wx: w.x, wy: w.y };
      drag.current = null; if (press.current) { clearTimeout(press.current.timer); press.current = null; }
      return;
    }
    if (e.button === 0 && e.shiftKey && e.altKey) { const w = snapPoint(p.x, p.y); measure.current = w; setRuler({ a: w, b: w, la: w.label }); return; }
    if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !s.wpMode) {
      const rh = handleAt(p.x, p.y, e.pointerType === 'mouse' ? 7 : 14);
      if (rh) { routeDrag.current = { h: rh, fleet: editableFleet()!.id, sx: p.x, sy: p.y, moved: false }; drag.current = null; setHover(null); return; }
    }
    drag.current = { x: e.clientX, y: e.clientY, cx: s.camera.x, cy: s.camera.y, moved: false };
    // 3.3.6: Ctrl (or Cmd) + drag measures a distance; Ctrl + click without moving keeps its usual meaning
    if (e.button === 0 && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.pointerType === 'mouse') drag.current.ruler = snapPoint(p.x, p.y);
    if (e.pointerType !== 'mouse') {
      const timer = window.setTimeout(() => {
        if (drag.current && !drag.current.moved) {
          drag.current = null; press.current = null;
          const h = hits(p.x, p.y, 16); const w = toWorld(p.x, p.y);
          setMenu({ x: Math.min(p.x, size.w - 210), y: Math.min(p.y, size.h - 160), items: h, wx: w.x, wy: w.y });
        }
      }, 550);
      press.current = { t: Date.now(), timer };
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size >= 2) {
      const st = pinchState(); const pc = pinch.current;
      const nz = Math.max(0.15, Math.min(12, pc.zoom * st.d / pc.d));
      s.setCamera({ zoom: nz, x: pc.wx - (st.cx - size.w / 2) / nz, y: pc.wy - (st.cy - size.h / 2) / nz });
      return;
    }
    if (measure.current) { const b = snapPoint(p.x, p.y); setRuler({ a: measure.current, b, la: (measure.current as { label?: string }).label, lb: (b as { label?: string }).label }); return; }
    const rd = routeDrag.current;
    if (rd) {
      if (!rd.moved && Math.hypot(p.x - rd.sx, p.y - rd.sy) > 4) rd.moved = true;
      if (rd.moved) { if (rd.h.kind === 'radius') { const w = toWorld(p.x, p.y); setDragPt({ x: w.x, y: w.y, snap: false }); } else { const t = dropTarget(p.x, p.y, rd.fleet); setDragPt({ ...t.pos, snap: t.snap, track: t.track }); } }
      return;
    }
    const d = drag.current;
    if (d) {
      const dx = (e.clientX - d.x) / (uiPrefs.textScale || 1), dy = (e.clientY - d.y) / (uiPrefs.textScale || 1);
      if (Math.abs(dx) + Math.abs(dy) > (e.pointerType === 'mouse' ? 4 : 10)) d.moved = true;
      if (d.moved && d.ruler) { measure.current = d.ruler; drag.current = null; const b = snapPoint(p.x, p.y); setRuler({ a: d.ruler, b, la: (d.ruler as { label?: string }).label, lb: (b as { label?: string }).label }); return; }
      if (d.moved) s.setCamera({ ...s.camera, x: d.cx - dx / s.camera.zoom, y: d.cy - dy / s.camera.zoom });
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const hh = e.shiftKey ? null : handleAt(p.x, p.y, 7);
    if (hh?.kind !== hoverHandle?.kind || hh?.i !== hoverHandle?.i || hh?.x !== hoverHandle?.x) setHoverHandle(hh);
    if (hh && hh.kind === 'leg') { setHover({ x: p.x, y: p.y, text: ['Glisser pour ajouter une étape ici'] }); return; }
    if (hh && hh.kind === 'radius') { setHover({ x: p.x, y: p.y, text: ['Rayon d\'action', 'Glisser pour l\'agrandir ou le réduire'] }); return; }
    const h = hits(p.x, p.y);
    const tsn = !h.length && !hh ? trackSnapAt(p.x, p.y, 8) : null;
    if (tsn) { setHover({ x: p.x, y: p.y, text: [tsn.name, `Position estimée en ${s.game!.year + tsn.k}`, 'Point d\'interception : glissez-y une étape (aimantée)'] }); return; }
    const cata = !h.length && !hh && s.game!.cataclysms?.length ? cataclysmTip(s.game!, toWorld(p.x, p.y)) : null;
    if (cata) { setHover({ x: p.x, y: p.y, text: cata }); return; }
    const ter = !h.length && !hh ? terrainAt(s.game!, toWorld(p.x, p.y)) : [];
    if (ter.length) { setHover({ x: p.x, y: p.y, text: ter.flatMap(t => [terrainName(t), TERRAIN_INFO[t.kind].effect]) }); return; }
    const wp0 = !h.length && !hh ? toWorld(p.x, p.y) : null;
    const cloud = wp0 ? wallAt(s.game!, wp0.x, wp0.y) : null;
    if (cloud && wp0 && openFor(s.game!, s.me!.id, wp0.x, wp0.y)) { setHover({ x: p.x, y: p.y, text: [`Couloir à travers ${cloud}`, 'Poussière raréfiée : on y vole à Warp 3 au plus. Vous seul connaissez ce passage.'] }); return; }
    const zone = wp0 && !cloud ? probeZoneAt(s.game!, s.me!, wp0) : null;
    if (zone) { setHover({ x: p.x, y: p.y, text: ['Zone de sondage', `Quelque part au bord du nuage s'ouvre un passage vers ${s.game!.planets[zone.ids[0]].name}. Une flotte équipée d'un scanner qui stationne ici le trouve (${zone.probe?.[s.me!.id] ?? 0} / ${PROBE_NEED} points).`] }); return; }
    if (cloud) { setHover({ x: p.x, y: p.y, text: [upperFirst(cloud), 'Nuage sombre, infranchissable : à vitesse Warp, chaque grain de poussière frappe comme un obus. Les flottes le contournent.'] }); return; }
    if (h.length) setHover({ x: p.x, y: p.y, text: hh ? [...tooltipFor(h[0]), 'Glisser pour déplacer l\'étape'] : tooltipFor(h[0]) });
    else if (hh) setHover({ x: p.x, y: p.y, text: ['Étape · glisser pour la déplacer'] });
    else if (hover) setHover(null);
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (press.current) { clearTimeout(press.current.timer); press.current = null; }
    if (pinch.current) { if (pointers.current.size < 2) pinch.current = null; drag.current = null; return; }
    if (measure.current) { measure.current = null; setTimeout(() => setRuler(null), 2500); return; }
    const rd = routeDrag.current;
    let fromHandle = false;
    if (rd) {
      routeDrag.current = null; setDragPt(null); setHoverHandle(null);
      const p = local(e);
      if (rd.moved && rd.h.kind === 'radius') {
        const f = s.game!.fleets.find(x => x.id === rd.fleet);
        if (f && f.waypoints[rd.h.i]) { const w = toWorld(p.x, p.y); setPatrolRange(f, rd.h.i, Math.max(10, Math.min(1000, Math.round(distance(f.waypoints[rd.h.i], w) / 5) * 5))); }
        return;
      }
      if (rd.moved) {
        const t = dropTarget(p.x, p.y, rd.fleet);
        if (rd.h.kind === 'wp') moveWaypoint(rd.h.i, t.ref, t.pos); else insertWaypoint(rd.h.i, t.ref, t.pos);
        if (t.track) markIntercept(t.track.name, s.game!.year + t.track.k);
        return;
      }
      // plain click on a waypoint: first click selects the step, a second one selects what lies there
      if (rd.h.kind === 'radius') return;
      if (rd.h.kind === 'wp' && s.waypointIndex !== rd.h.i) { s.waypointIndex = rd.h.i; s.bump(); return; }
      fromHandle = true;
    }
    const d = drag.current;
    drag.current = null;
    if (!fromHandle && (!d || d.moved || e.button !== 0)) return;
    const game = s.game; if (!game) return;
    const p = local(e);
    const h = hits(p.x, p.y, e.pointerType === 'mouse' ? undefined : 16);
    const w = toWorld(p.x, p.y);
    if ((e.shiftKey || s.wpMode) && s.commanded?.kind === 'fleet' && s.selected?.kind === 'fleet' && s.selected.id === s.commanded.id) {
      const target = h.find(x => x.ref.kind === 'planet') ?? h.find(x => x.ref.kind === 'wormhole') ?? h.find(x => x.ref.kind === 'fleet' && x.ref.id !== s.commanded!.id) ?? h.find(x => x.ref.kind === 'trader');
      const dt = dropTarget(p.x, p.y, s.commanded.id);
      if (dt.track) { routeClick(dt.ref, dt.pos, e.ctrlKey || e.metaKey); markIntercept(dt.track.name, game.year + dt.track.k); return; }
      routeClick(target ? target.ref : { kind: 'space', id: -1, x: Math.round(w.x), y: Math.round(w.y) }, target ? { x: target.x, y: target.y } : { x: Math.round(w.x), y: Math.round(w.y) }, e.ctrlKey || e.metaKey);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && s.commanded?.kind === 'planet') {
      const pl = h.find(x => x.ref.kind === 'planet');
      if (pl) {
        s.checkpoint();
        const cp = game.planets[s.commanded.id];
        if ((window as any).__setPacketDest) { cp.packetTarget = pl.ref.id; (window as any).__setPacketDest = false; s.notify(`Destination des paquets : ${pl.label}`); }
        else { cp.route = pl.ref.id === cp.id ? undefined : pl.ref.id; s.notify(cp.route === undefined ? 'Route supprimée' : `Les vaisseaux construits sur ${cp.name} iront à ${pl.label}`); }
        s.bump();
      }
      return;
    }
    if (!h.length) return;
    let idx = 0;
    if (Math.abs(lastClick.current.x - p.x) < 6 && Math.abs(lastClick.current.y - p.y) < 6) idx = (lastClick.current.i + 1) % h.length;
    lastClick.current = { x: p.x, y: p.y, i: idx };
    s.select(h[idx].ref);
  };
  const onPointerCancel = (e: PointerEvent) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; drag.current = null; routeDrag.current = null; setDragPt(null); if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const q = local(e);
    const before = toWorld(q.x, q.y);
    const nz = Math.max(0.15, Math.min(12, s.camera.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const after = { x: (q.x - size.w / 2) / nz + s.camera.x, y: (q.y - size.h / 2) / nz + s.camera.y };
    s.setCamera({ x: s.camera.x + before.x - after.x, y: s.camera.y + before.y - after.y, zoom: nz });
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    const q = local(e);
    const h = hits(q.x, q.y);
    const w = toWorld(q.x, q.y);
    setMenu({ x: q.x, y: q.y, items: h, wx: w.x, wy: w.y });
  };

  function tooltipFor(h: Hit): string[] {
    const game = s.game!, me = s.me!;
    const lines = [h.label];
    // what is under the pointer first
    if (h.ref.kind === 'planet') {
      const intel = me.intel.planets[h.ref.id];
      if (intel.hab) {
        const val = habitability(me.race, intel.hab);
        lines.push(`Valeur pour vous ${val} %${intel.year !== game.year ? ` · relevé ${intel.year}` : ''}`);
      } else lines.push('Inexploré');
      if (intel.owner !== undefined && intel.owner >= 0) lines.push(`${game.players[intel.owner].name} · ${fmtPop(intel.pop ?? 0)} hab.`);
      for (const t of tipExtras(game, me, h.ref.id)) lines.push(t);
    }
    // then the trip of what you command (selected fleet or planet), in its own section
    const from = commandedPos();
    if (from) {
      const d = distance(from, h);
      if (d > 0.5) {
        if (s.commanded?.kind === 'fleet') {
          const f = game.fleets.find(x => x.id === s.commanded!.id);
          if (f) {
            const sp = viewFleet(game, f);
            lines.push(`§Trajet de votre flotte ${f.name}`);
            if (sp.idealSpeed) {
              lines.push(`${fmt(d, 1)} al · ${travelYears(d, sp.idealSpeed)} a à Warp ${sp.idealSpeed}`);
              // fuel for a direct trip at the ideal speed, out of what is in the tank
              const leg = estimateRoute(game, f, [{ ...f.waypoints[0], x: f.x, y: f.y, processed: true }, { x: h.x, y: h.y, target: 'space', warp: sp.idealSpeed, task: 'none' }])[0];
              if (leg) lines.push(leg.ok ? `Consommation ≈ ${fmt(leg.fuel)} mg (à bord : ${fmt(f.fuel)} mg)` : `⚠ Carburant insuffisant : il faut ≈ ${fmt(leg.fuel)} mg, à bord ${fmt(f.fuel)} mg`);
            } else lines.push(`${fmt(d, 1)} al · immobile`);
          }
        } else {
          const p = game.planets[s.commanded!.id];
          lines.push(`§Depuis ${p?.name ?? 'la planète'}`);
          lines.push(`${fmt(d, 1)} al`);
        }
      }
    }
    return lines;
  }

  function commandedPos(): { x: number; y: number } | null {
    const game = s.game; if (!game || !s.commanded) return null;
    if (s.commanded.kind === 'planet') return game.planets[s.commanded.id];
    return game.fleets.find(f => f.id === s.commanded!.id) ?? null;
  }

  return (
    <div class="map-wrap" ref={wrap} onContextMenu={e => e.preventDefault()}>
      <canvas ref={canvas} style={{ width: size.w + 'px', height: size.h + 'px', cursor: routeDrag.current?.moved ? 'grabbing' : hoverHandle ? 'grab' : undefined }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onPointerLeave={e => { if (e.pointerType === 'mouse' && !pointers.current.size) { drag.current = null; setHover(null); setHoverHandle(null); } }}
        onWheel={onWheel} onContextMenu={onContext}
        onDblClick={e => { const q = local(e); const h = hits(q.x, q.y); if (h[0]) { s.select(h[0].ref); } }} />
      {hover && !menu && <div class="map-tip" style={{ left: hover.x + 14 + 'px', top: hover.y + 10 + 'px' }}>{hover.text.map((t, i) => t.startsWith('§') ? <div class="tip-sec">{t.slice(1)}</div> : <div class={i === 0 ? 'b' : ''}>{t}</div>)}</div>}
      {menu && (
        <div class="ctx-menu" style={{ left: menu.x + 'px', top: menu.y + 'px' }}>
          {menu.items.map(it => <button onClick={() => { setMenu(null); s.select(it.ref); }}>{it.label}</button>)}
          {s.commanded?.kind === 'fleet' && s.selected?.kind === 'fleet' && <>
            <button class="hl" onClick={() => { setMenu(null); const t = menu.items.find(x => x.ref.kind === 'planet') ?? menu.items[0]; resetStepSession(); routeClick(t ? t.ref : { kind: 'space', id: -1, x: Math.round(menu.wx), y: Math.round(menu.wy) }, t ? { x: t.x, y: t.y } : { x: Math.round(menu.wx), y: Math.round(menu.wy) }, false); }}>Aller ici</button>
            {(commandedFleet()?.waypoints.length ?? 0) > 1 && <button class="hl" onClick={() => { setMenu(null); const t = menu.items.find(x => x.ref.kind === 'planet') ?? menu.items[0]; routeClick(t ? t.ref : { kind: 'space', id: -1, x: Math.round(menu.wx), y: Math.round(menu.wy) }, t ? { x: t.x, y: t.y } : { x: Math.round(menu.wx), y: Math.round(menu.wy) }, true); }}>Ajouter une étape ici</button>}
          </>}
          {s.commanded?.kind === 'fleet' && menu.items.filter(it => it.ref.kind === 'fleet' && s.me!.intel.fleets.some(fi => fi.id === it.ref.id)).slice(0, 3).map(it => <button class="hl" onClick={() => { setMenu(null); interceptFleet(it.ref.id); }} title="Calcule le point de rencontre et le recalcule chaque année">Intercepter : {it.label.length > 34 ? it.label.slice(0, 33) + '…' : it.label}</button>)}
          {menu.items.length === 0 && s.commanded?.kind !== 'fleet' && <div class="muted small">Rien ici</div>}
          <button onClick={() => { setMenu(null); s.center(menu.wx, menu.wy); }}>Centrer ici</button>
        </div>
      )}
      <div class="map-scale">{fmt(100 / s.camera.zoom, 0)} al / 100 px{s.commanded?.kind === 'fleet' && s.selected?.kind === 'fleet' ? <span class="hide-touch"> · Maj+clic : destination · Ctrl+Maj+clic : étape en plus</span> : <span class="hide-touch"> · Ctrl+glisser : règle</span>}</div>
      {s.view.minimap && <Minimap w={size.w} h={size.h} tick={camTick} />}
      {s.wpMode && s.commanded?.kind === 'fleet' && <div class="wp-banner">Mode étapes : le premier toucher fixe la destination, les suivants ajoutent des étapes <button class="small" onClick={() => { s.wpMode = false; resetStepSession(); s.bump(); }}>Terminer</button></div>}
    </div>
  );
}

/** Extra lines of a planet tooltip (discoveries, guardians). */
function tipExtras(game: GameState, me: Player, planetId: number): string[] {
  return planetNotes(game, me, planetId);
}

function estimateHeading(me: Player, id: number) {
  const tr = me.intel.tracks[id];
  if (!tr || tr.length < 2) return null;
  const a = tr[tr.length - 2], b = tr[tr.length - 1];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return d > 0 ? { x: (b.x - a.x) / d, y: (b.y - a.y) / d } : null;
}

export function refPos(game: GameState, me: Player, r: ObjRef): { x: number; y: number } | null {
  switch (r.kind) {
    case 'planet': return game.planets[r.id];
    case 'fleet': return game.fleets.find(f => f.id === r.id && f.owner === me.id) ?? me.intel.fleets.find(f => f.id === r.id) ?? null;
    case 'wormhole': return me.intel.wormholes[r.id] ?? null;
    case 'minefield': return me.intel.minefields[r.id] ?? null;
    case 'packet': return me.intel.packets.find(k => k.id === r.id) ?? null;
    case 'salvage': return me.intel.salvage.find(k => k.id === r.id) ?? null;
    case 'trader': return me.intel.traders.find(k => k.id === r.id) ?? null;
    case 'space': return r.x !== undefined ? { x: r.x, y: r.y! } : null;
  }
}

/** Deterministic pseudo-random numbers for the shapes of terrain (stable from frame to frame). */
function prand(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

/**
 * Territories as smooth shapes (3.3.2): the zero line of each empire's signed influence field, traced by marching
 * squares with linear interpolation, filled lightly, with an inner glow along the border and a fine edge line.
 * The paths are built once per field (in light-years) and drawn under a camera transform: smooth at any zoom.
 */
let terrPaths: { field: TerritoryField; list: { owner: number; fill: Path2D; edge: Path2D }[] } | null = null;
function territoryPaths(game: GameState, me: Player) {
  const t = territoryField(game, me);
  if (terrPaths && terrPaths.field === t) return terrPaths.list;
  const { cols, rows, cell } = t, W = cols + 1;
  const list = t.owners.map((owner, e) => {
    const f = t.fields[e];
    const fill = new Path2D(), edge = new Path2D();
    for (let j = 0; j < rows; j++) {
      let run = -1;
      for (let i = 0; i <= cols; i++) {
        const full = i < cols && f[j * W + i] > 0 && f[j * W + i + 1] > 0 && f[(j + 1) * W + i + 1] > 0 && f[(j + 1) * W + i] > 0;
        if (full) { if (run < 0) run = i; continue; }
        if (run >= 0) { fill.rect(run * cell, j * cell, (i - run) * cell, cell); run = -1; }
        if (i === cols) break;
        // corners clockwise from the top left, with their values
        const cx = [i, i + 1, i + 1, i], cy = [j, j, j + 1, j + 1];
        const val = [f[j * W + i], f[j * W + i + 1], f[(j + 1) * W + i + 1], f[(j + 1) * W + i]];
        if (val.every(x => x <= 0)) continue;
        const poly: [number, number][] = [], cross: [number, number][] = [];
        for (let k = 0; k < 4; k++) {
          const k1 = (k + 1) % 4, a = val[k], b = val[k1];
          if (a > 0) poly.push([cx[k] * cell, cy[k] * cell]);
          if ((a > 0) !== (b > 0)) {
            const r = a / (a - b);
            const p: [number, number] = [(cx[k] + (cx[k1] - cx[k]) * r) * cell, (cy[k] + (cy[k1] - cy[k]) * r) * cell];
            poly.push(p); cross.push(p);
          }
        }
        if (poly.length >= 3) { fill.moveTo(poly[0][0], poly[0][1]); for (let q = 1; q < poly.length; q++) fill.lineTo(poly[q][0], poly[q][1]); fill.closePath(); }
        if (cross.length === 2) { edge.moveTo(cross[0][0], cross[0][1]); edge.lineTo(cross[1][0], cross[1][1]); }
        else if (cross.length === 4) {
          const pairs = val[0] > 0 ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
          for (const [u, w] of pairs) { edge.moveTo(cross[u][0], cross[u][1]); edge.lineTo(cross[w][0], cross[w][1]); }
        }
      }
    }
    return { owner, fill, edge };
  });
  terrPaths = { field: t, list };
  return list;
}

function drawTerritories(ctx: CanvasRenderingContext2D, game: GameState, me: Player, dpr: number, size: { w: number; h: number }, cam: { x: number; y: number; zoom: number }) {
  const z = cam.zoom;
  const list = territoryPaths(game, me);
  // 0.3.9.10: the territories whose borders are closed to you are hatched, their edge dashed
  const shut = new Set(closersOf(game, me.id));
  ctx.save();
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (size.w / 2 - cam.x * z), dpr * (size.h / 2 - cam.y * z));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const t of list) {
    const h = (game.players[t.owner]?.color ?? '#888888').replace('#', '');
    const rgb = `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
    ctx.fillStyle = `rgba(${rgb},${t.owner === me.id ? 0.07 : 0.09})`;
    ctx.fill(t.fill);
    // a glow along the inside of the border, fading towards the interior
    ctx.save();
    ctx.clip(t.fill);
    for (const [w, a] of [[16, 0.07], [8, 0.10], [3.5, 0.16]] as const) { ctx.strokeStyle = `rgba(${rgb},${a})`; ctx.lineWidth = w / z; ctx.stroke(t.edge); }
    ctx.restore();
    ctx.strokeStyle = `rgba(${rgb},0.75)`; ctx.lineWidth = 1.2 / z;
    ctx.stroke(t.edge);
    if (shut.has(t.owner)) {
      ctx.save();
      ctx.clip(t.fill);
      const x0 = cam.x - size.w / 2 / z, x1 = cam.x + size.w / 2 / z, y0 = cam.y - size.h / 2 / z, y1 = cam.y + size.h / 2 / z, gap = 11 / z, H = y1 - y0;
      ctx.beginPath();
      for (let x = Math.floor((x0 - H) / gap) * gap; x <= x1; x += gap) { ctx.moveTo(x, y1); ctx.lineTo(x + H, y0); }
      ctx.strokeStyle = 'rgba(255,96,96,0.22)'; ctx.lineWidth = 1.2 / z;
      ctx.stroke();
      ctx.restore();
      ctx.setLineDash([7 / z, 5 / z]);
      ctx.strokeStyle = 'rgba(255,96,96,0.9)'; ctx.lineWidth = 1.8 / z;
      ctx.stroke(t.edge);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

function drawTerrain(ctx: CanvasRenderingContext2D, game: GameState, toScreen: (x: number, y: number) => { x: number; y: number }, z: number) {
  for (const t of game.terrain!) {
    const c = toScreen(t.x, t.y), R = t.r * z;
    if (c.x + R < -20 || c.y + R < -20 || c.x - R > ctx.canvas.width + 20 || c.y - R > ctx.canvas.height + 20) continue;
    const rnd = prand(t.id * 7 + (t.kind === 'nebula' ? 1 : t.kind === 'storm' ? 2 : 3));
    if (t.kind === 'nebula') {
      // a soft cloud made of overlapping glows
      for (let k = 0; k < 11; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.55, rr = R * (0.42 + rnd() * 0.35);
        const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        const hue = k % 3 === 0 ? '170,90,220' : k % 3 === 1 ? '110,100,240' : '90,140,235';
        g.addColorStop(0, `rgba(${hue},0.13)`); g.addColorStop(0.55, `rgba(${hue},0.06)`); g.addColorStop(1, `rgba(${hue},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(160,120,240,0.28)'; ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    } else if (t.kind === 'cluster') {
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
      g.addColorStop(0, 'rgba(230,160,80,0.17)'); g.addColorStop(1, 'rgba(230,160,80,0.03)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(240,190,120,0.45)';
      const n = Math.min(90, Math.round(t.r * 1.2));
      for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R; ctx.fillRect(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 1.3, 1.3); }
      ctx.strokeStyle = 'rgba(230,160,80,0.3)'; ctx.setLineDash([1, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    } else {
      // ion storm: a swirl, with its drift
      const g = ctx.createRadialGradient(c.x, c.y, R * 0.2, c.x, c.y, R);
      g.addColorStop(0, 'rgba(60,220,210,0.05)'); g.addColorStop(1, 'rgba(60,220,210,0.13)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(80,235,220,0.45)'; ctx.lineWidth = 1.2;
      for (let k = 0; k < 3; k++) {
        const a0 = rnd() * Math.PI * 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, R * (0.45 + k * 0.2), a0, a0 + Math.PI * (0.6 + rnd() * 0.5)); ctx.stroke();
      }
      if (t.dx || t.dy) {
        const len = Math.hypot(t.dx ?? 0, t.dy ?? 0) || 1, ux = (t.dx ?? 0) / len, uy = (t.dy ?? 0) / len;
        const tip = { x: c.x + ux * (R + 10), y: c.y + uy * (R + 10) };
        ctx.beginPath(); ctx.moveTo(c.x + ux * R, c.y + uy * R); ctx.lineTo(tip.x, tip.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - ux * 5 - uy * 4, tip.y - uy * 5 + ux * 4); ctx.lineTo(tip.x - ux * 5 + uy * 4, tip.y - uy * 5 - ux * 4); ctx.closePath(); ctx.fillStyle = 'rgba(80,235,220,0.6)'; ctx.fill();
      }
    }
    if (z >= 0.55) {
      ctx.font = '10px system-ui'; ctx.textAlign = 'center';
      ctx.fillStyle = t.kind === 'nebula' ? 'rgba(190,160,255,0.75)' : t.kind === 'storm' ? 'rgba(110,235,225,0.75)' : 'rgba(240,190,120,0.75)';
      ctx.fillText(terrainName(t).toUpperCase(), c.x, c.y - R - 4);
      ctx.textAlign = 'start';
    }
  }
}

/** 0.3.7: the probe zone of a veiled star this empire knows but has no way into yet, under a point. */
function probeZoneAt(game: GameState, me: Player, w: { x: number; y: number }) {
  return game.secrets?.find(s => s.zone && s.known.includes(me.id) && !s.tunnel?.includes(me.id) && distance(s.zone, w) <= s.zone.r) ?? null;
}

/**
 * 0.3.7: what the hidden stars this empire found add to the map: the way into a veiled star (cut into the cloud) or
 * the zone where to look for it, the box of the hidden cluster, the reach of a pulsar and of a black hole's slingshot.
 */
function drawSecrets(ctx: CanvasRenderingContext2D, game: GameState, me: Player, toScreen: (x: number, y: number) => { x: number; y: number }, z: number) {
  ctx.save();
  for (const s of game.secrets!) {
    if (!s.known.includes(me.id) || !s.ids.length) continue;
    const c = toScreen(s.x, s.y);
    if (s.kind === 'veiled' && s.lane) {
      if (s.tunnel?.includes(me.id)) {
        // the channel and the cavity, cut into the dust
        const w = Math.max(3, (s.laneWidth ?? 3) * 2 * z);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(9,12,22,0.96)'; ctx.lineWidth = w + 2;
        ctx.beginPath(); s.lane.forEach((q, i) => { const a = toScreen(q.x, q.y); if (i) ctx.lineTo(a.x, a.y); else ctx.moveTo(a.x, a.y); }); ctx.stroke();
        ctx.fillStyle = 'rgba(9,12,22,0.96)'; ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(5, (s.cavity ?? 9) * z), 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(5, (s.cavity ?? 9) * z));
        g.addColorStop(0, 'rgba(255,214,150,0.28)'); g.addColorStop(1, 'rgba(255,214,150,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(5, (s.cavity ?? 9) * z), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(140,200,255,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); s.lane.forEach((q, i) => { const a = toScreen(q.x, q.y); if (i) ctx.lineTo(a.x, a.y); else ctx.moveTo(a.x, a.y); }); ctx.stroke(); ctx.setLineDash([]);
      } else if (s.zone) {
        const q = toScreen(s.zone.x, s.zone.y), r = s.zone.r * z;
        ctx.strokeStyle = 'rgba(127,240,224,0.7)'; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(127,240,224,0.06)'; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(127,240,224,0.85)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(`Zone de sondage · ${Math.round((s.probe?.[me.id] ?? 0) / PROBE_NEED * 100)} %`, q.x, q.y - r - 5); ctx.textAlign = 'left';
        // the star, seen through the dust
        ctx.strokeStyle = 'rgba(255,214,150,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(6, 9 * z), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (s.kind === 'pocket' && s.box) {
      const a = toScreen(s.box.x, s.box.y), b = toScreen(s.box.x + s.box.w, s.box.y + s.box.h);
      ctx.fillStyle = 'rgba(14,16,30,0.85)'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeStyle = 'rgba(199,125,255,0.6)'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 5]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(214,170,255,0.85)'; ctx.font = `600 ${Math.round(11 + Math.min(4, z * 2))}px Georgia, 'Times New Roman', serif`;
      ctx.fillText(`Amas de ${s.name}`, a.x + 6, a.y - 6);
    }
    if (s.kind === 'pulsar') {
      ctx.strokeStyle = 'rgba(255,120,120,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(c.x, c.y, PULSAR_SHIELD_RANGE * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (s.kind === 'blackhole') {
      ctx.strokeStyle = 'rgba(255,170,90,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(c.x, c.y, 40 * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

/** 0.3.7: the look of a hidden star under its world (brown dwarf, pulsar, black hole, Dyson swarm...). */
function drawHiddenStar(ctx: CanvasRenderingContext2D, kind: NonNullable<Planet['hidden']>, x: number, y: number, z: number) {
  const r = Math.max(6, Math.min(14, 5 + z * 2.5));
  ctx.save();
  if (kind === 'dwarf') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
    g.addColorStop(0, 'rgba(190,80,40,0.55)'); g.addColorStop(1, 'rgba(120,40,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'pulsar') {
    ctx.strokeStyle = 'rgba(170,210,255,0.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - r * 1.8, y + r * 0.9); ctx.lineTo(x + r * 1.8, y - r * 0.9); ctx.stroke();
    ctx.strokeStyle = 'rgba(170,210,255,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - r * 1.4, y + r * 0.7); ctx.lineTo(x + r * 1.4, y - r * 0.7); ctx.stroke();
  } else if (kind === 'blackhole') {
    ctx.strokeStyle = 'rgba(255,160,70,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.5, r * 0.55, -0.35, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'dyson') {
    ctx.fillStyle = 'rgba(255,190,110,0.75)';
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; ctx.fillRect(x + Math.cos(a) * r * 1.3 - 0.8, y + Math.sin(a) * r * 1.3 - 0.8, 1.6, 1.6); }
  } else if (kind === 'ancients') {
    ctx.fillStyle = 'rgba(255,207,106,0.9)'; ctx.font = `bold ${Math.round(r + 3)}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText('✧', x - r * 1.4, y - r * 0.6);
  } else if (kind === 'veiled') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
    g.addColorStop(0, 'rgba(255,214,150,0.5)'); g.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawWormhole(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(199,125,255,0.7)'); g.addColorStop(1, 'rgba(120,60,200,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(220,180,255,0.9)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x, y, r * (0.5 + i * 0.3), i * 2, i * 2 + 4); ctx.stroke(); }
}

function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, dir: { x: number; y: number }, color: string) {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len, uy = dir.y / len;
  const px = -uy, py = ux;
  ctx.strokeStyle = color; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - ux * 3 + px * 4, y - uy * 3 + py * 4); ctx.lineTo(x + ux * 2, y + uy * 2); ctx.lineTo(x - ux * 3 - px * 4, y - uy * 3 - py * 4);
  ctx.stroke();
}

/** Distance from a point to a segment. */
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, heading: { x: number; y: number } | null | undefined, color: string, moving: boolean, outline?: string) {
  ctx.fillStyle = color;
  if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1.6; }
  if (!heading || !moving) { ctx.beginPath(); ctx.arc(x, y, outline ? 3.2 : 2.6, 0, Math.PI * 2); ctx.fill(); if (outline) ctx.stroke(); return; }
  const ux = heading.x, uy = heading.y, px = -uy, py = ux;
  ctx.beginPath();
  ctx.moveTo(x + ux * 7, y + uy * 7);
  ctx.lineTo(x - ux * 5 + px * 4.5, y - uy * 5 + py * 4.5);
  ctx.lineTo(x - ux * 2.5, y - uy * 2.5);
  ctx.lineTo(x - ux * 5 - px * 4.5, y - uy * 5 - py * 4.5);
  ctx.closePath(); ctx.fill();
  if (outline) ctx.stroke();
}

function drawPlanet(ctx: CanvasRenderingContext2D, game: GameState, me: Player, pl: Planet, intel: Player['intel']['planets'][number], x: number, y: number, z: number) {
  const mode = store.view.mode;
  const known = intel.year !== undefined;
  const owner = intel.owner;
  const base = Math.max(2, Math.min(4, 1.5 + z));
  if (mode === 6 || mode === 8) { ctx.fillStyle = '#d0d8e8'; ctx.beginPath(); ctx.arc(x, y, base * 0.8, 0, Math.PI * 2); ctx.fill(); drawStation(ctx, game, me, pl, intel, x, y, base * 0.8); return; }
  if (mode === 4) {
    // planet value
    if (owner !== undefined && owner >= 0 && owner !== me.id) { drawFlag(ctx, x, y, relationColor(game, me, owner)); }
    else if (owner === me.id) drawFlag(ctx, x, y, '#4fb3ff');
    if (!intel.hab) { ctx.fillStyle = UNKNOWN; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); drawStation(ctx, game, me, pl, intel, x, y, 1.6); return; }
    const val = habitability(me.race, intel.hab);
    const tf = terraformedHabValue(me, { ...pl, hab: intel.hab, baseHab: intel.baseHab ?? intel.hab });
    const r = 3 + Math.min(10, Math.abs(val) / 100 * 10 * Math.min(1.8, z));
    const rr = val > 0 ? r : tf > 0 ? 3 + tf / 100 * 8 : r;
    ctx.fillStyle = val > 0 ? 'rgba(93,222,122,0.85)' : tf > 0 ? 'rgba(255,210,74,0.85)' : 'rgba(255,93,93,0.75)';
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    drawStation(ctx, game, me, pl, intel, x, y, rr);
    return;
  }
  if (mode === 5) {
    if (owner !== undefined && owner >= 0 && (intel.pop ?? 0) > 0) {
      const r = 2 + Math.sqrt((intel.pop ?? 0) / 1000) * 0.45 * Math.min(1.6, z);
      ctx.fillStyle = owner === me.id ? 'rgba(93,222,122,0.8)' : `rgba(${rgb(relationColor(game, me, owner))},0.8)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      drawStation(ctx, game, me, pl, intel, x, y, r);
    } else { ctx.fillStyle = known ? '#f4f6fa' : UNKNOWN; ctx.beginPath(); ctx.arc(x, y, known ? 2 : 1.5, 0, Math.PI * 2); ctx.fill(); drawStation(ctx, game, me, pl, intel, x, y, 2); }
    return;
  }
  if (mode === 2 || mode === 3) {
    ctx.fillStyle = known ? '#9aa6ba' : UNKNOWN; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    drawStation(ctx, game, me, pl, intel, x, y, 1.6);
    const vals = mode === 2 ? intel.surface : intel.conc;
    if (!vals) return;
    const scale = mode === 2 ? 1 / 50 : 1 / 8;
    const cols = ['#4f8dff', '#3ecf6e', '#f2c94c'];
    [vals.ironium, vals.boranium, vals.germanium].forEach((v, i) => {
      const h = Math.min(30, v * scale * Math.min(1.5, z));
      ctx.fillStyle = cols[i]; ctx.fillRect(x + 3 + i * 4, y - h, 3, h);
    });
    return;
  }
  // normal: owner colour for inhabited worlds, habitability (green / red, size = strength) for the others
  let color = UNKNOWN, r = base * 0.75;
  const owned = owner !== undefined && owner >= 0;
  let val: number | null = null;
  if (known) {
    color = '#c9d2e3'; r = base;
    if (!owned && intel.hab) {
      val = habitability(me.race, intel.hab);
      color = val > 0 ? GOOD_() : BAD_();
      r = Math.max(1.6, (1.5 + Math.abs(val) / 100 * 4.5) * Math.min(1.6, 0.6 + z * 0.35));
    }
  }
  if (owned) { color = relationColor(game, me, owner); r = base + 1; }
  // 3.6: empires mode: each colony in its empire's colour, ringed with our relation to it (ally, peace, war)
  if (mode === 7) {
    if (owned) {
      ctx.fillStyle = owner === me.id ? OWN_() : game.players[owner!].color; ctx.beginPath(); ctx.arc(x, y, base + 1.5, 0, Math.PI * 2); ctx.fill();
      if (owner !== me.id) { ctx.strokeStyle = relationColor(game, me, owner); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, base + 4, 0, Math.PI * 2); ctx.stroke(); }
      r = base + 2.5;
    } else { ctx.fillStyle = known ? '#56627a' : UNKNOWN; ctx.beginPath(); ctx.arc(x, y, known ? 1.8 : 1.4, 0, Math.PI * 2); ctx.fill(); r = 2; }
  }
  else if (z >= 2.2) {
    // close-up: rendered planet with an ownership ring
    const pr = Math.min(13, 3 + (z - 2.2) * 2.4) * (known ? 1 : 0.7);
    const img = planetSprite(pl.id, intel.hab);
    const sz = pr / 0.37 * (intel.hab ? 0.37 / (0.3 + intel.hab[0] / 100 * 0.14) : 0.37 / 0.36);
    if (!known) ctx.globalAlpha = 0.55;
    ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
    ctx.globalAlpha = 1;
    if (owned) {
      const g = ctx.createRadialGradient(x, y, pr, x, y, pr * 2.4);
      g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, pr * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, pr + 2, 0, Math.PI * 2); ctx.stroke();
    } else if (val !== null) {
      // habitability ring: thicker = stronger
      ctx.strokeStyle = color; ctx.globalAlpha = 0.85; ctx.lineWidth = 1 + Math.abs(val) / 100 * 2.5; ctx.beginPath(); ctx.arc(x, y, pr + 2.5, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    r = pr + 1;
  } else {
    if (owned) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      g.addColorStop(0, color + '66'); g.addColorStop(1, color + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  drawStation(ctx, game, me, pl, intel, x, y, r);
  void planetSpec;
}

/** 3.6: the square of a world with a station, and what stands in orbit (fort or shipyard), whatever the map mode. */
function drawStation(ctx: CanvasRenderingContext2D, game: GameState, me: Player, pl: Planet, intel: Player['intel']['planets'][number], x: number, y: number, r: number) {
  const owner = intel.owner;
  if (intel.starbaseDesign !== undefined || (pl.owner === me.id && pl.starbase)) {
    ctx.strokeStyle = owner === me.id ? '#bff0c9' : '#ffb0b0'; ctx.lineWidth = 1;
    ctx.strokeRect(x - r - 2.5, y - r - 2.5, (r + 2.5) * 2, (r + 2.5) * 2);
    // 3.6: what stands in orbit: a fort (triangle) or a station with a shipyard (ring); foreign ones as last analysed
    const hull = pl.owner === me.id && pl.starbase ? game.designs.find(d => d.id === pl.starbase!.designId)?.hull : intel.starbaseDesign !== undefined ? (me.intel.designs[intel.starbaseDesign]?.hull ?? game.designs.find(d => d.id === intel.starbaseDesign)?.hull) : undefined;
    const old = pl.owner !== me.id && intel.year !== undefined && intel.year < game.year;
    const col = owner === me.id ? '#bff0c9' : owner !== undefined && owner >= 0 ? relationColor(game, me, owner) : '#ffb0b0';
    const ix = x + r + 6, iy = y - r - 6;
    ctx.globalAlpha = old ? 0.55 : 1;
    if (hull === 'Orbital Fort') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(ix, iy - 3.5); ctx.lineTo(ix + 3.5, iy + 3); ctx.lineTo(ix - 3.5, iy + 3); ctx.closePath(); ctx.fill();
    } else if (hull) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(ix, iy, 3.2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ix, iy, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (pl.owner === me.id && pl.starbase) {
      const sb = specOf(game, pl.starbase.designId);
      if (sb.gate) { ctx.fillStyle = '#5dde7a'; ctx.fillRect(x + r + 3, y - 1.5, 3, 3); }
      if (sb.driver) { ctx.fillStyle = '#c77dff'; ctx.fillRect(x - r - 6, y - 1.5, 3, 3); }
    }
  }
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.strokeStyle = '#ccd'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 12); ctx.stroke();
  ctx.fillStyle = color; ctx.fillRect(x, y - 12, 7, 5);
}

export type { Waypoint };

/** Galaxy overview in the corner: owned worlds, the visible area; click or drag to move there. */
function Minimap({ w, h, tick }: { w: number; h: number; tick: number }) {
  const s = store;
  const ref = useRef<HTMLCanvasElement>(null);
  const g = s.game!, me = s.me!;
  const S = Math.min(150, Math.max(90, Math.round(Math.min(w, h) * 0.22)));
  const k = S / Math.max(g.width, g.height);
  const drawn = useRef<unknown[] | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    // 0.3.9.20: only when what it shows may have changed
    const sig = [g, me, s.version, s.camera.x, s.camera.y, s.camera.zoom, w, h, S, tick];
    const prev = drawn.current;
    if (prev && sig.every((v, i) => v === prev[i])) return;
    drawn.current = sig;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== S * dpr) { cv.width = S * dpr; cv.height = S * dpr; }
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = 'rgba(3,5,11,0.88)'; c.fillRect(0, 0, S, S);
    const gl = galaxyGlow(g);
    if (gl) c.drawImage(gl, 0, 0, g.width * k, g.height * k);
    const cl = cloudLayer(g);
    if (cl) c.drawImage(cl.cv, 0, 0, g.width * k, g.height * k);
    if (g.settings.terrain) for (const t of g.terrain ?? []) {
      c.fillStyle = t.kind === 'nebula' ? 'rgba(150,100,235,0.22)' : t.kind === 'cluster' ? 'rgba(230,160,80,0.2)' : 'rgba(80,235,220,0.16)';
      c.beginPath(); c.arc(t.x * k, t.y * k, t.r * k, 0, Math.PI * 2); c.fill();
    }
    for (const pl of g.planets) {
      if (me.intel.planets[pl.id].unknown || pl.x > g.width) continue;
      const o = me.intel.planets[pl.id].owner;
      if (o === undefined || o < 0) { c.fillStyle = me.intel.planets[pl.id].year !== undefined ? '#5a6478' : '#2c3444'; c.fillRect(pl.x * k, pl.y * k, 1, 1); continue; }
      c.fillStyle = relationColor(g, me, o);
      c.fillRect(pl.x * k - 1, pl.y * k - 1, 2.5, 2.5);
    }
    const vw = w / s.camera.zoom, vh = h / s.camera.zoom;
    c.strokeStyle = '#ffffffcc'; c.lineWidth = 1;
    c.strokeRect((s.camera.x - vw / 2) * k, (s.camera.y - vh / 2) * k, vw * k, vh * k);
  });
  const go = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect(), z = el.offsetWidth ? r.width / el.offsetWidth : 1;
    s.setCamera({ ...s.camera, x: (e.clientX - r.left) / z / k, y: (e.clientY - r.top) / z / k });
  };
  return <canvas ref={ref} class="minimap" style={{ width: S + 'px', height: S + 'px' }} title="Vue d'ensemble : cliquez ou glissez pour vous déplacer"
    onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); go(e as unknown as PointerEvent); }}
    onPointerMove={e => { if ((e as PointerEvent).buttons) go(e as unknown as PointerEvent); }} />;
}
