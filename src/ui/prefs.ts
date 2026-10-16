// 0.3.9: display and sound preferences of this browser (not of the game): text size, colour-blind palettes, sound.
// Applied to the whole interface: a CSS zoom for the text size, CSS variables and the map's colours for the palettes,
// the empires' colours (kept in the game as baseColor, shown in a safe palette), the volumes of the sound engine.
import type { GameState } from '../engine/types';
import { PLAYER_COLORS } from '../engine/newgame';

export type ColorMode = 'normal' | 'rg' | 'by';
export interface UiPrefs { textScale: number; colors: ColorMode; sound: boolean; music: number; sfx: number }
const KEY = 'constellations.ui';
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3, 1.5];
/** The interface's zoom (text size): screen pixels per interface pixel. */
export const uiZoom = () => uiPrefs.textScale || 1;

export const uiPrefs: UiPrefs = { textScale: 1, colors: 'normal', sound: true, music: 0.35, sfx: 0.6 };
try { Object.assign(uiPrefs, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* private mode: defaults */ }

const listeners = new Set<() => void>();
export const onPrefs = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function setPrefs(p: Partial<UiPrefs>) {
  Object.assign(uiPrefs, p);
  try { localStorage.setItem(KEY, JSON.stringify(uiPrefs)); } catch { /* ignore */ }
  applyPrefs();
  for (const f of listeners) f();
}

/** Semantic colours of the map, by palette (the CSS variables follow the same choice). */
const MAP: Record<ColorMode, { good: string; bad: string; enemy: string; friend: string; own: string }> = {
  normal: { good: '#5ee08a', bad: '#ff5f6d', enemy: '#ff4d4d', friend: '#ffd24a', own: '#4fd6e3' },
  // red-green (deuteranopia, protanopia): blue against orange
  rg: { good: '#4aa3ff', bad: '#ff9f1c', enemy: '#ff8c00', friend: '#f0e442', own: '#7fdbff' },
  // blue-yellow (tritanopia): green-cyan against red-pink
  by: { good: '#2ee6a6', bad: '#ff4f7b', enemy: '#ff3b3b', friend: '#ff9ff3', own: '#e6f7ff' },
};
export const mapColors = () => MAP[uiPrefs.colors] ?? MAP.normal;

/** The empires' colours in each palette (same order as PLAYER_COLORS; Okabe-Ito based for red-green). */
const PALETTES: Record<Exclude<ColorMode, 'normal'>, string[]> = {
  rg: ['#56b4e9', '#e69f00', '#f0e442', '#ffffff', '#cc79a7', '#d55e00', '#7fdbff', '#b8b8b8', '#0072b2', '#ffb3de', '#c9b037', '#9a6fb0', '#ff8c00', '#a0e0ff', '#7a7aff', '#ffff99'],
  by: ['#ff5d5d', '#2fd1d1', '#ffffff', '#ff9ff3', '#e8452c', '#3cb371', '#b5b5b5', '#ff1493', '#8b0000', '#00ced1', '#ffa07a', '#98fb98', '#c71585', '#40e0d0', '#f08080', '#e0ffff'],
};

/** Shows every empire of the game in the chosen palette (the colour chosen at creation stays in baseColor). */
export function applyPlayerColors(g: GameState | null) {
  if (!g) return;
  for (const p of g.players) {
    if (p.monster) continue;
    if (!p.baseColor) p.baseColor = p.color;
    const i = PLAYER_COLORS.indexOf(p.baseColor);
    p.color = uiPrefs.colors === 'normal' || i < 0 ? p.baseColor : PALETTES[uiPrefs.colors][i];
  }
}

let current: GameState | null = null;
export function applyPrefs(g?: GameState | null) {
  if (g !== undefined) current = g;
  applyPlayerColors(current);
  if (typeof document === 'undefined' || !document) return;
  const root = document.documentElement;
  root.style.setProperty('--ui-zoom', String(uiPrefs.textScale));
  if (uiPrefs.colors === 'normal') delete root.dataset.cb; else root.dataset.cb = uiPrefs.colors;
  narrow();
}

/** Width of the interface in its own pixels (the window's width divided by the zoom). */
export const viewWidth = () => (typeof window === 'undefined' ? 1440 : window.innerWidth / uiZoom());
/** Phone layout (one column, the page scrolls) when the interface is narrow; the CSS asks the same of its container. */
function narrow() {
  if (typeof document === 'undefined' || !document) return;
  if (viewWidth() <= 820) document.documentElement.dataset.narrow = ''; else delete document.documentElement.dataset.narrow;
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', narrow);

(globalThis as any).__prefs = { setPrefs, uiPrefs };
