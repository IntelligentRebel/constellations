// Global UI state for the browser client.
import { beforeGenerate, prepareTurn } from '../engine/pbem';
import { popScale } from '../engine/words';
import { useEffect, useState } from 'preact/hooks';
import { ensureSpecialShift } from '../engine/specials';
import { tidyRefits } from '../engine/refit';
import { tidyDesigns } from '../engine/design';
import { applyPrefs } from './prefs';
import { snapshot, afterTurn, moodNow } from './sound';
import { checkAchievements } from './achievements';
import { play } from './audio';
import type { GameState, Player } from '../engine/types';
import { generateTurn } from '../engine/turn';
import { backup, backupSoon, backupSupported, initBackup, latestBackup } from './backup';

const backupDeclined = () => { try { return localStorage.getItem('constellations.v1.backupDeclined') === '1'; } catch { return false; } };

export type ObjRef = { kind: 'planet' | 'fleet' | 'wormhole' | 'minefield' | 'packet' | 'salvage' | 'trader' | 'space'; id: number; x?: number; y?: number };

export type DialogKind =
  | 'backups' | 'production' | 'research' | 'designer' | 'battlePlans' | 'relations' | 'reports' | 'battle' | 'cargo' | 'split' | 'merge'
  | 'techBrowser' | 'raceView' | 'newGame' | 'raceWizard' | 'help' | 'score' | 'settings' | 'templates' | 'find' | 'planner' | 'about' | 'rename' | 'gameOver' | 'confirm' | 'export' | 'import' | 'warn' | 'upgrade' | 'designView'
  | 'victory' | 'prefs' | 'chronicle' | 'achievements' | 'dilemma' | 'pbem' | 'governor';

export interface Dialog { kind: DialogKind; data?: any }

export type TabId = 'map' | 'colonies' | 'planner' | 'mining' | 'fleets' | 'empire' | 'design' | 'research' | 'diplomacy' | 'reports' | 'guide';
/** pages that keep the selection panel on the right */
export const INSPECTOR_TABS: TabId[] = ['map', 'colonies', 'planner', 'mining', 'fleets'];

export interface ViewSettings {
  /** 7 (3.6): empires and our relations to them */
  mode: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  scan: boolean;
  mines: boolean;
  paths: boolean;
  names: boolean;
  counts: boolean;
  scanPct: number;
  idleOnly: boolean;
  designFilter: number | null;
  enemyTracks: boolean;
  wormholes: boolean;
  minimap: boolean;
  /** Constellations 3: administrative radius of the capitals */
  admin?: boolean;
  /** Constellations 3.3: cultural territories */
  borders?: boolean;
  /** planners: distance filter per page (from = -1: nearest colony, else one of your planets) */
  ranges?: Record<string, { max: number | null; from: number }>;
}

export interface Camera { x: number; y: number; zoom: number }

const SAVE_KEY = 'constellations.v1.save'; // single save of versions <= 1.3
const INDEX_KEY = 'constellations.v1.slots';
const GAME_KEY = 'constellations.v1.game.';
const MAX_SLOTS = 8;

export interface SaveSlot { id: string; name: string; year: number; race: string; players: number; humans: number; updated: number }
const PREFS_KEY = 'constellations.v1.prefs';

