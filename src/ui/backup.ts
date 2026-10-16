// 0.3.6.7: backup files. The browser keeps the games in its own storage, which a cleared browser, another browser or
// (in Firefox) another copy of the game does not see. With the player's leave (the browser asks), the game also writes
// the last five turns of each game as .json files into a folder of their choice, and reads them back when the browser
// has nothing. File System Access API: Chrome and Edge, from the game's own page (not from inside a frame).
import type { GameState } from '../engine/types';

type Perm = 'granted' | 'denied' | 'prompt';
interface Handle { kind: 'file' | 'directory'; name: string; queryPermission?(o: { mode: 'readwrite' }): Promise<Perm>; requestPermission?(o: { mode: 'readwrite' }): Promise<Perm> }
interface FileH extends Handle { kind: 'file'; getFile(): Promise<File>; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }
interface Dir extends Handle { kind: 'directory'; values(): AsyncIterable<FileH | Dir>; getFileHandle(n: string, o?: { create?: boolean }): Promise<FileH>; removeEntry(n: string): Promise<void> }

/** Turns kept for each game. */
export const KEEP = 5;

/** The browser could write into a folder, but not from a page shown inside another site (the hosted version). */
export const backupInFrame = () => {
  if (typeof window === 'undefined' || typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') return false;
  try { return window.top !== window.self; } catch { return true; }
};

export const backupSupported = () => {
  if (typeof window === 'undefined' || typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') return false;
  try { return window.top === window.self; } catch { return false; }
};

export interface BackupState {
  /** none: no folder chosen; needsPermission: chosen, the browser wants a click to allow it again; ok; error: the folder is gone */
  status: 'none' | 'needsPermission' | 'ok' | 'error';
  /** the folder's name (the browser does not give its path) */
  name: string;
  /** the last file written */
  last?: string;
}
export const backup: BackupState = { status: 'none', name: '' };
let folder: Dir | null = null;
const listeners = new Set<() => void>();
export const onBackupChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const changed = () => { for (const f of listeners) f(); };

// ------------------------------------------------------------------ the folder handle, kept in IndexedDB
const DB = 'constellations', STORE = 'kv', KEY = 'backupFolder';
function db(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((ok, ko) => {
    const r = f(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => ok(r.result as T);
    r.onerror = () => ko(r.error);
  });
}

async function permitted(h: Handle, ask: boolean): Promise<boolean> {
  try {
    if (!h.queryPermission) return true;
    if (await h.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
    return ask && !!h.requestPermission && await h.requestPermission({ mode: 'readwrite' }) === 'granted';
  } catch { return false; }
}

/** Reads the folder chosen in an earlier session (without asking anything). */
export async function initBackup(): Promise<BackupState> {
  if (!backupSupported()) return backup;
  try {
    const h = await idb<Dir | undefined>('readonly', s => s.get(KEY));
    if (h) { folder = h; backup.name = h.name; backup.status = await permitted(h, false) ? 'ok' : 'needsPermission'; }
  } catch { /* no IndexedDB: no backups */ }
  changed();
  return backup;
}

/** Uses this folder from now on (also for tests, with a folder of the browser's private file system). */
export async function useFolder(h: Dir): Promise<void> {
  folder = h; backup.name = h.name; backup.status = 'ok';
  try { await idb('readwrite', s => s.put(h, KEY)); } catch { /* kept for this session only */ }
  changed();
}

/** Asks the player for a folder (call from a click). */
export async function chooseFolder(): Promise<boolean> {
  try {
    const h = await (window as unknown as { showDirectoryPicker(o: object): Promise<Dir> }).showDirectoryPicker({ id: 'constellations-backup', mode: 'readwrite', startIn: 'documents' });
    await useFolder(h);
    return true;
  } catch { return false; }
}

/** The browser asks again for the folder chosen earlier (call from a click: it shows its own prompt). */
export async function allowFolder(): Promise<boolean> {
  if (!folder) return false;
  const ok = await permitted(folder, true);
  backup.status = ok ? 'ok' : 'needsPermission';
  changed();
  return ok;
}

/** Stops writing backups (the files stay where they are). */
export async function forgetFolder(): Promise<void> {
  folder = null; backup.status = 'none'; backup.name = ''; backup.last = undefined;
  try { await idb('readwrite', s => s.delete(KEY)); } catch { /* ignore */ }
  changed();
}

// ------------------------------------------------------------------ the files
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'partie';
export const backupName = (g: GameState) => `Constellations - ${safe(g.name)} - ${g.year} - ${g.id}.json`;
const PATTERN = /^Constellations - (.*) - (\d{4,}) - ([a-z0-9]+)\.json$/;

export interface BackupEntry { file: string; game: string; year: number; id: string; modified: number; size: number }

async function entries(): Promise<(BackupEntry & { h: FileH })[]> {
  if (!folder) return [];
  const out: (BackupEntry & { h: FileH })[] = [];
  for await (const h of folder.values()) {
    if (h.kind !== 'file') continue;
    const m = PATTERN.exec(h.name);
    if (!m) continue;
    const f = await h.getFile();
    out.push({ h, file: h.name, game: m[1], year: +m[2], id: m[3], modified: f.lastModified, size: f.size });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** The backups in the folder, most recent first. */
export async function listBackups(): Promise<BackupEntry[]> {
  if (backup.status !== 'ok') return [];
  try { return (await entries()).map(({ h: _h, ...e }) => e); } catch { backup.status = 'error'; changed(); return []; }
}

/** A backup file, read back as a game (null when it is not one). */
export async function readBackup(file: string): Promise<GameState | null> {
  if (!folder) return null;
  try {
    const g = JSON.parse(await (await (await folder.getFileHandle(file)).getFile()).text());
    return g?.format === 'constellations-1' ? g : null;
  } catch { return null; }
}

/** The most recent backup of all games, read back (null when there is none or the folder is not allowed). */
export async function latestBackup(): Promise<{ game: GameState; file: string } | null> {
  for (const e of await listBackups()) {
    const g = await readBackup(e.file);
    if (g) return { game: g, file: e.file };
  }
  return null;
}

// writes go one after the other; the last state of a game within a short delay wins
let queue: Promise<void> = Promise.resolve();
const pending = new Map<string, { g: GameState; json: string }>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Writes this state of the game a moment later (its year's file, then keeps the five most recent files of the game). */
export function backupSoon(g: GameState, json: string, delay = 1500): void {
  if (backup.status !== 'ok' || !g.id) return;
  // one file per year: the last state of each year within the delay (turns played quickly each keep theirs)
  pending.set(`${g.id}|${g.year}`, { g: { ...g }, json });
  clearTimeout(timer);
  timer = setTimeout(() => { void flushBackups(); }, delay);
}

/** Writes what is waiting now (tests, end of a turn). */
export function flushBackups(): Promise<void> {
  const jobs = [...pending.values()];
  pending.clear();
  for (const { g, json } of jobs) queue = queue.then(() => writeOne(g, json));
  return queue;
}

async function writeOne(g: GameState, json: string): Promise<void> {
  if (!folder || backup.status !== 'ok') return;
  try {
    const name = backupName(g);
    const w = await (await folder.getFileHandle(name, { create: true })).createWritable();
    await w.write(json);
    await w.close();
    backup.last = name;
    // the five most recent files of this game stay (by date of writing: a game taken back to an earlier year goes on
    // from there, and the files of the abandoned years go first)
    const mine = (await entries()).filter(e => e.id === g.id);
    for (const old of mine.slice(KEEP)) { try { await folder.removeEntry(old.file); } catch { /* ignore */ } }
    changed();
  } catch {
    backup.status = await permitted(folder, false) ? 'error' : 'needsPermission';
    changed();
  }
}

(globalThis as Record<string, unknown>).__backup = { useFolder, listBackups, readBackup, latestBackup, flushBackups, initBackup, backup };
