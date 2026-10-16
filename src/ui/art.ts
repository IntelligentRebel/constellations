// Generated artwork: procedural planets, hull silhouettes and component icons (all original, no bitmaps).
import type { Hab } from '../engine/types';

// ------------------------------------------------------------------ planets

const planetCache = new Map<string, string>();

function hash(n: number): () => number {
  let s = (n * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function mix(c1: number[], c2: number[], t: number) { return c1.map((v, i) => Math.round(lerp(v, c2[i], t))); }

function palette(hab: Hab | undefined, seed: number): { low: number[]; mid: number[]; high: number[]; atmo: number[]; bands: boolean } {
  if (!hab) return { low: [60, 64, 74], mid: [92, 96, 108], high: [128, 132, 144], atmo: [120, 130, 150], bands: false };
  const t = hab[1], r = hab[2], g = hab[0];
  const rnd = hash(seed)();
  let low: number[], mid: number[], high: number[];
  if (t < 20) { low = [120, 150, 190]; mid = [190, 210, 235]; high = [245, 250, 255]; }
  else if (t < 40) { low = [40, 80, 130]; mid = [80, 130, 150]; high = [200, 210, 220]; }
  else if (t < 62) { low = [20, 70, 140]; mid = [50, 130, 70]; high = [170, 160, 110]; }
  else if (t < 82) { low = [150, 90, 50]; mid = [200, 140, 80]; high = [235, 200, 140]; }
  else { low = [90, 20, 10]; mid = [220, 80, 20]; high = [255, 210, 80]; }
  if (rnd > 0.6) { const tmp = low; low = mid; mid = tmp; }
  const atmo = r > 75 ? [190, 120, 255] : r > 50 ? [120, 230, 160] : r > 25 ? [140, 190, 255] : [200, 210, 230];
  return { low, mid, high, atmo, bands: g > 65 };
}

/** Procedural planet picture as a data URL (cached). */
export function planetImage(id: number, hab: Hab | undefined, size = 96, owned = false): string {
  const key = `${id}|${hab?.join(',') ?? 'u'}|${size}|${owned}`;
  const c = planetCache.get(key);
  if (c) return c;
  if (typeof document === 'undefined') return '';
  const url = renderPlanet(id, hab, size, owned).toDataURL();
  planetCache.set(key, url);
  return url;
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Small planet sprite for the map (canvas, cached). The sphere radius is about 0.37 × size. */
export function planetSprite(id: number, hab: Hab | undefined): HTMLCanvasElement {
  const key = `${id}|${hab?.join(',') ?? 'u'}`;
  let c = spriteCache.get(key);
  if (!c) { c = renderPlanet(id, hab, 48, false); spriteCache.set(key, c); }
  return c;
}

function renderPlanet(id: number, hab: Hab | undefined, size: number, owned: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  const pal = palette(hab, id);
  const R = size * (hab ? 0.3 + (hab[0] / 100) * 0.14 : 0.36);
  const cx = size / 2, cy = size / 2;
  const rnd = hash(id + 7);
  // value noise grid
  const N = 12, grid: number[] = [];
  for (let i = 0; i < N * N; i++) grid.push(rnd());
  const noise = (x: number, y: number) => {
    const gx = x * (N - 1), gy = y * (N - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const at = (a: number, b: number) => grid[Math.min(N - 1, b) * N + Math.min(N - 1, a)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(at(x0, y0), at(x0 + 1, y0), sx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx), sy);
  };
  const img = ctx.createImageData(size, size);
  const lx = -0.55, ly = -0.45, lz = 0.7;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - cx) / R, dy = (y - cy) / R;
    const d2 = dx * dx + dy * dy;
    const i = (y * size + x) * 4;
    if (d2 > 1) continue;
    const dz = Math.sqrt(1 - d2);
    const u = 0.5 + Math.atan2(dx, dz) / Math.PI / 2, v = 0.5 + dy / 2;
    let n = noise(u, v) * 0.6 + noise((u * 2.3) % 1, (v * 2.3) % 1) * 0.3 + noise((u * 5.1) % 1, (v * 5.1) % 1) * 0.1;
    if (pal.bands) n = n * 0.5 + (0.5 + 0.5 * Math.sin(v * 22 + n * 4)) * 0.5;
    const col = n < 0.45 ? mix(pal.low, pal.mid, n / 0.45) : mix(pal.mid, pal.high, (n - 0.45) / 0.55);
    const light = Math.max(0.08, dx * lx + dy * ly + dz * lz);
    const rim = Math.pow(1 - dz, 3);
    img.data[i] = Math.min(255, col[0] * light + pal.atmo[0] * rim * 0.9);
    img.data[i + 1] = Math.min(255, col[1] * light + pal.atmo[1] * rim * 0.9);
    img.data[i + 2] = Math.min(255, col[2] * light + pal.atmo[2] * rim * 0.9);
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // atmosphere halo
  const g = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.25);
  g.addColorStop(0, `rgba(${pal.atmo.join(',')},0.35)`);
  g.addColorStop(1, `rgba(${pal.atmo.join(',')},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2); ctx.fill();
  if (owned) {
    ctx.strokeStyle = 'rgba(120,255,160,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.45, R * 0.35, -0.3, 0, Math.PI * 2); ctx.stroke();
  }
  return cv;
}

// ------------------------------------------------------------------ hulls

type Arch = { a: string; s: number };
const HULL_ARCH: Record<string, Arch> = {
  'Small Freighter': { a: 'freighter', s: 1 }, 'Medium Freighter': { a: 'freighter', s: 2 }, 'Large Freighter': { a: 'freighter', s: 3 }, 'Super Freighter': { a: 'freighter', s: 4 },
  Scout: { a: 'scout', s: 1 }, Frigate: { a: 'warship', s: 1 }, Destroyer: { a: 'warship', s: 2 }, Cruiser: { a: 'warship', s: 3 }, 'Battle Cruiser': { a: 'warship', s: 4 },
  Battleship: { a: 'warship', s: 5 }, Dreadnought: { a: 'warship', s: 6 }, Privateer: { a: 'privateer', s: 1 }, Rogue: { a: 'privateer', s: 2 }, Galleon: { a: 'privateer', s: 3 },
  'Mini-Colony Ship': { a: 'colony', s: 1 }, 'Colony Ship': { a: 'colony', s: 2 }, 'Mini Bomber': { a: 'bomber', s: 1 }, 'B-17 Bomber': { a: 'bomber', s: 2 },
  'Stealth Bomber': { a: 'stealth', s: 2 }, 'B-52 Bomber': { a: 'bomber', s: 3 }, 'Midget Miner': { a: 'miner', s: 1 }, 'Mini-Miner': { a: 'miner', s: 1 }, Miner: { a: 'miner', s: 2 },
  'Maxi-Miner': { a: 'miner', s: 3 }, 'Ultra-Miner': { a: 'miner', s: 4 }, 'Fuel Transport': { a: 'fuel', s: 1 }, 'Super-Fuel Xport': { a: 'fuel', s: 2 },
  'Mini Mine Layer': { a: 'layer', s: 1 }, 'Super Mine Layer': { a: 'layer', s: 2 }, Nubian: { a: 'nubian', s: 3 }, 'Meta Morph': { a: 'morph', s: 3 }, 'Mini Morph': { a: 'morph', s: 1 },
  'Orbital Fort': { a: 'fort', s: 1 }, 'Space Dock': { a: 'dock', s: 2 }, 'Space Station': { a: 'station', s: 3 }, 'Ultra Station': { a: 'ultra', s: 4 }, 'Death Star': { a: 'deathstar', s: 5 },
};

const svgCache = new Map<string, string>();

/** Top-down silhouette of a hull (SVG markup, viewBox 0 0 120 80). */
export function hullSvg(hull: string, accent = '#4fb3ff'): string {
  const key = hull + accent;
  const c = svgCache.get(key);
  if (c) return c;
  const arch = HULL_ARCH[hull] ?? { a: 'scout', s: 1 };
  const id = 'h' + Math.abs([...key].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
  const defs = `<defs><linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e4ebf5"/><stop offset=".55" stop-color="#8d9bb0"/><stop offset="1" stop-color="#4a5466"/></linearGradient>
  <radialGradient id="${id}g"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="${accent}"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>`;
  const M = `url(#${id}m)`, G = `url(#${id}g)`;
  const st = `stroke="#1c2230" stroke-width="1"`;
  let body = '';
  const s = arch.s;
  const engine = (x: number, y: number, r = 5) => `<circle cx="${x}" cy="${y}" r="${r * 1.6}" fill="${G}" opacity=".9"/><rect x="${x}" y="${y - r / 1.6}" width="${r * 1.3}" height="${r * 1.25}" rx="1.5" fill="#39404f" ${st}/>`;
  switch (arch.a) {
    case 'scout':
      body = `${engine(18, 40, 4)}<path d="M24 40 L52 30 L100 40 L52 50 Z" fill="${M}" ${st}/><path d="M44 33 L36 18 L56 31 Z M44 47 L36 62 L56 49 Z" fill="${M}" ${st}/><circle cx="74" cy="40" r="4" fill="${accent}" opacity=".85"/>`;
      break;
    case 'warship': {
      const L = 46 + s * 9, W = 8 + s * 3;
      const x0 = 60 - L / 2, x1 = 60 + L / 2;
      body = `${engine(x0 - 6, 40 - (s > 3 ? 6 : 0), 4 + s * 0.4)}${s > 3 ? engine(x0 - 6, 46, 4 + s * 0.4) : ''}
      <path d="M${x0} ${40 - W} L${x1 - 14} ${40 - W * 0.8} L${x1 + 4} 40 L${x1 - 14} ${40 + W * 0.8} L${x0} ${40 + W} Z" fill="${M}" ${st}/>
      <path d="M${x0 + 8} ${40 - W} L${x0 + 2} ${40 - W - 6 - s * 2} L${x0 + 22} ${40 - W} Z M${x0 + 8} ${40 + W} L${x0 + 2} ${40 + W + 6 + s * 2} L${x0 + 22} ${40 + W} Z" fill="${M}" ${st}/>
      ${Array.from({ length: Math.min(6, s + 1) }, (_, i) => `<circle cx="${x0 + 18 + i * (L - 30) / Math.max(1, s)}" cy="40" r="${2.2 + s * 0.25}" fill="#2a303c" stroke="${accent}" stroke-width="1"/>`).join('')}
      <rect x="${x1 - 22}" y="38" width="10" height="4" fill="${accent}" opacity=".8"/>`;
      break;
    }
    case 'freighter': {
      const pods = s + 1, L = 30 + s * 14;
      const x0 = 62 - L / 2;
      body = `${engine(x0 - 8, 40, 4 + s * 0.5)}<rect x="${x0}" y="37" width="${L}" height="6" fill="${M}" ${st}/>`;
      for (let i = 0; i < pods; i++) { const px = x0 + 4 + i * (L - 8) / pods; body += `<rect x="${px}" y="${30 - s}" width="${(L - 8) / pods - 2}" height="${20 + 2 * s}" rx="2" fill="${M}" ${st}/><rect x="${px + 2}" y="${39}" width="${(L - 8) / pods - 6}" height="2" fill="${accent}" opacity=".6"/>`; }
      body += `<path d="M${x0 + L} 34 L${x0 + L + 12} 40 L${x0 + L} 46 Z" fill="${M}" ${st}/>`;
      break;
    }
    case 'colony':
      body = `${engine(22, 40, 4 + s)}<ellipse cx="62" cy="40" rx="${28 + s * 4}" ry="${12 + s * 3}" fill="${M}" ${st}/><circle cx="62" cy="40" r="${8 + s * 2}" fill="#8fd6ff" opacity=".55" ${st}/><circle cx="62" cy="40" r="${4 + s}" fill="#d9fbff" opacity=".7"/><path d="M${90 + s * 4} 40 l8 0" stroke="${accent}" stroke-width="2"/>`;
      break;
    case 'miner':
      body = `${engine(24, 40, 4 + s * 0.6)}<rect x="30" y="${34 - s}" width="${36 + s * 6}" height="${12 + s * 2}" rx="4" fill="${M}" ${st}/>
      <path d="M${62 + s * 6} ${34 - s} l18 -10 l6 4 l-14 12 Z M${62 + s * 6} ${46 + s} l18 10 l6 -4 l-14 -12 Z" fill="${M}" ${st}/>
      <circle cx="${88 + s * 6}" cy="${26 - s}" r="3" fill="${accent}"/><circle cx="${88 + s * 6}" cy="${54 + s}" r="3" fill="${accent}"/>`;
      break;
    case 'bomber': {
      const span = 18 + s * 8;
      body = `${engine(30, 40, 4 + s * 0.5)}<path d="M34 40 L60 ${40 - span} L72 ${40 - span} L66 40 L72 ${40 + span} L60 ${40 + span} Z" fill="${M}" ${st}/><path d="M30 36 L96 38 L104 40 L96 42 L30 44 Z" fill="${M}" ${st}/>
      ${Array.from({ length: s + 1 }, (_, i) => `<circle cx="${62 + 2}" cy="${40 - span * 0.55 + i * span * 1.1 / Math.max(1, s)}" r="2.5" fill="#262b35" stroke="${accent}"/>`).join('')}`;
      break;
    }
    case 'stealth':
      body = `${engine(30, 40, 4)}<path d="M26 40 L70 14 L100 40 L70 66 Z" fill="#3a4152" ${st}/><path d="M40 40 L70 24 L88 40 L70 56 Z" fill="#2a2f3c" stroke="${accent}" stroke-width="1" opacity=".9"/>`;
      break;
    case 'fuel':
      body = `${engine(18, 40, 4 + s)}<rect x="26" y="37" width="${60 + s * 8}" height="6" fill="${M}" ${st}/>${Array.from({ length: 2 + s }, (_, i) => `<rect x="${32 + i * 20}" y="${26 - s * 2}" width="16" height="${28 + s * 4}" rx="8" fill="${M}" ${st}/><rect x="${36 + i * 20}" y="${30 - s * 2}" width="8" height="${20 + s * 4}" rx="4" fill="#ff7a5d" opacity=".55"/>`).join('')}`;
      break;
    case 'layer':
      body = `${engine(22, 40, 4 + s)}<ellipse cx="62" cy="40" rx="${26 + s * 5}" ry="${18 + s * 4}" fill="${M}" ${st}/><ellipse cx="62" cy="40" rx="${12 + s * 3}" ry="${8 + s * 2}" fill="#2a303c" ${st}/>${Array.from({ length: 6 }, (_, i) => `<circle cx="${62 + Math.cos(i) * (18 + s * 4)}" cy="${40 + Math.sin(i) * (12 + s * 3)}" r="2" fill="${accent}"/>`).join('')}`;
      break;
    case 'privateer': {
      const L = 50 + s * 10;
      body = `${engine(60 - L / 2 - 6, 40, 4 + s * 0.5)}<path d="M${60 - L / 2} 30 L${60 + L / 2 - 10} 32 L${60 + L / 2 + 6} 40 L${60 + L / 2 - 10} 48 L${60 - L / 2} 50 Z" fill="${M}" ${st}/><rect x="${60 - L / 4}" y="24" width="${L / 3}" height="10" rx="2" fill="${M}" ${st}/><rect x="${60 - L / 4}" y="46" width="${L / 3}" height="10" rx="2" fill="${M}" ${st}/><circle cx="${60 + L / 4}" cy="40" r="3" fill="${accent}"/>`;
      break;
    }
    case 'nubian':
      body = `${engine(18, 40, 6)}<circle cx="64" cy="40" r="30" fill="none" stroke="${M}" stroke-width="9"/><circle cx="64" cy="40" r="30" fill="none" stroke="#1c2230" stroke-width="1"/><rect x="28" y="36" width="72" height="8" fill="${M}" ${st}/><circle cx="64" cy="40" r="7" fill="${accent}" opacity=".8"/>`;
      break;
    case 'morph':
      body = `${engine(24, 40, 4 + s)}<path d="M30 40 C 36 ${14 - s * 2}, ${70 + s * 4} ${18 - s * 2}, ${96 + s * 2} 40 C ${70 + s * 4} ${62 + s * 2}, 36 ${66 + s * 2}, 30 40 Z" fill="${M}" ${st}/><path d="M50 30 l-6 -12 M66 28 l2 -14 M50 50 l-6 12 M66 52 l2 14" stroke="#9aa6ba" stroke-width="2"/><circle cx="70" cy="40" r="5" fill="${accent}" opacity=".85"/>`;
      break;
    case 'fort':
      body = `<circle cx="60" cy="40" r="22" fill="none" stroke="${M}" stroke-width="7"/><circle cx="60" cy="40" r="10" fill="${M}" ${st}/>${[0, 1, 2, 3].map(i => `<rect x="${60 + Math.cos(i * Math.PI / 2) * 22 - 5}" y="${40 + Math.sin(i * Math.PI / 2) * 22 - 5}" width="10" height="10" fill="${M}" ${st}/>`).join('')}<circle cx="60" cy="40" r="3" fill="${accent}"/>`;
      break;
    case 'dock':
      body = `<circle cx="60" cy="40" r="26" fill="none" stroke="${M}" stroke-width="6"/><rect x="34" y="36" width="52" height="8" fill="${M}" ${st}/><rect x="80" y="26" width="18" height="28" rx="2" fill="none" stroke="${accent}" stroke-width="2"/><circle cx="60" cy="40" r="8" fill="${M}" ${st}/>`;
      break;
    case 'station':
      body = `<circle cx="60" cy="40" r="32" fill="none" stroke="${M}" stroke-width="8"/>${[0, 1, 2, 3, 4, 5].map(i => `<line x1="60" y1="40" x2="${60 + Math.cos(i * Math.PI / 3) * 32}" y2="${40 + Math.sin(i * Math.PI / 3) * 32}" stroke="#8d9bb0" stroke-width="3"/>`).join('')}<circle cx="60" cy="40" r="12" fill="${M}" ${st}/><circle cx="60" cy="40" r="5" fill="${accent}"/>`;
      break;
    case 'ultra':
      body = `<circle cx="60" cy="40" r="34" fill="none" stroke="${M}" stroke-width="6"/><circle cx="60" cy="40" r="22" fill="none" stroke="${M}" stroke-width="6"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<line x1="60" y1="40" x2="${60 + Math.cos(i * Math.PI / 4) * 34}" y2="${40 + Math.sin(i * Math.PI / 4) * 34}" stroke="#8d9bb0" stroke-width="2"/>`).join('')}<circle cx="60" cy="40" r="10" fill="${M}" ${st}/><circle cx="60" cy="40" r="4" fill="${accent}"/>`;
      break;
    case 'deathstar':
      body = `<circle cx="60" cy="40" r="36" fill="${M}" ${st}/><path d="M24 40 L96 40" stroke="#2a303c" stroke-width="3"/><circle cx="74" cy="26" r="9" fill="#3a4152" stroke="#1c2230"/><circle cx="74" cy="26" r="3" fill="${accent}"/>`;
      break;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">${defs}${body}</svg>`;
  svgCache.set(key, svg);
  return svg;
}

export function hullDataUrl(hull: string, accent?: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(hullSvg(hull, accent));
}

// ------------------------------------------------------------------ components

const CAT_COLOR: Record<string, string> = {
  Engine: '#ff9a3d', BeamWeapon: '#ff5d5d', Torpedo: '#ff7ac8', Bomb: '#e0a070', Armor: '#a0aec0', Shield: '#4fb3ff', Scanner: '#35e0d0',
  Electrical: '#c77dff', Mechanical: '#b5e35d', MineLayer: '#ffd24a', MineRobot: '#f2c94c', Orbital: '#70c0e0', PlanetaryScanner: '#35e0d0',
  PlanetaryDefense: '#4fb3ff', Terraforming: '#5dde7a', Planetary: '#ffd24a',
};

export function componentSvg(cat: string, tags: string[] = [], tier = 0): string {
  const c = CAT_COLOR[cat] ?? '#8090a8';
  const hi = `stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const fl = `fill="${c}"`;
  let g = '';
  switch (cat) {
    case 'Engine': g = `<path d="M10 14 h16 l6 6 v8 l-6 6 h-16 z" ${hi}/><path d="M32 20 q8 4 0 8" ${hi}/>${tags.includes('Ramscoop') ? `<path d="M6 12 q-2 12 0 24" ${hi}/>` : ''}<path d="M34 22 l8 2 l-8 2" ${fl} opacity=".7"/>`; break;
    case 'BeamWeapon': g = `<rect x="6" y="20" width="16" height="8" rx="2" ${hi}/><path d="M22 24 h22" stroke="${c}" stroke-width="3"/>${tags.includes('GatlingGun') ? `<path d="M22 19 h18 M22 29 h18" ${hi}/>` : ''}${tags.includes('ShieldSapper') ? '<circle cx="40" cy="24" r="5" fill="none" stroke="#fff" stroke-width="1.5"/>' : ''}`; break;
    case 'Torpedo': g = `<path d="M8 24 l26 -6 l8 6 l-8 6 z" ${hi}/><path d="M8 18 v12" ${hi}/>${tags.includes('CapitalShipMissile') ? `<circle cx="30" cy="24" r="3" ${fl}/>` : ''}`; break;
    case 'Bomb': g = `<circle cx="22" cy="27" r="11" ${hi}/><path d="M28 17 l6 -7" ${hi}/><circle cx="35" cy="9" r="2" ${fl}/>${tags.includes('SmartBomb') ? '<path d="M17 27 h10 M22 22 v10" stroke="#fff" stroke-width="1.6"/>' : ''}`; break;
    case 'Armor': g = `<path d="M24 6 l14 6 v10 c0 10 -6 16 -14 20 c-8 -4 -14 -10 -14 -20 v-10 z" ${hi}/><path d="M24 12 v24" ${hi} opacity=".6"/>`; break;
    case 'Shield': g = `<path d="M8 32 a16 16 0 0 1 32 0" ${hi}/><path d="M13 32 a11 11 0 0 1 22 0" ${hi} opacity=".6"/><path d="M8 34 h32" ${hi}/>`; break;
    case 'Scanner': case 'PlanetaryScanner': g = `<path d="M10 34 a16 16 0 0 1 22 -22" ${hi}/><path d="M16 34 a10 10 0 0 1 14 -14" ${hi} opacity=".7"/><circle cx="18" cy="30" r="3" ${fl}/><path d="M18 30 l18 -18" ${hi}/>${cat === 'PlanetaryScanner' ? '<path d="M14 40 h20" stroke="#fff" stroke-width="2"/>' : ''}`; break;
    case 'Electrical': g = `<rect x="12" y="12" width="24" height="24" rx="3" ${hi}/>${[16, 22, 28].map(v => `<path d="M${v} 8 v4 M${v} 36 v4 M8 ${v} h4 M36 ${v} h4" ${hi}/>`).join('')}<circle cx="24" cy="24" r="4" ${fl}/>`; break;
    case 'Mechanical': g = `<circle cx="24" cy="24" r="8" ${hi}/>${Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return `<path d="M${24 + Math.cos(a) * 9} ${24 + Math.sin(a) * 9} L${24 + Math.cos(a) * 14} ${24 + Math.sin(a) * 14}" ${hi}/>`; }).join('')}`; break;
    case 'MineLayer': g = `<rect x="8" y="16" width="18" height="16" rx="3" ${hi}/>${[0, 1, 2].map(i => `<circle cx="${32 + i * 5}" cy="${18 + i * 6}" r="2.6" ${fl}/>`).join('')}`; break;
    case 'MineRobot': g = `<rect x="8" y="14" width="18" height="20" rx="3" ${hi}/><path d="M26 24 l10 -8 l6 4 M26 24 l10 8 l6 -4" ${hi}/>`; break;
    case 'Orbital': g = tags.includes('Stargate') ? `<circle cx="24" cy="24" r="14" ${hi}/><circle cx="24" cy="24" r="8" ${hi} opacity=".6"/><circle cx="24" cy="24" r="3" ${fl}/>` : `<path d="M8 18 h32 M8 30 h32" ${hi}/><path d="M14 24 h18" stroke="${c}" stroke-width="4"/><circle cx="38" cy="24" r="3" ${fl}/>`; break;
    case 'PlanetaryDefense': g = `<path d="M8 36 a16 16 0 0 1 32 0 z" ${hi}/><path d="M24 20 v-10" ${hi}/>`; break;
    case 'Terraforming': g = `<circle cx="24" cy="24" r="12" ${hi}/><path d="M8 10 l6 6 M40 10 l-6 6 M8 38 l6 -6 M40 38 l-6 -6" ${hi}/>`; break;
    default: g = `<circle cx="24" cy="24" r="12" ${hi}/><path d="M18 24 h12 M24 18 v12" ${hi}/>`;
  }
  const pips = tier > 0 ? Array.from({ length: Math.min(5, tier) }, (_, i) => `<rect x="${4 + i * 5}" y="42" width="3.5" height="3.5" fill="${c}" opacity=".9"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="1" y="1" width="46" height="46" rx="7" fill="#121a2a" stroke="#26324a"/>${g}${pips}</svg>`;
}

export function componentDataUrl(cat: string, tags: string[] = [], tier = 0): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(componentSvg(cat, tags, tier));
}

// 0.3.9: the sixteen of the start, then eight unlocked by achievements (achievements.ts)
export const RACE_ICONS = ['✦', '❖', '✺', '❂', '✹', '⬢', '✿', '⚔', '◈', '⛨', '✸', '☄', '◉', '✷', '⟁', '☾', '♛', '⚛', '☠', '♜', '⚚', '❦', '✠', '⚜'];