class Store {
  game: GameState | null = null;
  selected: ObjRef | null = null;
  commanded: { kind: 'planet' | 'fleet'; id: number } | null = null;
  waypointIndex = 0;
  view: ViewSettings = { mode: 1, scan: true, mines: true, paths: true, names: true, counts: true, scanPct: 0, idleOnly: false, designFilter: null, enemyTracks: true, wormholes: true, minimap: true, admin: true };
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  dialogs: Dialog[] = [];
  messageIndex = 0;
  version = 0;
  dirty = false;
  undo: string[] = [];
  busy = false;
  /** touch-friendly substitute for Shift+click: map taps add waypoints */
  wpMode = false;
  toast: { text: string; t: number } | null = null;
  collapsed: Record<string, boolean> = {};
  /** 0.3.9: the item of the « À traiter » queue shown last (T) */
  todoKey: string | null = null;
  /** current page (top tabs) */
  tab: TabId = 'map';
  tabData: any = null;
  /** phone layout: empire drawer open */
  drawer = false;
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
      if (prefs?.view) this.view = { ...this.view, ...prefs.view };
      // 3.6: ship counts are shown by default (once, for preferences saved before)
      if (prefs && !prefs.v36) this.view.counts = true;
      if (prefs?.collapsed) this.collapsed = prefs.collapsed;
    } catch { /* ignore */ }
  }

  get me(): Player | null { return this.game ? this.game.players[this.game.human] : null; }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private camListeners = new Set<() => void>();
  subscribeCamera(fn: () => void) { this.camListeners.add(fn); return () => { this.camListeners.delete(fn); }; }
  /** pan/zoom: only the map needs to redraw, not the whole interface */
  setCamera(c: Camera) { this.camera = c; for (const l of this.camListeners) l(); }
  bump() { this.version++; for (const l of this.listeners) l(); }

  savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ view: this.view, collapsed: this.collapsed, v36: true })); } catch { /* ignore */ }
  }

  /** call before a user modification so it can be undone */
  checkpoint() {
    if (!this.game) return;
    this.undo.push(JSON.stringify(this.game));
    if (this.undo.length > 25) this.undo.shift();
    this.dirty = true;
    this.autosaveSoon();
  }

  undoLast() {
    const s = this.undo.pop();
    if (!s) { this.notify('Rien à annuler'); return; }
    // 0.3.8: the tutorial's progress is not an order: Undo leaves it where it is
    const tut = this.game?.tutorial;
    this.game = JSON.parse(s);
    if (tut && this.game) this.game.tutorial = tut;
    this.notify('Action annulée');
    this.bump();
  }

  setGame(g: GameState, keepCamera = false) {
    ensureSpecialShift(g);
    tidyRefits(g);
    tidyDesigns(g);
    applyPrefs(g);
    this.game = g;
    this.undo = [];
    this.dialogs = [];
    this.messageIndex = 0;
    this.tab = 'map';
    const me = g.players[g.human];
    const hw = g.planets.find(p => p.owner === me.id && p.homeworld) ?? g.planets.find(p => p.owner === me.id);
    if (hw) { this.commanded = { kind: 'planet', id: hw.id }; this.selected = { kind: 'planet', id: hw.id }; if (!keepCamera) this.camera = { x: hw.x, y: hw.y, zoom: 1.4 }; }
    // 0.3.9: a game played by turn files has no hand-over screen (each player plays at home)
    this.handoff = !g.pbem && this.humans().length > 1;
    try { moodNow(g, me); } catch { /* ignore */ }
    this.achievements(me);
    this.save();
    // 0.3.6.7: the backup folder, proposed once (the player may decline)
    if (!g.tutorial && backupSupported() && backup.status === 'none' && !backupDeclined()) this.open('backups', { intro: true });
    this.bump();
  }

  /** most recent saved game in this browser: undefined while reading, null if none */
  saved: GameState | null | undefined = undefined;
  /** all save slots, most recent first */
  slots: SaveSlot[] = [];
  private saveTimer = 0;
  private saveSeq = 0;

  private readIndex(): SaveSlot[] {
    try { const a = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  private writeIndex(list: SaveSlot[]) {
    list.sort((a, b) => b.updated - a.updated);
    this.slots = list;
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }
  private slotOf(g: GameState): SaveSlot {
    const me = g.players[g.human];
    return { id: g.id!, name: g.name, year: g.year, race: me?.name ?? '', players: g.players.filter(p => !p.monster).length, humans: g.players.filter(p => !p.ai).length, updated: Date.now() };
  }

  /** Saves to browser storage (compressed when possible), in this game's own slot. */
  save() {
    if (!this.game) return;
    const g = this.game;
    g.id ??= Math.random().toString(36).slice(2, 10);
    clearTimeout(this.saveTimer);
    const json = JSON.stringify(g);
    const seq = ++this.saveSeq;
    this.dirty = false;
    // 0.3.6.7: and a backup file of this turn, in the folder the player chose
    backupSoon(g, json);
    void packSave(json).then(data => {
      if (seq !== this.saveSeq) return; // a newer save superseded this one
      const key = GAME_KEY + g.id;
      let list = this.readIndex().filter(x => x.id !== g.id);
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          localStorage.setItem(key, data);
          list.push(this.slotOf(g));
          // keep the most recent games only
          list.sort((a, b) => b.updated - a.updated);
          for (const old of list.slice(MAX_SLOTS)) { try { localStorage.removeItem(GAME_KEY + old.id); } catch { /* ignore */ } }
          this.writeIndex(list.slice(0, MAX_SLOTS));
          return;
        } catch {
          // storage full: drop the oldest other game and retry
          list.sort((a, b) => b.updated - a.updated);
          const victim = list.pop();
          if (!victim) break;
          try { localStorage.removeItem(GAME_KEY + victim.id); } catch { /* ignore */ }
        }
      }
      this.notify('Sauvegarde locale impossible (stockage plein) : exportez la partie.');
    });
  }

  /** Brings back the most recent backup file into this browser (true when there was one). */
  async restoreLatestBackup(): Promise<boolean> {
    const last = await latestBackup();
    if (!last) return false;
    const g = last.game;
    g.id ??= Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(GAME_KEY + g.id, await packSave(JSON.stringify(g))); } catch { /* still playable from memory */ }
    this.writeIndex([...this.readIndex().filter(x => x.id !== g.id), this.slotOf(g)]);
    this.saved = g;
    this.restoredFrom = last.file;
    this.bump();
    return true;
  }

  /** synchronous best-effort save (page closing) */
  saveNow() {
    if (!this.game || !this.dirty || !this.game.id) return;
    try { const json = JSON.stringify(this.game); if (json.length < 2_000_000) localStorage.setItem(GAME_KEY + this.game.id, json); } catch { /* ignore */ }
  }

  /** orders changed: save a moment later */
  autosaveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { if (this.dirty) this.save(); }, 1500);
  }

  async readSlot(id: string): Promise<GameState | null> {
    try {
      const s = localStorage.getItem(GAME_KEY + id);
      if (!s) return null;
      const g = JSON.parse(await unpackSave(s));
      if (g?.format !== 'constellations-1') return null;
      g.id = id;
      return g;
    } catch { return null; }
  }

  /** 0.3.9: is there a saved game in this slot (in this browser)? */
  hasSlot(id: string): boolean { return this.readIndex().some(x => x.id === id); }

  deleteSlot(id: string) {
    try { localStorage.removeItem(GAME_KEY + id); } catch { /* ignore */ }
    this.writeIndex(this.readIndex().filter(x => x.id !== id));
    if (this.saved?.id === id) this.saved = null;
    void this.loadSaved();
  }

  /** 0.3.6.7: the backup file the last game came back from (when the browser had lost it) */
  restoredFrom: string | null = null;

  async loadSaved(): Promise<GameState | null> {
    // one-time migration of the single save used by earlier versions
    try {
      const legacy = localStorage.getItem(SAVE_KEY);
      if (legacy) {
        const g = JSON.parse(await unpackSave(legacy));
        if (g?.format === 'constellations-1') {
          g.id ??= Math.random().toString(36).slice(2, 10);
          localStorage.setItem(GAME_KEY + g.id, legacy);
          const list = this.readIndex().filter(x => x.id !== g.id);
          list.push({ ...this.slotOf(g), updated: Date.now() - 1000 });
          this.writeIndex(list);
        }
        localStorage.removeItem(SAVE_KEY);
      }
    } catch { /* ignore */ }
    // 0.3.6.7: a game whose data is here but not in the list (an interrupted save) comes back into it
    try {
      const list = this.readIndex(), known = new Set(list.map(x => x.id));
      let found = false;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(GAME_KEY) || known.has(k.slice(GAME_KEY.length))) continue;
        const g = await this.readSlot(k.slice(GAME_KEY.length));
        if (g) { list.push({ ...this.slotOf(g), updated: Date.now() - 2000 }); found = true; }
      }
      if (found) this.writeIndex(list);
    } catch { /* ignore */ }
    this.slots = this.readIndex().sort((a, b) => b.updated - a.updated);
    // the most recent game that can be read (one that cannot does not hide the others)
    this.saved = null;
    for (const sl of this.slots) { const g = await this.readSlot(sl.id); if (g) { this.saved = g; break; } }
    // 0.3.6.7: nothing in the browser: the last backup file, when the folder is allowed
    await initBackup();
    if (!this.saved && backup.status === 'ok') await this.restoreLatestBackup();
    this.bump();
    return this.saved ?? null;
  }

  notify(text: string) { this.toast = { text, t: Date.now() }; this.bump(); setTimeout(() => { if (this.toast && Date.now() - this.toast.t >= 2900) { this.toast = null; this.bump(); } }, 3000); }

  open(kind: DialogKind, data?: any) { this.dialogs = this.dialogs.filter(d => d.kind !== kind); this.dialogs.push({ kind, data }); this.bump(); }
  close(kind?: DialogKind) { if (kind) this.dialogs = this.dialogs.filter(d => d.kind !== kind); else this.dialogs.pop(); this.bump(); }
  isOpen(kind: DialogKind) { return this.dialogs.some(d => d.kind === kind); }

  select(ref: ObjRef | null, command = true) {
    this.selected = ref;
    if (ref && command && this.game && (ref.kind === 'planet' || ref.kind === 'fleet')) {
      const me = this.game.human;
      if (ref.kind === 'planet' && this.game.planets[ref.id]?.owner === me) { this.commanded = { kind: 'planet', id: ref.id }; }
      if (ref.kind === 'fleet') {
        const f = this.game.fleets.find(x => x.id === ref.id);
        if (f && f.owner === me) { this.commanded = { kind: 'fleet', id: ref.id }; this.waypointIndex = Math.min(1, f.waypoints.length - 1); }
      }
    }
    this.bump();
  }

  /** in-page confirmation (window.confirm is unavailable in the artifact viewer) */
  ask(message: string, onYes: () => void, yesLabel = 'Confirmer') { this.open('confirm', { message, onYes, yesLabel }); }

  goTab(t: TabId, data?: any) { this.tab = t; this.tabData = data ?? null; this.drawer = false; this.dialogs = this.dialogs.filter(d => !['research', 'designer', 'relations', 'reports', 'planner', 'help', 'score'].includes(d.kind)); this.bump(); }

  /** select an object and show it on the map */
  focus(ref: ObjRef, pos?: { x: number; y: number } | null) {
    if (!INSPECTOR_TABS.includes(this.tab) || this.tab !== 'map') this.tab = 'map';
    this.drawer = false;
    this.select(ref);
    if (pos) this.center(pos.x, pos.y);
  }

  center(x: number, y: number) { this.camera = { ...this.camera, x, y }; this.bump(); }

  /** hotseat: the next player must confirm before seeing the map */
  handoff = false;

  humans(): number[] { return this.game ? this.game.players.filter(p => !p.ai && !p.dead).map(p => p.id) : []; }

  /** Switch the active human (hotseat) and hide the screen until they confirm. */
  private switchTo(id: number) {
    const g = this.game!;
    g.human = id;
    this.undo = []; this.dialogs = []; this.messageIndex = 0; this.wpMode = false; this.tab = 'map';
    const hw = g.planets.find(p => p.owner === id && p.homeworld) ?? g.planets.find(p => p.owner === id);
    this.commanded = hw ? { kind: 'planet', id: hw.id } : null;
    this.selected = this.commanded;
    if (hw) this.camera = { x: hw.x, y: hw.y, zoom: 1.4 };
    this.handoff = true;
  }

  /** 0.3.9: achievements just earned, told in the toast. */
  achievements(p: Player) {
    if (!this.game || p.ai) return;
    const fresh = checkAchievements(this.game, p);
    if (fresh.length) { this.notify(fresh.length > 1 ? `Succès débloqués : ${fresh.map(a => a.name).join(', ')}` : `Succès débloqué : ${fresh[0].name}`); try { play('discovery', 1.6); } catch { /* ignore */ } }
  }

  async endTurn(years = 1, hostGo = false) {
    if (!this.game || this.busy) return;
    // 0.3.9: by turn files, a player sends orders, the host generates from its window
    const P = this.game.pbem;
    if (P && (P.role === 'player' || !hostGo)) { this.open('pbem'); return; }
    if (P) { beforeGenerate(this.game); years = 1; }
    const humans = P ? [] : this.humans();
    if (humans.length > 1) {
      // hotseat: every human gives orders, then the year is generated
      const g = this.game;
      g.submitted = [...new Set([...(g.submitted ?? []), g.human])].filter(h => humans.includes(h));
      const next = humans.find(h => !g.submitted!.includes(h));
      if (next !== undefined) {
        if (years > 1) this.notify('Partie à plusieurs : les tours se génèrent un an à la fois.');
        this.switchTo(next); this.save(); this.bump(); return;
      }
      g.submitted = [];
      years = 1;
    }
    this.busy = true; this.bump();
    const listener = this.game.players[this.game.human];
    const before = snapshot(this.game, listener);
    await new Promise(r => setTimeout(r, 30));
    try {
      for (let i = 0; i < years; i++) {
        generateTurn(this.game);
        if (this.game.players[this.game.human].dead) break;
        if (years > 1 && this.game.battles.some(b => b.players.includes(this.game!.human))) break;
      }
    } catch (e) {
      console.error(e);
      this.notify('Erreur pendant la génération du tour : ' + (e as Error).message);
    }
    this.undo = [];
    this.messageIndex = 0;
    // keep commanded object valid
    if (this.commanded?.kind === 'fleet' && !this.game.fleets.some(f => f.id === this.commanded!.id)) {
      const hw = this.game.planets.find(p => p.owner === this.game!.human);
      this.commanded = hw ? { kind: 'planet', id: hw.id } : null;
    }
    if (this.commanded?.kind === 'planet' && this.game.planets[this.commanded.id].owner !== this.game.human) {
      const hw = this.game.planets.find(p => p.owner === this.game!.human);
      this.commanded = hw ? { kind: 'planet', id: hw.id } : null;
    }
    if (this.selected?.kind === 'fleet' && !this.game.fleets.some(f => f.id === this.selected!.id) && !this.me?.intel.fleets.some(f => f.id === this.selected!.id)) this.selected = this.commanded;
    this.busy = false;
    if (P) prepareTurn(this.game);
    const after = this.humans();
    if (humans.length > 1 && after.length) this.switchTo(after[0]);
    this.save();
    try { afterTurn(this.game, listener, before); } catch { /* sound is never worth an error */ }
    if (!P) this.achievements(listener);
    if (this.game.victor !== null && !this.game.victoryAnnounced) { this.game.victoryAnnounced = true; this.open('gameOver'); }
    if (this.me?.dead && !after.length) this.open('gameOver');
    this.bump();
  }
}

// ------------------------------------------------------------------ save packing (gzip + base64 when available)
async function packSave(json: string): Promise<string> {
  try {
    if (typeof CompressionStream === 'undefined' || json.length < 200_000) return json;
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return 'gz1:' + btoa(bin);
  } catch { return json; }
}
async function unpackSave(s: string): Promise<string> {
  if (!s.startsWith('gz1:')) return s;
  const bin = atob(s.slice(4));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export const store = new Store();
void store.loadSaved();
(globalThis as any).__store = store;

export function useStore(): Store {
  const [, set] = useState(0);
  const seen = store.version;
  useEffect(() => {
    const off = store.subscribe(() => set(v => v + 1));
    if (store.version !== seen) set(v => v + 1); // changed between render and subscription
    return off;
  }, []);
  return store;
}

// ------------------------------------------------------------------ formatting helpers

export const fmt = (n: number, digits = 0) => (Number.isFinite(n) ? (n + 0 === 0 ? 0 : n).toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '∞');
/**
 * A population (in the rules' colonists). 3.6: when the game shows populations in millions (a colonist stands for a
 * thousand people), compactly: "25 M", "1,02 Md".
 */
export const fmtPop = (n: number) => {
  if (!store.game || popScale(store.game) === 1) return fmt(Math.floor(n / 100) * 100);
  const v = n * popScale(store.game);
  if (v >= 1e9) return `${fmt(v / 1e9, v < 1e10 ? 2 : 1)} Md`;
  if (v >= 1e6) return `${fmt(v / 1e6, v < 1e7 ? 1 : 0)} M`;
  return fmt(Math.round(v / 1000) * 1000);
};
/** A yearly change of population, signed, in the units of the game (millions when it shows them). */
export const fmtGrowth = (n: number) => (n >= 0 ? '+' : '−') + (!store.game || popScale(store.game) === 1 ? fmt(Math.abs(n)) : fmtPop(Math.abs(n)));
/** A number of people in full (sentences, tooltips). */
export const fmtPeople = (n: number) => fmt(n * (store.game ? popScale(store.game) : 1));
export const pct = (x: number, digits = 0) => `${fmt(x * 100, digits)} %`;
export const plural = (n: number, s: string, p = s + 's') => `${fmt(n)} ${n > 1 ? p : s}`;
export const MINERAL_COLORS = { ironium: '#4f8dff', boranium: '#3ecf6e', germanium: '#f2c94c', colonists: '#e8ecf4', fuel: '#ff5d5d' };
export const MINERAL_LABELS = { ironium: 'Ironium', boranium: 'Boranium', germanium: 'Germanium', colonists: 'Colons', fuel: 'Carburant' };

// ------------------------------------------------------------------ file saving
/** Hosted viewer (claude.ai artifact): the page cannot download directly, it asks the host. */
const hosted = typeof window !== 'undefined' && typeof (window as any).claude?.use === 'function';
let downloadsNs: any = undefined; // undefined = pending, null = unavailable
if (hosted) (window as any).claude.use('downloads').then((d: any) => { downloadsNs = d ?? null; store.bump(); }, () => { downloadsNs = null; store.bump(); });

/** 'direct' (standalone file), 'host' (artifact viewer with downloads), 'pending' or 'none' */
export function saveMode(): 'direct' | 'host' | 'pending' | 'none' {
  if (!hosted) return 'direct';
  return downloadsNs === undefined ? 'pending' : downloadsNs ? 'host' : 'none';
}

export async function saveFile(filename: string, text: string): Promise<boolean> {
  const blob = new Blob([text], { type: 'application/json' });
  if (!hosted) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  }
  if (!downloadsNs) return false;
  try { await downloadsNs.save({ filename, data: blob }); store.notify('Fichier enregistré'); return true; }
  catch (e: any) {
    if (e?.code === 'declined') return false;
    if (e?.code === 'rate_limited') { store.notify('Une demande d\'enregistrement est déjà ouverte'); return false; }
    store.notify('Enregistrement impossible ici : copiez le texte.'); return false;
  }
}
